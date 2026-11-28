import type { Worksheet } from "exceljs";
import { MESSAGE_STATUS_LABEL, type InboxItem } from "../core/inbox";
import type { Analysis, CompanyRow, Contact, MessageSet, Profile } from "../core/types";
import { STATUSES, REPLIED_VALUES } from "../core/tracking";
import { toCsv } from "./csv";
import { parseTrackingRows, TRACKING_FIELDS, type ImportResult, type TrackingValues } from "./imports";

export const TRACKING_SHEET = "Connections";

type Getter<T> = (row: T) => string | number | Date | null;
export type Column<T> = [header: string, get: Getter<T>, width: number];

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const dateOf = (iso: string | null): Date | null => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const yes = (v: boolean): string => (v ? "Yes" : "No");

export const CONNECTION_COLUMNS: Array<Column<Contact>> = [
  ["#", (c) => c.idx, 5],
  ["Priority", (c) => c.bucket, 9],
  ["Score", (c) => c.score, 7],
  ["Full Name", (c) => c.fullName, 24],
  ["First Name", (c) => c.firstName, 14],
  ["Last Name", (c) => c.lastName, 14],
  ["LinkedIn Profile", (c) => c.profileUrl, 34],
  ["Email", (c) => c.email, 26],
  ["Email Valid", (c) => yes(c.emailValid), 11],
  ["Company", (c) => c.companyClean, 28],
  ["Company Key", (c) => c.companyKey, 22],
  ["Industry", (c) => c.industry, 26],
  ["Position (raw)", (c) => c.positionClean, 36],
  ["Position (primary)", (c) => c.positionPrimary, 28],
  ["Seniority", (c) => c.seniority, 20],
  ["Rank", (c) => c.seniorityRank, 7],
  ["Function", (c) => c.function, 24],
  ["Outreach Archetype", (c) => c.archetypeLabel, 26],
  ["Recruiter?", (c) => yes(c.isRecruiter), 11],
  ["Decision Maker?", (c) => yes(c.isDecisionMaker), 15],
  ["Connected On", (c) => dateOf(c.connectedDate), 13],
  ["Years Connected", (c) => c.yearsConnected, 14],
  ["Contacts @ Company", (c) => c.companyContactCount, 17],
  ["Country (if in URL)", (c) => c.country, 16],
  ["Score Breakdown", (c) => c.scoreBreakdown, 46],
  ["Classification Evidence", (c) => c.evidence, 40],
  ["Data Issues", (c) => c.issues.join(", "), 24],
  ["Contacted Before?", (c) => c.contactedBeforeText, 15],
  ["Outreach Mode", (c) => c.modeLabel, 24],
  ["Msgs I Sent", (c) => c.history.sentByMe, 11],
  ["Msgs Received", (c) => c.history.received, 13],
  ["They Ever Replied?", (c) => yes(c.history.received > 0), 16],
  ["Last Contact", (c) => dateOf(c.history.lastContact), 13],
  ["Days Since", (c) => c.daysSinceContact, 11],
  ["Last Direction", (c) => c.history.lastDirection, 14],
  ["Invite Sent?", (c) => yes(c.history.invitationSent), 12],
  ["Channels Used", (c) => c.history.channels.join(", "), 18],
  ["History Matched By", (c) => c.historyMatch, 17],
  ["Outreach Advice", (c) => c.outreachAdvice, 54],
  ["Status", (c) => c.tracking.status, 14],
  ["Date Sent", (c) => c.tracking.dateSent, 12],
  ["Replied?", (c) => c.tracking.replied, 10],
  ["Next Step", (c) => c.tracking.nextStep, 18],
  ["Notes", (c) => c.tracking.notes, 30],
  ["Tags", (c) => c.tracking.tags.join(", "), 24],
];

const msg = (c: Contact, key: keyof MessageSet): string => (c.ai ?? c)[key];

