import type { Tables } from "@/types/supabase";

type Notification = Tables<"notifications">;

export interface HorseNotificationCounts {
  readonly replyCount: number;
  readonly otherCount: number;
}

export function getHorseNotificationCounts(
  notifications: readonly Notification[],
  horseId: string,
): HorseNotificationCounts {
  return notifications.reduce<HorseNotificationCounts>((counts, notification) => {
    if (notification.horse_id !== horseId || notification.read_at !== null) {
      return counts;
    }

    return notification.kind === "reply"
      ? { replyCount: counts.replyCount + 1, otherCount: counts.otherCount }
      : { replyCount: counts.replyCount, otherCount: counts.otherCount + 1 };
  }, { replyCount: 0, otherCount: 0 });
}
