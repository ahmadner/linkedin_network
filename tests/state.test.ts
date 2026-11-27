import { describe, expect, it } from "vitest";
import { emptyDataset, mergeExport } from "../src/core/dataset";
import { sanitizeProfile } from "../src/core/profile";
import { importExport } from "../src/io/exportImport";
import { emptyState, exportStateZip, importStateZip, reviveState } from "../src/io/state";
import { contactsCsv } from "../src/io/excel";
import { analyze } from "../src/core/pipeline";
import { strToU8, zipSync } from "fflate";
import { sampleFiles, sampleProfile } from "./helpers";

async function filledState() {
  const state = emptyState();
  state.profile = sanitizeProfile(sampleProfile());
  state.dataset = mergeExport(emptyDataset(), await importExport(sampleFiles(), "sample"));
  state.tracking["slug:noor-ahmad-hr"] = { status: "Message sent", dateSent: "2026-11-20", replied: "No", nextStep: "wait", notes: "multi\nline: notes", tags: ["Referral", "Amman"] };
  state.ai.messages["slug:noor-ahmad-hr"] = { mode: "nudge", model: "gpt-5-mini", generatedAt: "2026-11-27T10:00:00Z", note_ar: "أ", note_en: "a", message_ar: "ب", message_en: "b", followup_ar: "ج", followup_en: "c" };
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
    expect(contactsCsv(analysis.contacts)).toContain("'=HYPERLINK");
  });
});
