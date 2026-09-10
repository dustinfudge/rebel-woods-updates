"use client";

import { Check, Download, ExternalLink, LoaderCircle, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { getPagesBasePath } from "@/lib/environment";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { Tables } from "@/types/supabase";

type GuestWaiverVersion = Tables<"guest_waiver_versions">;
type GuestWaiverSubmission = Tables<"guest_waiver_submissions">;
type GuestWaiverMinor = Tables<"guest_waiver_minors">;

interface GuestWaiverAdminProperties {
  readonly administratorId: string;
  readonly organizationId: string;
  readonly versions: readonly GuestWaiverVersion[];
  readonly submissions: readonly GuestWaiverSubmission[];
  readonly minors: readonly GuestWaiverMinor[];
  readonly onRefresh: (message: string) => Promise<void>;
}

interface Notice {
  readonly tone: "success" | "error";
  readonly message: string;
}

const fieldClassName = "min-h-12 w-full rounded-xl border border-[#cfd4ce] bg-white px-4 text-base outline-none focus:border-[#385943] focus:ring-2 focus:ring-[#385943]/10";
const primaryButtonClassName = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#1d3528] px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClassName = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#cfd4ce] bg-white px-4 py-2 text-sm font-bold text-[#385943] disabled:opacity-50";
const dangerButtonClassName = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#d7a18b] bg-[#fff7f2] px-4 py-2 text-sm font-bold text-[#8b3e22] disabled:opacity-50";
const maximumTemplateBytes = 10 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function functionErrorMessage(error: unknown): Promise<string> {
  if (isRecord(error) && "context" in error && error.context instanceof Response) {
    const responseBody: unknown = await error.context.clone().json().catch((): null => null);
    if (isRecord(responseBody) && typeof responseBody.error === "string") return responseBody.error;
  }
  return error instanceof Error ? error.message : "The guest waiver action failed.";
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formattedDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function fileDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noreferrer";
  link.click();
}

function Label({ children, title }: { readonly children: React.ReactNode; readonly title: string }): React.JSX.Element {
  return <label className="block"><span className="mb-2 block text-sm font-bold text-[#385943]">{title}</span>{children}</label>;
}

export function GuestWaiverAdmin({ administratorId, organizationId, versions, submissions, minors, onRefresh }: GuestWaiverAdminProperties): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [publicWaiverUrl, setPublicWaiverUrl] = useState(`${getPagesBasePath()}/guest-waiver/`);
  const [activeTemplateUrl, setActiveTemplateUrl] = useState<string | null>(null);
  const activeVersion = versions.find((version) => version.is_active) ?? null;
  const minorsBySubmission = useMemo<ReadonlyMap<string, readonly GuestWaiverMinor[]>>(() => {
    const groupedMinors = new Map<string, GuestWaiverMinor[]>();
    for (const minor of minors) groupedMinors.set(minor.submission_id, [...(groupedMinors.get(minor.submission_id) ?? []), minor]);
    return groupedMinors;
  }, [minors]);
  const visibleSubmissions = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return submissions;
    return submissions.filter((submission) => [submission.adult_name, submission.horse_name, submission.confirmation_number, submission.email ?? ""].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
  }, [searchQuery, submissions]);
  const printableSignUrl = `${getPagesBasePath()}/guest-waiver-qr-sign.pdf`;

  useEffect(() => {
    setPublicWaiverUrl(`${window.location.origin}${getPagesBasePath()}/guest-waiver/`);
    setActiveTemplateUrl(activeVersion ? getSupabaseBrowserClient().storage.from("waiver-templates").getPublicUrl(activeVersion.template_storage_path).data.publicUrl : null);
  }, [activeVersion]);

  async function activateTemplate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isWorking) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const fileValue = formData.get("waiverTemplate");
    const versionLabelValue = formData.get("versionLabel");
    const versionLabel = typeof versionLabelValue === "string" ? versionLabelValue.trim() : "";
    if (!(fileValue instanceof File) || fileValue.size === 0 || !versionLabel) return;
    if (fileValue.size > maximumTemplateBytes || (fileValue.type !== "application/pdf" && !fileValue.name.toLocaleLowerCase().endsWith(".pdf"))) {
      setNotice({ tone: "error", message: "Choose a PDF that is 10 MB or smaller." });
      return;
    }

    setIsWorking(true);
    setNotice(null);
    const client = getSupabaseBrowserClient();
    const templateBytes = await fileValue.arrayBuffer();
    const templateHeader = new TextDecoder().decode(templateBytes.slice(0, 5));
    if (templateHeader !== "%PDF-") {
      setIsWorking(false);
      setNotice({ tone: "error", message: "The selected file is not a readable PDF." });
      return;
    }
    const templatePath = `${organizationId}/${crypto.randomUUID()}/template.pdf`;
    const uploadResult = await client.storage.from("waiver-templates").upload(templatePath, templateBytes, { contentType: "application/pdf", upsert: false });
    if (uploadResult.error) {
      setIsWorking(false);
      setNotice({ tone: "error", message: uploadResult.error.message });
      return;
    }
    const activationResult = await client.rpc("activate_guest_waiver_version", {
      waiver_title: "Waiver and Release of Liability",
      waiver_version_label: versionLabel,
      waiver_template_storage_path: templatePath,
      waiver_original_filename: fileValue.name,
      waiver_template_sha256: await sha256Hex(templateBytes),
    });
    if (activationResult.error) {
      await client.storage.from("waiver-templates").remove([templatePath]);
      setIsWorking(false);
      setNotice({ tone: "error", message: activationResult.error.message });
      return;
    }
    form.reset();
    setIsWorking(false);
    setNotice({ tone: "success", message: "The guest waiver is active at the permanent QR address." });
    await onRefresh("The guest waiver is active.");
  }

  async function downloadSubmission(submission: GuestWaiverSubmission): Promise<void> {
    setIsWorking(true);
    setNotice(null);
    const result = await getSupabaseBrowserClient().functions.invoke("manage-guest-waiver", { body: { action: "download", submissionId: submission.id } });
    setIsWorking(false);
    if (result.error) {
      setNotice({ tone: "error", message: await functionErrorMessage(result.error) });
      return;
    }
    if (!isRecord(result.data) || typeof result.data.signedUrl !== "string") {
      setNotice({ tone: "error", message: "The secure download link could not be created." });
      return;
    }
    fileDownload(result.data.signedUrl);
  }

  async function markReviewed(submission: GuestWaiverSubmission): Promise<void> {
    setIsWorking(true);
    setNotice(null);
    const result = await getSupabaseBrowserClient().from("guest_waiver_submissions").update({ reviewed_at: new Date().toISOString(), reviewed_by: administratorId }).eq("id", submission.id);
    setIsWorking(false);
    if (result.error) {
      setNotice({ tone: "error", message: result.error.message });
      return;
    }
    await onRefresh(`${submission.adult_name}’s waiver was marked reviewed.`);
  }

  async function deleteSubmission(submission: GuestWaiverSubmission): Promise<void> {
    if (!window.confirm(`Permanently delete the signed waiver for ${submission.adult_name} and ${submission.horse_name}? This cannot be undone.`)) return;
    setIsWorking(true);
    setNotice(null);
    const result = await getSupabaseBrowserClient().functions.invoke("manage-guest-waiver", { body: { action: "delete", submissionId: submission.id } });
    setIsWorking(false);
    if (result.error) {
      setNotice({ tone: "error", message: await functionErrorMessage(result.error) });
      return;
    }
    await onRefresh(`${submission.adult_name}’s guest waiver was permanently deleted.`);
  }

  return <section>
    <div className="mb-6"><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#a65333]">Guest records</p><h2 className="mb-2 font-serif text-3xl md:text-4xl">Guest Waivers</h2><p className="mb-0 max-w-3xl leading-7 text-[#68736b]">Activate the exact waiver used by the permanent barn QR code, then privately review and download every signed submission.</p></div>
    {notice ? <div className={`mb-5 flex items-start gap-3 rounded-2xl border p-4 text-sm ${notice.tone === "success" ? "border-[#b8c9bb] bg-[#e4ece4] text-[#1d3528]" : "border-[#e1b8a6] bg-[#f3ded3] text-[#73391f]"}`} role="status">{notice.tone === "success" ? <Check size={18} /> : <ShieldCheck size={18} />}<span>{notice.message}</span></div> : null}
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="space-y-5">
        <article className="rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] p-5 shadow-sm md:p-6"><div className="mb-5"><h3 className="mb-1 font-serif text-2xl">Permanent QR Link</h3><p className="mb-0 text-sm leading-6 text-[#68736b]">This address stays the same whenever a new waiver version is activated.</p></div><div className="break-all rounded-xl bg-[#f7f3e9] p-3 text-sm font-bold text-[#385943]">{publicWaiverUrl}</div><div className="mt-4 flex flex-wrap gap-2"><a className={secondaryButtonClassName} href={`${getPagesBasePath()}/guest-waiver/`} rel="noreferrer" target="_blank"><ExternalLink size={16} />Open public form</a><a className={secondaryButtonClassName} download href={printableSignUrl}><Download size={16} />Printable QR sign</a></div></article>
        <article className="rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] p-5 shadow-sm md:p-6"><div className="mb-5"><h3 className="mb-1 font-serif text-2xl">Active Waiver</h3><p className="mb-0 text-sm leading-6 text-[#68736b]">The original PDF remains unchanged. Electronic entries are applied only to completed copies.</p></div>{activeVersion ? <div className="rounded-2xl bg-[#e4ece4] p-4"><span className="mb-2 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-[#385943]"><Check size={14} />Active</span><strong className="block">{activeVersion.title}</strong><span className="mt-1 block text-sm text-[#68736b]">Version {activeVersion.version_label} · {activeVersion.original_filename}</span>{activeTemplateUrl ? <a className={`${secondaryButtonClassName} mt-4`} href={activeTemplateUrl} rel="noreferrer" target="_blank"><ExternalLink size={16} />View exact PDF</a> : null}</div> : <p className="rounded-xl bg-[#f3ded3] p-4 text-sm text-[#73391f]">No guest waiver is active. Upload the supplied three-page PDF below before using the QR sign.</p>}
          <details className="mt-4 rounded-xl border border-[#dedfd8] bg-white p-3"><summary className="cursor-pointer text-sm font-bold text-[#385943]">Activate a Waiver Version</summary><form className="mt-4 space-y-4" onSubmit={(event) => void activateTemplate(event)}><Label title="Exact three-page waiver PDF"><input accept="application/pdf,.pdf" className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-[#e4ece4] file:px-4 file:py-2 file:font-bold file:text-[#385943]" name="waiverTemplate" required type="file" /></Label><Label title="Version name"><input className={fieldClassName} defaultValue={new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date())} maxLength={80} name="versionLabel" required /></Label><p className="mb-0 rounded-xl bg-[#f6e8c9] p-3 text-xs leading-5 text-[#75520e]">Use the exact layout supplied for this version. A future PDF with fields in different positions must be mapped before activation.</p><button className={primaryButtonClassName} disabled={isWorking} type="submit">{isWorking ? <LoaderCircle className="animate-spin" size={17} /> : <Upload size={17} />}Upload and activate</button></form></details>
          {versions.length > 1 ? <details className="mt-4 rounded-xl border border-[#dedfd8] bg-white p-3"><summary className="cursor-pointer text-sm font-bold text-[#385943]">Previous Versions · {versions.length - 1}</summary><div className="mt-3 space-y-2">{versions.filter((version) => !version.is_active).map((version) => <div className="rounded-xl bg-[#f7f3e9] p-3 text-sm" key={version.id}><strong className="block">{version.version_label}</strong><span className="text-[#68736b]">Added {formattedDate(version.created_at)}</span></div>)}</div></details> : null}
        </article>
      </div>
      <article className="rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] p-5 shadow-sm md:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="mb-1 font-serif text-2xl">Signed Waivers</h3><p className="mb-0 text-sm leading-6 text-[#68736b]">{submissions.length} securely stored · {submissions.filter((submission) => !submission.reviewed_at).length} new</p></div>{isWorking ? <LoaderCircle className="animate-spin text-[#385943]" size={20} /> : null}</div><label className="mb-5 flex items-center gap-3 rounded-xl border border-[#cfd4ce] bg-white px-4"><Search className="text-[#68736b]" size={18} /><input className="min-h-12 w-full bg-transparent text-base outline-none" onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search guest, horse, email, or confirmation" type="search" value={searchQuery} /></label>{visibleSubmissions.length === 0 ? <p className="rounded-2xl border border-dashed border-[#cfd4ce] bg-[#f7f3e9] p-5 text-center text-sm text-[#68736b]">{submissions.length === 0 ? "No guest waivers have been submitted yet." : "No waivers match this search."}</p> : <div className="space-y-3">{visibleSubmissions.map((submission) => {
          const submissionMinors = minorsBySubmission.get(submission.id) ?? [];
          return <section className={`rounded-2xl border p-4 ${submission.reviewed_at ? "border-[#dedfd8] bg-white" : "border-[#8db39a] bg-[#eef5ef]"}`} key={submission.id}><div className="flex flex-wrap items-start justify-between gap-3"><span><span className="flex flex-wrap items-center gap-2"><strong className="text-lg">{submission.adult_name}</strong>{submission.reviewed_at ? null : <span className="rounded-full bg-[#1f5f8b] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white">New</span>}</span><span className="mt-1 block text-sm text-[#385943]">Horse: {submission.horse_name}</span></span><time className="text-xs font-bold text-[#68736b]" dateTime={submission.submitted_at}>{formattedDate(submission.submitted_at)}</time></div><dl className="mt-3 grid gap-2 rounded-xl bg-[#f7f3e9] p-3 text-xs sm:grid-cols-2"><div><dt className="font-bold uppercase tracking-[0.08em] text-[#68736b]">Confirmation</dt><dd className="mt-1 font-semibold">{submission.confirmation_number}</dd></div><div><dt className="font-bold uppercase tracking-[0.08em] text-[#68736b]">Email copy</dt><dd className="mt-1 font-semibold">{submission.email_copy_requested ? submission.email_sent_at ? "Sent" : "Requested - not sent" : "Not requested"}</dd></div>{submission.email ? <div className="sm:col-span-2"><dt className="font-bold uppercase tracking-[0.08em] text-[#68736b]">Email</dt><dd className="mt-1 font-semibold">{submission.email}</dd></div> : null}</dl>{submissionMinors.length > 0 ? <details className="mt-3 rounded-xl border border-[#dedfd8] bg-white p-3"><summary className="cursor-pointer text-xs font-bold text-[#385943]">Minor Riders · {submissionMinors.length}</summary><ul className="mb-0 mt-2 space-y-1 pl-5 text-sm">{[...submissionMinors].sort((left, right) => left.sort_order - right.sort_order).map((minor) => <li key={minor.id}>{minor.full_name} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${minor.birth_date}T12:00:00Z`))}</li>)}</ul></details> : null}<div className="mt-4 flex flex-wrap gap-2"><button className={secondaryButtonClassName} disabled={isWorking} onClick={() => void downloadSubmission(submission)} type="button"><Download size={16} />Download PDF</button>{submission.reviewed_at ? <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#e4ece4] px-4 py-2 text-sm font-bold text-[#385943]"><Check size={15} />Reviewed</span> : <button className={primaryButtonClassName} disabled={isWorking} onClick={() => void markReviewed(submission)} type="button"><Check size={16} />Mark reviewed</button>}<button className={dangerButtonClassName} disabled={isWorking} onClick={() => void deleteSubmission(submission)} type="button"><Trash2 size={16} />Delete permanently</button></div></section>;
        })}</div>}</article>
    </div>
  </section>;
}
