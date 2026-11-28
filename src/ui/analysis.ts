import { analyzeConversation, type ConversationPartner } from "../ai/features";
import { isStale, STAGE_LABEL, TONE_LABEL } from "../core/conversation";
import { todayIso } from "../core/dates";
import type { Contact, StoredMessage } from "../core/types";
import { badge, runAi, type Ctx } from "./context";
import { copyText, h } from "./dom";
import { icon } from "./icons";
import { queueMessages } from "./views/outreach";

export interface AnalysisTarget {
  key: string;
  partner: ConversationPartner;
  contact: Contact | null;
  history: StoredMessage[];
}

const STAGE_TONE: Record<string, string> = { opportunity: "good", waiting_me: "bad", gone_cold: "warn", closed: "" };

export function textDir(text: string): string {
  return /[؀-ۿ]/.test(text) ? "rtl" : "ltr";
}

export function messageBlock(title: string, text: string, limit?: number, queue?: () => void): HTMLElement {
  const copy = h("button", { type: "button", class: "link" }, "نسخ");
  copy.addEventListener("click", () => void copyText(text).then((ok) => (copy.textContent = ok ? "انّسخ ✓" : "ما زبط النسخ")));
  const over = limit !== undefined && text.length > limit;
  return h("div", { class: "msg" },
    h("div", { class: "msg-head" },
      h("strong", {}, title),
      h("span", { class: over ? "count over" : "count", title: over ? "أطول من الحد المسموح" : "" }, limit ? `${text.length}/${limit}` : `${text.length}`),
      copy,
      queue && text.trim() ? h("button", { type: "button", class: "secondary small", onclick: queue }, icon("send"), "جهّز للإرسال") : null,
    ),
    h("pre", { dir: textDir(text) }, text),
  );
}

export async function runAnalysis(ctx: Ctx, target: AnalysisTarget): Promise<void> {
  const out = await runAi(ctx, "تحليل المحادثة…", (cfg) => analyzeConversation(target.partner, ctx.store.state.profile, target.history, cfg, todayIso()));
  if (out) ctx.store.update((s) => (s.ai.analyses[target.key] = out), { recompute: false });
}

export function analysisResult(ctx: Ctx, target: AnalysisTarget): HTMLElement | null {
  const result = ctx.store.state.ai.analyses[target.key];
  if (!result) return null;
  const limit = ctx.store.state.profile.messaging.message_char_limit;
  const contact = target.contact;
  const queue = (text: string): (() => void) | undefined => (contact ? () => queueMessages(ctx, [{ contact, text }]) : undefined);
  return h("div", { class: "analysis" },
    h("div", { class: "row tight wrap" },
      badge(STAGE_LABEL[result.stage], STAGE_TONE[result.stage] ?? ""),
      badge(`النبرة: ${TONE_LABEL[result.tone]}`, result.tone === "positive" ? "good" : result.tone === "negative" ? "bad" : ""),
      isStale(result, target.history) ? badge("في رسائل جديدة بعد التحليل", "warn") : null,
      h("span", { class: "muted small" }, `${result.generatedAt.slice(0, 10)} · ${result.model}`),
    ),
    result.summary_ar ? h("p", {}, result.summary_ar) : null,
    result.next_step_ar ? h("p", { class: "advice" }, h("strong", {}, "الخطوة الجاية: "), result.next_step_ar) : null,
    result.reply_ar ? messageBlock("رد مقترح - عربي", result.reply_ar, limit, queue(result.reply_ar)) : null,
    result.reply_en ? messageBlock("Suggested reply - English", result.reply_en, limit, queue(result.reply_en)) : null,
  );
}

export function analysisSection(ctx: Ctx, target: AnalysisTarget): HTMLElement {
  const result = analysisResult(ctx, target);
  return h("section", { class: "panel-section" },
    h("h3", {}, "تحليل المحادثة بالذكاء الاصطناعي"),
    h("div", { class: "row tight wrap" },
      h("button", { type: "button", class: "secondary small", onclick: () => void runAnalysis(ctx, target) }, icon("spark"), result ? "حلّل من جديد" : "حلّل المحادثة"),
    ),
    result ?? h("p", { class: "muted small" }, `بيقرأ آخر ${Math.min(target.history.length, 20)} رسالة، وبيحكيلك وين وقفتوا وشو الخطوة الجاية، وبيقترح رد جاهز.`),
  );
}
