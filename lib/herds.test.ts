import { describe, expect, it } from "vitest";

import { getHerdRosterLabel } from "./herds";

interface TestHorse {
  readonly herd_id: string | null;
  readonly is_active: boolean;
  readonly name: string;
}

const horses: readonly TestHorse[] = [
  { herd_id: "herd-a", is_active: true, name: "Goose" },
  { herd_id: "herd-a", is_active: true, name: "Oreo" },
  { herd_id: "herd-b", is_active: true, name: "Dixie" },
  { herd_id: "herd-a", is_active: false, name: "Retired horse" },
];

describe("herd rosters", () => {
  it("builds labels from active horse assignments", () => {
    expect(getHerdRosterLabel("herd-a", horses)).toBe("Goose, Oreo");
    expect(getHerdRosterLabel("herd-b", horses)).toBe("Dixie");
  });

  it("labels unassigned and empty herds clearly", () => {
    expect(getHerdRosterLabel(null, horses)).toBe("Unassigned");
    expect(getHerdRosterLabel("herd-c", horses)).toBe("No horses assigned");
  });

  it("updates options from current membership", () => {
    const movedHorses = horses.map((horse) => horse.name === "Goose" ? { ...horse, herd_id: "herd-b" } : horse);
    expect(getHerdRosterLabel("herd-a", movedHorses)).toBe("Oreo");
    expect(getHerdRosterLabel("herd-b", movedHorses)).toBe("Dixie, Goose");
  });
});
