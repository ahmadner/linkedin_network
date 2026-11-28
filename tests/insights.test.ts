import { describe, expect, it } from "vitest";
import type { Draft, Post } from "../src/core/content";
import { emptyHistory } from "../src/core/history";
import { ageBand, buildInsights, contentPulse, networkGrowthSplit, outreachFunnel, replyBacklog, replyRate, replySpeed, weeklyPulse } from "../src/core/insights";
import { defaultProfile } from "../src/core/profile";
import type { Bucket, Contact, ContactHistory, StoredMessage, Tracking } from "../src/core/types";

const TODAY = "2026-11-28";

let seq = 0;

function msg(conv: string, at: string, outgoing: boolean, who = conv): StoredMessage {
  seq += 1;
  const party = { name: who, slug: who };
  const me = { name: "Me", slug: "me" };
  return { id: `m${seq}`, conversationId: conv, at, outgoing, from: outgoing ? me : party, to: outgoing ? [party] : [me], content: "", origin: "export" };
}

function person(id: string, patch: { bucket?: Bucket; days?: number | null; recruiter?: boolean; connected?: string | null; history?: Partial<ContactHistory>; tracking?: Partial<Tracking> } = {}): Contact {
  return {
    id,
    fullName: id,
    bucket: patch.bucket ?? "C",
    score: 0,
    isRecruiter: patch.recruiter ?? false,
    daysSinceContact: patch.days ?? null,
    connectedDate: patch.connected ?? null,
    history: { ...emptyHistory(), ...patch.history },
    tracking: { status: "Not started", dateSent: "", replied: "", nextStep: "", notes: "", tags: [], ...patch.tracking },
  } as unknown as Contact;
}

function draft(patch: Partial<Draft>): Draft {
  return { status: "draft", scheduledFor: "", ...patch } as Draft;
}

function post(at: string): Post {
  return { id: at, at, text: "", url: "", sharedUrl: "", media: "", origin: "export", metrics: null };
}

const waiting = { lastDirection: "them -> me" };

describe("weekly pulse", () => {
  it("counts unique people per rolling week ending today", () => {
    const weeks = weeklyPulse([
      msg("a", "2026-11-28T09:00:00Z", true),
      msg("a", "2026-11-27T09:00:00Z", true),
      msg("b", "2026-11-22T09:00:00Z", false),
      msg("c", "2026-11-21T09:00:00Z", true),
      msg("d", "2020-01-01T09:00:00Z", true),
    ], [post("2026-11-25T08:00:00Z")], TODAY);
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toEqual({ start: "2026-11-22", end: "2026-11-28", messaged: 1, heard: 1, posts: 1 });
    expect(weeks[10]).toMatchObject({ start: "2026-11-15", end: "2026-11-21", messaged: 1, heard: 0 });
  });
});

describe("reply rate", () => {
  it("only counts threads I started, leaves out the last week, and compares with the window before", () => {
    const rate = replyRate([
      msg("a", "2026-11-01T10:00:00Z", true),
      msg("a", "2026-11-01T14:00:00Z", false),
      msg("b", "2026-10-15T10:00:00Z", true),
      msg("c", "2026-11-25T10:00:00Z", true),
      msg("d", "2026-11-02T10:00:00Z", false),
      msg("d", "2026-11-02T11:00:00Z", true),
      msg("e", "2026-07-01T10:00:00Z", true),
      msg("e", "2026-07-02T10:00:00Z", false),
    ], TODAY);
    expect(rate).toEqual({ started: 2, replied: 1, rate: 50, previousStarted: 1, previousRate: 100, medianHours: 4 });
  });
});

describe("reply speed", () => {
  it("measures from the first unanswered message to my next reply", () => {
    const speed = replySpeed([
      msg("a", "2026-11-10T10:00:00Z", false),
      msg("a", "2026-11-10T12:00:00Z", false),
      msg("a", "2026-11-11T10:00:00Z", true),
      msg("b", "2026-11-20T10:00:00Z", false),
      msg("b", "2026-11-20T12:00:00Z", true),
      msg("c", "2026-11-26T10:00:00Z", false),
    ], TODAY);
    expect(speed).toEqual({ medianHours: 13, previousMedianHours: null, samples: 2 });
  });
});

