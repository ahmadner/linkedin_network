import { conversationKey } from "./dataset";
import { threadUrl } from "./links";
import { asRecord, asString } from "./profile";
import { personKey } from "./text";
import type { Party, StoredMessage } from "./types";

export type MessageStatus = "awaiting_me" | "awaiting_them" | "replied" | "answered";
export type ConversationStatus = "awaiting_me" | "awaiting_them" | "done";

export const CONVERSATION_STATUSES: ConversationStatus[] = ["awaiting_me", "awaiting_them", "done"];

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  awaiting_me: "بانتظار ردّك",
  awaiting_them: "بانتظار ردّهم",
  done: "ما بدها رد",
};

export interface InboxOverride {
  status: ConversationStatus;
  at: string;
}

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
}

export interface Conversation {
  key: string;
  items: InboxItem[];
  people: Party[];
  last: StoredMessage;
  status: Exclude<ConversationStatus, "done">;
  pending: number;
  thread: string;
  search: string;
}

export function partyKey(p: Party): string {
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

function byTime(a: StoredMessage, b: StoredMessage): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}

function conversationOf(key: string, list: StoredMessage[]): Conversation {
  list.sort(byTime);
  const thread = threadUrl(list);
  const items: InboxItem[] = new Array<InboxItem>(list.length);
  const people = new Map<string, Party>();
  let laterIn = false;
  let laterOut = false;
  let pending = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i]!;
    const counterpart = counterpartOf(message);
    for (const p of counterpart) {
      const id = partyKey(p);
      const known = people.get(id);
      if (!known || (!known.name && p.name)) people.set(id, p);
    }
    const status: MessageStatus = message.outgoing ? (laterIn ? "answered" : "awaiting_them") : (laterOut ? "replied" : "awaiting_me");
    if (status === "awaiting_me") pending += 1;
    items[i] = { message, counterpart, status, thread };
    if (message.outgoing) laterOut = true;
    else laterIn = true;
  }
  const last = list[list.length - 1]!;
  const party = [...people.values()];
  return {
    key,
    items,
    people: party,
    last,
    status: last.outgoing ? "awaiting_them" : "awaiting_me",
    pending,
    thread,
    search: `${party.map((p) => p.name).join(" ")} ${list.map((m) => m.content).join(" ")}`.toLowerCase(),
  };
}

export function buildConversations(messages: StoredMessage[]): Conversation[] {
  const groups = new Map<string, StoredMessage[]>();
  for (const m of messages) {
    const key = threadKey(m);
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  return [...groups].map(([key, list]) => conversationOf(key, list)).sort((a, b) => byTime(b.last, a.last));
}

let cached: { messages: StoredMessage[]; length: number; conversations: Conversation[] } | null = null;

export function conversations(messages: StoredMessage[]): Conversation[] {
  if (cached && cached.messages === messages && cached.length === messages.length) return cached.conversations;
  const result = buildConversations(messages);
  cached = { messages, length: messages.length, conversations: result };
  return result;
}

export function activeOverride(conv: Pick<Conversation, "key" | "last">, overrides: Record<string, InboxOverride>): InboxOverride | null {
  const o = overrides[conv.key];
  return o && conv.last.at <= o.at ? o : null;
}

export function statusOf(conv: Conversation, overrides: Record<string, InboxOverride>): ConversationStatus {
  return activeOverride(conv, overrides)?.status ?? conv.status;
}

const DIRECTION: Record<ConversationStatus, string> = { awaiting_me: "them -> me", awaiting_them: "me -> them", done: "done" };

export function manualDirections(messages: StoredMessage[], overrides: Record<string, InboxOverride>): Map<string, string> {
  const out = new Map<string, string>();
  if (Object.keys(overrides).length === 0) return out;
  const latest = new Map<string, Conversation>();
  for (const conv of conversations(messages)) {
    if (conv.people.length !== 1) continue;
    const id = partyKey(conv.people[0]!);
    if (id && !latest.has(id)) latest.set(id, conv);
  }
  for (const [id, conv] of latest) {
    const o = activeOverride(conv, overrides);
    if (o) out.set(id, DIRECTION[o.status]);
  }
  return out;
}

export function sanitizeInbox(value: unknown): Record<string, InboxOverride> {
  const out: Record<string, InboxOverride> = {};
  for (const [key, raw] of Object.entries(asRecord(value))) {
    const r = asRecord(raw);
    const status = asString(r.status, 40) as ConversationStatus;
    const at = asString(r.at, 40);
    if (key.length <= 300 && CONVERSATION_STATUSES.includes(status) && at) out[key] = { status, at };
  }
  return out;
}
