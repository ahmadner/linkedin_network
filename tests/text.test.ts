import { describe, expect, it } from "vitest";
import { cleanCompany, cleanEmail, cleanPersonName, cleanPosition, cleanProfileUrl, greetingName, splitHeadline } from "../src/core/text";
import { classifyFunction, classifyIndustry, classifySeniority } from "../src/core/classify";
import { parseDate } from "../src/core/dates";

describe("text cleaning", () => {
  it("strips emoji, pronouns and credentials from names", () => {
    expect(cleanPersonName("Omar", "Khalil 🚀").full).toBe("Omar Khalil");
    expect(cleanPersonName("Sara", "Qasem (She/Her)").full).toBe("Sara Qasem");
    expect(cleanPersonName("Ali", "Barakat, PMP, MSc").full).toBe("Ali Barakat");
    expect(cleanPersonName("李", "小龙").full).toBe("李 小龙");
  });

  it("extracts the primary title from a headline", () => {
    const p = cleanPosition("Senior Backend Engineer | Java | Spring Boot | #OpenToWork");
    expect(p.primary).toBe("Senior Backend Engineer");
    expect(p.clean).not.toMatch(/OpenToWork/i);
  });

  it("builds a company key without legal forms", () => {
    expect(cleanCompany("Optimiza Solutions Co., Ltd.").key).toBe("optimiza solutions");
    expect(cleanCompany("Self-employed").kind).toBe("freelance");
    expect(cleanCompany("Stealth Startup").kind).toBe("none");
  });

  it("accepts multi-label email domains", () => {
    expect(cleanEmail("rana@design.example.org").valid).toBe(true);
    expect(cleanEmail("not-an-email").valid).toBe(false);
  });

  it("canonicalises profile urls", () => {
    expect(cleanProfileUrl("https://www.linkedin.com/in/omar-khalil-dev?trk=contacts")).toEqual({
      url: "https://www.linkedin.com/in/omar-khalil-dev",
      slug: "omar-khalil-dev",
    });
    expect(greetingName("dr. sara", "")).toBe("Sara");
  });

  it("splits a headline into position and company", () => {
    expect(splitHeadline("Senior Backend Engineer at Optimiza | Java")).toEqual({ position: "Senior Backend Engineer | Java", company: "Optimiza" });
    expect(splitHeadline("Backend Engineer")).toEqual({ position: "Backend Engineer", company: "" });
  });
});

describe("classification", () => {
  it("handles manager traps and authority", () => {
    expect(classifySeniority("Product Manager").label).toBe("Mid IC");
    expect(classifySeniority("Senior Project Manager").label).toBe("Senior IC");
    expect(classifySeniority("Co-Founder & CTO").label).toBe("Founder / Owner");
    expect(classifySeniority("Engineering Manager").label).toBe("Manager");
    expect(classifySeniority("مدير عام").label).toBe("C-Level");
  });

  it("scores functions instead of first match", () => {
    expect(classifyFunction("Senior Cloud Data Engineer").label).toBe("Data & AI");
    expect(classifyFunction("Technical Recruiter").label).toBe("HR & Recruiting");
  });

  it("prefers specific industries and known employers", () => {
    expect(classifyIndustry("Ministry of Digital Economy", "ministry of digital economy", "", {}).label).toBe("Government & Public Sector");
    expect(classifyIndustry("Zain Jordan", "zain jordan", "", {}).label).toBe("Telecom");
    expect(classifyIndustry("Optimiza", "optimiza", "", { optimiza: "Software & IT Services" }).evidence).toBe("manual override");
  });
});

describe("dates", () => {
  it("parses export date formats", () => {
    expect(parseDate("02 May 2023")).toBe("2023-05-02");
    expect(parseDate("8/30/24, 2:13 PM", false)).toBe("2024-08-30");
    expect(parseDate("2026-11-10 09:14:22 UTC")).toBe("2026-11-10");
    expect(parseDate("May 2, 2023")).toBe("2023-05-02");
    expect(parseDate("garbage")).toBeNull();
  });
});
