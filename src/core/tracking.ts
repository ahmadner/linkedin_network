export const STATUSES = ["Not started", "Note sent", "Message sent", "Follow-up sent", "Replied", "Meeting booked", "Referred", "Closed - no fit"] as const;

export const STATUS_AR: Record<string, string> = {
  "Not started": "ما بلشت",
  "Note sent": "بعتت دعوة",
  "Message sent": "بعتت رسالة",
  "Follow-up sent": "بعتت متابعة",
  Replied: "ردّ",
  "Meeting booked": "في موعد",
  Referred: "رشّحني",
  "Closed - no fit": "مسكّر",
};

export const REPLIED_VALUES = ["Yes", "No", "Pending"] as const;

export const REPLIED_AR: Record<string, string> = { Yes: "نعم", No: "لا", Pending: "بانتظار" };

const key = (v: string): string => v.trim().toLowerCase().replace(/\s+/g, " ");

function lookup(values: readonly string[], arabic: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of values) {
    map.set(key(v), v);
    const ar = arabic[v];
    if (ar) map.set(key(ar), v);
  }
  return map;
}

const STATUS_LOOKUP = lookup(STATUSES, STATUS_AR);
const REPLIED_LOOKUP = lookup(REPLIED_VALUES, REPLIED_AR);

export function normalizeStatus(value: string): string | null {
  return STATUS_LOOKUP.get(key(value)) ?? null;
}

export function normalizeReplied(value: string): string | null {
  return REPLIED_LOOKUP.get(key(value)) ?? null;
}
