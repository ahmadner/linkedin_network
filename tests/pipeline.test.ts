import { describe, expect, it } from "vitest";
import { emptyDataset, mergeExport, mergeSync } from "../src/core/dataset";
import { analyze } from "../src/core/pipeline";
import { sanitizeProfile } from "../src/core/profile";
import type { LogEntry } from "../src/core/types";
import { importExport } from "../src/io/exportImport";
import { sampleFiles, sampleProfile } from "./helpers";

const log: LogEntry[] = [
  { profileUrl: "https://www.linkedin.com/in/ibrahim-salti/", fullName: "Ibrahim Salti", channel: "email", outgoing: true, sentAt: "2026-11-20", note: "" },
  { profileUrl: "", fullName: "Maysa Odeh", channel: "whatsapp", outgoing: false, sentAt: "2026-09-02", note: "" },
];

async function run() {
  const imported = await importExport(sampleFiles(), "sample");
  const dataset = mergeExport(emptyDataset(), imported);
  const analysis = analyze({
    dataset,
    profile: sanitizeProfile(sampleProfile()),
    overrides: { optimiza: "Software & IT Services" },
    tracking: {},
    log,
    aiMessages: {},
    aiClassifications: {},
    today: "2026-11-27",
  });
  return { imported, dataset, analysis, byName: (n: string) => analysis.contacts.find((c) => c.fullName === n)! };
}

describe("export import", () => {
  it("reads connections, repairs shifted rows and resolves the owner", async () => {
    const { imported } = await run();
    expect(imported.connections).toHaveLength(20);
    const yousef = imported.connections.find((c) => c.firstName === "Yousef")!;
    expect(yousef.lastName).toBe("Mansour, PMP");
    expect(yousef.issues).toContain("repaired_shifted_row");
    expect(imported.owner).toMatchObject({ name: "Ahmad Nueirat", slug: "ahmad-nueirat", identityMethod: "Profile.csv" });
    expect(imported.messages).toHaveLength(8);
    expect(imported.invitations).toHaveLength(3);
    expect(imported.suggestedProfile.headline).toBe("Backend Engineer | Java & Spring Boot");
  });
});

