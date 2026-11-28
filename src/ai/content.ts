import {
  contentStats, hashtagsOf, MAX_IMAGE_COUNT, MAX_SERIES_PARTS, normalizeHashtag, POST_LIMIT, sanitizeIdea, sanitizeSeriesPart, sanitizeStrategy, WEEKDAYS_AR,
  type ContentIdea, type ContentLang, type ContentSeries, type ContentSettings, type ContentStrategy, type ImageAspect, type ImageQuality, type Post, type PostFormat, type SeriesPart,
} from "../core/content";
import { asNumber, asRecord, asString, asStringList } from "../core/profile";
import type { Profile } from "../core/types";
import { EDITOR_RUBRIC, FACTS_RULE, FORMAT_RULES, LANGUAGE_RULE, POST_PLAYBOOK, VISUAL_RULES } from "./craft";
import { myFacts, NAME_RULE } from "./features";
import { chatJson, isFatalError, isModelAccessError, OpenAiError, postJson, type AiConfig } from "./openai";

export type Tone = "professional" | "friendly" | "story" | "bold" | "educational" | "humble";
export type Length = "short" | "medium" | "long";
export type RewriteAction = "improve" | "shorten" | "lengthen" | "tone" | "translate" | "cta" | "proofread" | "emoji" | "format" | "repurpose";

export const TONE_LABEL: Record<Tone, string> = { professional: "مهني", friendly: "ودّي", story: "قصة", bold: "جريء", educational: "تعليمي", humble: "متواضع" };
const TONE_DIRECTION: Record<Tone, string> = {
  professional: "professional: clear, credible and practical, like a respected expert talking to peers",
  friendly: "friendly: warm and conversational, like talking to a colleague over coffee, still sharp and useful",
  story: "story: open inside a real moment, with tension and a turning point, then the lesson",
  bold: "bold: a strong, clear opinion that challenges common practice, backed by reasons and proof, never rude",
  educational: "educational: a practical mini-lesson with clear steps, examples and the common trap",
  humble: "humble: honest about mistakes and what was learned, confident about the lesson",
};

export const LENGTH_LABEL: Record<Length, string> = { short: "قصير", medium: "متوسط", long: "طويل" };
export const IMAGE_ASPECT_LABEL: Record<ImageAspect, string> = { portrait: "طولي 4:5 (الأفضل للموبايل)", square: "مربع 1:1", landscape: "عرضي 1.91:1" };
export const IMAGE_QUALITY_LABEL: Record<ImageQuality, string> = { low: "سريعة ورخيصة", medium: "متوازنة", high: "أعلى دقة" };

export interface ImageStyle {
  label: string;
  direction: string;
}

