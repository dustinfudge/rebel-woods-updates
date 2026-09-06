import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type DeletionKind = "horse" | "person";
type StorageBucket = "conversation-media" | "horse-thumbnails" | "message-media" | "update-media";

interface DeletionRequest {
  readonly id: string;
  readonly kind: DeletionKind;
}

interface StoredMedia {
  readonly storage_bucket: StorageBucket;
  readonly storage_path: string;
}

interface StoredPath {
  readonly bucket: StorageBucket;
  readonly path: string;
}

interface IdentifiedRow {
  readonly id: string;
}

interface HorseDeletionTarget {
  readonly id: string;
  readonly is_active: boolean;
  readonly organization_id: string;
  readonly photo_path: string | null;
}

const responseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};
const storageBatchSize = 100;

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function configuredSecretKey(): string | null {
  const secretKeysValue = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysValue) {
    try {
      const parsedSecretKeys: unknown = JSON.parse(secretKeysValue);
      if (isRecord(parsedSecretKeys)) {
        const defaultSecretKey = parsedSecretKeys.default;
        if (typeof defaultSecretKey === "string" && defaultSecretKey.length > 0) return defaultSecretKey;
      }
    } catch { /* Fall back to the legacy server credential. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
}

function parseDeletionRequest(value: unknown): DeletionRequest | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const kind = value.kind === "horse" ? "horse" : value.kind === "person" ? "person" : null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) && kind ? { id, kind } : null;
}

function chunkItems<Item>(items: readonly Item[], size: number): readonly (readonly Item[])[] {
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function uniqueStoragePaths(paths: readonly StoredPath[]): readonly StoredPath[] {
  const uniquePaths = new Map(paths.map((path) => [`${path.bucket}:${path.path}`, path]));
  return [...uniquePaths.values()];
}

async function selectMediaByUploader(client: SupabaseClient, profileId: string): Promise<readonly StoredPath[]> {
  const [conversationResult, updateResult, messageResult] = await Promise.all([
    client.from("conversation_media").select("storage_bucket, storage_path").eq("uploaded_by", profileId),
    client.from("update_media").select("storage_path").eq("uploaded_by", profileId),
    client.from("message_media").select("storage_path").eq("uploaded_by", profileId),
  ]);
  const error = conversationResult.error ?? updateResult.error ?? messageResult.error;
  if (error) throw error;
  const conversationPaths = (conversationResult.data ?? []) as readonly StoredMedia[];
  const updatePaths = (updateResult.data ?? []) as readonly { readonly storage_path: string }[];
  const messagePaths = (messageResult.data ?? []) as readonly { readonly storage_path: string }[];
  return uniqueStoragePaths([
    ...conversationPaths.map((item) => ({ bucket: item.storage_bucket, path: item.storage_path })),
    ...updatePaths.map((item) => ({ bucket: "update-media" as const, path: item.storage_path })),
    ...messagePaths.map((item) => ({ bucket: "message-media" as const, path: item.storage_path })),
  ]);
}

async function selectHorseMedia(client: SupabaseClient, horse: HorseDeletionTarget): Promise<readonly StoredPath[]> {
  const paths: StoredPath[] = horse.photo_path ? [{ bucket: "horse-thumbnails", path: horse.photo_path }] : [];
  const [conversationResult, updateResult] = await Promise.all([
    client.from("horse_conversations").select("id").eq("horse_id", horse.id).maybeSingle(),
    client.from("weekly_updates").select("id").eq("horse_id", horse.id),
  ]);
  if (conversationResult.error) throw conversationResult.error;
  if (updateResult.error) throw updateResult.error;

  const conversationId = (conversationResult.data as IdentifiedRow | null)?.id;
  if (conversationId) {
    const messageResult = await client.from("conversation_messages").select("id").eq("conversation_id", conversationId);
    if (messageResult.error) throw messageResult.error;
    const messageIds = ((messageResult.data ?? []) as readonly IdentifiedRow[]).map((message) => message.id);
    for (const messageIdBatch of chunkItems(messageIds, storageBatchSize)) {
      const mediaResult = await client.from("conversation_media").select("storage_bucket, storage_path").in("message_id", [...messageIdBatch]);
      if (mediaResult.error) throw mediaResult.error;
      paths.push(...((mediaResult.data ?? []) as readonly StoredMedia[]).map((item) => ({ bucket: item.storage_bucket, path: item.storage_path })));
    }
  }

  const updateIds = ((updateResult.data ?? []) as readonly IdentifiedRow[]).map((update) => update.id);
  for (const updateIdBatch of chunkItems(updateIds, storageBatchSize)) {
    const [updateMediaResult, messageResult] = await Promise.all([
      client.from("update_media").select("storage_path").in("update_id", [...updateIdBatch]),
      client.from("messages").select("id").in("update_id", [...updateIdBatch]),
    ]);
    if (updateMediaResult.error) throw updateMediaResult.error;
    if (messageResult.error) throw messageResult.error;
    paths.push(...((updateMediaResult.data ?? []) as readonly { readonly storage_path: string }[]).map((item) => ({ bucket: "update-media", path: item.storage_path })));
    const messageIds = ((messageResult.data ?? []) as readonly IdentifiedRow[]).map((message) => message.id);
    for (const messageIdBatch of chunkItems(messageIds, storageBatchSize)) {
      const mediaResult = await client.from("message_media").select("storage_path").in("message_id", [...messageIdBatch]);
      if (mediaResult.error) throw mediaResult.error;
      paths.push(...((mediaResult.data ?? []) as readonly { readonly storage_path: string }[]).map((item) => ({ bucket: "message-media", path: item.storage_path })));
    }
  }

  return uniqueStoragePaths(paths);
}

async function removeStoredFiles(client: SupabaseClient, paths: readonly StoredPath[]): Promise<readonly string[]> {
  const failures: string[] = [];
  const pathsByBucket = new Map<StorageBucket, string[]>();
  for (const item of paths) pathsByBucket.set(item.bucket, [...(pathsByBucket.get(item.bucket) ?? []), item.path]);
  for (const [bucket, bucketPaths] of pathsByBucket) {
    for (const pathBatch of chunkItems(bucketPaths, storageBatchSize)) {
      const result = await client.storage.from(bucket).remove([...pathBatch]);
      if (result.error) failures.push(`${bucket}: ${result.error.message}`);
    }
  }
  return failures;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = configuredSecretKey();
  const publishableKey = request.headers.get("apikey");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !secretKey || !publishableKey || !authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "Authentication is required." });
  }

  const deletion = parseDeletionRequest(await request.json().catch((): null => null));
  if (!deletion) return jsonResponse(400, { error: "Choose a valid horse or person to delete." });

  const authenticatedClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const administratorClient = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const accessToken = authorization.slice("Bearer ".length);

  try {
    const { data: userData, error: userError } = await authenticatedClient.auth.getUser(accessToken);
    if (userError || !userData.user) return jsonResponse(401, { error: "Your session is no longer valid." });
    const profileResult = await authenticatedClient.from("profiles").select("organization_id, role, is_active").eq("id", userData.user.id).single();
    if (profileResult.error || profileResult.data.role !== "admin" || !profileResult.data.is_active) {
      return jsonResponse(403, { error: "Only an active administrator can permanently delete records." });
    }

    let storedPaths: readonly StoredPath[] = [];
    if (deletion.kind === "horse") {
      const horseResult = await administratorClient.from("horses").select("id, organization_id, photo_path, is_active").eq("id", deletion.id).maybeSingle();
      if (horseResult.error) throw horseResult.error;
      const horse = horseResult.data as HorseDeletionTarget | null;
      if (!horse || horse.organization_id !== profileResult.data.organization_id) return jsonResponse(404, { error: "Horse not found." });
      if (horse.is_active) return jsonResponse(409, { error: "Deactivate this horse before permanently deleting it." });
      storedPaths = await selectHorseMedia(administratorClient, horse);
      const deletionResult = await authenticatedClient.rpc("permanently_delete_horse", { target_horse_id: horse.id });
      if (deletionResult.error) throw deletionResult.error;
    } else {
      const targetResult = await administratorClient.from("profiles").select("id, organization_id, role, is_active").eq("id", deletion.id).maybeSingle();
      if (targetResult.error) throw targetResult.error;
      const target = targetResult.data;
      if (!target || target.organization_id !== profileResult.data.organization_id) return jsonResponse(404, { error: "Person not found." });
      if (target.role === "admin") return jsonResponse(409, { error: "Administrator accounts cannot be permanently deleted." });
      if (target.is_active) return jsonResponse(409, { error: "Deactivate this person before permanently deleting them." });
      storedPaths = await selectMediaByUploader(administratorClient, target.id);
      const deletionResult = await authenticatedClient.rpc("permanently_delete_person", { target_profile_id: target.id });
      if (deletionResult.error) throw deletionResult.error;
      const authDeletionResult = await administratorClient.auth.admin.deleteUser(target.id);
      if (authDeletionResult.error) console.error(`Auth account cleanup failed: ${authDeletionResult.error.message}`);
    }

    const storageFailures = await removeStoredFiles(administratorClient, storedPaths);
    if (storageFailures.length > 0) console.error(`Storage cleanup failures: ${storageFailures.join("; ")}`);
    return jsonResponse(200, { deleted: deletion.kind, removedFiles: storedPaths.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Permanent deletion failed.";
    console.error(message);
    return jsonResponse(500, { error: message });
  }
});
