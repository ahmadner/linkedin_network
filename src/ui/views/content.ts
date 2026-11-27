import { analyzeContent, planContent, planDates, rewritePost, suggestIdeas, weekdayIndex, type PlanItem } from "../../ai/content";
import {
  contentStats, draftTitle, DRAFT_STATUSES, FORMAT_LABEL, hasArabic, IMAGE_MODELS, LANG_LABEL, newDraft, newId, normalizeHashtag, STATUS_LABEL, WEEKDAYS_AR,
  type ContentIdea, type ContentLang, type Draft, type DraftStatus, type Post, type PostMetrics,
} from "../../core/content";
import { barFill, columnChart } from "../charts";
import { ago, badge, card, emptyState, kpi, runAi, type Ctx } from "../context";
import { field, fmtNumber, h, numberInput, select, textArea, textInput } from "../dom";
import { icon } from "../icons";
import { addDraft, findDraft, imageThumb, renderEditor } from "./editor";

type Tab = "overview" | "board" | "calendar" | "posts" | "settings";

const TABS: Array<[Tab, string]> = [
  ["overview", "نظرة عامة"],
  ["board", "الأفكار والمسودات"],
  ["calendar", "التقويم"],
  ["posts", "منشوراتي"],
  ["settings", "إعدادات المحتوى"],
];

interface ContentUi {
  tab: Tab;
  draftId: string;
  search: string;
  pillar: string;
  month: string;
  postSearch: string;
  postSort: "new" | "top";
  postLimit: number;
  focus: string;
  extraIdeas: ContentIdea[];
  plan: PlanItem[];
  planPicked: Set<string>;
  planWeeks: number;
  planFrom: string;
}

