import { companyKey } from "./text";
import type { Contact, CompanyRow, Profile } from "./types";

export type GapKind = "industry" | "company" | "function";
export type GapLevel = "none" | "weak" | "ok";

export interface Gap {
  kind: GapKind;
  target: string;
  contacts: number;
  recruiters: number;
  decisionMakers: number;
  level: GapLevel;
  advice: string;
  search: string;
}

export type ActionKind = "start" | "reconnect" | "follow_up";

export interface PersonSuggestion {
  contact: Contact;
  action: ActionKind;
  reason: string;
}

export interface CompanySuggestion {
  company: CompanyRow;
  targeted: boolean;
  reason: string;
}

export const GAP_KIND_LABEL: Record<GapKind, string> = { industry: "قطاع", company: "شركة", function: "تخصص" };
export const GAP_LEVEL_LABEL: Record<GapLevel, string> = { none: "ما في حدا", weak: "ضعيف", ok: "منيح" };
export const ACTION_LABEL: Record<ActionKind, string> = { start: "ابدأ تواصل", reconnect: "ارجع احكي معه", follow_up: "تابع معه" };

const WEAK_BELOW = 5;
const RECONNECT_AFTER_DAYS = 90;
const FOLLOW_UP_AFTER_DAYS = 7;
const PER_COMPANY = 2;

const RECRUITER_TITLE = "Technical Recruiter";

export function linkedinPeopleSearch(keywords: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords.trim())}`;
}

export function linkedinCompanySearch(keywords: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(keywords.trim())}`;
}

function level(contacts: number, recruiters: number, decisionMakers: number): GapLevel {
  if (contacts === 0) return "none";
  if (contacts < WEAK_BELOW || recruiters === 0 || decisionMakers === 0) return "weak";
  return "ok";
}

function missing(recruiters: number, decisionMakers: number): string {
  const parts: string[] = [];
  if (recruiters === 0) parts.push("Recruiter");
  if (decisionMakers === 0) parts.push("صاحب قرار (Manager وأعلى)");
  return parts.join(" ولا ");
}

function summarize(list: Contact[]): { contacts: number; recruiters: number; decisionMakers: number } {
  let recruiters = 0;
  let decisionMakers = 0;
  for (const c of list) {
    if (c.isRecruiter) recruiters += 1;
    if (c.isDecisionMaker) decisionMakers += 1;
  }
  return { contacts: list.length, recruiters, decisionMakers };
}

function adviceFor(kind: GapKind, target: string, s: ReturnType<typeof summarize>, lvl: GapLevel): string {
  const where = kind === "company" ? `بـ ${target}` : kind === "industry" ? `بقطاع ${target}` : `بتخصص ${target}`;
  if (lvl === "none") {
    return kind === "company"
      ? `ما بتعرف حدا ${where}. ابدأ بـ Recruiter فيها، وبعدها مدير الفريق الي بدك تشتغل فيه.`
      : `ما عندك حدا ${where}. ضيف 3 لـ 5 أشخاص، أولهم Recruiters وبعدهم مدراء.`;
  }
  if (lvl === "weak") {
    const gap = missing(s.recruiters, s.decisionMakers);
    return gap ? `عندك ${s.contacts} ${where}، بس ما في ${gap}. ضيف واحد أو اثنين.` : `عندك ${s.contacts} بس ${where}. وسّع شوي عشان يكون عندك أكثر من مدخل.`;
  }
  return `عندك ${s.contacts} ${where}، منهم ${s.recruiters} Recruiter و ${s.decisionMakers} صاحب قرار. ركّز على التواصل معهم.`;
}

