import type { Draft, Post } from "./content";
import { daysBetween } from "./dates";
import { awaitingMe, REPLIED_STATUSES, SENT_STATUSES } from "./history";
import { conversations, partyKey } from "./inbox";
import { networkGaps, suggestPeople, type Gap, type PersonSuggestion } from "./opportunities";
import type { Contact, Profile, StoredMessage } from "./types";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEKS = 12;
const MONTHS = 12;
const WINDOW = 90;
const SETTLE_DAYS = 7;
const FRESH_DAYS = 30;
const STALE_DATA_DAYS = 7;
const CONVERTED_STATUSES = new Set(["Meeting booked", "Referred"]);

export const FUNNEL_BENCHMARK = { contacted: 0.4, replied: 0.3, converted: 0.2 } as const;

export type AgeBand = "0-2" | "3-7" | "8-30" | "31-90" | "90+";
export const AGE_BANDS: AgeBand[] = ["0-2", "3-7", "8-30", "31-90", "90+"];

export type FunnelStageKey = "priority" | "contacted" | "replied" | "converted";
export type Bottleneck = Exclude<FunnelStageKey, "priority">;

export type StepKind = "profile" | "reply" | "post_due" | "sync" | "follow_up" | "post" | "gap" | "start" | "close_stale";

export interface InsightInput {
  contacts: Contact[];
  messages: StoredMessage[];
  posts: Post[];
  drafts: Draft[];
  postsPerWeek: number;
  profile: Profile;
  dataAt: string;
  today: string;
}

export interface WeekPoint {
  start: string;
  end: string;
  messaged: number;
  heard: number;
  posts: number;
}

export interface ReplyRate {
  started: number;
  replied: number;
  rate: number | null;
  previousStarted: number;
  previousRate: number | null;
  medianHours: number | null;
}

export interface ReplySpeed {
  medianHours: number | null;
  previousMedianHours: number | null;
  samples: number;
}

export interface AgeCount {
  band: AgeBand;
  count: number;
  important: number;
}

export interface Backlog {
  total: number;
  fresh: number;
  freshImportant: number;
  stale: number;
  oldestFreshDays: number | null;
  bands: AgeCount[];
  queue: Contact[];
}

export interface GrowthMonth {
  month: string;
  targeted: number;
  other: number;
}

export interface Growth {
  last30: number;
  previous30: number;
  targeted30: number;
  months: GrowthMonth[];
}

export interface FunnelStage {
  key: FunnelStageKey;
  count: number;
}

export interface Funnel {
  stages: FunnelStage[];
  tracked: boolean;
  bottleneck: Bottleneck | null;
}

export interface ContentPulse {
  target: number;
  last30: number;
  previous30: number;
  target30: number;
  daysSinceLast: number | null;
  due: number;
  ready: number;
  nextScheduled: string;
}

export interface Coverage {
  total: number;
  none: number;
  weak: number;
  ok: number;
  gaps: Gap[];
}

export interface Step {
  kind: StepKind;
  priority: number;
  count: number;
}

export interface Insights {
  weeks: WeekPoint[];
  replies: ReplyRate;
  speed: ReplySpeed;
  backlog: Backlog;
  growth: Growth;
  funnel: Funnel;
  content: ContentPulse;
  coverage: Coverage;
  followUps: PersonSuggestion[];
  starts: PersonSuggestion[];
  dataAgeDays: number | null;
  steps: Step[];
}

function shift(day: string, days: number): string {
  return new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10);
}