const ui: ContentUi = {
  tab: "overview",
  draftId: "",
  search: "",
  pillar: "",
  month: "",
  postSearch: "",
  postSort: "new",
  postLimit: 20,
  focus: "",
  extraIdeas: [],
  plan: [],
  planPicked: new Set(),
  planWeeks: 2,
  planFrom: "",
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function openDraft(ctx: Ctx, id: string): void {
  ui.draftId = id;
  ctx.store.emit();
  window.scrollTo({ top: 0 });
}

function closeDraft(ctx: Ctx): void {
  ui.draftId = "";
  ctx.store.emit();
}

function createDraft(ctx: Ctx, patch: Partial<Draft> = {}): void {
  const draft = addDraft(ctx, newDraft(patch, patch.lang ?? ctx.store.state.content.settings.defaultLang));
  openDraft(ctx, draft.id);
}

function ideaDraft(idea: ContentIdea, extra: Partial<Draft> = {}): Draft {
  return newDraft({ title: idea.title, text: idea.hook, pillar: idea.pillar, format: idea.format, lang: idea.lang, status: "idea", notes: idea.why, ...extra });
}

function savedTitles(ctx: Ctx): Set<string> {
  return new Set(ctx.store.state.content.drafts.map((d) => d.title.trim().toLowerCase()));
}

function ideaRow(ctx: Ctx, idea: ContentIdea, saved: Set<string>): HTMLElement {
  const isSaved = saved.has(idea.title.trim().toLowerCase());
  const save = (): void => {
    addDraft(ctx, ideaDraft(idea));
    ctx.store.emit();
    ctx.toast("انحفظت بالأفكار");
  };
  return h("li", { class: "idea" },
    h("div", { class: "idea-text" },
      h("strong", { dir: "auto" }, idea.title),
      idea.hook ? h("p", { class: "idea-hook", dir: "auto" }, `"${idea.hook}"`) : null,
      h("div", { class: "chips" }, badge(FORMAT_LABEL[idea.format]), badge(LANG_LABEL[idea.lang]), idea.pillar ? badge(idea.pillar) : null),
      idea.why ? h("p", { class: "muted small" }, idea.why) : null,
    ),
    h("div", { class: "idea-actions" },
      h("button", { type: "button", class: "small", onclick: () => openDraft(ctx, addDraft(ctx, ideaDraft(idea)).id) }, icon("pen"), "اكتبه هلأ"),
      isSaved ? badge("محفوظة", "good") : h("button", { type: "button", class: "secondary small", onclick: save }, icon("plus"), "احفظ"),
    ),
  );
}

function strategyCard(ctx: Ctx): HTMLElement {
  const s = ctx.store.state;
  const strategy = s.content.strategy;
  const analyze = async (): Promise<void> => {
    const result = await runAi(ctx, `تحليل ${fmtNumber(s.content.posts.length)} منشور وملفك…`, (cfg) => analyzeContent(s.profile, s.content.posts, s.content.settings, cfg));
    if (!result) return;
    ctx.store.update((st) => {
      st.content.strategy = result;
      if (st.content.settings.pillars.length === 0) st.content.settings.pillars = result.pillars.map((p) => p.name);
    }, { recompute: false });
    ctx.toast("التحليل جاهز");
  };
  const button = h("button", { type: "button", class: strategy ? "secondary small" : "", onclick: () => void analyze() }, icon("spark"), strategy ? "حلّل من جديد" : "حلّل محتواي واقترح منشورات");
  if (!strategy) {
    return h("section", { class: "card strategy empty-strategy" },
      h("h2", { class: "with-icon" }, icon("spark"), "استراتيجية المحتوى بالذكاء الاصطناعي"),
      h("p", { class: "muted" }, s.content.posts.length > 0
        ? `الذكاء الاصطناعي رح يقرأ ${fmtNumber(Math.min(60, s.content.posts.length))} من منشوراتك مع ملفك وأهدافك، ويطلعلك: شو بينجح، شو ناقص، محاور المحتوى، أفضل أيام، و10 أفكار جاهزة.`
        : "ما في منشورات قديمة لسا، بس الذكاء الاصطناعي بيقدر يبني استراتيجية من ملفك وأهدافك. للأفضل ارفع Shares.csv من الـ Export."),
      button,
    );
  }
  const saved = savedTitles(ctx);
  const list = (title: string, items: string[], cls: string): HTMLElement | null => items.length ? h("div", { class: `insight ${cls}` }, h("h3", {}, title), h("ul", {}, items.map((x) => h("li", {}, x)))) : null;
  return h("section", { class: "card strategy" },
    h("div", { class: "card-head" },
      h("h2", { class: "with-icon" }, icon("spark"), "استراتيجية المحتوى"),
      h("div", { class: "row tight" }, h("span", { class: "muted small" }, `${strategy.generatedAt.slice(0, 10)} · ${fmtNumber(strategy.postsAnalyzed)} منشور`), button),
    ),
    h("p", {}, strategy.summary),
    h("div", { class: "insights" },
      strategy.voice ? h("div", { class: "insight" }, h("h3", {}, "صوتك"), h("p", {}, strategy.voice)) : null,
      strategy.audience ? h("div", { class: "insight" }, h("h3", {}, "جمهورك"), h("p", {}, strategy.audience)) : null,
      list("شو بينجح", strategy.works, "good"),
      list("شو تحسّن", strategy.improve, "warn"),
      strategy.cadence || strategy.bestDays.length ? h("div", { class: "insight" }, h("h3", {}, "الإيقاع"), h("p", {}, strategy.cadence), strategy.bestDays.length ? h("div", { class: "chips" }, strategy.bestDays.map((d) => badge(d))) : null) : null,
    ),
    strategy.pillars.length ? h("div", {}, h("h3", {}, "محاور المحتوى"), h("ul", { class: "bars" }, strategy.pillars.map((p) =>
      h("li", { title: p.description }, h("span", { class: "bar-label", dir: "auto" }, p.name), h("span", { class: "bar-track" }, barFill(p.share / 100)), h("span", { class: "bar-value" }, `${p.share}%`))))) : null,
    strategy.ideas.length ? h("div", {}, h("h3", {}, "أفكار مقترحة"), h("ul", { class: "ideas" }, strategy.ideas.map((i) => ideaRow(ctx, i, saved)))) : null,
  );
}

function moreIdeasCard(ctx: Ctx): HTMLElement {
  const s = ctx.store.state;
  const focus = textInput(ui.focus, (v) => (ui.focus = v), { placeholder: "اختياري: ركّز على… (مثال: Spring Boot، قصص من الشغل، نصايح للمبتدئين)" });
  const more = async (): Promise<void> => {
    ui.focus = focus.value.trim();
    const existing = [...s.content.drafts.map((d) => draftTitle(d)), ...(s.content.strategy?.ideas.map((i) => i.title) ?? []), ...ui.extraIdeas.map((i) => i.title)];
    const result = await runAi(ctx, "تجهيز أفكار جديدة…", (cfg) => suggestIdeas(s.profile, s.content.posts, s.content.strategy, s.content.settings, existing, ui.focus, 8, cfg));
    if (!result) return;
    ui.extraIdeas = [...result, ...ui.extraIdeas].slice(0, 40);
    ctx.store.emit();
  };
  const saved = savedTitles(ctx);
  return h("section", { class: "card" },
    h("h2", { class: "with-icon" }, icon("target"), "بدك أفكار أكثر؟"),
    h("div", { class: "toolbar" }, focus, h("button", { type: "button", onclick: () => void more() }, icon("spark"), "اقترح 8 أفكار")),
    ui.extraIdeas.length ? h("ul", { class: "ideas" }, ui.extraIdeas.map((i) => ideaRow(ctx, i, saved))) : null,
  );
}

function weekdayBars(counts: number[]): HTMLElement {
  const max = Math.max(1, ...counts);
  return h("ul", { class: "bars" }, WEEKDAYS_AR.map((d, i) => h("li", {}, h("span", { class: "bar-label" }, d), h("span", { class: "bar-track" }, barFill((counts[i] ?? 0) / max)), h("span", { class: "bar-value" }, fmtNumber(counts[i] ?? 0)))));
}

function renderOverview(ctx: Ctx): HTMLElement {
  const content = ctx.store.state.content;
  const stats = contentStats(content.posts);
  const drafts = content.drafts;
  const count = (st: DraftStatus): number => drafts.filter((d) => d.status === st).length;
  const today = todayIso();
  const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = drafts.filter((d) => d.scheduledFor >= today && d.scheduledFor <= week && d.status !== "published").length;
  const target = content.settings.postsPerWeek;
  const intro = content.posts.length === 0 && drafts.length === 0
    ? emptyState("خلّينا نبلش بالمحتوى", "ارفع ملف الـ Export وفيه Shares.csv عشان أقرأ منشوراتك القديمة، أو ابدأ على طول: حلّل ملفك بالذكاء الاصطناعي أو اكتب أول منشور.", ["روح لصفحة البيانات", () => ctx.go("data")])
    : null;
  const months = stats.byMonth.slice(-12);
  return h("div", { class: "view" },
    intro,
    h("div", { class: "kpis" },
      kpi("منشوراتك", fmtNumber(stats.total), stats.total ? `معدل الطول ${fmtNumber(stats.avgLength)} حرف` : "ارفع Shares.csv", () => switchTab(ctx, "posts")),
      kpi("آخر 90 يوم", fmtNumber(stats.last90), `${stats.perWeek90} بالأسبوع · هدفك ${target}`, undefined, stats.total > 0 && stats.perWeek90 < target ? "hot" : ""),
      kpi("آخر منشور", ago(stats.daysSinceLast), stats.daysSinceLast !== null && stats.daysSinceLast > 14 ? "صار وقت منشور جديد" : "استمر"),
      kpi("أفكار", fmtNumber(count("idea")), "ببنك الأفكار", () => switchTab(ctx, "board")),
      kpi("مسودات وجاهزة", fmtNumber(count("draft") + count("ready")), `${fmtNumber(count("ready"))} جاهزة للنشر`, () => switchTab(ctx, "board")),
      kpi("هالأسبوع", fmtNumber(upcoming), "مجدولة لـ 7 أيام الجاية", () => switchTab(ctx, "calendar")),
    ),
    strategyCard(ctx),
    stats.total > 0 ? h("div", { class: "cards-grid" },
      card("النشر بالشهر", columnChart("منشورات بالشهر", [{ name: "منشورات", className: "s1" }], months.map((m) => ({ label: m.month.slice(2).replace("-", "/"), values: [m.count] })))),
      card("أيام النشر", weekdayBars(stats.byWeekday)),
      card("لغة ومحتوى",
        h("dl", { class: "facts" },
          h("dt", {}, "بالعربي"), h("dd", {}, `${stats.arabicShare}%`),
          h("dt", {}, "فيها صورة أو ميديا"), h("dd", {}, `${stats.mediaShare}%`),
          h("dt", {}, "أكثر هاشتاغات"), h("dd", {}, stats.topHashtags.length ? h("div", { class: "chips" }, stats.topHashtags.slice(0, 10).map(([t, n]) => h("span", { class: "chip small", dir: "auto" }, `${t} · ${n}`))) : "ما في"),
        ),
      ),
    ) : null,
    stats.topPosts.length ? card("أعلى منشورات تفاعلًا", h("ul", { class: "post-list compact" }, stats.topPosts.map((p) => postRow(ctx, p, true)))) : null,
    moreIdeasCard(ctx),
  );
}

function draftCard(ctx: Ctx, d: Draft): HTMLElement {
  const snippet = d.text.replace(/\s+/g, " ").trim();
  return h("li", {},
    h("button", { type: "button", class: "draft-card", onclick: () => openDraft(ctx, d.id) },
      d.imageId ? imageThumb(d.imageId, "thumb") : null,
      h("span", { class: "draft-text" },
        h("strong", { dir: "auto" }, draftTitle(d)),
        snippet && snippet !== d.title ? h("span", { class: "muted small clamp", dir: "auto" }, snippet.slice(0, 160)) : null,
        h("span", { class: "chips" },
          badge(FORMAT_LABEL[d.format]),
          badge(LANG_LABEL[d.lang]),
          d.pillar ? badge(d.pillar) : null,
          d.scheduledFor ? badge(`📅 ${d.scheduledFor}`, d.scheduledFor < todayIso() && d.status !== "published" ? "bad" : "") : null,
        ),
      ),
    ),
  );
}

function quickIdea(ctx: Ctx): HTMLElement {
  const input = h("input", { type: "text", placeholder: "فكرة سريعة ثم Enter", "aria-label": "فكرة جديدة", dir: "auto" });
  const add = (): void => {
    const title = input.value.trim();
    if (!title) return;
    addDraft(ctx, newDraft({ title, status: "idea" }, ctx.store.state.content.settings.defaultLang));
    ctx.store.emit();
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".quick-idea input")?.focus());
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add();
  });
  return h("div", { class: "quick-idea" }, input, h("button", { type: "button", class: "icon-btn", "aria-label": "أضف الفكرة", onclick: add }, icon("plus")));
}

