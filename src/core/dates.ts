const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12,
};

const DAY_MS = 86_400_000;

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

function fullYear(value: string): number {
  const n = Number(value);
  return value.length === 2 ? (n >= 70 ? 1900 + n : 2000 + n) : n;
}

function month(name: string): number {
  return MONTHS[name.toLowerCase()] ?? 0;
}

export function parseDate(value: string, dayFirst = true): string | null {
  const v = (value || "").replace(/\s+/g, " ").trim().replace(/\s*(UTC|GMT|Z)$/i, "");
  if (!v) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(v);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2}|\d{4})$/.exec(v);
  if (m) return iso(fullYear(m[3]!), month(m[2]!), Number(m[1]));

  m = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})(?:,.*)?$/.exec(v);
  if (m) return iso(Number(m[3]), month(m[1]!), Number(m[2]));

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,? .*)?$/.exec(v);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(m[3]!);
    const withTime = /[ap]m$/i.test(v) || v.includes(",");
    const monthFirst = withTime || !dayFirst || b > 12;
    return monthFirst ? iso(y, a, b) ?? iso(y, b, a) : iso(y, b, a) ?? iso(y, a, b);
  }

  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /(?:19|20)\d{2}-\d{2}-\d{2}/.exec(v);
  if (m) return parseDate(m[0]);

  m = /(?:19|20)\d{2}/.exec(v);
  if (m) return iso(Number(m[0]), 1, 1);
  return null;
}

export function todayIso(): string {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate()) ?? now.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

