"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getSupabasePublicConfiguration } from "@/lib/environment";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export interface PushNotificationManagerProps {
  readonly userId: string;
}

function decodeUrlBase64(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0)).buffer;
}

export function PushNotificationManager({ userId }: PushNotificationManagerProps): React.JSX.Element {
  const [isSupported, setIsSupported] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const supabase = useMemo(
    () => (getSupabasePublicConfiguration() ? getSupabaseBrowserClient() : null),
    [],
  );
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    void navigator.serviceWorker.ready
      .then(async (registration) => {
        const existingSubscription = await registration.pushManager.getSubscription();
        setIsSupported(true);
        setSubscription(existingSubscription);
      });
  }, []);

  async function enableNotifications(): Promise<void> {
    if (!supabase || !vapidPublicKey) {
      setMessage("Push notifications will be available after setup is connected.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMessage("Notifications remain off. You can enable them later in your browser settings.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const nextSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeUrlBase64(vapidPublicKey),
    });
    const serializedSubscription = nextSubscription.toJSON();
    const p256dhKey = serializedSubscription.keys?.p256dh;
    const authKey = serializedSubscription.keys?.auth;

    if (!serializedSubscription.endpoint || !p256dhKey || !authKey) {
      await nextSubscription.unsubscribe();
      setMessage("This device could not finish notification setup.");
      return;
    }

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: serializedSubscription.endpoint,
        p256dh_key: p256dhKey,
        auth_key: authKey,
      },
      { onConflict: "user_id,endpoint" },
    );

    if (error) {
      await nextSubscription.unsubscribe();
      setMessage("This device could not save notification preferences.");
      return;
    }

    setSubscription(nextSubscription);
    setMessage("Push notifications are on for this device.");
  }

  async function disableNotifications(): Promise<void> {
    if (!subscription || !supabase) {
      return;
    }

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
    setSubscription(null);
    setMessage("Push notifications are off for this device.");
  }

  if (!isSupported) {
    return <p className="text-sm text-[#68736b]">Push notifications are not supported on this device.</p>;
  }

  return (
    <div>
      <button className="inline-flex items-center gap-2 rounded-full bg-[#1d3528] px-4 py-3 text-sm font-bold text-white" type="button" onClick={() => void (subscription ? disableNotifications() : enableNotifications())}>
        {subscription ? <BellOff aria-hidden="true" size={17} /> : <Bell aria-hidden="true" size={17} />}
        {subscription ? "Turn off push notifications" : "Turn on push notifications"}
      </button>
      {message ? <p className="mt-2 text-xs text-[#68736b]" role="status">{message}</p> : null}
    </div>
  );
}
