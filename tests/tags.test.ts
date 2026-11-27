import { describe, expect, it } from "vitest";
import { normalizeTags } from "../src/core/tags";
import { sanitizeTracking } from "../src/io/state";

describe("tags", () => {
  it("trims, dedupes case-insensitively and caps tag count and length", () => {
    expect(normalizeTags([" #Referral ", "referral", "Amman  Tech", "", "x".repeat(60)])).toEqual(["Referral", "Amman Tech", "x".repeat(40)]);
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
  });

  it("reads tags from a list or a comma separated string", () => {
    expect(sanitizeTracking({ tags: "a, b,a" }).tags).toEqual(["a", "b"]);
    expect(sanitizeTracking({ tags: ["x", 5, null] }).tags).toEqual(["x", "5"]);
    expect(sanitizeTracking({}).tags).toEqual([]);
  });
});
