import { nameKey } from "./text";
import type { Contact, StoredMessage } from "./types";

export class ConversationIndex {
  private readonly bySlug = new Map<string, StoredMessage[]>();
  private readonly byName = new Map<string, StoredMessage[]>();

  constructor(messages: StoredMessage[]) {
    for (const m of messages) {
      const slugs = new Set<string>();
      const names = new Set<string>();
      for (const p of [m.from, ...m.to]) {
        if (p.slug) slugs.add(p.slug);
        else {
          const key = nameKey(p.name);
          if (key) names.add(key);
        }
      }
      for (const slug of slugs) push(this.bySlug, slug, m);
      for (const name of names) push(this.byName, name, m);
    }
  }

  of(c: Pick<Contact, "slug" | "fullName">): StoredMessage[] {
    const bySlug = c.slug ? this.bySlug.get(c.slug) ?? [] : [];
    const key = nameKey(c.fullName);
    const byName = key ? this.byName.get(key) ?? [] : [];
    if (byName.length === 0) return bySlug;
    if (bySlug.length === 0) return byName;
    const seen = new Set<StoredMessage>();
    return [...bySlug, ...byName].filter((m) => !seen.has(m) && seen.add(m)).sort((a, b) => a.at.localeCompare(b.at));
  }
}

function push(map: Map<string, StoredMessage[]>, key: string, m: StoredMessage): void {
  const list = map.get(key);
  if (list) list.push(m);
  else map.set(key, [m]);
}

let cached: { messages: StoredMessage[]; length: number; index: ConversationIndex } | null = null;

export function conversationIndex(messages: StoredMessage[]): ConversationIndex {
  if (cached && cached.messages === messages && cached.length === messages.length) return cached.index;
  const index = new ConversationIndex(messages);
  cached = { messages, length: messages.length, index };
  return index;
}
