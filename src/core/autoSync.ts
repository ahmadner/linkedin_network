export interface AutoSyncSettings {
  enabled: boolean;
  minutes: number;
}

export const AUTO_SYNC_MINUTES: readonly number[] = [3, 5, 10, 15, 30, 60];
export const DEFAULT_AUTO_SYNC: AutoSyncSettings = { enabled: true, minutes: 3 };

const MINUTE_MS = 60_000;

export function parseAutoSync(raw: string | null): AutoSyncSettings {
  if (!raw) return { ...DEFAULT_AUTO_SYNC };
  try {
    const value = JSON.parse(raw) as Partial<AutoSyncSettings> | null;
    const minutes = Number(value?.minutes);
    return {
      enabled: value?.enabled !== false,
      minutes: AUTO_SYNC_MINUTES.includes(minutes) ? minutes : DEFAULT_AUTO_SYNC.minutes,
    };
  } catch {
    return { ...DEFAULT_AUTO_SYNC };
  }
}

export function nextAutoSyncAt(settings: AutoSyncSettings, lastStartMs: number, nowMs: number): number {
  const due = lastStartMs + settings.minutes * MINUTE_MS;
  return lastStartMs > nowMs || due < nowMs ? nowMs : due;
}

export function autoSyncDue(settings: AutoSyncSettings, lastStartMs: number, nowMs: number): boolean {
  return settings.enabled && nextAutoSyncAt(settings, lastStartMs, nowMs) <= nowMs;
}
