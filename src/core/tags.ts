import type { Contact } from "./types";

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

export function normalizeTags(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const tag = raw.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "").slice(0, MAX_TAG_LENGTH).trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function tagCounts(contacts: Contact[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const c of contacts) for (const tag of c.tracking.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function hasTag(c: Contact, tag: string): boolean {
  const key = tag.toLowerCase();
  return c.tracking.tags.some((t) => t.toLowerCase() === key);
}
