import { asRecord } from "../core/profile";
import { cleanProfileUrl } from "../core/text";
import { normalizeReplied, normalizeStatus, REPLIED_AR, STATUS_AR, STATUSES } from "../core/tracking";
import type { LogEntry, Profile } from "../core/types";
import { cell, tableFrom, toCsv } from "./csv";
import { sanitizeLog } from "./state";

export const EXAMPLE_SLUG = "example-person";
export const EXAMPLE_URL = `https://www.linkedin.com/in/${EXAMPLE_SLUG}`;
const MAX_ISSUES = 50;
const ISO_DATE = "\u20662026-11-20\u2069";
const DMY_DATE = "\u206620/11/2026\u2069";

export interface ImportIssue {
  row: number;
  message: string;
}

export interface ImportResult<T> {
  items: T;
  issues: ImportIssue[];
  skipped: number;
  error: string;
}

export interface FieldGuide {
  header: string;
  required: boolean;
  help: string;
  example: string;
}

export const LOG_FIELDS: FieldGuide[] = [
  { header: "full_name", required: true, help: "اسم الشخص زي ما هو على LinkedIn. ضروري إذا ما في رابط.", example: "Example Person" },
  { header: "profile_url", required: true, help: "رابط بروفايله على LinkedIn. أدق طريقة للربط. ضروري إذا ما في اسم.", example: EXAMPLE_URL },
  { header: "channel", required: false, help: "وين حكيتوا: email أو whatsapp أو phone أو meeting أو أي كلمة.", example: "email" },
  { header: "direction", required: false, help: "sent إذا انت بعتت، و received إذا هو بعتلك. إذا فاضي بتنحسب sent.", example: "sent" },
  { header: "sent_at", required: false, help: `التاريخ بصيغة ${ISO_DATE} أو ${DMY_DATE}.`, example: "2026-11-20" },
  { header: "note", required: false, help: "ملاحظة قصيرة عن التواصل.", example: "بعتت السيرة الذاتية على إيميل الشركة" },
];

export const TRACKING_FIELDS: FieldGuide[] = [
  { header: "Full Name", required: false, help: "للتوضيح بس. الربط بيصير بالرابط.", example: "Example Person" },
  { header: "LinkedIn Profile", required: true, help: "رابط البروفايل. هو اللي بيربط السطر بالشخص.", example: EXAMPLE_URL },
  { header: "Status", required: false, help: `وحدة من: ${STATUSES.map((s) => `${s} (${STATUS_AR[s]})`).join("، ")}. بتقبل العربي كمان.`, example: "Message sent" },
  { header: "Date Sent", required: false, help: `تاريخ الإرسال بصيغة ${ISO_DATE} أو ${DMY_DATE}.`, example: "2026-11-20" },
  { header: "Replied?", required: false, help: `وحدة من: ${Object.entries(REPLIED_AR).map(([k, v]) => `${k} (${v})`).join("، ")}.`, example: "Pending" },
  { header: "Next Step", required: false, help: "شو الخطوة الجاية معه.", example: "ابعتله تذكير الأسبوع الجاي" },
  { header: "Notes", required: false, help: "أي ملاحظات.", example: "مهتم بخبرة Java" },
  { header: "Tags", required: false, help: "وسوم مفصولة بفاصلة.", example: "fintech, recruiter" },
];

export const PROFILE_FIELDS: FieldGuide[] = [
  { header: "me.full_name / me.first_name", required: true, help: "اسمك بالإنجليزي، والاسم الأول للتوقيع.", example: "Ahmad Nueirat" },
  { header: "me.full_name_ar / me.first_name_ar", required: false, help: "اسمك بالعربي زي ما بدك ينكتب بالرسائل.", example: "أحمد" },
  { header: "me.current_role / me.target_roles", required: true, help: "منصبك الحالي، والوظائف اللي بتدور عليها (قائمة).", example: "Backend Engineer" },
  { header: "me.top_skills", required: true, help: "أهم مهاراتك (قائمة). أول 3 بيطلعوا بالرسائل.", example: "Java, Spring Boot" },
  { header: "targeting.goal", required: false, help: "job_search أو sales أو partnership أو networking.", example: "job_search" },
  { header: "targeting.target_companies", required: false, help: "شركات أحلامك (قائمة).", example: "Microsoft" },
];

function issueAdder(issues: ImportIssue[]): (row: number, message: string) => void {
  return (row, message) => {
    if (issues.length < MAX_ISSUES) issues.push({ row, message });
  };
}

export function normalizeDate(value: string): string | null {
  const v = value.trim();
  if (!v) return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date.toISOString().slice(0, 10);
}

function isExample(url: string): boolean {
  return cleanProfileUrl(url).slug === EXAMPLE_SLUG;
}

export function logTemplateCsv(): string {
  return toCsv(LOG_FIELDS.map((f) => f.header), [LOG_FIELDS.map((f) => f.example)]);
}

const INBOUND = /^(in|incoming|inbound|received|receive|reply|replied|response|responded|them|from them|واصل|وصل|وصلني|رد|ورد|منهم|منه|استلمت)$/i;
const OUTBOUND = /^(|out|outgoing|outbound|sent|send|me|to them|بعتت|بعت|أرسلت|ارسلت|مني)$/i;

