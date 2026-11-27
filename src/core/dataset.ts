import { asRecord, asString } from "./profile";
import { personKey, splitHeadline } from "./text";
import type { Dataset, ExportImport, Party, RawConnection, StoredMessage } from "./types";

export interface SyncConnection {
  firstName: string;
  lastName: string;
  slug: string;
  headline: string;
  connectedAt: string;
  photo: string;
}

export interface SyncMessage {
  id: string;
  conversationId: string;
  at: string;
  from: Party;
  to: Party[];
  content: string;
}

export interface SyncPayload {
  collectedAt: string;
  owner: Party;
  connections: SyncConnection[];
  messages: SyncMessage[];
  notes: string[];
}

export function emptyDataset(): Dataset {
  return {
    owner: { name: "", slug: "", identityMethod: "not determined" },
    connections: [],
    messages: [],
    invitations: [],
    importMeta: { exportImportedAt: "", exportLabel: "", headerFound: [], skippedRows: 0, filesFound: [], filesMissing: [], warnings: [] },
    sync: { lastSyncAt: "", newestConnectionAt: "", newestMessageAt: "" },
    photos: {},
  };
}

export const PHOTO_PREFIX = "https://media.licdn.com/";
const SLUG = /^[a-z0-9\-._%]+$/;

export function sanitizePhoto(url: string): string {
  return url.startsWith(PHOTO_PREFIX) && url.length <= 1000 && !/["'\s<>]/.test(url) ? url : "";
}

export function sanitizePhotos(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug, url] of Object.entries(input)) {
    const clean = typeof url === "string" ? sanitizePhoto(url) : "";
    if (clean && SLUG.test(slug)) out[slug] = clean;
  }
  return out;
}

export function conversationKey(id: string): string {
  return /,([^,()]+)\)$/.exec(id)?.[1] ?? id;
}

function messageKey(m: { id: string; conversationId: string; at: string }): string {
  const conversation = conversationKey(m.conversationId);
  return conversation ? `${conversation}|${m.at.slice(0, 19)}` : `id|${m.id}`;
}

const MEMBER_ID_SLUG = /^acoa[a-z0-9_-]{10,}$/i;

function cleanParty(p: Party): Party {
  return MEMBER_ID_SLUG.test(p.slug) ? { name: p.name, slug: "" } : p;
}

export function repairMessages(dataset: Dataset): Dataset {
  const ownerKey = personKey(dataset.owner.name);
  const ownerSlug = dataset.owner.slug;
  const isOwner = (p: Party): boolean => (ownerSlug !== "" && p.slug === ownerSlug) || (p.slug === "" && ownerKey !== "" && personKey(p.name) === ownerKey);
  const others = new Map<string, Party[]>();
  const remember = (conversationId: string, p: Party): void => {
    if (!conversationId || isOwner(p) || (!p.slug && !p.name)) return;
    const list = others.get(conversationId) ?? [];
    if (!list.some((q) => (q.slug && q.slug === p.slug) || (!q.slug && personKey(q.name) === personKey(p.name)))) list.push(p);
    others.set(conversationId, list);
  };
  const cleaned = dataset.messages.map((m) => {
    const from = cleanParty(m.from);
    const to = m.to.map(cleanParty);
    const outgoing = m.origin === "linkedin" ? isOwner(from) : m.outgoing;
    remember(m.conversationId, from);
    for (const p of to) remember(m.conversationId, p);
    return { m, from, to, outgoing };
  });
  let changed = false;
  const messages = cleaned.map(({ m, from, to, outgoing }) => {
    const filled = outgoing && to.every(isOwner) ? others.get(m.conversationId) ?? to : to;
    if (from === m.from && filled.length === m.to.length && filled.every((p, i) => p === m.to[i]) && outgoing === m.outgoing) return m;
    changed = true;
    return { ...m, from, to: filled, outgoing };
  });
  return changed ? { ...dataset, messages } : dataset;
}

