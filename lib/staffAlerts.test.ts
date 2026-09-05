import { describe, expect, it } from "vitest";

import { getHistoricalStaffAlerts, getOverviewStaffAlerts } from "./staffAlerts";

interface TestAlert {
  readonly created_at: string;
  readonly id: string;
  readonly priority: "normal" | "urgent";
  readonly removed_at: string | null;
  readonly superseded_at: string | null;
}

const alerts: readonly TestAlert[] = [
  { id: "normal", created_at: "2026-09-02T12:00:00.000Z", priority: "normal", removed_at: null, superseded_at: null },
  { id: "urgent", created_at: "2026-09-01T12:00:00.000Z", priority: "urgent", removed_at: null, superseded_at: null },
  { id: "old", created_at: "2026-08-01T12:00:00.000Z", priority: "urgent", removed_at: null, superseded_at: null },
  { id: "removed", created_at: "2026-09-03T10:00:00.000Z", priority: "normal", removed_at: "2026-09-03T11:00:00.000Z", superseded_at: null },
  { id: "superseded", created_at: "2026-09-03T09:00:00.000Z", priority: "normal", removed_at: null, superseded_at: "2026-09-03T10:00:00.000Z" },
];

describe("staff alert presentation", () => {
  it("keeps every active alert visible and shows urgent alerts first", () => {
    expect(getOverviewStaffAlerts(alerts).map((alert) => alert.id)).toEqual(["urgent", "old", "normal"]);
  });

  it("shows only manually archived or previously superseded alerts in history", () => {
    expect(getHistoricalStaffAlerts(alerts).map((alert) => alert.id)).toEqual(["removed", "superseded"]);
  });
});
