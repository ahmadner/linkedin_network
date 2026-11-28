import {
  carouselOutline, defaultLength, IMAGE_ASPECT_LABEL, IMAGE_MODEL_LABEL, IMAGE_QUALITY_LABEL, IMAGE_STYLES, imageCostHint, LENGTH_LABEL, replaceHook, reviewPost, rewritePost, suggestHooks, TONE_LABEL,
  type Length, type PostReview, type RewriteAction, type Tone,
} from "../../ai/content";
import {
  DRAFT_STATUSES, FORMAT_LABEL, foldPreview, IMAGE_ASPECTS, IMAGE_MODELS, IMAGE_QUALITIES, LANG_LABEL, MAX_IMAGE_COUNT, newDraft, newId, normalizeHashtag, POST_FORMATS, MAX_VERSIONS, POST_LIMIT, postChecks, publishText, readingSeconds, restoreDraftVersion, shareUrl, STATUS_LABEL, withVersion,
  type ContentLang, type ContentSettings, type Draft, type ImageAspect, type ImageQuality, type Post, type Slide,
} from "../../core/content";
import { imageBlob, imageExtension, imageUrl, removeImage } from "../../io/images";
import type { AiConfig } from "../../ai/openai";
import { barFill } from "../charts";
import { badge, runAi, type Ctx } from "../context";
import { confirmDialog } from "../confirm";
import { addDraft, designImage, findDraft, nextDates, saveImages, scheduleDraft, seriesLabel, updateDraft, writeDraft } from "../drafts";
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
  headline: string;
  publishUrl: string;
}

const ui: EditorUi = freshUi("");

function freshUi(draftId: string): EditorUi {
  return { draftId, expanded: false, mobile: true, hooks: [], review: null, note: "", tags: [], tone: "professional", length: "", details: "", headline: "", publishUrl: "" };
}

