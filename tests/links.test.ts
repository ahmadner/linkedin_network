import { describe, expect, it } from "vitest";
import { profileLink, threadUrl } from "../src/core/links";
import type { StoredMessage } from "../src/core/types";

const message = (conversationId: string, to: number, at: string): StoredMessage => ({
  id: `${conversationId}${at}`,
  conversationId,
  at,
  outgoing: true,
  from: { name: "Me", slug: "me" },
  to: Array.from({ length: to }, (_, i) => ({ name: `P${i}`, slug: "" })),
  content: "",
  origin: "linkedin",
});

describe("linkedin links", () => {
  it("opens the latest one to one thread", () => {
    const url = threadUrl([
      message("urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-OLD==)", 1, "2026-01-01"),
      message("urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-NEW+x/y==)", 1, "2026-02-01"),
      message("2-GROUP", 3, "2026-03-01"),
    ]);
    expect(url).toBe("https://www.linkedin.com/messaging/thread/2-NEW%2Bx%2Fy%3D%3D/");
  });

  it("uses export conversation ids and skips unknown ones", () => {
    expect(threadUrl([message("2-abc", 1, "2026-01-01")])).toBe("https://www.linkedin.com/messaging/thread/2-abc/");
    expect(threadUrl([message("c-0001", 1, "2026-01-01")])).toBe("");
    expect(profileLink("https://www.linkedin.com/in/lina")).toBe("https://www.linkedin.com/in/lina");
    expect(profileLink("javascript:alert(1)")).toBe("");
  });
});
