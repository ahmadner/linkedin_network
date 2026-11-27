import { encodeUrn, Graph, memberIdOf, replaceVariable, textOf, VOYAGER } from "./linkedin";
import type { CollectedPost } from "./protocol";

type Obj = Record<string, unknown>;

export const POSTS_PAGE = 20;
const POST_URN = /urn:li:(activity|share|ugcPost):(\d{6,})/g;
const SKIP_KEYS = /^\*?(resharedUpdate|comments|socialContent|highlightedComments|header|contextualHeader|commentary|content|actor)$/;
const COUNT_KEYS = { reactions: ["numLikes", "numReactions"], comments: ["numComments"], reposts: ["numShares", "numReposts"], impressions: ["numImpressions", "impressionCount", "numViews"] } as const;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function urnTime(urn: string): string {
  const id = /:(\d{6,})$/.exec(urn)?.[1];
  if (!id) return "";
  const ms = Number(BigInt(id) >> 22n);
  const min = Date.UTC(2003, 0, 1);
  return ms > min && ms < Date.now() + 86_400_000 ? new Date(ms).toISOString() : "";
}

function urnsOf(g: Graph, update: Obj): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      for (const m of value.matchAll(POST_URN)) if (!found.includes(m[0])) found.push(m[0]);
      return;
    }
    if (depth > 2 || !isObj(value) || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_KEYS.test(key)) continue;
      if (/^(updateMetadata|metadata|\*?socialDetail)$/.test(key)) visit(g.resolve(child) ?? child, depth + 1);
      else if (typeof child === "string" || depth < 1) visit(child, depth + 1);
    }
  };
  visit(update, 0);
  return found;
}

function primaryUrn(urns: string[], kind: "activity" | "share"): string {
  if (kind === "activity") return urns.find((u) => u.startsWith("urn:li:activity:")) ?? urns[0] ?? "";
  return urns.find((u) => u.startsWith("urn:li:share:") || u.startsWith("urn:li:ugcPost:")) ?? urns.find((u) => u.startsWith("urn:li:activity:")) ?? "";
}

function countsOf(g: Graph, update: Obj): Pick<CollectedPost, "reactions" | "comments" | "reposts" | "impressions"> {
  const social = g.field(update, "socialDetail");
  const totals = social ? g.field(social, "totalSocialActivityCounts") ?? social : null;
  const pick = (keys: readonly string[]): number => {
    for (const source of [totals, social]) {
      if (!source) continue;
      for (const k of keys) if (num(source[k])) return num(source[k]);
    }
    return 0;
  };
  let reactions = pick(COUNT_KEYS.reactions);
  if (!reactions && totals && Array.isArray(totals.reactionTypeCounts)) reactions = totals.reactionTypeCounts.filter(isObj).reduce((sum, r) => sum + num(r.count), 0);
  return { reactions, comments: pick(COUNT_KEYS.comments), reposts: pick(COUNT_KEYS.reposts), impressions: pick(COUNT_KEYS.impressions) };
}

function actorId(g: Graph, update: Obj): string {
  const actor = g.field(update, "actor");
  if (!actor) return "";
  const values = Object.values(actor).filter((v): v is string => typeof v === "string");
  const name = g.resolve(actor.name);
  if (name && Array.isArray(name.attributes)) for (const a of name.attributes.filter(isObj)) values.push(JSON.stringify(a).slice(0, 400));
  return memberIdOf(...values);
}

function mediaOf(g: Graph, update: Obj): string {
  const content = g.field(update, "content");
  if (!content) return "";
  const kind = Object.keys(content).find((k) => /Component$/.test(k) && content[k]);
  return kind ? kind.replace(/^\*/, "").replace(/Component$/, "") : "media";
}

export interface PostsPage {
  posts: CollectedPost[];
  token: string;
  updates: number;
}

export function parsePosts(json: unknown, ownerMemberId: string): PostsPage {
  const g = new Graph(json);
  const posts = new Map<string, CollectedPost>();
  let token = "";
  let updates = 0;
  for (const obj of g.all) {
    if (!token && typeof obj.paginationToken === "string") token = obj.paginationToken;
    if (!("commentary" in obj || "*commentary" in obj || "updateMetadata" in obj)) continue;
    if (!("actor" in obj || "*actor" in obj || "socialDetail" in obj || "*socialDetail" in obj)) continue;
    const urns = urnsOf(g, obj);
    const activity = primaryUrn(urns, "activity");
    if (!activity) continue;
    updates += 1;
    const commentary = g.field(obj, "commentary");
    const text = (commentary ? textOf(commentary.text) || textOf(commentary) : "").replace(/\r\n?/g, "\n").trim();
    const reshare = "resharedUpdate" in obj || "*resharedUpdate" in obj;
    if (reshare && !text) continue;
    const actor = actorId(g, obj);
    if (ownerMemberId && actor && actor !== ownerMemberId) continue;
    const id = primaryUrn(urns, "share") || activity;
    const at = urnTime(activity) || urnTime(id);
    posts.set(activity, {
      id,
      urns,
      at,
      text: text.slice(0, 6000),
      url: `https://www.linkedin.com/feed/update/${activity.startsWith("urn:li:activity:") ? activity : id}/`,
      media: mediaOf(g, obj),
      ...countsOf(g, obj),
    });
  }
  return { posts: [...posts.values()].sort((a, b) => b.at.localeCompare(a.at)), token, updates };
}

export function restPostsUrl(memberId: string, start: number, token: string): string {
  const base = `${VOYAGER}/identity/profileUpdatesV2?count=${POSTS_PAGE}&includeLongTermHistory=true&moduleKey=member-shares%3Aphone&numComments=0&numLikes=0&profileUrn=${encodeUrn(`urn:li:fsd_profile:${memberId}`)}&q=memberShareFeed&start=${start}`;
  return token ? `${base}&paginationToken=${encodeURIComponent(token)}` : base;
}

export function findPostsGraphqlUrl(resourceUrls: string[]): string {
  return resourceUrls.find((u) => u.includes("/graphql") && /queryId=voyagerFeedDashProfileUpdates\.[0-9a-f]+/.test(u) && u.includes("profileUrn")) ?? "";
}

export function graphqlPostsUrl(template: string, start: number, token: string): string {
  let url = replaceVariable(replaceVariable(template, "start", String(start)), "count", String(POSTS_PAGE));
  url = token ? replaceVariable(url, "paginationToken", encodeURIComponent(token)) : url.replace(/([(,])paginationToken:[^,)]+(,?)/, (_, before: string, after: string) => (before === "(" ? "(" : after));
  return url;
}
