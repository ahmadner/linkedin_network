import { describe, expect, it } from "vitest";
import { emptyDataset, mergeExport } from "../src/core/dataset";
import { sanitizeProfile } from "../src/core/profile";
import { importExport } from "../src/io/exportImport";
import { emptyState, exportStateZip, importStateZip, reviveState } from "../src/io/state";
import { CONTACT_EXPORT_COLUMNS, rowsCsv } from "../src/io/excel";
import { analyze } from "../src/core/pipeline";
import { strToU8, zipSync } from "fflate";
import { sampleFiles, sampleProfile } from "./helpers";

async function filledState() {
  const state = emptyState();
  state.profile = sanitizeProfile(sampleProfile());
  state.dataset = mergeExport(emptyDataset(), await importExport(sampleFiles(), "sample"));
  state.tracking["slug:noor-ahmad-hr"] = { status: "Message sent", dateSent: "2026-11-20", replied: "No", nextStep: "wait", notes: "multi\nline: notes", tags: ["Referral", "Amman"] };
  state.ai.messages["slug:noor-ahmad-hr"] = { mode: "nudge", model: "gpt-5-mini", generatedAt: "2026-11-27T10:00:00Z", note_ar: "أ", note_en: "a", message_ar: "ب", message_en: "b", followup_ar: "ج", followup_en: "c" };
  state.ai.templates["slug:noor-ahmad-hr|referral"] = { template: "referral", ar: "مرحبًا", en: "Hi", model: "gpt-4.1-mini", generatedAt: "2026-11-27T10:00:00Z" };
  state.ai.analyses["slug:noor-ahmad-hr"] = {
    model: "gpt-4.1-mini", generatedAt: "2026-11-27T10:00:00Z", messageCount: 3, lastMessageAt: "2026-11-20T09:00:00Z", stage: "waiting_them", tone: "neutral",
    summary_ar: "حكينا عن الشاغر", next_step_ar: "استنى أسبوع", reply_ar: "مرحبًا", reply_en: "Hi",
  };
  state.dataset.photos = { "noor-ahmad-hr": "https://media.licdn.com/dms/image/v2/abc/profile-displayphoto-shrink_100_100/0?e=1&t=x" };
  state.ai.suggestions = { model: "gpt-4.1-mini", generatedAt: "2026-11-27T10:00:00Z", companies: [{ name: "Careem", why: "بيوظفوا", roles: ["Technical Recruiter"] }], people: [{ title: "Engineering Manager", why: "صاحب قرار" }], actions: ["ضيف 5 Recruiters"] };
  return state;
}

describe("state zip", () => {
  it("round-trips every section through separate YAML files", async () => {
    const state = await filledState();
    const zip = exportStateZip(state);
    const restored = importStateZip(zip);
    expect(restored.dataset.connections).toEqual(state.dataset.connections);
    expect(restored.dataset.messages).toEqual(state.dataset.messages);
    expect(restored.dataset.invitations).toEqual(state.dataset.invitations);
    expect(restored.dataset.owner).toEqual(state.dataset.owner);
    expect(restored.dataset.photos).toEqual(state.dataset.photos);
    expect(restored.tracking).toEqual(state.tracking);
    expect(restored.ai).toEqual(state.ai);
    expect(restored.profile).toEqual(state.profile);
    expect(restored.overrides).toEqual(state.overrides);
  });

  it("revives the IndexedDB snapshot through the same sanitizer", async () => {
    const state = await filledState();
    expect(reviveState(structuredClone(state))).toEqual(state);
    expect(reviveState({})).toBeNull();
  });

  it("rejects foreign zips and malicious YAML", () => {
    expect(() => importStateZip(zipSync({ "meta.yaml": strToU8("format: other") }))).toThrow(/not a saved state/);
    const bomb = "a: &a [x, x, x, x, x, x, x, x, x, x]\n" + Array.from({ length: 60 }, (_, i) => `b${i}: [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]`).join("\n");
    expect(() => importStateZip(zipSync({ "meta.yaml": strToU8("format: linkedin-network-tool\nversion: 1"), "connections.yaml": strToU8(bomb) }))).toThrow();
  });

  it("drops unknown fields and wrong types", () => {
    const zip = zipSync({
      "meta.yaml": strToU8("format: linkedin-network-tool\nversion: 1\nowner: {name: 5, slug: [1]}"),
      "connections.yaml": strToU8("- firstName: A\n  lastName: B\n  evil: <script>\n  issues: notalist\n"),
    });
    const s = importStateZip(zip);
    expect(s.dataset.connections[0]).not.toHaveProperty("evil");
    expect(s.dataset.connections[0]!.issues).toEqual(["notalist"]);
    expect(s.dataset.owner.name).toBe("5");
  });
});

describe("csv export", () => {
  it("neutralises spreadsheet formulas", async () => {
    const state = await filledState();
    state.dataset.connections[0]!.company = "=HYPERLINK(\"http://x\")";
    const analysis = analyze({ dataset: state.dataset, profile: state.profile, overrides: {}, tracking: {}, log: [], aiMessages: {}, aiClassifications: {}, today: "2026-11-27" });
    expect(rowsCsv(CONTACT_EXPORT_COLUMNS, analysis.contacts)).toContain("'=HYPERLINK");
  });

  it("keeps only LinkedIn image urls for photos", async () => {
    const state = await filledState();
    state.dataset.photos = { ...state.dataset.photos, evil: "https://evil.example/x.png", "bad slug": "https://media.licdn.com/x", quote: 'https://media.licdn.com/x"onerror=1' };
    expect(Object.keys(importStateZip(exportStateZip(state)).dataset.photos)).toEqual(["noor-ahmad-hr"]);
  });

  it("repairs synced messages saved with LinkedIn member ids", async () => {
    const state = await filledState();
    const input = (st: typeof state) => ({ dataset: st.dataset, profile: st.profile, overrides: st.overrides, tracking: {}, log: [], aiMessages: {}, aiClassifications: {}, today: "2026-11-27" });
    const before = analyze(input(state)).contacts.find((c) => c.mode === "cold")!;
    state.dataset.messages.push({
      id: "urn:li:msg_message:9", conversationId: "urn:li:msg_conversation:(urn:li:fsd_profile:ACoAAME0000000000,2-x)", at: "2026-11-27T09:00:00.000Z", outgoing: false,
      from: { name: state.dataset.owner.name, slug: "acoaame0000000000" }, to: [{ name: before.fullName, slug: "acoaayou000000000" }], content: "hi", origin: "linkedin",
    });
    const restored = importStateZip(exportStateZip(state));
    const saved = restored.dataset.messages.find((m) => m.id === "urn:li:msg_message:9")!;
    expect(saved.outgoing).toBe(true);
    expect(saved.from.slug).toBe("");
    const after = analyze(input(restored)).contacts.find((c) => c.id === before.id)!;
    expect(after.mode).toBe("nudge");
  });
});
