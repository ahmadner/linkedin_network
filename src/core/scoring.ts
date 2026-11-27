import { isDecisionMaker } from "./classify";
import { companyKey } from "./text";
import { daysBetween } from "./dates";
import type { Bucket, OutreachMode, Targeting } from "./types";

export const DEFAULT_WEIGHTS: Record<string, number> = {
  recruiter: 28,
  hiring_manager_in_target_function: 26,
  decision_maker_max: 18,
  target_company: 20,
  target_industry: 12,
  target_function: 14,
  same_function_peer: 8,
  email_available: 6,
  recency_max: 8,
  multi_contact_company: 4,
  penalty_student: -6,
  penalty_no_company: -4,
  penalty_awaiting_reply: -12,
  penalty_contacted_recently: -8,
};

export const DEFAULT_BUCKETS = { A: 65, B: 45, C: 25 };

export interface ScoreInput {
  seniority: string;
  seniorityRank: number;
  function: string;
  allFunctions: string[];
  industry: string;
  companyKey: string;
  companyClean: string;
  emailValid: boolean;
  connectedDate: string | null;
  companyContactCount: number;
  isRecruiter: boolean;
  mode: OutreachMode;
  daysSinceContact: number | null;
}

export interface ScoreResult {
  score: number;
  bucket: Bucket;
  breakdown: string;
}

export interface PreparedTargeting {
  weights: Record<string, number>;
  buckets: { A: number; B: number; C: number };
  functions: Set<string>;
  industries: Set<string>;
  companies: Set<string>;
  excluded: Set<string>;
}

function lowerSet(values: string[]): Set<string> {
  return new Set(values.map((v) => String(v).trim().toLowerCase()).filter(Boolean));
}

function companySet(values: string[]): Set<string> {
  const out = lowerSet(values);
  for (const v of values) {
    const key = companyKey(String(v));
    if (key) out.add(key);
  }
  return out;
}

export function prepareTargeting(targeting: Targeting): PreparedTargeting {
  return {
    weights: { ...DEFAULT_WEIGHTS, ...targeting.weights },
    buckets: { ...DEFAULT_BUCKETS, ...targeting.buckets },
    functions: lowerSet(targeting.target_functions),
    industries: lowerSet(targeting.target_industries),
    companies: companySet(targeting.target_companies),
    excluded: companySet(targeting.excluded_companies),
  };
}

function weight(t: PreparedTargeting, name: string): number {
  return t.weights[name] ?? DEFAULT_WEIGHTS[name] ?? 0;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function scoreContact(input: ScoreInput, t: PreparedTargeting, today: string): ScoreResult {
  const ck = input.companyKey.toLowerCase();
  const cc = input.companyClean.trim().toLowerCase();
  if (ck && (t.excluded.has(ck) || t.excluded.has(cc))) return { score: 0, bucket: "X", breakdown: "excluded company" };

  const parts: string[] = [];
  let total = 0;
  const add = (amount: number, label: string): void => {
    total += amount;
    parts.push(`${label} ${amount >= 0 ? "+" : ""}${fmt(amount)}`);
  };

  if (input.isRecruiter) add(weight(t, "recruiter"), "recruiter/HR");

  const fn = input.function.toLowerCase();
  const inTargetFunction = t.functions.has(fn);
  if (inTargetFunction && isDecisionMaker(input.seniorityRank)) {
    add(weight(t, "hiring_manager_in_target_function"), "decision maker in target function");
  }
  if (input.seniorityRank > 0) {
    add((input.seniorityRank / 95) * weight(t, "decision_maker_max"), `seniority ${input.seniority}`);
  }
  if (ck && (t.companies.has(ck) || t.companies.has(cc))) add(weight(t, "target_company"), "target company");
  if (t.industries.has(input.industry.toLowerCase())) add(weight(t, "target_industry"), "target industry");

  if (inTargetFunction) add(weight(t, "target_function"), "target function");
  else if (input.allFunctions.some((f) => t.functions.has(f.toLowerCase()))) {
    add(weight(t, "same_function_peer"), "adjacent function");
  }

  if (input.emailValid) add(weight(t, "email_available"), "email on file");

  if (input.connectedDate) {
    const years = Math.max(0, daysBetween(input.connectedDate, today) / 365.25);
    const recency = Math.max(0, weight(t, "recency_max") * (1 - Math.min(years, 5) / 5));
    if (recency >= 0.5) add(recency, `connected ${years.toFixed(1)}y ago`);
  }
  if (input.companyContactCount >= 3) {
    add(weight(t, "multi_contact_company"), `${input.companyContactCount} contacts at this company`);
  }
  if (input.mode === "nudge") add(weight(t, "penalty_awaiting_reply"), "written to, no reply");
  if (input.daysSinceContact !== null && input.daysSinceContact <= 30) {
    add(weight(t, "penalty_contacted_recently"), `contacted ${input.daysSinceContact} days ago`);
  }
  if (input.seniority === "Student" || input.seniority === "Intern / Trainee") add(weight(t, "penalty_student"), "student/intern");
  if (!input.companyClean) add(weight(t, "penalty_no_company"), "no company");

  const score = Math.round(Math.max(0, Math.min(100, total)));
  const bucket: Bucket = score >= t.buckets.A ? "A" : score >= t.buckets.B ? "B" : score >= t.buckets.C ? "C" : "D";
  return { score, bucket, breakdown: parts.length > 0 ? parts.join("; ") : "no positive signals" };
}
