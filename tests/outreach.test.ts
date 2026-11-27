import { describe, expect, it } from "vitest";
import { candidateFrom, findMemberId, inviteRequest, messageRequest } from "../extension/src/linkedin";
import { emptyDataset, mergeExport } from "../src/core/dataset";
import { MESSAGE_SOURCES, messageFor, newCandidates, peopleSearchUrl, personalize } from "../src/core/outreach";
import { analyze } from "../src/core/pipeline";
import { sanitizeProfile } from "../src/core/profile";
import { importExport } from "../src/io/exportImport";
import { sampleFiles, sampleProfile } from "./helpers";

async function contacts() {
  const dataset = mergeExport(emptyDataset(), await importExport(sampleFiles(), "sample"));
  const profile = sanitizeProfile(sampleProfile());
  return { profile, contacts: analyze({ dataset, profile, overrides: {}, tracking: {}, log: [], aiMessages: {}, aiClassifications: {}, today: "2026-11-27" }).contacts };
}

describe("outreach", () => {
  it("builds a message for every source and prefers AI templates", async () => {
    const { profile, contacts: list } = await contacts();
    const c = list[0]!;
    for (const [source] of MESSAGE_SOURCES) expect(messageFor(c, source, profile, {}).length).toBeGreaterThan(10);
    expect(messageFor(c, "tpl:referral:en", profile, { [`${c.id}|referral`]: { template: "referral", ar: "ع", en: "AI text", model: "m", generatedAt: "" } })).toBe("AI text");
  });

  it("personalizes invite notes and filters candidates", () => {
    expect(personalize("مرحبًا {name}، تشرفت", "Lina Haddad")).toBe("مرحبًا Lina، تشرفت");
    const found = newCandidates([
      { slug: "lina", memberId: "", name: "Lina", headline: "", degree: "2nd" },
      { slug: "lina", memberId: "", name: "Lina", headline: "", degree: "2nd" },
      { slug: "omar", memberId: "", name: "Omar", headline: "", degree: "1st" },
      { slug: "known", memberId: "", name: "Known", headline: "", degree: "2nd" },
      { slug: "", memberId: "ACoAAB1234567890abcdef", name: "Hidden", headline: "", degree: "3rd" },
    ], new Set(["known"]));
    expect(found.map((c) => c.name)).toEqual(["Lina", "Hidden"]);
    expect(peopleSearchUrl("Backend Engineer Amman")).toContain("keywords=Backend%20Engineer%20Amman");
  });

  it("reads search results and builds LinkedIn write requests", () => {
    expect(candidateFrom({ id: "Lina-H", name: "Lina H\nView profile", headline: " Recruiter ", degree: "2nd" })).toEqual({ slug: "lina-h", memberId: "", name: "Lina H", headline: "Recruiter", degree: "2nd" });
    expect(candidateFrom({ id: "ACoAAB1234567890abcdef", name: "X", headline: "", degree: "" })!.memberId).toBe("ACoAAB1234567890abcdef");
    expect(candidateFrom({ id: "bad slug!", name: "X", headline: "", degree: "" })).toBeNull();
    const profile = { included: [{ entityUrn: "urn:li:fsd_profile:ACoAAOTHER0000000000", publicIdentifier: "other" }, { entityUrn: "urn:li:fsd_profile:ACoAALINA00000000000", publicIdentifier: "Lina-H" }] };
    expect(findMemberId(profile, "lina-h")).toBe("ACoAALINA00000000000");
    const message = JSON.parse(messageRequest("ACoAAME", "ACoAAYOU", "مرحبا", "token", "t").body);
    expect(message).toMatchObject({ mailboxUrn: "urn:li:fsd_profile:ACoAAME", hostRecipientUrns: ["urn:li:fsd_profile:ACoAAYOU"], message: { body: { text: "مرحبا" }, originToken: "token" } });
    expect(JSON.parse(inviteRequest("ACoAAYOU", "").body)).toEqual({ invitee: { inviteeUnion: { memberProfile: "urn:li:fsd_profile:ACoAAYOU" } } });
    expect(JSON.parse(inviteRequest("ACoAAYOU", "hi").body).customMessage).toBe("hi");
  });
});
