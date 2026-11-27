import { getApiKey } from "../ai/key";
import { isModelAccessError, OpenAiError, type AiConfig } from "../ai/openai";
import { conversationIndex } from "../core/conversations";
import { profileLink, threadUrl } from "../core/links";
import { STATUS_AR } from "../core/tracking";
import type { Contact } from "../core/types";
import { rowsCsv, rowsWorkbook, XLSX_TYPE, type Column } from "../io/excel";
import { download, h } from "./dom";
import type { Store } from "./store";

export type ViewId = "home" | "data" | "contacts" | "companies" | "dashboard" | "opportunities" | "outreach" | "content" | "profile" | "ai" | "quality";

export interface Ctx {
  store: Store;
  go(view: ViewId): void;
  toast(text: string, kind?: "ok" | "error"): void;
  busy<T>(label: string, task: (progress: (text: string) => void) => Promise<T>, onCancel?: () => void): Promise<T | undefined>;
}

export function createToaster(host: HTMLElement): Ctx["toast"] {
  return (text, kind = "ok") => {
    const el = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, text);
    host.appendChild(el);
    setTimeout(() => el.remove(), kind === "error" ? 9000 : 4000);
  };
}

export function createBusy(host: HTMLElement, toast: Ctx["toast"]): Ctx["busy"] {
  return async (label, task, onCancel) => {
    const status = h("p", { class: "busy-status" });
    const stop = onCancel ? h("button", { type: "button", class: "secondary", onclick: onCancel }, "إيقاف") : null;
    const overlay = h("div", { class: "busy", role: "status", "aria-live": "polite" }, h("div", { class: "busy-box" }, h("div", { class: "spinner" }), h("strong", {}, label), status, stop));
    host.appendChild(overlay);
    try {
      return await task((text) => (status.textContent = text));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
      return undefined;
    } finally {
      overlay.remove();
    }
  };
}

export function card(title: string, ...children: Array<Node | string | null | false>): HTMLElement {
  return h("section", { class: "card" }, h("h2", {}, title), ...children);
}

export function kpi(label: string, value: string, note: string, onClick?: () => void, tone = ""): HTMLElement {
  const body = [h("span", {}, label), h("strong", {}, value), h("small", {}, note)];
  return onClick
    ? h("button", { type: "button", class: `kpi clickable ${tone}`, onclick: onClick }, ...body)
    : h("div", { class: `kpi ${tone}` }, ...body);
}

export function badge(text: string, tone = ""): HTMLElement {
  return h("span", { class: `badge ${tone}` }, text);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => [...p][0] ?? "").join("").toUpperCase() || "?";
}

