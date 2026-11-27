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
    expect(parseConnections(json)).toEqual([{ slug: "lina-haddad", firstName: "Lina", lastName: "Haddad", headline: "Talent Partner at Arab Bank", connectedAt: "2026-11-20", photo: "" }]);
  });

  it("picks a small LinkedIn photo for each connection", () => {
    const picture = {
      displayImageReference: {
        vectorImage: {
          rootUrl: "https://media.licdn.com/dms/image/v2/abc/profile-displayphoto-shrink_",
          artifacts: [
            { width: 800, fileIdentifyingUrlPathSegment: "800_800/0?e=1&t=a" },
            { width: 100, fileIdentifyingUrlPathSegment: "100_100/0?e=1&t=b" },
            { width: 200, fileIdentifyingUrlPathSegment: "200_200/0?e=1&t=c" },
          ],
        },
      },
    };
    const json = {
      included: [
        { entityUrn: "c1", createdAt: 1, connectedMember: "p1" },
        { entityUrn: "p1", publicIdentifier: "lina", firstName: "Lina", lastName: "H", profilePicture: picture },
        { entityUrn: "c2", createdAt: 1, connectedMember: "p2" },
        { entityUrn: "p2", publicIdentifier: "omar", firstName: "Omar", lastName: "K", profilePicture: { displayImageReference: { vectorImage: { rootUrl: "https://evil.example/", artifacts: [{ width: 100, fileIdentifyingUrlPathSegment: "x" }] } } } },
      ],
    };
    const bySlug = Object.fromEntries(parseConnections(json).map((c) => [c.slug, c.photo]));
    expect(bySlug).toEqual({ lina: "https://media.licdn.com/dms/image/v2/abc/profile-displayphoto-shrink_100_100/0?e=1&t=b", omar: "" });
  });

  it("reads the legacy connection shape and the owner", () => {
    const legacy = { elements: [{ createdAt: 1, miniProfile: { publicIdentifier: "x", firstName: "X", lastName: "Y", occupation: "Dev" } }] };
    expect(parseConnections(legacy)[0]).toMatchObject({ slug: "x", headline: "Dev" });
    expect(parseMe({ included: [{ publicIdentifier: "me", firstName: "Ahmad", lastName: "N" }] })).toEqual({ slug: "me", name: "Ahmad N", memberId: "" });
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
    const messages = parseMessages(json, new Map(conversations.map((c) => [c.urn, c])), { name: "Ahmad N", slug: "me", memberId: "" });
    expect(messages).toEqual([{ id: "m1", conversationId: conv, at: new Date(1700000000000).toISOString(), from: { name: "Lina H", slug: "lina-h" }, to: [{ name: "Ahmad N", slug: "me" }], content: "hello" }]);
  });

  it("maps messenger member ids to the owner and keeps names for others", () => {
    const me = "ACoAAA1111111111111111";
    const lina = "ACoAAB2222222222222222";
    const conv = `urn:li:msg_conversation:(urn:li:fsd_profile:${me},2-xyz)`;
    const json = {
      included: [
        { entityUrn: conv, lastActivityAt: 1700000000000, "*conversationParticipants": ["p1", "p2"] },
        { entityUrn: "p1", hostIdentityUrn: `urn:li:fsd_profile:${me}`, participantType: { member: { firstName: { text: "Ahmad" }, lastName: { text: "Nueirat" }, profileUrl: `https://www.linkedin.com/in/${me}` } } },
        { entityUrn: "p2", hostIdentityUrn: `urn:li:fsd_profile:${lina}`, participantType: { member: { firstName: { text: "Lina" }, lastName: { text: "H" }, profileUrl: `https://www.linkedin.com/in/${lina}` } } },
        { entityUrn: "m1", deliveredAt: 1700000000000, "*sender": "p1", "*conversation": conv, body: { text: "hi" } },
      ],
    };
    const owner = parseMe({ included: [{ entityUrn: `urn:li:fs_miniProfile:${me}`, publicIdentifier: "ahmad-nueirat", firstName: "Ahmad", lastName: "Nueirat" }] });
    expect(owner).toEqual({ slug: "ahmad-nueirat", name: "Ahmad Nueirat", memberId: me });
    const conversations = parseConversations(json);
    const [message] = parseMessages(json, new Map(conversations.map((c) => [c.urn, c])), owner);
    expect(message!.from).toEqual({ name: "Ahmad Nueirat", slug: "ahmad-nueirat" });
    expect(message!.to).toEqual([{ name: "Lina H", slug: "" }]);
  });

  it("links nested messenger messages to their thread even without a conversation ref", () => {
    const me = "ACoAAA1111111111111111";
    const lina = "ACoAAB2222222222222222";
    const conv = `urn:li:msg_conversation:(urn:li:fsd_profile:${me},2-abc)`;
    const json = {
      data: {
        messengerConversationsBySyncToken: {
          elements: [{
            entityUrn: conv,
            lastActivityAt: 1700000005000,
            conversationParticipants: [
              { hostIdentityUrn: `urn:li:fsd_profile:${me}`, participantType: { member: { profileUrl: `https://www.linkedin.com/in/${me}` } } },
              { hostIdentityUrn: `urn:li:fsd_profile:${lina}`, participantType: { member: { firstName: { text: "Lina" }, lastName: { text: "Haddad, PMP" }, profileUrl: `https://www.linkedin.com/in/${lina}` } } },
            ],
            messages: { elements: [{ entityUrn: "urn:li:msg_message:(x,1)", deliveredAt: 1700000005000, body: { text: "hi Lina" }, sender: { hostIdentityUrn: `urn:li:fsd_profile:${me}`, participantType: { member: { profileUrl: `https://www.linkedin.com/in/${me}` } } } }] },
          }],
        },
      },
    };
    const owner = { slug: "ahmad-nueirat", name: "Ahmad Nueirat", memberId: me };
    const conversations = parseConversations(json);
    const [message] = parseMessages(json, new Map(conversations.map((c) => [c.urn, c])), owner);
    expect(message).toMatchObject({ conversationId: conv, from: { slug: "ahmad-nueirat" }, to: [{ name: "Lina Haddad, PMP", slug: "" }] });
    const thread = { data: { messengerMessagesByConversation: { elements: [{ entityUrn: "urn:li:msg_message:(x,2)", deliveredAt: 1700000009000, body: { text: "again" }, sender: { hostIdentityUrn: `urn:li:fsd_profile:${me}` } }] } } };
    const [second] = parseMessages(thread, new Map(conversations.map((c) => [c.urn, c])), owner, conv);
    expect(second).toMatchObject({ conversationId: conv, from: { slug: "ahmad-nueirat" }, to: [{ name: "Lina Haddad, PMP" }] });
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

  it("always starts from the newest conversations and messages", () => {
    const base = "https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql";
    const scrolled = `${base}?queryId=messengerConversations.abc&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3AME,lastUpdatedBefore:123)`;
    expect(conversationsPageUrl(scrolled, 0)).toBe(`${base}?queryId=messengerConversations.abc&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3AME)`);
    expect(conversationsPageUrl(`${base}?queryId=messengerConversations.abc&variables=(lastUpdatedBefore:1,mailboxUrn:x)`, 0)).toContain("variables=(mailboxUrn:x)");
    expect(conversationsPageUrl(`${base}?queryId=messengerConversations.abc&variables=(a:1,lastUpdatedBefore:1,mailboxUrn:x)`, 0)).toContain("variables=(a:1,mailboxUrn:x)");
    const older = `${base}?queryId=messengerMessages.def&variables=(deliveredAt:5,conversationUrn:old,countBefore:20)`;
    expect(messagesUrl(older, "c", 1000)).toBe(`${base}?queryId=messengerMessages.def&variables=(deliveredAt:61000,conversationUrn:c,countBefore:20)`);
  });

  it("ignores search requests and keeps the latest query ids", () => {
    const base = "https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql";
    const urls = findGraphqlUrls([
      `${base}?queryId=messengerConversations.aaa1&variables=(mailboxUrn:x)`,
      `${base}?queryId=messengerConversations.bbb2&variables=(mailboxUrn:x)`,
      `${base}?queryId=messengerConversations.cafe&variables=(query:(keywords:lina),mailboxUrn:x)`,
    ]);
    expect(urls.conversations).toContain("bbb2");
    expect(urls.messages).toBe("");
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