export function parseLogCsv(text: string): ImportResult<LogEntry[]> {
  const table = tableFrom(text, (c) => c.includes("full_name") || c.includes("profile_url"));
  if (!table) return { items: [], issues: [], skipped: 0, error: `ما لقيت عناوين الأعمدة. أول سطر لازم يكون: ${LOG_FIELDS.map((f) => f.header).join(", ")}. نزّل القالب وعبّي فيه.` };
  const issues: ImportIssue[] = [];
  const add = issueAdder(issues);
  const items: LogEntry[] = [];
  let skipped = 0;
  let examples = 0;
  const col = (name: string): number => table.column(name);
  table.rows.forEach((r, i) => {
    const row = table.rowNumbers[i] ?? i + 2;
    const name = cell(r, col("full_name")).trim();
    const url = cell(r, col("profile_url")).trim();
    if (url && isExample(url)) {
      examples += 1;
      return;
    }
    if (!name && !url) {
      skipped += 1;
      add(row, "ما في اسم ولا رابط، فتجاهلته.");
      return;
    }
    const { slug, url: clean } = cleanProfileUrl(url);
    if (url && !slug) add(row, `الرابط "${url.slice(0, 60)}" مش رابط بروفايل LinkedIn. رح أربط بالاسم بس.`);
    const direction = cell(r, col("direction")).trim().toLowerCase().replace(/[\s_-]+/g, " ");
    const inbound = INBOUND.test(direction) || /^(in|rec|repl|resp|from)/.test(direction);
    if (!inbound && !OUTBOUND.test(direction)) add(row, `الاتجاه "${direction}" مش مفهوم. اعتبرته sent.`);
    const rawDate = cell(r, col("sent_at"));
    const date = normalizeDate(rawDate);
    if (date === null) add(row, `التاريخ "${rawDate}" مش بصيغة صحيحة. استعمل ${ISO_DATE}.`);
    items.push(sanitizeLog({ profileUrl: slug ? clean : "", fullName: name, channel: cell(r, col("channel")).trim(), outgoing: !inbound, sentAt: date ?? "", note: cell(r, col("note")).trim() }));
  });
  const empty = items.length === 0 && issues.length === 0 && skipped === 0;
  return { items, issues, skipped, error: !empty ? "" : examples > 0 ? "الملف فيه بس سطر المثال. ضيف بياناتك تحته وارفعه مرة ثانية." : "الملف ما فيه ولا سطر بيانات." };
}

export type TrackingValues = Record<string, string>;

const TRACKING_KEYS: Record<string, string> = { Status: "status", "Date Sent": "dateSent", "Replied?": "replied", "Next Step": "nextStep", Notes: "notes", Tags: "tags" };

export function parseTrackingRows(header: string[], rows: string[][]): ImportResult<Map<string, TrackingValues>> {
  const items = new Map<string, TrackingValues>();
  const urlIdx = header.indexOf("LinkedIn Profile");
  if (urlIdx < 0) return { items, issues: [], skipped: 0, error: "ما لقيت عمود \"LinkedIn Profile\" بأول سطر. نزّل القالب وعبّي فيه بدون ما تغيّر العناوين." };
  const issues: ImportIssue[] = [];
  const add = issueAdder(issues);
  let skipped = 0;
  rows.forEach((r, i) => {
    const row = i + 2;
    const url = (r[urlIdx] ?? "").trim();
    if (!url) {
      if (r.some((c) => c.trim())) {
        skipped += 1;
        add(row, "ما في رابط بروفايل، فتجاهلته.");
      }
      return;
    }
    if (isExample(url)) return;
    const { slug } = cleanProfileUrl(url);
    if (!slug) {
      skipped += 1;
      add(row, `الرابط "${url.slice(0, 60)}" مش رابط بروفايل LinkedIn.`);
      return;
    }
    const values: TrackingValues = {};
    for (const [h, key] of Object.entries(TRACKING_KEYS)) {
      const idx = header.indexOf(h);
      const raw = idx >= 0 ? (r[idx] ?? "").trim() : "";
      if (!raw) continue;
      if (key === "status") {
        const status = normalizeStatus(raw);
        if (status) values.status = status;
        else add(row, `الحالة "${raw}" مش معروفة، فما غيرتها.`);
      } else if (key === "replied") {
        const replied = normalizeReplied(raw);
        if (replied) values.replied = replied;
        else add(row, `قيمة "Replied?" "${raw}" مش معروفة. استعمل Yes أو No أو Pending.`);
      } else if (key === "dateSent") {
        const date = normalizeDate(raw);
        if (date) values.dateSent = date;
        else add(row, `التاريخ "${raw}" مش بصيغة صحيحة. استعمل ${ISO_DATE}.`);
      } else values[key] = raw;
    }
    const keys = Object.keys(values);
    if (keys.length === 0 || (keys.length === 1 && values.status === "Not started")) return;
    items.set(`slug:${slug}`, values);
  });
  return { items, issues, skipped, error: "" };
}

export function profileTemplateJson(profile: Profile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

export function parseProfileJson(text: string): ImportResult<unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    const at = error instanceof SyntaxError ? /line (\d+) column (\d+)/.exec(error.message) : null;
    const where = at ? ` (سطر ${at[1]}، عمود ${at[2]})` : "";
    return { items: null, issues: [], skipped: 0, error: `الملف مش JSON صالح${where}. انتبه للفواصل وعلامات التنصيص، أو نزّل القالب وعدّل عليه.` };
  }
  const root = asRecord(parsed);
  if (!("me" in root) && !("targeting" in root) && !("messaging" in root)) {
    return { items: null, issues: [], skipped: 0, error: "الملف ما فيه أي قسم معروف (me أو targeting أو messaging). نزّل القالب وعدّل عليه." };
  }
  const issues: ImportIssue[] = [];
  const known = new Set(["me", "targeting", "messaging"]);
  for (const key of Object.keys(root)) if (!known.has(key)) issues.push({ row: 0, message: `القسم "${key}" مش معروف، فتجاهلته.` });
  return { items: parsed, issues, skipped: 0, error: "" };
}
