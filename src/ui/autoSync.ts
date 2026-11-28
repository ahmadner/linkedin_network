import { AUTO_SYNC_MINUTES, nextAutoSyncAt, autoSyncDue, parseAutoSync, type AutoSyncSettings } from "../core/autoSync";
import type { Ctx, ViewId } from "./context";
import { h, isEditing, select } from "./dom";
import { detectSync, lastSyncStart, linkedinSync, runSync, syncBusy, type ManualSyncOptions } from "./linkedinSync";

const KEY = "lnt.autoSync";
const CHECK_MS = 15_000;
const SYNC_VIEWS = new Set<ViewId>(["data", "messages"]);
const OPTIONS: ManualSyncOptions = { messages: true, photos: false, maxConversations: 3000 };

const LABELS: Record<number, string> = {
  3: "كل 3 دقايق",
  5: "كل 5 دقايق",
  10: "كل 10 دقايق",
  15: "كل ربع ساعة",
  30: "كل نص ساعة",
  60: "كل ساعة",
};

let memory: AutoSyncSettings | null = null;
let started = false;

export function autoSyncSettings(): AutoSyncSettings {
  if (memory) return memory;
  try {
    return parseAutoSync(localStorage.getItem(KEY));
  } catch {
    return parseAutoSync(null);
  }
}

function saveSettings(next: AutoSyncSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    memory = null;
  } catch {
    memory = next;
  }
}

function hasBaseline(ctx: Ctx): boolean {
  const { sync, importMeta } = ctx.store.state.dataset;
  return Boolean(sync.lastSyncAt || importMeta.exportImportedAt);
}

function ready(ctx: Ctx): boolean {
  return linkedinSync.state === "ready" && !linkedinSync.autoPaused && hasBaseline(ctx);
}

export function startAutoSync(ctx: Ctx, rerender: () => void, view: () => ViewId): void {
  if (started) return;
  started = true;
  const quiet = (): void => {
    if (SYNC_VIEWS.has(view()) && !isEditing()) rerender();
  };
  const tick = (): void => {
    if (!ready(ctx) || syncBusy() || !navigator.onLine) return;
    if (!autoSyncDue(autoSyncSettings(), lastSyncStart(), Date.now())) return;
    void runSync(ctx, quiet, OPTIONS, true);
  };
  void detectSync(ctx, rerender).then(tick);
  setInterval(tick, CHECK_MS);
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function autoSyncStatus(ctx: Ctx): string {
  const settings = autoSyncSettings();
  if (!settings.enabled) return "المزامنة التلقائية موقفة.";
  if (linkedinSync.autoPaused) return `المزامنة التلقائية وقفت بسبب خطأ: ${linkedinSync.autoPaused} اعمل مزامنة يدوية لما تحل المشكلة وبترجع تشتغل.`;
  const every = LABELS[settings.minutes] ?? "";
  if (linkedinSync.state !== "ready") return `المزامنة التلقائية (${every}) بتشتغل لما تكون الإضافة موصولة.`;
  if (!hasBaseline(ctx)) return `المزامنة التلقائية (${every}) بتبدأ بعد أول مزامنة يدوية أو رفع الـ Export.`;
  if (syncBusy()) return `مزامنة تلقائية ${every}. في مزامنة شغّالة هلأ.`;
  return `مزامنة تلقائية ${every}. الجاية تقريبًا الساعة ${clock(nextAutoSyncAt(settings, lastSyncStart(), Date.now()))}.`;
}

export function autoSyncControls(ctx: Ctx, rerender: () => void): HTMLElement {
  const settings = autoSyncSettings();
  const toggle = h("input", { type: "checkbox", checked: settings.enabled });
  toggle.addEventListener("change", () => {
    saveSettings({ ...autoSyncSettings(), enabled: toggle.checked });
    rerender();
  });
  const interval = select(
    AUTO_SYNC_MINUTES.map((m) => [String(m), LABELS[m] ?? String(m)]),
    String(settings.minutes),
    (value) => {
      saveSettings({ ...autoSyncSettings(), minutes: Number(value) });
      rerender();
    },
    { disabled: !settings.enabled, "aria-label": "مدة المزامنة التلقائية" },
  );
  return h("div", { class: "auto-sync" },
    h("div", { class: "row tight wrap" }, h("label", { class: "check" }, toggle, " مزامنة تلقائية"), interval),
    h("p", { class: linkedinSync.autoPaused ? "error-text small" : "muted small" }, autoSyncStatus(ctx)),
  );
}
