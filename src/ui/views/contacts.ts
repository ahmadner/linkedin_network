import { analyzeConversation, generateMessages, generateTemplate, templateKey } from "../../ai/features";
import { FUNCTION_LABELS, INDUSTRY_LABELS } from "../../core/classify";
import { isStale, STAGE_LABEL, STAGES, TONE_LABEL } from "../../core/conversation";
import { conversationIndex } from "../../core/conversations";
import { todayIso } from "../../core/dates";
import { MAX_BATCH, MESSAGE_SOURCES, messageFor, type MessageSource } from "../../core/outreach";
import { newTracking } from "../../core/pipeline";
import { hasTag, normalizeTags, tagCounts } from "../../core/tags";
import { TEMPLATE_IDS, TEMPLATE_LABEL, TEMPLATES_WITH_JOB, TemplateBuilder, type TemplateId } from "../../core/templates";
import type { Contact, ConversationAnalysis, MessageSet, StoredMessage, Tracking } from "../../core/types";
import { CONTACT_EXPORT_COLUMNS } from "../../io/excel";
import { ago, avatar, awaitingMe, badge, exportLinks, linkedinLinks, MODE_AR, noData, runAi, STATUS_AR, statusBadge, STATUSES, type Ctx } from "../context";
import { copyText, field, fmtNumber, h, replace, select, tabList, tabPanel, textArea, textInput } from "../dom";
import { icon } from "../icons";
import { queueMessages } from "./outreach";

const PAGE_SIZE = 50;
const THREAD_SIZE = 30;

type SortKey = "score" | "fullName" | "companyClean" | "seniorityRank" | "daysSinceContact";
type FilterKey = "bucket" | "mode" | "status" | "fn" | "industry" | "tag" | "stage";
type Tab = "overview" | "thread" | "messages" | "track";
export type Preset = "" | "reply" | "waiting" | "fresh";

const PRESETS: Array<[Preset, string]> = [
  ["", "الكل"],
  ["reply", "بدهم رد منك"],
  ["waiting", "بانتظار ردهم"],
  ["fresh", "أولوية عالية ما تواصلت معهم"],
];

const SORTS: Array<[SortKey, string]> = [
  ["score", "الأولوية"],
  ["daysSinceContact", "آخر تواصل"],
  ["fullName", "الاسم"],
  ["companyClean", "الشركة"],
  ["seniorityRank", "المستوى"],
];

const REPLIED: Array<[string, string]> = [["", "—"], ["Yes", "نعم"], ["No", "لا"], ["Pending", "بانتظار"]];

const view = {
  q: "",
  preset: "" as Preset,
  bucket: "",
  mode: "",
  status: "",
  fn: "",
  industry: "",
  tag: "",
  stage: "",
  more: false,
  sort: "score" as SortKey,
  desc: true,
  page: 0,
  picked: new Set<string>(),
  selected: "",
  tab: "overview" as Tab,
  variant: "rules" as "rules" | "ai",
  source: "message_ar" as MessageSource,
  template: "referral" as TemplateId,
  templateRules: false,
  jobTitle: "",
  jobLink: "",
};

let order: string[] = [];
let redraw: (() => void) | null = null;

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !view.selected || !redraw || !document.querySelector(".drawer")) return;
  view.selected = "";
  redraw();
});

function inPreset(c: Contact): boolean {
  if (view.preset === "reply") return awaitingMe(c);
  if (view.preset === "waiting") return c.mode === "nudge";
  if (view.preset === "fresh") return c.mode === "cold" && (c.bucket === "A" || c.bucket === "B");
  return true;
}

function matches(c: Contact, analyses: Record<string, ConversationAnalysis>): boolean {
  if (!inPreset(c)) return false;
  if (view.bucket && c.bucket !== view.bucket) return false;
  if (view.mode && c.mode !== view.mode) return false;
  if (view.status && c.tracking.status !== view.status) return false;
  if (view.fn && c.function !== view.fn) return false;
  if (view.industry && c.industry !== view.industry) return false;
  if (view.tag && !hasTag(c, view.tag)) return false;
  if (view.stage && analyses[c.id]?.stage !== view.stage) return false;
  if (!view.q) return true;
  const q = view.q.toLowerCase();
  return [c.fullName, c.companyClean, c.positionClean, c.tracking.notes, ...c.tracking.tags].some((v) => v.toLowerCase().includes(q));
}

function sorted(list: Contact[]): Contact[] {
  const dir = view.desc ? -1 : 1;
  const key = view.sort;
  return [...list].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === y) return a.idx - b.idx;
    if (x === null) return 1;
    if (y === null) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
  });
}

