import { h } from "./dom";
import type { Store } from "./store";

export type ViewId = "data" | "contacts" | "companies" | "dashboard" | "profile" | "ai" | "quality";

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

export function badge(text: string, tone = ""): HTMLElement {
  return h("span", { class: `badge ${tone}` }, text);
}

export const MODE_AR: Record<string, string> = { cold: "أول تواصل", reconnect: "تواصلنا قبل", nudge: "بانتظار رد" };
