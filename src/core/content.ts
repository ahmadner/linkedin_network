import { asNumber, asRecord, asString, asStringList } from "./profile";

export type PostOrigin = "export" | "manual";
export type DraftStatus = "idea" | "draft" | "ready" | "scheduled" | "published";
export type PostFormat = "text" | "image" | "carousel" | "poll" | "video" | "article";
export type ContentLang = "ar" | "en";

export const POST_LIMIT = 3000;
export const FOLD_AT = 210;
export const DRAFT_STATUSES: DraftStatus[] = ["idea", "draft", "ready", "scheduled", "published"];
export const POST_FORMATS: PostFormat[] = ["text", "image", "carousel", "poll", "video", "article"];

export const STATUS_LABEL: Record<DraftStatus, string> = { idea: "أفكار", draft: "مسودات", ready: "جاهزة", scheduled: "مجدولة", published: "منشورة" };
export const FORMAT_LABEL: Record<PostFormat, string> = { text: "نص", image: "صورة", carousel: "كاروسيل", poll: "استطلاع", video: "فيديو", article: "مقال" };
export const LANG_LABEL: Record<ContentLang, string> = { ar: "عربي", en: "English" };
export const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export interface PostMetrics {
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
}

export interface Post {
  id: string;
  at: string;
  text: string;
  url: string;
  sharedUrl: string;
  media: string;
  origin: PostOrigin;
  metrics: PostMetrics | null;
}

export interface DraftVersion {
  at: string;
  text: string;
  source: string;
}

export interface Slide {
  title: string;
  body: string;
}

export interface Draft {
  id: string;
  title: string;
  text: string;
  lang: ContentLang;
  format: PostFormat;
  pillar: string;
  status: DraftStatus;
  scheduledFor: string;
  hashtags: string[];
  imageId: string;
  imagePrompt: string;
  notes: string;
  slides: Slide[];
  pollQuestion: string;
  pollOptions: string[];
  versions: DraftVersion[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  publishedUrl: string;
}

export interface ContentIdea {
  title: string;
  hook: string;
  pillar: string;
  format: PostFormat;
  lang: ContentLang;
  why: string;
}

export interface ContentPillar {
  name: string;
  description: string;
  share: number;
}

export interface ContentStrategy {
  model: string;
  generatedAt: string;
  postsAnalyzed: number;
  summary: string;
  voice: string;
  audience: string;
  pillars: ContentPillar[];
  works: string[];
  improve: string[];
  cadence: string;
  bestDays: string[];
  ideas: ContentIdea[];
}

export interface ImageMeta {
  id: string;
  draftId: string;
  prompt: string;
  model: string;
  createdAt: string;
  width: number;
  height: number;
  source: "ai" | "upload";
}

export interface ContentSettings {
  postsPerWeek: number;
  defaultLang: ContentLang;
  pillars: string[];
  hashtags: string[];
  imageModel: string;
}

export interface ContentState {
  posts: Post[];
  drafts: Draft[];
  strategy: ContentStrategy | null;
  images: Record<string, ImageMeta>;
  settings: ContentSettings;
}

export const IMAGE_MODELS = ["gpt-image-1", "gpt-image-1-mini", "dall-e-3"];
export const MAX_VERSIONS = 30;

export function emptyContent(): ContentState {
  return {
    posts: [],
    drafts: [],
    strategy: null,
    images: {},
    settings: { postsPerWeek: 2, defaultLang: "ar", pillars: [], hashtags: [], imageModel: IMAGE_MODELS[0]! },
  };
}

export function newId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replace(/-/g, "").slice(0, 16)}`;
}

export function newDraft(patch: Partial<Draft> = {}, lang: ContentLang = "ar"): Draft {
  const now = new Date().toISOString();
  return {
    id: newId("d"),
    title: "",
    text: "",
    lang,
    format: "text",
    pillar: "",
    status: "draft",
    scheduledFor: "",
    hashtags: [],
    imageId: "",
    imagePrompt: "",
    notes: "",
    slides: [],
    pollQuestion: "",
    pollOptions: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
    publishedAt: "",
    publishedUrl: "",
    ...patch,
  };
}

export function withVersion(draft: Draft, text: string, source: string): Draft {
  if (text === draft.text) return draft;
  const versions = draft.text.trim() ? [...draft.versions, { at: new Date().toISOString(), text: draft.text, source }].slice(-MAX_VERSIONS) : draft.versions;
  return { ...draft, text, versions, updatedAt: new Date().toISOString() };
}

export function restoreDraftVersion(draft: Draft, index: number): Draft {
  const version = draft.versions[index];
  if (!version) return draft;
  const versions = draft.versions.filter((_, i) => i !== index);
  if (draft.text.trim() && draft.text !== version.text) versions.push({ at: new Date().toISOString(), text: draft.text, source: "restore" });
  return { ...draft, text: version.text, versions: versions.slice(-MAX_VERSIONS), updatedAt: new Date().toISOString() };
}

export function draftTitle(d: Pick<Draft, "title" | "text">): string {
  const title = d.title.trim() || d.text.trim().split("\n")[0]?.trim() || "";
  return title.length > 80 ? `${title.slice(0, 80)}…` : title || "بدون عنوان";
}

export function hasArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

export function hashtagsOf(text: string): string[] {
  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(tags.map((t) => t.toLowerCase()))];
}

export function normalizeHashtag(value: string): string {
  const clean = value.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return clean ? `#${clean}` : "";
}

