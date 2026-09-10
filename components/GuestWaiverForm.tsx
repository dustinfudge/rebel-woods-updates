"use client";

import { AlertCircle, Check, ExternalLink, FileSignature, LoaderCircle, Minus, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { getPagesBasePath } from "@/lib/environment";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

interface ActiveWaiver {
  readonly id: string;
  readonly title: string;
  readonly version_label: string;
  readonly template_storage_path: string;
}

interface MinorEntry {
  readonly id: string;
  readonly fullName: string;
  readonly birthDate: string;
}

interface SubmissionResult {
  readonly confirmationNumber: string;
  readonly emailSent: boolean;
}

interface FormNotice {
  readonly tone: "success" | "error";
  readonly message: string;
}

const stableSlug = "rebel-woods";
const fieldClassName = "min-h-12 w-full rounded-xl border border-[#cfd4ce] bg-white px-4 text-base text-[#14261d] outline-none focus:border-[#385943] focus:ring-2 focus:ring-[#385943]/10";
const primaryButtonClassName = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#1d3528] px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClassName = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#cfd4ce] bg-white px-4 py-2 text-sm font-bold text-[#385943]";

function newMinorEntry(): MinorEntry {
  return { id: crypto.randomUUID(), fullName: "", birthDate: "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function functionErrorMessage(error: unknown): Promise<string> {
  if (isRecord(error) && "context" in error && error.context instanceof Response) {
    const responseBody: unknown = await error.context.clone().json().catch((): null => null);
    if (isRecord(responseBody) && typeof responseBody.error === "string") return responseBody.error;
  }
  return error instanceof Error ? error.message : "The waiver could not be submitted.";
}

function Label({ children, title }: { readonly children: React.ReactNode; readonly title: string }): React.JSX.Element {
  return <label className="block"><span className="mb-2 block text-sm font-bold text-[#385943]">{title}</span>{children}</label>;
}

export function GuestWaiverForm(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const startedAtRef = useRef("");
  const [activeWaiver, setActiveWaiver] = useState<ActiveWaiver | null>(null);
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const [adultName, setAdultName] = useState("");
  const [horseName, setHorseName] = useState("");
  const [typedSignatureName, setTypedSignatureName] = useState("");
  const [minors, setMinors] = useState<readonly MinorEntry[]>([]);
  const [email, setEmail] = useState("");
  const [emailCopyRequested, setEmailCopyRequested] = useState(false);
  const [hasDrawnSignature, setHasDrawnSignature] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);

  useEffect(() => {
    startedAtRef.current = new Date().toISOString();
    const client = getSupabaseBrowserClient();
    async function loadActiveWaiver(): Promise<void> {
      const result = await client.rpc("get_active_guest_waiver", { stable_slug: stableSlug });
      if (result.error || !result.data?.[0]) {
        setNotice({ tone: "error", message: "The guest waiver is not available yet. Please ask a Rebel Woods administrator for help." });
        setIsLoading(false);
        return;
      }
      const waiver = result.data[0];
      const publicUrl = client.storage.from("waiver-templates").getPublicUrl(waiver.template_storage_path);
      setActiveWaiver(waiver);
      setTemplateUrl(publicUrl.data.publicUrl);
      setIsLoading(false);
    }
    void loadActiveWaiver();
  }, []);

  function addMinor(): void {
    if (minors.length >= 10) return;
    setMinors((currentMinors) => [...currentMinors, newMinorEntry()]);
  }

  function updateMinor(id: string, changes: Partial<Pick<MinorEntry, "fullName" | "birthDate">>): void {
    setMinors((currentMinors) => currentMinors.map((minor) => minor.id === id ? { ...minor, ...changes } : minor));
  }

  function removeMinor(id: string): void {
    setMinors((currentMinors) => currentMinors.filter((minor) => minor.id !== id));
  }

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): { readonly x: number; readonly y: number } {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  }

  function beginSignature(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = "#14261d";
    isDrawingRef.current = true;
  }

  function continueSignature(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!isDrawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = canvasPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasDrawnSignature(true);
  }

  function endSignature(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    isDrawingRef.current = false;
  }

  function clearSignature(): void {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawnSignature(false);
  }

  function resetForm(): void {
    setAdultName("");
    setHorseName("");
    setTypedSignatureName("");
    setMinors([]);
    setEmail("");
    setEmailCopyRequested(false);
    setAccepted(false);
    setNotice(null);
    setSubmission(null);
    clearSignature();
    startedAtRef.current = new Date().toISOString();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitWaiver(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!activeWaiver || !canvasRef.current || !hasDrawnSignature || !accepted || isSubmittingRef.current) return;
    const formData = new FormData(event.currentTarget);
    const websiteValue = formData.get("website");
    const website = typeof websiteValue === "string" ? websiteValue : "";
    if (adultName.trim().replace(/\s+/g, " ").toLocaleLowerCase() !== typedSignatureName.trim().replace(/\s+/g, " ").toLocaleLowerCase()) {
      setNotice({ tone: "error", message: "The typed signature must match the adult guest name." });
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setNotice(null);
    const client = getSupabaseBrowserClient();
    try {
      const result = await client.functions.invoke("submit-guest-waiver", {
        body: {
          stableSlug,
          waiverVersionId: activeWaiver.id,
          adultName,
          horseName,
          minors: minors.map((minor) => ({ fullName: minor.fullName, birthDate: minor.birthDate })),
          email: emailCopyRequested ? email.trim() || null : null,
          emailCopyRequested,
          typedSignatureName,
          signatureDataUrl: canvasRef.current.toDataURL("image/png"),
          accepted,
          startedAt: startedAtRef.current,
          website,
        },
      });
      if (result.error) {
        setNotice({ tone: "error", message: await functionErrorMessage(result.error) });
        return;
      }
      if (!isRecord(result.data) || typeof result.data.confirmationNumber !== "string" || typeof result.data.emailSent !== "boolean") {
        setNotice({ tone: "error", message: "The waiver was received, but its confirmation could not be displayed. Please contact Rebel Woods." });
        return;
      }
      setSubmission({ confirmationNumber: result.data.confirmationNumber, emailSent: result.data.emailSent });
      setNotice({ tone: "success", message: "Your signed waiver has been securely saved." });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error: unknown) {
      setNotice({ tone: "error", message: await functionErrorMessage(error) });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <main className="grid min-h-screen place-items-center bg-[#f7f3e9] px-5 text-[#385943]"><span className="flex items-center gap-3 font-bold"><LoaderCircle className="animate-spin" />Opening guest waiver…</span></main>;

  return <main className="min-h-screen bg-[#f7f3e9] pb-20 text-[#14261d]">
    <header className="border-b border-[#dedfd8] bg-[#fffdf8] px-5 py-4"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4"><div className="flex items-center gap-3"><Image alt="Rebel Woods Boarding" className="h-12 w-12 rounded-full" height={48} priority src={`${getPagesBasePath()}/icon-192.png`} width={48} /><span><strong className="block font-serif text-lg">Rebel Woods</strong><small className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#a65333]">Guest Liability Waiver</small></span></div><span className="rounded-full bg-[#e4ece4] px-3 py-2 text-xs font-bold text-[#385943]">No account needed</span></div></header>
    <div className="mx-auto max-w-6xl px-5 py-8 sm:py-12">
      {notice ? <div className={`mb-6 flex items-start gap-3 rounded-2xl border p-4 text-sm ${notice.tone === "success" ? "border-[#b8c9bb] bg-[#e4ece4] text-[#1d3528]" : "border-[#e1b8a6] bg-[#f3ded3] text-[#73391f]"}`} role="status">{notice.tone === "success" ? <Check className="shrink-0" size={18} /> : <AlertCircle className="shrink-0" size={18} />}<span>{notice.message}</span></div> : null}
      {submission ? <section className="mx-auto max-w-2xl rounded-[2rem] border border-[#b8c9bb] bg-[#fffdf8] p-7 text-center shadow-xl sm:p-10"><ShieldCheck className="mx-auto mb-5 text-[#385943]" size={52} /><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#a65333]">Waiver complete</p><h1 className="mb-3 font-serif text-4xl">Thank you.</h1><p className="mb-5 leading-7 text-[#68736b]">Your completed waiver is securely on file with Rebel Woods.</p><div className="mb-5 rounded-2xl bg-[#f7f3e9] p-5"><span className="block text-xs font-bold uppercase tracking-[0.12em] text-[#68736b]">Confirmation number</span><strong className="mt-1 block text-xl text-[#1d3528]">{submission.confirmationNumber}</strong></div>{emailCopyRequested ? <p className="mb-5 text-sm text-[#68736b]">{submission.emailSent ? `A copy was emailed to ${email}.` : "Your waiver is saved, but the email copy could not be sent. Please ask an administrator for a copy."}</p> : null}<button className={secondaryButtonClassName} onClick={resetForm} type="button"><RotateCcw size={16} />Complete another waiver</button></section> : <>
        <section className="mb-7 rounded-[2rem] bg-[#1d3528] p-7 text-white shadow-xl sm:p-10"><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#d9a27b]">Before riding or handling a horse</p><h1 className="mb-4 max-w-3xl font-serif text-4xl leading-tight sm:text-5xl">Complete the Rebel Woods guest waiver.</h1><p className="mb-0 max-w-3xl leading-7 text-[#cdd9cf]">One adult guest and one horse per submission. Parents or guardians may include multiple minor riders.</p></section>
        {activeWaiver && templateUrl ? <div className="grid gap-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,1.1fr)] lg:items-start">
          <section className="overflow-hidden rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] shadow-sm lg:sticky lg:top-5"><div className="border-b border-[#dedfd8] p-5"><p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[#a65333]">Exact document</p><h2 className="mb-1 font-serif text-2xl">{activeWaiver.title}</h2><p className="mb-4 text-sm text-[#68736b]">Version {activeWaiver.version_label}</p><a className={secondaryButtonClassName} href={templateUrl} rel="noreferrer" target="_blank"><ExternalLink size={16} />Open full waiver PDF</a></div><object aria-label="Rebel Woods guest liability waiver" className="hidden h-[70vh] min-h-[620px] w-full lg:block" data={templateUrl} type="application/pdf"><a href={templateUrl}>Open the exact waiver PDF</a></object><div className="p-5 lg:hidden"><p className="mb-0 text-sm leading-6 text-[#68736b]">Use the button above to read all three pages of the exact waiver. Return here when you are ready to complete and sign it.</p></div></section>
          <form className="space-y-6" onSubmit={(event) => void submitWaiver(event)}>
            <section className="rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] p-5 shadow-sm sm:p-7"><p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[#a65333]">Guest and horse</p><h2 className="mb-5 font-serif text-3xl">Fill the waiver fields</h2><div className="space-y-4"><Label title="Adult guest’s full legal name"><input autoComplete="name" className={fieldClassName} maxLength={160} onChange={(event) => setAdultName(event.target.value)} required value={adultName} /></Label><Label title="Horse name"><input className={fieldClassName} maxLength={160} onChange={(event) => setHorseName(event.target.value)} required value={horseName} /></Label></div></section>
            <section className="rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] p-5 shadow-sm sm:p-7"><div className="mb-4 flex items-start justify-between gap-4"><div><p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[#a65333]">Optional</p><h2 className="mb-1 font-serif text-3xl">Minor riders</h2><p className="mb-0 text-sm leading-6 text-[#68736b]">Add every minor covered by this parent or guardian.</p></div><button className={secondaryButtonClassName} disabled={minors.length >= 10} onClick={addMinor} type="button"><Plus size={16} />Add minor</button></div>{minors.length === 0 ? <p className="mb-0 rounded-xl bg-[#f7f3e9] p-4 text-sm text-[#68736b]">No minors added.</p> : <div className="space-y-4">{minors.map((minor, index) => <fieldset className="rounded-2xl border border-[#dedfd8] p-4" key={minor.id}><legend className="px-2 text-sm font-bold text-[#385943]">Minor {index + 1}</legend><div className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"><Label title="Full legal name"><input className={fieldClassName} maxLength={160} onChange={(event) => updateMinor(minor.id, { fullName: event.target.value })} required value={minor.fullName} /></Label><Label title="Date of birth"><input className={fieldClassName} max={new Date().toISOString().slice(0, 10)} min="1900-01-01" onChange={(event) => updateMinor(minor.id, { birthDate: event.target.value })} required type="date" value={minor.birthDate} /></Label><button aria-label={`Remove minor ${index + 1}`} className="grid h-12 w-12 place-items-center rounded-full border border-[#d7a18b] bg-[#fff7f2] text-[#8b3e22]" onClick={() => removeMinor(minor.id)} type="button"><Minus size={18} /></button></div></fieldset>)}</div>}</section>
            <section className="rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] p-5 shadow-sm sm:p-7"><p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[#a65333]">Electronic signature</p><h2 className="mb-3 font-serif text-3xl">Sign the waiver</h2><p className="mb-5 text-sm leading-6 text-[#68736b]">Type the same full legal name entered above, then draw your signature with a finger, mouse, or trackpad.</p><div className="space-y-5"><Label title="Typed signature"><input autoComplete="name" className={fieldClassName} maxLength={160} onChange={(event) => setTypedSignatureName(event.target.value)} required value={typedSignatureName} /></Label><div><div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-bold text-[#385943]">Drawn signature</span><button className="text-sm font-bold text-[#8b3e22]" onClick={clearSignature} type="button">Clear</button></div><canvas aria-label="Draw your signature" className="h-40 w-full touch-none rounded-xl border border-[#cfd4ce] bg-white" height={240} onPointerCancel={endSignature} onPointerDown={beginSignature} onPointerMove={continueSignature} onPointerUp={endSignature} ref={canvasRef} width={800} /></div><label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[#f7f3e9] p-4 text-sm leading-6"><input className="mt-1 h-5 w-5 shrink-0 accent-[#1d3528]" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required type="checkbox" /><span>I confirm that I have read all three pages of the exact waiver, that the information is correct, and that I intend my typed and drawn signatures to be legally binding.</span></label></div></section>
            <section className="rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] p-5 shadow-sm sm:p-7"><p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[#a65333]">Your copy</p><h2 className="mb-4 font-serif text-3xl">Email is optional</h2><label className="mb-4 flex cursor-pointer items-center gap-3 text-sm font-bold text-[#385943]"><input className="h-5 w-5 accent-[#1d3528]" checked={emailCopyRequested} onChange={(event) => setEmailCopyRequested(event.target.checked)} type="checkbox" />Email me a completed PDF copy</label>{emailCopyRequested ? <Label title="Email address"><input autoComplete="email" className={fieldClassName} maxLength={320} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></Label> : null}</section>
            <div className="hidden" aria-hidden="true"><label>Website<input autoComplete="off" name="website" tabIndex={-1} /></label></div>
            <button className={primaryButtonClassName} disabled={!hasDrawnSignature || !accepted || isSubmitting} type="submit">{isSubmitting ? <><LoaderCircle className="animate-spin" size={18} />Saving signed waiver…</> : <><FileSignature size={19} />Sign and submit waiver</>}</button>
            <p className="mb-0 text-center text-xs leading-5 text-[#68736b]">Completed waivers are stored privately and are available only to Rebel Woods administrators.</p>
          </form>
        </div> : <section className="rounded-[1.5rem] border border-[#e1b8a6] bg-[#f3ded3] p-7 text-center text-[#73391f]"><AlertCircle className="mx-auto mb-4" size={38} /><h2 className="mb-2 font-serif text-3xl">Waiver unavailable</h2><p className="mb-0">Please ask a Rebel Woods administrator for assistance.</p></section>}
      </>}
    </div>
  </main>;
}