function renderBoard(ctx: Ctx): HTMLElement {
  const content = ctx.store.state.content;
  const q = ui.search.trim().toLowerCase();
  const pillars = [...new Set(content.drafts.map((d) => d.pillar).filter(Boolean))];
  const visible = content.drafts.filter((d) => (!ui.pillar || d.pillar === ui.pillar) && (!q || `${d.title} ${d.text} ${d.pillar}`.toLowerCase().includes(q)));
  const search = h("input", { type: "search", value: ui.search, placeholder: "دوّر بالمسودات", "aria-label": "دوّر بالمسودات" });
  search.addEventListener("input", () => {
    ui.search = search.value;
    ctx.store.emit();
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(".board-tools input[type=search]");
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  });
  const order = (a: Draft, b: Draft): number => (a.scheduledFor || "9999").localeCompare(b.scheduledFor || "9999") || b.updatedAt.localeCompare(a.updatedAt);
  return h("div", { class: "view" },
    h("div", { class: "toolbar board-tools" },
      h("div", { class: "search-box" }, icon("search"), search),
      pillars.length ? select([["", "كل المحاور"], ...pillars.map((p): [string, string] => [p, p])], ui.pillar, (v) => { ui.pillar = v; ctx.store.emit(); }, { "aria-label": "المحور" }) : null,
    ),
    h("div", { class: "board" }, DRAFT_STATUSES.map((st) => {
      const items = visible.filter((d) => d.status === st).sort(order);
      return h("section", { class: `column col-${st}` },
        h("div", { class: "column-head" }, h("h2", {}, STATUS_LABEL[st]), h("span", { class: "count-pill" }, fmtNumber(items.length))),
        st === "idea" ? quickIdea(ctx) : null,
        items.length === 0 ? h("p", { class: "muted small column-empty" }, st === "idea" ? "اكتب فكرة أو خذ من اقتراحات الذكاء الاصطناعي." : "فاضي") : h("ul", { class: "draft-cards" }, items.slice(0, st === "published" ? 30 : 200).map((d) => draftCard(ctx, d))),
      );
    })),
  );
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return monthKey(new Date(y, m - 1 + delta, 1));
}

