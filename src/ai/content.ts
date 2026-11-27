import {
  contentStats, hashtagsOf, MAX_IMAGE_COUNT, MAX_SERIES_PARTS, normalizeHashtag, POST_LIMIT, sanitizeIdea, sanitizeSeriesPart, sanitizeStrategy, WEEKDAYS_AR,
  type ContentIdea, type ContentLang, type ContentSeries, type ContentSettings, type ContentStrategy, type ImageAspect, type ImageQuality, type Post, type PostFormat, type SeriesPart,
} from "../core/content";
import { asNumber, asRecord, asString, asStringList } from "../core/profile";
import type { Profile } from "../core/types";
import { myFacts, NAME_RULE } from "./features";
import { chatJson, isModelAccessError, OpenAiError, postJson, type AiConfig } from "./openai";

export type Tone = "professional" | "friendly" | "story" | "bold" | "educational" | "humble";
export type Length = "short" | "medium" | "long";
export type RewriteAction = "improve" | "shorten" | "lengthen" | "tone" | "translate" | "cta" | "proofread" | "emoji" | "format" | "repurpose";

export const TONE_LABEL: Record<Tone, string> = { professional: "مهني", friendly: "ودّي", story: "قصة", bold: "جريء", educational: "تعليمي", humble: "متواضع" };
export const LENGTH_LABEL: Record<Length, string> = { short: "قصير", medium: "متوسط", long: "طويل" };
export const IMAGE_ASPECT_LABEL: Record<ImageAspect, string> = { portrait: "طولي 4:5 (الأفضل للموبايل)", square: "مربع 1:1", landscape: "عرضي 1.91:1" };
export const IMAGE_QUALITY_LABEL: Record<ImageQuality, string> = { low: "سريعة ورخيصة", medium: "متوازنة", high: "أعلى دقة" };

export interface ImageStyle {
  label: string;
  direction: string;
}

export const IMAGE_STYLES: Record<string, ImageStyle> = {
  editorial: { label: "صورة مهنية", direction: "premium editorial photograph, real-world setting, natural window light, 35mm lens, shallow depth of field, authentic and candid, subtle color grading" },
  minimal: { label: "بسيط ونظيف", direction: "minimalist composition, one strong focal subject, generous negative space, soft neutral background, refined muted palette, calm and premium" },
  infographic: { label: "إنفوغرافيك", direction: "clean modern infographic layout, clear visual hierarchy, simple icons and shapes, aligned grid, flat vector style, crisp edges, high legibility" },
  illustration: { label: "رسم حديث", direction: "modern flat vector illustration, friendly characters without real identities, soft gradients, bold simple shapes, contemporary tech-startup style" },
  render3d: { label: "ثلاثي الأبعاد", direction: "polished 3D render, soft studio lighting, smooth matte materials, gentle shadows, clay-like modern look, isometric camera" },
  conceptual: { label: "مفهوم ذكي", direction: "clever conceptual visual metaphor that tells the idea at a glance, surreal but clean, single striking object, studio backdrop, high-end ad campaign look" },
  tech: { label: "تقني", direction: "sleek technical visualization, abstract architecture diagrams and data flows, glowing lines on a dark background, precise geometry, futuristic but professional" },
  brand: { label: "ألوان البراند", direction: "bold graphic poster design, strong geometric layout, flat color blocks using only the brand palette, modern Swiss design influence" },
};

export const DEFAULT_IMAGE_STYLE = "editorial";

export const IMAGE_MODEL_LABEL: Record<string, string> = {
  "gpt-image-2": "GPT Image 2 (الأفضل بشكل عام)",
  "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst (أدق تفاصيل، أبطأ)",
  "gpt-image-2.5-flare": "GPT Image 2.5 Flare (أسرع)",
  "gpt-image-1.5": "GPT Image 1.5",
  "gpt-image-1-mini": "GPT Image 1 mini (أرخص)",
};

const QUALITY_COST: Record<ImageQuality, number> = { low: 0.015, medium: 0.05, high: 0.17 };

export function imageCostHint(model: string, quality: ImageQuality, count: number): number {
  const factor = model.includes("mini") ? 0.3 : model.includes("sunburst") ? 1.4 : 1;
  return Math.round(QUALITY_COST[quality] * factor * Math.max(1, count) * 100) / 100;
}

