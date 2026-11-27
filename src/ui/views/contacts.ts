import { analyzeConversation, generateMessages, generateTemplate, templateKey } from "../../ai/features";
import { FUNCTION_LABELS, INDUSTRY_LABELS } from "../../core/classify";
import { isStale, STAGE_LABEL, STAGES, TONE_LABEL } from "../../core/conversation";
import { conversationIndex } from "../../core/conversations";
import { todayIso } from "../../core/dates";
import { newTracking } from "../../core/pipeline";
import { hasTag, normalizeTags, tagCounts } from "../../core/tags";
import { TEMPLATE_IDS, TEMPLATE_LABEL, TEMPLATES_WITH_JOB, TemplateBuilder, type TemplateId } from "../../core/templates";
import type { Contact, ConversationAnalysis, MessageSet, StoredMessage, Tracking } from "../../core/types";
import { CONTACT_EXPORT_COLUMNS } from "../../io/excel";
import { badge, card, exportLinks, MODE_AR, runAi, type Ctx } from "../context";
import { copyText, field, fmtNumber, h, replace, select, textArea, textInput } from "../dom";

const PAGE_SIZE = 50;
const STATUSES = ["Not started", "Note sent", "Message sent", "Follow-up sent", "Replied", "Meeting booked", "Referred", "Closed - no fit"];

type SortKey = "score" | "fullName" | "companyClean" | "seniorityRank" | "daysSinceContact";

const view = {
  q: "",
  bucket: "",
  mode: "",
  status: "",
  fn: "",
  industry: "",
  tag: "",
  stage: "",
  sort: "score" as SortKey,
  desc: true,
  page: 0,
  selected: "",
  variant: "rules" as "rules" | "ai",
  template: "referral" as TemplateId,
  templateRules: false,
  jobTitle: "",
  jobLink: "",
};

function matches(c: Contact, analyses: Record<string, ConversationAnalysis>): boolean {
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

function patchTracking(ctx: Ctx, c: Contact, patch: Partial<Tracking>, recompute = true): void {
  ctx.store.update((s) => {
    const next = { ...newTracking(), ...s.tracking[c.id], ...patch };
    s.tracking[c.id] = next;
    c.tracking = next;
  }, { recompute });
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
      h("button", { type: "button", class: "link", "aria-label": `شيل الوسم ${t}`, onclick: () => save(c.tracking.tags.filter((x) => x !== t)) }, "✕"))),
    input,
    h("button", { type: "button", class: "link", onclick: add }, "إضافة"),
  );
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

function conversationOf(ctx: Ctx, c: Contact): StoredMessage[] {
  return conversationIndex(ctx.store.state.dataset.messages).of(c);
}

function messageBlock(title: string, text: string, limit?: number): HTMLElement {
  const copy = h("button", { type: "button", class: "link" }, "نسخ");
  copy.addEventListener("click", () => void copyText(text).then((ok) => (copy.textContent = ok ? "انسخ ✓" : "ما زبط النسخ")));
  const over = limit !== undefined && text.length > limit;
  return h("div", { class: "msg" },
    h("div", { class: "msg-head" }, h("strong", {}, title), h("span", { class: over ? "count over" : "count" }, limit ? `${text.length}/${limit}` : `${text.length}`), copy),
    h("pre", { dir: /[؀-ۿ]/.test(text) ? "rtl" : "ltr" }, text),
  );
}

function templateCard(ctx: Ctx, c: Contact, rerender: () => void): HTMLElement {
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
  const job = TEMPLATES_WITH_JOB.has(id)
    ? h("div", { class: "form-grid" },
      field("الوظيفة (اختياري)", textInput(view.jobTitle, (v) => { view.jobTitle = v.trim(); rerender(); }, { placeholder: ctx.store.state.profile.me.target_roles[0] ?? "" })),
      field("رابط الوظيفة (اختياري)", textInput(view.jobLink, (v) => { view.jobLink = v.trim(); rerender(); }, { type: "url", dir: "ltr", placeholder: "https://" })),
    )
    : null;
  return card("قوالب حسب الهدف",
    h("div", { class: "row tight wrap" },
      select(TEMPLATE_IDS.map((t): [string, string] => [t, TEMPLATE_LABEL[t]]), id, (v) => { view.template = v as TemplateId; view.templateRules = false; rerender(); }),
      h("button", { type: "button", class: "secondary", onclick: () => void write() }, ai ? "إعادة كتابة بـ AI" : "اكتب بـ AI"),
      ai ? h("button", { type: "button", class: "link", onclick: () => { view.templateRules = !view.templateRules; rerender(); } }, showAi ? "نسخة القواعد" : "نسخة AI") : null,
    ),
    job,
    h("p", { class: "muted small" }, showAi && ai ? `مكتوبة بـ AI (${ai.model})` : "مكتوبة من القواعد، من بروفايلك وبروفايل الشخص"),
    messageBlock("عربي", text.ar, limit),
    messageBlock("English", text.en, limit),
  );
}

