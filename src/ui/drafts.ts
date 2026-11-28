import { artDirection, defaultLength, finalImagePrompt, freeDates, generateImage, suggestIdeas, weekdayIndex, writePost, type PostBrief, type SeriesContext, type SeriesPlan, type Tone } from "../ai/content";
import { isFatalError, mapLimit, type AiConfig } from "../ai/openai";
import { draftTitle, newDraft, newId, withVersion, type ContentIdea, type ContentSeries, type Draft, type ImageMeta } from "../core/content";
import { base64Blob, prepareImage, storeImage } from "../io/images";
import { aiErrorText, type Ctx } from "./context";
import { fmtNumber } from "./dom";
import { errorText } from "./errors";

type Progress = (text: string) => void;

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function findDraft(ctx: Ctx, id: string): Draft | undefined {
  return ctx.store.state.content.drafts.find((d) => d.id === id);
}

export function updateDraft(ctx: Ctx, id: string, fn: (d: Draft) => Draft, emit = true): void {
  ctx.store.update((s) => {
    s.content.drafts = s.content.drafts.map((d) => (d.id === id ? { ...fn(d), updatedAt: new Date().toISOString() } : d));
  }, { recompute: false, emit });
}

export function addDraft(ctx: Ctx, draft: Draft): Draft {
  ctx.store.update((s) => {
    s.content.drafts = [draft, ...s.content.drafts];
  }, { recompute: false, emit: false });
  return draft;
}

export function ideaDraft(idea: ContentIdea, extra: Partial<Draft> = {}): Draft {
  return newDraft({ title: idea.title, text: idea.hook, pillar: idea.pillar, format: idea.format, lang: idea.lang, status: "idea", notes: idea.why, ...extra });
}

export function findSeries(ctx: Ctx, id: string): ContentSeries | undefined {
  return id ? ctx.store.state.content.series.find((x) => x.id === id) : undefined;
}

export function seriesDrafts(ctx: Ctx, id: string): Draft[] {
  return ctx.store.state.content.drafts.filter((d) => d.seriesId === id).sort((a, b) => a.seriesIndex - b.seriesIndex);
}

export function seriesLabel(ctx: Ctx, d: Draft): string {
  const series = findSeries(ctx, d.seriesId);
  return series ? `${series.name} · ${fmtNumber(d.seriesIndex)}/${fmtNumber(series.parts.length)}` : "";
}

function seriesContext(ctx: Ctx, d: Draft): SeriesContext | undefined {
  const series = findSeries(ctx, d.seriesId);
  if (!series || d.seriesIndex < 1) return undefined;
  const previous = seriesDrafts(ctx, series.id).filter((x) => x.seriesIndex < d.seriesIndex && x.status !== "idea" && x.text.trim()).map((x) => ({ title: draftTitle(x), text: x.text }));
  return {
    name: series.name,
    theme: series.theme,
    arc: series.arc,
    index: d.seriesIndex,
    total: series.parts.length,
    angle: series.parts[d.seriesIndex - 1]?.angle ?? "",
    previous,
    next: series.parts[d.seriesIndex]?.title ?? "",
  };
}

export interface WriteOptions {
  topic?: string;
  details?: string;
  tone?: Tone;
  length?: PostBrief["length"];
}

export async function writeDraft(ctx: Ctx, cfg: AiConfig, id: string, options: WriteOptions = {}): Promise<Draft | undefined> {
  const d = findDraft(ctx, id);
  if (!d) return undefined;
  const s = ctx.store.state;
  const brief: PostBrief = {
    topic: options.topic?.trim() || d.title || d.text.slice(0, 300),
    hook: d.status === "idea" ? d.text : "",
    pillar: d.pillar,
    format: d.format,
    lang: d.lang,
    tone: options.tone ?? "professional",
    length: options.length ?? defaultLength(d.format),
    details: [options.details?.trim() ?? "", d.status === "idea" ? d.notes : ""].filter(Boolean).join("\n"),
    series: seriesContext(ctx, d),
  };
  const w = await writePost(brief, s.profile, s.content.posts, s.content.strategy, s.content.settings, cfg);
  updateDraft(ctx, id, (x) => {
    const next: Draft = { ...withVersion(x, w.text, "ai-write"), title: x.title || w.title, hashtags: x.hashtags.length > 0 ? x.hashtags : w.hashtags };
    if (x.status === "idea") next.status = x.scheduledFor ? "scheduled" : "draft";
    if (x.format === "carousel" && w.slides.length > 0) next.slides = w.slides;
    if (x.format === "poll" && w.pollQuestion) Object.assign(next, { pollQuestion: w.pollQuestion, pollOptions: w.pollOptions });
    return next;
  }, false);
  return findDraft(ctx, id);
}

