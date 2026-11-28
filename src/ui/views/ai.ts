import { analyzeConversation, CLASSIFY_BATCH, classifyBatch, generateMessages, needsClassification } from "../../ai/features";
import { getApiKey, isKeyRemembered, looksLikeKey, setApiKey } from "../../ai/key";
import { DEFAULT_MODEL, isFatalError, mapLimit, verifyModel, type AiConfig } from "../../ai/openai";
import { awaitingMyReply, isStale } from "../../core/conversation";
import { conversationIndex } from "../../core/conversations";
import { todayIso } from "../../core/dates";
import type { Contact } from "../../core/types";
import { aiErrorText, card, keepFallbackModel, type Ctx } from "../context";
import { confirmDialog } from "../confirm";
import { field, fmtNumber, h } from "../dom";

const MODELS: Array<[string, string]> = [
  [DEFAULT_MODEL, "سريع ورخيص، وما بدّه توثيق (الافتراضي)"],
  ["gpt-4.1", "أدق، وأغلى"],
  ["gpt-4o-mini", "الأرخص"],
  ["gpt-4o", "قوي، وأغلى"],
  ["gpt-5-mini", "ممكن يحتاج توثيق للمنظمة"],
  ["gpt-5", "ممكن يحتاج توثيق للمنظمة"],
];
let controller: AbortController | null = null;

async function runBatch<T>(ctx: Ctx, label: string, items: T[], work: (item: T, cfg: AiConfig) => Promise<void>, concurrency: number, key: string): Promise<void> {
  controller = new AbortController();
  const from = ctx.store.state.ai.model;
  const cfg: AiConfig = { key, model: from, signal: controller.signal };
  let done = 0;
  let failed = 0;
  let firstError: unknown = null;
  let fatal: unknown = null;
  await ctx.busy(label, async (progress) => {
    progress(`0 / ${items.length}`);
    const results = await mapLimit(items, concurrency, async (item) => {
      await work(item, cfg);
      done += 1;
      progress(`${done} / ${items.length}`);
    }, cfg.signal);
    for (const r of results) {
      if (r.status !== "rejected") continue;
      failed += 1;
      firstError ??= r.reason;
      if (isFatalError(r.reason)) fatal ??= r.reason;
    }
  }, () => controller?.abort());
  controller = null;
  keepFallbackModel(ctx, from, cfg);
  if (fatal) ctx.toast(`وقفنا بعد ${done} من ${items.length}. ${aiErrorText(fatal, cfg.model)}`, "error");
  else if (failed > 0) ctx.toast(`${failed} طلب فشل: ${aiErrorText(firstError, cfg.model)}`, "error");
  else if (done > 0) ctx.toast(`تم: ${done}`);
}