function setSort(key: SortKey): void {
  if (view.sort === key) view.desc = !view.desc;
  else {
    view.sort = key;
    view.desc = key === "score" || key === "seniorityRank";
  }
}

function patchTracking(ctx: Ctx, c: Contact, patch: Partial<Tracking>, recompute = true): void {
  ctx.store.update((s) => {
    const next = { ...newTracking(), ...s.tracking[c.id], ...patch };
    s.tracking[c.id] = next;
    c.tracking = next;
  }, { recompute });
}

function setStatus(ctx: Ctx, c: Contact, status: string): void {
  patchTracking(ctx, c, { status, ...(status !== "Not started" && !c.tracking.dateSent ? { dateSent: todayIso() } : {}) });
}

function statusSelect(ctx: Ctx, c: Contact): HTMLSelectElement {
  return select(STATUSES.map((s): [string, string] => [s, STATUS_AR[s] ?? s]), c.tracking.status, (v) => setStatus(ctx, c, v), { "aria-label": "حالة المتابعة" });
}

function tagEditor(ctx: Ctx, c: Contact): HTMLElement {
  const input = h("input", { type: "text", list: "known-tags", placeholder: "وسم جديد ثم Enter", "aria-label": "وسم جديد" });
  const save = (tags: string[]): void => {
    patchTracking(ctx, c, { tags: normalizeTags(tags) }, false);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".tag-editor input")?.focus());
  };
  const add = (): void => {
    const values = input.value.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length > 0) save([...c.tracking.tags, ...values]);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== ",") return;
    e.preventDefault();
    add();
  });
  return h("div", { class: "tag-editor" },
    c.tracking.tags.map((t) => h("span", { class: "chip" }, t,
      h("button", { type: "button", class: "chip-x", "aria-label": `شيل الوسم ${t}`, onclick: () => save(c.tracking.tags.filter((x) => x !== t)) }, icon("close")))),
    input,
    h("button", { type: "button", class: "link", onclick: add }, "إضافة"),
  );
}

function conversationOf(ctx: Ctx, c: Contact): StoredMessage[] {
  return conversationIndex(ctx.store.state.dataset.messages).of(c);
}

function textDir(text: string): string {
  return /[؀-ۿ]/.test(text) ? "rtl" : "ltr";
}

function messageBlock(title: string, text: string, limit?: number, queue?: () => void): HTMLElement {
  const copy = h("button", { type: "button", class: "link" }, "نسخ");
  copy.addEventListener("click", () => void copyText(text).then((ok) => (copy.textContent = ok ? "انّسخ ✓" : "ما زبط النسخ")));
  const over = limit !== undefined && text.length > limit;
  return h("div", { class: "msg" },
    h("div", { class: "msg-head" },
      h("strong", {}, title),
      h("span", { class: over ? "count over" : "count", title: over ? "أطول من الحد المسموح" : "" }, limit ? `${text.length}/${limit}` : `${text.length}`),
      copy,
      queue && text.trim() ? h("button", { type: "button", class: "secondary small", onclick: queue }, icon("send"), "جهّز للإرسال") : null,
    ),
    h("pre", { dir: textDir(text) }, text),
  );
}

function section(title: string, ...children: Array<Node | string | null | false>): HTMLElement {
  return h("section", { class: "panel-section" }, h("h3", {}, title), ...children);
}