describe("analysis", () => {
  it("dedupes by profile slug", async () => {
    const { analysis } = await run();
    expect(analysis.contacts).toHaveLength(19);
    expect(analysis.quality.duplicatesRemoved).toBe(1);
  });

  it("derives the outreach mode from history", async () => {
    const { byName } = await run();
    expect(byName("Lina Haddad").mode).toBe("nudge");
    expect(byName("Tareq Awwad").mode).toBe("reconnect");
    expect(byName("Rana Saleh").mode).toBe("reconnect");
    expect(byName("Hassan Nimri").mode).toBe("cold");
    expect(byName("Ali Barakat").mode).toBe("cold");
    expect(byName("Ibrahim Salti").mode).toBe("nudge");
    expect(byName("Maysa Odeh").historyMatch).toBe("name match");
    expect(byName("Mahmoud Darwish").history.received).toBe(1);
    expect(byName("Omar Khalil").history.sentByMe).toBe(1);
  });

  it("scores and writes messages", async () => {
    const { byName, analysis } = await run();
    const noor = byName("Noor Ahmad");
    expect(noor.isRecruiter).toBe(true);
    expect(noor.scoreBreakdown).toContain("target company");
    expect(analysis.contacts[0]!.score).toBeGreaterThanOrEqual(analysis.contacts[1]!.score);
    for (const c of analysis.contacts) {
      expect(c.note_en.length).toBeLessThanOrEqual(200);
      expect(c.note_ar.length).toBeLessThanOrEqual(200);
      expect(c.message_en).toContain("Ahmad");
    }
    expect(byName("Mahmoud Darwish").archetype).toBe("founder");
  });

  it("feeds in-tool tracking back into the history", async () => {
    const { dataset } = await run();
    const analysis = analyze({
      dataset,
      profile: sanitizeProfile(sampleProfile()),
      overrides: {},
      tracking: { "slug:hassan-nimri": { status: "Message sent", dateSent: "2026-11-25", replied: "", nextStep: "", notes: "", tags: [] } },
      log: [],
      aiMessages: {},
      aiClassifications: {},
      today: "2026-11-27",
    });
    const hassan = analysis.contacts.find((c) => c.slug === "hassan-nimri")!;
    expect(hassan.mode).toBe("nudge");
    expect(hassan.history.sentByMe).toBe(1);
  });

  it("merges an incremental LinkedIn sync without losing export data", async () => {
    const { dataset } = await run();
    const merged = mergeSync(dataset, {
      collectedAt: "2026-11-27T10:00:00Z",
      owner: { name: "Ahmad Nueirat", slug: "ahmad-nueirat" },
      connections: [
        { firstName: "Hassan", lastName: "Nimri", slug: "hassan-nimri", headline: "Lead Data Scientist at Aramex", connectedAt: "2024-08-30", photo: "" },
        { firstName: "New", lastName: "Person", slug: "new-person", headline: "Talent Partner at Careem", connectedAt: "2026-11-26", photo: "https://media.licdn.com/dms/image/x/profile-100" },
      ],
      messages: [
        { id: "m1", conversationId: "c9", at: "2026-11-26T08:00:00Z", from: { name: "New Person", slug: "new-person" }, to: [{ name: "Ahmad Nueirat", slug: "ahmad-nueirat" }], content: "hi" },
      ],
      notes: [],
    });
    expect(merged.sync.newestConnectionAt).toBe("2026-11-26");
    expect(merged.photos).toEqual({ "new-person": "https://media.licdn.com/dms/image/x/profile-100" });
    const analysis = analyze({
      dataset: merged,
      profile: sanitizeProfile(sampleProfile()),
      overrides: {},
      tracking: {},
      log: [],
      aiMessages: {},
      aiClassifications: {},
      today: "2026-11-27",
    });
    const hassan = analysis.contacts.find((c) => c.slug === "hassan-nimri")!;
    expect(hassan.email).toBe("hassan.nimri@example.net");
    expect(analysis.contacts.find((c) => c.slug === "new-person")!.mode).toBe("reconnect");
    expect(analysis.contacts).toHaveLength(20);
  });

  it("does not double count synced copies of exported messages", async () => {
    const { dataset } = await run();
    const exported = dataset.messages.find((m) => m.conversationId === "c-0001")!;
    const merged = mergeSync(dataset, {
      collectedAt: "2026-11-27T10:00:00Z",
      owner: { name: "Ahmad Nueirat", slug: "ahmad-nueirat" },
      connections: [],
      messages: [
        { id: "urn:li:msg_message:1", conversationId: "urn:li:msg_conversation:(urn:li:fsd_profile:ME,c-0001)", at: `${exported.at.slice(0, 19)}.512Z`, from: exported.from, to: exported.to, content: exported.content },
        { id: "urn:li:msg_message:2", conversationId: "urn:li:msg_conversation:(urn:li:fsd_profile:ME,c-0001)", at: "2026-11-26T12:00:00.000Z", from: { name: "Ahmad Nueirat", slug: "" }, to: [{ name: "Lina Haddad", slug: "" }], content: "new" },
      ],
      notes: [],
    });
    expect(merged.messages).toHaveLength(dataset.messages.length + 1);
    expect(merged.messages.find((m) => m.id === "urn:li:msg_message:2")!.outgoing).toBe(true);
    expect(merged.sync.newestMessageAt).toBe("2026-11-26T12:00:00.000Z");
    const reimported = mergeExport(merged, await importExport(sampleFiles(), "sample"));
    expect(reimported.messages).toHaveLength(dataset.messages.length + 1);
  });

  it("marks a contact as contacted after a synced first message with a decorated name", async () => {
    const { dataset } = await run();
    const input = (d: typeof dataset) => ({ dataset: d, profile: sanitizeProfile(sampleProfile()), overrides: {}, tracking: {}, log: [], aiMessages: {}, aiClassifications: {}, today: "2026-11-27" });
    const target = analyze(input(dataset)).contacts.find((c) => c.mode === "cold")!;
    const conv = "urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-new)";
    const merged = mergeSync(dataset, {
      collectedAt: "2026-11-27T10:00:00Z",
      owner: { name: "Ahmad Nueirat", slug: "ahmad-nueirat" },
      connections: [],
      messages: [{ id: "urn:li:msg_message:77", conversationId: conv, at: "2026-11-27T09:00:00.000Z", from: { name: "Ahmad Nueirat", slug: "ahmad-nueirat" }, to: [{ name: `${target.fullName}, MBA`, slug: "" }], content: "hello" }],
      notes: [],
    });
    expect(analyze(input(merged)).contacts.find((c) => c.id === target.id)!.mode).toBe("nudge");
  });

  it("fills the recipient of a sent message from the rest of the thread", async () => {
    const { dataset } = await run();
    const merged = mergeSync(dataset, {
      collectedAt: "2026-11-27T10:00:00Z",
      owner: { name: "Ahmad Nueirat", slug: "ahmad-nueirat" },
      connections: [],
      messages: [
        { id: "a", conversationId: "c-x", at: "2026-11-20T09:00:00.000Z", from: { name: "Ahmad Nueirat", slug: "ahmad-nueirat" }, to: [], content: "hello" },
        { id: "b", conversationId: "c-x", at: "2026-11-21T09:00:00.000Z", from: { name: "Lina Haddad", slug: "" }, to: [], content: "hi" },
      ],
      notes: [],
    });
    expect(merged.messages.find((m) => m.id === "a")!.to).toEqual([{ name: "Lina Haddad", slug: "" }]);
  });
});
