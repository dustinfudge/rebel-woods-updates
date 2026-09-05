import { rawPayload, sendPushNotification } from "@mmmike/web-push/send";
import { withSupabase } from "@supabase/server";

interface NotificationRecord {
  readonly body: string;
  readonly horse_id: string | null;
  readonly id: string;
  readonly kind: "care_change" | "medication_change" | "reply" | "weekly_update";
  readonly push_sent_at: string | null;
  readonly title: string;
  readonly user_id: string;
}

interface PushSubscriptionRecord {
  readonly auth_key: string;
  readonly endpoint: string;
  readonly id: string;
  readonly p256dh_key: string;
}

interface NotificationWebhookPayload {
  readonly record: { readonly id: string };
  readonly schema: "public";
  readonly table: "notifications";
  readonly type: "INSERT";
}

interface PushDeliveryResult {
  readonly status: "delivered" | "failed" | "gone";
  readonly subscriptionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWebhookPayload(value: unknown): NotificationWebhookPayload | null {
  if (!isRecord(value) || value.type !== "INSERT" || value.schema !== "public" || value.table !== "notifications") return null;
  if (!isRecord(value.record) || typeof value.record.id !== "string") return null;
  return { type: "INSERT", schema: "public", table: "notifications", record: { id: value.record.id } };
}

function isTrustedPushEndpoint(endpoint: string): boolean {
  try {
    const endpointUrl = new URL(endpoint);
    const host = endpointUrl.hostname;
    return endpointUrl.protocol === "https:" && (
      host === "fcm.googleapis.com"
      || host === "push.services.mozilla.com"
      || host.endsWith(".push.services.mozilla.com")
      || host === "push.apple.com"
      || host.endsWith(".push.apple.com")
    );
  } catch {
    return false;
  }
}

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return Response.json(body, { status });
}

const pushNotificationHandler = withSupabase({ auth: "none" }, async (request, context): Promise<Response> => {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const configuredWebhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  const suppliedWebhookSecret = request.headers.get("x-push-webhook-secret");
  if (!configuredWebhookSecret || suppliedWebhookSecret !== configuredWebhookSecret) {
    return jsonResponse(401, { error: "Authentication is required." });
  }

  const payload = parseWebhookPayload(await request.json().catch((): null => null));
  if (!payload) return jsonResponse(400, { error: "Invalid notification webhook payload." });

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const applicationUrl = Deno.env.get("PWA_BASE_URL");
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject || !applicationUrl) {
    return jsonResponse(500, { error: "Push delivery configuration is incomplete." });
  }

  const supabase = context.supabaseAdmin;
  const notificationResult = await supabase
    .from("notifications")
    .select("id,user_id,horse_id,kind,title,body,push_sent_at")
    .eq("id", payload.record.id)
    .maybeSingle();
  if (notificationResult.error) return jsonResponse(500, { error: "The notification could not be loaded." });

  const notification = notificationResult.data as NotificationRecord | null;
  if (!notification || notification.kind !== "reply" || notification.push_sent_at) {
    return jsonResponse(200, { delivered: 0, skipped: true });
  }

  const [subscriptionsResult, unreadCountResult] = await Promise.all([
    supabase.from("push_subscriptions").select("id,endpoint,p256dh_key,auth_key").eq("user_id", notification.user_id),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", notification.user_id).eq("kind", "reply").is("read_at", null),
  ]);
  if (subscriptionsResult.error || unreadCountResult.error) {
    return jsonResponse(500, { error: "Push delivery information could not be loaded." });
  }

  const subscriptions = (subscriptionsResult.data ?? []) as readonly PushSubscriptionRecord[];
  const unreadMessageCount = unreadCountResult.count ?? 1;
  const baseUrl = new URL(applicationUrl);
  const destinationUrl = new URL(baseUrl.href);
  if (notification.horse_id) destinationUrl.searchParams.set("horse", notification.horse_id);
  const pushMessage = rawPayload(JSON.stringify({
    badgeCount: unreadMessageCount,
    body: notification.body,
    title: notification.title,
    url: destinationUrl.href,
  }));

  const deliveryResults = await Promise.all(subscriptions.map(async (subscription): Promise<PushDeliveryResult> => {
    if (!isTrustedPushEndpoint(subscription.endpoint)) {
      return { status: "gone", subscriptionId: subscription.id };
    }

    try {
      const delivered = await sendPushNotification(
        { endpoint: subscription.endpoint, keys: { auth: subscription.auth_key, p256dh: subscription.p256dh_key } },
        pushMessage,
        { privateKey: vapidPrivateKey, publicKey: vapidPublicKey, subject: vapidSubject },
        { ttl: 86_400, urgency: "normal" },
      );
      return { status: delivered ? "delivered" : "gone", subscriptionId: subscription.id };
    } catch {
      return { status: "failed", subscriptionId: subscription.id };
    }
  }));

  const deliveredCount = deliveryResults.filter((result) => result.status === "delivered").length;
  const expiredSubscriptionIds = deliveryResults.filter((result) => result.status === "gone").map((result) => result.subscriptionId);
  const failedCount = deliveryResults.filter((result) => result.status === "failed").length;
  if (expiredSubscriptionIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expiredSubscriptionIds);
  }
  if (deliveredCount > 0) {
    await supabase.from("notifications").update({ push_sent_at: new Date().toISOString() }).eq("id", notification.id);
  }

  return jsonResponse(200, { delivered: deliveredCount, failed: failedCount, removedSubscriptions: expiredSubscriptionIds.length });
});

Deno.serve(pushNotificationHandler);
