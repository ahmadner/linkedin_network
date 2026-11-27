import { describe, expect, it } from "vitest";
import { emptyDataset, mergeExport } from "../src/core/dataset";
import { analyze } from "../src/core/pipeline";
import { sanitizeProfile } from "../src/core/profile";
import { TEMPLATE_IDS, TemplateBuilder } from "../src/core/templates";
import { importExport } from "../src/io/exportImport";
import { sampleFiles, sampleProfile } from "./helpers";

async function load() {
  const dataset = mergeExport(emptyDataset(), await importExport(sampleFiles(), "sample"));
  const profile = sanitizeProfile(sampleProfile());
  const analysis = analyze({ dataset, profile, overrides: {}, tracking: {}, log: [], aiMessages: {}, aiClassifications: {}, today: "2026-11-27" });
  return { profile, contacts: analysis.contacts };
}

describe("goal templates", () => {
  it("fills every template in both languages from the profile and the contact", async () => {
    const { profile, contacts } = await load();
    const builder = new TemplateBuilder(profile);
    for (const c of contacts) {
      for (const id of TEMPLATE_IDS) {
        const text = builder.build(id, c, { jobTitle: "", jobLink: "" });
        for (const value of [text.ar, text.en]) {
          expect(value.length).toBeGreaterThan(40);
          expect(value.length).toBeLessThanOrEqual(profile.messaging.message_char_limit);
          expect(value).not.toMatch(/undefined|null|\$\{/);
        }
      }
    }
  });

  it("uses the job title and link when given", async () => {
    const { profile, contacts } = await load();
    const c = contacts.find((x) => x.companyClean)!;
    const text = new TemplateBuilder(profile).build("referral", c, { jobTitle: "Senior Backend Engineer", jobLink: "https://jobs.example.com/42" });
    expect(text.en).toContain("Senior Backend Engineer");
    expect(text.en).toContain(c.companyClean);
    expect(text.ar).toContain("https://jobs.example.com/42");
  });
});
