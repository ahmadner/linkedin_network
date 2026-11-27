import {
  analyzeContent, IMAGE_ASPECT_LABEL, IMAGE_MODEL_LABEL, IMAGE_QUALITY_LABEL, IMAGE_STYLES, planContent, planDates, planSeries, rewritePost, suggestIdeas, weekdayIndex,
  type PlanItem, type SeriesPlan,
} from "../../ai/content";
import {
  contentStats, draftTitle, DRAFT_STATUSES, FORMAT_LABEL, hasArabic, IMAGE_ASPECTS, IMAGE_MODELS, IMAGE_QUALITIES, LANG_LABEL, MAX_IMAGE_COUNT, newDraft, newId, normalizeHashtag, POST_FORMATS, STATUS_LABEL, WEEKDAYS_AR,
  type ContentIdea, type ContentLang, type Draft, type DraftStatus, type ImageAspect, type ImageQuality, type Post, type PostFormat, type PostMetrics,
} from "../../core/content";
import { barFill, columnChart } from "../charts";
import { ago, badge, card, emptyState, kpi, runAi, type Ctx } from "../context";
import { addDraft, autopilot, findDraft, ideaDraft, nextDates, saveSeries, seriesDrafts, seriesLabel, todayIso, writeDraft, writeIdeas, writeSeries, type BatchResult } from "../drafts";
import { field, fmtNumber, h, numberInput, select, textArea, textInput } from "../dom";
import { icon } from "../icons";
import { imageThumb, renderEditor } from "./editor";
import { postsSyncCard } from "./postsSync";

type Tab = "overview" | "board" | "series" | "calendar" | "posts" | "settings";

const TABS: Array<[Tab, string]> = [
  ["overview", "نظرة عامة"],
  ["board", "المسودات"],
  ["series", "السلاسل"],
  ["calendar", "التقويم"],
  ["posts", "منشوراتي"],
  ["settings", "الإعدادات"],
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
  autoTopic: string;
  autoFormat: PostFormat | "";
  autoImage: boolean;
  autoSchedule: boolean;
  seriesTopic: string;
  seriesGoal: string;
  seriesCount: number;
  seriesLang: ContentLang | "";
  seriesFrom: string;
  seriesImages: boolean;
  seriesPlan: SeriesPlan | null;
  boardStatus: DraftStatus | "";
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
  autoTopic: "",
  autoFormat: "",
  autoImage: true,
  autoSchedule: true,
  seriesTopic: "",
  seriesGoal: "",
  seriesCount: 5,
  seriesLang: "",
  seriesFrom: "",
  seriesImages: false,
  seriesPlan: null,
  boardStatus: "",
};

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

function batchToast(ctx: Ctx, result: BatchResult, what: string): void {
  if (result.failed === 0) return ctx.toast(`انكتب ${fmtNumber(result.done)} ${what}. راجعهم من لوحة المسودات.`);
  ctx.toast(`انكتب ${fmtNumber(result.done)} وفشل ${fmtNumber(result.failed)}. ${result.firstError}`, result.done ? "ok" : "error");
}

async function writeNow(ctx: Ctx, idea: ContentIdea): Promise<void> {
  const draft = addDraft(ctx, ideaDraft(idea));
  await runAi(ctx, "كتابة المنشور…", (cfg) => writeDraft(ctx, cfg, draft.id));
  openDraft(ctx, draft.id);
}

