import { conversationKey } from "./dataset";
import { threadUrl } from "./links";
import { personKey } from "./text";
import type { Party, StoredMessage } from "./types";

export type MessageStatus = "awaiting_me" | "awaiting_them" | "replied" | "answered";

export const MESSAGE_STATUSES: MessageStatus[] = ["awaiting_me", "awaiting_them", "replied", "answered"];

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  awaiting_me: "بانتظار ردّك",
  awaiting_them: "بانتظار ردّهم",
  replied: "رديت عليها",
  answered: "ردّوا عليها",
};

export interface InboxItem {
  message: StoredMessage;
  counterpart: Party[];
  status: MessageStatus;
  thread: string;
  search: string;
}

function partyKey(p: Party): string {
  return p.slug || personKey(p.name);
}

function counterpartOf(m: StoredMessage): Party[] {
  const parties = m.outgoing ? m.to : [m.from];
  return parties.filter((p) => p.slug || p.name);
}

function threadKey(m: StoredMessage): string {
  const id = conversationKey(m.conversationId);
  if (id) return `c|${id}`;
  return `p|${counterpartOf(m).map(partyKey).sort().join(",")}`;
}

export function buildInbox(messages: StoredMessage[]): InboxItem[] {
  const threads = new Map<string, StoredMessage[]>();
  for (const m of messages) {
    const key = threadKey(m);
    const list = threads.get(key);
    if (list) list.push(m);
    else threads.set(key, [m]);
  }
  const items: InboxItem[] = [];
  for (const list of threads.values()) {
    list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const url = threadUrl(list);
    let laterIn = false;
    let laterOut = false;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i]!;
      const counterpart = counterpartOf(m);
      const status: MessageStatus = m.outgoing ? (laterIn ? "answered" : "awaiting_them") : (laterOut ? "replied" : "awaiting_me");
      items.push({ message: m, counterpart, status, thread: url, search: `${counterpart.map((p) => p.name).join(" ")} ${m.content}`.toLowerCase() });
      if (m.outgoing) laterOut = true;
      else laterIn = true;
    }
  }
  return items.sort((a, b) => (a.message.at < b.message.at ? 1 : a.message.at > b.message.at ? -1 : 0));
}

let cached: { messages: StoredMessage[]; length: number; items: InboxItem[] } | null = null;

export function inbox(messages: StoredMessage[]): InboxItem[] {
  if (cached && cached.messages === messages && cached.length === messages.length) return cached.items;
  const items = buildInbox(messages);
  cached = { messages, length: messages.length, items };
  return items;
}

export function statusCounts(items: InboxItem[]): Record<MessageStatus, number> {
  const counts: Record<MessageStatus, number> = { awaiting_me: 0, awaiting_them: 0, replied: 0, answered: 0 };
  for (const i of items) counts[i.status] += 1;
  return counts;
}