export function withHashtags(text: string, tags: string[]): string {
  const present = new Set(hashtagsOf(text));
  const missing = tags.map(normalizeHashtag).filter((t) => t && !present.has(t.toLowerCase()));
  if (missing.length === 0) return text;
  return `${text.trimEnd()}\n\n${missing.join(" ")}`;
}

export function foldPreview(text: string): { visible: string; folded: boolean } {
  const lines = text.split("\n");
  let visible = lines.slice(0, 3).join("\n");
  if (visible.length > FOLD_AT) visible = visible.slice(0, FOLD_AT);
  return { visible: visible.trimEnd(), folded: visible.length < text.trimEnd().length };
}

export type CheckLevel = "good" | "warn" | "bad";

export interface PostCheck {
  level: CheckLevel;
  text: string;
}

const LINK = /https?:\/\/\S+/i;
const QUESTION = /[?؟]\s*$|[?؟]\s*\n/m;

export function postChecks(d: Pick<Draft, "text" | "hashtags" | "format" | "imageId" | "slides" | "pollQuestion" | "pollOptions">): PostCheck[] {
  const text = d.text.trim();
  if (!text) return [{ level: "bad", text: "المنشور فاضي." }];
  const out: PostCheck[] = [];
  const full = withHashtags(text, d.hashtags);
  const firstLine = text.split("\n")[0] ?? "";
  if (full.length > POST_LIMIT) out.push({ level: "bad", text: `أطول من حد LinkedIn بـ ${full.length - POST_LIMIT} حرف.` });
  else if (text.length < 150) out.push({ level: "warn", text: "قصير كثير. المنشورات اللي فيها فكرة واضحة وقيمة بتاخذ تفاعل أكثر." });
  else out.push({ level: "good", text: "الطول مناسب." });
  if (firstLine.length > FOLD_AT) out.push({ level: "warn", text: "أول سطر طويل. خلّي البداية جملة قصيرة وقوية قبل \"شوف المزيد\"." });
  else out.push({ level: "good", text: "البداية قصيرة وبتبين قبل \"شوف المزيد\"." });
  if (/[^\n]{400,}/.test(text)) out.push({ level: "warn", text: "في فقرة طويلة كثير. قسّمها لأسطر أقصر عشان تنقرأ عالموبايل." });
  const tags = hashtagsOf(full).length;
  if (tags === 0) out.push({ level: "warn", text: "ما في هاشتاغات. ضيف 3 لـ 5." });
  else if (tags > 5) out.push({ level: "warn", text: `في ${tags} هاشتاغ. 3 لـ 5 كفاية.` });
  else out.push({ level: "good", text: `${tags} هاشتاغ.` });
  if (LINK.test(text)) out.push({ level: "warn", text: "في رابط بالنص. LinkedIn بيقلل وصول المنشورات اللي فيها روابط، فكّر تحطه بأول تعليق." });
  if (!QUESTION.test(text.split("\n").slice(-3).join("\n"))) out.push({ level: "warn", text: "ما في سؤال أو دعوة للتفاعل بالآخر." });
  if (d.format === "image" && !d.imageId) out.push({ level: "warn", text: "النوع صورة بس ما في صورة لسا." });
  if (d.format === "carousel" && d.slides.length < 3) out.push({ level: "warn", text: "الكاروسيل بحاجة 3 شرائح على الأقل." });
  if (d.format === "poll" && (!d.pollQuestion.trim() || d.pollOptions.filter((o) => o.trim()).length < 2)) out.push({ level: "warn", text: "الاستطلاع بحاجة سؤال وخيارين على الأقل." });
  return out;
}

