import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImage, planContent, planDates, replaceHook, weekdayIndex, writePost } from "../src/ai/content";
import {
  contentStats, emptyContent, foldPreview, mergeExportPosts, newDraft, postChecks, postKey, publishText, restoreDraftVersion, sanitizeContent, shareUrl, withHashtags, withVersion, type Post,
} from "../src/core/content";
import { sanitizeProfile } from "../src/core/profile";
import { importExport } from "../src/io/exportImport";
import { jpegPdf } from "../src/io/pdf";
import { emptyState, exportStateZip, readStateZip, reviveState } from "../src/io/state";
import { sampleFiles, sampleProfile } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

function post(patch: Partial<Post>): Post {
  return { id: "p1", at: "2026-11-01T10:00:00Z", text: "hello", url: "", sharedUrl: "", media: "", origin: "export", metrics: null, ...patch };
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Shares.csv import", () => {
  it("reads posts, unwraps quoted commentary and drops duplicate rows", async () => {
    const imported = await importExport(sampleFiles(), "sample");
    expect(imported.posts).toHaveLength(3);
    expect(imported.meta.filesFound).toContain("Shares.csv");
    const [latest] = imported.posts;
    expect(latest?.id).toBe("urn:li:share:7260000000000000003");
    expect(latest?.at).toBe("2026-11-18T08:15:22Z");
    expect(latest?.text.startsWith("بعد 3 سنين")).toBe(true);
    expect(latest?.text.endsWith("#Backend")).toBe(true);
    expect(latest?.media).toContain("media.licdn.com");
    expect(imported.posts[2]?.sharedUrl).toBe("https://example.com/event-driven");
  });
});

