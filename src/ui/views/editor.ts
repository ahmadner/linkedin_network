import { carouselOutline, generateImage, IMAGE_SIZE_LABEL, IMAGE_STYLES, imagePromptFor, LENGTH_LABEL, replaceHook, reviewPost, rewritePost, suggestHooks, TONE_LABEL, writePost, defaultLength, type ImageSize, type Length, type PostReview, type RewriteAction, type Tone } from "../../ai/content";
import {
  DRAFT_STATUSES, FORMAT_LABEL, foldPreview, IMAGE_MODELS, LANG_LABEL, newDraft, newId, normalizeHashtag, POST_FORMATS, MAX_VERSIONS, POST_LIMIT, postChecks, publishText, readingSeconds, restoreDraftVersion, shareUrl, STATUS_LABEL, withVersion,
  type ContentLang, type Draft, type ImageMeta, type Post, type Slide,
} from "../../core/content";
import { base64Blob, imageBlob, imageExtension, imageUrl, prepareImage, removeImage, storeImage } from "../../io/images";
import type { AiConfig } from "../../ai/openai";
import { barFill } from "../charts";
import { badge, runAi, type Ctx } from "../context";
import { copyText, download, field, fmtNumber, h, pickFiles, replace, select, textArea, textInput } from "../dom";
import { icon } from "../icons";
import { slidesPdf, slidesZip } from "../slides";

interface EditorUi {
  draftId: string;
  expanded: boolean;
  mobile: boolean;
  hooks: Array<{ text: string; technique: string }>;
  review: PostReview | null;
  note: string;
  tags: string[];
  tone: Tone;
  length: Length | "";
  details: string;
  style: string;
  size: ImageSize;
  publishUrl: string;
}

const ui: EditorUi = freshUi("");

function freshUi(draftId: string): EditorUi {
  return { draftId, expanded: false, mobile: true, hooks: [], review: null, note: "", tags: [], tone: "professional", length: "", details: "", style: IMAGE_STYLES[0]![0], size: "square", publishUrl: "" };
}

export function findDraft(ctx: Ctx, id: string): Draft | undefined {
  return ctx.store.state.content.drafts.find((d) => d.id === id);
}

export function updateDraft(ctx: Ctx, id: string, fn: (d: Draft) => Draft, emit = true): void {
  ctx.store.update((s) => {
    s.content.drafts = s.content.drafts.map((d) => (d.id === id ? { ...fn(d), updatedAt: new Date().toISOString() } : d));
  }, { recompute: false, emit });
}

function patch(ctx: Ctx, id: string, changes: Partial<Draft>, emit = true): void {
  updateDraft(ctx, id, (d) => ({ ...d, ...changes }), emit);
}

export function addDraft(ctx: Ctx, draft: Draft): Draft {
  ctx.store.update((s) => {
    s.content.drafts = [draft, ...s.content.drafts];
  }, { recompute: false, emit: false });
  return draft;
}

export async function deleteDraft(ctx: Ctx, id: string): Promise<void> {
  const state = ctx.store.state.content;
  const owned = Object.values(state.images).filter((img) => img.draftId === id).map((img) => img.id);
  const used = new Set(state.drafts.filter((d) => d.id !== id).map((d) => d.imageId));
  const removable = owned.filter((img) => !used.has(img));
  await Promise.all(removable.map(removeImage));
  ctx.store.update((s) => {
    s.content.drafts = s.content.drafts.filter((d) => d.id !== id);
    for (const img of removable) delete s.content.images[img];
    s.content.posts = s.content.posts.filter((p) => p.id !== manualPostId(id));
  }, { recompute: false });
}

function manualPostId(draftId: string): string {
  return `m-${draftId}`;
}

export function imageThumb(id: string, cls = "thumb", alt = ""): HTMLElement {
  const img = h("img", { class: cls, alt, decoding: "async" });
  void imageUrl(id).then((url) => {
    if (url) img.src = url;
    else img.replaceWith(h("span", { class: `${cls} missing` }, icon("image")));
  });
  return img;
}

function ownerName(ctx: Ctx, lang: ContentLang): string {
  const me = ctx.store.state.profile.me;
  return (lang === "ar" ? me.full_name_ar : "") || me.full_name || ctx.store.state.dataset.owner.name || "أنا";
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => [...p][0] ?? "").join("").toUpperCase() || "?";
}

