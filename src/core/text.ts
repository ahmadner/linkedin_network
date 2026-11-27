const EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE00}-\u{FE0F}\u{20E3}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]+/gu;
const ZERO_WIDTH_RE = /[​-‏‪-‮⁦-⁩﻿]/g;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

const CREDENTIALS = new Set([
  "phd", "ph.d", "dr", "mba", "msc", "m.sc", "bsc", "b.sc", "ma", "ba", "md", "pmp", "cpa",
  "cfa", "cissp", "ccna", "ccnp", "cka", "cisa", "cism", "pmi-acp", "csm", "psm", "psm1",
  "safe", "itil", "six", "sigma", "aws", "azure", "gcp", "scrum", "master", "oca", "ocp",
  "mcse", "mct", "mvp", "ceh", "comptia", "sa", "saa", "eit", "pe", "llm", "jd",
]);

const PRONOUN_RE = /\s*[([]\s*(he|him|his|she|her|hers|they|them|theirs)(\s*\/\s*\w+){0,2}\s*[)\]]/gi;

const BANNER_RE = new RegExp(
  "(?:#?\\s*)(open[\\s_-]?to[\\s_-]?work|opentowork|hiring|we'?re hiring|actively looking|" +
    "open for opportunities|open to opportunities|looking for (?:a )?(?:new )?(?:job|opportunit\\w*)|availablefor\\w*)",
  "gi",
);

const COMPANY_SUFFIXES = [
  "incorporated", "corporation", "limited", "holdings", "holding", "inc", "corp", "co", "llc",
  "l.l.c", "ltd", "plc", "gmbh", "ag", "sa", "s.a", "sas", "sarl", "s.a.r.l", "bv", "b.v", "nv",
  "n.v", "oy", "ab", "as", "aps", "pty", "pvt", "private", "llp", "lp", "pllc", "wll", "w.l.l",
  "fzc", "fze", "fz-llc", "fz llc", "jsc", "ojsc", "pjsc", "psc", "spa", "s.p.a", "srl", "s.r.l",
  "kk", "k.k", "ou", "doo", "sp z o o", "sp. z o.o", "ug", "kg", "e.v", "trust", "group",
].sort((a, b) => b.length - a.length);

const NOT_A_COMPANY = new Set([
  "", "n/a", "na", "none", "nil", "self", "self employed", "selfemployed", "freelance",
  "freelancer", "independent", "independent contractor", "unemployed", "student",
  "looking for a job", "open to work", "retired", "home", "various", "confidential", "private",
  "stealth", "stealth startup", "tbd", "no company", "not applicable",
]);

const FREELANCE_MARKERS = new Set([
  "self", "self employed", "selfemployed", "freelance", "freelancer", "independent",
  "independent contractor", "own business",
]);

const EMAIL_RE = /^[^@\s]+@(?:[^@\s.]+\.)+[A-Za-z]{2,}$/;
const PROFILE_RE = /linkedin\.com\/(?:in|pub)\/([A-Za-z0-9\-._%]+)/i;
const TITLE_SPLIT_RE = /\s*(?:\||•|·|∙|●|–{2,}|\/\/|؍)\s*/;
const AT_SPLIT_RE = /\s+(?:at|@|في|عند|لدى)\s+/;

export type CompanyKind = "company" | "freelance" | "none";

export interface CleanName {
  first: string;
  last: string;
  full: string;
}

export interface CleanCompany {
  clean: string;
  key: string;
  kind: CompanyKind;
}