const MONTHS_AR = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

function planCard(ctx: Ctx): HTMLElement {
  const s = ctx.store.state;
  const settings = s.content.settings;
  const from = h("input", { type: "date", value: ui.planFrom || todayIso(), "aria-label": "من تاريخ" });
  const weeks = select([["1", "أسبوع"], ["2", "أسبوعين"], ["4", "شهر"]], String(ui.planWeeks), (v) => (ui.planWeeks = Number(v)));
  const make = async (): Promise<void> => {
    ui.planFrom = from.value || todayIso();
    const best = (s.content.strategy?.bestDays ?? []).map(weekdayIndex).filter((i) => i >= 0);
    const dates = planDates(new Date(`${ui.planFrom}T12:00:00`), ui.planWeeks, settings.postsPerWeek, best);
    const taken = new Set(s.content.drafts.map((d) => d.scheduledFor).filter(Boolean));
    const free = dates.filter((d) => !taken.has(d));
    if (free.length === 0) return ctx.toast("كل الأيام بهالفترة فيها منشورات مجدولة.", "error");
    const existing = [...s.content.drafts.map((d) => draftTitle(d)), ...(s.content.strategy?.ideas.map((i) => i.title) ?? [])];
    const result = await runAi(ctx, `تجهيز خطة ${fmtNumber(free.length)} منشور…`, (cfg) => planContent(free, s.profile, s.content.posts, s.content.strategy, settings, existing, cfg));
    if (!result) return;
    ui.plan = result;
    ui.planPicked = new Set(result.map((r) => r.date));
    ctx.store.emit();
  };
  const accept = (): void => {
    const picked = ui.plan.filter((p) => ui.planPicked.has(p.date));
    if (picked.length === 0) return;
    ctx.store.update((st) => {
      st.content.drafts = [...picked.map((p) => ideaDraft(p.idea, { scheduledFor: p.date })), ...st.content.drafts];
    }, { recompute: false });
    ctx.toast(`انضاف ${fmtNumber(picked.length)} منشور للتقويم كأفكار. افتح أي وحدة واكتبها.`);
    ui.plan = [];
    ui.planPicked = new Set();
    ctx.store.emit();
  };
  return h("section", { class: "card" },
    h("h2", { class: "with-icon" }, icon("spark"), "خطة نشر بالذكاء الاصطناعي"),
    h("p", { class: "muted small" }, `بيوزّع ${settings.postsPerWeek} منشور بالأسبوع على أفضل الأيام، بيوازن بين المحاور، وما بيكرر منشوراتك القديمة. بتقدر تغيّر العدد من إعدادات المحتوى.`),
    h("div", { class: "toolbar" }, field("من", from), field("المدة", weeks), h("button", { type: "button", onclick: () => void make() }, icon("calendar"), "اعمل الخطة")),
    ui.plan.length ? h("div", {},
      h("ul", { class: "plan" }, ui.plan.map((p) => {
        const box = h("input", { type: "checkbox", checked: ui.planPicked.has(p.date), "aria-label": `اختار ${p.idea.title}` });
        box.addEventListener("change", () => (box.checked ? ui.planPicked.add(p.date) : ui.planPicked.delete(p.date)));
        return h("li", {}, h("label", { class: "check plan-item" }, box,
          h("span", { class: "plan-date" }, `${WEEKDAYS_AR[new Date(`${p.date}T00:00:00Z`).getUTCDay()]} ${p.date.slice(5)}`),
          h("span", { class: "plan-text" }, h("strong", { dir: "auto" }, p.idea.title), h("span", { class: "muted small", dir: "auto" }, p.idea.hook), h("span", { class: "chips" }, badge(FORMAT_LABEL[p.idea.format]), badge(LANG_LABEL[p.idea.lang]), p.idea.pillar ? badge(p.idea.pillar) : null)),
        ));
      })),
      h("div", { class: "row" }, h("button", { type: "button", onclick: accept }, icon("plus"), "أضف المختار للتقويم"), h("button", { type: "button", class: "secondary", onclick: () => { ui.plan = []; ctx.store.emit(); } }, "إلغاء")),
    ) : null,
  );
}