function previewCard(ctx: Ctx, d: Draft): HTMLElement {
  const name = ownerName(ctx, d.lang);
  const photo = ctx.store.state.dataset.photos[ctx.store.state.dataset.owner.slug];
  const headline = ctx.store.state.profile.me.headline || ctx.store.state.profile.me.current_role;
  const text = d.text.trim();
  const fold = foldPreview(text);
  const shown = ui.expanded || !fold.folded ? text : fold.visible;
  const tags = d.hashtags.map(normalizeHashtag).filter(Boolean);
  const body = h("div", { class: "li-text", dir: d.lang === "ar" ? "rtl" : "ltr" },
    text ? shown : h("span", { class: "muted" }, "النص رح يبين هون…"),
    fold.folded && !ui.expanded ? h("button", { type: "button", class: "li-more", onclick: () => toggleExpanded(ctx, d.id) }, d.lang === "ar" ? "…شوف المزيد" : "…see more") : null,
    (ui.expanded || !fold.folded) && tags.length > 0 ? h("p", { class: "li-tags" }, tags.join(" ")) : null,
  );
  const media = d.imageId
    ? imageThumb(d.imageId, "li-image")
    : d.format === "carousel" && d.slides.length > 0
      ? h("div", { class: "li-carousel" }, h("strong", { dir: "auto" }, d.slides[0]!.title), h("span", {}, `${d.slides.length} شرائح · PDF`))
      : d.format === "poll" && d.pollQuestion
        ? h("div", { class: "li-poll" }, h("strong", { dir: "auto" }, d.pollQuestion), d.pollOptions.filter(Boolean).map((o) => h("span", { class: "li-option", dir: "auto" }, o)))
        : null;
  const avatarEl = photo ? h("img", { class: "avatar", src: photo, alt: "", referrerpolicy: "no-referrer" }) : h("span", { class: "avatar" }, initials(name));
  return h("div", { class: ui.mobile ? "li-post mobile" : "li-post" },
    h("div", { class: "li-head" }, avatarEl, h("div", {}, h("strong", { dir: "auto" }, name), h("small", { class: "muted", dir: "auto" }, headline || "LinkedIn"), h("small", { class: "muted" }, "الآن · 🌐"))),
    body,
    media,
    h("div", { class: "li-actions", "aria-hidden": "true" }, h("span", {}, "👍 أعجبني"), h("span", {}, "💬 تعليق"), h("span", {}, "🔁 إعادة نشر"), h("span", {}, "➤ إرسال")),
  );
}

let previewHost: HTMLElement | null = null;
let liveHost: HTMLElement | null = null;

function toggleExpanded(ctx: Ctx, id: string): void {
  ui.expanded = !ui.expanded;
  refreshLive(ctx, id);
}

function refreshLive(ctx: Ctx, id: string): void {
  const d = findDraft(ctx, id);
  if (!d) return;
  if (previewHost) replace(previewHost, previewCard(ctx, d));
  if (liveHost) replace(liveHost, liveStats(d), checksList(d));
}

function liveStats(d: Draft): HTMLElement {
  const total = publishText(d).length;
  const first = d.text.trim().split("\n")[0] ?? "";
  return h("div", { class: "live-stats" },
    h("span", { class: total > POST_LIMIT ? "count over" : "count" }, `${fmtNumber(total)} / ${fmtNumber(POST_LIMIT)} حرف`),
    h("span", { class: "muted small" }, `أول سطر: ${fmtNumber(first.length)} حرف`),
    h("span", { class: "muted small" }, `قراءة: ${readingSeconds(d.text)} ثانية`),
  );
}

function checksList(d: Draft): HTMLElement {
  return h("ul", { class: "checks-list" }, postChecks(d).map((c) => h("li", { class: c.level }, h("span", { class: "check-dot", "aria-hidden": "true" }), c.text)));
}

type AiEdit = { text: string; hashtags?: string[]; note?: string; changes?: Partial<Draft> };

async function applyAi(ctx: Ctx, d: Draft, label: string, source: string, run: (cfg: AiConfig) => Promise<AiEdit>): Promise<void> {
  const result = await runAi(ctx, label, run);
  if (!result) return;
  updateDraft(ctx, d.id, (x) => ({ ...withVersion(x, result.text, source), ...result.changes, hashtags: x.hashtags.length > 0 ? x.hashtags : result.hashtags ?? x.hashtags }), false);
  ui.tags = (result.hashtags ?? []).filter((t) => !d.hashtags.includes(t));
  ui.note = result.note ?? "";
  ui.hooks = [];
  ui.review = null;
  ctx.store.emit();
}

function rewrite(ctx: Ctx, d: Draft, action: RewriteAction, label: string): void {
  if (!d.text.trim()) return ctx.toast("اكتب نص أول، أو استعمل \"اكتب بالذكاء الاصطناعي\".", "error");
  const s = ctx.store.state;
  void applyAi(ctx, d, label, `ai-${action}`, (cfg) => rewritePost(action, d.text, d.lang, s.profile, s.content.settings, s.content.strategy, cfg, ui.tone));
}

async function translateCopy(ctx: Ctx, d: Draft, open: (id: string) => void): Promise<void> {
  if (!d.text.trim()) return ctx.toast("ما في نص أترجمه.", "error");
  const s = ctx.store.state;
  const result = await runAi(ctx, "ترجمة المنشور…", (cfg) => rewritePost("translate", d.text, d.lang, s.profile, s.content.settings, s.content.strategy, cfg));
  if (!result) return;
  const lang: ContentLang = d.lang === "ar" ? "en" : "ar";
  const copy = addDraft(ctx, newDraft({ ...d, id: newId("d"), lang, text: result.text, title: `${d.title || "منشور"} (${LANG_LABEL[lang]})`, hashtags: result.hashtags.length ? result.hashtags : d.hashtags, versions: [], status: d.status === "published" ? "draft" : d.status, publishedAt: "", publishedUrl: "", createdAt: new Date().toISOString() }));
  ctx.toast(`انعملت نسخة ${LANG_LABEL[lang]} جديدة`);
  open(copy.id);
}