export function imageStyle(key: string): ImageStyle {
  return IMAGE_STYLES[key] ?? IMAGE_STYLES[DEFAULT_IMAGE_STYLE]!;
}

const LENGTH_CHARS: Record<Length, string> = { short: "400 to 700 characters", medium: "800 to 1300 characters", long: "1400 to 2200 characters" };
const LENGTH_FOR_FORMAT: Record<PostFormat, Length> = { text: "medium", image: "short", carousel: "short", poll: "short", video: "short", article: "long" };

const LANGUAGE_RULE = "Arabic text must be natural, clear Arabic the way Jordanian professionals write on LinkedIn (light Levantine flavor, never stiff MSA, never a literal translation of English). English text must be natural, plain professional English.";
const FACTS_RULE = "Use only facts given in the input about the user. Never invent numbers, employers, clients, awards, results or stories. When a concrete detail would help but is not given, write a short placeholder in square brackets such as [رقم] or [example] so the user can fill it in.";
const STYLE_RULE = [
  "LinkedIn post craft: the first two lines are the hook and must make people tap 'see more' (about 210 characters show before the fold).",
  "Use short paragraphs and white space, one idea per line where it helps, no walls of text.",
  "Give real value: a lesson, a story, a how-to, a strong opinion or a useful list. Avoid clichés like 'I am thrilled to announce' and avoid engagement bait.",
  "End with a natural call to action or question when it fits.",
  "Put 3 to 5 relevant hashtags only in the hashtags field, never inside the text.",
  "Emojis are optional and few.",
].join(" ");

function profileBlock(profile: Profile, settings: ContentSettings, strategy: ContentStrategy | null): Record<string, unknown> {
  return {
    me: myFacts(profile),
    target_companies: profile.targeting.target_companies.slice(0, 15),
    target_industries: profile.targeting.target_industries.slice(0, 10),
    content_pillars: settings.pillars.length ? settings.pillars : strategy?.pillars.map((p) => p.name) ?? [],
    brand_hashtags: settings.hashtags,
    voice: strategy?.voice ?? "",
    audience: strategy?.audience ?? "",
  };
}

function excerpt(posts: Post[], count: number, chars: number): Array<Record<string, unknown>> {
  return posts.slice(0, count).map((p) => ({
    date: p.at.slice(0, 10),
    text: p.text.slice(0, chars),
    has_media: Boolean(p.media),
    shared_link: Boolean(p.sharedUrl),
    ...(p.metrics ? { impressions: p.metrics.impressions, reactions: p.metrics.reactions, comments: p.metrics.comments, reposts: p.metrics.reposts } : {}),
  }));
}