function renderCalendar(ctx: Ctx): HTMLElement {
  const content = ctx.store.state.content;
  ui.month ||= monthKey(new Date());
  const [y, m] = ui.month.split("-").map(Number) as [number, number];
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const today = todayIso();
  const byDay = new Map<string, Draft[]>();
  for (const d of content.drafts) {
    const day = d.status === "published" && d.publishedAt ? d.publishedAt.slice(0, 10) : d.scheduledFor;
    if (day.startsWith(ui.month)) byDay.set(day, [...(byDay.get(day) ?? []), d]);
  }
  const published = new Map<string, Post[]>();
  for (const p of content.posts) if (!p.id.startsWith("m-") && p.at.startsWith(ui.month)) published.set(p.at.slice(0, 10), [...(published.get(p.at.slice(0, 10)) ?? []), p]);
  const cells: HTMLElement[] = [];
  for (let i = 0; i < first.getDay(); i += 1) cells.push(h("div", { class: "day blank", "aria-hidden": "true" }));
  for (let day = 1; day <= days; day += 1) {
    const key = `${ui.month}-${String(day).padStart(2, "0")}`;
    const drafts = byDay.get(key) ?? [];
    const posts = published.get(key) ?? [];
    cells.push(h("div", { class: key === today ? "day today" : key < today ? "day past" : "day" },
      h("div", { class: "day-head" },
        h("span", { class: "day-num" }, String(day)),
        key >= today ? h("button", { type: "button", class: "icon-btn day-add", "aria-label": `منشور جديد بتاريخ ${key}`, onclick: () => createDraft(ctx, { scheduledFor: key }) }, icon("plus")) : null,
      ),
      drafts.map((d) => h("button", { type: "button", class: `cal-item st-${d.status}`, title: draftTitle(d), onclick: () => openDraft(ctx, d.id) }, draftTitle(d))),
      posts.map((p) => h("button", { type: "button", class: "cal-item st-published", title: p.text.slice(0, 200), onclick: () => { ui.postSearch = p.text.slice(0, 40); switchTab(ctx, "posts"); } }, p.text.slice(0, 40) || "منشور")),
    ));
  }
  const unscheduled = content.drafts.filter((d) => !d.scheduledFor && (d.status === "ready" || d.status === "draft")).length;
  return h("div", { class: "view" },
    h("section", { class: "card" },
      h("div", { class: "card-head" },
        h("h2", {}, `${MONTHS_AR[m - 1]} ${y}`),
        h("div", { class: "row tight" },
          h("button", { type: "button", class: "secondary small", onclick: () => { ui.month = shiftMonth(ui.month, -1); ctx.store.emit(); } }, "→ الشهر الماضي"),
          h("button", { type: "button", class: "secondary small", onclick: () => { ui.month = monthKey(new Date()); ctx.store.emit(); } }, "اليوم"),
          h("button", { type: "button", class: "secondary small", onclick: () => { ui.month = shiftMonth(ui.month, 1); ctx.store.emit(); } }, "الشهر الجاي ←"),
        ),
      ),
      h("div", { class: "legend cal-legend" }, (["idea", "draft", "ready", "scheduled", "published"] as DraftStatus[]).map((st) => h("span", {}, h("i", { class: `swatch st-${st}` }), STATUS_LABEL[st]))),
      h("div", { class: "calendar", role: "grid" },
        WEEKDAYS_AR.map((d) => h("div", { class: "weekday" }, d)),
        cells,
      ),
      unscheduled ? h("p", { class: "muted small" }, `عندك ${fmtNumber(unscheduled)} مسودة بدون موعد. حطلها تاريخ من المحرر.`) : null,
    ),
    planCard(ctx),
  );
}