function writeBox(ctx: Ctx, d: Draft): HTMLElement {
  const topic = textInput(d.title, (v) => patch(ctx, d.id, { title: v }, false), { placeholder: "عن شو المنشور؟ مثال: أهم 3 دروس من أول سنة كـ Backend" });
  const details = textArea(ui.details, (v) => (ui.details = v), { rows: 3, placeholder: "تفاصيل حقيقية بدك تنذكر: أرقام، قصة، أداة، نتيجة… (الذكاء الاصطناعي ما رح يخترع إشي)" });
  const length = ui.length || defaultLength(d.format);
  const go = async (): Promise<void> => {
    const s = ctx.store.state;
    const brief = { topic: topic.value.trim() || d.title, hook: d.status === "idea" ? d.text : "", pillar: d.pillar, format: d.format, lang: d.lang, tone: ui.tone, length, details: details.value.trim() };
    if (!brief.topic && !brief.details && !d.text.trim()) return ctx.toast("اكتب عن شو المنشور أول.", "error");
    if (!brief.topic) brief.topic = d.text.slice(0, 300);
    ui.details = details.value;
    await applyAi(ctx, d, "كتابة المنشور…", "ai-write", async (cfg) => {
      const w = await writePost(brief, s.profile, s.content.posts, s.content.strategy, s.content.settings, cfg);
      const changes: Partial<Draft> = { title: d.title || w.title, imagePrompt: d.imagePrompt || w.imagePrompt, status: d.status === "idea" ? "draft" : d.status };
      if (d.format === "carousel" && w.slides.length > 0) changes.slides = w.slides;
      if (d.format === "poll" && w.pollQuestion) Object.assign(changes, { pollQuestion: w.pollQuestion, pollOptions: w.pollOptions });
      return { text: w.text, hashtags: w.hashtags, changes, note: d.text.trim() ? "انكتب المنشور من جديد." : "" };
    });
  };
  return h("div", { class: "write-box" },
    h("h3", { class: "with-icon" }, icon("spark"), "اكتب بالذكاء الاصطناعي"),
    field("الموضوع", topic),
    field("تفاصيل من عندك", details),
    h("div", { class: "form-grid narrow" },
      field("النبرة", select(Object.entries(TONE_LABEL) as Array<[string, string]>, ui.tone, (v) => (ui.tone = v as Tone))),
      field("الطول", select(Object.entries(LENGTH_LABEL) as Array<[string, string]>, length, (v) => (ui.length = v as Length))),
    ),
    h("button", { type: "button", onclick: () => void go() }, icon("spark"), d.text.trim() && d.status !== "idea" ? "اكتبه من جديد" : "اكتب المنشور"),
  );
}

function toolsBar(ctx: Ctx, d: Draft, open: (id: string) => void): HTMLElement {
  const s = ctx.store.state;
  const tool = (label: string, action: () => void, primary = false): HTMLElement => h("button", { type: "button", class: primary ? "small" : "secondary small", onclick: action }, label);
  const hooks = async (): Promise<void> => {
    if (!d.text.trim()) return ctx.toast("اكتب نص أول.", "error");
    const result = await runAi(ctx, "كتابة بدايات بديلة…", (cfg) => suggestHooks(d.text, d.lang, cfg));
    if (!result) return;
    ui.hooks = result;
    ctx.store.emit();
  };
  const review = async (): Promise<void> => {
    if (!d.text.trim()) return ctx.toast("اكتب نص أول.", "error");
    const result = await runAi(ctx, "تقييم المنشور…", (cfg) => reviewPost(publishText(d), s.profile, s.content.settings, s.content.strategy, cfg));
    if (!result) return;
    ui.review = result;
    ctx.store.emit();
  };
  const tone = select(Object.entries(TONE_LABEL) as Array<[string, string]>, ui.tone, (v) => (ui.tone = v as Tone), { "aria-label": "النبرة", class: "small-select" });
  return h("div", { class: "ai-tools" },
    h("div", { class: "tool-row" },
      tool("✨ حسّن المنشور", () => rewrite(ctx, d, "improve", "تحسين المنشور…"), true),
      tool("5 بدايات بديلة", () => void hooks()),
      tool("قيّم المنشور", () => void review()),
    ),
    h("div", { class: "tool-row" },
      tool("قصّر", () => rewrite(ctx, d, "shorten", "تقصير المنشور…")),
      tool("طوّل", () => rewrite(ctx, d, "lengthen", "تطويل المنشور…")),
      tool("دعوة للتفاعل", () => rewrite(ctx, d, "cta", "تحسين الخاتمة…")),
      tool("رتّب الشكل", () => rewrite(ctx, d, "format", "ترتيب الشكل…")),
      tool("إيموجي", () => rewrite(ctx, d, "emoji", "إضافة إيموجي…")),
      tool("تدقيق", () => rewrite(ctx, d, "proofread", "تدقيق إملائي…")),
      tool(d.lang === "ar" ? "نسخة English" : "نسخة عربي", () => void translateCopy(ctx, d, open)),
    ),
    h("div", { class: "tool-row" }, tone, tool("غيّر النبرة", () => rewrite(ctx, d, "tone", "تغيير النبرة…"))),
  );
}

