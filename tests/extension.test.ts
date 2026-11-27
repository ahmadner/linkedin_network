import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import targets from "../extension/targets.json";
import { conversationsPageUrl, findGraphqlUrls, messagesUrl, parseConnections, parseConversations, parseMe, parseMessages } from "../extension/src/linkedin";

describe("extension parsers", () => {
  it("reads normalized connection pages", () => {
    const json = {
      data: { "*elements": ["urn:li:fsd_connection:1"] },
      included: [
        { entityUrn: "urn:li:fsd_connection:1", createdAt: Date.UTC(2026, 10, 20), connectedMember: "urn:li:fsd_profile:ABC" },
        { entityUrn: "urn:li:fsd_profile:ABC", publicIdentifier: "Lina-Haddad", firstName: "Lina", lastName: "Haddad", headline: "Talent Partner at Arab Bank" },
      ],
    };
    expect(parseConnections(json)).toEqual([{ slug: "lina-haddad", firstName: "Lina", lastName: "Haddad", headline: "Talent Partner at Arab Bank", connectedAt: "2026-11-20" }]);
  });

  it("reads the legacy connection shape and the owner", () => {
    const legacy = { elements: [{ createdAt: 1, miniProfile: { publicIdentifier: "x", firstName: "X", lastName: "Y", occupation: "Dev" } }] };
    expect(parseConnections(legacy)[0]).toMatchObject({ slug: "x", headline: "Dev" });
    expect(parseMe({ included: [{ publicIdentifier: "me", firstName: "Ahmad", lastName: "N" }] })).toEqual({ slug: "me", name: "Ahmad N" });
  });

  it("reads messenger conversations and messages", () => {
    const conv = "urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-abc)";
    const json = {
      included: [
        { entityUrn: conv, lastActivityAt: 1700000000000, "*conversationParticipants": ["p1", "p2"] },
        { entityUrn: "p1", participantType: { member: { firstName: { text: "Ahmad" }, lastName: { text: "N" }, profileUrl: "https://www.linkedin.com/in/me" } } },
        { entityUrn: "p2", participantType: { member: { firstName: { text: "Lina" }, lastName: { text: "H" }, profileUrl: "https://www.linkedin.com/in/lina-h" } } },
        { entityUrn: "m1", deliveredAt: 1700000000000, "*sender": "p2", "*conversation": conv, body: { text: "hello" } },
      ],
    };
    const conversations = parseConversations(json);
    expect(conversations[0]!.participants.map((p) => p.slug)).toEqual(["me", "lina-h"]);
    const messages = parseMessages(json, new Map(conversations.map((c) => [c.urn, c])));
    expect(messages).toEqual([{ id: "m1", conversationId: conv, at: new Date(1700000000000).toISOString(), from: { name: "Lina H", slug: "lina-h" }, to: [{ name: "Ahmad N", slug: "me" }], content: "hello" }]);
  });

  it("finds and rewrites messenger GraphQL urls", () => {
    const base = "https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql";
    const urls = findGraphqlUrls([
      `${base}?queryId=messengerConversations.abc123&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3AME)`,
      `${base}?queryId=messengerMessages.def456&variables=(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28x%2C1%29)`,
    ]);
    expect(conversationsPageUrl(urls.conversations, 99)).toContain("variables=(lastUpdatedBefore:99,mailboxUrn:");
    expect(conversationsPageUrl(conversationsPageUrl(urls.conversations, 99), 42)).toContain("lastUpdatedBefore:42,");
    expect(messagesUrl(urls.messages, "urn:li:msg_conversation:(y,2)")).toContain("conversationUrn:urn%3Ali%3Amsg_conversation%3A%28y%2C2%29)");
  });
});

describe("extension targets", () => {
  const idOf = (key: string) =>
    [...createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)]
      .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
      .join("");

  it("gives each target its own id that matches its key", () => {
    expect(idOf(targets.local.key)).toBe(targets.local.id);
    expect(idOf(targets.production.key)).toBe(targets.production.id);
    expect(targets.local.id).not.toBe(targets.production.id);
  });

  it("keeps local hosts out of the production target", () => {
    expect(new URL(targets.production.toolUrl).protocol).toBe("https:");
    expect(targets.production.origins).toEqual([]);
    expect(new URL(targets.local.toolUrl).hostname).toBe("localhost");
  });
});
