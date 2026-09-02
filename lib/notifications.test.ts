import { describe, expect, it } from "vitest";

import { getHorseNotificationCounts } from "./notifications";
import type { Tables } from "../types/supabase";

type Notification = Tables<"notifications">;

function notification(overrides: Partial<Notification>): Notification {
  return {
    id: "notification-1",
    user_id: "user-1",
    horse_id: "horse-1",
    update_id: "update-1",
    message_id: null,
    kind: "care_change",
    title: "Care changed",
    body: "Review the care card.",
    read_at: null,
    push_sent_at: null,
    created_at: "2026-09-02T12:00:00.000Z",
    ...overrides,
  };
}

describe("horse notification counts", () => {
  it("separates unread replies from other horse alerts", () => {
    const notifications = [
      notification({ id: "reply-1", kind: "reply", message_id: "message-1" }),
      notification({ id: "reply-2", kind: "reply", message_id: "message-2" }),
      notification({ id: "care-1", kind: "care_change" }),
    ];

    expect(getHorseNotificationCounts(notifications, "horse-1")).toEqual({ replyCount: 2, otherCount: 1 });
  });

  it("ignores read notifications and alerts for other horses", () => {
    const notifications = [
      notification({ id: "read-reply", kind: "reply", read_at: "2026-09-02T12:05:00.000Z" }),
      notification({ id: "other-horse", horse_id: "horse-2", kind: "reply" }),
    ];

    expect(getHorseNotificationCounts(notifications, "horse-1")).toEqual({ replyCount: 0, otherCount: 0 });
  });
});
