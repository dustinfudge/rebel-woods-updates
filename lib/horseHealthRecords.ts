import type { Tables } from "@/types/supabase";

export type HorseHealthRecord = Tables<"horse_health_records">;
export type HorseHealthRecordKind = HorseHealthRecord["record_kind"];

export interface HealthRecordOption {
  readonly kind: HorseHealthRecordKind;
  readonly label: string;
  readonly isCustom?: boolean;
}

export const vaccineOptions: readonly HealthRecordOption[] = [
  { kind: "vaccination", label: "Tetanus" },
  { kind: "vaccination", label: "Eastern/Western Equine Encephalomyelitis (EEE/WEE)" },
  { kind: "vaccination", label: "West Nile Virus" },
  { kind: "vaccination", label: "Rabies" },
  { kind: "vaccination", label: "Equine Influenza" },
  { kind: "vaccination", label: "Equine Herpesvirus (EHV-1/EHV-4)" },
  { kind: "vaccination", label: "Strangles" },
  { kind: "vaccination", label: "Potomac Horse Fever" },
  { kind: "vaccination", label: "Botulism" },
  { kind: "vaccination", label: "Other vaccine", isCustom: true },
];

export const testAndDocumentOptions: readonly HealthRecordOption[] = [
  { kind: "test", label: "Coggins (EIA test)" },
  { kind: "test", label: "Fecal Egg Count" },
  { kind: "document", label: "Certificate of Veterinary Inspection (health certificate)" },
  { kind: "test", label: "Other veterinary test", isCustom: true },
];

export function healthRecordOptionValue(option: HealthRecordOption): string {
  return `${option.kind}|${option.label}`;
}

export function parseHealthRecordOption(
  encodedOption: string,
  options: readonly HealthRecordOption[],
): HealthRecordOption | null {
  return options.find((option) => healthRecordOptionValue(option) === encodedOption) ?? null;
}

export function latestHealthRecords(records: readonly HorseHealthRecord[]): readonly HorseHealthRecord[] {
  const latestByItem = new Map<string, HorseHealthRecord>();
  const newestFirst = [...records].sort((left, right) => {
    const dateComparison = right.recorded_on.localeCompare(left.recorded_on);
    return dateComparison !== 0 ? dateComparison : right.created_at.localeCompare(left.created_at);
  });
  for (const record of newestFirst) {
    const itemKey = `${record.record_kind}:${record.item_name.trim().toLocaleLowerCase()}`;
    if (!latestByItem.has(itemKey)) latestByItem.set(itemKey, record);
  }
  return [...latestByItem.values()];
}

export function formatHealthRecordDate(recordedOn: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(`${recordedOn}T12:00:00`));
}
