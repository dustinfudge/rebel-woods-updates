import { PDFDocument, StandardFonts, type PDFPage, type PDFFont, rgb } from "npm:pdf-lib@1.17.1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

interface GuestMinor {
  readonly fullName: string;
  readonly birthDate: string;
}

interface GuestWaiverRequest {
  readonly stableSlug: string;
  readonly waiverVersionId: string;
  readonly adultName: string;
  readonly horseName: string;
  readonly minors: readonly GuestMinor[];
  readonly email: string | null;
  readonly emailCopyRequested: boolean;
  readonly typedSignatureName: string;
  readonly signatureDataUrl: string;
  readonly accepted: true;
  readonly startedAt: string;
}

interface WaiverVersion {
  readonly id: string;
  readonly organization_id: string;
  readonly title: string;
  readonly version_label: string;
  readonly template_storage_path: string;
  readonly template_sha256: string;
  readonly is_active: boolean;
}

interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

const responseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maximumRequestBytes = 2_500_000;
const maximumSignatureBytes = 1_500_000;
const rateLimitWindowMilliseconds = 60 * 60 * 1000;
const maximumAttemptsPerWindow = 5;

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

function cleanedText(value: unknown, maximumLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximumLength) : "";
}

function parseMinor(value: unknown): GuestMinor | null {
  if (!isRecord(value)) return null;
  const fullName = cleanedText(value.fullName, 160);
  const birthDate = cleanedText(value.birthDate, 10);
  if (!fullName || !datePattern.test(birthDate)) return null;
  const parsedBirthDate = new Date(`${birthDate}T12:00:00Z`);
  const earliestBirthDate = new Date("1900-01-01T12:00:00Z");
  const latestBirthDate = new Date();
  if (Number.isNaN(parsedBirthDate.getTime()) || parsedBirthDate < earliestBirthDate || parsedBirthDate > latestBirthDate) return null;
  return { fullName, birthDate };
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function parseWaiverRequest(value: unknown): GuestWaiverRequest | null {
  if (!isRecord(value)) return null;
  const stableSlug = cleanedText(value.stableSlug, 80).toLocaleLowerCase("en-US");
  const waiverVersionId = cleanedText(value.waiverVersionId, 36);
  const adultName = cleanedText(value.adultName, 160);
  const horseName = cleanedText(value.horseName, 160);
  const typedSignatureName = cleanedText(value.typedSignatureName, 160);
  const emailText = cleanedText(value.email, 320).toLocaleLowerCase("en-US");
  const email = emailText || null;
  const emailCopyRequested = value.emailCopyRequested === true;
  const signatureDataUrl = typeof value.signatureDataUrl === "string" ? value.signatureDataUrl : "";
  const startedAt = cleanedText(value.startedAt, 40);
  const accepted = value.accepted === true;
  const website = cleanedText(value.website, 200);
  const rawMinors = Array.isArray(value.minors) ? value.minors : [];
  const minors = rawMinors.map(parseMinor);

  if (
    website
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stableSlug)
    || !uuidPattern.test(waiverVersionId)
    || !adultName
    || !horseName
    || !typedSignatureName
    || normalizedName(adultName) !== normalizedName(typedSignatureName)
    || rawMinors.length > 10
    || minors.some((minor) => minor === null)
    || (email !== null && !emailPattern.test(email))
    || (emailCopyRequested && email === null)
    || !signatureDataUrl.startsWith("data:image/png;base64,")
    || !accepted
  ) return null;

  const startTime = Date.parse(startedAt);
  const completionTime = Date.now() - startTime;
  if (!Number.isFinite(startTime) || completionTime < 5_000 || completionTime > 86_400_000) return null;

  return {
    stableSlug,
    waiverVersionId,
    adultName,
    horseName,
    minors: minors.filter((minor): minor is GuestMinor => minor !== null),
    email,
    emailCopyRequested,
    typedSignatureName,
    signatureDataUrl,
    accepted: true,
    startedAt,
  };
}