export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value.charAt(start))) start += 1;
  while (end > start && chars.includes(value.charAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

export function stripJunk(value: string): string {
  const text = (value || "").normalize("NFKC").replace(ZERO_WIDTH_RE, "").replace(EMOJI_RE, " ");
  return collapseSpaces(text);
}

export function nameKey(value: string): string {
  return (value || "").toLowerCase().replace(/[^a-z؀-ۿ]/g, "");
}

function cleanNamePart(part: string): string {
  let p = stripJunk(part).replace(PRONOUN_RE, "").replace(BANNER_RE, "");
  const comma = p.indexOf(",");
  if (comma >= 0) {
    const head = p.slice(0, comma);
    const tokens = p
      .slice(comma + 1)
      .split(/[,/|]/)
      .map((t) => stripChars(t.trim().toLowerCase(), "."))
      .filter(Boolean);
    if (tokens.length > 0 && tokens.every((t) => CREDENTIALS.has(t) || t.length <= 4)) p = head;
  }
  p = p.replace(/["`~^*_=<>[\]{}]/g, "").replace(/\s*[-–—]\s*$/, "");
  return stripChars(collapseSpaces(p), " .,-");
}

export function cleanPersonName(first: string, last: string): CleanName {
  const f = cleanNamePart(first);
  const l = cleanNamePart(last);
  return { first: f, last: l, full: `${f} ${l}`.trim() };
}

export function cleanPosition(position: string): { clean: string; primary: string } {
  let p = stripJunk(position).replace(BANNER_RE, "").replace(HASHTAG_RE, "");
  p = stripChars(p.replace(/\s{2,}/g, " ").trim(), " |-•·,");
  const segments = p.split(TITLE_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  let primary = segments[0] ?? "";
  if (primary && primary.split(" ").length === 1 && segments.length > 1) {
    const longer = segments.reduce((best, s) => (s.split(" ").length > best.split(" ").length ? s : best), primary);
    if (longer.split(" ").length > 1) primary = longer;
  }
  primary = (primary.split(AT_SPLIT_RE)[0] ?? "").trim();
  return { clean: p, primary };
}

export function companyKey(value: string): string {
  return cleanCompany(value).key;
}

export function cleanCompany(company: string): CleanCompany {
  let c = stripJunk(company).replace(BANNER_RE, "");
  c = c.replace(/\(\s*(?:formerly|ex|previously)[^)]*\)/gi, "").replace(HASHTAG_RE, "");
  c = stripChars(c.replace(/\s{2,}/g, " ").trim(), " .,-|•");

  const probe = collapseSpaces(c.toLowerCase().replace(/[^a-z؀-ۿ ]/g, ""));
  let kind: CompanyKind = "company";
  if (FREELANCE_MARKERS.has(probe)) kind = "freelance";
  else if (!probe || NOT_A_COMPANY.has(probe)) kind = "none";

  let key = probe;
  let changed = true;
  while (changed && key) {
    changed = false;
    for (const suffix of COMPANY_SUFFIXES) {
      if (key.endsWith(" " + suffix)) {
        key = key.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  key = collapseSpaces(key) || probe;
  return { clean: c, key, kind };
}

export function cleanEmail(email: string): { email: string; valid: boolean } {
  const e = stripJunk(email).toLowerCase();
  return { email: e, valid: EMAIL_RE.test(e) };
}

const MEMBER_ID_SLUG = /^ACoA[A-Za-z0-9_-]{10,}$/;

export function slugOf(url: string): string {
  const m = PROFILE_RE.exec(url || "");
  const slug = m?.[1]?.replace(/\/+$/, "") ?? "";
  return slug && !MEMBER_ID_SLUG.test(slug) ? slug.toLowerCase() : "";
}

export function cleanProfileUrl(url: string): { url: string; slug: string } {
  const u = stripJunk(url);
  const slug = slugOf(u);
  return slug ? { url: `https://www.linkedin.com/in/${slug}`, slug } : { url: u, slug: "" };
}

export function greetingName(first: string, full: string): string {
  let cand = (first || "").trim();
  if (!cand && full) cand = full.split(" ")[0] ?? "";
  cand = stripChars(cand.replace(/^(mr|mrs|ms|miss|dr|eng|engr|prof)\.?\s+/i, ""), " .,-");
  if (cand.length < 2 || /^\d+$/.test(cand)) return "";
  const head = cand.charAt(0);
  return /[a-z]/.test(head) ? head.toUpperCase() + cand.slice(1) : cand;
}

const COUNTRY_HINTS: Record<string, string> = {
  jordan: "Jordan", amman: "Jordan", ksa: "Saudi Arabia", saudi: "Saudi Arabia",
  riyadh: "Saudi Arabia", uae: "UAE", dubai: "UAE", abudhabi: "UAE", qatar: "Qatar",
  doha: "Qatar", kuwait: "Kuwait", egypt: "Egypt", cairo: "Egypt", palestine: "Palestine",
  germany: "Germany", berlin: "Germany", uk: "United Kingdom", london: "United Kingdom",
  usa: "United States", canada: "Canada", toronto: "Canada", turkey: "Turkey",
};

export function countryFromSlug(slug: string): string {
  for (const token of (slug || "").split(/[-_]/)) {
    const hit = COUNTRY_HINTS[token];
    if (hit) return hit;
  }
  return "";
}

export function splitHeadline(headline: string): { position: string; company: string } {
  const text = stripJunk(headline);
  const first = (text.split(TITLE_SPLIT_RE)[0] ?? "").trim();
  const parts = first.split(AT_SPLIT_RE);
  if (parts.length >= 2) {
    const position = (parts[0] ?? "").trim();
    const company = parts.slice(1).join(" ").trim();
    if (position && company) return { position: text.replace(first, position).trim(), company };
  }
  return { position: text, company: "" };
}
