interface StaffAlertRecord {
  readonly created_at: string;
  readonly priority: "normal" | "urgent";
  readonly removed_at: string | null;
  readonly superseded_at: string | null;
}

function newestFirst(left: StaffAlertRecord, right: StaffAlertRecord): number {
  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}

export function getOverviewStaffAlerts<Alert extends StaffAlertRecord>(alerts: readonly Alert[]): readonly Alert[] {
  return alerts
    .filter((alert) => alert.removed_at === null && alert.superseded_at === null)
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority === "urgent" ? -1 : 1;
      return newestFirst(left, right);
    });
}

export function getHistoricalStaffAlerts<Alert extends StaffAlertRecord>(alerts: readonly Alert[]): readonly Alert[] {
  return alerts
    .filter((alert) => alert.removed_at !== null || alert.superseded_at !== null)
    .sort(newestFirst);
}