export function publishText(d: Pick<Draft, "text" | "hashtags">): string {
  return withHashtags(d.text.trim(), d.hashtags);
}

const SHARE_BASE = "https://www.linkedin.com/feed/?shareActive=true";
const MAX_SHARE_URL = 6000;

export function shareUrl(text: string): string {
  const url = `${SHARE_BASE}&text=${encodeURIComponent(text)}`;
  return url.length <= MAX_SHARE_URL ? url : SHARE_BASE;
}

export function readingSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 220) * 60));
}

export interface ContentStats {
  total: number;
  last90: number;
  perWeek90: number;
  daysSinceLast: number | null;
  avgLength: number;
  arabicShare: number;
  mediaShare: number;
  byMonth: Array<{ month: string; count: number }>;
  byWeekday: number[];
  topHashtags: Array<[string, number]>;
  topPosts: Post[];
}

function engagement(m: PostMetrics | null): number {
  return m ? m.reactions + m.comments * 3 + m.reposts * 4 : -1;
}

export function contentStats(posts: Post[], now = new Date()): ContentStats {
  const sorted = [...posts].filter((p) => p.at).sort((a, b) => b.at.localeCompare(a.at));
  const day = 86_400_000;
  const since90 = now.getTime() - 90 * day;
  const last90 = sorted.filter((p) => Date.parse(p.at) >= since90).length;
  const months = new Map<string, number>();
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const tags = new Map<string, number>();
  let length = 0;
  let arabic = 0;
  let media = 0;
  for (const p of sorted) {
    const date = new Date(p.at);
    months.set(p.at.slice(0, 7), (months.get(p.at.slice(0, 7)) ?? 0) + 1);
    if (!Number.isNaN(date.getTime())) weekdays[date.getUTCDay()]! += 1;
    for (const t of hashtagsOf(p.text)) tags.set(t, (tags.get(t) ?? 0) + 1);
    length += p.text.length;
    if (hasArabic(p.text)) arabic += 1;
    if (p.media) media += 1;
  }
  const n = sorted.length;
  const first = sorted[n - 1]?.at.slice(0, 7);
  const byMonth: Array<{ month: string; count: number }> = [];
  if (first) {
    const cursor = new Date(`${first}-01T00:00:00Z`);
    const end = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    while (byMonth.length < 240) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
      byMonth.push({ month: key, count: months.get(key) ?? 0 });
      if (key >= end) break;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const latest = sorted[0] ? Date.parse(sorted[0].at) : NaN;
  return {
    total: n,
    last90,
    perWeek90: Math.round((last90 / (90 / 7)) * 10) / 10,
    daysSinceLast: Number.isNaN(latest) ? null : Math.max(0, Math.floor((now.getTime() - latest) / day)),
    avgLength: n ? Math.round(length / n) : 0,
    arabicShare: n ? Math.round((arabic / n) * 100) : 0,
    mediaShare: n ? Math.round((media / n) * 100) : 0,
    byMonth,
    byWeekday: weekdays,
    topHashtags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    topPosts: sorted.filter((p) => p.metrics).sort((a, b) => engagement(b.metrics) - engagement(a.metrics)).slice(0, 5),
  };
}

export function safeUrl(value: string): string {
  const v = value.trim();
  return /^https:\/\/[^\s]+$/i.test(v) ? v : "";
}

export function postKey(url: string): string {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }
  return /urn:li:(?:share|ugcPost|activity):\d+/.exec(decoded)?.[0] ?? "";
}

function textKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();
}

export function mergeExportPosts(current: Post[], imported: Post[]): Post[] {
  const ids = new Set(imported.map((p) => p.id));
  const urls = new Set(imported.map((p) => postKey(p.url)).filter(Boolean));
  const texts = new Set(imported.map((p) => textKey(p.text)).filter(Boolean));
  const duplicate = (p: Post): boolean => ids.has(p.id) || (postKey(p.url) !== "" && urls.has(postKey(p.url))) || (textKey(p.text) !== "" && texts.has(textKey(p.text)));
  const kept = current.filter((p) => p.origin !== "export" && !duplicate(p));
  const metrics = new Map<string, PostMetrics>();
  for (const p of current) {
    if (!p.metrics) continue;
    for (const key of [p.id, postKey(p.url), textKey(p.text)]) if (key && !metrics.has(key)) metrics.set(key, p.metrics);
  }
  const known = (p: Post): PostMetrics | null => metrics.get(p.id) ?? metrics.get(postKey(p.url)) ?? metrics.get(textKey(p.text)) ?? null;
  return [...kept, ...imported.map((p) => ({ ...p, metrics: p.metrics ?? known(p) }))].sort((a, b) => b.at.localeCompare(a.at));
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);
const LANGS: ContentLang[] = ["ar", "en"];

function metrics(v: unknown): PostMetrics | null {
  const r = asRecord(v);
  if (!("impressions" in r) && !("reactions" in r) && !("comments" in r) && !("reposts" in r)) return null;
  const n = (k: string): number => Math.max(0, Math.round(asNumber(r[k], 0)));
  return { impressions: n("impressions"), reactions: n("reactions"), comments: n("comments"), reposts: n("reposts") };
}

export function sanitizePost(v: unknown): Post | null {
  const r = asRecord(v);
  const id = asString(r.id, 300);
  const text = asString(r.text, 6000);
  if (!id || (!text && !asString(r.url))) return null;
  return {
    id,
    at: asString(r.at, 40),
    text,
    url: safeUrl(asString(r.url, 500)),
    sharedUrl: safeUrl(asString(r.sharedUrl, 1000)),
    media: asString(r.media, 1000),
    origin: r.origin === "manual" ? "manual" : "export",
    metrics: metrics(r.metrics),
  };
}

function sanitizeDraft(v: unknown): Draft | null {
  const r = asRecord(v);
  const id = asString(r.id, 60);
  if (!id) return null;
  return newDraft({
    id,
    title: asString(r.title, 300),
    text: asString(r.text, 6000),
    lang: oneOf(r.lang, LANGS, "ar"),
    format: oneOf(r.format, POST_FORMATS, "text"),
    pillar: asString(r.pillar, 120),
    status: oneOf(r.status, DRAFT_STATUSES, "draft"),
    scheduledFor: asString(r.scheduledFor, 20),
    hashtags: asStringList(r.hashtags, 30).map(normalizeHashtag).filter(Boolean),
    imageId: asString(r.imageId, 60),
    imagePrompt: asString(r.imagePrompt, 2000),
    notes: asString(r.notes, 4000),
    slides: list(r.slides).slice(0, 20).map((s) => {
      const x = asRecord(s);
      return { title: asString(x.title, 200), body: asString(x.body, 1000) };
    }),
    pollQuestion: asString(r.pollQuestion, 140),
    pollOptions: asStringList(r.pollOptions, 4).map((o) => o.slice(0, 30)),
    versions: list(r.versions).slice(-MAX_VERSIONS).map((x) => {
      const ver = asRecord(x);
      return { at: asString(ver.at, 40), text: asString(ver.text, 6000), source: asString(ver.source, 80) };
    }).filter((ver) => ver.text),
    createdAt: asString(r.createdAt, 40),
    updatedAt: asString(r.updatedAt, 40),
    publishedAt: asString(r.publishedAt, 40),
    publishedUrl: safeUrl(asString(r.publishedUrl, 500)),
  });
}