function templateSection(ctx: Ctx, c: Contact, rerender: () => void): HTMLElement {
  const id = view.template;
  const extra = { jobTitle: view.jobTitle, jobLink: view.jobLink };
  const ai = ctx.store.state.ai.templates[templateKey(c.id, id)];
  const showAi = Boolean(ai) && !view.templateRules;
  const text = showAi && ai ? ai : new TemplateBuilder(ctx.store.state.profile).build(id, c, extra);
  const limit = ctx.store.state.profile.messaging.message_char_limit;
  const write = async (): Promise<void> => {
    const result = await runAi(ctx, "كتابة القالب بالذكاء الاصطناعي…", (cfg) => generateTemplate(c, ctx.store.state.profile, conversationOf(ctx, c), id, extra, cfg));
    if (!result) return;
    view.templateRules = false;
    ctx.store.update((s) => (s.ai.templates[templateKey(c.id, id)] = result), { recompute: false });
  };
  return section("قوالب حسب الهدف",
    h("div", { class: "row tight wrap" },
      select(TEMPLATE_IDS.map((t): [string, string] => [t, TEMPLATE_LABEL[t]]), id, (v) => { view.template = v as TemplateId; view.templateRules = false; rerender(); }, { "aria-label": "القالب" }),
      h("button", { type: "button", class: "secondary small", onclick: () => void write() }, icon("spark"), ai ? "إعادة كتابة بـ AI" : "اكتب بـ AI"),
      ai ? h("button", { type: "button", class: "link", onclick: () => { view.templateRules = !view.templateRules; rerender(); } }, showAi ? "شوف نسخة القواعد" : "شوف نسخة AI") : null,
    ),
    TEMPLATES_WITH_JOB.has(id) ? h("div", { class: "form-grid" },
      field("الوظيفة (اختياري)", textInput(view.jobTitle, (v) => { view.jobTitle = v.trim(); rerender(); }, { placeholder: ctx.store.state.profile.me.target_roles[0] ?? "" })),
      field("رابط الوظيفة (اختياري)", textInput(view.jobLink, (v) => { view.jobLink = v.trim(); rerender(); }, { type: "url", dir: "ltr", placeholder: "https://" })),
    ) : null,
    h("p", { class: "muted small" }, showAi && ai ? `مكتوبة بـ AI (${ai.model})` : "مكتوبة من القواعد، من بروفايلك وبروفايل الشخص"),
    messageBlock("عربي", text.ar, limit, () => queueMessages(ctx, [{ contact: c, text: text.ar }])),
    messageBlock("English", text.en, limit, () => queueMessages(ctx, [{ contact: c, text: text.en }])),
  );
}

const STAGE_TONE: Record<string, string> = { opportunity: "good", waiting_me: "bad", gone_cold: "warn", closed: "" };

function analysisSection(ctx: Ctx, c: Contact, history: StoredMessage[]): HTMLElement {
  const result = ctx.store.state.ai.analyses[c.id];
  const run = async (): Promise<void> => {
    const out = await runAi(ctx, "تحليل المحادثة…", (cfg) => analyzeConversation(c, ctx.store.state.profile, history, cfg, todayIso()));
    if (!out) return;
    ctx.store.update((s) => (s.ai.analyses[c.id] = out), { recompute: false });
  };
  const limit = ctx.store.state.profile.messaging.message_char_limit;
  return section("تحليل المحادثة بالذكاء الاصطناعي",
    h("div", { class: "row tight wrap" },
      h("button", { type: "button", class: "secondary small", onclick: () => void run() }, icon("spark"), result ? "حلّل من جديد" : "حلّل المحادثة"),
      result && isStale(result, history) ? badge("في رسائل جديدة بعد التحليل", "warn") : null,
    ),
    result ? h("div", { class: "analysis" },
      h("div", { class: "row tight wrap" },
        badge(STAGE_LABEL[result.stage], STAGE_TONE[result.stage] ?? ""),
        badge(`النبرة: ${TONE_LABEL[result.tone]}`, result.tone === "positive" ? "good" : result.tone === "negative" ? "bad" : ""),
        h("span", { class: "muted small" }, `${result.generatedAt.slice(0, 10)} · ${result.model}`),
      ),
      result.summary_ar ? h("p", {}, result.summary_ar) : null,
      result.next_step_ar ? h("p", { class: "advice" }, h("strong", {}, "الخطوة الجاية: "), result.next_step_ar) : null,
      result.reply_ar ? messageBlock("رد مقترح - عربي", result.reply_ar, limit, () => queueMessages(ctx, [{ contact: c, text: result.reply_ar }])) : null,
      result.reply_en ? messageBlock("Suggested reply - English", result.reply_en, limit, () => queueMessages(ctx, [{ contact: c, text: result.reply_en }])) : null,
    ) : h("p", { class: "muted small" }, `بيقرأ آخر ${Math.min(history.length, 20)} رسالة، وبيحكيلك وين وقفتوا وشو الخطوة الجاية، وبيقترح رد جاهز.`),
  );
}

function threadList(messages: StoredMessage[], name: string): HTMLElement {
  return h("ol", { class: "thread" }, messages.map((m) => h("li", { class: m.outgoing ? "out" : "in" },
    h("span", { class: "thread-meta" }, m.outgoing ? "أنا" : name.split(/\s+/)[0] ?? name, " · ", m.at.slice(0, 16).replace("T", " ")),
    h("span", { class: "thread-text", dir: textDir(m.content) }, m.content || "—"),
  )));
}

function facts(rows: Array<[string, string]>): HTMLElement {
  return h("dl", { class: "facts" }, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v ? h("bdi", {}, v) : "—")]));
}

