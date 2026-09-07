import { createClient } from "npm:@supabase/supabase-js@2";

interface OrganizationRetention {
  readonly id: string;
  readonly update_retention_days: number;
}

interface ExpiredConversationMessage {
  readonly id: string;
}

interface HorseConversation {
  readonly id: string;
}

interface StoredConversationMedia {
  readonly storage_bucket: "conversation-media" | "update-media" | "message-media";
  readonly storage_path: string;
}

interface CleanupSummary {
  deletedMessages: number;
  deletedMedia: number;
}

const messageBatchSize = 100;
const maximumMessagesPerRun = 1_000;
const storageBatchSize = 1_000;
const millisecondsPerDay = 86_400_000;

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "Cleanup failed.";
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
    } catch {
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
}

function chunkItems<Item>(items: readonly Item[], size: number): readonly (readonly Item[])[] {
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function groupStoragePathsByBucket(rows: readonly StoredConversationMedia[]): ReadonlyMap<string, readonly string[]> {
  const pathsByBucket = new Map<string, Set<string>>();
  for (const row of rows) {
    const paths = pathsByBucket.get(row.storage_bucket) ?? new Set<string>();
    if (row.storage_path.length > 0) paths.add(row.storage_path);
    pathsByBucket.set(row.storage_bucket, paths);
  }
  return new Map([...pathsByBucket].map(([bucket, paths]) => [bucket, [...paths]]));
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = configuredSecretKey();
  const configuredCleanupSecret = Deno.env.get("RETENTION_CLEANUP_SECRET");
  const suppliedCleanupSecret = request.headers.get("x-retention-secret");
  if (!supabaseUrl || !secretKey || !configuredCleanupSecret) {
    return jsonResponse(500, { error: "Cleanup configuration is incomplete." });
  }
  if (!suppliedCleanupSecret || suppliedCleanupSecret !== configuredCleanupSecret) {
    return jsonResponse(401, { error: "Authentication is required." });
  }

  const client = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const summary: CleanupSummary = { deletedMessages: 0, deletedMedia: 0 };

  try {
    const organizationsResult = await client.from("organizations").select("id, update_retention_days").order("id");
    if (organizationsResult.error) throw organizationsResult.error;
    const organizations = (organizationsResult.data ?? []) as readonly OrganizationRetention[];

    for (const organization of organizations) {
      const cutoff = new Date(Date.now() - organization.update_retention_days * millisecondsPerDay).toISOString();
      const conversationsResult = await client
        .from("horse_conversations")
        .select("id")
        .eq("organization_id", organization.id);
      if (conversationsResult.error) throw conversationsResult.error;
      const conversationIds = ((conversationsResult.data ?? []) as readonly HorseConversation[]).map(
        (conversation) => conversation.id,
      );
      if (conversationIds.length === 0) continue;

      while (summary.deletedMessages < maximumMessagesPerRun) {
        const messagesResult = await client
          .from("conversation_messages")
          .select("id")
          .in("conversation_id", conversationIds)
          .lt("created_at", cutoff)
          .order("created_at", { ascending: true })
          .limit(Math.min(messageBatchSize, maximumMessagesPerRun - summary.deletedMessages));
        if (messagesResult.error) throw messagesResult.error;
        const expiredMessages = (messagesResult.data ?? []) as readonly ExpiredConversationMessage[];
        if (expiredMessages.length === 0) break;

        const messageIds = expiredMessages.map((message) => message.id);
        const storedMedia: StoredConversationMedia[] = [];
        for (const messageIdBatch of chunkItems(messageIds, messageBatchSize)) {
          const mediaResult = await client
            .from("conversation_media")
            .select("storage_bucket, storage_path")
            .in("message_id", messageIdBatch);
          if (mediaResult.error) throw mediaResult.error;
          storedMedia.push(...((mediaResult.data ?? []) as readonly StoredConversationMedia[]));
        }

        for (const [bucket, paths] of groupStoragePathsByBucket(storedMedia)) {
          for (const pathBatch of chunkItems(paths, storageBatchSize)) {
            const removalResult = await client.storage.from(bucket).remove([...pathBatch]);
            if (removalResult.error) throw removalResult.error;
          }
        }

        const deletionResult = await client.from("conversation_messages").delete().in("id", messageIds);
        if (deletionResult.error) throw deletionResult.error;
        summary.deletedMessages += messageIds.length;
        summary.deletedMedia += storedMedia.length;
      }

      if (summary.deletedMessages >= maximumMessagesPerRun) break;
    }

    return jsonResponse(200, { ...summary, maximumReached: summary.deletedMessages >= maximumMessagesPerRun });
  } catch (error: unknown) {
    const message = errorMessage(error);
    console.error(message);
    return jsonResponse(500, { error: message, ...summary });
  }
});
