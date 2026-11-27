import type { Candidate } from "../../extension/src/protocol";
import { TEMPLATE_IDS, TEMPLATE_LABEL, TemplateBuilder, type TemplateId } from "./templates";
import type { AiTemplate, Contact, Lang, MessageSet, Profile } from "./types";

export type MessageSource = "message_ar" | "message_en" | "followup_ar" | "followup_en" | `tpl:${TemplateId}:${Lang}`;

export const MESSAGE_SOURCES: Array<[MessageSource, string]> = [
  ["message_ar", "الرسالة الكاملة - عربي"],
  ["message_en", "Full message - English"],
  ["followup_ar", "المتابعة - عربي"],
  ["followup_en", "Follow-up - English"],
  ...TEMPLATE_IDS.flatMap((id): Array<[MessageSource, string]> => [
    [`tpl:${id}:ar`, `قالب: ${TEMPLATE_LABEL[id]} - عربي`],
    [`tpl:${id}:en`, `قالب: ${TEMPLATE_LABEL[id]} - English`],
  ]),
];

export const MAX_BATCH = 25;
export const INVITE_NOTE_LIMIT = 200;

export function messageFor(c: Contact, source: MessageSource, profile: Profile, aiTemplates: Record<string, AiTemplate>): string {
  if (source.startsWith("tpl:")) {
    const [, id, lang] = source.split(":") as [string, TemplateId, Lang];
    const ai = aiTemplates[`${c.id}|${id}`];
    return (ai ? ai[lang] : new TemplateBuilder(profile).build(id, c, { jobTitle: "", jobLink: "" })[lang]).trim();
  }
  const set: MessageSet = c.ai ?? c;
  return set[source as keyof MessageSet].trim();
}

export function personalize(note: string, name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return note.replace(/\{name\}/g, first).replace(/[ \t]+/g, " ").replace(/ ([،,.!؟?])/g, "$1").trim();
}

export function newCandidates(candidates: Candidate[], knownSlugs: Set<string>): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const id = c.memberId || c.slug;
    if (!id || seen.has(id) || c.degree === "1st" || (c.slug && knownSlugs.has(c.slug))) return false;
    seen.add(id);
    return true;
  });
}

export function peopleSearchUrl(keywords: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords.trim())}&network=%5B%22S%22%5D`;
}