const STAGE_TONE: Record<string, string> = { opportunity: "good", waiting_me: "bad", gone_cold: "warn", closed: "" };

function analysisCard(ctx: Ctx, c: Contact, history: StoredMessage[]): HTMLElement {
  const result = ctx.store.state.ai.analyses[c.id];
  const run = async (): Promise<void> => {
    const out = await runAi(ctx, "تحليل المحادثة…", (cfg) => analyzeConversation(c, ctx.store.state.profile, history, cfg, todayIso()));
    if (!out) return;
    ctx.store.update((s) => (s.ai.analyses[c.id] = out), { recompute: false });
  };
  const limit = ctx.store.state.profile.messaging.message_char_limit;
  return card("تحليل المحادثة",
    h("div", { class: "row tight wrap" },
      h("button", { type: "button", class: "secondary", onclick: () => void run() }, result ? "حلّل من جديد" : "حلّل المحادثة بـ AI"),
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
      result.reply_ar ? messageBlock("رد مقترح - عربي", result.reply_ar, limit) : null,
      result.reply_en ? messageBlock("Suggested reply - English", result.reply_en, limit) : null,
    ) : h("p", { class: "muted small" }, `بيقرأ آخر ${Math.min(history.length, 20)} رسالة، وبيحكيلك وين وقفتوا وشو الخطوة الجاية، وبيقترح رد جاهز.`),
  );
}

function trackingForm(ctx: Ctx, c: Contact): HTMLElement {
  const set = (patch: Partial<Tracking>): void => patchTracking(ctx, c, patch);
  const date = h("input", { type: "date", value: c.tracking.dateSent });
  date.addEventListener("change", () => set({ dateSent: date.value }));
  const today = (): void => set({ dateSent: new Date().toISOString().slice(0, 10) });
  return h("div", { class: "form-grid" },
    field("الحالة", select(STATUSES.map((s) => [s, s]), c.tracking.status, (v) => set({ status: v, ...(v !== "Not started" && !c.tracking.dateSent ? { dateSent: new Date().toISOString().slice(0, 10) } : {}) }))),
    field("تاريخ الإرسال", h("div", { class: "row tight" }, date, h("button", { type: "button", class: "link", onclick: today }, "اليوم"))),
    field("رد؟", select([["", "—"], ["Yes", "Yes"], ["No", "No"], ["Pending", "Pending"]], c.tracking.replied, (v) => set({ replied: v }))),
    field("الخطوة الجاية", textInput(c.tracking.nextStep, (v) => set({ nextStep: v }))),
    field("الوسوم", tagEditor(ctx, c)),
    field("ملاحظات", textArea(c.tracking.notes, (v) => patchTracking(ctx, c, { notes: v }, false), { rows: 3 })),
  );
}