export const IMAGE_STYLES: Record<string, ImageStyle> = {
  editorial: { label: "صورة مهنية", direction: "premium editorial photograph of the real situation in the post, real-world setting that matches the topic, natural light, 35mm lens, shallow depth of field, authentic and candid, subtle color grading" },
  minimal: { label: "بسيط ونظيف", direction: "minimalist composition built around the one object or action that best represents the post, generous negative space, soft neutral background, refined muted palette, calm and premium" },
  infographic: { label: "إنفوغرافيك", direction: "clean modern infographic that visualizes the post's actual steps, parts or comparison as simple icons and shapes, clear visual hierarchy, aligned grid, flat vector style, crisp edges" },
  illustration: { label: "رسم حديث", direction: "modern flat vector illustration of the post's real scene and its key objects, characters without real identities, soft gradients, bold simple shapes, contemporary product-illustration style" },
  render3d: { label: "ثلاثي الأبعاد", direction: "polished 3D render of the post's key objects arranged to tell its message, soft studio lighting, smooth matte materials, gentle shadows, clay-like modern look" },
  conceptual: { label: "مفهوم ذكي", direction: "one clever visual metaphor made only from objects that belong to the post's topic, understood at a glance, clean studio backdrop, high-end ad campaign look" },
  tech: { label: "تقني", direction: "sleek technical visual of the real systems in the post (devices, servers, data flowing between the named parts, simplified code-like shapes without readable text), precise geometry, modern dark interface look, professional" },
  brand: { label: "ألوان البراند", direction: "bold graphic poster that shows the post's key object or idea as a strong simple shape, geometric layout, flat color blocks using only the brand palette, modern Swiss design influence" },
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

const LENGTH_CHARS: Record<Length, string> = { short: "700 to 1000 characters", medium: "1200 to 1800 characters", long: "1900 to 2700 characters" };
const LENGTH_FOR_FORMAT: Record<PostFormat, Length> = { text: "medium", image: "medium", carousel: "short", poll: "short", video: "short", article: "long" };

function profileBlock(profile: Profile, settings: ContentSettings, strategy: ContentStrategy | null): Record<string, unknown> {
  return {
    me: { ...myFacts(profile), location: profile.me.location, education: profile.me.education, github: profile.me.github },
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
  series?: SeriesContext | undefined;
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

export type WriteStage = "plan" | "draft" | "edit";

interface PostBlueprint {
  reader: string;
  angle: string;
  coreMessage: string;
  framework: string;
  hook: string;
  hooks: string[];
  beats: Array<{ point: string; detail: string }>;
  proof: string[];
  takeaway: string;
  cta: string;
}

const SERIES_RULE = "If brief.series is given, this post is one part of a connected series: say naturally which part it is (for example 'الجزء 2 من سلسلة …' or 'Part 2 of …'), follow this part's angle, build on the previous parts without repeating them (a short callback is fine), stay consistent with the series theme and arc, and when a next part exists end with a short teaser for it.";
const LENGTH_RULE = "Respect the length in brief.length and never go over 2900 characters.";
const POST_JSON = "title (short internal title in Arabic), text (the post, without hashtags), hashtags (3 to 5), slides (array of objects with title and body, only for carousel, otherwise empty), poll_question and poll_options (only for poll, otherwise empty)";

const BLUEPRINT_SYSTEM = [
  NAME_RULE,
  "You are a senior LinkedIn ghostwriter and content strategist. Before anything is written, build a detailed blueprint for one post from the brief, the user's profile and their recent posts.",
  "Think like the target reader: what they struggle with on this topic, and what would make them stop, read to the end, save and comment.",
  "Choose one sharp, specific angle (never a generic overview) and one structure framework that fits it.",
  "Every beat must hold a concrete detail: a real step, tool, technique, trade-off, mistake, scene or fact from the input. A beat without a concrete detail is not allowed.",
  FACTS_RULE,
  "If brief.details_from_user is given, it is the most important input: build the post around it.",
  "If brief.series is given, plan this part's angle inside the series: build on the previous parts without repeating them, and set up the next part.",
  "Write the blueprint in English (it is internal) except hooks, hook and cta, which are in brief.lang.",
  "Return a JSON object with keys: reader (who exactly this is for and their pain, one sentence), angle, core_message (the one idea the reader must remember), framework, hooks (3 different first lines, each using a different technique), hook (the strongest first two lines, refined), beats (4 to 7 objects in order, each with point and detail), proof (facts from the input that give credibility), takeaway (one line), cta (a specific question or next step).",
].join(" ");

const WRITE_SYSTEM = [
  NAME_RULE,
  "You are an elite LinkedIn ghostwriter. Write one complete post from the blueprint and the brief in the input, in brief.lang, in the user's own voice (first person).",
  "The blueprint is the plan: open with its hook (polish it if you can), cover every beat in order with its concrete detail, use the proof, land the takeaway and end with the call to action.",
  LANGUAGE_RULE,
  POST_PLAYBOOK,
  FACTS_RULE,
  "Learn the user's voice from recent_posts_for_voice when given, but make this post clearly better than them.",
  SERIES_RULE,
  `Respect the format: ${FORMAT_RULES}`,
  LENGTH_RULE,
  `Return a JSON object with keys: ${POST_JSON}.`,
].join("\n");

const EDIT_SYSTEM = [
  NAME_RULE,
  "You are a demanding LinkedIn editor. Review the draft in the input against the brief, the blueprint and the playbook, then return the improved final version, ready to publish.",
  EDITOR_RUBRIC,
  LANGUAGE_RULE,
  POST_PLAYBOOK,
  FACTS_RULE,
  SERIES_RULE,
  `Respect the format: ${FORMAT_RULES}`,
  LENGTH_RULE,
  `Return a JSON object with keys: scores (object with hook, specificity, depth, structure, voice, ending), problems (array of short strings), ${POST_JSON}. Keep and improve slides and poll fields when the format needs them.`,
].join("\n");

function blueprintOf(data: unknown): PostBlueprint {
  const raw = asRecord(data);
  const beats = (Array.isArray(raw.beats) ? raw.beats : []).slice(0, 8).map((b) => {
    const r = asRecord(b);
    return { point: asString(r.point, 400).trim(), detail: asString(r.detail, 800).trim() };
  }).filter((b) => b.point || b.detail);
  return {
    reader: asString(raw.reader, 400).trim(),
    angle: asString(raw.angle, 400).trim(),
    coreMessage: asString(raw.core_message, 400).trim(),
    framework: asString(raw.framework, 200).trim(),
    hook: asString(raw.hook, 400).trim(),
    hooks: asStringList(raw.hooks, 3),
    beats,
    proof: asStringList(raw.proof, 6),
    takeaway: asString(raw.takeaway, 300).trim(),
    cta: asString(raw.cta, 300).trim(),
  };
}

function blueprintInput(b: PostBlueprint): Record<string, unknown> {
  return { reader: b.reader, angle: b.angle, core_message: b.coreMessage, framework: b.framework, hook: b.hook, other_hooks: b.hooks, beats: b.beats, proof: b.proof, takeaway: b.takeaway, cta: b.cta };
}

function writtenInput(w: WrittenPost): Record<string, unknown> {
  return { title: w.title, text: w.text, hashtags: w.hashtags, slides: w.slides, poll_question: w.pollQuestion, poll_options: w.pollOptions };
}

function merged(draft: WrittenPost, edited: WrittenPost): WrittenPost {
  return {
    title: edited.title || draft.title,
    text: edited.text,
    hashtags: edited.hashtags.length > 0 ? edited.hashtags : draft.hashtags,
    slides: edited.slides.length > 0 ? edited.slides : draft.slides,
    pollQuestion: edited.pollQuestion || draft.pollQuestion,
    pollOptions: edited.pollOptions.length >= 2 ? edited.pollOptions : draft.pollOptions,
  };
}

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

export async function writePost(brief: PostBrief, profile: Profile, posts: Post[], strategy: ContentStrategy | null, settings: ContentSettings, cfg: AiConfig, onStage?: (stage: WriteStage) => void): Promise<WrittenPost> {
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
      tone: TONE_DIRECTION[brief.tone],
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
  onStage?.("plan");
  const blueprint = blueprintInput(blueprintOf((await chatJson(cfg, BLUEPRINT_SYSTEM, JSON.stringify(input))).data));
  onStage?.("draft");
  const draft = written((await chatJson(cfg, WRITE_SYSTEM, JSON.stringify({ ...input, blueprint }))).data);
  onStage?.("edit");
  try {
    const { data } = await chatJson(cfg, EDIT_SYSTEM, JSON.stringify({ profile: input.profile, brief: input.brief, blueprint, draft: writtenInput(draft) }));
    return merged(draft, written(data));
  } catch (error) {
    if (cfg.signal?.aborted || isFatalError(error)) throw error;
    return draft;
  }
}

export function defaultLength(format: PostFormat): Length {
  return LENGTH_FOR_FORMAT[format];
}

const ACTION_TASK: Record<RewriteAction, string> = {
  improve: "Edit the post to a publish-ready professional level: score it against the playbook, then fix every weakness. A sharper, specific hook; concrete details in every paragraph instead of vague lines; real depth (steps, trade-offs, an example); clean phone-friendly structure; a clear takeaway and a specific call to action. Keep the true facts, the meaning and the language.",
  shorten: "Make the post about 40% shorter. Keep the hook, the key idea and the call to action.",
  lengthen: "Expand the post with real depth: concrete steps, a specific example from the user's projects and skills, the trade-off or common trap, and a clear lesson, staying under 2700 characters. Every added line must add a new concrete detail, never filler.",
  tone: "Rewrite the post in the requested tone. Keep the meaning, facts and language.",
  translate: "Translate and adapt the post into the other language (Arabic to English or English to Arabic). Adapt idioms and rhythm so it reads as if written in that language.",
  cta: "Keep the post and rewrite only the ending so it has a strong, natural call to action or question that invites comments.",
  proofread: "Fix spelling, grammar and punctuation only. Do not change the wording or style otherwise.",
  emoji: "Add a few fitting emojis where they help scanning (for example at the start of list lines). Do not overdo it.",
  format: "Reformat for easy reading on a phone: short paragraphs, white space, lists where they help. Do not change the wording.",
  repurpose: "Write a fresh new post from this old post: a new specific angle, a new hook, new concrete details and updated framing, so it does not feel like a repeat.",
};

const REWRITE_SYSTEM = [
  NAME_RULE,
  "You are an expert LinkedIn editor. Edit the user's LinkedIn post following the task in the input.",
  "The task wins over the playbook when they conflict: for proofread, format and emoji change nothing beyond what the task asks.",
  LANGUAGE_RULE,
  POST_PLAYBOOK,
  FACTS_RULE,
  "Return a JSON object with keys: text (the full new post, without hashtags), hashtags (3 to 5), note (one short sentence in Arabic on what you changed).",
].join("\n");

export interface Rewrite {
  text: string;
  hashtags: string[];
  note: string;
}

export async function rewritePost(action: RewriteAction, text: string, lang: ContentLang, profile: Profile, settings: ContentSettings, strategy: ContentStrategy | null, cfg: AiConfig, tone: Tone = "professional"): Promise<Rewrite> {
  const input = {
    profile: profileBlock(profile, settings, strategy),
    task: ACTION_TASK[action],
    tone: action === "tone" ? TONE_DIRECTION[tone] : undefined,
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
  "Given the post, write 5 alternative hooks (the first one or two lines, under 200 characters each, line 1 at most 12 words), each specific to this post's real content and each using a different technique: a bold claim, a concrete result or number from the post, a sharp question that is not yes or no, a short story opening inside a real moment, a contrarian take.",
  "Never use clichés or generic openers that could fit any post.",
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
  "Score from 0 to 10: hook (does the first line stop the scroll and is it specific), clarity (easy to read on a phone, clean structure), value (useful, specific, concrete details in every paragraph, real depth, credible), cta (clear takeaway and a specific question or next step). score is the overall score from 0 to 100. Be strict: a generic post without concrete details never scores above 60.",
  "Write verdict (one sentence), strengths (up to 3) and fixes (up to 5 concrete, actionable fixes that quote the weak line and say what to write instead) in natural Levantine-flavored Arabic.",
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

const VISUAL_BRIEF_SYSTEM = [
  "You are a creative director for LinkedIn visuals. Read the post in the input and extract a visual brief before any image is designed.",
  VISUAL_RULES,
  "key_elements are things a camera or an illustrator can show: concrete objects, devices, screens, places, roles and actions that are named in the post or clearly part of its situation.",
  "Write three different concepts. Each one is a single scene that a viewer understands in one second and that could only belong to this post. Then choose the concept that is the most specific to the post and the clearest.",
  "Return a JSON object with keys (in English unless said otherwise): topic (what the post is about, a few words), core_message (one sentence), audience, key_elements (3 to 6 strings), setting (where this happens in real life), emotion (the feeling the image should give), concepts (3 objects with scene and link: how the scene shows the post's message), chosen (0, 1 or 2), headline (at most 6 words in post_lang, from the post's message), alt (one sentence in post_lang that describes the image).",
].join("\n");

const SCENE_SYSTEM = [
  "You are an award-winning art director. Turn the visual brief into a precise scene description for an image model.",
  VISUAL_RULES,
  "Keep the chosen concept. Make the key elements it needs clearly visible and recognizable, in focus, large enough to read at phone size.",
  "Follow the style and the aspect ratio. Use the brand colors when given.",
  "If overlay_text is given, leave a clean, calm area for it and say exactly where. If overlay_text is empty, plan no text, letters or numbers anywhere, including on screens, papers and signs (show them blurred or as simple shapes).",
  "Return a JSON object with keys (all in English): subject (the main subject and what it is doing, very concrete), must_show (2 to 5 elements from the brief that must be clearly visible), setting (place, props and background), composition (camera, framing for the aspect ratio, where the subject sits, foreground and background, where the empty space is), lighting, palette, mood, avoid (2 to 6 things that would make this image generic or wrong for this post).",
].join("\n");

export interface ArtBrief {
  title: string;
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

export interface VisualBrief {
  topic: string;
  coreMessage: string;
  audience: string;
  keyElements: string[];
  setting: string;
  emotion: string;
  concept: string;
  link: string;
  headline: string;
  alt: string;
}

export interface Scene {
  subject: string;
  mustShow: string[];
  setting: string;
  composition: string;
  lighting: string;
  palette: string;
  mood: string;
  avoid: string[];
}

const ASPECT_WORDS: Record<ImageAspect, string> = { portrait: "vertical 4:5 portrait", square: "square 1:1", landscape: "horizontal 1.91:1 landscape" };

function visualBriefOf(data: unknown, fallbackTopic: string): VisualBrief {
  const raw = asRecord(data);
  const concepts = (Array.isArray(raw.concepts) ? raw.concepts : []).map((c) => {
    const r = asRecord(c);
    return { scene: asString(r.scene ?? r.idea, 600).trim(), link: asString(r.link, 400).trim() };
  }).filter((c) => c.scene);
  const index = Math.round(asNumber(raw.chosen, 0));
  const pick = concepts[index >= 0 && index < concepts.length ? index : 0];
  return {
    topic: asString(raw.topic, 200).trim() || fallbackTopic,
    coreMessage: asString(raw.core_message, 400).trim(),
    audience: asString(raw.audience, 300).trim(),
    keyElements: asStringList(raw.key_elements, 6),
    setting: asString(raw.setting, 300).trim(),
    emotion: asString(raw.emotion, 200).trim(),
    concept: pick?.scene ?? "",
    link: pick?.link ?? "",
    headline: asString(raw.headline, 80).trim(),
    alt: asString(raw.alt, 300).trim(),
  };
}

function sceneOf(data: unknown): Scene {
  const raw = asRecord(data);
  const text = (k: string): string => asString(raw[k], 700).trim();
  return {
    subject: text("subject"),
    mustShow: asStringList(raw.must_show, 5),
    setting: text("setting"),
    composition: text("composition"),
    lighting: text("lighting"),
    palette: text("palette"),
    mood: text("mood"),
    avoid: asStringList(raw.avoid, 6),
  };
}

function line(label: string, value: string): string {
  return value ? `${label}: ${value.replace(/\s+/g, " ").replace(/\.$/, "")}.` : "";
}

export function composeImagePrompt(brief: VisualBrief, scene: Scene): string {
  return [
    line("Image for a LinkedIn post about", brief.topic),
    line("The image must make this message obvious", brief.coreMessage),
    line("Concept", brief.concept),
    line("Main subject", scene.subject),
    line("Must be clearly visible", scene.mustShow.join("; ")),
    line("Setting", scene.setting),
    line("Composition", scene.composition),
    line("Lighting", scene.lighting),
    line("Colors", scene.palette),
    line("Mood", scene.mood || brief.emotion),
    line("Avoid", scene.avoid.join("; ")),
  ].filter(Boolean).join("\n");
}

export async function artDirection(brief: ArtBrief, cfg: AiConfig, onScene?: () => void): Promise<ArtDirection> {
  const post = [brief.title.trim(), brief.text.trim()].filter((x, i, all) => x && all.indexOf(x) === i).join("\n\n").slice(0, 3000);
  const style = imageStyle(brief.style).direction;
  const briefData = await chatJson(cfg, VISUAL_BRIEF_SYSTEM, JSON.stringify({ post, post_lang: brief.lang, author_role: brief.role, planned_style: style }));
  const visual = visualBriefOf(briefData.data, brief.title.trim() || post.slice(0, 120));
  onScene?.();
  const sceneData = await chatJson(cfg, SCENE_SYSTEM, JSON.stringify({
    visual_brief: {
      topic: visual.topic,
      core_message: visual.coreMessage,
      audience: visual.audience,
      key_elements: visual.keyElements,
      setting: visual.setting,
      emotion: visual.emotion,
      chosen_concept: visual.concept,
      why_it_fits: visual.link,
    },
    author_role: brief.role,
    style,
    aspect_ratio: ASPECT_WORDS[brief.aspect],
    brand_colors: brief.brandColors,
    overlay_text: brief.overlay,
  }));
  const scene = sceneOf(sceneData.data);
  if (!scene.subject) throw new Error("The model returned an empty image scene");
  return { prompt: composeImagePrompt(visual, scene), headline: visual.headline, alt: visual.alt };
}

export function finalImagePrompt(prompt: string, style: string, aspect: ImageAspect, overlay: string, brandColors: string): string {
  const parts = [prompt.trim(), `Style, applied to the subject above without replacing it: ${imageStyle(style).direction}.`, `Format: ${ASPECT_WORDS[aspect]}, made for a LinkedIn feed, the main subject clear at phone size, sharp details, professional finish.`];
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
