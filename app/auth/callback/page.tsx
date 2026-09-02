"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { getPagesBasePath, getSupabasePublicConfiguration } from "@/lib/environment";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export default function AuthCallbackPage(): React.JSX.Element {
  const isConfigured = getSupabasePublicConfiguration() !== null;
  const [message, setMessage] = useState(
    isConfigured ? "Securely signing you in…" : "The Supabase connection has not been configured yet.",
  );

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const redirectToApp = (): void => {
      window.location.replace(`${window.location.origin}${getPagesBasePath()}/`);
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setMessage("This sign-in link is invalid or has expired. Please request a new one.");
        return;
      }

      if (data.session) {
        redirectToApp();
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        redirectToApp();
      }
    });

    return (): void => subscription.subscription.unsubscribe();
  }, [isConfigured]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f3e9] px-5">
      <div className="text-center">
        <Image className="mx-auto mb-5 h-20 w-20 rounded-full" src={`${getPagesBasePath()}/icon-192.png`} alt="Rebel Woods Boarding" width={80} height={80} priority />
        <p className="font-serif text-2xl text-[#14261d]" role="status">{message}</p>
      </div>
    </main>
  );
}