function metricsEditor(ctx: Ctx, p: Post): HTMLElement {
  const m: PostMetrics = p.metrics ?? { impressions: 0, reactions: 0, comments: 0, reposts: 0 };
  const set = (key: keyof PostMetrics, value: number): void => ctx.store.update((s) => {
    s.content.posts = s.content.posts.map((x) => (x.id === p.id ? { ...x, metrics: { ...m, [key]: Math.max(0, Math.round(value)) } } : x));
  }, { recompute: false, emit: false });
  const input = (key: keyof PostMetrics, label: string): HTMLElement => field(label, numberInput(m[key], (v) => set(key, v), { min: 0, inputmode: "numeric", class: "short" }));
  return h("details", { class: "metrics" },
    h("summary", {}, p.metrics ? `👁 ${fmtNumber(m.impressions)} · 👍 ${fmtNumber(m.reactions)} · 💬 ${fmtNumber(m.comments)} · 🔁 ${fmtNumber(m.reposts)}` : "أضف أرقام التفاعل"),
    h("div", { class: "form-grid narrow" }, input("impressions", "المشاهدات"), input("reactions", "التفاعلات"), input("comments", "التعليقات"), input("reposts", "إعادة النشر")),
    h("p", { class: "hint" }, "الأرقام من صفحة الـ Analytics تحت المنشور على LinkedIn. بتساعد الذكاء الاصطناعي يعرف شو بينجح."),
  );
}

function postRow(ctx: Ctx, p: Post, compact = false): HTMLElement {
  const s = ctx.store.state;
  const lang: ContentLang = hasArabic(p.text) ? "ar" : "en";
  const asDraft = (): void => createDraft(ctx, { title: `من منشور ${p.at.slice(0, 10)}`, text: p.text, lang, status: "draft" });
  const repurpose = async (): Promise<void> => {
    const result = await runAi(ctx, "كتابة منشور جديد من القديم…", (cfg) => rewritePost("repurpose", p.text, lang, s.profile, s.content.settings, s.content.strategy, cfg));
    if (result) createDraft(ctx, { title: `إعادة لـ ${p.at.slice(0, 10)}`, text: result.text, hashtags: result.hashtags, lang, status: "draft", notes: result.note });
  };
  const remove = (): void => {
    if (!window.confirm("أكيد بدك تشيل هالمنشور من القائمة؟")) return;
    ctx.store.update((st) => (st.content.posts = st.content.posts.filter((x) => x.id !== p.id)), { recompute: false });
  };
  return h("li", { class: "post" },
    h("div", { class: "post-head" },
      h("span", { class: "muted small" }, p.at.slice(0, 10)),
      badge(p.origin === "export" ? "من الـ Export" : "يدوي", "muted-badge"),
      p.media ? badge("ميديا") : null,
      p.sharedUrl ? badge("رابط") : null,
      p.url ? h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", class: "small" }, "افتح على LinkedIn") : null,
    ),
    h("details", { class: "post-body" }, h("summary", { dir: "auto" }, p.text.split("\n")[0]?.slice(0, 180) || "(بدون نص)"), h("pre", { dir: "auto" }, p.text)),
    compact ? null : metricsEditor(ctx, p),
    compact ? null : h("div", { class: "row tight wrap" },
      h("button", { type: "button", class: "secondary small", onclick: () => void repurpose() }, icon("spark"), "اكتب منه منشور جديد"),
      h("button", { type: "button", class: "secondary small", onclick: asDraft }, icon("copy"), "انسخه كمسودة"),
      p.origin === "manual" ? h("button", { type: "button", class: "link", onclick: remove }, "شيله") : null,
    ),
  );
}