function sortMessages(list: StoredMessage[]): StoredMessage[] {
  return list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export function mergeExport(current: Dataset, imported: ExportImport): Dataset {
  const owner = { ...current.owner };
  if (!owner.name && imported.owner.name) {
    owner.name = imported.owner.name;
    owner.identityMethod = imported.owner.identityMethod;
  }
  if (!owner.slug && imported.owner.slug) owner.slug = imported.owner.slug;

  const knownIds = new Set(imported.messages.map((m) => m.id));
  const knownKeys = new Set(imported.messages.map(messageKey));
  const knownInvites = new Set(imported.invitations.map((i) => i.id));
  return {
    owner,
    connections: [...current.connections.filter((c) => c.origin !== "export"), ...imported.connections],
    messages: sortMessages([...current.messages.filter((m) => m.origin !== "export" && !knownIds.has(m.id) && !knownKeys.has(messageKey(m))), ...imported.messages]),
    invitations: [...current.invitations.filter((i) => i.origin !== "export" && !knownInvites.has(i.id)), ...imported.invitations],
    importMeta: imported.meta,
    sync: current.sync,
    photos: current.photos,
  };
}

function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

export function mergeSync(current: Dataset, payload: SyncPayload): Dataset {
  const owner = { ...current.owner };
  if (payload.owner.slug) owner.slug = payload.owner.slug;
  if (payload.owner.name && (!owner.name || owner.identityMethod !== "Profile.csv")) {
    owner.name = payload.owner.name;
    owner.identityMethod = owner.identityMethod === "Profile.csv" ? owner.identityMethod : "LinkedIn sync";
  }

  const photos = { ...current.photos };
  const bySlug = new Map<string, RawConnection>();
  for (const c of current.connections) if (c.origin === "linkedin") bySlug.set(c.profileUrl, c);
  let newestConnection = current.sync.newestConnectionAt;
  for (const c of payload.connections) {
    const { position, company } = splitHeadline(c.headline);
    const url = `https://www.linkedin.com/in/${c.slug}`;
    bySlug.set(url, {
      firstName: c.firstName,
      lastName: c.lastName,
      profileUrl: url,
      email: "",
      company,
      position,
      connectedOn: c.connectedAt,
      origin: "linkedin",
      sourceRow: 0,
      issues: [...(company ? [] : ["missing_company"]), ...(position ? [] : ["missing_position"])],
    });
    newestConnection = maxIso(newestConnection, c.connectedAt);
    if (c.photo) photos[c.slug] = c.photo;
  }

  const ids = new Set(current.messages.map((m) => m.id));
  const keys = new Set(current.messages.map(messageKey));
  const ownerKey = personKey(owner.name);
  const isOwner = (p: Party): boolean => (owner.slug !== "" && p.slug === owner.slug) || (p.slug === "" && ownerKey !== "" && personKey(p.name) === ownerKey);
  const added: StoredMessage[] = [];
  let newestMessage = current.sync.newestMessageAt;
  for (const m of payload.messages) {
    newestMessage = maxIso(newestMessage, m.at);
    const key = messageKey(m);
    if (ids.has(m.id) || keys.has(key)) continue;
    ids.add(m.id);
    keys.add(key);
    added.push({ ...m, outgoing: isOwner(m.from), origin: "linkedin" });
  }

  return repairMessages({
    owner,
    connections: [...current.connections.filter((c) => c.origin !== "linkedin"), ...bySlug.values()],
    messages: added.length > 0 ? sortMessages([...current.messages, ...added]) : current.messages,
    invitations: current.invitations,
    importMeta: current.importMeta,
    sync: { lastSyncAt: payload.collectedAt, newestConnectionAt: newestConnection, newestMessageAt: newestMessage },
    photos,
  });
}

function party(value: unknown): Party {
  const r = asRecord(value);
  return { name: asString(r.name, 200).trim(), slug: asString(r.slug, 200).trim().toLowerCase() };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

export function sanitizeSyncPayload(input: unknown): SyncPayload {
  const r = asRecord(input);
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    collectedAt: ISO_DAY.test(asString(r.collectedAt)) ? asString(r.collectedAt, 40) : new Date().toISOString(),
    owner: party(r.owner),
    connections: list(r.connections)
      .map((c) => asRecord(c))
      .map((c) => ({
        firstName: asString(c.firstName, 200).trim(),
        lastName: asString(c.lastName, 200).trim(),
        slug: asString(c.slug, 200).trim().toLowerCase(),
        headline: asString(c.headline, 500).trim(),
        connectedAt: ISO_DAY.test(asString(c.connectedAt)) ? asString(c.connectedAt, 10) : "",
        photo: sanitizePhoto(asString(c.photo, 1000)),
      }))
      .filter((c) => SLUG.test(c.slug)),
    messages: list(r.messages)
      .map((m) => asRecord(m))
      .map((m) => ({
        id: asString(m.id, 200),
        conversationId: asString(m.conversationId, 300),
        at: ISO_DAY.test(asString(m.at)) ? asString(m.at, 40) : "",
        from: party(m.from),
        to: list(m.to).map(party).slice(0, 50),
        content: asString(m.content, 4000),
      }))
      .filter((m) => m.id && m.at),
    notes: list(r.notes).map((n) => asString(n, 500)).filter(Boolean).slice(0, 50),
  };
}

