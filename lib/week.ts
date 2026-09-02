const MILLISECONDS_PER_DAY = 86_400_000;

export type WeeklyUpdateStatus = "updated" | "due_soon" | "needs_update" | "missed";

export function getMondayForDate(date: Date): Date {
  const monday = new Date(date);
  const mondayOffset = (date.getDay() + 6) % 7;
  monday.setHours(0, 0, 0, 0);
  monday.setTime(monday.getTime() - mondayOffset * MILLISECONDS_PER_DAY);
  return monday;
}

export function getWeekStartIsoDate(date: Date): string {
  return getMondayForDate(date).toISOString().slice(0, 10);
}

export function getPreviousWeekStartIsoDate(date: Date): string {
  const previousWeek = getMondayForDate(date);
  previousWeek.setTime(previousWeek.getTime() - 7 * MILLISECONDS_PER_DAY);
  return previousWeek.toISOString().slice(0, 10);
}

export function hasWeeklyUpdate(weekStart: string, referenceDate: Date): boolean {
  return weekStart === getWeekStartIsoDate(referenceDate);
}

export function getWeeklyUpdateStatus(hasCurrentUpdate: boolean, hasPreviousUpdate: boolean, referenceDate: Date): WeeklyUpdateStatus {
  if (hasCurrentUpdate) {
    return "updated";
  }

  if (!hasPreviousUpdate) {
    return "missed";
  }

  return referenceDate.getDay() === 0 || referenceDate.getDay() === 6 ? "due_soon" : "needs_update";
}