function aiResults(ctx: Ctx, d: Draft): HTMLElement | null {
  const parts: HTMLElement[] = [];
  if (ui.note && d.versions.length > 0) {
    parts.push(h("div", { class: "advice row tight wrap" }, h("span", {}, ui.note), h("button", { type: "button", class: "link", onclick: () => restoreVersion(ctx, d, d.versions.length - 1) }, "تراجع")));
  }
  if (ui.hooks.length > 0) {
    parts.push(h("div", { class: "hooks" },
      h("div", { class: "card-head" }, h("h3", {}, "بدايات بديلة"), h("button", { type: "button", class: "link", onclick: () => { ui.hooks = []; ctx.store.emit(); } }, "سكّر")),
      h("ul", { class: "hook-list" }, ui.hooks.map((hk) => h("li", {},
        h("div", {}, h("span", { class: "badge" }, hk.technique || "بداية"), h("p", { dir: "auto" }, hk.text)),
        h("button", { type: "button", class: "secondary small", onclick: () => {
          updateDraft(ctx, d.id, (x) => withVersion(x, replaceHook(x.text, hk.text), "hook"));
        } }, "استعمل"),
      ))),
    ));
  }
  if (ui.review) {
    const r = ui.review;
    const meter = (label: string, v: number): HTMLElement => h("div", { class: "meter" }, h("span", { class: "meter-label" }, h("span", {}, label), h("span", {}, `${v}/10`)), h("span", { class: "bar-track" }, barFill(v / 10)));
    parts.push(h("div", { class: "review" },
      h("div", { class: "card-head" },
        h("h3", {}, "تقييم المنشور"),
        h("button", { type: "button", class: "link", onclick: () => { ui.review = null; ctx.store.emit(); } }, "سكّر"),
      ),
      h("div", { class: "review-top" }, h("strong", { class: r.score >= 75 ? "score good" : r.score >= 50 ? "score warn" : "score bad" }, String(r.score)), h("p", {}, r.verdict)),
      h("div", { class: "meters" }, meter("البداية", r.hook), meter("الوضوح", r.clarity), meter("القيمة", r.value), meter("دعوة للتفاعل", r.cta)),
      r.strengths.length ? h("div", {}, h("h3", {}, "نقاط القوة"), h("ul", { class: "notes" }, r.strengths.map((x) => h("li", {}, x)))) : null,
      r.fixes.length ? h("div", {}, h("h3", {}, "شو تحسّن"), h("ul", { class: "notes" }, r.fixes.map((x) => h("li", {}, x)))) : null,
      h("button", { type: "button", class: "secondary small", onclick: () => rewrite(ctx, d, "improve", "تحسين المنشور…") }, "طبّق التحسينات"),
    ));
  }
  return parts.length > 0 ? h("div", { class: "ai-results" }, parts) : null;
}

function restoreVersion(ctx: Ctx, d: Draft, index: number): void {
  const version = d.versions[index];
  if (!version) return;
  ui.note = "";
  updateDraft(ctx, d.id, (x) => restoreDraftVersion(x, index));
  ctx.toast("رجعت النسخة");
}

function hashtagEditor(ctx: Ctx, d: Draft): HTMLElement {
  const input = h("input", { type: "text", placeholder: "#هاشتاغ ثم Enter", "aria-label": "هاشتاغ جديد", dir: "auto" });
  const save = (tags: string[]): void => patch(ctx, d.id, { hashtags: [...new Set(tags.map(normalizeHashtag).filter(Boolean))].slice(0, 30) });
  const add = (): void => {
    const values = input.value.split(/[\s,،]+/).filter(Boolean);
    if (values.length > 0) save([...d.hashtags, ...values]);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== ",") return;
    e.preventDefault();
    add();
  });
  const brand = ctx.store.state.content.settings.hashtags.filter((t) => !d.hashtags.includes(t));
  const suggested = ui.tags.filter((t) => !d.hashtags.includes(t) && !brand.includes(t));
  const quick = (t: string): HTMLElement => h("button", { type: "button", class: "chip add", onclick: () => save([...d.hashtags, t]) }, "+ ", t);
  return h("div", { class: "panel-section" },
    h("h3", {}, `الهاشتاغات (${d.hashtags.length})`),
    h("div", { class: "tag-editor" },
      d.hashtags.map((t) => h("span", { class: "chip", dir: "auto" }, t, h("button", { type: "button", class: "chip-x", "aria-label": `شيل ${t}`, onclick: () => save(d.hashtags.filter((x) => x !== t)) }, icon("close")))),
      input,
      h("button", { type: "button", class: "link", onclick: add }, "إضافة"),
    ),
    brand.length || suggested.length ? h("div", { class: "chips" }, brand.map(quick), suggested.map(quick)) : null,
    h("p", { class: "hint" }, "بتنضاف بآخر المنشور لما تنسخه. 3 لـ 5 هاشتاغات كفاية."),
  );
}