function patch(ctx: Ctx, id: string, changes: Partial<Draft>, emit = true): void {
  updateDraft(ctx, id, (d) => ({ ...d, ...changes }), emit);
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
    const subject = topic.value.trim() || d.title;
    if (!subject && !details.value.trim() && !d.text.trim()) return ctx.toast("اكتب عن شو المنشور أول.", "error");
    ui.details = details.value;
    const rewriting = Boolean(d.text.trim()) && d.status !== "idea";
    const result = await runAi(ctx, "كتابة المنشور…", (cfg) => writeDraft(ctx, cfg, d.id, { topic: subject, details: details.value, tone: ui.tone, length }));
    if (!result) return;
    Object.assign(ui, { note: rewriting ? "انكتب المنشور من جديد." : "", hooks: [], review: null, tags: [] });
    ctx.store.emit();
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

function setImageSetting<K extends keyof ContentSettings>(ctx: Ctx, key: K, value: ContentSettings[K], emit = true): void {
  ctx.store.update((s) => (s.content.settings[key] = value), { recompute: false, emit });
}

function imageEditor(ctx: Ctx, d: Draft): HTMLElement {
  const settings = ctx.store.state.content.settings;
  const prompt = textArea(d.imagePrompt, (v) => patch(ctx, d.id, { imagePrompt: v }, false), { rows: 5, dir: "ltr", placeholder: "Describe the image in English: subject, composition, light, colors, mood…" });
  const overlay = textInput(d.imageText, (v) => patch(ctx, d.id, { imageText: v.slice(0, 120) }, false), { maxlength: 120, dir: "auto", placeholder: "اتركه فاضي لصورة بدون كتابة" });
  const run = async (fromPrompt: boolean): Promise<void> => {
    if (!d.text.trim() && !d.title.trim()) return ctx.toast("اكتب نص المنشور أول، عشان الصورة تطلع عنه.", "error");
    const custom = prompt.value.trim();
    if (fromPrompt && !custom) return ctx.toast("اكتب وصف للصورة أول.", "error");
    patch(ctx, d.id, { imagePrompt: custom, imageText: overlay.value.trim().slice(0, 120) }, false);
    const result = await runAi(ctx, "تصميم الصورة بالذكاء الاصطناعي…", (cfg, progress) => designImage(ctx, cfg, d.id, { prompt: fromPrompt ? custom : "" }, progress));
    if (!result) return;
    ui.headline = result.headline;
    ctx.store.emit();
    if (result.model !== result.wanted) ctx.toast(`حسابك ما بيقدر يستخدم ${result.wanted} (ممكن بدّه توثيق للمنظمة)، فاستعملت ${result.model}.`);
    else ctx.toast(result.ids.length > 1 ? `جهزت ${fmtNumber(result.ids.length)} نسخ. اختار اللي بتعجبك من تحت.` : "الصورة جاهزة");
  };
  const upload = async (): Promise<void> => {
    const [file] = await pickFiles("image/png,image/jpeg,image/webp,image/gif");
    if (!file) return;
    await ctx.busy("تجهيز الصورة…", () => saveImages(ctx, d.id, [file], { prompt: "", model: "", source: "upload" }));
    ctx.store.emit();
  };
  const save = async (id: string): Promise<void> => {
    const blob = await imageBlob(id);
    if (blob) download(`linkedin-image-${id}.${imageExtension(blob.type)}`, blob, blob.type);
  };
  const discard = async (id: string): Promise<void> => {
    if (!(await confirmDialog({ title: "نحذف هالصورة؟", message: "رح تنحذف نهائيًا من هاد المتصفح.", confirm: "احذف الصورة", danger: true }))) return;
    await removeImage(id);
    ctx.store.update((s) => {
      delete s.content.images[id];
      s.content.drafts = s.content.drafts.map((x) => (x.imageId === id ? { ...x, imageId: "" } : x));
    }, { recompute: false });
  };
  const gallery = Object.values(ctx.store.state.content.images).filter((img) => img.draftId === d.id || img.id === d.imageId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const styles = h("div", { class: "presets style-presets", role: "group", "aria-label": "ستايل الصورة" }, Object.entries(IMAGE_STYLES).map(([key, st]) =>
    h("button", { type: "button", "aria-pressed": String(settings.imageStyle === key), onclick: () => setImageSetting(ctx, "imageStyle", key) }, st.label)));
  const aspects = h("div", { class: "presets style-presets", role: "group", "aria-label": "شكل الصورة" }, IMAGE_ASPECTS.map((k) =>
    h("button", { type: "button", "aria-pressed": String(settings.imageAspect === k), onclick: () => setImageSetting(ctx, "imageAspect", k as ImageAspect) }, IMAGE_ASPECT_LABEL[k])));
  const counts = select(Array.from({ length: MAX_IMAGE_COUNT }, (_, i): [string, string] => [String(i + 1), i === 0 ? "نسخة وحدة" : `${i + 1} نسخ`]), String(settings.imageCount), (v) => setImageSetting(ctx, "imageCount", Number(v)));
  const quality = select(IMAGE_QUALITIES.map((q): [string, string] => [q, IMAGE_QUALITY_LABEL[q]]), settings.imageQuality, (v) => setImageSetting(ctx, "imageQuality", v as ImageQuality));
  const model = select(IMAGE_MODELS.map((m): [string, string] => [m, IMAGE_MODEL_LABEL[m] ?? m]), settings.imageModel, (v) => setImageSetting(ctx, "imageModel", v, false));
  const cost = imageCostHint(settings.imageModel, settings.imageQuality, settings.imageCount);
  const view = h("div", { class: "image-view" },
    d.imageId ? h("figure", { class: "current-image" },
      imageThumb(d.imageId, "image-large", "صورة المنشور"),
      h("figcaption", { class: "row tight wrap" },
        h("button", { type: "button", class: "secondary small", onclick: () => void save(d.imageId) }, icon("download"), "نزّل الصورة"),
        h("button", { type: "button", class: "link", onclick: () => patch(ctx, d.id, { imageId: "" }) }, "شيلها من المنشور"),
      ),
    ) : h("div", { class: "image-empty" }, icon("image"), h("span", {}, "الصورة رح تبين هون"), h("span", { class: "muted small" }, "اختار الستايل والمقاس واضغط \"صمّم الصورة\"")),
    gallery.length > 1 ? h("div", {}, h("h3", {}, `اختار النسخة (${fmtNumber(gallery.length)})`), h("ul", { class: "gallery" }, gallery.map((img) => h("li", { class: img.id === d.imageId ? "picked" : "" },
      h("button", { type: "button", class: "gallery-pick", "aria-label": "استعمل هاي الصورة", "aria-pressed": String(img.id === d.imageId), onclick: () => patch(ctx, d.id, { imageId: img.id }) }, imageThumb(img.id, "thumb")),
      h("button", { type: "button", class: "icon-btn", "aria-label": "احذف الصورة", onclick: () => void discard(img.id) }, icon("trash")),
    )))) : null,
  );
  const options = h("div", { class: "image-options" },
    h("div", { class: "field" }, h("span", { class: "field-label" }, "الستايل"), styles),
    h("div", { class: "field" }, h("span", { class: "field-label" }, "المقاس"), aspects),
    field("كتابة على الصورة (اختياري)", overlay, "الذكاء الاصطناعي بيكتبها بالضبط. الإنجليزي بيطلع أدق من العربي."),
    ui.headline && ui.headline !== d.imageText ? h("div", { class: "chips" }, h("span", { class: "muted small" }, "اقتراح:"), h("button", { type: "button", class: "chip add", dir: "auto", onclick: () => patch(ctx, d.id, { imageText: ui.headline }) }, "+ ", ui.headline)) : null,
    h("div", { class: "form-grid narrow" }, field("عدد النسخ", counts), field("الجودة", quality)),
    field("الموديل", model),
    h("div", { class: "row" },
      h("button", { type: "button", onclick: () => void run(false) }, icon("spark"), d.imageId ? "صمّم صورة جديدة" : "صمّم الصورة"),
      h("button", { type: "button", class: "secondary", onclick: () => void upload() }, "ارفع صورة"),
    ),
    h("p", { class: "hint" }, `تقريبًا ${cost}$ من رصيد OpenAI. الذكاء الاصطناعي بيقرأ المنشور، بيكتب توجيه فني، وبعدين بيرسم.`),
    h("details", { class: "write-more" },
      h("summary", {}, "وصف الصورة (متقدم)"),
      field("الوصف اللي انرسمت فيه آخر صورة. عدّله وولّد من جديد.", prompt),
      h("button", { type: "button", class: "secondary small", onclick: () => void run(true) }, "ولّد من هالوصف"),
    ),
  );
  return h("div", { class: "panel-section" },
    h("h2", { class: "with-icon" }, icon("image"), "صورة المنشور"),
    h("div", { class: "image-layout" }, view, options),
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
  return h("section", { class: "card publish", id: "ed-publish" },
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
    if (!(await confirmDialog({ title: "نحذف هالمسودة؟", message: "رح تنحذف المسودة وكل صورها نهائيًا.", confirm: "احذف المسودة", danger: true }))) return;
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

  const jump = (target: string): void => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const sections: Array<[string, string]> = [["ed-text", "النص"], ["ed-tags", d.format === "carousel" ? "الشرائح" : d.format === "poll" ? "الاستطلاع" : "الهاشتاغات"], ["ed-image", "الصورة"], ["ed-preview", "المعاينة"], ["ed-publish", "النشر"], ["ed-notes", "الملاحظات"]];
  const checks = postChecks(d);
  const blockedNow = checks.some((c) => c.level === "bad");
  return h("div", { class: "view editor" },
    h("div", { class: "editor-bar" },
      h("button", { type: "button", class: "secondary small", onclick: close }, icon("back"), "رجوع للوحة"),
      d.seriesId && seriesLabel(ctx, d) ? badge(`سلسلة: ${seriesLabel(ctx, d)}`, "series") : null,
      badge(STATUS_LABEL[d.status], d.status === "published" ? "good" : d.status === "scheduled" || d.status === "ready" ? "series" : ""),
      h("input", { type: "text", class: "title-input", value: d.title, placeholder: "عنوان داخلي للمسودة", "aria-label": "عنوان المسودة", dir: "auto", onchange: (e: Event) => patch(ctx, id, { title: (e.target as HTMLInputElement).value }) }),
      h("div", { class: "row tight" },
        h("button", { type: "button", class: "secondary small", onclick: duplicate }, icon("copy"), "نسخة"),
        h("button", { type: "button", class: "danger small", onclick: () => void remove() }, icon("trash"), "احذف"),
      ),
    ),
    h("nav", { class: "presets editor-nav", "aria-label": "أقسام المسودة" }, sections.map(([target, label]) => h("button", { type: "button", onclick: () => jump(target) }, label))),
    h("div", { class: "editor-grid" },
      h("div", { class: "editor-main" },
        h("section", { class: "card", id: "ed-text" },
          h("div", { class: "meta-grid" },
            field("اللغة", langs),
            field("النوع", select(POST_FORMATS.map((f): [string, string] => [f, FORMAT_LABEL[f]]), d.format, (v) => patch(ctx, id, { format: v as Draft["format"] }))),
            field("المحور", h("input", { type: "text", list: "pillar-list", value: d.pillar, placeholder: "مثال: خبرات تقنية", onchange: (e: Event) => patch(ctx, id, { pillar: (e.target as HTMLInputElement).value.trim() }) })),
            field("الحالة", select(DRAFT_STATUSES.map((st): [string, string] => [st, STATUS_LABEL[st]]), d.status, (v) => patch(ctx, id, { status: v as Draft["status"] }))),
            field("موعد النشر", h("div", { class: "date-pick" },
              h("input", { type: "date", value: d.scheduledFor, "aria-label": "موعد النشر", onchange: (e: Event) => {
                const value = (e.target as HTMLInputElement).value;
                patch(ctx, id, { scheduledFor: value, status: value && (d.status === "ready" || d.status === "draft") && d.text.trim() ? "scheduled" : d.status });
              } }),
              d.status !== "published" ? h("button", { type: "button", class: "link", onclick: () => {
                const [date] = nextDates(ctx, 1);
                if (!date) return ctx.toast("ما لقيت يوم فاضي.", "error");
                scheduleDraft(ctx, id, date);
                ctx.store.emit();
                ctx.toast(`انجدول ${date}`);
              } }, "أقرب يوم مناسب") : null,
            )),
          ),
          datalist,
          area,
          liveHost,
          toolsBar(ctx, d, open),
          aiResults(ctx, d),
          d.text.trim() && d.status !== "idea" ? h("details", { class: "write-more" }, h("summary", {}, "اكتبه من جديد بالذكاء الاصطناعي"), writeBox(ctx, d)) : writeBox(ctx, d),
        ),
        h("section", { class: "card", id: "ed-tags" }, hashtagEditor(ctx, d), d.format === "carousel" ? slidesEditor(ctx, d) : null, d.format === "poll" ? pollEditor(ctx, d) : null),
        h("section", { class: "card", id: "ed-image" }, imageEditor(ctx, d)),
        h("section", { class: "card", id: "ed-notes" },
          h("div", { class: "panel-section" }, h("h3", {}, "ملاحظات"), textArea(d.notes, (v) => patch(ctx, id, { notes: v }, false), { rows: 3, placeholder: "أفكار، مصادر، لمين بدك تبعته بعد النشر…" })),
          versionsList(ctx, d),
        ),
      ),
      h("aside", { class: "editor-side" },
        h("section", { class: "card", id: "ed-preview" }, h("div", { class: "card-head" }, h("h2", {}, "المعاينة"), views), previewHost),
        publishPanel(ctx, d),
      ),
    ),
    d.status !== "published" ? h("div", { class: "editor-dock" },
      h("button", { type: "button", class: "secondary small", onclick: () => jump("ed-preview") }, "المعاينة"),
      h("button", { type: "button", class: "small", disabled: blockedNow, onclick: () => jump("ed-publish") }, icon("send"), blockedNow ? "صلّح المشاكل أول" : "جاهز؟ انشره"),
    ) : null,
  );
}