export const MESSAGE_COLUMNS: Array<Column<Contact>> = [
  ["#", (c) => c.idx, 5],
  ["Priority", (c) => c.bucket, 9],
  ["Full Name", (c) => c.fullName, 22],
  ["Company", (c) => c.companyClean, 24],
  ["Position (primary)", (c) => c.positionPrimary, 26],
  ["Archetype", (c) => c.archetypeLabel, 24],
  ["Contacted Before?", (c) => c.contactedBeforeText, 14],
  ["Outreach Mode", (c) => c.modeLabel, 23],
  ["Written By", (c) => (c.ai ? `AI (${c.ai.model})` : "Rules"), 14],
  ["Short DM - AR", (c) => msg(c, "note_ar"), 46],
  ["len", (c) => msg(c, "note_ar").length, 6],
  ["Short DM - EN", (c) => msg(c, "note_en"), 46],
  ["len", (c) => msg(c, "note_en").length, 6],
  ["Message - AR", (c) => msg(c, "message_ar"), 62],
  ["Message - EN", (c) => msg(c, "message_en"), 62],
  ["Follow-up - AR", (c) => msg(c, "followup_ar"), 40],
  ["Follow-up - EN", (c) => msg(c, "followup_en"), 40],
];

export const COMPANY_COLUMNS: Array<Column<CompanyRow>> = [
  ["Company", (r) => r.name, 32],
  ["Industry", (r) => r.industry, 26],
  ["Contacts", (r) => r.count, 10],
  ["Best Score", (r) => r.bestScore, 11],
  ["Avg Score", (r) => r.avgScore, 10],
  ["Highest Seniority", (r) => r.topSeniority, 20],
  ["Best Entry Point", (r) => r.topContact, 30],
  ["Their Role", (r) => r.topRole, 30],
  ["Has Recruiter?", (r) => yes(r.hasRecruiter), 14],
  ["Decision Makers", (r) => r.decisionMakers, 15],
  ["Functions Present", (r) => r.functions, 42],
  ["Emails on File", (r) => r.emails, 14],
];

export const CONTACT_EXPORT_COLUMNS: Array<Column<Contact>> = [...CONNECTION_COLUMNS, ...MESSAGE_COLUMNS.slice(8)];

export const INBOX_COLUMNS: Array<Column<InboxItem>> = [
  ["Date", (i) => i.message.at.slice(0, 16).replace("T", " "), 18],
  ["Direction", (i) => (i.message.outgoing ? "Sent" : "Received"), 11],
  ["Status", (i) => MESSAGE_STATUS_LABEL[i.status], 16],
  ["People", (i) => i.counterpart.map((p) => p.name || p.slug).join(", "), 28],
  ["Profile", (i) => i.counterpart.filter((p) => p.slug).map((p) => `https://www.linkedin.com/in/${p.slug}`).join(" "), 34],
  ["Message", (i) => i.message.content, 80],
  ["Thread", (i) => i.thread, 40],
];

export function rowsCsv<T>(cols: Array<Column<T>>, rows: T[]): string {
  return toCsv(
    cols.map(([header]) => header),
    rows.map((row) => cols.map(([, get]) => {
      const v = get(row);
      return v instanceof Date ? v.toISOString().slice(0, 10) : v;
    })),
  );
}

const NAVY = "FF1F3864";
const BUCKET_FILL: Record<string, string> = { A: "FFC6EFCE", B: "FFFFF2CC", C: "FFFCE4D6", D: "FFEDEDED", X: "FFE0E0E0" };
const REFERENCE: Array<[string, string]> = [
  ["Sources", "LinkedIn's official data export for the full history, plus the browser extension for anything added since the last sync. Both read only your own data."],
  ["Seniority", "Rule-based reading of the job title, highest authority first (Founder/Owner > C-Level > VP > Director > Head > Manager > Team Lead > Senior IC > Consultant > Mid IC > Junior > Intern > Student). 'Product/Project/Account Manager' are treated as individual contributors."],
  ["Function", "Scored keyword matching over the title in English and Arabic; the strongest match wins."],
  ["Industry", "Derived from the employer name and a list of known employers; anything unclear stays Unknown. Company overrides always win. With an OpenAI key, Unknown labels can be filled by AI and are marked AI in the evidence column."],
  ["Priority score", "A transparent weighted sum (recruiter, decision maker in a target function, seniority, target company/industry/function, email, recency, contacts at the company) minus penalties for students, missing company and people already contacted. See Score Breakdown."],
  ["Outreach mode", "Cold = no trace of previous contact. Reconnect = you spoke before. Nudge = you wrote and never got a reply, so only one short reminder."],
  ["Messages", "Rule-based messages combine an archetype with an industry angle. When AI messages exist for the current mode they replace the rule-based ones in this sheet (see Written By)."],
  ["Tracking", "Status, Date Sent, Replied, Next Step, Notes and Tags are kept in the saved state file and feed back into the outreach mode."],
];

