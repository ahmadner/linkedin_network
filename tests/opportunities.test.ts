import { describe, expect, it } from "vitest";
import { emptyDataset, mergeExport } from "../src/core/dataset";
import { linkedinPeopleSearch, networkGaps, suggestCompanies, suggestPeople } from "../src/core/opportunities";
import { analyze } from "../src/core/pipeline";
import { sanitizeProfile } from "../src/core/profile";
import { importExport } from "../src/io/exportImport";
import { sampleFiles, sampleProfile } from "./helpers";

async function load(targets: { companies?: string[]; industries?: string[] } = {}) {
  const dataset = mergeExport(emptyDataset(), await importExport(sampleFiles(), "sample"));
  const profile = sanitizeProfile(sampleProfile());
  if (targets.companies) profile.targeting.target_companies = targets.companies;
  if (targets.industries) profile.targeting.target_industries = targets.industries;
  const analysis = analyze({ dataset, profile, overrides: {}, tracking: {}, log: [], aiMessages: {}, aiClassifications: {}, today: "2026-11-27" });
  return { profile, ...analysis };
}

describe("network gaps", () => {
  it("flags targets with nobody, sorts them first and gives a LinkedIn search", async () => {
    const { contacts, profile } = await load({ companies: ["Microsoft", "Careem"], industries: ["Telecom", "Agriculture & Food"] });
    const gaps = networkGaps(contacts, profile);
    const careem = gaps.find((g) => g.target === "Careem")!;
    expect(careem.level).toBe("none");
    expect(careem.contacts).toBe(0);
    expect(careem.search).toBe(linkedinPeopleSearch("Technical Recruiter Careem"));
    expect(gaps.find((g) => g.target === "Microsoft")!.contacts).toBeGreaterThan(0);
    expect(gaps[0]!.level).toBe("none");
    const rank = gaps.map((g) => ["none", "weak", "ok"].indexOf(g.level));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
  });
});

describe("suggestions", () => {
  it("suggests people from the network with at most two per company and a reason", async () => {
    const { contacts } = await load();
    const people = suggestPeople(contacts);
    expect(people.length).toBeGreaterThan(0);
    const perCompany = new Map<string, number>();
    for (const p of people) {
      expect(p.reason.length).toBeGreaterThan(10);
      const key = p.contact.companyKey || p.contact.id;
      perCompany.set(key, (perCompany.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perCompany.values())).toBeLessThanOrEqual(2);
    expect(people.every((p) => p.contact.bucket !== "X")).toBe(true);
  });

  it("puts target companies first", async () => {
    const { companies, profile } = await load({ companies: ["Aramex"] });
    const list = suggestCompanies(companies, profile);
    expect(list[0]!.company.name).toBe("Aramex");
    expect(list[0]!.targeted).toBe(true);
  });
});
