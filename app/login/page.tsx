"use client";

import type { AuthError } from "@supabase/supabase-js";
import { KeyRound, Mail } from "lucide-react";
import Image from "next/image";
import { type FormEvent, useState } from "react";

import { getPagesBasePath, getSupabasePublicConfiguration } from "@/lib/environment";
import { isValidEmailOneTimeCode, normalizeEmailAddress, normalizeEmailOneTimeCode } from "@/lib/emailOtp";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

interface SignInNotice {
  readonly message: string;
  readonly tone: "success" | "error";
}

function getSignInErrorMessage(error: AuthError): string {
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    return "A code was requested too recently. Wait one minute, then try again.";
  }

  if (error.code === "email_address_not_authorized") {
    return "This email address is not authorized to use the app.";
  }

  return `We could not send the code: ${error.message}`;
}

function getVerificationErrorMessage(error: AuthError): string {
  if (error.code === "otp_expired") {
    return "That code has expired. Request a new code and try again.";
  }

  return "That code was not accepted. Check the newest email and try again.";
}

export default function LoginPage(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [signInStep, setSignInStep] = useState<"request" | "verify">("request");
  const [notice, setNotice] = useState<SignInNotice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isConfigured = getSupabasePublicConfiguration() !== null;

  async function sendSignInCode(): Promise<void> {
    if (!email.trim() || !isConfigured || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    const basePath = getPagesBasePath();
    const emailRedirectTo = `${window.location.origin}${basePath}/auth/callback/`;
    const { error } = await getSupabaseBrowserClient().auth.signInWithOtp({
      email: normalizeEmailAddress(email),
      options: { emailRedirectTo, shouldCreateUser: false },
    });
    setIsSubmitting(false);

    if (error) {
      setNotice({ message: getSignInErrorMessage(error), tone: "error" });
      return;
    }

    setSignInStep("verify");
    setNotice({ message: `We emailed a verification code to ${normalizeEmailAddress(email)}.`, tone: "success" });
  }

  function requestSignInCode(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendSignInCode();
  }

  async function verifySignInCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!isValidEmailOneTimeCode(verificationCode) || !isConfigured || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    const { error } = await getSupabaseBrowserClient().auth.verifyOtp({
      email: normalizeEmailAddress(email),
      token: verificationCode,
      type: "email",
    });

    if (error) {
      setIsSubmitting(false);
      setNotice({ message: getVerificationErrorMessage(error), tone: "error" });
      return;
    }

    window.location.replace(`${window.location.origin}${getPagesBasePath()}/`);
  }

  function changeEmailAddress(): void {
    setSignInStep("request");
    setVerificationCode("");
    setNotice(null);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f3e9] px-5 py-12">
      <section className="w-full max-w-md rounded-[2rem] border border-[#dedfd8] bg-[#fffdf8] p-7 shadow-[0_24px_70px_rgba(20,38,29,0.12)]">
        <div className="mb-8 flex items-center gap-3">
          <Image className="h-14 w-14 rounded-full" src={`${getPagesBasePath()}/icon-192.png`} alt="Rebel Woods Boarding" width={56} height={56} priority />
          <div>
            <p className="mb-0 font-serif text-2xl text-[#14261d]">Rebel Woods</p>
            <p className="mb-0 text-xs font-bold uppercase tracking-[0.16em] text-[#a65333]">Weekly care</p>
          </div>
        </div>
        <h1 className="mb-3 font-serif text-4xl leading-tight text-[#14261d]">Welcome back.</h1>
        <p className="mb-7 leading-7 text-[#68736b]">Sign in with a secure code sent to your invited email address. No password or browser switching required.</p>
        {signInStep === "request" ? (
          <form className="space-y-4" onSubmit={requestSignInCode}>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-[#385943]">Email address</span>
              <span className="flex items-center gap-3 rounded-2xl border border-[#cfd4ce] bg-white px-4 focus-within:border-[#385943]">
                <Mail aria-hidden="true" className="text-[#68736b]" size={18} />
                <input className="min-h-12 w-full bg-transparent text-base outline-none" type="email" autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required value={email} />
              </span>
            </label>
            <button className="w-full rounded-full bg-[#1d3528] px-5 py-3.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!email.trim() || !isConfigured || isSubmitting}>
              {isSubmitting ? "Sending code…" : "Email me a sign-in code"}
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void verifySignInCode(event)}>
            <div className="rounded-2xl bg-[#eef2ec] px-4 py-3 text-sm text-[#385943]">
              <span className="block text-xs font-bold uppercase tracking-[0.12em]">Code sent to</span>
              <span className="font-semibold">{normalizeEmailAddress(email)}</span>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-[#385943]">Verification code</span>
              <span className="flex items-center gap-3 rounded-2xl border border-[#cfd4ce] bg-white px-4 focus-within:border-[#385943]">
                <KeyRound aria-hidden="true" className="text-[#68736b]" size={18} />
                <input
                  autoComplete="one-time-code"
                  autoFocus
                  className="min-h-12 w-full bg-transparent text-xl font-bold tracking-[0.28em] outline-none"
                  inputMode="numeric"
                  maxLength={8}
                  minLength={6}
                  onChange={(event) => setVerificationCode(normalizeEmailOneTimeCode(event.target.value))}
                  pattern="[0-9]{6,8}"
                  placeholder="000000"
                  required
                  type="text"
                  value={verificationCode}
                />
              </span>
            </label>
            <button className="w-full rounded-full bg-[#1d3528] px-5 py-3.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!isValidEmailOneTimeCode(verificationCode) || !isConfigured || isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-semibold text-[#385943]">
              <button onClick={changeEmailAddress} type="button">Use a different email</button>
              <button disabled={isSubmitting} onClick={() => void sendSignInCode()} type="button">Send a new code</button>
            </div>
          </form>
        )}
        {!isConfigured ? <p className="mt-5 rounded-xl bg-[#f3ded3] p-3 text-sm text-[#73391f]">The Supabase connection will be enabled during guided setup.</p> : null}
        {notice ? <p className={`mt-5 rounded-xl p-3 text-sm ${notice.tone === "success" ? "bg-[#e4ece4] text-[#1d3528]" : "bg-[#f3ded3] text-[#73391f]"}`} role="status">{notice.message}</p> : null}
      </section>
    </main>
  );
}