describe("reply backlog", () => {
  it("splits fresh from stale and puts important people first", () => {
    const backlog = replyBacklog([
      person("old", { days: 120, history: waiting }),
      person("new", { days: 1, history: waiting }),
      person("vip", { days: 10, bucket: "A", history: waiting }),
      person("closed", { days: 1, history: waiting, tracking: { status: "Closed - no fit" } }),
      person("done", { days: 1 }),
    ]);
    expect(backlog).toMatchObject({ total: 3, fresh: 2, freshImportant: 1, stale: 1, oldestFreshDays: 10 });
    expect(backlog.queue.map((c) => c.id)).toEqual(["vip", "new"]);
    expect(backlog.bands.find((b) => b.band === "8-30")).toEqual({ band: "8-30", count: 1, important: 1 });
    expect([0, 2, 3, 7, 8, 30, 31, 90, 91].map(ageBand)).toEqual(["0-2", "0-2", "3-7", "3-7", "8-30", "8-30", "31-90", "31-90", "90+"]);
  });
});

describe("network growth", () => {
  it("splits each month into targeted and other people", () => {
    const growth = networkGrowthSplit([
      person("a", { bucket: "A", connected: "2026-11-20" }),
      person("b", { connected: "2026-11-01" }),
      person("c", { connected: "2026-10-10" }),
      person("d", { connected: "2024-01-01" }),
    ], TODAY);
    expect(growth.months).toHaveLength(12);
    expect(growth.months[0]!.month).toBe("2025-12");
    expect(growth.months[11]).toEqual({ month: "2026-11", targeted: 1, other: 1 });
    expect(growth).toMatchObject({ last30: 2, targeted30: 1, previous30: 1 });
  });
});

describe("outreach funnel", () => {
  it("finds the weakest stage against its benchmark", () => {
    const priority = Array.from({ length: 10 }, (_, i) => person(`p${i}`, { bucket: "A", history: i < 5 ? { sentByMe: 1, received: i < 1 ? 1 : 0 } : {} }));
    const funnel = outreachFunnel([...priority, person("c", { history: { sentByMe: 3, received: 3 } })]);
    expect(funnel.stages.map((s) => s.count)).toEqual([10, 5, 1, 0]);
    expect(funnel.tracked).toBe(false);
    expect(funnel.bottleneck).toBe("replied");
  });

  it("only judges the meeting stage once meetings are tracked", () => {
    const people = [
      person("a", { bucket: "A", history: { sentByMe: 1, received: 1 }, tracking: { status: "Replied" } }),
      person("b", { bucket: "B", history: { sentByMe: 1, received: 1 } }),
      person("c", { history: { sentByMe: 1, received: 1 }, tracking: { status: "Meeting booked" } }),
    ];
    expect(outreachFunnel(people)).toMatchObject({ tracked: true, bottleneck: "converted" });
  });
});

describe("content pulse", () => {
  it("compares posting with the weekly goal and finds due and upcoming drafts", () => {
    const pulse = contentPulse([post("2026-11-20T08:00:00Z"), post("2026-10-20T08:00:00Z")], [
      draft({ scheduledFor: "2026-11-27" }),
      draft({ scheduledFor: "2026-12-03", status: "ready" }),
      draft({ scheduledFor: "2026-12-01" }),
      draft({ scheduledFor: "2026-11-01", status: "published" }),
    ], 2, TODAY);
    expect(pulse).toEqual({ target: 2, last30: 1, previous30: 1, target30: 9, daysSinceLast: 8, due: 1, ready: 1, nextScheduled: "2026-12-01" });
  });
});

describe("next steps", () => {
  it("ranks an important reply above everything else and asks to finish the profile", () => {
    const insights = buildInsights({
      contacts: [person("vip", { bucket: "A", days: 2, history: waiting })],
      messages: [],
      posts: [],
      drafts: [],
      postsPerWeek: 2,
      profile: defaultProfile(),
      dataAt: "2026-11-01T10:00:00Z",
      today: TODAY,
    });
    expect(insights.steps.map((s) => s.kind)).toEqual(["reply", "profile", "sync", "post", "gap"]);
    expect(insights.steps.find((s) => s.kind === "sync")!.count).toBe(27);
  });
});