async function writeAll(ctx: Ctx, ideas: ContentIdea[], onDone: () => void): Promise<void> {
  if (ideas.length === 0) return;
  if (!window.confirm(`رح يكتب ${fmtNumber(ideas.length)} منشور كاملين كمسودات. كمّل؟`)) return;
  const result = await runAi(ctx, "كتابة الأفكار كلها…", (cfg, progress) => writeIdeas(ctx, cfg, ideas, progress));
  if (!result) return;
  onDone();
  batchToast(ctx, result, "منشورات");
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
      h("button", { type: "button", class: "small", onclick: () => void writeNow(ctx, idea) }, icon("spark"), "اكتبه هلأ"),
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
  const scratch = s.content.posts.length === 0;
  const focus = textInput(ui.focus, (v) => (ui.focus = v), { placeholder: "اختياري: ركّز على… (مثال: Spring Boot، قصص من الشغل، نصايح للمبتدئين)" });
  const more = async (): Promise<void> => {
    ui.focus = focus.value.trim();
    const existing = [...s.content.drafts.map((d) => draftTitle(d)), ...(s.content.strategy?.ideas.map((i) => i.title) ?? []), ...ui.extraIdeas.map((i) => i.title)];
    const result = await runAi(ctx, scratch ? "بناء أفكار من ملفك…" : "تجهيز أفكار جديدة…", (cfg) => suggestIdeas(s.profile, s.content.posts, s.content.strategy, s.content.settings, existing, ui.focus, 8, cfg));
    if (!result) return;
    ui.extraIdeas = [...result, ...ui.extraIdeas].slice(0, 40);
    ctx.store.emit();
  };
  const saved = savedTitles(ctx);
  const fresh = ui.extraIdeas.filter((i) => !saved.has(i.title.trim().toLowerCase()));
  return h("section", { class: "card" },
    h("h2", { class: "with-icon" }, icon("target"), scratch ? "اقتراحات من الصفر" : "بدك أفكار أكثر؟"),
    scratch ? h("p", { class: "muted small" }, "ما في منشورات قديمة؟ مش مشكلة. الذكاء الاصطناعي بيقرأ ملفك (شغلك، مهاراتك، مشاريعك، أهدافك) وبيقترح أول منشورات بالترتيب الأسهل.") : null,
    h("div", { class: "toolbar" }, focus, h("button", { type: "button", onclick: () => void more() }, icon("spark"), "اقترح 8 أفكار")),
    ui.extraIdeas.length ? h("ul", { class: "ideas" }, ui.extraIdeas.map((i) => ideaRow(ctx, i, saved))) : null,
    fresh.length > 1 ? h("div", { class: "row" }, h("button", { type: "button", class: "secondary", onclick: () => void writeAll(ctx, fresh, () => (ui.extraIdeas = ui.extraIdeas.filter((i) => !fresh.includes(i)))) }, icon("pen"), `اكتبهم كلهم (${fmtNumber(fresh.length)})`)) : null,
  );
}

function autopilotCard(ctx: Ctx): HTMLElement {
  const topic = textInput(ui.autoTopic, (v) => (ui.autoTopic = v), { placeholder: "اختياري: عن شو؟ اتركه فاضي والذكاء الاصطناعي بيختار أفضل فكرة إلك" });
  const format = select([["", "النوع: الذكاء الاصطناعي بيختار"], ...POST_FORMATS.filter((f) => f !== "video").map((f): [string, string] => [f, FORMAT_LABEL[f]])], ui.autoFormat, (v) => (ui.autoFormat = v as PostFormat | ""), { "aria-label": "نوع المنشور" });
  const withImage = h("input", { type: "checkbox", checked: ui.autoImage });
  withImage.addEventListener("change", () => (ui.autoImage = withImage.checked));
  const schedule = h("input", { type: "checkbox", checked: ui.autoSchedule });
  schedule.addEventListener("change", () => (ui.autoSchedule = schedule.checked));
  const go = async (): Promise<void> => {
    ui.autoTopic = topic.value;
    const result = await runAi(ctx, "تجهيز منشور كامل…", (cfg, progress) => autopilot(ctx, cfg, { topic: ui.autoTopic, format: ui.autoFormat, image: ui.autoImage, schedule: ui.autoSchedule }, progress));
    if (!result) return;
    ui.autoTopic = "";
    if (result.imageError) ctx.toast(`المنشور جاهز بس الصورة ما زبطت: ${result.imageError}`, "error");
    else ctx.toast(result.date ? `جاهز ومجدول ${result.date}. راجعه وانشره بإيدك.` : "جاهز. راجعه وانشره بإيدك.");
    openDraft(ctx, result.id);
  };
  return h("section", { class: "card autopilot" },
    h("h2", { class: "with-icon" }, icon("spark"), "منشور كامل بضغطة"),
    h("p", { class: "muted small" }, "فكرة ← كتابة بصوتك ← صورة مصممة ← موعد بأفضل يوم فاضي. بتراجع كل إشي قبل النشر، وإحنا ما بننشر لحالنا."),
    h("div", { class: "toolbar" }, topic, format),
    h("div", { class: "row wrap" },
      h("label", { class: "check" }, withImage, "مع صورة"),
      h("label", { class: "check" }, schedule, "جدوله بأقرب يوم مناسب"),
      h("button", { type: "button", onclick: () => void go() }, icon("spark"), "جهّزلي منشور"),
    ),
  );
}