function addPostForm(ctx: Ctx): HTMLElement {
  const text = textArea("", () => undefined, { rows: 4, placeholder: "الصق نص منشور قديم", dir: "auto" });
  const date = h("input", { type: "date", value: todayIso(), "aria-label": "تاريخ المنشور" });
  const url = textInput("", () => undefined, { type: "url", placeholder: "رابط المنشور (اختياري)", dir: "ltr" });
  const add = (): void => {
    const value = text.value.trim();
    if (!value) return ctx.toast("الصق نص المنشور.", "error");
    const link = url.value.trim();
    if (link && !/^https:\/\/(www\.)?linkedin\.com\//i.test(link)) return ctx.toast("الرابط لازم يكون من linkedin.com", "error");
    const post: Post = { id: newId("m"), at: `${date.value || todayIso()}T12:00:00Z`, text: value.slice(0, 6000), url: link, sharedUrl: "", media: "", origin: "manual", metrics: null };
    ctx.store.update((s) => (s.content.posts = [post, ...s.content.posts].sort((a, b) => b.at.localeCompare(a.at))), { recompute: false });
    ctx.toast("انضاف المنشور");
  };
  return h("details", { class: "card add-post" },
    h("summary", {}, "أضف منشور قديم بإيدك"),
    field("النص", text),
    h("div", { class: "form-grid narrow" }, field("التاريخ", date), field("الرابط", url)),
    h("button", { type: "button", onclick: add }, icon("plus"), "أضف"),
  );
}

function engagementOf(p: Post): number {
  return p.metrics ? p.metrics.reactions + p.metrics.comments * 3 + p.metrics.reposts * 4 : -1;
}

function renderPosts(ctx: Ctx): HTMLElement {
  const posts = ctx.store.state.content.posts;
  const q = ui.postSearch.trim().toLowerCase();
  const filtered = posts.filter((p) => !q || p.text.toLowerCase().includes(q));
  const sorted = ui.postSort === "top" ? [...filtered].sort((a, b) => engagementOf(b) - engagementOf(a) || b.at.localeCompare(a.at)) : filtered;
  const search = h("input", { type: "search", value: ui.postSearch, placeholder: "دوّر بمنشوراتك", "aria-label": "دوّر بمنشوراتك" });
  search.addEventListener("change", () => {
    ui.postSearch = search.value;
    ui.postLimit = 20;
    ctx.store.emit();
  });
  const sort = h("div", { class: "segmented", role: "group", "aria-label": "الترتيب" },
    h("button", { type: "button", "aria-pressed": String(ui.postSort === "new"), onclick: () => { ui.postSort = "new"; ctx.store.emit(); } }, "الأحدث"),
    h("button", { type: "button", "aria-pressed": String(ui.postSort === "top"), onclick: () => { ui.postSort = "top"; ctx.store.emit(); } }, "الأعلى تفاعل"));
  return h("div", { class: "view" },
    posts.length === 0 ? emptyState("ما في منشورات لسا", "ارفع ملف الـ Export من LinkedIn وفيه Shares.csv، أو أضف منشوراتك القديمة بإيدك. كل ما زادت المنشورات، صار التحليل أدق.", ["روح لصفحة البيانات", () => ctx.go("data")]) : null,
    addPostForm(ctx),
    posts.length ? h("section", { class: "card" },
      h("div", { class: "toolbar" }, h("div", { class: "search-box" }, icon("search"), search), sort, h("span", { class: "muted small" }, `${fmtNumber(filtered.length)} منشور`)),
      h("ul", { class: "post-list" }, sorted.slice(0, ui.postLimit).map((p) => postRow(ctx, p))),
      sorted.length > ui.postLimit ? h("div", { class: "pager" }, h("button", { type: "button", class: "secondary", onclick: () => { ui.postLimit += 20; ctx.store.emit(); } }, `اعرض أكثر (${fmtNumber(sorted.length - ui.postLimit)})`)) : null,
    ) : null,
  );
}

function listEditor(label: string, values: string[], save: (v: string[]) => void, placeholder: string, normalize: (v: string) => string = (v) => v.trim()): HTMLElement {
  const input = h("input", { type: "text", placeholder, "aria-label": label, dir: "auto" });
  const add = (): void => {
    const next = input.value.split(/[,،]+/).map(normalize).filter(Boolean);
    if (next.length) save([...new Set([...values, ...next])]);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add();
  });
  return h("div", { class: "field" }, h("span", { class: "field-label" }, label),
    h("div", { class: "tag-editor" },
      values.map((v) => h("span", { class: "chip", dir: "auto" }, v, h("button", { type: "button", class: "chip-x", "aria-label": `شيل ${v}`, onclick: () => save(values.filter((x) => x !== v)) }, icon("close")))),
      input,
      h("button", { type: "button", class: "link", onclick: add }, "إضافة"),
    ),
  );
}

