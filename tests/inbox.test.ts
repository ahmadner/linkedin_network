import { describe, expect, it } from "vitest";
import { buildInbox, inbox, statusCounts } from "../src/core/inbox";
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
  msg("1", "c1", "2026-11-01T10:00:00Z", true, [lina]),
  msg("2", "c1", "2026-11-02T10:00:00Z", false, [lina]),
  msg("3", "c1", "2026-11-03T10:00:00Z", false, [lina]),
  msg("4", "c2", "2026-11-04T10:00:00Z", false, [omar]),
  msg("5", "c2", "2026-11-05T10:00:00Z", true, [omar]),
  msg("6", "c2", "2026-11-06T10:00:00Z", true, [omar]),
  msg("7", "", "2026-11-07T10:00:00Z", false, [sara]),
];

describe("inbox", () => {
  it("lists every message newest first with its status", () => {
    const items = buildInbox(messages);
    expect(items.map((i) => [i.message.id, i.status])).toEqual([
      ["7", "awaiting_me"],
      ["6", "awaiting_them"],
      ["5", "awaiting_them"],
      ["4", "replied"],
      ["3", "awaiting_me"],
      ["2", "awaiting_me"],
      ["1", "answered"],
    ]);
  });

  it("names the other side of each message", () => {
    const items = buildInbox(messages);
    expect(items.find((i) => i.message.id === "1")?.counterpart).toEqual([lina]);
    expect(items.find((i) => i.message.id === "4")?.counterpart).toEqual([omar]);
    expect(items.find((i) => i.message.id === "7")?.counterpart).toEqual([sara]);
  });

  it("keeps threads apart when the conversation id is missing", () => {
    const items = buildInbox([
      msg("a", "", "2026-11-01T10:00:00Z", true, [sara]),
      msg("b", "", "2026-11-02T10:00:00Z", false, [omar]),
    ]);
    expect(items.map((i) => [i.message.id, i.status])).toEqual([["b", "awaiting_me"], ["a", "awaiting_them"]]);
  });

  it("counts a reply from anyone in a group chat", () => {
    const items = buildInbox([
      msg("g1", "g", "2026-11-01T10:00:00Z", true, [lina, omar]),
      msg("g2", "g", "2026-11-02T10:00:00Z", false, [omar]),
    ]);
    expect(items.map((i) => [i.message.id, i.status])).toEqual([["g2", "awaiting_me"], ["g1", "answered"]]);
    expect(items[1]?.counterpart).toEqual([lina, omar]);
  });

  it("searches names and text in lower case", () => {
    const item = buildInbox([msg("x", "c", "2026-11-01T10:00:00Z", false, [lina])])[0]!;
    expect(item.search).toContain("lina haddad");
    expect(item.search).toContain("text x");
  });

  it("counts statuses and reuses the result for the same list", () => {
    const first = inbox(messages);
    expect(inbox(messages)).toBe(first);
    expect(statusCounts(first)).toEqual({ awaiting_me: 3, awaiting_them: 2, replied: 1, answered: 1 });
  });
});
