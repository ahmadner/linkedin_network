import { classifyFunction, classifyIndustry, classifySeniority, isDecisionMaker, isRecruiter, SENIORITY_RANK, type Seniority } from "./classify";
import { daysBetween, parseDate } from "./dates";
import { datasetEvents, hasMessageData, HistoryIndex, contactedBefore, logEvents, outreachMode, trackingEvents } from "./history";
import { ARCHETYPE_LABEL, MessageBuilder, MODE_LABEL, pickArchetype, profileGaps } from "./messages";
import { prepareTargeting, scoreContact } from "./scoring";
import { manualDirections, type InboxOverride } from "./inbox";
import { cleanCompany, cleanEmail, cleanPersonName, cleanPosition, cleanProfileUrl, countryFromSlug, greetingName, nameKey, personKey } from "./text";
import type {
  AiClassification, AiMessage, Analysis, CompanyRow, Contact, Dataset, HistoryEvent, LogEntry, Profile, RawConnection, Tracking,
} from "./types";

export interface AnalysisInput {
  dataset: Dataset;
  profile: Profile;
  overrides: Record<string, string>;
  tracking: Record<string, Tracking>;
  log: LogEntry[];
  inbox?: Record<string, InboxOverride>;
  aiMessages: Record<string, AiMessage>;
  aiClassifications: Record<string, AiClassification>;
  today: string;
}

export const EMPTY_TRACKING: Readonly<Tracking> = { status: "Not started", dateSent: "", replied: "", nextStep: "", notes: "", tags: [] };

export function newTracking(): Tracking {
  return { ...EMPTY_TRACKING, tags: [] };
}

const MERGE_FIELDS = ["firstName", "lastName", "profileUrl", "email", "company", "position", "connectedOn"] as const;

const RESOLVED_BY: Record<string, (typeof MERGE_FIELDS)[number]> = {
  missing_company: "company",
  missing_position: "position",
  missing_profile_url: "profileUrl",
};

function isResolved(issue: string, r: RawConnection): boolean {
  const field = RESOLVED_BY[issue];
  return field !== undefined && r[field] !== "";
}

function completeness(r: RawConnection): number {
  return MERGE_FIELDS.reduce((n, f) => n + (r[f] ? 1 : 0), 0);
}

export function contactKey(r: RawConnection): string {
  const { slug } = cleanProfileUrl(r.profileUrl);
  if (slug) return `slug:${slug}`;
  const key = nameKey(cleanPersonName(r.firstName, r.lastName).full);
  return key ? `name:${key}|${cleanCompany(r.company).key}` : `row:${r.origin}:${r.sourceRow}`;
}

export function dedupe(records: RawConnection[]): { records: Array<{ id: string; record: RawConnection }>; removed: number } {
  const ordered = [...records].sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "linkedin" ? -1 : 1));
  const byKey = new Map<string, RawConnection>();
  let removed = 0;
  for (const rec of ordered) {
    const key = contactKey(rec);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...rec, issues: [...rec.issues] });
      continue;
    }
    removed += 1;
    const [keep, drop] = completeness(existing) >= completeness(rec) ? [existing, rec] : [{ ...rec, issues: [...rec.issues] }, existing];
    for (const f of MERGE_FIELDS) if (!keep[f] && drop[f]) keep[f] = drop[f];
    keep.issues = [...new Set([...keep.issues, ...drop.issues, "duplicate_merged"])].filter((i) => !isResolved(i, keep)).sort();
    byKey.set(key, keep);
  }
  return { records: [...byKey.entries()].map(([id, record]) => ({ id, record })), removed };
}

function applyAiLabel<T extends string>(current: T, ai: string | undefined, allowed: (v: string) => boolean): { value: string; fromAi: boolean } {
  if (current === "Unknown" && ai && allowed(ai)) return { value: ai, fromAi: true };
  return { value: current, fromAi: false };
}

