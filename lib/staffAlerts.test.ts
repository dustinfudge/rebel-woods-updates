import { describe, expect, it } from "vitest";

import { getHistoricalStaffAlerts, getOverviewStaffAlerts } from "./staffAlerts";

interface TestAlert {
  readonly created_at: string;
  readonly id: string;
  readonly priority: "normal" | "urgent";
  readonly removed_at: string | null;
  readonly superseded_at: string | null;
}

const now = new Date("2026-09-03T12:00:00.000Z");
const alerts: readonly TestAlert[] = [
  { id: "normal", created_at: "2026-09-02T12:00:00.000Z", priority: "normal", removed_at: null, superseded_at: null },
  { id: "urgent", created_at: "2026-09-01T12:00:00.000Z", priority: "urgent", removed_at: null, superseded_at: null },
  { id: "old", created_at: "2026-08-01T12:00:00.000Z", priority: "urgent", removed_at: null, superseded_at: null },
  { id: "removed", created_at: "2026-09-03T10:00:00.000Z", priority: "normal", removed_at: "2026-09-03T11:00:00.000Z", superseded_at: null },
  { id: "superseded", created_at: "2026-09-03T09:00:00.000Z", priority: "normal", removed_at: null, superseded_at: "2026-09-03T10:00:00.000Z" },
];

describe("staff alert presentation", () => {
  it("shows urgent active alerts first for the rolling fourteen-day overview", () => {
    expect(getOverviewStaffAlerts(alerts, now).map((alert) => alert.id)).toEqual(["urgent", "normal"]);
  });

  it("moves old, removed, and superseded alerts into history", () => {
    expect(getHistoricalStaffAlerts(alerts, now).map((alert) => alert.id)).toEqual(["removed", "superseded", "old"]);
  });
});
