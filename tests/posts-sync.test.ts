import { describe, expect, it } from "vitest";
import { findPostsGraphqlUrl, graphqlPostsUrl, parsePosts, restPostsUrl, urnTime } from "../extension/src/posts";
import { mergeExportPosts, mergeSyncedPosts, type Post } from "../src/core/content";
import { toSyncedPost } from "../src/linkedin/bridge";

const ME = "ACoAAB1234567890abcd";
const OTHER = "ACoAAZ9999999999zzzz";
const at = (iso: string): string => (BigInt(Date.parse(iso)) << 22n).toString();
const A1 = at("2026-11-18T08:15:22.000Z");
const A2 = at("2026-10-02T17:40:05.000Z");
const A3 = at("2026-09-01T10:00:00.000Z");
const S1 = at("2026-11-18T08:15:21.000Z");

function post(patch: Partial<Post>): Post {
  return { id: "p", at: "2026-11-01T10:00:00Z", text: "", url: "", sharedUrl: "", media: "", origin: "export", metrics: null, ...patch };
}

const restPage = {
  data: { "*elements": [`urn:li:fs_updateV2:(urn:li:activity:${A1},MEMBER_SHARES)`, `urn:li:fs_updateV2:(urn:li:activity:${A2},MEMBER_SHARES)`, `urn:li:fs_updateV2:(urn:li:activity:${A3},MEMBER_SHARES)`], metadata: { paginationToken: "tok-2" } },
  included: [
    {
      entityUrn: `urn:li:fs_updateV2:(urn:li:activity:${A1},MEMBER_SHARES)`,
      updateMetadata: { urn: `urn:li:activity:${A1}`, shareUrn: `urn:li:share:${S1}` },
      actor: { urn: `urn:li:member:1`, name: { text: "Ahmad", attributes: [{ "*miniProfile": `urn:li:fs_miniProfile:${ME}` }] } },
      commentary: { text: { text: "بعد 3 سنين شغل\r\nدروس" } },
      content: { "com.linkedin.voyager.feed.render.ImageComponent": { images: [] } },
      "*socialDetail": `urn:li:fs_socialDetail:urn:li:activity:${A1}`,
    },
    { entityUrn: `urn:li:fs_socialDetail:urn:li:activity:${A1}`, "*totalSocialActivityCounts": `urn:li:fs_socialActivityCounts:urn:li:activity:${A1}` },
    { entityUrn: `urn:li:fs_socialActivityCounts:urn:li:activity:${A1}`, numLikes: 0, numComments: 7, numShares: 2, reactionTypeCounts: [{ count: 30, reactionType: "LIKE" }, { count: 5, reactionType: "PRAISE" }] },
    {
      entityUrn: `urn:li:fs_updateV2:(urn:li:activity:${A2},MEMBER_SHARES)`,
      updateMetadata: { urn: `urn:li:activity:${A2}` },
      actor: { urn: `urn:li:fs_miniProfile:${OTHER}` },
      commentary: { text: { text: "Someone else's post" } },
    },
    {
      entityUrn: `urn:li:fs_updateV2:(urn:li:activity:${A3},MEMBER_SHARES)`,
      updateMetadata: { urn: `urn:li:activity:${A3}` },
      actor: { urn: `urn:li:fs_miniProfile:${ME}` },
      "*resharedUpdate": "urn:li:fs_updateV2:other",
    },
  ],
};