export function analyze(input: AnalysisInput): Analysis {
  const { dataset, profile, overrides, today } = input;
  const prepared = prepareTargeting(profile.targeting);
  const builder = new MessageBuilder(profile);
  const { records, removed } = dedupe(dataset.connections);
  const messageData = hasMessageData(dataset);

  const staged = records.map(({ id, record }) => {
    const name = cleanPersonName(record.firstName, record.lastName);
    const pos = cleanPosition(record.position);
    const co = cleanCompany(record.company);
    const email = cleanEmail(record.email);
    const url = cleanProfileUrl(record.profileUrl);
    const ai = input.aiClassifications[id];

    const sen = classifySeniority(pos.clean);
    const fn = classifyFunction(pos.clean);
    let industry = classifyIndustry(co.clean, co.key, fn.label, overrides);
    if (co.kind !== "company") {
      industry = co.kind === "freelance" ? { label: "Freelance / Self-employed", evidence: "self-employed" } : { label: "Unknown", evidence: "no real employer in the source" };
    }
    const seniority = applyAiLabel(sen.label, ai?.seniority, (v) => v in SENIORITY_RANK);
    const func = applyAiLabel(fn.label, ai?.function, (v) => v !== "Unknown");
    const ind = applyAiLabel(industry.label, ai?.industry, (v) => v !== "Unknown");
    const rank = SENIORITY_RANK[seniority.value as Seniority] ?? 0;
    const recruiter = isRecruiter(pos.clean) || (func.fromAi && func.value === "HR & Recruiting");
    const connectedDate = parseDate(record.connectedOn);
    const companyClean = co.kind === "company" ? co.clean : "";

    return {
      id,
      name,
      pos,
      email,
      url,
      companyClean,
      companyRaw: record.company,
      companyKey: co.kind === "company" ? co.key : "",
      seniority: seniority.value,
      rank,
      fn: func.value,
      allFunctions: fn.all,
      industry: ind.value,
      recruiter,
      connectedDate,
      aiClassified: seniority.fromAi || func.fromAi || ind.fromAi,
      evidence: `seniority[${seniority.fromAi ? "AI" : sen.evidence}]; function[${func.fromAi ? "AI" : fn.evidence}]; industry[${ind.fromAi ? "AI" : industry.evidence}]`,
      issues: record.issues,
    };
  });

  const counts = new Map<string, number>();
  for (const c of staged) if (c.companyKey) counts.set(c.companyKey, (counts.get(c.companyKey) ?? 0) + 1);

  const events: HistoryEvent[] = [...datasetEvents(dataset), ...logEvents(input.log)];
  for (const c of staged) {
    const t = input.tracking[c.id];
    if (t) events.push(...trackingEvents(c.url.slug, c.name.full, t));
  }
  const index = new HistoryIndex(events);
  const manual = manualDirections(dataset.messages, input.inbox ?? {});

  const contacts: Contact[] = staged.map((c) => {
    const { history: tracked, matchedBy } = index.lookup(c.url.slug, c.name.full);
    const direction = (c.url.slug ? manual.get(c.url.slug) : undefined) ?? manual.get(personKey(c.name.full));
    const history = direction ? { ...tracked, lastDirection: direction } : tracked;
    const { mode, advice, adviceAr } = outreachMode(history, today, messageData);
    const days = history.lastContact ? daysBetween(history.lastContact, today) : null;
    const before = contactedBefore(history);
    const score = scoreContact({
      seniority: c.seniority,
      seniorityRank: c.rank,
      function: c.fn,
      allFunctions: c.allFunctions.slice(1),
      industry: c.industry,
      companyKey: c.companyKey,
      companyClean: c.companyClean,
      emailValid: c.email.valid,
      connectedDate: c.connectedDate,
      companyContactCount: counts.get(c.companyKey) ?? 0,
      isRecruiter: c.recruiter,
      mode,
      daysSinceContact: days,
    }, prepared, today);
    const archetype = pickArchetype({
      isRecruiter: c.recruiter,
      seniority: c.seniority,
      seniorityRank: c.rank,
      function: c.fn,
      targetFunctions: profile.targeting.target_functions,
    });
    const gName = greetingName(c.name.first, c.name.full);
    const messages = builder.build({
      greetingName: gName,
      theirRole: c.pos.primary || c.pos.clean,
      company: c.companyClean,
      industry: c.industry,
      function: c.fn,
      archetype,
      mode,
      daysSince: days,
    });
    const ai = input.aiMessages[c.id];
    return {
      ...messages,
      id: c.id,
      idx: 0,
      firstName: c.name.first,
      lastName: c.name.last,
      fullName: c.name.full,
      greetingName: gName,
      profileUrl: c.url.url,
      slug: c.url.slug,
      email: c.email.email,
      emailValid: c.email.valid,
      companyClean: c.companyClean,
      companyRaw: c.companyRaw,
      companyKey: c.companyKey,
      industry: c.industry,
      positionClean: c.pos.clean,
      positionPrimary: c.pos.primary,
      seniority: c.seniority,
      seniorityRank: c.rank,
      function: c.fn,
      isRecruiter: c.recruiter,
      isDecisionMaker: isDecisionMaker(c.rank),
      connectedDate: c.connectedDate,
      yearsConnected: c.connectedDate ? Math.round((daysBetween(c.connectedDate, today) / 365.25) * 10) / 10 : null,
      country: countryFromSlug(c.url.slug),
      evidence: c.evidence,
      issues: c.issues,
      companyContactCount: counts.get(c.companyKey) ?? 0,
      history,
      contactedBefore: before,
      contactedBeforeText: before ? "Yes" : messageData ? "No - first contact" : "Unknown - no message data",
      historyMatch: matchedBy,
      daysSinceContact: days,
      outreachAdvice: advice,
      outreachAdviceAr: adviceAr,
      mode,
      modeLabel: MODE_LABEL[mode],
      archetype,
      archetypeLabel: ARCHETYPE_LABEL[archetype],
      score: score.score,
      bucket: score.bucket,
      scoreBreakdown: score.breakdown,
      tracking: input.tracking[c.id] ?? newTracking(),
      ai: ai && ai.mode === mode ? ai : null,
      aiClassified: c.aiClassified,
    };
  });

  contacts.sort((a, b) => b.score - a.score || (a.companyClean || "￿").localeCompare(b.companyClean || "￿") || a.fullName.localeCompare(b.fullName));
  contacts.forEach((c, i) => (c.idx = i + 1));

  const meta = dataset.importMeta;
  return {
    contacts,
    companies: aggregateCompanies(contacts),
    profileGaps: profileGaps(profile),
    quality: {
      sources: [meta.exportLabel, dataset.sync.lastSyncAt ? `LinkedIn sync ${dataset.sync.lastSyncAt}` : ""].filter(Boolean),
      headerFound: meta.headerFound,
      warnings: meta.warnings,
      rowsInFile: dataset.connections.length,
      skippedRows: meta.skippedRows,
      duplicatesRemoved: removed,
      historyFound: meta.filesFound,
      historyMissing: meta.filesMissing,
      ownerName: dataset.owner.name,
      identityMethod: dataset.owner.identityMethod,
      messagesTotal: dataset.messages.length,
      invitationsTotal: dataset.invitations.length,
      logTotal: input.log.length,
      trackedTotal: contacts.filter((c) => c.tracking.status !== EMPTY_TRACKING.status || c.tracking.notes || c.tracking.tags.length > 0).length,
    },
  };
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export function aggregateCompanies(contacts: Contact[]): CompanyRow[] {
  const groups = new Map<string, Contact[]>();
  for (const c of contacts) {
    if (!c.companyKey) continue;
    const list = groups.get(c.companyKey);
    if (list) list.push(c);
    else groups.set(c.companyKey, [c]);
  }
  const rows: CompanyRow[] = [];
  for (const [key, members] of groups) {
    const top = [...members].sort((a, b) => b.seniorityRank - a.seniorityRank || b.score - a.score)[0]!;
    const fnCounts = new Map<string, number>();
    for (const m of members) fnCounts.set(m.function, (fnCounts.get(m.function) ?? 0) + 1);
    rows.push({
      key,
      name: mostCommon(members.map((m) => m.companyClean)),
      industry: mostCommon(members.map((m) => m.industry)),
      count: members.length,
      bestScore: Math.max(...members.map((m) => m.score)),
      avgScore: Math.round((members.reduce((s, m) => s + m.score, 0) / members.length) * 10) / 10,
      topSeniority: top.seniority,
      topContact: top.fullName,
      topRole: top.positionPrimary || top.positionClean,
      hasRecruiter: members.some((m) => m.isRecruiter),
      decisionMakers: members.filter((m) => m.isDecisionMaker).length,
      functions: [...fnCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => `${f} (${n})`).join(", "),
      emails: members.filter((m) => m.emailValid).length,
    });
  }
  return rows.sort((a, b) => b.bestScore - a.bestScore || b.count - a.count || a.name.localeCompare(b.name));
}
