import type { CollectedConnection, CollectedMessage, Party } from "./protocol";

type Obj = Record<string, unknown>;

export const VOYAGER = "https://www.linkedin.com/voyager/api";
export const PAGE_SIZE = 40;

export const CONNECTION_ENDPOINTS = [
  (start: number) => `${VOYAGER}/relationships/dash/connections?decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16&count=${PAGE_SIZE}&q=search&sortType=RECENTLY_ADDED&start=${start}`,
  (start: number) => `${VOYAGER}/relationships/dash/connections?decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-15&count=${PAGE_SIZE}&q=search&sortType=RECENTLY_ADDED&start=${start}`,
  (start: number) => `${VOYAGER}/relationships/connections?count=${PAGE_SIZE}&sortType=RECENTLY_ADDED&start=${start}`,
];

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (isObj(v)) return str(v.text);
  return "";
}

export class Graph {
  private readonly byUrn = new Map<string, Obj>();
  readonly all: Obj[] = [];

  constructor(root: unknown) {
    const stack: unknown[] = [root];
    const seen = new Set<unknown>();
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === null || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) stack.push(item);
        continue;
      }
      const obj = node as Obj;
      this.all.push(obj);
      for (const key of ["entityUrn", "backendUrn", "dashEntityUrn", "objectUrn"]) {
        const urn = str(obj[key]);
        if (urn && !this.byUrn.has(urn)) this.byUrn.set(urn, obj);
      }
      for (const value of Object.values(obj)) if (value !== null && typeof value === "object") stack.push(value);
    }
  }

  resolve(ref: unknown): Obj | null {
    if (isObj(ref)) return ref;
    if (typeof ref === "string") return this.byUrn.get(ref) ?? null;
    return null;
  }

  field(obj: Obj, name: string): Obj | null {
    return this.resolve(obj[name]) ?? this.resolve(obj[`*${name}`]);
  }

  list(obj: Obj, name: string): Obj[] {
    const raw = obj[name] ?? obj[`*${name}`];
    const items = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.elements) ? raw.elements : isObj(raw) && Array.isArray(raw["*elements"]) ? raw["*elements"] : [];
    return items.map((i: unknown) => this.resolve(i)).filter((i: Obj | null): i is Obj => i !== null);
  }
}

export function slugFromUrl(url: string): string {
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(url);
  return m?.[1] ? decodeURIComponent(m[1]).toLowerCase() : "";
}

function isoDay(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString().slice(0, 10) : "";
}

function profileFrom(obj: Obj | null): { slug: string; firstName: string; lastName: string; headline: string } | null {
  if (!obj) return null;
  const slug = str(obj.publicIdentifier).toLowerCase();
  if (!slug) return null;
  return {
    slug,
    firstName: textOf(obj.firstName),
    lastName: textOf(obj.lastName),
    headline: textOf(obj.headline) || textOf(obj.occupation),
  };
}

export function parseConnections(json: unknown): CollectedConnection[] {
  const g = new Graph(json);
  const out = new Map<string, CollectedConnection>();
  for (const obj of g.all) {
    if (!("createdAt" in obj)) continue;
    const profile = profileFrom(
      g.field(obj, "connectedMemberResolutionResult") ?? g.field(obj, "connectedMember") ?? g.field(obj, "miniProfile"),
    );
    if (!profile) continue;
    out.set(profile.slug, { ...profile, connectedAt: isoDay(num(obj.createdAt)) });
  }
  return [...out.values()];
}

export function parseMe(json: unknown): Party {
  const g = new Graph(json);
  for (const obj of g.all) {
    const p = profileFrom(obj);
    if (p) return { slug: p.slug, name: `${p.firstName} ${p.lastName}`.trim() };
  }
  return { slug: "", name: "" };
}

export function participantParty(g: Graph, obj: Obj | null): Party {
  if (!obj) return { name: "", slug: "" };
  const type = g.field(obj, "participantType");
  const member = type ? g.field(type, "member") : null;
  const source = member ?? obj;
  const name = `${textOf(source.firstName)} ${textOf(source.lastName)}`.trim() || textOf(source.name);
  const slug = slugFromUrl(str(source.profileUrl) || str(obj.profileUrl)) || str(source.publicIdentifier).toLowerCase();
  return { name, slug };
}

export interface ParsedConversation {
  urn: string;
  lastActivityAt: number;
  participants: Party[];
}

export function parseConversations(json: unknown): ParsedConversation[] {
  const g = new Graph(json);
  const out = new Map<string, ParsedConversation>();
  for (const obj of g.all) {
    const lastActivityAt = num(obj.lastActivityAt);
    if (!lastActivityAt) continue;
    const urn = str(obj.entityUrn) || str(obj.backendUrn);
    if (!urn) continue;
    const participants = g.list(obj, "conversationParticipants").map((p) => participantParty(g, p)).filter((p) => p.slug || p.name);
    out.set(urn, { urn, lastActivityAt, participants });
  }
  return [...out.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function parseMessages(json: unknown, conversations: Map<string, ParsedConversation>): CollectedMessage[] {
  const g = new Graph(json);
  const out = new Map<string, CollectedMessage>();
  for (const obj of g.all) {
    const deliveredAt = num(obj.deliveredAt);
    if (!deliveredAt) continue;
    const id = str(obj.entityUrn) || str(obj.backendUrn);
    if (!id) continue;
    const from = participantParty(g, g.field(obj, "sender") ?? g.field(obj, "actor"));
    if (!from.slug && !from.name) continue;
    const convRef = g.field(obj, "conversation");
    const conversationId = (convRef ? str(convRef.entityUrn) || str(convRef.backendUrn) : "") || str(obj.backendConversationUrn) || str(obj["*conversation"]);
    const conv = conversations.get(conversationId);
    const to = (conv?.participants ?? []).filter((p) => (p.slug && p.slug !== from.slug) || (!p.slug && p.name !== from.name));
    out.set(id, {
      id,
      conversationId,
      at: new Date(deliveredAt).toISOString(),
      from,
      to,
      content: textOf(obj.body).slice(0, 4000),
    });
  }
  return [...out.values()];
}

export interface QueryIds {
  conversations: string;
  messages: string;
}

export function findGraphqlUrls(resourceUrls: string[]): QueryIds {
  let conversations = "";
  let messages = "";
  for (const url of resourceUrls) {
    if (!url.includes("voyagerMessagingGraphQL/graphql")) continue;
    if (/queryId=messengerConversations\.[0-9a-f]+/.test(url) && url.includes("mailboxUrn")) conversations ||= url;
    if (/queryId=messengerMessages\.[0-9a-f]+/.test(url) && url.includes("conversationUrn")) messages ||= url;
  }
  return { conversations, messages };
}

function replaceVariable(url: string, name: string, value: string): string {
  const pattern = new RegExp(`(${name}:)([^,)]+)`);
  if (pattern.test(url)) return url.replace(pattern, `$1${value}`);
  const marker = "variables=(";
  const at = url.indexOf(marker);
  if (at < 0) return url;
  const insertAt = at + marker.length;
  return `${url.slice(0, insertAt)}${name}:${value},${url.slice(insertAt)}`;
}

export function conversationsPageUrl(template: string, before: number): string {
  return before > 0 ? replaceVariable(template, "lastUpdatedBefore", String(before)) : template;
}

export function encodeUrn(urn: string): string {
  return encodeURIComponent(urn).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

export function messagesUrl(template: string, conversationUrn: string): string {
  return replaceVariable(template, "conversationUrn", encodeUrn(conversationUrn));
}