describe("extension posts reader", () => {
  it("reads the time from a LinkedIn post id", () => {
    expect(urnTime(`urn:li:activity:${A1}`)).toBe("2026-11-18T08:15:22.000Z");
    expect(urnTime("urn:li:activity:12")).toBe("");
  });

  it("reads own posts with their counts and skips others and empty reposts", () => {
    const page = parsePosts(restPage, ME);
    expect(page.token).toBe("tok-2");
    expect(page.updates).toBe(3);
    expect(page.posts).toEqual([{
      id: `urn:li:share:${S1}`,
      urns: expect.arrayContaining([`urn:li:activity:${A1}`, `urn:li:share:${S1}`]) as unknown as string[],
      at: "2026-11-18T08:15:22.000Z",
      text: "بعد 3 سنين شغل\nدروس",
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${A1}/`,
      media: expect.stringContaining("Image") as unknown as string,
      reactions: 35,
      comments: 7,
      reposts: 2,
      impressions: 0,
    }]);
  });

  it("reads the dash GraphQL shape", () => {
    const json = {
      data: { data: { feedDashProfileUpdatesByMemberShareFeed: { "*elements": ["u1"], metadata: { paginationToken: "next" } } } },
      included: [
        { entityUrn: "u1", metadata: { backendUrn: `urn:li:activity:${A2}` }, "*actor": "a1", commentary: { text: { text: "Cut latency by 40%" } }, "*socialDetail": "sd1" },
        { entityUrn: "a1", backendUrn: `urn:li:member:5`, image: { attributes: [{ "*miniProfile": `urn:li:fsd_profile:${ME}` }] } },
        { entityUrn: "sd1", "*totalSocialActivityCounts": "c1" },
        { entityUrn: "c1", numLikes: 12, numComments: 3, numShares: 1, numImpressions: 900 },
      ],
    };
    const page = parsePosts(json, ME);
    expect(page.token).toBe("next");
    expect(page.posts[0]).toMatchObject({ id: `urn:li:activity:${A2}`, text: "Cut latency by 40%", reactions: 12, comments: 3, reposts: 1, impressions: 900, at: "2026-10-02T17:40:05.000Z" });
  });

  it("builds paged urls", () => {
    expect(restPostsUrl(ME, 20, "a b")).toContain(`start=20&paginationToken=a%20b`);
    expect(restPostsUrl(ME, 0, "")).toContain(`profileUrn=urn%3Ali%3Afsd_profile%3A${ME}`);
    const template = "https://www.linkedin.com/voyager/api/graphql?variables=(count:20,start:0,profileUrn:urn%3Ali%3Afsd_profile%3AX,paginationToken:old)&queryId=voyagerFeedDashProfileUpdates.abc123";
    expect(findPostsGraphqlUrl(["https://x/graphql?queryId=other", template])).toBe(template);
    expect(graphqlPostsUrl(template, 40, "t=1")).toContain("count:20,start:40,profileUrn:urn%3Ali%3Afsd_profile%3AX,paginationToken:t%3D1");
    expect(graphqlPostsUrl(template, 0, "")).not.toContain("paginationToken");
  });
});

describe("merging synced posts", () => {
  it("matches export posts by urn or text, updates counts and adds new ones", () => {
    const synced = parsePosts(restPage, ME).posts.map(toSyncedPost).filter((p) => p !== null);
    const fresh = toSyncedPost({ id: `urn:li:activity:${A2}`, urns: [`urn:li:activity:${A2}`], at: "2026-10-02T17:40:05.000Z", text: "New one", url: `https://www.linkedin.com/feed/update/urn:li:activity:${A2}/`, media: "", reactions: 4, comments: 0, reposts: 0, impressions: 0 })!;
    const current = [
      post({ id: `urn:li:share:${S1}`, at: "2026-11-18T08:15:22Z", text: "بعد 3 سنين شغل\nدروس", url: `https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A${S1}/`, metrics: { impressions: 1500, reactions: 1, comments: 0, reposts: 0 } }),
    ];
    const merged = mergeSyncedPosts(current, [...synced, fresh]);
    expect(merged.added).toBe(1);
    expect(merged.updated).toBe(1);
    expect(merged.posts).toHaveLength(2);
    expect(merged.posts[0]).toMatchObject({ origin: "export", metrics: { impressions: 1500, reactions: 35, comments: 7, reposts: 2 } });
    expect(merged.posts[1]).toMatchObject({ origin: "sync", text: "New one" });
    expect(mergeSyncedPosts(merged.posts, [fresh]).added).toBe(0);
  });

  it("drops a synced post when the export brings it later, keeping its counts", () => {
    const synced = toSyncedPost({ id: `urn:li:activity:${A2}`, urns: [], at: "2026-10-02T17:40:05.000Z", text: "Same text here", url: "", media: "", reactions: 9, comments: 1, reposts: 0, impressions: 0 })!;
    const after = mergeExportPosts([synced.post], [post({ id: `urn:li:share:${S1}`, text: "Same text here" })]);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ origin: "export", metrics: { reactions: 9 } });
  });

  it("rejects bad data from the extension", () => {
    expect(toSyncedPost({ id: "javascript:alert(1)", urns: ["x"], at: "", text: "", url: "javascript:x", media: "", reactions: -5, comments: 0, reposts: 0, impressions: 0 })).toBeNull();
    const ok = toSyncedPost({ id: `urn:li:activity:${A2}`, urns: ["bad", `urn:li:share:${S1}`], at: "x", text: "Hi", url: "https://evil.example/", media: "", reactions: -5, comments: 2.6, reposts: 0, impressions: 0 })!;
    expect(ok.post.url).toBe("");
    expect(ok.keys).toEqual([`urn:li:share:${S1}`]);
    expect(ok.post.metrics).toEqual({ impressions: 0, reactions: 0, comments: 3, reposts: 0 });
  });
});