function drawer(ctx: Ctx, c: Contact, rerender: () => void): HTMLElement {
  const limits = ctx.store.state.profile.messaging;
  const variant = view.variant === "ai" && c.ai ? "ai" : "rules";
  const set: MessageSet = variant === "ai" && c.ai ? c.ai : c;

  const generate = async (): Promise<void> => {
    const result = await runAi(ctx, "كتابة رسائل بالذكاء الاصطناعي…", (cfg) => generateMessages(c, ctx.store.state.profile, conversationOf(ctx, c), cfg));
    if (!result) return;
    view.variant = "ai";
    ctx.store.update((s) => (s.ai.messages[c.id] = result));
  };

  const close = (): void => {
    view.selected = "";
    rerender();
  };

  const history = conversationOf(ctx, c);
  const conversation = history.slice(-5);
  return h("aside", { class: "drawer", "aria-label": c.fullName },
    h("div", { class: "drawer-head" },
      h("div", {}, h("h2", {}, c.fullName), h("p", { class: "muted" }, [c.positionPrimary || c.positionClean, c.companyClean].filter(Boolean).join(" · "))),
      h("button", { type: "button", class: "link", onclick: close, "aria-label": "إغلاق" }, "✕"),
    ),
    h("div", { class: "row wrap" },
      badge(`${c.bucket} · ${c.score}`, `bucket-${c.bucket}`),
      badge(MODE_AR[c.mode] ?? c.mode),
      badge(c.archetypeLabel),
      c.profileUrl.startsWith("https://www.linkedin.com/") ? h("a", { href: c.profileUrl, target: "_blank", rel: "noopener noreferrer" }, "فتح البروفايل") : null,
    ),
    h("p", { class: "advice" }, c.outreachAdvice),
    h("details", {},
      h("summary", {}, "التفاصيل والنقاط"),
      h("dl", { class: "facts" },
        ...([
          ["Seniority", c.seniority], ["Function", c.function], ["Industry", c.industry], ["Email", c.email || "—"],
          ["Connected", c.connectedDate ?? "—"], ["Msgs sent / received", `${c.history.sentByMe} / ${c.history.received}`],
          ["Last contact", c.history.lastContact ?? "—"], ["Score breakdown", c.scoreBreakdown], ["Evidence", c.evidence],
        ] as Array<[string, string]>).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]),
      ),
    ),
    conversation.length > 0 ? h("details", {},
      h("summary", {}, `آخر الرسائل (${conversation.length})`),
      h("ul", { class: "thread" }, conversation.map((m) => h("li", { class: m.outgoing ? "out" : "in" }, h("small", {}, m.at.slice(0, 10)), " ", m.content || "—"))),
    ) : null,
    history.length > 0 ? analysisCard(ctx, c, history) : null,
    h("div", { class: "tabs small" },
      h("button", { type: "button", class: variant === "rules" ? "active" : "", onclick: () => { view.variant = "rules"; rerender(); } }, "رسائل القواعد"),
      h("button", { type: "button", class: variant === "ai" ? "active" : "", disabled: !c.ai, onclick: () => { view.variant = "ai"; rerender(); } }, "رسائل AI"),
      h("button", { type: "button", class: "secondary", onclick: () => void generate() }, c.ai ? "إعادة كتابة بـ AI" : "اكتب بـ AI"),
    ),
    messageBlock("نوت قصيرة - عربي", set.note_ar, limits.note_char_limit),
    messageBlock("Short note - English", set.note_en, limits.note_char_limit),
    messageBlock("رسالة كاملة - عربي", set.message_ar, limits.message_char_limit),
    messageBlock("Full message - English", set.message_en, limits.message_char_limit),
    messageBlock("متابعة - عربي", set.followup_ar),
    messageBlock("Follow-up - English", set.followup_en),
    templateCard(ctx, c, rerender),
    card("المتابعة", trackingForm(ctx, c)),
  );
}

function header(label: string, key: SortKey | null, rerender: () => void): HTMLElement {
  if (!key) return h("th", {}, label);
  const active = view.sort === key;
  const button = h("button", { type: "button", class: "sort" }, label, active ? (view.desc ? " ▼" : " ▲") : "");
  button.addEventListener("click", () => {
    if (active) view.desc = !view.desc;
    else {
      view.sort = key;
      view.desc = key === "score" || key === "seniorityRank";
    }
    rerender();
  });
  return h("th", { "aria-sort": active ? (view.desc ? "descending" : "ascending") : "none" }, button);
}

export function openContact(ctx: Ctx, id: string): void {
  view.selected = id;
  view.q = "";
  view.page = 0;
  ctx.go("contacts");
}

