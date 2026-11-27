import { conversationKey } from "./dataset";
import type { StoredMessage } from "./types";

const THREAD_ID = /^2-[A-Za-z0-9+/=_-]+$/;

export function threadId(messages: StoredMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.to.length !== 1) continue;
    const id = conversationKey(m.conversationId);
    if (THREAD_ID.test(id)) return id;
  }
  return "";
}

export function threadUrl(messages: StoredMessage[]): string {
  const id = threadId(messages);
  return id ? `https://www.linkedin.com/messaging/thread/${encodeURIComponent(id)}/` : "";
}

export function profileLink(url: string): string {
  return url.startsWith("https://www.linkedin.com/in/") ? url : "";
}
