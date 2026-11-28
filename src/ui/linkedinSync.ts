import type { JobStatus, SyncOptions } from "../../extension/src/protocol";
import { mergeSync } from "../core/dataset";
import { cleanProfileUrl } from "../core/text";
import { cancelSync, clearExtensionData, collectResult, detectExtension, startSync, syncStatus } from "../linkedin/bridge";
import { badge, type Ctx } from "./context";
import { fmtNumber, h } from "./dom";
import { arabicError, errorText } from "./errors";

export type ExtensionState = "unknown" | "ready" | "missing";

export const linkedinSync = {
  state: "unknown" as ExtensionState,
  version: "",
  job: null as JobStatus | null,
};

const PHASE_AR: Record<string, string> = {
  starting: "تجهيز",
  profile: "قراءة بروفايلك",
  connections: "سحب الأشخاص",
  discovery: "تجهيز الرسائل",
  conversations: "سحب المحادثات",
  messages: "سحب الرسائل",
  finished: "انتهى",
};

let poller: ReturnType<typeof setInterval> | undefined;
let detecting: Promise<void> | null = null;
let finishing = false;

async function finishSync(ctx: Ctx, job: JobStatus): Promise<void> {
  if (finishing) return;
  finishing = true;
  try {
    const payload = await ctx.busy("نقل البيانات من الإضافة…", (progress) => collectResult(job, progress));
    if (!payload) return;
    let people = 0;
    let messages = 0;
    ctx.store.update((s) => {
      const known = new Set(s.dataset.connections.map((c) => cleanProfileUrl(c.profileUrl).slug).filter(Boolean));
      const before = s.dataset.messages.length;
      s.dataset = mergeSync(s.dataset, payload);
      people = payload.connections.filter((c) => !known.has(c.slug)).length;
      messages = s.dataset.messages.length - before;
    });
    await clearExtensionData().catch(() => undefined);
    ctx.toast(`تمت المزامنة: ${fmtNumber(people)} شخص جديد، ${fmtNumber(payload.connections.length - people)} تحدّثت بياناتهم، ${fmtNumber(messages)} رسالة جديدة`);
    for (const n of payload.notes) ctx.toast(n);
  } finally {
    finishing = false;
  }
}

function stopPolling(): void {
  clearInterval(poller);
  poller = undefined;
}

function poll(ctx: Ctx, rerender: () => void): void {
  stopPolling();
  poller = setInterval(() => {
    syncStatus()
      .then(async (job) => {
        linkedinSync.job = job;
        if (!job || job.state !== "running") {
          stopPolling();
          if (job?.state === "done") await finishSync(ctx, job);
          else if (job?.state === "error") ctx.toast(arabicError(job.error), "error");
        }
        rerender();
      })
      .catch((error: unknown) => {
        stopPolling();
        ctx.toast(errorText(error), "error");
      });
  }, 2000);
}

export function detectSync(ctx: Ctx, rerender: () => void): Promise<void> {
  detecting ??= detectExtension().then((hello) => {
    if (!hello) {
      linkedinSync.state = "missing";
      rerender();
      return;
    }
    linkedinSync.state = "ready";
    linkedinSync.version = hello.version;
    linkedinSync.job = hello.job;
    if (hello.job?.state === "running") poll(ctx, rerender);
    else if (hello.job?.state === "done" && hello.job.finishedAt > ctx.store.state.dataset.sync.lastSyncAt) void finishSync(ctx, hello.job).then(rerender);
    rerender();
  });
  return detecting;
}

export function redetectSync(ctx: Ctx, rerender: () => void): void {
  detecting = null;
  linkedinSync.state = "unknown";
  rerender();
  void detectSync(ctx, rerender);
}

export function syncRunning(): boolean {
  return linkedinSync.job?.state === "running";
}

export async function runSync(ctx: Ctx, rerender: () => void, options: SyncOptions): Promise<void> {
  const { sync } = ctx.store.state.dataset;
  try {
    linkedinSync.job = await startSync({ newestConnectionAt: sync.newestConnectionAt, newestMessageAt: sync.newestMessageAt }, options);
    poll(ctx, rerender);
    rerender();
  } catch (error) {
    ctx.toast(errorText(error), "error");
  }
}

export async function stopSync(ctx: Ctx, rerender: () => void): Promise<void> {
  try {
    await cancelSync();
  } catch (error) {
    ctx.toast(errorText(error), "error");
  }
  rerender();
}

export function syncJobLine(job: JobStatus | null): HTMLElement | null {
  if (!job) return null;
  const state = { running: "شغّالة", done: "خلصت", error: "وقفت بخطأ", cancelled: "انلغت" }[job.state];
  return h("div", { class: "job" },
    h("p", {}, badge(state, job.state === "error" ? "bad" : job.state === "done" ? "good" : ""), " ", PHASE_AR[job.phase] ?? job.phase),
    h("p", { class: "muted" }, `أشخاص: ${fmtNumber(job.counts.connections)} · محادثات: ${fmtNumber(job.counts.conversations)} · رسائل: ${fmtNumber(job.counts.messages)}`),
    job.error ? h("p", { class: "error-text" }, arabicError(job.error)) : null,
    job.notes.length > 0 ? h("ul", { class: "notes" }, job.notes.map((n) => h("li", {}, n))) : null,
  );
}