function slidesEditor(ctx: Ctx, d: Draft): HTMLElement {
  const set = (slides: Slide[], emit = true): void => patch(ctx, d.id, { slides }, emit);
  const outline = async (): Promise<void> => {
    if (!d.text.trim()) return ctx.toast("اكتب نص المنشور أول.", "error");
    const slides = await runAi(ctx, "تجهيز الشرائح…", (cfg) => carouselOutline(d.text, d.lang, cfg));
    if (slides) set(slides);
  };
  const exportAs = async (kind: "pdf" | "zip"): Promise<void> => {
    const slides = d.slides.filter((x) => x.title || x.body);
    if (slides.length === 0) return ctx.toast("ما في شرائح.", "error");
    const author = ownerName(ctx, d.lang);
    const bytes = await ctx.busy("رسم الشرائح…", () => (kind === "pdf" ? slidesPdf(slides, d.lang, author) : slidesZip(slides, d.lang, author)));
    if (bytes) download(`carousel-${d.id}.${kind}`, bytes as Uint8Array<ArrayBuffer>, kind === "pdf" ? "application/pdf" : "application/zip");
  };
  return h("div", { class: "panel-section" },
    h("div", { class: "card-head" }, h("h3", {}, `شرائح الكاروسيل (${d.slides.length})`), h("button", { type: "button", class: "secondary small", onclick: () => void outline() }, icon("spark"), "اعملها من النص")),
    d.slides.length === 0 ? h("p", { class: "empty-line" }, "ما في شرائح لسا. خلّي الذكاء الاصطناعي يعملها من النص أو ضيفها بإيدك.") : h("ol", { class: "slides" }, d.slides.map((sl, i) => h("li", { class: "slide" },
      h("input", { type: "text", value: sl.title, placeholder: i === 0 ? "عنوان الغلاف" : "عنوان الشريحة", dir: "auto", "aria-label": `عنوان الشريحة ${i + 1}`, onchange: (e: Event) => set(d.slides.map((x, j) => (j === i ? { ...x, title: (e.target as HTMLInputElement).value } : x)), false) }),
      h("textarea", { rows: 2, placeholder: "النص", dir: "auto", "aria-label": `نص الشريحة ${i + 1}`, onchange: (e: Event) => set(d.slides.map((x, j) => (j === i ? { ...x, body: (e.target as HTMLTextAreaElement).value } : x)), false) }, sl.body),
      h("div", { class: "row tight" },
        h("button", { type: "button", class: "icon-btn", "aria-label": "لفوق", disabled: i === 0, onclick: () => set(d.slides.map((x, j) => (j === i - 1 ? d.slides[i]! : j === i ? d.slides[i - 1]! : x))) }, "↑"),
        h("button", { type: "button", class: "icon-btn", "aria-label": "لتحت", disabled: i === d.slides.length - 1, onclick: () => set(d.slides.map((x, j) => (j === i + 1 ? d.slides[i]! : j === i ? d.slides[i + 1]! : x))) }, "↓"),
        h("button", { type: "button", class: "icon-btn", "aria-label": "احذف الشريحة", onclick: () => set(d.slides.filter((_, j) => j !== i)) }, icon("trash")),
      ),
    ))),
    h("div", { class: "row" },
      h("button", { type: "button", class: "secondary small", disabled: d.slides.length >= 20, onclick: () => set([...d.slides, { title: "", body: "" }]) }, icon("plus"), "شريحة"),
      h("button", { type: "button", class: "small", disabled: d.slides.length === 0, onclick: () => void exportAs("pdf") }, icon("download"), "نزّل PDF للنشر"),
      h("button", { type: "button", class: "secondary small", disabled: d.slides.length === 0, onclick: () => void exportAs("zip") }, "نزّل كصور"),
    ),
    h("p", { class: "hint" }, "على LinkedIn: اختار \"Add a document\" وارفع ملف الـ PDF، أو ارفع الصور كمنشور متعدد الصور."),
  );
}

function pollEditor(ctx: Ctx, d: Draft): HTMLElement {
  const options = [...d.pollOptions, "", "", "", ""].slice(0, 4);
  return h("div", { class: "panel-section" },
    h("h3", {}, "الاستطلاع"),
    field("السؤال (140 حرف)", textInput(d.pollQuestion, (v) => patch(ctx, d.id, { pollQuestion: v.slice(0, 140) }), { maxlength: 140, dir: "auto" })),
    h("div", { class: "form-grid narrow" }, options.map((o, i) => field(`خيار ${i + 1}${i < 2 ? "" : " (اختياري)"}`, textInput(o, (v) => {
      const next = [...options];
      next[i] = v.slice(0, 30);
      patch(ctx, d.id, { pollOptions: next.filter((x) => x.trim()) });
    }, { maxlength: 30, dir: "auto" })))),
    h("p", { class: "hint" }, "LinkedIn ما بيسمح نعبّي الاستطلاع تلقائيًا، فانسخ السؤال والخيارات لما تنشر."),
  );
}

async function saveImage(ctx: Ctx, d: Draft, blob: Blob, meta: Omit<ImageMeta, "id" | "draftId" | "createdAt" | "width" | "height">): Promise<void> {
  const prepared = await prepareImage(blob);
  const id = newId("img");
  await storeImage(id, prepared.blob);
  ctx.store.update((s) => {
    s.content.images[id] = { ...meta, id, draftId: d.id, createdAt: new Date().toISOString(), width: prepared.width, height: prepared.height };
    s.content.drafts = s.content.drafts.map((x) => (x.id === d.id ? { ...x, imageId: id, format: x.format === "text" ? "image" : x.format, updatedAt: new Date().toISOString() } : x));
  }, { recompute: false });
}

