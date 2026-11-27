import type { ConversationAnalysis, ConversationStage, ConversationTone, StoredMessage } from "./types";

export const STAGES: ConversationStage[] = ["intro", "in_progress", "opportunity", "waiting_them", "waiting_me", "gone_cold", "closed"];
export const TONES: ConversationTone[] = ["positive", "neutral", "negative"];

export const STAGE_LABEL: Record<ConversationStage, string> = {
  intro: "تعارف",
  in_progress: "نقاش مستمر",
  opportunity: "في فرصة",
  waiting_them: "بانتظار ردهم",
  waiting_me: "بانتظار ردك",
  gone_cold: "بردت",
  closed: "انتهت",
};

export const TONE_LABEL: Record<ConversationTone, string> = { positive: "إيجابية", neutral: "عادية", negative: "سلبية" };

export function isStale(analysis: ConversationAnalysis, history: StoredMessage[]): boolean {
  const last = history[history.length - 1];
  return analysis.messageCount !== history.length || analysis.lastMessageAt !== (last?.at ?? "");
}

export function awaitingMyReply(history: StoredMessage[]): boolean {
  const last = history[history.length - 1];
  return Boolean(last && !last.outgoing);
}
