import { describe, expect, it } from "vitest";
import { buildConversations, conversations } from "../src/core/inbox";
import type { Party, StoredMessage } from "../src/core/types";

const me: Party = { name: "Me", slug: "me" };
const lina: Party = { name: "Lina Haddad", slug: "lina-haddad" };
const omar: Party = { name: "Omar Khalil", slug: "omar-khalil" };
const sara: Party = { name: "Sara Odeh", slug: "" };

const msg = (id: string, conversationId: string, at: string, outgoing: boolean, other: Party[]): StoredMessage => ({
  id, conversationId, at, outgoing, content: `text ${id}`, origin: "export",
  from: outgoing ? me : other[0]!,
  to: outgoing ? other : [me],
});

const messages: StoredMessage[] = [
  msg("3", "c1", "2026-11-03T10:00:00Z", false, [lina]),
  msg("1", "c1", "2026-11-01T10:00:00Z", true, [lina]),
  msg("2", "c1", "2026-11-02T10:00:00Z", false, [lina]),
  msg("4", "c2", "2026-11-04T10:00:00Z", false, [omar]),
  msg("5", "c2", "2026-11-05T10:00:00Z", true, [omar]),
  msg("6", "c2", "2026-11-06T10:00:00Z", true, [omar]),
  msg("7", "", "2026-11-07T10:00:00Z", false, [sara]),
];

describe("conversations", () => {
  it("groups messages by thread, newest conversation first, messages in time order", () => {
    const list = buildConversations(messages);
    expect(list.map((c) => c.items.map((i) => i.message.id))).toEqual([["7"], ["4", "5", "6"], ["1", "2", "3"]]);
    expect(list.map((c) => c.people)).toEqual([[sara], [omar], [lina]]);
  });

  it("gives each message a status from the replies after it", () => {
    const list = buildConversations(messages);
    const status = (key: number): string[] => list[key]!.items.map((i) => i.status);
    expect(status(2)).toEqual(["answered", "awaiting_me", "awaiting_me"]);
    expect(status(1)).toEqual(["replied", "awaiting_them", "awaiting_them"]);
  });

  it("sets the conversation status from its last message and counts what waits for me", () => {
    const list = buildConversations(messages);
    expect(list.map((c) => [c.status, c.pending])).toEqual([["awaiting_me", 1], ["awaiting_them", 0], ["awaiting_me", 2]]);
  });

  it("keeps threads apart when the conversation id is missing", () => {
    const list = buildConversations([
      msg("a", "", "2026-11-01T10:00:00Z", true, [sara]),
      msg("b", "", "2026-11-02T10:00:00Z", false, [omar]),
    ]);
    expect(list.map((c) => c.items.map((i) => i.message.id))).toEqual([["b"], ["a"]]);
  });

  it("counts a reply from anyone in a group chat and lists every member once", () => {
    const [group] = buildConversations([
      msg("g1", "g", "2026-11-01T10:00:00Z", true, [lina, omar]),
      msg("g2", "g", "2026-11-02T10:00:00Z", false, [omar]),
    ]);
    expect(group?.items.map((i) => i.status)).toEqual(["answered", "awaiting_me"]);
    expect(group?.people).toEqual([omar, lina]);
  });

  it("searches names and every message in lower case", () => {
    const [conv] = buildConversations(messages.filter((m) => m.conversationId === "c1"));
    expect(conv?.search).toContain("lina haddad");
    expect(conv?.search).toContain("text 1");
    expect(conv?.search).toContain("text 3");
  });

  it("reuses the result for the same message list", () => {
    const first = conversations(messages);
    expect(conversations(messages)).toBe(first);
  });
});
