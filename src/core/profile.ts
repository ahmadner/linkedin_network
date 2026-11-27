import { DEFAULT_BUCKETS, DEFAULT_WEIGHTS } from "./scoring";
import type { Goal, Profile } from "./types";

const GOALS: Goal[] = ["job_search", "sales", "partnership", "networking"];

export const DEFAULT_COMPANY_OVERRIDES: Record<string, string> = {
  optimiza: "Software & IT Services",
  progressoft: "Software & IT Services",
  estarta: "Software & IT Services",
  "tamatem games": "Media & Entertainment",
};

export function defaultProfile(): Profile {
  return {
    me: {
      full_name: "",
      first_name: "",
      full_name_ar: "",
      first_name_ar: "",
      headline: "",
      current_role: "",
      current_company: "",
      years_experience: 0,
      location: "",
      target_roles: [],
      top_skills: [],
      highlight_ar: "",
      highlight_en: "",
      cv_link: "",
      portfolio_link: "",
      github: "",
      email: "",
      phone: "",
      education: "",
    },
    targeting: {
      goal: "job_search",
      target_functions: ["Engineering & Software", "Data & AI", "DevOps & Cloud", "HR & Recruiting"],
      target_industries: ["Software & IT Services", "Banking & Finance", "Telecom"],
      target_companies: [],
      excluded_companies: [],
      weights: { ...DEFAULT_WEIGHTS },
      buckets: { ...DEFAULT_BUCKETS },
    },
    messaging: {
      signature_ar: "",
      signature_en: "",
      note_char_limit: 200,
      message_char_limit: 1600,
    },
  };
}

type Loose = Record<string, unknown>;

export function asRecord(value: unknown): Loose {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {};
}

export function asString(value: unknown, max = 4000): string {
  if (typeof value === "string") return value.slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function asStringList(value: unknown, maxItems = 500): string[] {
  if (typeof value === "string") return value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean).slice(0, maxItems);
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v, 300).trim()).filter(Boolean).slice(0, maxItems);
}

export function sanitizeProfile(input: unknown): Profile {
  const base = defaultProfile();
  const root = asRecord(input);
  const me = asRecord(root.me);
  const targeting = asRecord(root.targeting);
  const messaging = asRecord(root.messaging);

  for (const key of Object.keys(base.me) as Array<keyof Profile["me"]>) {
    if (!(key in me)) continue;
    const current = base.me[key];
    if (Array.isArray(current)) (base.me[key] as string[]) = asStringList(me[key]);
    else if (typeof current === "number") (base.me[key] as number) = Math.max(0, asNumber(me[key], 0));
    else (base.me[key] as string) = asString(me[key]);
  }

  const goal = asString(targeting.goal) as Goal;
  if (GOALS.includes(goal)) base.targeting.goal = goal;
  for (const key of ["target_functions", "target_industries", "target_companies", "excluded_companies"] as const) {
    if (key in targeting) base.targeting[key] = asStringList(targeting[key]);
  }
  const weights = asRecord(targeting.weights);
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    if (key in weights) base.targeting.weights[key] = asNumber(weights[key], DEFAULT_WEIGHTS[key] ?? 0);
  }
  const buckets = asRecord(targeting.buckets);
  for (const key of ["A", "B", "C"] as const) {
    if (key in buckets) base.targeting.buckets[key] = asNumber(buckets[key], DEFAULT_BUCKETS[key]);
  }

  base.messaging.signature_ar = asString(messaging.signature_ar, 300);
  base.messaging.signature_en = asString(messaging.signature_en, 300);
  base.messaging.note_char_limit = Math.min(3000, Math.max(50, asNumber(messaging.note_char_limit, 200)));
  base.messaging.message_char_limit = Math.min(8000, Math.max(200, asNumber(messaging.message_char_limit, 1600)));
  return base;
}

export function sanitizeOverrides(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(input))) {
    const k = key.trim().toLowerCase();
    const v = asString(value, 100).trim();
    if (k && v) out[k] = v;
  }
  return out;
}
