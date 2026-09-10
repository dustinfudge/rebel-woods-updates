import { createClient } from "npm:@supabase/supabase-js@2";

type WaiverAction = "delete" | "download";

interface WaiverManagementRequest {
  readonly action: WaiverAction;
  readonly submissionId: string;
}

interface WaiverSubmission {
  readonly id: string;
  readonly organization_id: string;
  readonly pdf_storage_path: string;
}

const responseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      if (isRecord(parsedSecretKeys) && typeof parsedSecretKeys.default === "string" && parsedSecretKeys.default.length > 0) {
        return parsedSecretKeys.default;
      }
    } catch { /* Fall back to the legacy server credential. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
}

function parseManagementRequest(value: unknown): WaiverManagementRequest | null {
  if (!isRecord(value)) return null;
  const submissionId = typeof value.submissionId === "string" ? value.submissionId.trim() : "";
  const action = value.action === "download" ? "download" : value.action === "delete" ? "delete" : null;
  return action && uuidPattern.test(submissionId) ? { action, submissionId } : null;
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

  const managementRequest = parseManagementRequest(await request.json().catch((): null => null));
  if (!managementRequest) return jsonResponse(400, { error: "Choose a valid waiver action." });

  const authenticatedClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const administratorClient = createClient(supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const accessToken = authorization.slice("Bearer ".length);

  try {
    const userResult = await authenticatedClient.auth.getUser(accessToken);
    if (userResult.error || !userResult.data.user) return jsonResponse(401, { error: "Your session is no longer valid." });
    const profileResult = await authenticatedClient.from("profiles").select("organization_id, role, is_active").eq("id", userResult.data.user.id).single();
    if (profileResult.error || profileResult.data.role !== "admin" || !profileResult.data.is_active) {
      return jsonResponse(403, { error: "Only an active administrator can manage guest waivers." });
    }

    const submissionResult = await authenticatedClient.from("guest_waiver_submissions").select("id, organization_id, pdf_storage_path").eq("id", managementRequest.submissionId).maybeSingle();
    if (submissionResult.error) throw new Error(`Waiver lookup failed: ${submissionResult.error.message}`);
    const submission = submissionResult.data as WaiverSubmission | null;
    if (!submission || submission.organization_id !== profileResult.data.organization_id) return jsonResponse(404, { error: "Guest waiver not found." });

    if (managementRequest.action === "download") {
      const signedUrlResult = await administratorClient.storage.from("guest-waivers").createSignedUrl(submission.pdf_storage_path, 300, { download: true });
      if (signedUrlResult.error) throw new Error(`Waiver download failed: ${signedUrlResult.error.message}`);
      return jsonResponse(200, { signedUrl: signedUrlResult.data.signedUrl });
    }

    const storageResult = await administratorClient.storage.from("guest-waivers").remove([submission.pdf_storage_path]);
    if (storageResult.error) throw new Error(`Waiver file deletion failed: ${storageResult.error.message}`);
    const deletionResult = await administratorClient.from("guest_waiver_submissions").delete().eq("id", submission.id);
    if (deletionResult.error) throw new Error(`Waiver record deletion failed: ${deletionResult.error.message}`);
    return jsonResponse(200, { deleted: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "The guest waiver action failed.";
    console.error(message);
    return jsonResponse(500, { error: message });
  }
});