function cleanText(value: unknown): string {
  return asString(value, POST_LIMIT + 1000).replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanTags(value: unknown, text: string): string[] {
  const seen = new Set(hashtagsOf(text));
  const out: string[] = [];
  for (const tag of asStringList(value, 10).map(normalizeHashtag)) {
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, 6);
}

const STRATEGY_SYSTEM = [
  NAME_RULE,
  "You are a senior LinkedIn content strategist. You get the user's profile, their goals, simple statistics and a sample of their past posts (newest first, some with engagement numbers).",
  "Study what they write about, how they write, what gets the most engagement, and what is missing compared with their goals and target audience.",
  "If there are no past posts, build a starter strategy from the profile and goals.",
  "Write every text field in natural Arabic the way Jordanian professionals write (light Levantine flavor), except post hooks, which follow the idea's lang.",
  FACTS_RULE,
  "Return a JSON object with these keys:",
  "summary (3-4 sentences on their content today),",
  "voice (how they sound and how they should sound),",
  "audience (who they should write for, tied to their goals),",
  "pillars (3 to 5 objects with name, description, share as the suggested percent of posts; shares add up to 100),",
  "works (up to 5 short points on what works in their posts, based on evidence),",
  "improve (up to 5 short, specific improvements),",
  "cadence (a realistic posting rhythm),",
  "best_days (2 or 3 weekday names in Arabic),",
  "ideas (10 post ideas, each with title, hook (the actual first line of the post), pillar, format (one of text, image, carousel, poll, video, article), lang (ar or en, mixing both the way their audience needs), why (one short sentence)).",
].join(" ");

export async function analyzeContent(profile: Profile, posts: Post[], settings: ContentSettings, cfg: AiConfig): Promise<ContentStrategy> {
  const stats = contentStats(posts);
  const withMetrics = posts.filter((p) => p.metrics);
  const sample = [...withMetrics.slice(0, 20), ...posts.filter((p) => !p.metrics).slice(0, 60 - Math.min(20, withMetrics.length))];
  const input = {
    profile: profileBlock(profile, settings, null),
    stats: {
      total_posts: stats.total,
      posts_last_90_days: stats.last90,
      posts_per_week_last_90_days: stats.perWeek90,
      days_since_last_post: stats.daysSinceLast,
      average_length_chars: stats.avgLength,
      arabic_share_percent: stats.arabicShare,
      media_share_percent: stats.mediaShare,
      posts_by_weekday: Object.fromEntries(WEEKDAYS_AR.map((d, i) => [d, stats.byWeekday[i] ?? 0])),
      top_hashtags: stats.topHashtags.slice(0, 10).map(([t, n]) => `${t} (${n})`),
    },
    wanted_posts_per_week: settings.postsPerWeek,
    past_posts: excerpt(sample.sort((a, b) => b.at.localeCompare(a.at)), 60, 700),
  };
  const { data, model } = await chatJson(cfg, STRATEGY_SYSTEM, JSON.stringify(input));
  const raw = asRecord(data);
  const strategy = sanitizeStrategy({ ...raw, bestDays: raw.best_days, model, generatedAt: new Date().toISOString(), postsAnalyzed: input.past_posts.length });
  if (!strategy || (!strategy.summary && strategy.ideas.length === 0)) throw new Error("The model returned an empty strategy");
  return strategy;
}

const IDEAS_SYSTEM = [
  NAME_RULE,
  "You are a LinkedIn content strategist. Suggest fresh post ideas for the user in the input.",
  "Ideas must fit their pillars, goals and audience, must not repeat the topics of their recent posts or the existing ideas, and must be specific (not generic advice).",
  "Mix formats and the languages their audience needs. If a focus is given, all ideas must serve it.",
  "If recent_posts is empty, the user is starting from scratch: build the ideas from their profile (role, skills, experience, projects, education, goals and target audience). Include a short introduction post, posts that show their expertise with concrete examples, lessons learned, a story from their path and a clear opinion on their field. Order the ideas so the first ones are the easiest strong first posts.",
  "Write title and why in natural Jordanian-flavored Arabic. Write hook (the actual first line of the post) in the idea's lang.",
  FACTS_RULE,
  "Return a JSON object with key ideas: an array of objects with title, hook, pillar, format (text, image, carousel, poll, video or article), lang (ar or en), why.",
].join(" ");

export async function suggestIdeas(profile: Profile, posts: Post[], strategy: ContentStrategy | null, settings: ContentSettings, existing: string[], focus: string, count: number, cfg: AiConfig): Promise<ContentIdea[]> {
  const input = {
    profile: profileBlock(profile, settings, strategy),
    strategy_summary: strategy?.summary ?? "",
    what_works: strategy?.works ?? [],
    recent_posts: excerpt(posts, 15, 300),
    existing_ideas: existing.slice(0, 60),
    focus,
    count,
  };
  const { data } = await chatJson(cfg, IDEAS_SYSTEM, JSON.stringify(input));
  const ideas = (Array.isArray(asRecord(data).ideas) ? (asRecord(data).ideas as unknown[]) : []).map(sanitizeIdea).filter((i): i is ContentIdea => i !== null);
  if (ideas.length === 0) throw new Error("The model returned no ideas");
  return ideas.slice(0, count);
}

export interface PostBrief {
  topic: string;
  hook: string;
  pillar: string;
  format: PostFormat;
  lang: ContentLang;
  tone: Tone;
  length: Length;
  details: string;
  series?: SeriesContext;
}

export interface SeriesContext {
  name: string;
  theme: string;
  arc: string;
  index: number;
  total: number;
  angle: string;
  previous: Array<{ title: string; text: string }>;
  next: string;
}

export interface WrittenPost {
  title: string;
  text: string;
  hashtags: string[];
  slides: Array<{ title: string; body: string }>;
  pollQuestion: string;
  pollOptions: string[];
}

const WRITE_SYSTEM = [
  NAME_RULE,
  "You are a ghostwriter for the user's LinkedIn posts. Write one complete post from the brief in the input, in the brief's lang, in the user's own voice (first person).",
  LANGUAGE_RULE,
  STYLE_RULE,
  FACTS_RULE,
  "Learn the user's voice from their recent posts when given, but make this post better than them.",
  "If brief.series is given, this post is one part of a connected series: say naturally which part it is (for example 'الجزء 2 من سلسلة …' or 'Part 2 of …'), follow this part's angle, build on the previous parts without repeating them (a short callback is fine), stay consistent with the series theme and arc, and when a next part exists end with a short teaser for it.",
  "Respect the format: text = a strong standalone post; image = a shorter post that works with one image; carousel = a short post that introduces a document carousel plus 6 to 9 slides; poll = a short post plus a poll question and 2 to 4 options of at most 30 characters; video = a short post that introduces a video; article = a longer, structured post with a clear title.",
  "Return a JSON object with keys: title (short internal title in Arabic), text (the post, without hashtags), hashtags (3 to 5), slides (array of objects with title and body, only for carousel, otherwise empty), poll_question and poll_options (only for poll, otherwise empty).",
].join(" ");

function written(data: unknown): WrittenPost {
  const raw = asRecord(data);
  const text = cleanText(raw.text);
  if (!text) throw new Error("The model returned an empty post");
  return {
    title: asString(raw.title, 200).trim(),
    text,
    hashtags: cleanTags(raw.hashtags, text),
    slides: slidesOf(raw.slides),
    pollQuestion: asString(raw.poll_question, 140).trim(),
    pollOptions: asStringList(raw.poll_options, 4).map((o) => o.slice(0, 30)),
  };
}

function slidesOf(value: unknown): Array<{ title: string; body: string }> {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((s) => {
    const r = asRecord(s);
    return { title: asString(r.title, 200).trim(), body: asString(r.body, 1000).trim() };
  }).filter((s) => s.title || s.body);
}

export async function writePost(brief: PostBrief, profile: Profile, posts: Post[], strategy: ContentStrategy | null, settings: ContentSettings, cfg: AiConfig): Promise<WrittenPost> {
  const input = {
    profile: profileBlock(profile, settings, strategy),
    what_works: strategy?.works ?? [],
    recent_posts_for_voice: excerpt(posts.filter((p) => p.text.length > 120), 6, 900),
    brief: {
      topic: brief.topic,
      hook_idea: brief.hook,
      pillar: brief.pillar,
      format: brief.format,
      lang: brief.lang,
      tone: brief.tone,
      length: LENGTH_CHARS[brief.length],
      details_from_user: brief.details,
      series: brief.series ? {
        name: brief.series.name,
        theme: brief.series.theme,
        arc: brief.series.arc,
        part: `${brief.series.index} of ${brief.series.total}`,
        this_part_angle: brief.series.angle,
        previous_parts: brief.series.previous.slice(-4).map((x) => ({ title: x.title, text: x.text.slice(0, 600) })),
        next_part_title: brief.series.next,
      } : undefined,
    },
  };
  const { data } = await chatJson(cfg, WRITE_SYSTEM, JSON.stringify(input));
  return written(data);
}

export function defaultLength(format: PostFormat): Length {
  return LENGTH_FOR_FORMAT[format];
}

const ACTION_TASK: Record<RewriteAction, string> = {
  improve: "Make the post clearly better: a stronger hook, tighter sentences, better structure and flow, a clear takeaway and a natural call to action. Keep the meaning, facts and language.",
  shorten: "Make the post about 40% shorter. Keep the hook, the key idea and the call to action.",
  lengthen: "Expand the post with more useful depth (steps, an example, a lesson), staying under 2200 characters. Use placeholders in square brackets for any concrete detail that is not given.",
  tone: "Rewrite the post in the requested tone. Keep the meaning, facts and language.",
  translate: "Translate and adapt the post into the other language (Arabic to English or English to Arabic). Adapt idioms and rhythm so it reads as if written in that language.",
  cta: "Keep the post and rewrite only the ending so it has a strong, natural call to action or question that invites comments.",
  proofread: "Fix spelling, grammar and punctuation only. Do not change the wording or style otherwise.",
  emoji: "Add a few fitting emojis where they help scanning (for example at the start of list lines). Do not overdo it.",
  format: "Reformat for easy reading on a phone: short paragraphs, white space, lists where they help. Do not change the wording.",
  repurpose: "Write a fresh new post from this old post: a new angle, a new hook and updated framing, so it does not feel like a repeat.",
};

const REWRITE_SYSTEM = [
  NAME_RULE,
  "You edit the user's LinkedIn post following the task in the input.",
  LANGUAGE_RULE,
  STYLE_RULE,
  FACTS_RULE,
  "Return a JSON object with keys: text (the full new post, without hashtags), hashtags (3 to 5), note (one short sentence in Arabic on what you changed).",
].join(" ");

export interface Rewrite {
  text: string;
  hashtags: string[];
  note: string;
}

export async function rewritePost(action: RewriteAction, text: string, lang: ContentLang, profile: Profile, settings: ContentSettings, strategy: ContentStrategy | null, cfg: AiConfig, tone: Tone = "professional"): Promise<Rewrite> {
  const input = {
    profile: profileBlock(profile, settings, strategy),
    task: ACTION_TASK[action],
    tone: action === "tone" ? tone : undefined,
    post_lang: action === "translate" ? (lang === "ar" ? "translate to English" : "translate to Arabic") : lang,
    post: text,
  };
  const { data } = await chatJson(cfg, REWRITE_SYSTEM, JSON.stringify(input));
  const raw = asRecord(data);
  const next = cleanText(raw.text);
  if (!next) throw new Error("The model returned an empty post");
  return { text: next, hashtags: cleanTags(raw.hashtags, next), note: asString(raw.note, 300).trim() };
}

const HOOKS_SYSTEM = [
  "You write scroll-stopping first lines for LinkedIn posts.",
  LANGUAGE_RULE,
  FACTS_RULE,
  "Given the post, write 5 alternative hooks (the first one or two lines, under 200 characters each), each using a different technique: a bold claim, a surprising number or result (placeholder if not given), a question, a short story opening, a contrarian take.",
  "Write them in the post's language. Return a JSON object with key hooks: an array of objects with text and technique (technique in Arabic, two or three words).",
].join(" ");

export async function suggestHooks(text: string, lang: ContentLang, cfg: AiConfig): Promise<Array<{ text: string; technique: string }>> {
  const { data } = await chatJson(cfg, HOOKS_SYSTEM, JSON.stringify({ post_lang: lang, post: text }));
  const hooks = (Array.isArray(asRecord(data).hooks) ? (asRecord(data).hooks as unknown[]) : []).map((x) => {
    const r = asRecord(x);
    return { text: asString(r.text, 400).trim(), technique: asString(r.technique, 60).trim() };
  }).filter((x) => x.text);
  if (hooks.length === 0) throw new Error("The model returned no hooks");
  return hooks.slice(0, 5);
}

export function replaceHook(text: string, hook: string): string {
  const parts = text.split(/\n\s*\n/);
  if (parts.length < 2) return `${hook.trim()}\n\n${text.trim()}`;
  return [hook.trim(), ...parts.slice(1)].join("\n\n");
}

export interface PostReview {
  score: number;
  hook: number;
  clarity: number;
  value: number;
  cta: number;
  verdict: string;
  strengths: string[];
  fixes: string[];
}

const REVIEW_SYSTEM = [
  "You are a strict LinkedIn content editor. Review the post in the input for the user's goals and audience.",
  "Score from 0 to 10: hook (does the first line stop the scroll), clarity (easy to read on a phone), value (useful, specific, credible), cta (clear next step or question). score is the overall score from 0 to 100.",
  "Write verdict (one sentence), strengths (up to 3) and fixes (up to 5 concrete, actionable fixes) in natural Jordanian-flavored Arabic.",
  "Return a JSON object with keys: score, hook, clarity, value, cta, verdict, strengths, fixes.",
].join(" ");

export async function reviewPost(text: string, profile: Profile, settings: ContentSettings, strategy: ContentStrategy | null, cfg: AiConfig): Promise<PostReview> {
  const { data } = await chatJson(cfg, REVIEW_SYSTEM, JSON.stringify({ profile: profileBlock(profile, settings, strategy), post: text, length_chars: text.length }));
  const raw = asRecord(data);
  const score = (k: string, max: number): number => Math.min(max, Math.max(0, Math.round(asNumber(raw[k], 0))));
  return {
    score: score("score", 100),
    hook: score("hook", 10),
    clarity: score("clarity", 10),
    value: score("value", 10),
    cta: score("cta", 10),
    verdict: asString(raw.verdict, 400).trim(),
    strengths: asStringList(raw.strengths, 3),
    fixes: asStringList(raw.fixes, 5),
  };
}

const CAROUSEL_SYSTEM = [
  "You turn a LinkedIn post into a document carousel outline.",
  LANGUAGE_RULE,
  FACTS_RULE,
  "Write 6 to 9 slides in the post's language: slide 1 is a strong cover title, the middle slides each hold one idea with a short title and at most 25 words of body, and the last slide is a call to action.",
  "Return a JSON object with key slides: an array of objects with title and body.",
].join(" ");

export async function carouselOutline(text: string, lang: ContentLang, cfg: AiConfig): Promise<Array<{ title: string; body: string }>> {
  const { data } = await chatJson(cfg, CAROUSEL_SYSTEM, JSON.stringify({ post_lang: lang, post: text }));
  const slides = slidesOf(asRecord(data).slides);
  if (slides.length === 0) throw new Error("The model returned no slides");
  return slides;
}

const ART_SYSTEM = [
  "You are an award-winning art director who designs scroll-stopping LinkedIn post images.",
  "Read the post and the brief in the input. Pick ONE strong visual concept that makes the post's core message instantly clear and makes people stop scrolling. Avoid clichés such as handshakes, light bulbs, puzzle pieces, generic laptops and stock-photo smiles.",
  "Write a detailed image prompt in English with these parts in order: the concept in one sentence; the main subject and what it is doing; composition and framing for the given aspect ratio (where the subject sits, what is in the foreground and background, where the empty space is); setting and props; lighting; color palette (use the brand colors when given); medium and rendering details matching the style; mood.",
  "Never include real or famous people, company logos, trademarks, watermarks or UI screenshots of real products. People, if any, are anonymous and diverse.",
  "If overlay_text is given, design the layout around it: say exactly where the text goes, in a clean bold sans-serif, high contrast, large and perfectly spelled, written exactly as given, and that no other text appears. If overlay_text is empty, the image must contain no text, letters or numbers at all.",
  "Also suggest headline: a very short punchy line (at most 6 words) in the post's language that could go on the image, and alt: a one-sentence image description in the post's language for accessibility.",
  "Return a JSON object with keys prompt (under 1400 characters), headline, alt.",
].join(" ");

export interface ArtBrief {
  text: string;
  lang: ContentLang;
  style: string;
  aspect: ImageAspect;
  overlay: string;
  brandColors: string;
  role: string;
}

export interface ArtDirection {
  prompt: string;
  headline: string;
  alt: string;
}

const ASPECT_WORDS: Record<ImageAspect, string> = { portrait: "vertical 4:5 portrait", square: "square 1:1", landscape: "horizontal 1.91:1 landscape" };

export async function artDirection(brief: ArtBrief, cfg: AiConfig): Promise<ArtDirection> {
  const input = {
    post: brief.text.slice(0, 2500),
    post_lang: brief.lang,
    author_role: brief.role,
    style: imageStyle(brief.style).direction,
    aspect_ratio: ASPECT_WORDS[brief.aspect],
    brand_colors: brief.brandColors,
    overlay_text: brief.overlay,
  };
  const { data } = await chatJson(cfg, ART_SYSTEM, JSON.stringify(input));
  const raw = asRecord(data);
  const prompt = asString(raw.prompt, 3000).trim();
  if (!prompt) throw new Error("The model returned an empty prompt");
  return { prompt, headline: asString(raw.headline, 80).trim(), alt: asString(raw.alt, 300).trim() };
}

export function finalImagePrompt(prompt: string, style: string, aspect: ImageAspect, overlay: string, brandColors: string): string {
  const parts = [prompt.trim(), `Style: ${imageStyle(style).direction}.`, `Format: ${ASPECT_WORDS[aspect]}, made for a LinkedIn feed, sharp details, professional finish.`];
  if (brandColors.trim()) parts.push(`Color palette: ${brandColors.trim()}.`);
  const text = overlay.trim().replace(/"/g, "'");
  parts.push(text ? `Render this exact text once, large, clean and perfectly spelled: "${text}". No other text, logos or watermarks.` : "No text, letters, numbers, logos or watermarks anywhere in the image.");
  parts.push("No real or famous people.");
  return parts.join("\n");
}

export interface PlanItem {
  date: string;
  idea: ContentIdea;
}

const PLAN_SYSTEM = [
  NAME_RULE,
  "You are a LinkedIn content strategist. Build a posting plan for the dates given in the input, one post per date.",
  "Balance the pillars by their share, mix formats, build on what works, do not repeat recent posts or the existing ideas, and make the order tell a coherent story over the weeks.",
  "Write title and why in natural Jordanian-flavored Arabic, and hook (the actual first line of the post) in the post's lang.",
  FACTS_RULE,
  "Return a JSON object with key plan: an array with one object per date, each with date (exactly as given), title, hook, pillar, format (text, image, carousel, poll, video or article), lang (ar or en), why.",
].join(" ");

const DAY_ORDER = [2, 4, 0, 1, 3, 6, 5];

export function freeDates(from: Date, count: number, perWeek: number, bestDays: number[], taken: Set<string>): string[] {
  return planDates(from, 52, perWeek, bestDays).filter((d) => !taken.has(d)).slice(0, Math.max(0, count));
}

export function planDates(from: Date, weeks: number, perWeek: number, bestDays: number[]): string[] {
  const valid = bestDays.filter((d) => d >= 0 && d <= 6);
  const chosen = new Set([...new Set([...valid, ...DAY_ORDER])].slice(0, Math.min(7, Math.max(1, perWeek))));
  const out: string[] = [];
  const cursor = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  for (let i = 0; i < weeks * 7; i += 1) {
    if (chosen.has(cursor.getUTCDay())) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function weekdayIndex(name: string): number {
  const clean = name.trim().replace(/^ال/, "").replace(/[إأآ]/g, "ا");
  return WEEKDAYS_AR.findIndex((d) => d.replace(/^ال/, "").replace(/[إأآ]/g, "ا") === clean);
}

export async function planContent(dates: string[], profile: Profile, posts: Post[], strategy: ContentStrategy | null, settings: ContentSettings, existing: string[], cfg: AiConfig): Promise<PlanItem[]> {
  const input = {
    profile: profileBlock(profile, settings, strategy),
    pillars: strategy?.pillars ?? settings.pillars.map((name) => ({ name, share: Math.round(100 / Math.max(1, settings.pillars.length)) })),
    what_works: strategy?.works ?? [],
    recent_posts: excerpt(posts, 12, 250),
    existing_ideas: existing.slice(0, 60),
    dates: dates.map((d) => ({ date: d, weekday: WEEKDAYS_AR[new Date(`${d}T00:00:00Z`).getUTCDay()] })),
  };
  const { data } = await chatJson(cfg, PLAN_SYSTEM, JSON.stringify(input));
  const wanted = new Set(dates);
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const x of Array.isArray(asRecord(data).plan) ? (asRecord(data).plan as unknown[]) : []) {
    const date = asString(asRecord(x).date, 10);
    const idea = sanitizeIdea(x);
    if (!idea || !wanted.has(date) || seen.has(date)) continue;
    seen.add(date);
    items.push({ date, idea });
  }
  if (items.length === 0) throw new Error("The model returned an empty plan");
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

const CUSTOM_SIZE_MODEL = /^gpt-image-([2-9]|\d{2,})/;
const IMAGE_FALLBACKS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"];
const ASPECT_SIZE: Record<"custom" | "fixed", Record<ImageAspect, string>> = {
  custom: { square: "1024x1024", portrait: "1024x1280", landscape: "1536x800" },
  fixed: { square: "1024x1024", portrait: "1024x1536", landscape: "1536x1024" },
};

export function imageSize(model: string, aspect: ImageAspect): string {
  return ASPECT_SIZE[CUSTOM_SIZE_MODEL.test(model) ? "custom" : "fixed"][aspect];
}

export function imageModelChain(model: string): string[] {
  return [...new Set([model, ...IMAGE_FALLBACKS])];
}

export interface ImageRequest {
  model: string;
  prompt: string;
  aspect: ImageAspect;
  quality: ImageQuality;
  count: number;
}

export interface GeneratedImage {
  images: Array<{ b64: string; type: string }>;
  model: string;
  prompt: string;
  size: string;
}

function canFallBack(error: unknown): boolean {
  if (isModelAccessError(error)) return true;
  return error instanceof OpenAiError && error.status === 400 && /model|size|quality/i.test(error.message) && !/safety|moderation|content policy/i.test(error.message);
}

async function requestImage(key: string, req: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
  const size = imageSize(req.model, req.aspect);
  const payload = { model: req.model, prompt: req.prompt, n: Math.min(MAX_IMAGE_COUNT, Math.max(1, Math.round(req.count))), size, quality: req.quality, output_format: "webp", output_compression: 92 };
  const data = asRecord(await postJson(key, "/images/generations", payload, signal));
  const images = (Array.isArray(data.data) ? data.data : []).map((x) => asString(asRecord(x).b64_json, 30_000_000)).filter(Boolean).map((b64) => ({ b64, type: "image/webp" }));
  if (images.length === 0) throw new Error("The image model returned no image");
  return { images, model: req.model, prompt: req.prompt, size };
}

export async function generateImage(cfg: AiConfig, req: ImageRequest): Promise<GeneratedImage> {
  let last: unknown;
  for (const model of imageModelChain(req.model)) {
    try {
      return await requestImage(cfg.key, { ...req, model }, cfg.signal);
    } catch (error) {
      if (!canFallBack(error)) throw error;
      last = error;
    }
  }
  throw last;
}

export interface SeriesBrief {
  topic: string;
  goal: string;
  count: number;
  lang: ContentLang;
}

export type SeriesPlan = Omit<ContentSeries, "id" | "createdAt">;

const SERIES_SYSTEM = [
  NAME_RULE,
  "You are a senior LinkedIn content strategist. Design one connected post series for the user in the input.",
  "If brief.topic is empty, choose the series topic that best serves their goals and target audience, based on their profile and pillars.",
  "A series is a story over several posts: each part has a clear, different angle, builds on the previous part and makes people want the next one. Start with a strong opener that sets the promise, move from problem to insight to practical how-to to proof, and end with a recap or a call to action.",
  "Mix formats where it helps (text, image, carousel, poll). Do not repeat their recent posts.",
  "Write name (short and catchy), theme, arc (how the parts connect), audience and goal in natural Jordanian-flavored Arabic. Write each part's title, angle and why in Arabic, and hook (the actual first line of the post) in brief.lang.",
  FACTS_RULE,
  "Return a JSON object with keys name, theme, arc, audience, goal, pillar, parts: an array with exactly brief.count objects in order, each with title, hook, angle (2 or 3 sentences on what this part covers and how it links to the previous one), format (text, image, carousel, poll, video or article), why.",
].join(" ");

export async function planSeries(brief: SeriesBrief, profile: Profile, posts: Post[], strategy: ContentStrategy | null, settings: ContentSettings, existing: string[], cfg: AiConfig): Promise<SeriesPlan> {
  const count = Math.min(MAX_SERIES_PARTS, Math.max(3, Math.round(brief.count)));
  const input = {
    profile: profileBlock(profile, settings, strategy),
    what_works: strategy?.works ?? [],
    recent_posts: excerpt(posts, 10, 250),
    existing_ideas: existing.slice(0, 40),
    brief: { topic: brief.topic, goal: brief.goal, count, lang: brief.lang },
  };
  const { data } = await chatJson(cfg, SERIES_SYSTEM, JSON.stringify(input));
  const raw = asRecord(data);
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).map(sanitizeSeriesPart).filter((x): x is SeriesPart => x !== null).slice(0, count);
  const name = asString(raw.name, 200).trim();
  if (!name || parts.length < 2) throw new Error("The model returned an empty series");
  return {
    name,
    theme: asString(raw.theme, 800).trim(),
    arc: asString(raw.arc, 1200).trim(),
    audience: asString(raw.audience, 400).trim(),
    goal: asString(raw.goal, 400).trim() || brief.goal,
    lang: brief.lang,
    pillar: asString(raw.pillar, 120).trim(),
    parts,
  };
}
