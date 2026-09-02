"use client";

import { useEffect } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

function removeAuthenticationFragment(): void {
  const authenticationParameters = new URLSearchParams(window.location.hash.slice(1));
  const containsAuthenticationResult =
    authenticationParameters.has("access_token") ||
    authenticationParameters.has("error") ||
    authenticationParameters.has("error_code");

  if (containsAuthenticationResult) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

export function AuthSessionBootstrap(): null {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        removeAuthenticationFragment();
      }
    });

    const { data: authenticationSubscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        removeAuthenticationFragment();
      }
    });

    return (): void => authenticationSubscription.subscription.unsubscribe();
  }, []);

  return null;
}