function overviewTab(ctx: Ctx, c: Contact, history: StoredMessage[]): HTMLElement[] {
  const last = history[history.length - 1];
  const nextStep = textInput(c.tracking.nextStep, (v) => patchTracking(ctx, c, { nextStep: v }, false), { placeholder: "مثلًا: ابعتله السيرة الذاتية", "aria-label": "الخطوة الجاية" });
  return [
    h("p", { class: "advice" }, c.outreachAdviceAr),
    section("المتابعة السريعة",
      h("div", { class: "form-grid" }, field("الحالة", statusSelect(ctx, c)), field("الخطوة الجاية", nextStep)),
    ),
    last ? section("آخر رسالة",
      h("div", { class: last.outgoing ? "last-msg out" : "last-msg in" },
        h("span", { class: "thread-meta" }, last.outgoing ? "منك" : "منه", " · ", ago(c.daysSinceContact)),
        h("p", { dir: textDir(last.content) }, last.content || "—"),
      ),
      h("button", { type: "button", class: "link", onclick: () => { view.tab = "thread"; redraw?.(); } }, `شوف المحادثة كاملة (${fmtNumber(history.length)})`),
    ) : null,
    section("معلومات",
      facts([
        ["المنصب", c.positionClean],
        ["الشركة", c.companyClean],
        ["المستوى", c.seniority],
        ["التخصص", c.function],
        ["القطاع", c.industry],
        ["الدولة", c.country === "Unknown" ? "" : c.country],
        ["الإيميل", c.email],
        ["صرتوا أصحاب", c.connectedDate ?? ""],
        ["الرسائل", `بعتت ${fmtNumber(c.history.sentByMe)} · وصلني ${fmtNumber(c.history.received)}`],
        ["آخر تواصل", c.history.lastContact ? `${c.history.lastContact.slice(0, 10)} (${ago(c.daysSinceContact)})` : ""],
      ]),
      h("details", {}, h("summary", {}, "ليش هاي الأولوية؟"), facts([["النقاط", c.scoreBreakdown], ["الدليل", c.evidence]])),
    ),
  ].filter((n): n is HTMLElement => n !== null);
}

function messagesTab(ctx: Ctx, c: Contact, rerender: () => void): HTMLElement[] {
  const limits = ctx.store.state.profile.messaging;
  const variant = view.variant === "ai" && c.ai ? "ai" : "rules";
  const set: MessageSet = variant === "ai" && c.ai ? c.ai : c;
  const generate = async (): Promise<void> => {
    const result = await runAi(ctx, "كتابة رسائل بالذكاء الاصطناعي…", (cfg) => generateMessages(c, ctx.store.state.profile, conversationOf(ctx, c), cfg));
    if (!result) return;
    view.variant = "ai";
    ctx.store.update((s) => (s.ai.messages[c.id] = result));
  };
  const queue = (text: string) => () => queueMessages(ctx, [{ contact: c, text }]);
  return [
    h("div", { class: "row tight wrap" },
      h("div", { class: "segmented", role: "group", "aria-label": "مصدر الرسائل" },
        h("button", { type: "button", "aria-pressed": String(variant === "rules"), onclick: () => { view.variant = "rules"; rerender(); } }, "من القواعد"),
        h("button", { type: "button", "aria-pressed": String(variant === "ai"), disabled: !c.ai, onclick: () => { view.variant = "ai"; rerender(); } }, "من AI"),
      ),
      h("button", { type: "button", class: "secondary small", onclick: () => void generate() }, icon("spark"), c.ai ? "إعادة كتابة بـ AI" : "اكتب بـ AI"),
    ),
    section("الرسالة الكاملة",
      messageBlock("عربي", set.message_ar, limits.message_char_limit, queue(set.message_ar)),
      messageBlock("English", set.message_en, limits.message_char_limit, queue(set.message_en)),
    ),
    section("المتابعة",
      messageBlock("عربي", set.followup_ar, undefined, queue(set.followup_ar)),
      messageBlock("English", set.followup_en, undefined, queue(set.followup_en)),
    ),
    section("نوت قصيرة مع طلب التواصل",
      messageBlock("عربي", set.note_ar, limits.note_char_limit),
      messageBlock("English", set.note_en, limits.note_char_limit),
    ),
    templateSection(ctx, c, rerender),
  ];
}