export async function buildWorkbook(analysis: Analysis, profile: Profile): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  type Sheet = Worksheet;

  const decorateContacts = (ws: Sheet, rows: Contact[]): void => {
    const urlCol = CONNECTION_COLUMNS.findIndex(([h]) => h === "LinkedIn Profile") + 1;
    const statusCol = CONNECTION_COLUMNS.findIndex(([h]) => h === "Status") + 1;
    const repliedCol = CONNECTION_COLUMNS.findIndex(([h]) => h === "Replied?") + 1;
    rows.forEach((c, i) => {
      const r = ws.getRow(i + 2);
      const bucket = r.getCell(2);
      bucket.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BUCKET_FILL[c.bucket] ?? "FFFFFFFF" } };
      bucket.font = { bold: true };
      if (c.profileUrl.startsWith("https://www.linkedin.com/")) {
        r.getCell(urlCol).value = { text: c.profileUrl, hyperlink: c.profileUrl };
        r.getCell(urlCol).font = { color: { argb: "FF0563C1" }, underline: true };
      }
      r.getCell(statusCol).dataValidation = { type: "list", allowBlank: true, formulae: ['"Not started,Note sent,Message sent,Follow-up sent,Replied,Meeting booked,Referred,Closed - no fit"'] };
      r.getCell(repliedCol).dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No,Pending"'] };
    });
  };

  const { contacts, companies, quality } = analysis;
  const dash = wb.addWorksheet("Dashboard");
  dash.getCell("A1").value = "LinkedIn Network Analysis";
  dash.getCell("A1").font = { bold: true, size: 16, color: { argb: NAVY } };
  dash.getCell("A2").value = `Generated ${new Date().toISOString().slice(0, 10)}${profile.me.full_name ? ` | ${profile.me.full_name}` : ""}`;
  const kpis: Array<[string, number]> = [
    ["Total connections", contacts.length],
    ["Priority A", contacts.filter((c) => c.bucket === "A").length],
    ["Priority B", contacts.filter((c) => c.bucket === "B").length],
    ["No message yet", contacts.filter((c) => c.mode === "cold").length],
    ["Contacted before", contacts.filter((c) => c.contactedBefore).length],
    ["Awaiting reply", contacts.filter((c) => c.mode === "nudge").length],
    ["Recruiters / HR", contacts.filter((c) => c.isRecruiter).length],
    ["Decision makers", contacts.filter((c) => c.isDecisionMaker).length],
    ["Companies", companies.length],
    ["Emails on file", contacts.filter((c) => c.emailValid).length],
  ];
  kpis.forEach(([label, value], i) => {
    dash.getCell(4 + i, 1).value = label;
    dash.getCell(4 + i, 2).value = value;
    dash.getCell(4 + i, 2).font = { bold: true, size: 14, color: { argb: NAVY } };
  });
  dash.getColumn(1).width = 24;
  dash.getColumn(2).width = 12;
  const breakdown = (title: string, col: number, values: string[]): void => {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v || "Unknown", (counts.get(v || "Unknown") ?? 0) + 1);
    dash.getCell(3, col).value = title;
    dash.getCell(3, col).font = { bold: true };
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, n], i) => {
      dash.getCell(4 + i, col).value = k;
      dash.getCell(4 + i, col + 1).value = n;
    });
    dash.getColumn(col).width = 28;
  };
  breakdown("By Seniority", 4, contacts.map((c) => c.seniority));
  breakdown("By Function", 7, contacts.map((c) => c.function));
  breakdown("By Industry", 10, contacts.map((c) => c.industry));
  breakdown("Contact Status", 13, contacts.map((c) => c.modeLabel));

  const shortlist = contacts.filter((c) => c.bucket === "A");
  const priority = shortlist.length > 0 ? shortlist : contacts.slice(0, 50);
  const wsA = wb.addWorksheet("Priority_A");
  table(wsA, CONNECTION_COLUMNS, priority, { x: 4, y: 1 });
  decorateContacts(wsA, priority);

  const wsAll = wb.addWorksheet("Connections");
  table(wsAll, CONNECTION_COLUMNS, contacts, { x: 4, y: 1 });
  decorateContacts(wsAll, contacts);

  const wsMsg = wb.addWorksheet("Messages");
  table(wsMsg, MESSAGE_COLUMNS, contacts, { x: 3, y: 1 });
  MESSAGE_COLUMNS.forEach(([header], i) => {
    if (header.endsWith("- AR")) wsMsg.getColumn(i + 1).alignment = { horizontal: "right", vertical: "top", wrapText: true, readingOrder: "rtl" };
    else if (header.startsWith("Message") || header.startsWith("Short") || header.startsWith("Follow")) wsMsg.getColumn(i + 1).alignment = { vertical: "top", wrapText: true };
  });
  const limit = profile.messaging.note_char_limit;
  MESSAGE_COLUMNS.forEach(([header], i) => {
    if (header !== "len" || contacts.length === 0) return;
    const letter = wsMsg.getColumn(i + 1).letter;
    wsMsg.addConditionalFormatting({
      ref: `${letter}2:${letter}${contacts.length + 1}`,
      rules: [{ type: "cellIs", operator: "greaterThan", formulae: [String(limit)], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } }, font: { color: { argb: "FF9C0006" }, bold: true } } }],
    });
  });

  table(wb.addWorksheet("Companies"), COMPANY_COLUMNS, companies, { x: 1, y: 1 });

  const dq = wb.addWorksheet("Data_Quality");
  dq.columns = [{ width: 36 }, { width: 90 }];
  const dqRows: Array<[string, string | number]> = [
    ["Sources", quality.sources.join("; ") || "none"],
    ["Header detected", quality.headerFound.join(", ")],
    ["Notes", quality.warnings.join("; ")],
    ["Connection rows (all sources)", quality.rowsInFile],
    ["Empty rows skipped", quality.skippedRows],
    ["Duplicates merged", quality.duplicatesRemoved],
    ["Contacts in report", contacts.length],
    ["History files found", quality.historyFound.join(", ") || "none"],
    ["History files missing", quality.historyMissing.join(", ") || "none"],
    ["Account owner", `${quality.ownerName || "unknown"} (via ${quality.identityMethod})`],
    ["Messages", quality.messagesTotal],
    ["Invitations", quality.invitationsTotal],
    ["Manual log entries", quality.logTotal],
    ["Contacts with tracking", quality.trackedTotal],
    ["History matched by profile URL", contacts.filter((c) => c.historyMatch === "profile URL").length],
    ["History matched by name only", contacts.filter((c) => c.historyMatch === "name match").length],
    ["Missing company", contacts.filter((c) => !c.companyClean).length],
    ["Missing position", contacts.filter((c) => !c.positionClean).length],
    ["Missing / invalid email", contacts.filter((c) => !c.emailValid).length],
    ["Seniority unresolved", contacts.filter((c) => c.seniority === "Unknown").length],
    ["Function unresolved", contacts.filter((c) => c.function === "Unknown").length],
    ["Industry unresolved", contacts.filter((c) => c.industry === "Unknown").length],
    ["Labels filled by AI", contacts.filter((c) => c.aiClassified).length],
  ];
  dqRows.forEach(([k, v]) => {
    const row = dq.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });

  const ref = wb.addWorksheet("Reference");
  ref.columns = [{ width: 30 }, { width: 110 }];
  for (const [k, v] of REFERENCE) {
    const row = ref.addRow([k, v]);
    row.getCell(1).font = { bold: true, color: { argb: NAVY } };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function table<T>(ws: Worksheet, cols: Array<Column<T>>, rows: T[], freeze: { x: number; y: number }): void {
  ws.columns = cols.map(([header, , width]) => ({ header, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  head.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  head.height = 30;
  for (const row of rows) ws.addRow(cols.map(([, get]) => get(row)));
  ws.views = [{ state: "frozen", xSplit: freeze.x, ySplit: freeze.y }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: cols.length } };
  cols.forEach(([, get], i) => {
    if (rows.some((row) => get(row) instanceof Date)) ws.getColumn(i + 1).numFmt = "yyyy-mm-dd";
  });
}

export async function rowsWorkbook<T>(sheetName: string, cols: Array<Column<T>>, rows: T[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  table(wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1"), cols, rows, { x: 1, y: 1 });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function cellText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object") {
    const v = value as { text?: unknown; result?: unknown; richText?: Array<{ text: string }>; hyperlink?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
    if (typeof v.hyperlink === "string") return v.hyperlink;
    return "";
  }
  return value === null || value === undefined ? "" : String(value);
}

export async function readTrackingWorkbook(buffer: ArrayBuffer): Promise<ImportResult<Map<string, TrackingValues>>> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { items: new Map(), issues: [], skipped: 0, error: "الملف مش ملف Excel (xlsx) صالح." };
  }
  const ws = wb.getWorksheet(TRACKING_SHEET) ?? wb.worksheets.find((w) => (w.getRow(1).values as unknown[]).some((v) => cellText(v).trim() === "LinkedIn Profile"));
  if (!ws) return { items: new Map(), issues: [], skipped: 0, error: `ما لقيت ورقة "${TRACKING_SHEET}" ولا ورقة فيها عمود "LinkedIn Profile". نزّل القالب وعبّي فيه.` };
  const width = ws.columnCount;
  const read = (n: number): string[] => Array.from({ length: width }, (_, i) => cellText(ws.getRow(n).getCell(i + 1).value));
  const header = read(1).map((v) => v.trim());
  const rows: string[][] = [];
  for (let n = 2; n <= ws.rowCount; n += 1) rows.push(read(n));
  return parseTrackingRows(header, rows);
}

export async function trackingTemplateWorkbook(contacts: Contact[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(TRACKING_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = TRACKING_FIELDS.map((f) => ({ header: f.header, key: f.header, width: f.header === "LinkedIn Profile" ? 42 : f.header === "Notes" || f.header === "Next Step" ? 34 : 18 }));
  ws.getRow(1).font = { bold: true };
  const rows = contacts.length > 0
    ? contacts.map((c) => [c.fullName, c.profileUrl, c.tracking.status, c.tracking.dateSent, c.tracking.replied, c.tracking.nextStep, c.tracking.notes, c.tracking.tags.join(", ")])
    : [TRACKING_FIELDS.map((f) => f.example)];
  ws.addRows(rows);
  const last = Math.max(rows.length + 1, 500);
  const statusList = `"${STATUSES.join(",")}"`;
  const repliedList = `"${REPLIED_VALUES.join(",")}"`;
  for (let n = 2; n <= last; n += 1) {
    ws.getCell(n, 3).dataValidation = { type: "list", allowBlank: true, formulae: [statusList], showErrorMessage: false };
    ws.getCell(n, 5).dataValidation = { type: "list", allowBlank: true, formulae: [repliedList], showErrorMessage: false };
  }
  const guide = wb.addWorksheet("اقرأني", { views: [{ rightToLeft: true }] });
  guide.columns = [{ header: "العمود", width: 22 }, { header: "ضروري؟", width: 10 }, { header: "شو تكتب", width: 90 }, { header: "مثال", width: 34 }];
  guide.getRow(1).font = { bold: true };
  guide.addRows(TRACKING_FIELDS.map((f) => [f.header, f.required ? "نعم" : "لا", f.help, f.example]));
  guide.addRow([]);
  guide.addRow(["ملاحظة", "", "لا تغيّر أسماء الأعمدة بأول سطر. السطر اللي رابطه example-person مثال وبيتجاهله النظام. الأشخاص اللي حالتهم Not started وما في إلهم بيانات ثانية بيتجاهلوا."]);
  guide.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