function imageEditor(ctx: Ctx, d: Draft): HTMLElement {
  const settings = ctx.store.state.content.settings;
  const prompt = textArea(d.imagePrompt, (v) => patch(ctx, d.id, { imagePrompt: v }, false), { rows: 3, dir: "auto", placeholder: "وصف الصورة (بالإنجليزي أفضل). مثال: a calm developer desk at sunrise with abstract data streams" });
  const suggest = async (): Promise<void> => {
    if (!d.text.trim()) return ctx.toast("اكتب نص المنشور أول.", "error");
    const result = await runAi(ctx, "كتابة وصف للصورة…", (cfg) => imagePromptFor(d.text, ui.style, cfg));
    if (result) patch(ctx, d.id, { imagePrompt: result });
  };
  const generate = async (): Promise<void> => {
    const text = prompt.value.trim();
    if (!text) return ctx.toast("اكتب وصف للصورة أو اضغط \"اقترح وصف\".", "error");
    patch(ctx, d.id, { imagePrompt: text }, false);
    const full = `${text}\nStyle: ${ui.style}. No text, letters or logos. Professional, suitable for a LinkedIn post.`;
    const result = await runAi(ctx, "توليد الصورة… ممكن تاخذ دقيقة", async (cfg) => {
      const image = await generateImage(cfg, settings.imageModel, full, ui.size);
      await saveImage(ctx, d, base64Blob(image.b64, image.type), { prompt: text, model: image.model, source: "ai" });
      return image.model;
    });
    if (!result) return;
    if (result !== settings.imageModel) {
      ctx.store.update((s) => (s.content.settings.imageModel = result), { recompute: false });
      ctx.toast(`حسابك ما بيقدر يستخدم ${settings.imageModel}، فاستعملت ${result}.`);
    } else ctx.toast("الصورة جاهزة");
  };
  const upload = async (): Promise<void> => {
    const [file] = await pickFiles("image/png,image/jpeg,image/webp,image/gif");
    if (!file) return;
    await ctx.busy("تجهيز الصورة…", () => saveImage(ctx, d, file, { prompt: "", model: "", source: "upload" }));
  };
  const save = async (id: string): Promise<void> => {
    const blob = await imageBlob(id);
    if (blob) download(`linkedin-image-${id}.${imageExtension(blob.type)}`, blob, blob.type);
  };
  const discard = async (id: string): Promise<void> => {
    if (!window.confirm("رح تنحذف الصورة نهائيًا. أكيد؟")) return;
    await removeImage(id);
    ctx.store.update((s) => {
      delete s.content.images[id];
      s.content.drafts = s.content.drafts.map((x) => (x.imageId === id ? { ...x, imageId: "" } : x));
    }, { recompute: false });
  };
  const gallery = Object.values(ctx.store.state.content.images).filter((img) => img.draftId === d.id || img.id === d.imageId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sizes = h("div", { class: "segmented", role: "group", "aria-label": "شكل الصورة" }, (Object.entries(IMAGE_SIZE_LABEL) as Array<[ImageSize, string]>).map(([k, label]) =>
    h("button", { type: "button", "aria-pressed": String(ui.size === k), onclick: () => { ui.size = k; ctx.store.emit(); } }, label)));
  return h("div", { class: "panel-section" },
    h("h3", { class: "with-icon" }, icon("image"), "صورة المنشور"),
    d.imageId ? h("figure", { class: "current-image" },
      imageThumb(d.imageId, "image-large", "صورة المنشور"),
      h("figcaption", { class: "row tight wrap" },
        h("button", { type: "button", class: "secondary small", onclick: () => void save(d.imageId) }, icon("download"), "نزّل الصورة"),
        h("button", { type: "button", class: "link", onclick: () => patch(ctx, d.id, { imageId: "" }) }, "شيلها من المنشور"),
      ),
    ) : null,
    field("الوصف", prompt),
    h("div", { class: "form-grid narrow" },
      field("الستايل", select(IMAGE_STYLES, ui.style, (v) => (ui.style = v))),
      field("الموديل", select(IMAGE_MODELS.map((m): [string, string] => [m, m]), settings.imageModel, (v) => ctx.store.update((s) => (s.content.settings.imageModel = v), { recompute: false, emit: false }))),
    ),
    sizes,
    h("div", { class: "row" },
      h("button", { type: "button", onclick: () => void generate() }, icon("spark"), d.imageId ? "ولّد صورة ثانية" : "ولّد الصورة"),
      h("button", { type: "button", class: "secondary", onclick: () => void suggest() }, "اقترح وصف من المنشور"),
      h("button", { type: "button", class: "secondary", onclick: () => void upload() }, "ارفع صورة"),
    ),
    h("p", { class: "hint" }, "كل صورة بتكلف من رصيد OpenAI (تقريبًا 0.04$ لصورة متوسطة الجودة). الصور بتنضغط وبتنحفظ بمتصفحك وبملف الحفظ."),
    gallery.length > 1 ? h("div", {}, h("h3", {}, "كل صور هالمنشور"), h("ul", { class: "gallery" }, gallery.map((img) => h("li", { class: img.id === d.imageId ? "picked" : "" },
      h("button", { type: "button", class: "gallery-pick", "aria-label": "استعمل هاي الصورة", onclick: () => patch(ctx, d.id, { imageId: img.id }) }, imageThumb(img.id, "thumb")),
      h("button", { type: "button", class: "icon-btn", "aria-label": "احذف الصورة", onclick: () => void discard(img.id) }, icon("trash")),
    )))) : null,
  );
}

function versionsList(ctx: Ctx, d: Draft): HTMLElement {
  const snapshot = (): void => {
    updateDraft(ctx, d.id, (x) => ({ ...x, versions: [...x.versions, { at: new Date().toISOString(), text: x.text, source: "manual" }].slice(-MAX_VERSIONS) }));
    ctx.toast("انحفظت نسخة");
  };
  const SOURCE: Record<string, string> = { manual: "حفظ يدوي", restore: "قبل الاسترجاع", hook: "قبل تغيير البداية", "ai-write": "قبل الكتابة", "ai-improve": "قبل التحسين", "ai-shorten": "قبل التقصير", "ai-lengthen": "قبل التطويل", "ai-tone": "قبل تغيير النبرة", "ai-cta": "قبل الخاتمة", "ai-format": "قبل الترتيب", "ai-emoji": "قبل الإيموجي", "ai-proofread": "قبل التدقيق", "ai-repurpose": "قبل إعادة الكتابة" };
  return h("div", { class: "panel-section" },
    h("div", { class: "card-head" }, h("h3", {}, `النسخ السابقة (${d.versions.length})`), h("button", { type: "button", class: "secondary small", disabled: !d.text.trim(), onclick: snapshot }, "احفظ نسخة هلأ")),
    d.versions.length === 0 ? h("p", { class: "muted small" }, "كل ما الذكاء الاصطناعي يعدّل النص، النسخة القديمة بتنحفظ هون وبتقدر ترجعلها.") : h("ul", { class: "versions" }, [...d.versions].map((v, i) => ({ v, i })).reverse().map(({ v, i }) => h("li", {},
      h("details", {},
        h("summary", {}, `${v.at.slice(0, 16).replace("T", " ")} · ${SOURCE[v.source] ?? v.source} · ${fmtNumber(v.text.length)} حرف`),
        h("pre", { dir: "auto" }, v.text),
      ),
      h("button", { type: "button", class: "secondary small", onclick: () => restoreVersion(ctx, d, i) }, "رجّعها"),
    ))),
  );
}

function publishPanel(ctx: Ctx, d: Draft): HTMLElement {
  const text = publishText(d);
  const copy = async (): Promise<void> => {
    const ok = await copyText(text);
    ctx.toast(ok ? "انسخ النص. الصقه على LinkedIn" : "ما قدرت أنسخ. ظلّل النص وانسخه بإيدك", ok ? "ok" : "error");
  };
  const open = h("a", { class: "button", href: shareUrl(text), target: "_blank", rel: "noopener noreferrer" }, icon("external"), "انسخ وافتح LinkedIn");
  open.addEventListener("click", () => void copyText(text));
  const url = textInput(ui.publishUrl || d.publishedUrl, (v) => (ui.publishUrl = v), { type: "url", placeholder: "رابط المنشور بعد النشر (اختياري)", dir: "ltr" });
  const markPublished = (): void => {
    const link = url.value.trim();
    if (link && !/^https:\/\/(www\.)?linkedin\.com\//i.test(link)) return ctx.toast("الرابط لازم يكون من linkedin.com", "error");
    const at = new Date().toISOString();
    const post: Post = { id: manualPostId(d.id), at, text, url: link, sharedUrl: "", media: d.imageId || d.slides.length ? "local" : "", origin: "manual", metrics: null };
    ctx.store.update((s) => {
      s.content.drafts = s.content.drafts.map((x) => (x.id === d.id ? { ...x, status: "published", publishedAt: at, publishedUrl: link, updatedAt: at } : x));
      s.content.posts = [post, ...s.content.posts.filter((p) => p.id !== post.id)];
    }, { recompute: false });
    ui.publishUrl = "";
    ctx.toast("تمام! انضاف لمنشوراتك");
  };
  const unpublish = (): void => {
    ctx.store.update((s) => {
      s.content.drafts = s.content.drafts.map((x) => (x.id === d.id ? { ...x, status: "ready", publishedAt: "", publishedUrl: "" } : x));
      s.content.posts = s.content.posts.filter((p) => p.id !== manualPostId(d.id));
    }, { recompute: false });
  };
  const blocked = postChecks(d).some((c) => c.level === "bad");
  return h("section", { class: "card publish" },
    h("h2", { class: "with-icon" }, icon("send"), "النشر"),
    d.status === "published"
      ? h("div", { class: "panel-section" },
          h("p", {}, badge("منشور", "good"), " ", d.publishedAt.slice(0, 10)),
          d.publishedUrl ? h("a", { href: d.publishedUrl, target: "_blank", rel: "noopener noreferrer" }, "افتح المنشور على LinkedIn") : null,
          h("button", { type: "button", class: "link", onclick: unpublish }, "رجّعها مش منشورة"),
        )
      : h("div", { class: "panel-section" },
          h("ol", { class: "how" },
            h("li", {}, "اضغط \"انسخ وافتح LinkedIn\". النص بينسخ وبتفتح نافذة النشر."),
            d.imageId ? h("li", {}, "نزّل الصورة وضيفها للمنشور.") : d.format === "carousel" ? h("li", {}, "نزّل ملف الـ PDF وارفعه كـ Document.") : null,
            h("li", {}, "راجع وانشر بإيدك. إحنا ما بننشر إشي لحالنا."),
            h("li", {}, "ارجع هون وعلّمها منشورة."),
          ),
          h("div", { class: "row" },
            blocked ? h("button", { type: "button", disabled: true }, "صلّح المشاكل أول") : open,
            h("button", { type: "button", class: "secondary", disabled: !text, onclick: () => void copy() }, icon("copy"), "انسخ النص بس"),
          ),
          field("بعد ما تنشر", url),
          h("button", { type: "button", class: "secondary", disabled: !text, onclick: markPublished }, icon("check"), "علّمها منشورة"),
        ),
  );
}

export function renderEditor(ctx: Ctx, id: string, close: () => void, open: (id: string) => void): HTMLElement {
  const d = findDraft(ctx, id);
  if (!d) {
    close();
    return h("div");
  }
  if (ui.draftId !== id) Object.assign(ui, freshUi(id));
  const pillars = [...new Set([...ctx.store.state.content.settings.pillars, ...(ctx.store.state.content.strategy?.pillars.map((p) => p.name) ?? [])])];

  const area = h("textarea", { class: "post-text", rows: 14, dir: d.lang === "ar" ? "rtl" : "ltr", placeholder: d.lang === "ar" ? "اكتب منشورك هون… أول سطرين أهم إشي" : "Write your post here… the first two lines matter most", "aria-label": "نص المنشور" });
  area.value = d.text;
  area.addEventListener("input", () => {
    updateDraft(ctx, id, (x) => ({ ...x, text: area.value }), false);
    refreshLive(ctx, id);
  });
  area.addEventListener("change", () => ctx.store.emit());

  const langs = h("div", { class: "segmented", role: "group", "aria-label": "اللغة" }, (Object.entries(LANG_LABEL) as Array<[ContentLang, string]>).map(([k, label]) =>
    h("button", { type: "button", "aria-pressed": String(d.lang === k), onclick: () => patch(ctx, id, { lang: k }) }, label)));
  const remove = async (): Promise<void> => {
    if (!window.confirm("رح تنحذف المسودة وصورها. أكيد؟")) return;
    await deleteDraft(ctx, id);
    close();
  };
  const duplicate = (): void => {
    const copy = addDraft(ctx, newDraft({ ...d, id: newId("d"), title: `${d.title || "منشور"} (نسخة)`, versions: [], status: d.status === "published" ? "draft" : d.status, publishedAt: "", publishedUrl: "", createdAt: new Date().toISOString() }));
    open(copy.id);
  };
  const datalist = h("datalist", { id: "pillar-list" }, pillars.map((p) => h("option", { value: p })));

  previewHost = h("div", { class: "preview-host" }, previewCard(ctx, d));
  liveHost = h("div", { class: "live" }, liveStats(d), checksList(d));
  const views = h("div", { class: "segmented", role: "group", "aria-label": "حجم المعاينة" },
    h("button", { type: "button", "aria-pressed": String(ui.mobile), onclick: () => { ui.mobile = true; refreshLive(ctx, id); ctx.store.emit(); } }, "موبايل"),
    h("button", { type: "button", "aria-pressed": String(!ui.mobile), onclick: () => { ui.mobile = false; refreshLive(ctx, id); ctx.store.emit(); } }, "كمبيوتر"));

  return h("div", { class: "view editor" },
    h("div", { class: "editor-bar" },
      h("button", { type: "button", class: "secondary small", onclick: close }, icon("back"), "رجوع للوحة"),
      h("input", { type: "text", class: "title-input", value: d.title, placeholder: "عنوان داخلي للمسودة", "aria-label": "عنوان المسودة", dir: "auto", onchange: (e: Event) => patch(ctx, id, { title: (e.target as HTMLInputElement).value }) }),
      h("div", { class: "row tight" },
        h("button", { type: "button", class: "secondary small", onclick: duplicate }, icon("copy"), "نسخة"),
        h("button", { type: "button", class: "danger small", onclick: () => void remove() }, icon("trash"), "احذف"),
      ),
    ),
    h("div", { class: "editor-grid" },
      h("div", { class: "editor-main" },
        h("section", { class: "card" },
          h("div", { class: "meta-grid" },
            field("اللغة", langs),
            field("النوع", select(POST_FORMATS.map((f): [string, string] => [f, FORMAT_LABEL[f]]), d.format, (v) => patch(ctx, id, { format: v as Draft["format"] }))),
            field("المحور", h("input", { type: "text", list: "pillar-list", value: d.pillar, placeholder: "مثال: خبرات تقنية", onchange: (e: Event) => patch(ctx, id, { pillar: (e.target as HTMLInputElement).value.trim() }) })),
            field("الحالة", select(DRAFT_STATUSES.map((st): [string, string] => [st, STATUS_LABEL[st]]), d.status, (v) => patch(ctx, id, { status: v as Draft["status"] }))),
            field("موعد النشر", h("input", { type: "date", value: d.scheduledFor, onchange: (e: Event) => {
              const value = (e.target as HTMLInputElement).value;
              patch(ctx, id, { scheduledFor: value, status: value && (d.status === "ready" || d.status === "draft") && d.text.trim() ? "scheduled" : d.status });
            } })),
          ),
          datalist,
          area,
          liveHost,
          toolsBar(ctx, d, open),
          aiResults(ctx, d),
          d.text.trim() && d.status !== "idea" ? h("details", { class: "write-more" }, h("summary", {}, "اكتبه من جديد بالذكاء الاصطناعي"), writeBox(ctx, d)) : writeBox(ctx, d),
        ),
        h("section", { class: "card" }, hashtagEditor(ctx, d), d.format === "carousel" ? slidesEditor(ctx, d) : null, d.format === "poll" ? pollEditor(ctx, d) : null, imageEditor(ctx, d)),
        h("section", { class: "card" },
          h("div", { class: "panel-section" }, h("h3", {}, "ملاحظات"), textArea(d.notes, (v) => patch(ctx, id, { notes: v }, false), { rows: 3, placeholder: "أفكار، مصادر، لمين بدك تبعته بعد النشر…" })),
          versionsList(ctx, d),
        ),
      ),
      h("aside", { class: "editor-side" },
        h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "المعاينة"), views), previewHost),
        publishPanel(ctx, d),
      ),
    ),
  );
}
