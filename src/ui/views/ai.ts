import { CLASSIFY_BATCH, classifyBatch, generateMessages, needsClassification } from "../../ai/features";
import { getApiKey, isKeyRemembered, looksLikeKey, setApiKey } from "../../ai/key";
import { mapLimit, verifyKey } from "../../ai/openai";
import { nameKey } from "../../core/text";
import type { Contact, StoredMessage } from "../../core/types";
import { card, type Ctx } from "../context";
import { field, fmtNumber, h } from "../dom";

const MODELS = ["gpt-5-mini", "gpt-5", "gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"];
let controller: AbortController | null = null;

function historyFor(messages: StoredMessage[], c: Contact): StoredMessage[] {
  const key = nameKey(c.fullName);
  return messages.filter((m) => [m.from, ...m.to].some((p) => (c.slug && p.slug === c.slug) || (!p.slug && key && nameKey(p.name) === key)));
}

async function runBatch<T>(ctx: Ctx, label: string, items: T[], work: (item: T, signal: AbortSignal) => Promise<void>, concurrency: number): Promise<void> {
  controller = new AbortController();
  const signal = controller.signal;
  let done = 0;
  let failed = 0;
  let firstError = "";
  await ctx.busy(label, async (progress) => {
    progress(`0 / ${items.length}`);
    const results = await mapLimit(items, concurrency, async (item) => {
      await work(item, signal);
      done += 1;
      progress(`${done} / ${items.length}`);
    }, signal);
    for (const r of results) {
      if (r?.status === "rejected") {
        failed += 1;
        firstError ||= r.reason instanceof Error ? r.reason.message : String(r.reason);
      }
    }
  }, () => controller?.abort());
  controller = null;
  if (failed > 0) ctx.toast(`${failed} طلب فشل: ${firstError}`, "error");
  else if (done > 0) ctx.toast(`تم: ${done}`);
}

export function renderAi(ctx: Ctx, rerender: () => void): HTMLElement {
  const state = ctx.store.state;
  const keyInput = h("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "sk-...", value: getApiKey() });
  const remember = h("input", { type: "checkbox", checked: isKeyRemembered() });
  const model = h("input", { type: "text", list: "models", value: state.ai.model });
  const modelList = h("datalist", { id: "models" }, MODELS.map((m) => h("option", { value: m })));

  const saveKey = (): void => {
    const value = keyInput.value.trim();
    if (value && !looksLikeKey(value)) return ctx.toast("المفتاح لازم يبلش بـ sk-", "error");
    setApiKey(value, remember.checked);
    ctx.store.update((s) => (s.ai.model = model.value.trim() || s.ai.model), { recompute: false });
    ctx.toast(value ? "انحفظ المفتاح بهاد المتصفح بس" : "انمسح المفتاح");
  };
  const test = async (): Promise<void> => {
    saveKey();
    const key = getApiKey();
    if (!key) return;
    const ok = await ctx.busy("فحص المفتاح…", async () => {
      await verifyKey(key, state.ai.model);
      return true;
    });
    if (ok) ctx.toast(`المفتاح شغّال والموديل ${state.ai.model} متاح`);
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
    await runBatch(ctx, "تصنيف الأشخاص المجهولين…", batches, async (batch, signal) => {
      const result = await classifyBatch(batch, { key, model: state.ai.model, signal });
      ctx.store.update((s) => Object.assign(s.ai.classifications, result));
    }, 2);
    rerender();
  };

  const writeAll = async (): Promise<void> => {
    const key = requireKey();
    if (!key || priority.length === 0) return;
    if (!window.confirm(`رح نبعت ${priority.length} طلب لـ OpenAI على حسابك. نكمل؟`)) return;
    const messages = state.dataset.messages;
    await runBatch(ctx, "كتابة رسائل لأولوية A…", priority, async (c, signal) => {
      const result = await generateMessages(c, state.profile, historyFor(messages, c), { key, model: state.ai.model, signal });
      ctx.store.update((s) => (s.ai.messages[c.id] = result));
    }, 3);
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
        field("الموديل", h("div", {}, model, modelList), "gpt-5-mini سريع ورخيص ونتائجه ممتازة للرسائل"),
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

