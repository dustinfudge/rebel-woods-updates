import { withSupabase } from "npm:@supabase/server@^1";

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

function parseManagementRequest(value: unknown): WaiverManagementRequest | null {
  if (!isRecord(value)) return null;
  const submissionId = typeof value.submissionId === "string" ? value.submissionId.trim() : "";
  const action = value.action === "download" ? "download" : value.action === "delete" ? "delete" : null;
  return action && uuidPattern.test(submissionId) ? { action, submissionId } : null;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const managementRequest = parseManagementRequest(await request.json().catch((): null => null));
  if (!managementRequest) return jsonResponse(400, { error: "Choose a valid waiver action." });

  try {
    const userId = typeof context.userClaims?.sub === "string" ? context.userClaims.sub : null;
    if (!userId) return jsonResponse(401, { error: "Your session is no longer valid." });
    const profileResult = await context.supabase.from("profiles").select("organization_id, role, is_active").eq("id", userId).single();
    if (profileResult.error || profileResult.data.role !== "admin" || !profileResult.data.is_active) {
      return jsonResponse(403, { error: "Only an active administrator can manage guest waivers." });
    }

    const submissionResult = await context.supabase.from("guest_waiver_submissions").select("id, organization_id, pdf_storage_path").eq("id", managementRequest.submissionId).maybeSingle();
    if (submissionResult.error) throw new Error(`Waiver lookup failed: ${submissionResult.error.message}`);
    const submission = submissionResult.data as WaiverSubmission | null;
    if (!submission || submission.organization_id !== profileResult.data.organization_id) return jsonResponse(404, { error: "Guest waiver not found." });

    if (managementRequest.action === "download") {
      const signedUrlResult = await context.supabaseAdmin.storage.from("guest-waivers").createSignedUrl(submission.pdf_storage_path, 300, { download: true });
      if (signedUrlResult.error) throw new Error(`Waiver download failed: ${signedUrlResult.error.message}`);
      return jsonResponse(200, { signedUrl: signedUrlResult.data.signedUrl });
    }

    const storageResult = await context.supabaseAdmin.storage.from("guest-waivers").remove([submission.pdf_storage_path]);
    if (storageResult.error) throw new Error(`Waiver file deletion failed: ${storageResult.error.message}`);
    const deletionResult = await context.supabaseAdmin.from("guest_waiver_submissions").delete().eq("id", submission.id);
    if (deletionResult.error) throw new Error(`Waiver record deletion failed: ${deletionResult.error.message}`);
    return jsonResponse(200, { deleted: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "The guest waiver action failed.";
    console.error(message);
    return jsonResponse(500, { error: message });
  }
  }),
};