function weekdayBars(counts: number[]): HTMLElement {
  const max = Math.max(1, ...counts);
  return h("ul", { class: "bars" }, WEEKDAYS_AR.map((d, i) => h("li", {}, h("span", { class: "bar-label" }, d), h("span", { class: "bar-track" }, barFill((counts[i] ?? 0) / max)), h("span", { class: "bar-value" }, fmtNumber(counts[i] ?? 0)))));
}

function dayLabel(date: string): string {
  const today = todayIso();
  if (date === today) return "اليوم";
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (date === `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`) return "بكرا";
  return `${WEEKDAYS_AR[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${date.slice(8)}/${date.slice(5, 7)}`;
}

function nextUpCard(ctx: Ctx): HTMLElement {
  const today = todayIso();
  const drafts = ctx.store.state.content.drafts.filter((d) => d.status !== "published" && d.status !== "idea" && (d.scheduledFor || d.status === "ready"));
  const ordered = [...drafts].sort((a, b) => (a.scheduledFor || "9999").localeCompare(b.scheduledFor || "9999")).slice(0, 6);
  const overdue = drafts.filter((d) => d.scheduledFor && d.scheduledFor < today).length;
  return h("section", { class: "card next-up" },
    h("div", { class: "card-head" },
      h("h2", { class: "with-icon" }, icon("calendar"), "الجاي للنشر"),
      overdue ? badge(`${fmtNumber(overdue)} متأخر`, "bad") : null,
    ),
    ordered.length === 0
      ? h("div", { class: "next-empty" },
          h("p", { class: "muted small" }, "ما في منشورات جاهزة أو مجدولة. جهّز واحد بضغطة، أو خطّط سلسلة."),
          h("div", { class: "row" }, h("button", { type: "button", class: "secondary small", onclick: () => switchTab(ctx, "series") }, "خطّط سلسلة"), h("button", { type: "button", class: "secondary small", onclick: () => switchTab(ctx, "calendar") }, "خطة نشر")),
        )
      : h("ul", { class: "next-list" }, ordered.map((d) => {
          const late = Boolean(d.scheduledFor) && d.scheduledFor < today;
          return h("li", {}, h("button", { type: "button", class: late ? "next-item late" : "next-item", onclick: () => openDraft(ctx, d.id) },
            h("span", { class: "next-date" }, d.scheduledFor ? (late ? "متأخر" : dayLabel(d.scheduledFor)) : "بدون موعد"),
            d.imageId ? imageThumb(d.imageId, "thumb small-thumb") : h("span", { class: "thumb small-thumb" }, icon("pen")),
            h("span", { class: "next-text" }, h("strong", { dir: "auto" }, draftTitle(d)), h("span", { class: "muted small" }, [STATUS_LABEL[d.status], FORMAT_LABEL[d.format], seriesLabel(ctx, d)].filter(Boolean).join(" · "))),
          ));
        })),
  );
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
    ? emptyState("خلّينا نبلش بالمحتوى", "اسحب منشوراتك القديمة بالإضافة أو من ملف الـ Export (Shares.csv)، أو ابدأ على طول: جهّز منشور كامل بضغطة، أو خلّي الذكاء الاصطناعي يقترح عليك من ملفك.", ["اسحب منشوراتي", () => switchTab(ctx, "posts")])
    : null;
  const months = stats.byMonth.slice(-12);
  return h("div", { class: "view" },
    intro,
    h("div", { class: "kpis compact-kpis" },
      kpi("منشوراتك", fmtNumber(stats.total), stats.total ? `معدل الطول ${fmtNumber(stats.avgLength)} حرف` : "ما في لسا", () => switchTab(ctx, "posts")),
      kpi("آخر 90 يوم", fmtNumber(stats.last90), `${stats.perWeek90} بالأسبوع · هدفك ${target}`, undefined, stats.total > 0 && stats.perWeek90 < target ? "hot" : ""),
      kpi("آخر منشور", ago(stats.daysSinceLast), stats.daysSinceLast !== null && stats.daysSinceLast > 14 ? "صار وقت منشور جديد" : "استمر"),
      kpi("أفكار", fmtNumber(count("idea")), "ببنك الأفكار", () => switchTab(ctx, "board")),
      kpi("مسودات وجاهزة", fmtNumber(count("draft") + count("ready")), `${fmtNumber(count("ready"))} جاهزة للنشر`, () => switchTab(ctx, "board")),
      kpi("هالأسبوع", fmtNumber(upcoming), "مجدولة لـ 7 أيام الجاية", () => switchTab(ctx, "calendar")),
    ),
    h("div", { class: "overview-top" }, autopilotCard(ctx), nextUpCard(ctx)),
    strategyCard(ctx),
    moreIdeasCard(ctx),
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
  );
}