export function renderAi(ctx: Ctx): HTMLElement {
  const state = ctx.store.state;
  const keyInput = h("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "sk-...", value: getApiKey() });
  const remember = h("input", { type: "checkbox", checked: isKeyRemembered(), "aria-describedby": "remember-hint" });
  const options = MODELS.some(([id]) => id === state.ai.model) ? MODELS : [...MODELS, [state.ai.model, ""] as [string, string]];
  const model = h("select", {}, options.map(([id, note]) => h("option", { value: id, selected: id === state.ai.model }, note ? `${id}: ${note}` : id)));
  model.addEventListener("change", () => ctx.store.update((s) => (s.ai.model = model.value), { recompute: false }));

  const saveKey = (): void => {
    const value = keyInput.value.trim();
    if (value && !looksLikeKey(value)) return ctx.toast("المفتاح لازم يبلش بـ sk-", "error");
    setApiKey(value, remember.checked);
    ctx.toast(value ? "انحفظ المفتاح بهاد المتصفح بس" : "انمسح المفتاح");
  };
  const test = async (): Promise<void> => {
    saveKey();
    const key = getApiKey();
    if (!key) return;
    const chosen = ctx.store.state.ai.model;
    const ok = await ctx.busy("فحص المفتاح…", async () => {
      await verifyModel(key, chosen).catch((error: unknown) => {
        throw new Error(aiErrorText(error, chosen));
      });
      return true;
    });
    if (ok) ctx.toast(`المفتاح شغّال والموديل ${chosen} متاح لحسابك`);
  };

  const hasData = ctx.store.hasData;
  const contacts = hasData ? ctx.store.analysis.contacts : [];
  const unknown = contacts.filter((c) => needsClassification(c, state.ai.classifications));
  const priority = contacts.filter((c) => c.bucket === "A" && !c.ai);
  const index = conversationIndex(state.dataset.messages);
  const pending: Array<{ c: Contact; waiting: boolean }> = [];
  for (const c of contacts) {
    const history = index.of(c);
    if (history.length === 0) continue;
    const done = state.ai.analyses[c.id];
    if (done && !isStale(done, history)) continue;
    pending.push({ c, waiting: awaitingMyReply(history) });
  }
  pending.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.c.score - a.c.score);
  const needsAnalysis = pending.map((p) => p.c);
  const waitingOnMe = pending.filter((p) => p.waiting).map((p) => p.c);

  const requireKey = (): string => {
    const key = getApiKey();
    if (!key) ctx.toast("حط المفتاح أول", "error");
    return key;
  };

  const classify = async (): Promise<void> => {
    const key = requireKey();
    if (!key || unknown.length === 0) return;
    const batches: Contact[][] = [];
    for (let i = 0; i < unknown.length; i += CLASSIFY_BATCH) batches.push(unknown.slice(i, i + CLASSIFY_BATCH));
    await runBatch(ctx, "تصنيف الأشخاص المجهولين…", batches, async (batch, cfg) => {
      const result = await classifyBatch(batch, cfg);
      ctx.store.update((s) => Object.assign(s.ai.classifications, result), { emit: false });
    }, 2, key);
    ctx.store.update(() => undefined);
  };

  const writeAll = async (): Promise<void> => {
    const key = requireKey();
    if (!key || priority.length === 0) return;
    if (!(await confirmDialog({ title: `نكتب رسائل لـ ${fmtNumber(priority.length)} شخص؟`, message: "كل شخص طلب منفصل لـ OpenAI على حسابك.", confirm: "اكتب الرسائل" }))) return;
    await runBatch(ctx, "كتابة رسائل لأولوية A…", priority, async (c, cfg) => {
      const result = await generateMessages(c, state.profile, index.of(c), cfg);
      ctx.store.update((s) => (s.ai.messages[c.id] = result), { emit: false });
    }, 3, key);
    ctx.store.update(() => undefined);
  };

  const analyzeAll = async (list: Contact[]): Promise<void> => {
    const key = requireKey();
    if (!key || list.length === 0) return;
    if (!(await confirmDialog({ title: `نحلّل ${fmtNumber(list.length)} محادثة؟`, message: "المحادثات رح تنبعت لـ OpenAI على حسابك.", confirm: "حلّل المحادثات" }))) return;
    const today = todayIso();
    await runBatch(ctx, "تحليل المحادثات…", list, async (c, cfg) => {
      const result = await analyzeConversation(c, state.profile, index.of(c), cfg, today);
      ctx.store.update((s) => (s.ai.analyses[c.id] = result), { recompute: false, emit: false });
    }, 3, key);
    ctx.store.update(() => undefined, { recompute: false });
  };

  const clearAi = async (): Promise<void> => {
    if (!(await confirmDialog({ title: "نمسح شغل الذكاء الاصطناعي؟", message: "رح تنمسح كل الرسائل والتصنيفات اللي عملها. ما بنقدر نرجّعها.", confirm: "امسح", danger: true }))) return;
    ctx.store.update((s) => {
      s.ai.messages = {};
      s.ai.classifications = {};
      s.ai.templates = {};
      s.ai.suggestions = null;
      s.ai.analyses = {};
    });
  };

  return h("div", { class: "view" },
    card("مفتاح OpenAI",
      h("p", {}, "المفتاح بيضل بهاد المتصفح بس، وبينبعت لـ api.openai.com مباشرة وما بيروح لأي مكان ثاني. ما بينحفظ بملف الحفظ ولا بالـ repo."),
      h("div", { class: "form-grid" },
        field("API key", keyInput),
        field("الموديل", model, "إذا الموديل مش متاح لحسابك، الأداة بتكمل لحالها بـ " + DEFAULT_MODEL),
      ),
      h("label", { class: "check" }, remember, " تذكّر المفتاح على هاد الجهاز (بدونها بينمسح لما تسكّر التبويب)"),
      h("p", { class: "hint", id: "remember-hint" }, "لما تختار تذكّر، المفتاح بينحفظ بالمتصفح كنص عادي. أي حدا بيستخدم هاد الجهاز أو حساب المتصفح بيقدر يوصله. استعمله بس على جهازك الشخصي، وحط حد صرف للمفتاح من إعدادات OpenAI."),
      h("div", { class: "row" },
        h("button", { type: "button", onclick: saveKey }, "حفظ"),
        h("button", { type: "button", class: "secondary", onclick: () => void test() }, "فحص المفتاح"),
      ),
    ),
    card("ميزات الذكاء الاصطناعي",
      h("p", { class: "muted" }, "بيتبعت لـ OpenAI: معلوماتك المهنية، واسم الشخص الأول ومنصبه وشركته، وآخر كم رسالة بينكم إذا موجودة. ما بينبعت إيميلات ولا روابط بروفايل."),
      h("div", { class: "action" },
        h("div", {}, h("strong", {}, "تصنيف المجهولين"), h("p", { class: "muted" }, `${fmtNumber(unknown.length)} شخص مستواهم أو تخصصهم أو قطاعهم Unknown. بيتصنفوا على دفعات من ${CLASSIFY_BATCH}.`)),
        h("button", { type: "button", disabled: !hasData || unknown.length === 0, onclick: () => void classify() }, "صنّفهم"),
      ),
      h("div", { class: "action" },
        h("div", {}, h("strong", {}, "رسائل مخصصة لأولوية A"), h("p", { class: "muted" }, `${fmtNumber(priority.length)} شخص بأولوية A ما إلهم رسائل AI. لأي شخص ثاني افتحه من جهات الاتصال واضغط "اكتب بـ AI".`)),
        h("button", { type: "button", disabled: !hasData || priority.length === 0, onclick: () => void writeAll() }, "اكتب الرسائل"),
      ),
      h("div", { class: "action" },
        h("div", {}, h("strong", {}, "تحليل المحادثات"), h("p", { class: "muted" }, `${fmtNumber(needsAnalysis.length)} محادثة جديدة أو فيها رسائل بعد آخر تحليل، منهم ${fmtNumber(waitingOnMe.length)} بانتظار ردك. التحليل بيحكيلك وين وقفتوا وشو الخطوة الجاية وبيقترح رد.`)),
        h("div", { class: "row tight" },
          h("button", { type: "button", disabled: waitingOnMe.length === 0, onclick: () => void analyzeAll(waitingOnMe) }, "الي بانتظار ردي"),
          h("button", { type: "button", class: "secondary", disabled: needsAnalysis.length === 0, onclick: () => void analyzeAll(needsAnalysis) }, "كلهم"),
        ),
      ),
      h("div", { class: "row" },
        h("button", { type: "button", class: "danger", onclick: clearAi }, "مسح نتائج AI"),
      ),
    ),
  );
}

