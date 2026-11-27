import { describe, expect, it, vi } from "vitest";
import { generateTemplate } from "../src/ai/features";
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

describe("arabic name", () => {
  it("signs Arabic text with the Arabic name and sends both spellings to the AI", async () => {
    const { profile, contacts } = await load();
    profile.messaging.signature_ar = "";
    profile.messaging.signature_en = "";
    profile.me.first_name_ar = "اسم";
    profile.me.full_name_ar = "اسم كامل";
    const text = new TemplateBuilder(profile).build("intro", contacts[0]!, { jobTitle: "", jobLink: "" });
    expect(text.ar.trim().endsWith("اسم")).toBe(true);
    expect(text.en.trim().endsWith(profile.me.first_name)).toBe(true);

    let body = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ar: "a", en: "b" }) } }] }), { status: 200 });
    }));
    await generateTemplate(contacts[0]!, profile, [], "intro", { jobTitle: "", jobLink: "" }, { key: "sk-test", model: "gpt-4.1-mini" });
    vi.unstubAllGlobals();
    const user = JSON.parse((JSON.parse(body) as { messages: Array<{ content: string }> }).messages[1]!.content) as { me: Record<string, string> };
    expect(user.me).toMatchObject({ name_ar: "اسم كامل", first_name_ar: "اسم", name_en: profile.me.full_name, signature_ar: "اسم" });
  });
});
