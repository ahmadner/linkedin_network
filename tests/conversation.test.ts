import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeConversation } from "../src/ai/features";
import { awaitingMyReply, isStale } from "../src/core/conversation";
import { ConversationIndex } from "../src/core/conversations";
import { defaultProfile } from "../src/core/profile";
import type { Contact, StoredMessage } from "../src/core/types";

const msg = (id: string, at: string, outgoing: boolean, other: { name: string; slug: string }): StoredMessage => ({
  id, conversationId: "c1", at, outgoing, content: `text ${id}`, origin: "export",
  from: outgoing ? { name: "Me", slug: "me" } : other,
  to: [outgoing ? other : { name: "Me", slug: "me" }],
});

const lina = { name: "Lina Haddad", slug: "lina-haddad" };
const messages = [
  msg("1", "2026-11-01T10:00:00Z", true, lina),
  msg("2", "2026-11-02T10:00:00Z", false, { name: "Lina Haddad", slug: "" }),
  msg("3", "2026-11-03T10:00:00Z", false, lina),
  msg("4", "2026-11-04T10:00:00Z", true, { name: "Omar Khalil", slug: "omar-khalil" }),
];

afterEach(() => vi.unstubAllGlobals());

describe("conversation index", () => {
  it("matches by slug and by name when the slug is missing, in time order", () => {
    const index = new ConversationIndex(messages);
    expect(index.of({ slug: "lina-haddad", fullName: "Lina Haddad" }).map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(index.of({ slug: "omar-khalil", fullName: "Omar Khalil" }).map((m) => m.id)).toEqual(["4"]);
    expect(index.of({ slug: "", fullName: "Nobody" })).toEqual([]);
  });

  it("knows who owes a reply and when an analysis is stale", () => {
    const history = new ConversationIndex(messages).of({ slug: "lina-haddad", fullName: "Lina Haddad" });
    expect(awaitingMyReply(history)).toBe(true);
    const analysis = { messageCount: 3, lastMessageAt: "2026-11-03T10:00:00Z" } as Parameters<typeof isStale>[0];
    expect(isStale(analysis, history)).toBe(false);
    expect(isStale(analysis, history.slice(0, 2))).toBe(true);
  });
});

describe("conversation analysis", () => {
  it("keeps only allowed labels and falls back to who wrote last", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ stage: "maybe", tone: "happy", summary_ar: "ملخص", next_step_ar: "رد عليها", reply_ar: "أهلين", reply_en: "Hi" }) } }],
    }), { status: 200 })));
    const history = new ConversationIndex(messages).of({ slug: "lina-haddad", fullName: "Lina Haddad" });
    const contact = { greetingName: "Lina", positionPrimary: "Recruiter", positionClean: "Recruiter", companyClean: "Arab Bank" } as Contact;
    const result = await analyzeConversation(contact, defaultProfile(), history, { key: "sk-test", model: "gpt-4.1-mini" }, "2026-11-27");
    expect(result.stage).toBe("waiting_me");
    expect(result.tone).toBe("neutral");
    expect(result.messageCount).toBe(3);
    expect(result.next_step_ar).toBe("رد عليها");
  });
});