export function renderContacts(ctx: Ctx, rerender: () => void): HTMLElement {
  if (!ctx.store.hasData) {
    return h("div", { class: "view" }, card("ما في بيانات لسا", h("p", {}, "ارفع ملف الـ Export أو اعمل مزامنة من صفحة البيانات."), h("button", { type: "button", onclick: () => ctx.go("data") }, "روح لصفحة البيانات")));
  }
  const all = ctx.store.analysis.contacts;
  const tags = tagCounts(all);
  const tableHost = h("div", { class: "table-host" });

  const drawTable = (): void => {
    const analyses = ctx.store.state.ai.analyses;
    const list = sorted(all.filter((c) => matches(c, analyses)));
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    view.page = Math.min(view.page, pages - 1);
    const rows = list.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);
    const pager = h("div", { class: "pager" },
      h("button", { type: "button", class: "secondary", disabled: view.page === 0, onclick: () => { view.page -= 1; drawTable(); } }, "السابق"),
      h("span", {}, `${fmtNumber(list.length)} شخص · صفحة ${view.page + 1} من ${pages}`),
      h("button", { type: "button", class: "secondary", disabled: view.page >= pages - 1, onclick: () => { view.page += 1; drawTable(); } }, "التالي"),
      exportLinks(ctx, "contacts", CONTACT_EXPORT_COLUMNS, () => list),
      bulkTag(list),
    );
    replace(tableHost,
      h("div", { class: "scroll" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {},
          header("#", null, rerender), header("الفئة", null, rerender), header("النقاط", "score", rerender), header("الاسم", "fullName", rerender),
          header("المنصب", null, rerender), header("الشركة", "companyClean", rerender), header("المستوى", "seniorityRank", rerender),
          header("التخصص", null, rerender), header("الوضع", null, rerender), header("آخر تواصل (أيام)", "daysSinceContact", rerender), header("المتابعة", null, rerender),
        )),
        h("tbody", {}, rows.map((c) => {
          const tr = h("tr", { class: c.id === view.selected ? "selected" : "", tabindex: 0 },
            h("td", {}, c.idx),
            h("td", {}, badge(c.bucket, `bucket-${c.bucket}`)),
            h("td", {}, c.score),
            h("td", {}, c.fullName, c.ai ? h("span", { class: "ai-dot", title: "AI" }, " ✦") : null,
              c.tracking.tags.length > 0 ? h("div", { class: "chips" }, c.tracking.tags.map((t) => h("span", { class: "chip small" }, t))) : null),
            h("td", { class: "clip" }, c.positionPrimary || c.positionClean),
            h("td", { class: "clip" }, c.companyClean),
            h("td", {}, c.seniority),
            h("td", {}, c.function),
            h("td", {}, badge(MODE_AR[c.mode] ?? c.mode, `mode-${c.mode}`)),
            h("td", {}, c.daysSinceContact ?? "—"),
            h("td", {}, c.tracking.status),
          );
          const open = (): void => {
            view.selected = c.id;
            rerender();
          };
          tr.addEventListener("click", open);
          tr.addEventListener("keydown", (e) => e.key === "Enter" && open());
          return tr;
        })),
      )),
      pager,
    );
  };

  const bulkTag = (list: Contact[]): HTMLElement => {
    const input = h("input", { type: "text", list: "known-tags", placeholder: "وسم", "aria-label": "وسم لكل النتيجة", class: "short" });
    const apply = (): void => {
      const values = input.value.split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length === 0 || list.length === 0) return;
      if (!window.confirm(`إضافة "${values.join(", ")}" لـ ${fmtNumber(list.length)} شخص؟`)) return;
      ctx.store.update((s) => {
        for (const c of list) {
          const next = { ...newTracking(), ...s.tracking[c.id] };
          next.tags = normalizeTags([...next.tags, ...values]);
          s.tracking[c.id] = next;
          c.tracking = next;
        }
      }, { recompute: false });
      ctx.toast(`انضاف الوسم لـ ${fmtNumber(list.length)} شخص`);
    };
    return h("span", { class: "row tight" }, input, h("button", { type: "button", class: "link", onclick: apply }, "وسم النتيجة"));
  };

  const search = h("input", { type: "search", placeholder: "بحث بالاسم أو الشركة أو المنصب أو الملاحظات أو الوسوم", value: view.q });
  search.addEventListener("input", () => {
    view.q = search.value.trim();
    view.page = 0;
    drawTable();
  });
  const filter = (label: string, options: string[], key: "bucket" | "mode" | "status" | "fn" | "industry" | "tag" | "stage", names?: Record<string, string>): HTMLElement =>
    select([["", label], ...options.map((o): [string, string] => [o, names?.[o] ?? o])], view[key], (v) => {
      view[key] = v;
      view.page = 0;
      drawTable();
    });

  drawTable();
  const selected = view.selected ? all.find((c) => c.id === view.selected) : undefined;
  return h("div", { class: selected ? "view with-drawer" : "view" },
    h("div", { class: "main-col" },
      h("div", { class: "toolbar" },
        search,
        filter("كل الفئات", ["A", "B", "C", "D", "X"], "bucket"),
        filter("كل الأوضاع", ["cold", "reconnect", "nudge"], "mode", MODE_AR),
        filter("كل حالات المتابعة", STATUSES, "status"),
        filter("كل التخصصات", FUNCTION_LABELS, "fn"),
        filter("كل القطاعات", INDUSTRY_LABELS, "industry"),
        Object.keys(ctx.store.state.ai.analyses).length > 0 ? filter("كل المحادثات (AI)", STAGES, "stage", STAGE_LABEL) : null,
        tags.length > 0 ? filter("كل الوسوم", tags.map(([t]) => t), "tag", Object.fromEntries(tags.map(([t, n]) => [t, `${t} (${n})`]))) : null,
      ),
      tableHost,
    ),
    selected ? drawer(ctx, selected, rerender) : null,
    h("datalist", { id: "known-tags" }, tags.map(([t]) => h("option", { value: t }))),
  );
}