function trackTab(ctx: Ctx, c: Contact): HTMLElement[] {
  const set = (patch: Partial<Tracking>): void => patchTracking(ctx, c, patch);
  const date = h("input", { type: "date", value: c.tracking.dateSent, "aria-label": "تاريخ الإرسال" });
  date.addEventListener("change", () => set({ dateSent: date.value }));
  return [h("div", { class: "form-grid" },
    field("الحالة", statusSelect(ctx, c)),
    field("تاريخ الإرسال", h("div", { class: "row tight" }, date, h("button", { type: "button", class: "link", onclick: () => set({ dateSent: todayIso() }) }, "اليوم"))),
    field("ردّ؟", select(REPLIED, c.tracking.replied, (v) => set({ replied: v }))),
    field("الخطوة الجاية", textInput(c.tracking.nextStep, (v) => set({ nextStep: v }))),
    h("div", { class: "wide" }, field("الوسوم", tagEditor(ctx, c))),
    h("div", { class: "wide" }, field("ملاحظات", textArea(c.tracking.notes, (v) => patchTracking(ctx, c, { notes: v }, false), { rows: 4 }))),
  )];
}

function drawer(ctx: Ctx, c: Contact, rerender: () => void): HTMLElement {
  const history = conversationOf(ctx, c);
  const close = (): void => {
    view.selected = "";
    rerender();
  };
  const at = order.indexOf(c.id);
  const step = (delta: number): void => {
    const next = order[at + delta];
    if (!next) return;
    view.selected = next;
    rerender();
  };
  const tabs: Array<[Tab, string]> = [["overview", "نظرة عامة"], ["thread", `المحادثة${history.length ? ` (${fmtNumber(history.length)})` : ""}`], ["messages", "الرسائل"], ["track", "المتابعة"]];
  const body = (() => {
    switch (view.tab) {
      case "thread": return history.length === 0
        ? [h("p", { class: "empty-line" }, "ما في رسائل بينكم لسا. شوف تبويب الرسائل لتبلش.")]
        : [history.length > THREAD_SIZE ? h("p", { class: "muted small" }, `آخر ${THREAD_SIZE} رسالة من ${fmtNumber(history.length)}`) : null, threadList(history.slice(-THREAD_SIZE), c.fullName), analysisSection(ctx, c, history)];
      case "messages": return messagesTab(ctx, c, rerender);
      case "track": return trackTab(ctx, c);
      default: return overviewTab(ctx, c, history);
    }
  })();
  const set: MessageSet = view.variant === "ai" && c.ai ? c.ai : c;
  const primaryText = c.mode === "nudge" ? set.followup_ar : set.message_ar;

  const panel = h("aside", { class: "drawer", role: "dialog", "aria-modal": "false", "aria-labelledby": "drawer-title", tabindex: -1 },
    h("header", { class: "drawer-head" },
      h("div", { class: "drawer-top" },
        h("div", { class: "person" }, avatar(ctx, c, "large"),
          h("div", { class: "person-text" },
            h("h2", { id: "drawer-title" }, c.fullName),
            h("p", { class: "muted", dir: "auto" }, [c.positionPrimary || c.positionClean, c.companyClean].filter(Boolean).join(" · ")),
          )),
        h("div", { class: "drawer-nav" },
          h("button", { type: "button", class: "icon-btn", disabled: at <= 0, "aria-label": "الشخص السابق", title: "السابق", onclick: () => step(-1) }, "›"),
          h("button", { type: "button", class: "icon-btn", disabled: at < 0 || at >= order.length - 1, "aria-label": "الشخص التالي", title: "التالي", onclick: () => step(1) }, "‹"),
          h("button", { type: "button", class: "icon-btn", "aria-label": "إغلاق", title: "إغلاق (Esc)", onclick: close }, icon("close")),
        ),
      ),
      h("div", { class: "row tight wrap" },
        badge(`أولوية ${c.bucket} · ${c.score}`, `bucket-${c.bucket}`),
        badge(MODE_AR[c.mode] ?? c.mode, `mode-${c.mode}`),
        statusBadge(c.tracking.status),
        c.archetypeLabel ? badge(c.archetypeLabel) : null,
        awaitingMe(c) ? badge("بستنى ردك", "bad") : null,
      ),
      h("div", { class: "row tight wrap" },
        c.slug && primaryText.trim() ? h("button", { type: "button", class: "small", onclick: () => queueMessages(ctx, [{ contact: c, text: primaryText }]) }, icon("send"), c.mode === "nudge" ? "جهّز متابعة" : "جهّز رسالة") : null,
        linkedinLinks(ctx, c),
      ),
      tabList("drawer", "تفاصيل الشخص", tabs.map(([id, label]) => ({ id, label })), view.tab, (id) => { view.tab = id as typeof view.tab; rerender(); }, { class: "drawer-tabs" }),
    ),
    tabPanel("drawer", view.tab, "drawer-body", body),
  );
  requestAnimationFrame(() => {
    if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  });
  return h("div", { class: "drawer-layer" }, h("div", { class: "drawer-backdrop", onclick: close }), panel);
}

