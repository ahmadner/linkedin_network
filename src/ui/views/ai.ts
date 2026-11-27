import { CLASSIFY_BATCH, classifyBatch, generateMessages, needsClassification } from "../../ai/features";
import { getApiKey, isKeyRemembered, looksLikeKey, setApiKey } from "../../ai/key";
import { DEFAULT_MODEL, isFatalError, mapLimit, verifyModel, type AiConfig } from "../../ai/openai";
import { nameKey } from "../../core/text";
import type { Contact, StoredMessage } from "../../core/types";
import { aiErrorText, card, keepFallbackModel, type Ctx } from "../context";
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

function historyFor(messages: StoredMessage[], c: Contact): StoredMessage[] {
  const key = nameKey(c.fullName);
  return messages.filter((m) => [m.from, ...m.to].some((p) => (c.slug && p.slug === c.slug) || (!p.slug && key && nameKey(p.name) === key)));
}

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

export function renderAi(ctx: Ctx, rerender: () => void): HTMLElement {
  const state = ctx.store.state;
  const keyInput = h("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "sk-...", value: getApiKey() });
  const remember = h("input", { type: "checkbox", checked: isKeyRemembered() });
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
      ctx.store.update((s) => Object.assign(s.ai.classifications, result));
    }, 2, key);
    rerender();
  };

  const writeAll = async (): Promise<void> => {
    const key = requireKey();
    if (!key || priority.length === 0) return;
    if (!window.confirm(`رح نبعت ${priority.length} طلب لـ OpenAI على حسابك. نكمل؟`)) return;
    const messages = state.dataset.messages;
    await runBatch(ctx, "كتابة رسائل لأولوية A…", priority, async (c, cfg) => {
      const result = await generateMessages(c, state.profile, historyFor(messages, c), cfg);
      ctx.store.update((s) => (s.ai.messages[c.id] = result));
    }, 3, key);
    rerender();
  };

  const clearAi = (): void => {
    if (!window.confirm("مسح كل الرسائل والتصنيفات الي عملها الذكاء الاصطناعي؟")) return;
    ctx.store.update((s) => {
      s.ai.messages = {};
      s.ai.classifications = {};
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
      h("div", { class: "row" },
        h("button", { type: "button", class: "danger", onclick: clearAi }, "مسح نتائج AI"),
      ),
    ),
  );
}