function inRange(day: string, from: string, to: string): boolean {
  return day > from && day <= to;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export function isImportant(c: Contact): boolean {
  return c.bucket === "A" || c.bucket === "B" || c.isRecruiter;
}

export function ageBand(days: number): AgeBand {
  if (days <= 2) return "0-2";
  if (days <= 7) return "3-7";
  if (days <= 30) return "8-30";
  if (days <= 90) return "31-90";
  return "90+";
}

export function weeklyPulse(messages: StoredMessage[], posts: Post[], today: string, weeks = WEEKS): WeekPoint[] {
  const points: WeekPoint[] = [];
  const index = new Map<string, number>();
  for (let i = 0; i < weeks; i += 1) {
    const end = shift(today, -7 * (weeks - 1 - i));
    const start = shift(end, -6);
    for (let d = 0; d < 7; d += 1) index.set(shift(start, d), i);
    points.push({ start, end, messaged: 0, heard: 0, posts: 0 });
  }
  const messaged = points.map(() => new Set<string>());
  const heard = points.map(() => new Set<string>());
  for (const m of messages) {
    const i = index.get(m.at.slice(0, 10));
    if (i === undefined) continue;
    if (m.outgoing) for (const p of m.to) messaged[i]!.add(partyKey(p));
    else heard[i]!.add(partyKey(m.from));
  }
  for (const p of posts) {
    const i = index.get(p.at.slice(0, 10));
    if (i !== undefined) points[i]!.posts += 1;
  }
  return points.map((p, i) => ({ ...p, messaged: messaged[i]!.size, heard: heard[i]!.size }));
}

export function replyRate(messages: StoredMessage[], today: string, days = WINDOW): ReplyRate {
  const end = shift(today, -SETTLE_DAYS);
  const start = shift(end, -days);
  const previousStart = shift(start, -days);
  const current = { started: 0, replied: 0, hours: [] as number[] };
  const previous = { started: 0, replied: 0 };
  for (const conv of conversations(messages)) {
    const first = conv.items[0]?.message;
    if (!first?.outgoing) continue;
    const day = first.at.slice(0, 10);
    const answer = conv.items.find((item) => !item.message.outgoing)?.message;
    if (inRange(day, start, end)) {
      current.started += 1;
      if (answer) {
        current.replied += 1;
        const hours = (Date.parse(answer.at) - Date.parse(first.at)) / HOUR_MS;
        if (Number.isFinite(hours) && hours >= 0) current.hours.push(hours);
      }
    } else if (inRange(day, previousStart, start)) {
      previous.started += 1;
      if (answer) previous.replied += 1;
    }
  }
  return {
    started: current.started,
    replied: current.replied,
    rate: ratio(current.replied, current.started),
    previousStarted: previous.started,
    previousRate: ratio(previous.replied, previous.started),
    medianHours: median(current.hours),
  };
}

export function replySpeed(messages: StoredMessage[], today: string, days = WINDOW): ReplySpeed {
  const start = shift(today, -days);
  const previousStart = shift(start, -days);
  const current: number[] = [];
  const previous: number[] = [];
  for (const conv of conversations(messages)) {
    let waitingSince = "";
    for (const { message } of conv.items) {
      if (!message.outgoing) {
        waitingSince ||= message.at;
        continue;
      }
      if (!waitingSince) continue;
      const hours = (Date.parse(message.at) - Date.parse(waitingSince)) / HOUR_MS;
      const day = waitingSince.slice(0, 10);
      if (Number.isFinite(hours) && hours >= 0) {
        if (inRange(day, start, today)) current.push(hours);
        else if (inRange(day, previousStart, start)) previous.push(hours);
      }
      waitingSince = "";
    }
  }
  return { medianHours: median(current), previousMedianHours: median(previous), samples: current.length };
}

export function replyBacklog(contacts: Contact[]): Backlog {
  const bands = new Map<AgeBand, AgeCount>(AGE_BANDS.map((band) => [band, { band, count: 0, important: 0 }]));
  const waiting = contacts.filter(awaitingMe);
  const fresh: Contact[] = [];
  for (const c of waiting) {
    const days = Math.max(0, c.daysSinceContact ?? Infinity);
    const row = bands.get(ageBand(days))!;
    row.count += 1;
    if (isImportant(c)) row.important += 1;
    if (days <= FRESH_DAYS) fresh.push(c);
  }
  const queue = fresh.sort((a, b) => Number(isImportant(b)) - Number(isImportant(a)) || (a.daysSinceContact ?? 0) - (b.daysSinceContact ?? 0) || b.score - a.score);
  return {
    total: waiting.length,
    fresh: fresh.length,
    freshImportant: fresh.filter(isImportant).length,
    stale: waiting.length - fresh.length,
    oldestFreshDays: fresh.reduce<number | null>((max, c) => Math.max(max ?? 0, c.daysSinceContact ?? 0), null),
    bands: [...bands.values()],
    queue,
  };
}

export function networkGrowthSplit(contacts: Contact[], today: string, months = MONTHS): Growth {
  const keys: string[] = [];
  const cursor = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() - (months - 1));
  for (let i = 0; i < months; i += 1) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const byMonth = new Map<string, GrowthMonth>(keys.map((month) => [month, { month, targeted: 0, other: 0 }]));
  const last30From = shift(today, -30);
  const previous30From = shift(today, -60);
  let last30 = 0;
  let previous30 = 0;
  let targeted30 = 0;
  for (const c of contacts) {
    const day = c.connectedDate;
    if (!day) continue;
    const targeted = c.bucket === "A" || c.bucket === "B";
    const row = byMonth.get(day.slice(0, 7));
    if (row) {
      if (targeted) row.targeted += 1;
      else row.other += 1;
    }
    if (inRange(day, last30From, today)) {
      last30 += 1;
      if (targeted) targeted30 += 1;
    } else if (inRange(day, previous30From, last30From)) previous30 += 1;
  }
  return { last30, previous30, targeted30, months: [...byMonth.values()] };
}

