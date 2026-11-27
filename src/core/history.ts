import { daysBetween } from "./dates";
import { personKey, slugOf } from "./text";
import type { ContactHistory, Dataset, HistoryEvent, LogEntry, OutreachMode, Party, Tracking } from "./types";

export function emptyHistory(): ContactHistory {
  return {
    sentByMe: 0,
    received: 0,
    invitationSent: false,
    invitationReceived: false,
    firstContact: null,
    lastContact: null,
    lastDirection: "",
    channels: [],
    sources: [],
  };
}

export function contactedBefore(h: ContactHistory): boolean {
  return h.sentByMe > 0 || h.received > 0 || h.invitationSent || h.invitationReceived;
}

function pushUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

function noteDates(h: ContactHistory, at: string | null, outgoing: boolean): void {
  if (!at) return;
  if (!h.firstContact || at < h.firstContact) h.firstContact = at;
  if (!h.lastContact || at >= h.lastContact) {
    h.lastContact = at;
    h.lastDirection = outgoing ? "me -> them" : "them -> me";
  }
}

function apply(h: ContactHistory, e: HistoryEvent): void {
  if (e.kind === "invitation") {
    if (e.outgoing) h.invitationSent = true;
    else h.invitationReceived = true;
  } else if (e.outgoing) h.sentByMe += 1;
  else h.received += 1;
  noteDates(h, e.at, e.outgoing);
  pushUnique(h.channels, e.channel);
  pushUnique(h.sources, e.source);
}

export const SENT_STATUSES = new Set(["Note sent", "Message sent", "Follow-up sent", "Replied", "Meeting booked", "Referred"]);
export const REPLIED_STATUSES = new Set(["Replied", "Meeting booked", "Referred"]);

export function trackingEvents(slug: string, name: string, t: Tracking): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const at = /^\d{4}-\d{2}-\d{2}$/.test(t.dateSent) ? t.dateSent : null;
  const base = { slug, name, source: "tool tracking", channel: "Tracked in tool" };
  if (SENT_STATUSES.has(t.status) && at) events.push({ ...base, at, outgoing: true, kind: "log" });
  if (t.replied === "Yes" || REPLIED_STATUSES.has(t.status)) {
    events.push({ ...base, at: null, outgoing: false, kind: "log" });
  }
  return events;
}

export function logEvents(entries: LogEntry[]): HistoryEvent[] {
  return entries
    .filter((e) => e.fullName || slugOf(e.profileUrl))
    .map((e) => ({
      slug: slugOf(e.profileUrl),
      name: e.fullName,
      at: /^\d{4}-\d{2}-\d{2}$/.test(e.sentAt) ? e.sentAt : null,
      outgoing: e.outgoing,
      kind: "log" as const,
      source: "outreach log",
      channel: e.channel || "Manual log",
    }));
}

export class HistoryIndex {
  private readonly bySlug = new Map<string, ContactHistory>();
  private readonly byName = new Map<string, ContactHistory>();

  constructor(events: Iterable<HistoryEvent>) {
    for (const e of events) apply(this.bucket(e.slug, e.name), e);
  }

  private bucket(slug: string, name: string): ContactHistory {
    const s = slug.toLowerCase();
    const k = personKey(name);
    const h = (s && this.bySlug.get(s)) || (k && this.byName.get(k)) || emptyHistory();
    if (s) this.bySlug.set(s, h);
    if (k) this.byName.set(k, h);
    return h;
  }

  lookup(slug: string, fullName: string): { history: ContactHistory; matchedBy: string } {
    const bySlug = slug ? this.bySlug.get(slug.toLowerCase()) : undefined;
    if (bySlug) return { history: bySlug, matchedBy: "profile URL" };
    const key = personKey(fullName);
    const byName = key ? this.byName.get(key) : undefined;
    if (byName) return { history: byName, matchedBy: "name match" };
    return { history: emptyHistory(), matchedBy: "" };
  }
}

export function hasMessageData(dataset: Dataset): boolean {
  return dataset.messages.length > 0 || dataset.importMeta.filesFound.includes("messages.csv");
}

export function* datasetEvents(dataset: Dataset): Generator<HistoryEvent> {
  const ownerSlug = dataset.owner.slug;
  const isOwner = (p: Party): boolean => (ownerSlug !== "" && p.slug === ownerSlug) || (p.slug === "" && personKey(p.name) === personKey(dataset.owner.name));
  for (const m of dataset.messages) {
    const counterparts = (m.outgoing ? m.to : [m.from]).filter((p) => !isOwner(p));
    const single = counterparts.length === 1;
    for (const p of counterparts) {
      yield {
        slug: p.slug,
        name: single ? p.name : p.slug ? "" : p.name,
        at: m.at.slice(0, 10) || null,
        outgoing: m.outgoing,
        kind: "message",
        source: m.origin === "linkedin" ? "LinkedIn sync" : "messages.csv",
        channel: "LinkedIn DM",
      };
    }
  }
  for (const inv of dataset.invitations) {
    yield {
      slug: inv.counterpart.slug,
      name: inv.counterpart.name,
      at: inv.at.slice(0, 10) || null,
      outgoing: inv.outgoing,
      kind: "invitation",
      source: inv.origin === "linkedin" ? "LinkedIn sync" : "Invitations.csv",
      channel: "Invitation",
    };
  }
}

export function outreachMode(h: ContactHistory, today: string, messageData: boolean): { mode: OutreachMode; advice: string } {
  if (!contactedBefore(h)) {
    return messageData
      ? { mode: "cold", advice: "First contact - safe to send the introduction" }
      : { mode: "cold", advice: "No message history available - check the thread on LinkedIn before sending" };
  }
  const days = h.lastContact ? daysBetween(h.lastContact, today) : null;
  const when = days === null ? "date unknown" : `${days} days ago`;

  if (h.sentByMe > 0 && h.received === 0) {
    if (days !== null && days < 30) {
      return { mode: "nudge", advice: `You wrote ${when} and got no reply - do not write again yet, wait at least a month` };
    }
    return { mode: "nudge", advice: `You wrote ${when} and never got a reply - one short nudge only, do not repeat the pitch` };
  }
  if (h.received > 0 && h.sentByMe === 0) {
    return { mode: "reconnect", advice: `They wrote to you (${when}) and you did not answer - reply to the existing thread` };
  }
  if (h.sentByMe === 0 && h.received === 0) {
    return h.invitationSent
      ? { mode: "cold", advice: `Only an invitation was sent (${when}), never a message - the introduction is still new to them` }
      : { mode: "cold", advice: `They invited you (${when}) but no message was ever exchanged - the introduction is still new to them` };
  }
  if (days !== null && days <= 60) {
    return { mode: "reconnect", advice: `You spoke ${when} - recent conversation, continue it instead of pitching from scratch` };
  }
  return { mode: "reconnect", advice: `You spoke before (${when}) and they replied - reconnect, do not introduce yourself again` };
}