export async function saveImages(ctx: Ctx, draftId: string, blobs: Blob[], meta: Omit<ImageMeta, "id" | "draftId" | "createdAt" | "width" | "height">, pick = true): Promise<string[]> {
  const metas: ImageMeta[] = [];
  for (const blob of blobs) {
    const prepared = await prepareImage(blob);
    const id = newId("img");
    await storeImage(id, prepared.blob);
    metas.push({ ...meta, id, draftId, createdAt: new Date().toISOString(), width: prepared.width, height: prepared.height });
  }
  if (metas.length === 0) return [];
  ctx.store.update((s) => {
    for (const m of metas) s.content.images[m.id] = m;
    if (pick) s.content.drafts = s.content.drafts.map((x) => (x.id === draftId ? { ...x, imageId: metas[0]!.id, format: x.format === "text" ? "image" : x.format, updatedAt: new Date().toISOString() } : x));
  }, { recompute: false, emit: false });
  return metas.map((m) => m.id);
}

export interface DesignOptions {
  prompt?: string;
  count?: number;
}

export interface DesignResult {
  model: string;
  wanted: string;
  ids: string[];
  headline: string;
}

export async function designImage(ctx: Ctx, cfg: AiConfig, id: string, options: DesignOptions = {}, progress?: Progress): Promise<DesignResult> {
  const d = findDraft(ctx, id);
  if (!d) throw new Error("المسودة مش موجودة");
  const s = ctx.store.state;
  const settings = s.content.settings;
  let prompt = options.prompt?.trim() ?? "";
  let headline = "";
  if (!prompt) {
    progress?.("الذكاء الاصطناعي بيصمم فكرة الصورة…");
    const art = await artDirection({
      text: d.text.trim() || d.title,
      lang: d.lang,
      style: settings.imageStyle,
      aspect: settings.imageAspect,
      overlay: d.imageText,
      brandColors: settings.brandColors,
      role: s.profile.me.headline || s.profile.me.current_role,
    }, cfg);
    prompt = art.prompt;
    headline = art.headline;
    updateDraft(ctx, id, (x) => ({ ...x, imagePrompt: prompt }), false);
  }
  const count = options.count ?? settings.imageCount;
  progress?.(count > 1 ? `رسم ${fmtNumber(count)} نسخ… ممكن تاخذ دقيقة` : "رسم الصورة… ممكن تاخذ دقيقة");
  const result = await generateImage(cfg, {
    model: settings.imageModel,
    prompt: finalImagePrompt(prompt, settings.imageStyle, settings.imageAspect, d.imageText, settings.brandColors),
    aspect: settings.imageAspect,
    quality: settings.imageQuality,
    count,
  });
  const ids = await saveImages(ctx, id, result.images.map((img) => base64Blob(img.b64, img.type)), { prompt, model: result.model, source: "ai" });
  if (result.model !== settings.imageModel) ctx.store.update((st) => (st.content.settings.imageModel = result.model), { recompute: false, emit: false });
  return { model: result.model, wanted: settings.imageModel, ids, headline };
}

export function takenDates(ctx: Ctx): Set<string> {
  return new Set(ctx.store.state.content.drafts.filter((d) => d.status !== "published").map((d) => d.scheduledFor).filter(Boolean));
}

export function nextDates(ctx: Ctx, count: number, from = todayIso()): string[] {
  const s = ctx.store.state.content;
  const best = (s.strategy?.bestDays ?? []).map(weekdayIndex).filter((i) => i >= 0);
  const today = todayIso();
  const start = new Date(`${from > today ? from : today}T12:00:00`);
  if (from <= today) start.setDate(start.getDate() + 1);
  return freeDates(start, count, s.settings.postsPerWeek, best, takenDates(ctx));
}

export function scheduleDraft(ctx: Ctx, id: string, date: string): void {
  updateDraft(ctx, id, (x) => ({ ...x, scheduledFor: date, status: x.text.trim() && x.status !== "published" ? "scheduled" : x.status }), false);
}

export interface BatchResult {
  done: number;
  failed: number;
  firstError: string;
}

