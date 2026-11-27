import type { Candidate, CollectedConnection, CollectedMessage, Owner, Party } from "./protocol";

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

const MEMBER_ID_RE = /ACoA[A-Za-z0-9_-]{10,}/;

export function memberIdOf(...values: unknown[]): string {
  for (const v of values) {
    const m = typeof v === "string" ? MEMBER_ID_RE.exec(v) : null;
    if (m) return m[0];
  }
  return "";
}

export function slugFromUrl(url: string): string {
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(url);
  if (!m?.[1]) return "";
  const slug = decodeURIComponent(m[1]);
  return MEMBER_ID.test(slug) ? "" : slug.toLowerCase();
}

function isoDay(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString().slice(0, 10) : "";
}

const PHOTO_HOST = "https://media.licdn.com/";
const PHOTO_WIDTH = 100;

function vectorImageUrl(image: Obj): string {
  const root = str(image.rootUrl);
  const artifacts = (Array.isArray(image.artifacts) ? image.artifacts : []).filter(isObj)
    .map((a) => ({ width: num(a.width), path: str(a.fileIdentifyingUrlPathSegment) }))
    .filter((a) => a.path)
    .sort((a, b) => a.width - b.width);
  const pick = artifacts.find((a) => a.width >= PHOTO_WIDTH) ?? artifacts[artifacts.length - 1];
  const url = pick ? `${root}${pick.path}` : "";
  return url.startsWith(PHOTO_HOST) ? url : "";
}