export function closeContact(): void {
  view.selected = "";
}

export function openContact(ctx: Ctx, id: string): void {
  view.selected = id;
  view.tab = "overview";
  ctx.go("contacts");
}

export function showContacts(ctx: Ctx, preset: Preset, q = ""): void {
  Object.assign(view, { preset, q, bucket: "", mode: "", status: "", fn: "", industry: "", tag: "", stage: "", page: 0, selected: "" });
  view.picked.clear();
  if (preset === "reply" || preset === "waiting") Object.assign(view, { sort: "daysSinceContact", desc: false });
  else Object.assign(view, { sort: "score", desc: true });
  ctx.go("contacts");
}

export function renderContacts(ctx: Ctx, rerender: () => void): HTMLElement {
  redraw = rerender;
  if (!ctx.store.hasData) return noData(ctx);
  const all = ctx.store.analysis.contacts;
  const tags = tagCounts(all);
  const hasAnalyses = Object.keys(ctx.store.state.ai.analyses).length > 0;
  const host = h("div", { class: "table-host" });
  const chipsHost = h("div", { class: "active-filters" });
  const bulkHost = h("div", { class: "bulk" });

  const filterNames: Record<FilterKey, [string, Record<string, string>?]> = {
    bucket: ["الأولوية"],
    mode: ["التواصل", MODE_AR],
    status: ["المتابعة", STATUS_AR],
    fn: ["التخصص"],
    industry: ["القطاع"],
    tag: ["الوسم"],
    stage: ["المحادثة", STAGE_LABEL],
  };

  const draw = (): void => {
    const analyses = ctx.store.state.ai.analyses;
    const list = sorted(all.filter((c) => matches(c, analyses)));
    order = list.map((c) => c.id);
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    view.page = Math.min(view.page, pages - 1);
    const rows = list.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);
    const visible = new Set(order);
    for (const id of view.picked) if (!visible.has(id)) view.picked.delete(id);

    const active = (Object.keys(filterNames) as FilterKey[]).filter((k) => view[k]);
    replace(chipsHost, active.length === 0 && !view.q ? null : [
      view.q ? h("span", { class: "chip" }, `بحث: ${view.q}`) : null,
      ...active.map((k) => {
        const [label, names] = filterNames[k];
        return h("span", { class: "chip" }, `${label}: ${names?.[view[k]] ?? view[k]}`,
          h("button", { type: "button", class: "chip-x", "aria-label": `شيل فلتر ${label}`, onclick: () => { view[k] = ""; view.page = 0; rerender(); } }, icon("close")));
      }),
      h("button", { type: "button", class: "link", onclick: () => { for (const k of active) view[k] = ""; view.q = ""; view.page = 0; rerender(); } }, "امسح الفلاتر"),
    ]);

    const target = view.picked.size > 0 ? list.filter((c) => view.picked.has(c.id)) : list;
    replace(bulkHost, bulkBar(target, list.length));

    if (list.length === 0) {
      replace(host, h("div", { class: "card empty" }, h("h2", {}, "ما في حدا بهالفلاتر"), h("p", { class: "muted" }, "جرّب تمسح البحث أو بعض الفلاتر.")));
      return;
    }

    const pageIds = rows.map((c) => c.id);
    const allPicked = pageIds.every((id) => view.picked.has(id));
    const pickAll = h("input", { type: "checkbox", checked: allPicked, "aria-label": "اختار كل الصفحة" });
    pickAll.indeterminate = !allPicked && pageIds.some((id) => view.picked.has(id));
    pickAll.addEventListener("change", () => {
      for (const id of pageIds) {
        if (pickAll.checked) view.picked.add(id);
        else view.picked.delete(id);
      }
      draw();
    });

    const th = (label: string, key: SortKey | null, cls = ""): HTMLElement => {
      if (!key) return h("th", { class: cls }, label);
      const on = view.sort === key;
      return h("th", { class: cls, "aria-sort": on ? (view.desc ? "descending" : "ascending") : "none" },
        h("button", { type: "button", class: on ? "sort on" : "sort", onclick: () => { setSort(key); rerender(); } }, label, h("span", { class: "sort-mark", "aria-hidden": "true" }, on ? (view.desc ? "▼" : "▲") : "")));
    };

    const pager = pages > 1 ? h("nav", { class: "pager", "aria-label": "الصفحات" },
      h("button", { type: "button", class: "secondary small", disabled: view.page === 0, onclick: () => { view.page -= 1; draw(); host.scrollIntoView({ block: "start" }); } }, "السابق"),
      h("span", {}, `صفحة ${view.page + 1} من ${pages}`),
      h("button", { type: "button", class: "secondary small", disabled: view.page >= pages - 1, onclick: () => { view.page += 1; draw(); host.scrollIntoView({ block: "start" }); } }, "التالي"),
    ) : null;

    replace(host,
      h("div", { class: "scroll table-wrap" }, h("table", { class: "grid people" },
        h("thead", {}, h("tr", {},
          h("th", { class: "pick" }, pickAll),
          th("الشخص", "fullName"), th("الشركة", "companyClean", "col-company"), th("الأولوية", "score"),
          th("التواصل", null), th("آخر تواصل", "daysSinceContact"), th("المتابعة", null),
        )),
        h("tbody", {}, rows.map((c) => {
          const pick = h("input", { type: "checkbox", checked: view.picked.has(c.id), "aria-label": `اختار ${c.fullName}` });
          pick.addEventListener("click", (e) => e.stopPropagation());
          pick.addEventListener("change", () => {
            if (pick.checked) view.picked.add(c.id);
            else view.picked.delete(c.id);
            draw();
          });
          const role = c.positionPrimary || c.positionClean;
          const tr = h("tr", { class: c.id === view.selected ? "selected" : "", tabindex: 0, "aria-label": c.fullName },
            h("td", { class: "pick" }, pick),
            h("td", { class: "who" }, h("span", { class: "person" }, avatar(ctx, c),
              h("span", { class: "person-text" },
                h("span", { class: "name" }, c.fullName, c.ai ? h("span", { class: "ai-dot", title: "في رسائل AI" }, " ✦") : null, awaitingMe(c) ? h("span", { class: "dot-hot", title: "بستنى ردك" }) : null),
                role ? h("span", { class: "sub", dir: "auto" }, role) : null,
                c.tracking.tags.length > 0 ? h("span", { class: "chips" }, c.tracking.tags.map((t) => h("span", { class: "chip small" }, t))) : null,
              ))),
            h("td", { class: "col-company", dir: "auto" }, c.companyClean || "—"),
            h("td", { "data-label": "الأولوية" }, h("span", { class: "prio" }, badge(c.bucket, `bucket-${c.bucket}`), h("span", { class: "muted small" }, c.score))),
            h("td", { "data-label": "التواصل" }, badge(MODE_AR[c.mode] ?? c.mode, `mode-${c.mode}`)),
            h("td", { "data-label": "آخر تواصل", class: "nowrap" }, ago(c.daysSinceContact)),
            h("td", { "data-label": "المتابعة" }, statusBadge(c.tracking.status)),
          );
          const open = (): void => {
            view.selected = c.id;
            view.tab = "overview";
            rerender();
          };
          tr.addEventListener("click", open);
          tr.addEventListener("keydown", (e) => {
            if (e.target === tr && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              open();
            }
          });
          return tr;
        })),
      )),
      pager,
    );
  };

  const bulkBar = (target: Contact[], total: number): Array<HTMLElement | null> => {
    const picked = view.picked.size;
    const source = select(MESSAGE_SOURCES, view.source, (v) => (view.source = v as MessageSource), { "aria-label": "نوع الرسالة" });
    const queue = (): void => {
      const { profile, ai } = ctx.store.state;
      const ready = target.filter((c) => c.slug).slice(0, MAX_BATCH);
      if (ready.length === 0) return ctx.toast("ما في حدا عنده رابط بروفايل بهالنتيجة", "error");
      queueMessages(ctx, ready.map((c) => ({ contact: c, text: messageFor(c, view.source, profile, ai.templates) })));
    };
    const tagInput = h("input", { type: "text", list: "known-tags", placeholder: "وسم", "aria-label": "وسم", class: "short" });
    const tag = (): void => {
      const values = tagInput.value.split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length === 0 || target.length === 0) return;
      if (!window.confirm(`إضافة "${values.join(", ")}" لـ ${fmtNumber(target.length)} شخص؟`)) return;
      ctx.store.update((s) => {
        for (const c of target) {
          const next = { ...newTracking(), ...s.tracking[c.id] };
          next.tags = normalizeTags([...next.tags, ...values]);
          s.tracking[c.id] = next;
          c.tracking = next;
        }
      }, { recompute: false });
      ctx.toast(`انضاف الوسم لـ ${fmtNumber(target.length)} شخص`);
    };
    return [
      h("span", { class: "bulk-count" },
        picked > 0 ? h("strong", {}, `${fmtNumber(picked)} مختارين`) : h("strong", {}, `${fmtNumber(total)} شخص`),
        picked > 0 ? h("button", { type: "button", class: "link", onclick: () => { view.picked.clear(); draw(); } }, "إلغاء الاختيار") : h("span", { class: "muted small" }, "اختار ناس من الجدول أو اشتغل على كل النتيجة"),
      ),
      h("span", { class: "bulk-actions" },
        h("span", { class: "row tight" }, source, h("button", { type: "button", class: "small", onclick: queue, disabled: target.length === 0 }, icon("send"), `جهّز رسالة${target.length > MAX_BATCH ? ` (أول ${MAX_BATCH})` : ""}`)),
        h("span", { class: "row tight" }, tagInput, h("button", { type: "button", class: "secondary small", onclick: tag, disabled: target.length === 0 }, "أضف وسم")),
        exportLinks(ctx, "contacts", CONTACT_EXPORT_COLUMNS, () => target),
      ),
    ];
  };

  const search = h("input", { type: "search", placeholder: "ابحث بالاسم أو الشركة أو المنصب أو الوسم", value: view.q, "aria-label": "بحث" });
  search.addEventListener("input", () => {
    view.q = search.value.trim();
    view.page = 0;
    draw();
  });
  const filter = (key: FilterKey, label: string, options: string[], names?: Record<string, string>): HTMLElement =>
    select([["", label], ...options.map((o): [string, string] => [o, names?.[o] ?? o])], view[key], (v) => {
      view[key] = v;
      view.page = 0;
      rerender();
    }, { "aria-label": filterNames[key][0], class: view[key] ? "on" : "" });

  const presetCounts = new Map<Preset, number>();
  for (const [p] of PRESETS) {
    const keep = view.preset;
    view.preset = p;
    presetCounts.set(p, all.filter(inPreset).length);
    view.preset = keep;
  }

  const extraActive = Boolean(view.fn || view.industry || view.tag || view.stage || view.mode);
  draw();
  const selected = view.selected ? all.find((c) => c.id === view.selected) : undefined;
  return h("div", { class: "view" },
    h("div", { class: "presets", role: "group", "aria-label": "عرض سريع" }, PRESETS.map(([p, label]) =>
      h("button", { type: "button", "aria-pressed": String(view.preset === p), class: p === "reply" && (presetCounts.get(p) ?? 0) > 0 ? "hot" : "", onclick: () => { view.preset = p; view.page = 0; view.picked.clear(); rerender(); } },
        label, h("span", { class: "preset-count" }, fmtNumber(presetCounts.get(p) ?? 0))))),
    h("div", { class: "filters card" },
      h("div", { class: "toolbar" },
        h("span", { class: "search-box" }, icon("search"), search),
        filter("bucket", "كل الأولويات", ["A", "B", "C", "D", "X"], { A: "A", B: "B", C: "C", D: "D", X: "X (مستبعد)" }),
        filter("status", "كل حالات المتابعة", [...STATUSES], STATUS_AR),
        h("label", { class: "sort-pick" }, h("span", { class: "muted small" }, "الترتيب"),
          select(SORTS, view.sort, (v) => { view.sort = v as SortKey; view.desc = v === "score" || v === "seniorityRank"; rerender(); }, { "aria-label": "الترتيب" })),
        h("button", { type: "button", class: extraActive || view.more ? "secondary small on" : "secondary small", "aria-expanded": String(view.more || extraActive), onclick: () => { view.more = !view.more; rerender(); } }, icon("filter"), "فلاتر أكثر"),
      ),
      view.more || extraActive ? h("div", { class: "toolbar more" },
        filter("mode", "كل أنواع التواصل", ["cold", "reconnect", "nudge"], MODE_AR),
        filter("fn", "كل التخصصات", FUNCTION_LABELS),
        filter("industry", "كل القطاعات", INDUSTRY_LABELS),
        tags.length > 0 ? filter("tag", "كل الوسوم", tags.map(([t]) => t), Object.fromEntries(tags.map(([t, n]) => [t, `${t} (${n})`]))) : null,
        hasAnalyses ? filter("stage", "كل مراحل المحادثة", STAGES, STAGE_LABEL) : null,
      ) : null,
      chipsHost,
    ),
    bulkHost,
    host,
    selected ? drawer(ctx, selected, rerender) : null,
    h("datalist", { id: "known-tags" }, tags.map(([t]) => h("option", { value: t }))),
  );
}

export function searchContacts(ctx: Ctx, q: string): void {
  showContacts(ctx, "", q);
}
