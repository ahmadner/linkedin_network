import { REPLIED_STATUSES, SENT_STATUSES } from "./history";
import type { Contact, StoredMessage } from "./types";

export interface MonthPoint {
  month: string;
  added: number;
  total: number;
}

export interface ActivityPoint {
  month: string;
  sent: number;
  received: number;
}

export interface ReplyStats {
  messaged: number;
  replied: number;
  rate: number;
}

const MONTH_RE = /^\d{4}-\d{2}/;

export function countBy<T>(items: T[], key: (item: T) => string, limit = Infinity): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item) || "Unknown";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const endY = Number(last.slice(0, 4));
  const endM = Number(last.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function networkGrowth(contacts: Contact[], lastMonths = 36): MonthPoint[] {
  const perMonth = new Map<string, number>();
  for (const c of contacts) {
    if (!c.connectedDate || !MONTH_RE.test(c.connectedDate)) continue;
    const month = c.connectedDate.slice(0, 7);
    perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }
  if (perMonth.size === 0) return [];
  const months = [...perMonth.keys()].sort();
  const all = monthsBetween(months[0]!, months[months.length - 1]!);
  let total = 0;
  const points = all.map((month) => {
    const added = perMonth.get(month) ?? 0;
    total += added;
    return { month, added, total };
  });
  return points.slice(-lastMonths);
}

export function messageActivity(messages: StoredMessage[], lastMonths = 18): ActivityPoint[] {
  const perMonth = new Map<string, ActivityPoint>();
  for (const m of messages) {
    if (!MONTH_RE.test(m.at)) continue;
    const month = m.at.slice(0, 7);
    let point = perMonth.get(month);
    if (!point) {
      point = { month, sent: 0, received: 0 };
      perMonth.set(month, point);
    }
    if (m.outgoing) point.sent += 1;
    else point.received += 1;
  }
  if (perMonth.size === 0) return [];
  const months = [...perMonth.keys()].sort();
  return monthsBetween(months[0]!, months[months.length - 1]!)
    .map((month) => perMonth.get(month) ?? { month, sent: 0, received: 0 })
    .slice(-lastMonths);
}

export function replyStats(contacts: Contact[]): ReplyStats {
  let messaged = 0;
  let replied = 0;
  for (const c of contacts) {
    if (c.history.sentByMe === 0 && !SENT_STATUSES.has(c.tracking.status)) continue;
    messaged += 1;
    if (c.history.received > 0 || c.tracking.replied === "Yes" || REPLIED_STATUSES.has(c.tracking.status)) replied += 1;
  }
  return { messaged, replied, rate: messaged > 0 ? Math.round((replied / messaged) * 100) : 0 };
}
