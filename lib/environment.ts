export interface SupabasePublicConfiguration {
  readonly url: string;
  readonly publishableKey: string;
}

export function getSupabasePublicConfiguration(): SupabasePublicConfiguration | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

export function getPagesBasePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}
