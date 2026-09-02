import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfiguration } from "@/lib/environment";
import type { Database } from "@/types/supabase";

let supabaseBrowserClient: SupabaseClient<Database> | null = null;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (supabaseBrowserClient) {
    return supabaseBrowserClient;
  }

  const configuration = getSupabasePublicConfiguration();

  if (!configuration) {
    throw new Error("Supabase public configuration is missing.");
  }

  supabaseBrowserClient = createClient<Database>(configuration.url, configuration.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  return supabaseBrowserClient;
}