function renderSettings(ctx: Ctx): HTMLElement {
  const settings = ctx.store.state.content.settings;
  const set = (fn: (st: typeof settings) => void, emit = true): void => ctx.store.update((s) => fn(s.content.settings), { recompute: false, emit });
  const clearStrategy = (): void => {
    if (!window.confirm("رح ينمسح تحليل الذكاء الاصطناعي. المسودات بتضل.")) return;
    ctx.store.update((s) => (s.content.strategy = null), { recompute: false });
  };
  return h("div", { class: "view" },
    h("section", { class: "card" },
      h("h2", {}, "أهدافك بالمحتوى"),
      h("div", { class: "form-grid" },
        field("كم منشور بالأسبوع", numberInput(settings.postsPerWeek, (v) => set((st) => (st.postsPerWeek = Math.min(14, Math.max(1, Math.round(v))))), { min: 1, max: 14 }), "2 لـ 3 بالأسبوع بداية ممتازة."),
        field("اللغة الافتراضية", select((Object.entries(LANG_LABEL) as Array<[ContentLang, string]>), settings.defaultLang, (v) => set((st) => (st.defaultLang = v as ContentLang)))),
        field("موديل الصور", select(IMAGE_MODELS.map((mdl): [string, string] => [mdl, mdl === "dall-e-3" ? "dall-e-3 (ما بدّه توثيق)" : mdl === "gpt-image-1-mini" ? "gpt-image-1-mini (أرخص)" : `${mdl} (أفضل جودة، ممكن يحتاج توثيق)`]), settings.imageModel, (v) => set((st) => (st.imageModel = v)))),
      ),
    ),
    h("section", { class: "card" },
      h("h2", {}, "المحاور والهاشتاغات"),
      h("p", { class: "muted small" }, "المحاور هي المواضيع الأساسية اللي بتحكي فيها. التحليل بيقترحها، وبتقدر تعدّلها."),
      listEditor("محاور المحتوى", settings.pillars, (v) => set((st) => (st.pillars = v.slice(0, 12))), "مثال: خبرات Backend ثم Enter"),
      listEditor("هاشتاغات ثابتة", settings.hashtags, (v) => set((st) => (st.hashtags = v.slice(0, 20))), "#Java ثم Enter", normalizeHashtag),
    ),
    ctx.store.state.content.strategy ? h("section", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "تحليل الذكاء الاصطناعي"), h("p", { class: "muted small" }, "بتقدر تمسحه وتعمل تحليل جديد.")), h("button", { type: "button", class: "danger small", onclick: clearStrategy }, "امسح التحليل"))) : null,
  );
}

function switchTab(ctx: Ctx, tab: Tab): void {
  ui.tab = tab;
  ui.draftId = "";
  ctx.store.emit();
  window.scrollTo({ top: 0 });
}

export function contentBadge(ctx: Ctx): string {
  const today = todayIso();
  const due = ctx.store.state.content.drafts.filter((d) => d.scheduledFor && d.scheduledFor <= today && d.status !== "published").length;
  return due > 0 ? fmtNumber(due) : "";
}

export function renderContent(ctx: Ctx): HTMLElement {
  if (ui.draftId && findDraft(ctx, ui.draftId)) return renderEditor(ctx, ui.draftId, () => closeDraft(ctx), (id) => openDraft(ctx, id));
  ui.draftId = "";
  const tabs = h("div", { class: "content-head" },
    h("div", { class: "presets", role: "tablist", "aria-label": "أقسام المحتوى" }, TABS.map(([id, label]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(ui.tab === id), "aria-pressed": String(ui.tab === id), onclick: () => switchTab(ctx, id) }, label))),
    h("button", { type: "button", onclick: () => createDraft(ctx) }, icon("pen"), "منشور جديد"),
  );
  const body = ui.tab === "board" ? renderBoard(ctx) : ui.tab === "calendar" ? renderCalendar(ctx) : ui.tab === "posts" ? renderPosts(ctx) : ui.tab === "settings" ? renderSettings(ctx) : renderOverview(ctx);
  return h("div", { class: "view" }, tabs, body);
}
