import { describe, expect, it } from "vitest";
import { defaultProfile } from "../src/core/profile";
import { normalizeReplied, normalizeStatus } from "../src/core/tracking";
import { decodeBytes } from "../src/io/csv";
import { EXAMPLE_URL, logTemplateCsv, normalizeDate, parseLogCsv, parseProfileJson, parseTrackingRows, profileTemplateJson, TRACKING_FIELDS } from "../src/io/imports";

const HEADER = TRACKING_FIELDS.map((f) => f.header);

describe("log template", () => {
  it("round-trips the template and skips the example row", () => {
    const text = decodeBytes(new TextEncoder().encode(logTemplateCsv()));
    const result = parseLogCsv(text);
    expect(result.error).toContain("المثال");
    expect(result.items).toEqual([]);
    const filled = parseLogCsv(`${text}Sara,,email,sent,2026-11-20,hi\n`);
    expect(filled.error).toBe("");
    expect(filled.items).toHaveLength(1);
  });

  it("reads rows and reports problems by row number", () => {
    const csv = [
      "full_name,profile_url,channel,direction,sent_at,note",
      "Sara Qasem,https://www.linkedin.com/in/sara-qasem/,email,received,20/11/2026,hi",
      "Omar,not-a-link,phone,sideways,2026-13-40,",
      ",,,,,",
      "Lina,,whatsapp,,,",
      ",,email,sent,,",
    ].join("\n");
    const result = parseLogCsv(csv);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ fullName: "Sara Qasem", profileUrl: "https://www.linkedin.com/in/sara-qasem", outgoing: false, sentAt: "2026-11-20" });
    expect(result.items[1]).toMatchObject({ profileUrl: "", outgoing: true, sentAt: "" });
    expect(result.issues.map((i) => i.row)).toEqual([3, 3, 3, 6]);
  });

  it("explains a file without the expected header", () => {
    expect(parseLogCsv("name,url\nA,B").error).toContain("full_name");
  });
});

describe("tracking rows", () => {
  it("maps Arabic and English values and validates them", () => {
    const rows = [
      ["Example Person", EXAMPLE_URL, "Message sent", "", "", "", "", ""],
      ["Noor", "https://www.linkedin.com/in/noor-ahmad", "بعتت رسالة", "2026-11-01", "نعم", "call", "note", "a, b"],
      ["Hiba", "https://www.linkedin.com/in/hiba", "Maybe", "yesterday", "kind of", "", "", ""],
      ["Idle", "https://www.linkedin.com/in/idle", "Not started", "", "", "", "", ""],
      ["NoUrl", "", "Replied", "", "", "", "", ""],
      ["Bad", "https://example.com/x", "Replied", "", "", "", "", ""],
    ];
    const result = parseTrackingRows(HEADER, rows);
    expect(result.error).toBe("");
    expect(result.items.get("slug:noor-ahmad")).toEqual({ status: "Message sent", dateSent: "2026-11-01", replied: "Yes", nextStep: "call", notes: "note", tags: "a, b" });
    expect(result.items.has("slug:hiba")).toBe(false);
    expect(result.items.size).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.issues.map((i) => i.row)).toEqual([4, 4, 4, 6, 7]);
  });

  it("requires the profile column", () => {
    expect(parseTrackingRows(["Name"], [["x"]]).error).toContain("LinkedIn Profile");
  });
});

describe("profile json", () => {
  it("accepts its own template", () => {
    const result = parseProfileJson(profileTemplateJson(defaultProfile()));
    expect(result.error).toBe("");
    expect(result.issues).toEqual([]);
  });

  it("explains invalid or unrelated json", () => {
    expect(parseProfileJson("{ me: 1 }").error).toContain("JSON");
    expect(parseProfileJson('{"foo": 1}').error).toContain("me");
    expect(parseProfileJson('{"me": {}, "extra": 1}').issues).toHaveLength(1);
  });
});

describe("value normalizers", () => {
  it("normalizes dates", () => {
    expect(normalizeDate("2026-1-5")).toBe("2026-01-05");
    expect(normalizeDate("5/1/2026")).toBe("2026-01-05");
    expect(normalizeDate("31/02/2026")).toBeNull();
    expect(normalizeDate("")).toBe("");
  });

  it("normalizes statuses and replies", () => {
    expect(normalizeStatus("  message SENT ")).toBe("Message sent");
    expect(normalizeStatus("ردّ")).toBe("Replied");
    expect(normalizeStatus("nope")).toBeNull();
    expect(normalizeReplied("بانتظار")).toBe("Pending");
  });
});