export function avatar(ctx: Ctx, c: Pick<Contact, "slug" | "fullName">, size: "small" | "large" = "small"): HTMLElement {
  const fallback = (): HTMLElement => h("span", { class: `avatar ${size}`, "aria-hidden": "true" }, initials(c.fullName));
  const url = c.slug ? ctx.store.state.dataset.photos[c.slug] : undefined;
  if (!url) return fallback();
  const img = h("img", { class: `avatar ${size}`, src: url, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.replaceWith(fallback()), { once: true });
  return img;
}

export function linkedinLinks(ctx: Ctx, c: Pick<Contact, "slug" | "fullName" | "profileUrl">, compact = false): HTMLElement | null {
  const thread = threadUrl(conversationIndex(ctx.store.state.dataset.messages).of(c));
  const profile = profileLink(c.profileUrl);
  if (!thread && !profile) return null;
  const link = (href: string, label: string): HTMLElement => {
    const a = h("a", { href, target: "_blank", rel: "noopener noreferrer", class: compact ? "small" : "button secondary small" }, label);
    a.addEventListener("click", (e) => e.stopPropagation());
    a.addEventListener("keydown", (e) => e.stopPropagation());
    return a;
  };
  return h("span", { class: "row tight wrap" },
    thread ? link(thread, "افتح المحادثة") : null,
    profile ? link(profile, "افتح البروفايل") : null,
  );
}

export const MODE_AR: Record<string, string> = { cold: "أول تواصل", reconnect: "تواصلنا قبل", nudge: "بانتظار رد" };

export { STATUS_AR, STATUSES } from "../core/tracking";

export const STATUS_TONE: Record<string, string> = { Replied: "good", "Meeting booked": "good", Referred: "good", "Closed - no fit": "muted-badge" };

export function statusBadge(status: string): HTMLElement {
  return badge(STATUS_AR[status] ?? status, STATUS_TONE[status] ?? "");
}

export function ago(days: number | null): string {
  if (days === null) return "—";
  if (days <= 0) return "اليوم";
  if (days === 1) return "مبارح";
  if (days < 30) return `قبل ${days} يوم`;
  if (days < 365) return `قبل ${Math.round(days / 30)} شهر`;
  return `قبل ${Math.round(days / 365)} سنة`;
}

export function awaitingMe(c: Contact): boolean {
  return c.history.lastDirection === "them -> me" && c.tracking.status !== "Closed - no fit";
}

export function emptyState(title: string, text: string, action?: [string, () => void]): HTMLElement {
  return h("section", { class: "card empty" },
    h("h2", {}, title),
    h("p", { class: "muted" }, text),
    action ? h("button", { type: "button", onclick: action[1] }, action[0]) : null,
  );
}

export function noData(ctx: Ctx): HTMLElement {
  return h("div", { class: "view" }, emptyState("ما في بيانات لسا", "ارفع ملف الـ Export من LinkedIn أو اعمل مزامنة من الإضافة، وبعدها بتطلع كل الصفحات.", ["روح لصفحة البيانات", () => ctx.go("data")]));
}

export function aiErrorText(error: unknown, model: string): string {
  if (error instanceof DOMException && error.name === "AbortError") return "وقّفت الشغل. اللي خلص قبل الإيقاف انحفظ.";
  if (isModelAccessError(error)) return `حسابك ما بيقدر يستخدم الموديل ${model}. بعض الموديلات بدها توثيق للمنظمة على OpenAI، فاختار موديل ثاني من صفحة الذكاء الاصطناعي.`;
  if (error instanceof OpenAiError && error.status === 401) return "مفتاح OpenAI غلط أو انلغى. حط مفتاح جديد من صفحة الذكاء الاصطناعي.";
  if (error instanceof OpenAiError && error.code === "insufficient_quota") return "رصيد OpenAI خلص. اشحن الحساب من platform.openai.com وجرّب مرة ثانية.";
  if (error instanceof OpenAiError && error.status === 429) return "OpenAI طلب نخفف الطلبات. استنى دقيقة وجرّب مرة ثانية.";
  return error instanceof Error ? error.message : String(error);
}

export function keepFallbackModel(ctx: Ctx, from: string, cfg: AiConfig): void {
  if (cfg.model === from) return;
  ctx.store.update((s) => (s.ai.model = cfg.model), { recompute: false });
  ctx.toast(`حسابك ما بيقدر يستخدم ${from}، فكمّلت بـ ${cfg.model} وصار هو الموديل الافتراضي.`);
}

export function exportLinks<T>(ctx: Ctx, name: string, cols: Array<Column<T>>, rows: () => T[]): HTMLElement {
  const stamp = (): string => `${name}-${new Date().toISOString().slice(0, 10)}`;
  const csv = (): void => download(`${stamp()}.csv`, rowsCsv(cols, rows()), "text/csv;charset=utf-8");
  const xlsx = async (): Promise<void> => {
    const buffer = await ctx.busy("تجهيز ملف Excel…", () => rowsWorkbook(name, cols, rows()));
    if (buffer) download(`${stamp()}.xlsx`, buffer, XLSX_TYPE);
  };
  return h("span", { class: "export-links" },
    h("span", { class: "muted small" }, "تنزيل:"),
    h("button", { type: "button", class: "link", onclick: csv }, "CSV"),
    h("button", { type: "button", class: "link", onclick: () => void xlsx() }, "Excel"),
  );
}

function aiConfigOrRedirect(ctx: Ctx): AiConfig | null {
  const key = getApiKey();
  if (key) return { key, model: ctx.store.state.ai.model };
  ctx.toast("حط مفتاح OpenAI بصفحة الذكاء الاصطناعي أول", "error");
  ctx.go("ai");
  return null;
}

export async function runAi<T>(ctx: Ctx, label: string, task: (cfg: AiConfig, progress: (text: string) => void) => Promise<T>): Promise<T | undefined> {
  const cfg = aiConfigOrRedirect(ctx);
  if (!cfg) return undefined;
  const controller = new AbortController();
  cfg.signal = controller.signal;
  const from = cfg.model;
  const result = await ctx.busy(label, (progress) => task(cfg, progress).catch((error: unknown) => {
    throw new Error(aiErrorText(error, cfg.model));
  }), () => controller.abort());
  keepFallbackModel(ctx, from, cfg);
  return result;
}
