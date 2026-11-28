import type { SyncOptions } from "./protocol";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export function sanitizeOptions(value: Partial<SyncOptions> | undefined): SyncOptions {
  const max = Number(value?.maxConversations);
  return {
    messages: value?.messages !== false,
    photos: value?.photos === true,
    maxConversations: Number.isFinite(max) && max > 0 ? Math.min(max, 20_000) : 3000,
    quick: value?.quick === true,
  };
}

export function messagesSinceMs(newestMessageAt: string, quick: boolean): number {
  const ms = newestMessageAt ? Date.parse(newestMessageAt) : 0;
  return Number.isFinite(ms) && ms > 0 ? ms - (quick ? HOUR_MS : DAY_MS) : 0;
}
