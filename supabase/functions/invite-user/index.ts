import { createClient } from "npm:@supabase/supabase-js@2";

type AppRole = "admin" | "owner" | "stable_hand";

interface InvitationRequest {
  readonly email: string;
  readonly fullName: string;
  readonly phone: string;
  readonly role: AppRole;
}

const responseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, string>): Response {
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

function parseInvitationRequest(value: unknown): InvitationRequest | null {
  if (!isRecord(value)) return null;
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const fullName = typeof value.fullName === "string" ? value.fullName.trim() : "";
  const phone = typeof value.phone === "string" ? value.phone.trim() : "";
  const role = value.role === "admin" ? "admin" : value.role === "stable_hand" ? "stable_hand" : value.role === "owner" ? "owner" : null;
  if (!email.includes("@") || fullName.length < 1 || fullName.length > 120 || phone.length > 50 || !role) return null;
  return { email, fullName, phone, role };
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

  const invitation = parseInvitationRequest(await request.json().catch((): null => null));
  if (!invitation) return jsonResponse(400, { error: "Enter a valid name, email, and role." });

  const authenticatedClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const administratorClient = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const accessToken = authorization.slice("Bearer ".length);
  const { data: userData, error: userError } = await authenticatedClient.auth.getUser(accessToken);
  if (userError || !userData.user) return jsonResponse(401, { error: "Your session is no longer valid." });

  const { data: administrator, error: profileError } = await authenticatedClient
    .from("profiles")
    .select("organization_id, role, is_active")
    .eq("id", userData.user.id)
    .single();
  if (profileError || administrator.role !== "admin" || !administrator.is_active) {
    return jsonResponse(403, { error: "Only an active administrator can invite people." });
  }

  const { data: invitationData, error: invitationError } = await administratorClient.auth.admin.inviteUserByEmail(
    invitation.email,
    { data: { full_name: invitation.fullName } },
  );
  if (invitationError) return jsonResponse(400, { error: invitationError.message });

  const { error: insertError } = await administratorClient.from("profiles").insert({
    id: invitationData.user.id,
    organization_id: administrator.organization_id,
    role: invitation.role,
    full_name: invitation.fullName,
    email: invitation.email,
    phone: invitation.phone,
  });
  if (insertError) {
    await administratorClient.auth.admin.deleteUser(invitationData.user.id);
    return jsonResponse(400, { error: insertError.message });
  }

  return jsonResponse(200, { message: `Invitation sent to ${invitation.email}.` });
});
