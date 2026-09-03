interface HerdHorseRecord {
  readonly herd_id: string | null;
  readonly is_active: boolean;
  readonly name: string;
}

export function getHerdRosterLabel(herdId: string | null, horses: readonly HerdHorseRecord[]): string {
  if (!herdId) return "Unassigned";
  const memberNames = horses
    .filter((horse) => horse.is_active && horse.herd_id === herdId)
    .map((horse) => horse.name)
    .sort((left, right) => left.localeCompare(right));
  return memberNames.length > 0 ? memberNames.join(", ") : "No horses assigned";
}