function draftCard(ctx: Ctx, d: Draft): HTMLElement {
  const snippet = d.text.replace(/\s+/g, " ").trim();
  const late = Boolean(d.scheduledFor) && d.scheduledFor < todayIso() && d.status !== "published";
  const series = seriesLabel(ctx, d);
  return h("li", {},
    h("button", { type: "button", class: "draft-card", onclick: () => openDraft(ctx, d.id) },
      h("span", { class: "draft-text" },
        h("strong", { dir: "auto" }, draftTitle(d)),
        snippet && snippet !== d.title ? h("span", { class: "muted small clamp", dir: "auto" }, snippet.slice(0, 160)) : null,
        h("span", { class: "draft-meta" }, [FORMAT_LABEL[d.format], LANG_LABEL[d.lang], d.pillar].filter(Boolean).join(" · ")),
        series || d.scheduledFor ? h("span", { class: "chips" },
          series ? badge(series, "series") : null,
          d.scheduledFor ? badge(late ? `متأخر · ${d.scheduledFor.slice(5)}` : dayLabel(d.scheduledFor), late ? "bad" : "") : null,
        ) : null,
      ),
      d.imageId ? imageThumb(d.imageId, "thumb") : null,
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
  const byStatus = new Map(DRAFT_STATUSES.map((st) => [st, visible.filter((d) => d.status === st).sort(order)]));
  const active = ui.boardStatus || DRAFT_STATUSES.find((st) => st !== "published" && (byStatus.get(st)?.length ?? 0) > 0) || "idea";
  const switcher = h("div", { class: "presets board-switch", role: "group", "aria-label": "الحالة" }, DRAFT_STATUSES.map((st) =>
    h("button", { type: "button", "aria-pressed": String(st === active), onclick: () => { ui.boardStatus = st; ctx.store.emit(); } }, STATUS_LABEL[st], h("span", { class: "preset-count" }, fmtNumber(byStatus.get(st)?.length ?? 0)))));
  return h("div", { class: "view" },
    h("div", { class: "toolbar board-tools" },
      h("div", { class: "search-box" }, icon("search"), search),
      pillars.length ? select([["", "كل المحاور"], ...pillars.map((p): [string, string] => [p, p])], ui.pillar, (v) => { ui.pillar = v; ctx.store.emit(); }, { "aria-label": "المحور" }) : null,
    ),
    switcher,
    h("div", { class: "board" }, DRAFT_STATUSES.map((st) => {
      const items = byStatus.get(st) ?? [];
      return h("section", { class: `column col-${st}${st === active ? " active" : ""}` },
        h("div", { class: "column-head" }, h("h2", {}, STATUS_LABEL[st]), h("span", { class: "count-pill" }, fmtNumber(items.length))),
        st === "idea" ? quickIdea(ctx) : null,
        items.length === 0 ? h("p", { class: "muted small column-empty" }, st === "idea" ? "اكتب فكرة أو خذ من اقتراحات الذكاء الاصطناعي." : "فاضي") : h("ul", { class: "draft-cards" }, items.slice(0, st === "published" ? 30 : 200).map((d) => draftCard(ctx, d))),
      );
    })),
  );
}

function seriesPlanner(ctx: Ctx): HTMLElement {
  const s = ctx.store.state;
  const lang = ui.seriesLang || s.content.settings.defaultLang;
  const topic = textInput(ui.seriesTopic, (v) => (ui.seriesTopic = v), { placeholder: "مثال: رحلتي من Junior لـ Senior Backend (اتركه فاضي والذكاء الاصطناعي بيقترح)" });
  const goal = textInput(ui.seriesGoal, (v) => (ui.seriesGoal = v), { placeholder: "اختياري: شو بدك توصل؟ مثال: شركات توظفني، أبني سمعة بالـ Cloud" });
  const count = select(["3", "4", "5", "6", "7", "8", "10"].map((n): [string, string] => [n, `${n} منشورات`]), String(ui.seriesCount), (v) => (ui.seriesCount = Number(v)));
  const langs = select(Object.entries(LANG_LABEL) as Array<[string, string]>, lang, (v) => (ui.seriesLang = v as ContentLang));
  const from = h("input", { type: "date", value: ui.seriesFrom || todayIso(), "aria-label": "تبدأ من" });
  from.addEventListener("change", () => {
    ui.seriesFrom = from.value;
    ctx.store.emit();
  });
  const images = h("input", { type: "checkbox", checked: ui.seriesImages });
  images.addEventListener("change", () => (ui.seriesImages = images.checked));
  const plan = async (): Promise<void> => {
    ui.seriesTopic = topic.value.trim();
    ui.seriesGoal = goal.value.trim();
    const existing = s.content.drafts.map((d) => draftTitle(d));
    const result = await runAi(ctx, "تخطيط السلسلة…", (cfg) => planSeries({ topic: ui.seriesTopic, goal: ui.seriesGoal, count: ui.seriesCount, lang }, s.profile, s.content.posts, s.content.strategy, s.content.settings, existing, cfg));
    if (!result) return;
    ui.seriesPlan = result;
    ctx.store.emit();
  };
  const p = ui.seriesPlan;
  const dates = p ? nextDates(ctx, p.parts.length, ui.seriesFrom || todayIso()) : [];
  const keep = (write: boolean): void => {
    if (!p) return;
    const series = saveSeries(ctx, p, dates);
    ui.seriesPlan = null;
    ctx.store.emit();
    if (!write) return ctx.toast(`انضافت السلسلة للتقويم (${fmtNumber(p.parts.length)} أفكار).`);
    void runAi(ctx, `كتابة سلسلة "${p.name}"…`, (cfg, progress) => writeSeries(ctx, cfg, series.id, ui.seriesImages, progress)).then((result) => {
      if (result) batchToast(ctx, result, "أجزاء");
    });
  };
  return h("section", { class: "card" },
    h("h2", { class: "with-icon" }, icon("spark"), "سلسلة منشورات مترابطة"),
    h("p", { class: "muted small" }, "الذكاء الاصطناعي بيبني قصة على كذا منشور: كل جزء إله زاوية، بيبني على اللي قبله، وبيشوّق للجاي. بعدين بيكتبهم كلهم وبيوزعهم على أفضل أيامك."),
    field("موضوع السلسلة", topic),
    field("الهدف", goal),
    h("div", { class: "form-grid narrow" }, field("العدد", count), field("اللغة", langs), field("تبدأ من", from)),
    h("div", { class: "row wrap" },
      h("label", { class: "check" }, images, "صمّم صورة لكل جزء (بيكلف من رصيد OpenAI)"),
      h("button", { type: "button", class: p ? "secondary" : "", onclick: () => void plan() }, icon("spark"), p ? "خطة ثانية" : "خطّط السلسلة"),
    ),
    p ? h("div", { class: "series-plan" },
      h("h3", { dir: "auto" }, p.name),
      p.theme ? h("p", {}, p.theme) : null,
      p.arc ? h("p", { class: "muted small" }, p.arc) : null,
      h("ol", { class: "series-parts" }, p.parts.map((part, i) => h("li", {},
        h("div", { class: "row tight wrap" }, h("strong", { dir: "auto" }, part.title), badge(FORMAT_LABEL[part.format]), dates[i] ? badge(`📅 ${WEEKDAYS_AR[new Date(`${dates[i]}T00:00:00Z`).getUTCDay()]} ${dates[i]!.slice(5)}`) : null),
        part.hook ? h("p", { class: "idea-hook", dir: "auto" }, `"${part.hook}"`) : null,
        part.angle ? h("p", { class: "muted small" }, part.angle) : null,
      ))),
      h("div", { class: "row" },
        h("button", { type: "button", onclick: () => keep(true) }, icon("pen"), "اكتبها كلها وجدولها"),
        h("button", { type: "button", class: "secondary", onclick: () => keep(false) }, icon("calendar"), "أضفها للتقويم كأفكار"),
        h("button", { type: "button", class: "link", onclick: () => { ui.seriesPlan = null; ctx.store.emit(); } }, "إلغاء"),
      ),
    ) : null,
  );
}

function seriesCard(ctx: Ctx, id: string): HTMLElement | null {
  const series = ctx.store.state.content.series.find((x) => x.id === id);
  if (!series) return null;
  const drafts = seriesDrafts(ctx, id);
  const pending = drafts.filter((d) => d.status === "idea" || !d.text.trim()).length;
  const published = drafts.filter((d) => d.status === "published").length;
  const writeRest = async (): Promise<void> => {
    const result = await runAi(ctx, `كتابة باقي "${series.name}"…`, (cfg, progress) => writeSeries(ctx, cfg, id, false, progress));
    if (result) batchToast(ctx, result, "أجزاء");
  };
  const remove = (): void => {
    if (!window.confirm("رح تنشال السلسلة. المنشورات بتضل بالمسودات كمنشورات عادية. أكيد؟")) return;
    ctx.store.update((s) => {
      s.content.series = s.content.series.filter((x) => x.id !== id);
      s.content.drafts = s.content.drafts.map((d) => (d.seriesId === id ? { ...d, seriesId: "", seriesIndex: 0 } : d));
    }, { recompute: false });
  };
  return h("section", { class: "card" },
    h("div", { class: "card-head" },
      h("div", {}, h("h2", { dir: "auto" }, series.name), h("p", { class: "muted small" }, `${fmtNumber(drafts.length)} أجزاء · ${fmtNumber(published)} منشورة · ${fmtNumber(pending)} لسا ما انكتبت`)),
      h("div", { class: "row tight" },
        pending ? h("button", { type: "button", class: "small", onclick: () => void writeRest() }, icon("pen"), "اكتب الباقي") : null,
        h("button", { type: "button", class: "link", onclick: remove }, "شيل السلسلة"),
      ),
    ),
    series.theme ? h("p", {}, series.theme) : null,
    h("ol", { class: "series-parts" }, drafts.map((d) => h("li", {},
      h("button", { type: "button", class: "series-part", onclick: () => openDraft(ctx, d.id) },
        h("strong", { dir: "auto" }, draftTitle(d)),
        h("span", { class: "chips" }, badge(STATUS_LABEL[d.status], d.status === "published" ? "good" : ""), badge(FORMAT_LABEL[d.format]), d.scheduledFor ? badge(`📅 ${d.scheduledFor}`) : null, d.imageId ? badge("صورة") : null),
      ),
    ))),
  );
}

function renderSeries(ctx: Ctx): HTMLElement {
  const list = ctx.store.state.content.series;
  return h("div", { class: "view" },
    seriesPlanner(ctx),
    list.length ? list.map((x) => seriesCard(ctx, x.id)) : h("p", { class: "muted small" }, "ما في سلاسل لسا. خطّط أول سلسلة من فوق."),
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
    h("p", { class: "muted small" }, `بيوزّع ${settings.postsPerWeek} منشور بالأسبوع على أفضل الأيام، بيوازن بين المحاور، وما بيكرر منشوراتك القديمة. بتقدر تغيّر العدد من تبويب الإعدادات.`),
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

function showPost(ctx: Ctx, p: Post): void {
  ui.postSearch = p.text.slice(0, 40);
  switchTab(ctx, "posts");
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
      drafts.length || posts.length ? h("div", { class: "day-items" },
        drafts.map((d) => h("button", { type: "button", class: `cal-item st-${d.status}`, title: draftTitle(d), "aria-label": draftTitle(d), onclick: () => openDraft(ctx, d.id) }, h("span", {}, draftTitle(d)))),
        posts.map((p) => h("button", { type: "button", class: "cal-item st-published", title: p.text.slice(0, 200), "aria-label": p.text.slice(0, 60), onclick: () => showPost(ctx, p) }, h("span", {}, p.text.slice(0, 40) || "منشور"))),
      ) : null,
    ));
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailing; i += 1) cells.push(h("div", { class: "day blank", "aria-hidden": "true" }));
  const agenda = [
    ...[...byDay.entries()].flatMap(([day, list]) => list.map((d) => ({ day, title: draftTitle(d), status: d.status, open: () => openDraft(ctx, d.id) }))),
    ...[...published.entries()].flatMap(([day, list]) => list.map((p) => ({ day, title: p.text.split("\n")[0]?.slice(0, 90) || "منشور", status: "published" as DraftStatus, open: () => showPost(ctx, p) }))),
  ].sort((a, b) => a.day.localeCompare(b.day));
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
      unscheduled ? h("p", { class: "muted small" }, `عندك ${fmtNumber(unscheduled)} مسودة بدون موعد. افتحها واضغط "أقرب يوم مناسب".`) : null,
    ),
    h("section", { class: "card" },
      h("h2", {}, `مواعيد ${MONTHS_AR[m - 1]}`),
      agenda.length === 0 ? h("p", { class: "muted small" }, "ما في إشي بهالشهر.") : h("ul", { class: "agenda" }, agenda.map((a) => h("li", {},
        h("button", { type: "button", class: a.day < today && a.status !== "published" ? "agenda-item late" : "agenda-item", onclick: a.open },
          h("span", { class: "agenda-date" }, dayLabel(a.day)),
          h("i", { class: `swatch st-${a.status}`, "aria-hidden": "true" }),
          h("span", { class: "agenda-title", dir: "auto" }, a.title),
          h("span", { class: "muted small" }, STATUS_LABEL[a.status]),
        ),
      ))),
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
      badge(p.origin === "export" ? "من الـ Export" : p.origin === "sync" ? "من الإضافة" : "يدوي", "muted-badge"),
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
    posts.length === 0 ? emptyState("ما في منشورات لسا", "اسحبها بالإضافة، أو ارفع ملف الـ Export وفيه Shares.csv، أو أضفها بإيدك. كل ما زادت المنشورات، صار التحليل أدق.") : null,
    postsSyncCard(ctx),
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
      ),
    ),
    h("section", { class: "card" },
      h("h2", { class: "with-icon" }, icon("image"), "الصور"),
      h("p", { class: "muted small" }, "موديلات GPT Image الجديدة من OpenAI. إذا حسابك ما بيقدر يستخدم موديل (بعضها بدها توثيق للمنظمة)، البرنامج بيجرب اللي بعده لحاله."),
      h("div", { class: "form-grid" },
        field("الموديل", select(IMAGE_MODELS.map((mdl): [string, string] => [mdl, IMAGE_MODEL_LABEL[mdl] ?? mdl]), settings.imageModel, (v) => set((st) => (st.imageModel = v)))),
        field("الجودة", select(IMAGE_QUALITIES.map((q): [string, string] => [q, IMAGE_QUALITY_LABEL[q]]), settings.imageQuality, (v) => set((st) => (st.imageQuality = v as ImageQuality)))),
        field("الستايل الافتراضي", select(Object.entries(IMAGE_STYLES).map(([k, st]): [string, string] => [k, st.label]), settings.imageStyle, (v) => set((st) => (st.imageStyle = v)))),
        field("المقاس الافتراضي", select(IMAGE_ASPECTS.map((a): [string, string] => [a, IMAGE_ASPECT_LABEL[a]]), settings.imageAspect, (v) => set((st) => (st.imageAspect = v as ImageAspect)))),
        field("عدد النسخ كل مرة", select(Array.from({ length: MAX_IMAGE_COUNT }, (_, i): [string, string] => [String(i + 1), String(i + 1)]), String(settings.imageCount), (v) => set((st) => (st.imageCount = Number(v))))),
        field("ألوان البراند", textInput(settings.brandColors, (v) => set((st) => (st.brandColors = v.trim().slice(0, 200)), false), { placeholder: "مثال: navy #0B2545, teal #13A89E", dir: "ltr" }), "اختياري. بتنستعمل بكل الصور، وخصوصًا ستايل \"ألوان البراند\"."),
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

function tabCount(ctx: Ctx, tab: Tab): string {
  const c = ctx.store.state.content;
  const n = tab === "board" ? c.drafts.filter((d) => d.status !== "published").length : tab === "series" ? c.series.length : tab === "posts" ? c.posts.length : 0;
  return n ? fmtNumber(n) : "";
}

export function renderContent(ctx: Ctx): HTMLElement {
  if (ui.draftId && findDraft(ctx, ui.draftId)) return renderEditor(ctx, ui.draftId, () => closeDraft(ctx), (id) => openDraft(ctx, id));
  ui.draftId = "";
  const tabs = h("div", { class: "content-head" },
    h("div", { class: "presets content-tabs", role: "tablist", "aria-label": "أقسام المحتوى" }, TABS.map(([id, label]) => {
      const n = tabCount(ctx, id);
      return h("button", { type: "button", role: "tab", "aria-selected": String(ui.tab === id), "aria-pressed": String(ui.tab === id), onclick: () => switchTab(ctx, id) }, label, n ? h("span", { class: "preset-count" }, n) : null);
    })),
    h("button", { type: "button", onclick: () => createDraft(ctx) }, icon("pen"), "منشور جديد"),
  );
  const body = ui.tab === "board" ? renderBoard(ctx) : ui.tab === "series" ? renderSeries(ctx) : ui.tab === "calendar" ? renderCalendar(ctx) : ui.tab === "posts" ? renderPosts(ctx) : ui.tab === "settings" ? renderSettings(ctx) : renderOverview(ctx);
  return h("div", { class: "view" }, tabs, body);
}
