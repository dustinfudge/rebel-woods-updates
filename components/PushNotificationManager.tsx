"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getSupabasePublicConfiguration } from "@/lib/environment";
import { synchronizeApplicationBadge } from "@/lib/applicationBadge";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export interface PushNotificationManagerProps {
  readonly unreadMessageCount: number;
  readonly userId: string;
}

function decodeUrlBase64(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0)).buffer;
}

export function PushNotificationManager({ unreadMessageCount, userId }: PushNotificationManagerProps): React.JSX.Element | null {
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

  useEffect(() => {
    if (!message) {
      return;
    }

    const dismissalTimer = window.setTimeout(() => setMessage(null), 4_000);
    return () => window.clearTimeout(dismissalTimer);
  }, [message]);

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
    await synchronizeApplicationBadge(unreadMessageCount);
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
    await synchronizeApplicationBadge(0);
    setMessage("Push notifications are off for this device.");
  }

  if (!isSupported) {
    return null;
  }

  return (
    <div className="relative">
      <button aria-label={subscription ? "Turn off push notifications" : "Turn on push notifications"} className={`grid h-10 w-10 place-items-center rounded-full border ${subscription ? "border-[#1f5f8b] bg-[#e1eff8] text-[#1f5f8b]" : "border-[#dedfd8] bg-white text-[#385943]"}`} title={subscription ? "Push notifications are on" : "Turn on push notifications"} type="button" onClick={() => void (subscription ? disableNotifications() : enableNotifications())}>
        {subscription ? <BellOff aria-hidden="true" size={17} /> : <Bell aria-hidden="true" size={17} />}
      </button>
      {message ? <p className="absolute right-0 top-12 z-30 w-64 rounded-xl border border-[#dedfd8] bg-white p-3 text-xs font-semibold leading-5 text-[#385943] shadow-xl" role="status">{message}</p> : null}
    </div>
  );
}
