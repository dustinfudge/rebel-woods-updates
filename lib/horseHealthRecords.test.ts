import { describe, expect, it } from "vitest";

import { latestHealthRecords, parseHealthRecordOption, vaccineOptions } from "./horseHealthRecords";
import type { Tables } from "../types/supabase";

type HealthRecord = Tables<"horse_health_records">;

function record(overrides: Partial<HealthRecord>): HealthRecord {
  return {
    id: "record-id",
    horse_id: "horse-id",
    record_kind: "vaccination",
    item_name: "Rabies",
    recorded_on: "2026-01-01",
    result_notes: "",
    recorded_by: "profile-id",
    created_at: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

describe("latestHealthRecords", () => {
  it("keeps the latest dated entry for each named item", () => {
    const records = [
      record({ id: "older", recorded_on: "2025-04-01" }),
      record({ id: "latest", recorded_on: "2026-04-01" }),
      record({ id: "coggins", record_kind: "test", item_name: "Coggins (EIA test)", recorded_on: "2026-02-01" }),
    ];

    expect(latestHealthRecords(records).map((item) => item.id)).toEqual(["latest", "coggins"]);
  });
});

describe("parseHealthRecordOption", () => {
  it("rejects an option that is not in the approved list", () => {
    expect(parseHealthRecordOption("vaccination|Unknown", vaccineOptions)).toBeNull();
  });
});