export function outreachFunnel(contacts: Contact[]): Funnel {
  let priority = 0;
  let contacted = 0;
  let replied = 0;
  let converted = 0;
  let tracked = false;
  for (const c of contacts) {
    const status = c.tracking.status;
    if (CONVERTED_STATUSES.has(status)) tracked = true;
    if (c.bucket !== "A" && c.bucket !== "B") continue;
    priority += 1;
    if (c.history.sentByMe === 0 && !SENT_STATUSES.has(status)) continue;
    contacted += 1;
    if (c.history.received === 0 && c.tracking.replied !== "Yes" && !REPLIED_STATUSES.has(status)) continue;
    replied += 1;
    if (CONVERTED_STATUSES.has(status)) converted += 1;
  }
  const checks: Array<[Bottleneck, number, number]> = [["contacted", contacted, priority], ["replied", replied, contacted]];
  if (tracked) checks.push(["converted", converted, replied]);
  let bottleneck: Bottleneck | null = null;
  let worst = 1;
  for (const [key, part, whole] of checks) {
    if (whole === 0) continue;
    const score = part / whole / FUNNEL_BENCHMARK[key];
    if (score < worst) {
      worst = score;
      bottleneck = key;
    }
  }
  return {
    stages: [{ key: "priority", count: priority }, { key: "contacted", count: contacted }, { key: "replied", count: replied }, { key: "converted", count: converted }],
    tracked,
    bottleneck,
  };
}

export function contentPulse(posts: Post[], drafts: Draft[], postsPerWeek: number, today: string): ContentPulse {
  const last30From = shift(today, -30);
  const previous30From = shift(today, -60);
  let last30 = 0;
  let previous30 = 0;
  let latest = "";
  for (const p of posts) {
    const day = p.at.slice(0, 10);
    if (!day) continue;
    if (day > latest && day <= today) latest = day;
    if (inRange(day, last30From, today)) last30 += 1;
    else if (inRange(day, previous30From, last30From)) previous30 += 1;
  }
  const open = drafts.filter((d) => d.status !== "published");
  const upcoming = open.map((d) => d.scheduledFor).filter((day) => day > today).sort();
  return {
    target: postsPerWeek,
    last30,
    previous30,
    target30: Math.round((postsPerWeek * 30) / 7),
    daysSinceLast: latest ? Math.max(0, daysBetween(latest, today)) : null,
    due: open.filter((d) => d.scheduledFor && d.scheduledFor <= today).length,
    ready: open.filter((d) => d.status === "ready").length,
    nextScheduled: upcoming[0] ?? "",
  };
}

export function targetCoverage(contacts: Contact[], profile: Profile): Coverage {
  const gaps = networkGaps(contacts, profile);
  const count = (level: Gap["level"]): number => gaps.filter((g) => g.level === level).length;
  return { total: gaps.length, none: count("none"), weak: count("weak"), ok: count("ok"), gaps };
}

function profileReady(profile: Profile): boolean {
  const t = profile.targeting;
  const hasTargets = t.target_companies.length + t.target_industries.length + t.target_functions.length > 0;
  return Boolean(profile.me.current_role || profile.me.target_roles.length > 0) && hasTargets;
}

function postingBehind(content: ContentPulse): boolean {
  if (content.target <= 0) return false;
  const allowedGap = Math.ceil((7 / content.target) * 2);
  return content.daysSinceLast === null || content.daysSinceLast > allowedGap || content.last30 < content.target30 / 2;
}

export function nextSteps(i: Omit<Insights, "steps">, profile: Profile): Step[] {
  const steps: Step[] = [];
  const add = (kind: StepKind, priority: number, count: number): void => {
    if (count > 0) steps.push({ kind, priority, count });
  };
  if (!profileReady(profile)) add("profile", 95, 1);
  add("reply", i.backlog.freshImportant > 0 ? 100 : 85, i.backlog.fresh);
  add("post_due", 90, i.content.due);
  if (i.dataAgeDays !== null && i.dataAgeDays >= STALE_DATA_DAYS) add("sync", Math.min(92, 60 + i.dataAgeDays), i.dataAgeDays);
  add("follow_up", 70, i.followUps.length);
  if (postingBehind(i.content)) add("post", 60, Math.max(1, i.content.target30 - i.content.last30));
  if (i.coverage.none > 0) add("gap", 50, i.coverage.none);
  else add("gap", 35, i.coverage.weak);
  add("start", 45, i.starts.length);
  add("close_stale", 25, i.backlog.stale);
  return steps.sort((a, b) => b.priority - a.priority || b.count - a.count);
}

export function buildInsights(input: InsightInput): Insights {
  const { contacts, messages, posts, drafts, postsPerWeek, profile, dataAt, today } = input;
  const suggestions = suggestPeople(contacts, 200).filter((s) => !awaitingMe(s.contact));
  const base: Omit<Insights, "steps"> = {
    weeks: weeklyPulse(messages, posts, today),
    replies: replyRate(messages, today),
    speed: replySpeed(messages, today),
    backlog: replyBacklog(contacts),
    growth: networkGrowthSplit(contacts, today),
    funnel: outreachFunnel(contacts),
    content: contentPulse(posts, drafts, postsPerWeek, today),
    coverage: targetCoverage(contacts, profile),
    followUps: suggestions.filter((s) => s.action === "follow_up"),
    starts: suggestions.filter((s) => s.action === "start" || s.action === "reconnect"),
    dataAgeDays: dataAt ? Math.max(0, daysBetween(dataAt.slice(0, 10), today)) : null,
  };
  return { ...base, steps: nextSteps(base, profile) };
}