export async function writeIdeas(ctx: Ctx, cfg: AiConfig, ideas: ContentIdea[], progress: Progress): Promise<BatchResult> {
  const ids = ideas.map((idea) => addDraft(ctx, ideaDraft(idea)).id);
  let done = 0;
  progress(`كتابة ${fmtNumber(ids.length)} منشور…`);
  const results = await mapLimit(ids, 2, async (id) => {
    await writeDraft(ctx, cfg, id);
    done += 1;
    progress(`انكتب ${fmtNumber(done)} من ${fmtNumber(ids.length)}`);
  }, cfg.signal);
  ctx.store.emit();
  return batchResult(results, ids.length);
}

function batchResult(results: Array<PromiseSettledResult<unknown>>, total: number): BatchResult {
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  const done = results.filter((r) => r.status === "fulfilled").length;
  const reason = failed[0]?.reason;
  return { done, failed: total - done, firstError: reason ? aiErrorText(reason, "") : "" };
}

export function saveSeries(ctx: Ctx, plan: SeriesPlan, dates: string[]): ContentSeries {
  const series: ContentSeries = { ...plan, id: newId("s"), createdAt: new Date().toISOString() };
  const drafts = plan.parts.map((part, i) => newDraft({
    title: part.title,
    text: part.hook,
    format: part.format,
    lang: plan.lang,
    pillar: plan.pillar,
    status: "idea",
    notes: [part.angle, part.why].filter(Boolean).join("\n"),
    scheduledFor: dates[i] ?? "",
    seriesId: series.id,
    seriesIndex: i + 1,
  }));
  ctx.store.update((s) => {
    s.content.series = [series, ...s.content.series];
    s.content.drafts = [...drafts, ...s.content.drafts];
  }, { recompute: false, emit: false });
  return series;
}

export async function writeSeries(ctx: Ctx, cfg: AiConfig, seriesId: string, withImages: boolean, progress: Progress): Promise<BatchResult> {
  const pending = seriesDrafts(ctx, seriesId).filter((d) => d.status === "idea" || !d.text.trim());
  const results: Array<PromiseSettledResult<unknown>> = [];
  for (const [i, d] of pending.entries()) {
    if (cfg.signal?.aborted) break;
    progress(`كتابة الجزء ${fmtNumber(d.seriesIndex)} (${fmtNumber(i + 1)} من ${fmtNumber(pending.length)})…`);
    try {
      await writeDraft(ctx, cfg, d.id);
      if (withImages && (d.format === "image" || d.format === "text")) await designImage(ctx, cfg, d.id, { count: 1 }, progress);
      results.push({ status: "fulfilled", value: d.id });
    } catch (reason) {
      results.push({ status: "rejected", reason });
      if (cfg.signal?.aborted || isFatalError(reason)) break;
    }
  }
  ctx.store.emit();
  return batchResult(results, pending.length);
}

export interface AutopilotOptions {
  topic: string;
  format: Draft["format"] | "";
  image: boolean;
  schedule: boolean;
}

export interface AutopilotResult {
  id: string;
  date: string;
  imageError: string;
}

export async function autopilot(ctx: Ctx, cfg: AiConfig, options: AutopilotOptions, progress: Progress): Promise<AutopilotResult> {
  const s = ctx.store.state;
  const lang = s.content.settings.defaultLang;
  let idea: ContentIdea;
  if (options.topic.trim()) {
    idea = { title: options.topic.trim().slice(0, 200), hook: "", pillar: "", format: options.format || (options.image ? "image" : "text"), lang, why: "" };
  } else {
    progress("اختيار أفضل فكرة إلك هلأ…");
    const existing = s.content.drafts.map((d) => draftTitle(d));
    const [best] = await suggestIdeas(s.profile, s.content.posts, s.content.strategy, s.content.settings, existing, "", 1, cfg);
    idea = { ...best!, format: options.format || best!.format };
  }
  const draft = addDraft(ctx, ideaDraft(idea));
  progress("كتابة المنشور…");
  await writeDraft(ctx, cfg, draft.id);
  let imageError = "";
  const current = findDraft(ctx, draft.id);
  if (options.image && current && (current.format === "image" || current.format === "text")) {
    try {
      await designImage(ctx, cfg, draft.id, {}, progress);
    } catch (error) {
      if (cfg.signal?.aborted) throw error;
      imageError = errorText(error);
    }
  }
  let date = "";
  if (options.schedule) {
    date = nextDates(ctx, 1)[0] ?? "";
    if (date) scheduleDraft(ctx, draft.id, date);
  }
  if (!date) updateDraft(ctx, draft.id, (x) => ({ ...x, status: "ready" }), false);
  ctx.store.emit();
  return { id: draft.id, date, imageError };
}