describe("content helpers", () => {
  it("computes posting stats", () => {
    const posts = [
      post({ id: "a", at: "2026-11-20T10:00:00Z", text: "مرحبا #Java", media: "x", metrics: { impressions: 900, reactions: 40, comments: 5, reposts: 1 } }),
      post({ id: "b", at: "2026-10-01T10:00:00Z", text: "Hello #java #Spring" }),
      post({ id: "c", at: "2025-01-05T10:00:00Z", text: "Old" }),
    ];
    const stats = contentStats(posts, new Date("2026-11-27T00:00:00Z"));
    expect(stats.total).toBe(3);
    expect(stats.last90).toBe(2);
    expect(stats.daysSinceLast).toBe(6);
    expect(stats.arabicShare).toBe(33);
    expect(stats.mediaShare).toBe(33);
    expect(stats.topHashtags[0]).toEqual(["#java", 2]);
    expect(stats.topPosts.map((p) => p.id)).toEqual(["a"]);
    expect(stats.byMonth[0]?.month).toBe("2025-01");
    expect(stats.byMonth.at(-1)).toEqual({ month: "2026-11", count: 1 });
  });

  it("merges a new export without duplicating manual posts and keeps metrics", () => {
    const metrics = { impressions: 10, reactions: 2, comments: 1, reposts: 0 };
    const current = [
      post({ id: "m-d_1", origin: "manual", url: "https://www.linkedin.com/feed/update/urn:li:share:5/", text: "Published from the editor", metrics }),
      post({ id: "m_2", origin: "manual", text: "Only here" }),
      post({ id: "urn:li:share:9", text: "old export" }),
    ];
    const imported = [post({ id: "urn:li:share:5", url: "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A5/", text: "Published from the editor" })];
    const merged = mergeExportPosts(current, imported);
    expect(merged.map((p) => p.id).sort()).toEqual(["m_2", "urn:li:share:5"]);
    expect(merged.find((p) => p.id === "urn:li:share:5")?.metrics).toEqual(metrics);
    expect(postKey("https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A77/")).toBe("urn:li:ugcPost:77");
  });

  it("keeps old text as versions and restores them", () => {
    let d = newDraft({ text: "first" });
    d = withVersion(d, "second", "ai-improve");
    d = withVersion(d, "third", "ai-shorten");
    expect(d.versions.map((v) => v.text)).toEqual(["first", "second"]);
    d = restoreDraftVersion(d, 0);
    expect(d.text).toBe("first");
    expect(d.versions.map((v) => v.text)).toEqual(["second", "third"]);
  });

  it("adds missing hashtags once and builds the share link", () => {
    expect(withHashtags("Post #Java", ["java", "#Spring"])).toBe("Post #Java\n\n#Spring");
    expect(publishText({ text: "  Hi  ", hashtags: ["#A"] })).toBe("Hi\n\n#A");
    expect(shareUrl("hi there")).toBe("https://www.linkedin.com/feed/?shareActive=true&text=hi%20there");
    expect(shareUrl("ب".repeat(3000))).toBe("https://www.linkedin.com/feed/?shareActive=true");
  });

  it("shows where LinkedIn folds the post", () => {
    expect(foldPreview("one\ntwo\nthree\nfour")).toEqual({ visible: "one\ntwo\nthree", folded: true });
    expect(foldPreview("short").folded).toBe(false);
    expect(foldPreview("x".repeat(300)).visible).toHaveLength(210);
  });

  it("checks a draft before publishing", () => {
    const base = { hashtags: [], format: "text" as const, imageId: "", slides: [], pollQuestion: "", pollOptions: [] };
    expect(postChecks({ ...base, text: "" })[0]?.level).toBe("bad");
    const long = postChecks({ ...base, text: "a".repeat(3100) });
    expect(long.some((c) => c.level === "bad")).toBe(true);
    const good = postChecks({ ...base, text: `Hook line\n\n${"Useful point. ".repeat(20)}\n\nWhat do you think?`, hashtags: ["#a", "#b", "#c"] });
    expect(good.every((c) => c.level === "good")).toBe(true);
    const link = postChecks({ ...base, text: `See https://example.com ${"x ".repeat(100)}`, format: "image" });
    expect(link.filter((c) => c.level === "warn").length).toBeGreaterThanOrEqual(3);
  });

  it("replaces only the hook", () => {
    expect(replaceHook("Old hook\n\nBody", "New hook")).toBe("New hook\n\nBody");
    expect(replaceHook("Only one block", "New")).toBe("New\n\nOnly one block");
  });

  it("sanitizes unknown content safely", () => {
    const content = sanitizeContent({ posts: [{ id: "x" }, { id: "y", text: "ok" }], drafts: [{ id: "d", status: "weird", format: "bad", hashtags: ["java", "#ok"] }], settings: { postsPerWeek: 99, imageModel: "other" } });
    expect(content.posts.map((p) => p.id)).toEqual(["y"]);
    expect(content.drafts[0]?.status).toBe("draft");
    expect(content.drafts[0]?.format).toBe("text");
    expect(content.drafts[0]?.hashtags).toEqual(["#java", "#ok"]);
    expect(content.settings.postsPerWeek).toBe(14);
    expect(content.settings.imageModel).toBe("gpt-image-1");
    expect(sanitizeContent(undefined)).toEqual(emptyContent());
  });
});

describe("content in the saved state", () => {
  it("round-trips drafts, posts and images through the zip", () => {
    const state = emptyState();
    state.content.posts = [post({ id: "urn:li:share:1", text: "منشور", metrics: { impressions: 5, reactions: 1, comments: 0, reposts: 0 } })];
    state.content.drafts = [newDraft({ id: "d_1", text: "draft", imageId: "img_abc", slides: [{ title: "T", body: "B" }], pollOptions: ["a", "b"] }), newDraft({ id: "d_2", imageId: "img_gone" })];
    state.content.images = {
      img_abc: { id: "img_abc", draftId: "d_1", prompt: "desk", model: "gpt-image-1", createdAt: "2026-11-27T10:00:00Z", width: 1024, height: 1024, source: "ai" },
      img_gone: { id: "img_gone", draftId: "d_2", prompt: "", model: "", createdAt: "", width: 1, height: 1, source: "upload" },
    };
    state.content.settings.pillars = ["Backend"];
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const zip = exportStateZip(state, [{ id: "img_abc", type: "image/webp", bytes }, { id: "img_unknown", type: "image/png", bytes }]);
    const { state: restored, images } = readStateZip(zip);
    expect(images).toEqual([{ id: "img_abc", type: "image/webp", bytes }]);
    expect(restored.content.posts).toEqual(state.content.posts);
    expect(restored.content.drafts[0]).toEqual(state.content.drafts[0]);
    expect(restored.content.drafts[1]?.imageId).toBe("");
    expect(Object.keys(restored.content.images)).toEqual(["img_abc"]);
    expect(restored.content.settings.pillars).toEqual(["Backend"]);
  });

  it("revives content from the browser store and accepts old states without it", () => {
    const state = emptyState();
    state.profile = sanitizeProfile(sampleProfile());
    state.content.drafts = [newDraft({ id: "d_9", text: "x" })];
    expect(reviveState(JSON.parse(JSON.stringify(state)))?.content.drafts[0]?.id).toBe("d_9");
    const old = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete old.content;
    expect(reviveState(old)?.content).toEqual(emptyContent());
  });
});

