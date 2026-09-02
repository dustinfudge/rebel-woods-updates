import { createClient } from "npm:@supabase/supabase-js@2";

interface OrganizationRetention {
  readonly id: string;
  readonly update_retention_days: number;
}

interface Identifier {
  readonly id: string;
}

interface StoragePath {
  readonly storage_path: string;
}

interface CleanupSummary {
  deletedUpdates: number;
  deletedUpdateMedia: number;
  deletedMessageMedia: number;
}

const updateBatchSize = 100;
const maximumUpdatesPerRun = 1_000;
const storageBatchSize = 1_000;
const millisecondsPerDay = 86_400_000;

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function chunkItems<Item>(items: readonly Item[], size: number): readonly (readonly Item[])[] {
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function uniqueStoragePaths(rows: readonly StoragePath[]): readonly string[] {
  return [...new Set(rows.map((row) => row.storage_path).filter((path) => path.length > 0))];
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const configuredCleanupSecret = Deno.env.get("RETENTION_CLEANUP_SECRET");
  const suppliedCleanupSecret = request.headers.get("x-retention-secret");
  if (!supabaseUrl || !serviceRoleKey || !configuredCleanupSecret) {
    return jsonResponse(500, { error: "Cleanup configuration is incomplete." });
  }
  if (!suppliedCleanupSecret || suppliedCleanupSecret !== configuredCleanupSecret) {
    return jsonResponse(401, { error: "Authentication is required." });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const summary: CleanupSummary = { deletedUpdates: 0, deletedUpdateMedia: 0, deletedMessageMedia: 0 };

  try {
    const organizationsResult = await client.from("organizations").select("id, update_retention_days").order("id");
    if (organizationsResult.error) throw organizationsResult.error;
    const organizations = (organizationsResult.data ?? []) as readonly OrganizationRetention[];

    for (const organization of organizations) {
      const cutoff = new Date(Date.now() - organization.update_retention_days * millisecondsPerDay).toISOString();

      while (summary.deletedUpdates < maximumUpdatesPerRun) {
        const updatesResult = await client
          .from("weekly_updates")
          .select("id")
          .eq("organization_id", organization.id)
          .not("published_at", "is", null)
          .lt("published_at", cutoff)
          .order("published_at", { ascending: true })
          .limit(Math.min(updateBatchSize, maximumUpdatesPerRun - summary.deletedUpdates));
        if (updatesResult.error) throw updatesResult.error;
        const expiredUpdates = (updatesResult.data ?? []) as readonly Identifier[];
        if (expiredUpdates.length === 0) break;

        const updateIds = expiredUpdates.map((update) => update.id);
        const [updateMediaResult, messagesResult] = await Promise.all([
          client.from("update_media").select("storage_path").in("update_id", updateIds),
          client.from("messages").select("id").in("update_id", updateIds),
        ]);
        if (updateMediaResult.error) throw updateMediaResult.error;
        if (messagesResult.error) throw messagesResult.error;

        const messages = (messagesResult.data ?? []) as readonly Identifier[];
        const messageIds = messages.map((message) => message.id);
        const messageMediaRows: StoragePath[] = [];
        for (const messageIdBatch of chunkItems(messageIds, updateBatchSize)) {
          const messageMediaResult = await client.from("message_media").select("storage_path").in("message_id", messageIdBatch);
          if (messageMediaResult.error) throw messageMediaResult.error;
          messageMediaRows.push(...((messageMediaResult.data ?? []) as readonly StoragePath[]));
        }

        const updateMediaPaths = uniqueStoragePaths((updateMediaResult.data ?? []) as readonly StoragePath[]);
        const messageMediaPaths = uniqueStoragePaths(messageMediaRows);
        for (const paths of chunkItems(updateMediaPaths, storageBatchSize)) {
          const removalResult = await client.storage.from("update-media").remove([...paths]);
          if (removalResult.error) throw removalResult.error;
        }
        for (const paths of chunkItems(messageMediaPaths, storageBatchSize)) {
          const removalResult = await client.storage.from("message-media").remove([...paths]);
          if (removalResult.error) throw removalResult.error;
        }

        const deletionResult = await client.from("weekly_updates").delete().in("id", updateIds);
        if (deletionResult.error) throw deletionResult.error;
        summary.deletedUpdates += updateIds.length;
        summary.deletedUpdateMedia += updateMediaPaths.length;
        summary.deletedMessageMedia += messageMediaPaths.length;
      }

      if (summary.deletedUpdates >= maximumUpdatesPerRun) break;
    }

    return jsonResponse(200, { ...summary, maximumReached: summary.deletedUpdates >= maximumUpdatesPerRun });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Cleanup failed.";
    console.error(message);
    return jsonResponse(500, { error: message, ...summary });
  }
});
