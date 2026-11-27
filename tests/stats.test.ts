import { describe, expect, it } from "vitest";
import { countBy, messageActivity, networkGrowth } from "../src/core/stats";
import type { Contact, StoredMessage } from "../src/core/types";

const contact = (connectedDate: string | null) => ({ connectedDate }) as Contact;
const message = (at: string, outgoing: boolean) => ({ at, outgoing }) as StoredMessage;

describe("network stats", () => {
  it("fills empty months and keeps a running total", () => {
    const points = networkGrowth([contact("2025-11-03"), contact("2026-01-20"), contact("2026-01-02"), contact(null)]);
    expect(points).toEqual([
      { month: "2025-11", added: 1, total: 1 },
      { month: "2025-12", added: 0, total: 1 },
      { month: "2026-01", added: 2, total: 3 },
    ]);
    expect(networkGrowth([contact("2020-01-01"), contact("2026-01-01")], 3).map((p) => p.month)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("splits message activity into sent and received", () => {
    const points = messageActivity([message("2026-10-01T10:00:00Z", true), message("2026-10-05T10:00:00Z", false), message("2026-12-01T10:00:00Z", false), message("bad", true)]);
    expect(points).toEqual([
      { month: "2026-10", sent: 1, received: 1 },
      { month: "2026-11", sent: 0, received: 0 },
      { month: "2026-12", sent: 0, received: 1 },
    ]);
  });

  it("counts with a stable order and an Unknown bucket", () => {
    expect(countBy(["b", "a", "", "b"], (x) => x)).toEqual([["b", 2], ["a", 1], ["Unknown", 1]]);
  });
});