describe("pdf", () => {
  it("writes a valid xref for JPEG pages", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = jpegPdf([{ jpeg, width: 1080, height: 1350 }, { jpeg, width: 1080, height: 1350 }]);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 540 675]");
    const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const offsets = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});

describe("content AI", () => {
  it("plans posts on the best days first", () => {
    const dates = planDates(new Date(2026, 10, 29), 1, 2, [weekdayIndex("الثلاثاء"), weekdayIndex("خميس")]);
    expect(dates).toEqual(["2026-12-01", "2026-12-03"]);
    expect(planDates(new Date(2026, 10, 29), 2, 3, [])).toHaveLength(6);
  });

  it("writes a post and keeps hashtags out of the text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { choices: [{ message: { content: JSON.stringify({ title: "عنوان", text: "Hook\n\n\n\nBody", hashtags: ["java", "#Java", "spring boot"], image_prompt: "desk", slides: [], poll_options: [] }) } }] })));
    const profile = sanitizeProfile(sampleProfile());
    const result = await writePost({ topic: "t", hook: "", pillar: "", format: "text", lang: "en", tone: "professional", length: "short", details: "" }, profile, [], null, emptyContent().settings, { key: "sk-test", model: "gpt-4.1-mini" });
    expect(result.text).toBe("Hook\n\nBody");
    expect(result.hashtags).toEqual(["#java", "#springboot"]);
    expect(result.imagePrompt).toBe("desk");
  });

  it("only keeps plan items for the requested dates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { choices: [{ message: { content: JSON.stringify({ plan: [{ date: "2026-12-03", title: "B", format: "poll", lang: "ar" }, { date: "2026-12-01", title: "A" }, { date: "2030-01-01", title: "X" }, { date: "2026-12-01", title: "dup" }] }) } }] })));
    const items = await planContent(["2026-12-01", "2026-12-03"], sanitizeProfile(sampleProfile()), [], null, emptyContent().settings, [], { key: "sk-test", model: "gpt-4.1-mini" });
    expect(items.map((i) => [i.date, i.idea.title, i.idea.format])).toEqual([["2026-12-01", "A", "text"], ["2026-12-03", "B", "poll"]]);
  });

  it("falls back to dall-e-3 when gpt-image-1 needs verification", async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (body.model === "gpt-image-1") return reply(403, { error: { message: "Your organization must be verified to use the model `gpt-image-1`." } });
      return reply(200, { data: [{ b64_json: "AAAA", revised_prompt: "better" }] });
    }));
    const image = await generateImage({ key: "sk-test", model: "gpt-4.1-mini" }, "gpt-image-1", "desk", "landscape");
    expect(image).toEqual({ b64: "AAAA", type: "image/png", model: "dall-e-3", prompt: "better" });
    expect(calls[1]).toMatchObject({ model: "dall-e-3", size: "1792x1024", response_format: "b64_json" });
    expect(calls[0]).toMatchObject({ size: "1536x1024", quality: "medium" });
  });
});
