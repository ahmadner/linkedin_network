import { describe, expect, it } from "vitest";
import { autoSyncDue, DEFAULT_AUTO_SYNC, nextAutoSyncAt, parseAutoSync } from "../src/core/autoSync";
import { messagesSinceMs, sanitizeOptions } from "../extension/src/options";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 28, 12, 0);

describe("auto sync settings", () => {
  it("is on every 3 minutes by default", () => {
    expect(parseAutoSync(null)).toEqual({ enabled: true, minutes: 3 });
    expect(DEFAULT_AUTO_SYNC).toEqual({ enabled: true, minutes: 3 });
  });

  it("keeps saved choices and rejects unknown values", () => {
    expect(parseAutoSync(JSON.stringify({ enabled: false, minutes: 15 }))).toEqual({ enabled: false, minutes: 15 });
    expect(parseAutoSync(JSON.stringify({ enabled: true, minutes: 1 }))).toEqual({ enabled: true, minutes: 3 });
    expect(parseAutoSync("{broken")).toEqual({ enabled: true, minutes: 3 });
    expect(parseAutoSync("null")).toEqual({ enabled: true, minutes: 3 });
  });

  it("waits a full interval after the last sync started", () => {
    const settings = { enabled: true, minutes: 3 };
    expect(autoSyncDue(settings, NOW - 2 * MINUTE, NOW)).toBe(false);
    expect(autoSyncDue(settings, NOW - 3 * MINUTE, NOW)).toBe(true);
    expect(autoSyncDue(settings, 0, NOW)).toBe(true);
    expect(nextAutoSyncAt(settings, NOW - MINUTE, NOW)).toBe(NOW + 2 * MINUTE);
  });

  it("never runs when turned off", () => {
    expect(autoSyncDue({ enabled: false, minutes: 3 }, 0, NOW)).toBe(false);
  });

  it("runs now when the saved start is in the future", () => {
    expect(autoSyncDue({ enabled: true, minutes: 3 }, NOW + 10 * MINUTE, NOW)).toBe(true);
  });
});

describe("extension sync options", () => {
  it("marks only explicit quick runs", () => {
    expect(sanitizeOptions({ messages: true, photos: false, maxConversations: 3000, quick: true }).quick).toBe(true);
    expect(sanitizeOptions({ messages: true }).quick).toBe(false);
    expect(sanitizeOptions(undefined)).toEqual({ messages: true, photos: false, maxConversations: 3000, quick: false });
  });

  it("re-reads one hour of messages on quick runs and one day otherwise", () => {
    const newest = "2026-11-28T12:00:00.000Z";
    expect(messagesSinceMs(newest, true)).toBe(NOW - 60 * MINUTE);
    expect(messagesSinceMs(newest, false)).toBe(NOW - 24 * 60 * MINUTE);
    expect(messagesSinceMs("", true)).toBe(0);
  });
});