export function networkGaps(contacts: Contact[], profile: Profile): Gap[] {
  const t = profile.targeting;
  const location = profile.me.location.split(",")[0]?.trim() ?? "";
  const role = (profile.me.target_roles[0] ?? profile.me.current_role).trim();
  const gaps: Gap[] = [];
  const push = (kind: GapKind, target: string, members: Contact[], search: string): void => {
    const s = summarize(members);
    const lvl = level(s.contacts, s.recruiters, s.decisionMakers);
    gaps.push({ kind, target, ...s, level: lvl, advice: adviceFor(kind, target, s, lvl), search: linkedinPeopleSearch(search) });
  };

  for (const company of t.target_companies) {
    const key = companyKey(company);
    if (!key) continue;
    push("company", company, contacts.filter((c) => c.companyKey === key), `${RECRUITER_TITLE} ${company}`);
  }
  for (const industry of t.target_industries) {
    push("industry", industry, contacts.filter((c) => c.industry === industry), [RECRUITER_TITLE, industry.split("&")[0]?.trim() ?? industry, location].filter(Boolean).join(" "));
  }
  for (const fn of t.target_functions) {
    const search = fn === "HR & Recruiting" ? [RECRUITER_TITLE, location].filter(Boolean).join(" ") : [role, "Manager", location].filter(Boolean).join(" ");
    push("function", fn, contacts.filter((c) => c.function === fn), search);
  }
  const order: Record<GapLevel, number> = { none: 0, weak: 1, ok: 2 };
  return gaps.sort((a, b) => order[a.level] - order[b.level] || a.contacts - b.contacts);
}

function scoreReason(c: Contact): string {
  const role = c.positionPrimary || c.positionClean;
  const bits = [c.archetypeLabel, role && c.companyClean ? `${role} @ ${c.companyClean}` : role || c.companyClean, `نقاط ${c.score}`];
  return bits.filter(Boolean).join(" · ");
}

export function suggestPeople(contacts: Contact[], limit = 60): PersonSuggestion[] {
  const out: PersonSuggestion[] = [];
  const perCompany = new Map<string, number>();
  const take = (c: Contact): boolean => {
    const key = c.companyKey || c.id;
    const used = perCompany.get(key) ?? 0;
    if (used >= PER_COMPANY) return false;
    perCompany.set(key, used + 1);
    return true;
  };
  const ranked = [...contacts].filter((c) => c.bucket !== "X").sort((a, b) => b.score - a.score || a.idx - b.idx);

  for (const c of ranked) {
    if (c.mode !== "nudge" || (c.daysSinceContact ?? 0) < FOLLOW_UP_AFTER_DAYS || c.bucket === "D") continue;
    if (take(c)) out.push({ contact: c, action: "follow_up", reason: `بعتتله قبل ${c.daysSinceContact ?? "?"} يوم وما رد. ${scoreReason(c)}` });
  }
  for (const c of ranked) {
    if (c.mode !== "reconnect" || (c.daysSinceContact ?? Infinity) < RECONNECT_AFTER_DAYS || (c.bucket !== "A" && c.bucket !== "B")) continue;
    if (take(c)) out.push({ contact: c, action: "reconnect", reason: `حكيتوا قبل، وآخر تواصل قبل ${c.daysSinceContact ?? "?"} يوم. ${scoreReason(c)}` });
  }
  for (const c of ranked) {
    if (c.mode !== "cold" || (c.bucket !== "A" && c.bucket !== "B")) continue;
    if (take(c)) out.push({ contact: c, action: "start", reason: `ما في تواصل بينكم لسا. ${scoreReason(c)}` });
  }
  const order: Record<ActionKind, number> = { follow_up: 0, reconnect: 1, start: 2 };
  return out.sort((a, b) => b.contact.score - a.contact.score || order[a.action] - order[b.action]).slice(0, limit);
}

export function suggestCompanies(companies: CompanyRow[], profile: Profile, limit = 40): CompanySuggestion[] {
  const targetKeys = new Set(profile.targeting.target_companies.map(companyKey).filter(Boolean));
  const industries = new Set(profile.targeting.target_industries);
  const out: CompanySuggestion[] = [];
  for (const row of companies) {
    const targeted = targetKeys.has(row.key);
    if (!targeted && !industries.has(row.industry)) continue;
    const reasons: string[] = [];
    if (targeted) reasons.push("من شركاتك المستهدفة");
    else reasons.push(`بقطاع ${row.industry}`);
    reasons.push(`بتعرف ${row.count} فيها`);
    if (row.hasRecruiter) reasons.push("في Recruiter");
    if (row.decisionMakers > 0) reasons.push(`${row.decisionMakers} صاحب قرار`);
    if (row.count === 1) reasons.push("مدخل واحد بس، وسّع العلاقة");
    out.push({ company: row, targeted, reason: reasons.join(" · ") });
  }
  return out
    .sort((a, b) => Number(b.targeted) - Number(a.targeted) || b.company.bestScore - a.company.bestScore || b.company.count - a.company.count)
    .slice(0, limit);
}