export function sanitizeIdea(v: unknown): ContentIdea | null {
  const r = asRecord(v);
  const title = asString(r.title, 200).trim();
  if (!title) return null;
  return {
    title,
    hook: asString(r.hook, 400).trim(),
    pillar: asString(r.pillar, 120).trim(),
    format: oneOf(r.format, POST_FORMATS, "text"),
    lang: oneOf(r.lang, LANGS, "ar"),
    why: asString(r.why, 400).trim(),
  };
}

export function sanitizeStrategy(v: unknown): ContentStrategy | null {
  const r = asRecord(v);
  if (!r.generatedAt) return null;
  return {
    model: asString(r.model, 100),
    generatedAt: asString(r.generatedAt, 40),
    postsAnalyzed: Math.max(0, asNumber(r.postsAnalyzed, 0)),
    summary: asString(r.summary, 1500),
    voice: asString(r.voice, 800),
    audience: asString(r.audience, 800),
    pillars: list(r.pillars).slice(0, 8).map((x) => {
      const p = asRecord(x);
      return { name: asString(p.name, 120).trim(), description: asString(p.description, 400), share: Math.min(100, Math.max(0, Math.round(asNumber(p.share, 0)))) };
    }).filter((p) => p.name),
    works: asStringList(r.works, 10),
    improve: asStringList(r.improve, 10),
    cadence: asString(r.cadence, 400),
    bestDays: asStringList(r.bestDays, 7),
    ideas: list(r.ideas).slice(0, 30).map(sanitizeIdea).filter((i): i is ContentIdea => i !== null),
  };
}

function sanitizeImageMeta(v: unknown): ImageMeta | null {
  const r = asRecord(v);
  const id = asString(r.id, 60);
  if (!id) return null;
  return {
    id,
    draftId: asString(r.draftId, 60),
    prompt: asString(r.prompt, 2000),
    model: asString(r.model, 60),
    createdAt: asString(r.createdAt, 40),
    width: Math.max(0, asNumber(r.width, 0)),
    height: Math.max(0, asNumber(r.height, 0)),
    source: r.source === "upload" ? "upload" : "ai",
  };
}

export function sanitizeContent(v: unknown): ContentState {
  const r = asRecord(v);
  const base = emptyContent();
  const s = asRecord(r.settings);
  const images: Record<string, ImageMeta> = {};
  for (const x of Object.values(asRecord(r.images))) {
    const meta = sanitizeImageMeta(x);
    if (meta) images[meta.id] = meta;
  }
  return {
    posts: list(r.posts).map(sanitizePost).filter((p): p is Post => p !== null),
    drafts: list(r.drafts).map(sanitizeDraft).filter((d): d is Draft => d !== null),
    strategy: sanitizeStrategy(r.strategy),
    images,
    settings: {
      postsPerWeek: Math.min(14, Math.max(1, Math.round(asNumber(s.postsPerWeek, base.settings.postsPerWeek)))),
      defaultLang: oneOf(s.defaultLang, LANGS, "ar"),
      pillars: asStringList(s.pillars, 12),
      hashtags: asStringList(s.hashtags, 20).map(normalizeHashtag).filter(Boolean),
      imageModel: oneOf(s.imageModel, IMAGE_MODELS, IMAGE_MODELS[0]!),
    },
  };
}