export function photoOf(obj: Obj): string {
  const queue: Array<{ value: unknown; depth: number }> = Object.entries(obj)
    .filter(([key]) => /picture|image/i.test(key))
    .map(([, value]) => ({ value, depth: 0 }));
  while (queue.length > 0) {
    const { value, depth } = queue.shift()!;
    if (!isObj(value) || depth > 6) continue;
    if (typeof value.rootUrl === "string" && Array.isArray(value.artifacts)) {
      const url = vectorImageUrl(value);
      if (url) return url;
    }
    for (const child of Object.values(value)) if (child !== null && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
  }
  return "";
}

function profileFrom(obj: Obj | null): { slug: string; firstName: string; lastName: string; headline: string; photo: string } | null {
  if (!obj) return null;
  const slug = str(obj.publicIdentifier).toLowerCase();
  if (!slug) return null;
  return {
    slug,
    firstName: textOf(obj.firstName),
    lastName: textOf(obj.lastName),
    headline: textOf(obj.headline) || textOf(obj.occupation),
    photo: photoOf(obj),
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

export function parseMe(json: unknown): Owner {
  const g = new Graph(json);
  for (const obj of g.all) {
    const p = profileFrom(obj);
    if (p) return { slug: p.slug, name: `${p.firstName} ${p.lastName}`.trim(), memberId: memberIdOf(obj.entityUrn, obj.dashEntityUrn, obj.objectUrn) };
  }
  return { slug: "", name: "", memberId: "" };
}

export interface ParsedParty extends Party {
  memberId: string;
}

export function participantParty(g: Graph, obj: Obj | null): ParsedParty {
  if (!obj) return { name: "", slug: "", memberId: "" };
  const type = g.field(obj, "participantType");
  const member = type ? g.field(type, "member") : null;
  const source = member ?? obj;
  const name = `${textOf(source.firstName)} ${textOf(source.lastName)}`.trim() || textOf(source.name);
  const profileUrl = str(source.profileUrl) || str(obj.profileUrl);
  const slug = slugFromUrl(profileUrl) || str(source.publicIdentifier).toLowerCase();
  const memberId = memberIdOf(obj.hostIdentityUrn, obj.backendUrn, obj.entityUrn, source.entityUrn, profileUrl);
  return { name, slug, memberId };
}

function samePerson(a: ParsedParty, b: ParsedParty): boolean {
  if (a.memberId && b.memberId) return a.memberId === b.memberId;
  if (a.slug && b.slug) return a.slug === b.slug;
  return a.name !== "" && a.name === b.name;
}

function asParty(p: ParsedParty, owner: Owner): Party {
  const isOwner = (owner.memberId !== "" && p.memberId === owner.memberId) || (owner.slug !== "" && p.slug === owner.slug);
  return isOwner ? { name: owner.name || p.name, slug: owner.slug } : { name: p.name, slug: p.slug };
}

export interface ParsedConversation {
  urn: string;
  lastActivityAt: number;
  participants: ParsedParty[];
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

function parentConversations(g: Graph): Map<Obj, string> {
  const parents = new Map<Obj, string>();
  for (const obj of g.all) {
    if (!num(obj.lastActivityAt)) continue;
    const urn = str(obj.entityUrn) || str(obj.backendUrn);
    if (urn) for (const m of g.list(obj, "messages")) parents.set(m, urn);
  }
  return parents;
}

export function parseMessages(json: unknown, conversations: Map<string, ParsedConversation>, owner: Owner, conversationUrn = ""): CollectedMessage[] {
  const g = new Graph(json);
  const parents = parentConversations(g);
  const out = new Map<string, CollectedMessage>();
  for (const obj of g.all) {
    const deliveredAt = num(obj.deliveredAt);
    if (!deliveredAt) continue;
    const id = str(obj.entityUrn) || str(obj.backendUrn);
    if (!id) continue;
    const from = participantParty(g, g.field(obj, "sender") ?? g.field(obj, "actor"));
    if (!from.slug && !from.name && !from.memberId) continue;
    const convRef = g.field(obj, "conversation");
    const referenced = (convRef ? str(convRef.entityUrn) || str(convRef.backendUrn) : "") || str(obj.backendConversationUrn) || str(obj["*conversation"]);
    const candidates = [referenced, parents.get(obj) ?? "", conversationUrn].filter(Boolean);
    const conversationId = candidates.find((urn) => conversations.has(urn)) ?? candidates[0] ?? "";
    const conv = conversations.get(conversationId);
    const to = (conv?.participants ?? []).filter((p) => !samePerson(p, from));
    out.set(id, {
      id,
      conversationId,
      at: new Date(deliveredAt).toISOString(),
      from: asParty(from, owner),
      to: to.map((p) => asParty(p, owner)),
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
    if (!url.includes("voyagerMessagingGraphQL/graphql") || /keywords/i.test(url)) continue;
    if (/queryId=messengerConversations\.[0-9a-f]+/.test(url) && url.includes("mailboxUrn")) conversations = url;
    if (/queryId=messengerMessages\.[0-9a-f]+/.test(url) && url.includes("conversationUrn")) messages = url;
  }
  return { conversations, messages };
}

export function replaceVariable(url: string, name: string, value: string): string {
  const pattern = new RegExp(`(${name}:)([^,)]+)`);
  if (pattern.test(url)) return url.replace(pattern, `$1${value}`);
  const marker = "variables=(";
  const at = url.indexOf(marker);
  if (at < 0) return url;
  const insertAt = at + marker.length;
  return `${url.slice(0, insertAt)}${name}:${value},${url.slice(insertAt)}`;
}

function removeVariable(url: string, name: string): string {
  return url.replace(new RegExp(`([(,])${name}:[^,)]+(,?)`), (_, before: string, after: string) => (before === "(" ? "(" : after));
}

export function conversationsPageUrl(template: string, before: number): string {
  return before > 0 ? replaceVariable(template, "lastUpdatedBefore", String(before)) : removeVariable(template, "lastUpdatedBefore");
}

export function encodeUrn(urn: string): string {
  return encodeURIComponent(urn).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

export function messagesUrl(template: string, conversationUrn: string, nowMs = Date.now()): string {
  const url = replaceVariable(template, "conversationUrn", encodeUrn(conversationUrn));
  return /deliveredAt:/.test(url) ? replaceVariable(url, "deliveredAt", String(nowMs + 60_000)) : url;
}

export function profileLookupUrl(slug: string): string {
  return `${VOYAGER}/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(slug)}`;
}

export function findMemberId(json: unknown, slug: string): string {
  const g = new Graph(json);
  let fallback = "";
  for (const obj of g.all) {
    const urn = str(obj.entityUrn);
    if (!urn.startsWith("urn:li:fsd_profile:")) continue;
    const id = memberIdOf(urn);
    if (!id) continue;
    if (str(obj.publicIdentifier).toLowerCase() === slug) return id;
    fallback ||= id;
  }
  return fallback;
}

export interface WriteRequest {
  url: string;
  body: string;
}

export function messageRequest(ownerId: string, recipientId: string, text: string, originToken: string, trackingId: string): WriteRequest {
  return {
    url: `${VOYAGER}/voyagerMessagingDashMessengerMessages?action=createMessage`,
    body: JSON.stringify({
      message: { body: { attributes: [], text }, originToken, renderContentUnions: [] },
      mailboxUrn: `urn:li:fsd_profile:${ownerId}`,
      trackingId,
      dedupeByClientGeneratedToken: false,
      hostRecipientUrns: [`urn:li:fsd_profile:${recipientId}`],
    }),
  };
}

export function inviteRequest(recipientId: string, note: string): WriteRequest {
  const invitee = { inviteeUnion: { memberProfile: `urn:li:fsd_profile:${recipientId}` } };
  return {
    url: `${VOYAGER}/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2`,
    body: JSON.stringify(note ? { invitee, customMessage: note } : { invitee }),
  };
}

export const MEMBER_ID = /^ACoA[A-Za-z0-9_-]{10,}$/;
export const VANITY_SLUG = /^[a-z0-9\-._%]{2,100}$/;

export function candidateFrom(raw: { id: string; name: string; headline: string; degree: string }): Candidate | null {
  const id = raw.id.trim();
  const memberId = MEMBER_ID.test(id) ? id : "";
  const slug = memberId ? "" : id.toLowerCase();
  if (!memberId && !VANITY_SLUG.test(slug)) return null;
  const name = raw.name.split("\n")[0]!.trim().slice(0, 120);
  if (!name) return null;
  return { slug, memberId, name, headline: raw.headline.trim().slice(0, 300), degree: raw.degree.trim().slice(0, 4) };
}
