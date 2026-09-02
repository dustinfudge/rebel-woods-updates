import { describe, expect, it } from "vitest";

import { getMondayForDate, getPreviousWeekStartIsoDate, getWeeklyUpdateStatus, getWeekStartIsoDate, hasWeeklyUpdate } from "./week";

describe("weekly update calendar", () => {
  it("uses Monday as the first day of the week", () => {
    const sunday = new Date("2026-09-06T12:00:00");

    expect(getMondayForDate(sunday).getDay()).toBe(1);
    expect(getWeekStartIsoDate(sunday)).toBe("2026-08-31");
  });

  it("recognizes an update from the current Monday through Sunday week", () => {
    expect(hasWeeklyUpdate("2026-08-31", new Date("2026-09-04T12:00:00"))).toBe(true);
    expect(hasWeeklyUpdate("2026-08-24", new Date("2026-09-04T12:00:00"))).toBe(false);
  });

  it("finds the prior Monday", () => {
    expect(getPreviousWeekStartIsoDate(new Date("2026-09-04T12:00:00"))).toBe("2026-08-24");
  });

  it("prioritizes updated, missed, and weekend due-soon states", () => {
    expect(getWeeklyUpdateStatus(true, false, new Date("2026-09-02T12:00:00"))).toBe("updated");
    expect(getWeeklyUpdateStatus(false, false, new Date("2026-09-02T12:00:00"))).toBe("missed");
    expect(getWeeklyUpdateStatus(false, true, new Date("2026-09-05T12:00:00"))).toBe("due_soon");
    expect(getWeeklyUpdateStatus(false, true, new Date("2026-09-02T12:00:00"))).toBe("needs_update");
  });
});