function decodeSignature(dataUrl: string): Uint8Array {
  const encodedSignature = dataUrl.slice("data:image/png;base64,".length);
  const decodedSignature = atob(encodedSignature);
  if (decodedSignature.length < 50 || decodedSignature.length > maximumSignatureBytes) {
    throw new Error("The drawn signature is invalid or too large.");
  }
  return Uint8Array.from(decodedSignature, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 32_768;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestNetworkAddress(request: Request): string {
  const forwardedAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const connectingAddress = request.headers.get("cf-connecting-ip")?.trim();
  return connectingAddress || forwardedAddress || "unknown";
}

async function enforceRateLimit(client: SupabaseClient, rateKey: string): Promise<boolean> {
  const currentTime = new Date();
  const result = await client.from("guest_waiver_rate_limits").select("window_started_at, attempt_count").eq("rate_key", rateKey).maybeSingle();
  if (result.error) throw new Error(`Rate-limit check failed: ${result.error.message}`);
  if (!result.data || currentTime.getTime() - Date.parse(result.data.window_started_at) >= rateLimitWindowMilliseconds) {
    const resetResult = await client.from("guest_waiver_rate_limits").upsert({
      rate_key: rateKey,
      window_started_at: currentTime.toISOString(),
      attempt_count: 1,
      updated_at: currentTime.toISOString(),
    });
    if (resetResult.error) throw new Error(`Rate-limit reset failed: ${resetResult.error.message}`);
    return true;
  }
  if (result.data.attempt_count >= maximumAttemptsPerWindow) return false;
  const updateResult = await client.from("guest_waiver_rate_limits").update({
    attempt_count: result.data.attempt_count + 1,
    updated_at: currentTime.toISOString(),
  }).eq("rate_key", rateKey);
  if (updateResult.error) throw new Error(`Rate-limit update failed: ${updateResult.error.message}`);
  return true;
}

function fittedFontSize(font: PDFFont, text: string, maximumWidth: number, preferredSize: number, minimumSize = 5): number {
  let fontSize = preferredSize;
  while (fontSize > minimumSize && font.widthOfTextAtSize(text, fontSize) > maximumWidth) fontSize -= 0.5;
  return fontSize;
}

function drawFittedText(page: PDFPage, font: PDFFont, text: string, x: number, y: number, maximumWidth: number, preferredSize = 9): void {
  page.drawText(text, { x, y, font, size: fittedFontSize(font, text, maximumWidth, preferredSize), color: rgb(0.05, 0.05, 0.05) });
}

function wrapText(font: PDFFont, text: string, maximumWidth: number, fontSize: number): readonly string[] {
  const lines: string[] = [];
  let currentLine = "";
  for (const word of text.split(/\s+/)) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maximumWidth) currentLine = candidate;
    else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function formattedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(date);
}

function drawAuditPage(pdfDocument: PDFDocument, regularFont: PDFFont, boldFont: PDFFont, request: GuestWaiverRequest, version: WaiverVersion, confirmationNumber: string, submittedAt: Date, signatureImage: Awaited<ReturnType<PDFDocument["embedPng"]>>): void {
  const page = pdfDocument.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 720, width: 612, height: 72, color: rgb(0.11, 0.21, 0.16) });
  page.drawText("ELECTRONIC SUBMISSION RECORD", { x: 54, y: 754, font: boldFont, size: 16, color: rgb(1, 1, 1) });
  page.drawText("Attached to the Rebel Woods, LLC. Release Agreement", { x: 54, y: 734, font: regularFont, size: 10, color: rgb(0.83, 0.88, 0.84) });

  const entries: readonly [string, string][] = [
    ["Confirmation", confirmationNumber],
    ["Submitted", `${formattedDate(submittedAt)} at ${submittedAt.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`],
    ["Adult guest", request.adultName],
    ["Horse", request.horseName],
    ["Waiver version", version.version_label],
    ["Template SHA-256", version.template_sha256],
  ];
  let y = 684;
  for (const [label, text] of entries) {
    page.drawText(label.toUpperCase(), { x: 54, y, font: boldFont, size: 8, color: rgb(0.22, 0.35, 0.26) });
    const lines = wrapText(regularFont, text, 390, 10);
    lines.forEach((line, lineIndex) => page.drawText(line, { x: 168, y: y - lineIndex * 14, font: regularFont, size: 10, color: rgb(0.08, 0.15, 0.11) }));
    y -= Math.max(34, lines.length * 14 + 12);
  }

  page.drawText("MINOR RIDERS", { x: 54, y, font: boldFont, size: 10, color: rgb(0.22, 0.35, 0.26) });
  y -= 22;
  if (request.minors.length === 0) {
    page.drawText("None listed", { x: 54, y, font: regularFont, size: 10, color: rgb(0.3, 0.35, 0.31) });
    y -= 28;
  } else {
    for (const [index, minor] of request.minors.entries()) {
      const birthDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${minor.birthDate}T12:00:00Z`));
      page.drawText(`${index + 1}. ${minor.fullName} - Date of birth: ${birthDate}`, { x: 54, y, font: regularFont, size: 10, color: rgb(0.08, 0.15, 0.11) });
      y -= 18;
    }
    y -= 10;
  }

  page.drawText("ELECTRONIC SIGNATURE", { x: 54, y, font: boldFont, size: 10, color: rgb(0.22, 0.35, 0.26) });
  y -= 62;
  const scaledSignature = signatureImage.scaleToFit(220, 52);
  page.drawImage(signatureImage, { x: 54, y, width: scaledSignature.width, height: scaledSignature.height });
  page.drawLine({ start: { x: 54, y: y - 4 }, end: { x: 300, y: y - 4 }, thickness: 0.75, color: rgb(0.3, 0.3, 0.3) });
  page.drawText(request.typedSignatureName, { x: 54, y: y - 22, font: regularFont, size: 10, color: rgb(0.08, 0.15, 0.11) });
  page.drawText("Typed name", { x: 54, y: y - 36, font: regularFont, size: 7, color: rgb(0.4, 0.44, 0.41) });
  page.drawText("The signer confirmed that they read the full waiver and intended this electronic signature to be legally binding.", { x: 54, y: 58, font: regularFont, size: 8, color: rgb(0.3, 0.35, 0.31) });
}

async function completeWaiver(templateBytes: Uint8Array, request: GuestWaiverRequest, version: WaiverVersion, confirmationNumber: string, submittedAt: Date): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(templateBytes);
  if (pdfDocument.getPageCount() !== 3) throw new Error("The active waiver template must contain exactly three pages.");
  const regularFont = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);
  const signatureImage = await pdfDocument.embedPng(decodeSignature(request.signatureDataUrl));
  const pageOne = pdfDocument.getPage(0);
  const pageThree = pdfDocument.getPage(2);
  const submittedParts = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "long", year: "2-digit", timeZone: "America/New_York" }).formatToParts(submittedAt);
  const datePart = (partType: "day" | "month" | "year"): string => submittedParts.find((part) => part.type === partType)?.value ?? "";
  const minorSummary = request.minors.map((minor) => minor.fullName).join(", ") || "None";

  drawFittedText(pageOne, regularFont, datePart("day"), 171, 654, 60, 9);
  drawFittedText(pageOne, regularFont, datePart("month"), 273, 654, 66, 9);
  drawFittedText(pageOne, regularFont, datePart("year"), 364, 654, 13, 8);
  drawFittedText(pageOne, regularFont, request.adultName, 403, 654, 116, 9);
  drawFittedText(pageOne, regularFont, request.horseName, 107, 462, 88, 9);
  drawFittedText(pageOne, regularFont, minorSummary, 92, 446, 145, 8);
  drawFittedText(pageOne, regularFont, request.horseName, 413, 270, 106, 9);

  const primarySignature = signatureImage.scaleToFit(204, 35);
  pageThree.drawImage(signatureImage, { x: 240, y: 290, width: primarySignature.width, height: primarySignature.height });
  drawFittedText(pageThree, regularFont, request.typedSignatureName, 316, 258, 132, 9);
  if (request.minors.length > 0) {
    const guardianSignature = signatureImage.scaleToFit(204, 35);
    pageThree.drawImage(signatureImage, { x: 240, y: 178, width: guardianSignature.width, height: guardianSignature.height });
    drawFittedText(pageThree, regularFont, request.typedSignatureName, 316, 146, 132, 9);
  }

  drawAuditPage(pdfDocument, regularFont, boldFont, request, version, confirmationNumber, submittedAt, signatureImage);
  pdfDocument.setTitle(`${version.title} - ${request.adultName}`);
  pdfDocument.setSubject(`Guest liability waiver for ${request.horseName}`);
  pdfDocument.setCreator("Rebel Woods Guest Waiver");
  pdfDocument.setCreationDate(submittedAt);
  return await pdfDocument.save();
}

async function sendEmailCopy(email: string, organizationName: string, confirmationNumber: string, pdfBytes: Uint8Array): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return false;
  const sender = Deno.env.get("WAIVER_FROM_EMAIL") ?? "Rebel Woods <updates@rebelwoods.com>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: [email],
        subject: `${organizationName} guest waiver ${confirmationNumber}`,
        text: `Your completed ${organizationName} guest liability waiver is attached. Confirmation: ${confirmationNumber}.`,
        attachments: [{ filename: `${confirmationNumber}.pdf`, content: bytesToBase64(pdfBytes) }],
      }),
    });
    if (!response.ok) console.error(`Waiver email failed: ${response.status} ${await response.text()}`);
    return response.ok;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Waiver email delivery failed.");
    return false;
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > maximumRequestBytes) return jsonResponse(413, { error: "The signature submission is too large." });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = configuredSecretKey();
  if (!supabaseUrl || !secretKey) return jsonResponse(503, { error: "The waiver service is not configured." });

  const payload = parseWaiverRequest(await request.json().catch((): null => null));
  if (!payload) return jsonResponse(400, { error: "Review the required fields, signatures, and agreement before submitting." });
  const administratorClient = createClient(supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const identityHash = await sha256Hex(`${requestNetworkAddress(request)}|${secretKey}`);
    if (!await enforceRateLimit(administratorClient, identityHash)) {
      return jsonResponse(429, { error: "Too many waiver attempts were made from this device. Please try again in one hour." });
    }

    const versionResult = await administratorClient.from("guest_waiver_versions").select("id, organization_id, title, version_label, template_storage_path, template_sha256, is_active").eq("id", payload.waiverVersionId).eq("is_active", true).maybeSingle();
    if (versionResult.error) throw new Error(`Waiver lookup failed: ${versionResult.error.message}`);
    const version = versionResult.data as WaiverVersion | null;
    if (!version) return jsonResponse(409, { error: "A newer waiver is now available. Refresh this page before signing." });

    const organizationResult = await administratorClient.from("organizations").select("id, name, slug").eq("id", version.organization_id).maybeSingle();
    if (organizationResult.error) throw new Error(`Stable lookup failed: ${organizationResult.error.message}`);
    const organization = organizationResult.data as Organization | null;
    if (!organization || organization.slug !== payload.stableSlug) return jsonResponse(404, { error: "The requested waiver is not available." });

    const templateResult = await administratorClient.storage.from("waiver-templates").download(version.template_storage_path);
    if (templateResult.error) throw new Error(`Waiver template download failed: ${templateResult.error.message}`);
    const templateBytes = new Uint8Array(await templateResult.data.arrayBuffer());
    if (await sha256Hex(templateBytes) !== version.template_sha256) throw new Error("The active waiver template did not pass its integrity check.");

    const submissionId = crypto.randomUUID();
    const submittedAt = new Date();
    const confirmationNumber = `RW-${submittedAt.toISOString().slice(0, 10).replaceAll("-", "")}-${submissionId.slice(0, 8).toUpperCase()}`;
    const pdfBytes = await completeWaiver(templateBytes, payload, version, confirmationNumber, submittedAt);
    const pdfStoragePath = `${organization.id}/${submittedAt.getUTCFullYear()}/${submissionId}.pdf`;
    const uploadResult = await administratorClient.storage.from("guest-waivers").upload(pdfStoragePath, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (uploadResult.error) throw new Error(`Completed waiver storage failed: ${uploadResult.error.message}`);

    const submissionResult = await administratorClient.from("guest_waiver_submissions").insert({
      id: submissionId,
      organization_id: organization.id,
      waiver_version_id: version.id,
      confirmation_number: confirmationNumber,
      adult_name: payload.adultName,
      horse_name: payload.horseName,
      email: payload.email,
      typed_signature_name: payload.typedSignatureName,
      pdf_storage_path: pdfStoragePath,
      email_copy_requested: payload.emailCopyRequested,
      submitted_at: submittedAt.toISOString(),
      ip_hash: identityHash,
      user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? "",
    });
    if (submissionResult.error) {
      await administratorClient.storage.from("guest-waivers").remove([pdfStoragePath]);
      throw new Error(`Waiver record failed: ${submissionResult.error.message}`);
    }

    if (payload.minors.length > 0) {
      const minorsResult = await administratorClient.from("guest_waiver_minors").insert(payload.minors.map((minor, index) => ({
        submission_id: submissionId,
        full_name: minor.fullName,
        birth_date: minor.birthDate,
        sort_order: index,
      })));
      if (minorsResult.error) {
        await administratorClient.from("guest_waiver_submissions").delete().eq("id", submissionId);
        await administratorClient.storage.from("guest-waivers").remove([pdfStoragePath]);
        throw new Error(`Minor rider records failed: ${minorsResult.error.message}`);
      }
    }

    let emailSent = false;
    if (payload.emailCopyRequested && payload.email) {
      emailSent = await sendEmailCopy(payload.email, organization.name, confirmationNumber, pdfBytes);
      if (emailSent) await administratorClient.from("guest_waiver_submissions").update({ email_sent_at: new Date().toISOString() }).eq("id", submissionId);
    }

    return jsonResponse(201, { confirmationNumber, emailSent });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "The waiver could not be submitted.";
    console.error(message);
    return jsonResponse(500, { error: message });
  }
});
