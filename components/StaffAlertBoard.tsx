"use client";

import { Archive, BellRing, Check, ChevronDown, ChevronUp, History, Plus, Trash2, TriangleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";

import { getHistoricalStaffAlerts, getOverviewStaffAlerts } from "@/lib/staffAlerts";
import type { Tables } from "@/types/supabase";

type StaffAlert = Tables<"staff_alerts">;
type StaffAlertAcknowledgement = Tables<"staff_alert_acknowledgements">;
type Profile = Tables<"profiles">;

interface StaffAlertBoardProps {
  readonly acknowledgements: readonly StaffAlertAcknowledgement[];
  readonly alerts: readonly StaffAlert[];
  readonly currentProfile: Profile;
  readonly people: readonly Profile[];
  readonly onAcknowledge: (alertId: string) => Promise<boolean>;
  readonly onArchiveAlert: (alertId: string) => Promise<boolean>;
  readonly onCreateCustomAlert: (message: string) => Promise<boolean>;
  readonly onDeleteAlert: (alertId: string) => Promise<boolean>;
}

export function StaffAlertBoard({ acknowledgements, alerts, currentProfile, people, onAcknowledge, onArchiveAlert, onCreateCustomAlert, onDeleteAlert }: StaffAlertBoardProps): React.JSX.Element {
  const [isAddingAlert, setIsAddingAlert] = useState(false);
  const [isShowingHistory, setIsShowingHistory] = useState(false);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [isCreatingAlert, setIsCreatingAlert] = useState(false);
  const overviewAlerts = getOverviewStaffAlerts(alerts);
  const historicalAlerts = getHistoricalStaffAlerts(alerts);
  const displayedAlerts = isShowingHistory ? historicalAlerts : overviewAlerts;

  async function acknowledge(alertId: string): Promise<void> {
    setBusyAlertId(alertId);
    await onAcknowledge(alertId);
    setBusyAlertId(null);
  }

  async function archiveAlert(alertId: string): Promise<void> {
    setBusyAlertId(alertId);
    await onArchiveAlert(alertId);
    setBusyAlertId(null);
  }

  async function deleteAlert(alertId: string): Promise<void> {
    if (!window.confirm("Permanently delete this alert? This cannot be undone.")) return;
    setBusyAlertId(alertId);
    await onDeleteAlert(alertId);
    setBusyAlertId(null);
  }

  async function createCustomAlert(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const messageValue = formData.get("message");
    const message = typeof messageValue === "string" ? messageValue.trim() : "";
    if (!message) return;
    setIsCreatingAlert(true);
    const wasCreated = await onCreateCustomAlert(message);
    setIsCreatingAlert(false);
    if (wasCreated) {
      form.reset();
      setIsAddingAlert(false);
    }
  }

  return <div className="min-w-0 rounded-3xl bg-white/10 p-3 sm:p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span><strong className="flex items-center gap-2 text-lg"><BellRing size={19} />Stable alerts</strong><small className="text-[#cdd9cf]">{overviewAlerts.length} current · Admin moves alerts to history</small></span>
      <span className="flex flex-wrap gap-2">
        {currentProfile.role === "admin" && !isShowingHistory ? <button className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-bold text-[#1d3528]" onClick={() => setIsAddingAlert((currentValue) => !currentValue)} type="button"><Plus size={14} />Add alert</button> : null}
        <button className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 text-xs font-bold text-white" onClick={() => setIsShowingHistory((currentValue) => !currentValue)} type="button"><History size={14} />{isShowingHistory ? "Current alerts" : "View history"}{isShowingHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
      </span>
    </div>

    {isAddingAlert && !isShowingHistory ? <form className="mb-3 rounded-2xl bg-white p-3 text-[#1d3528]" onSubmit={(event) => void createCustomAlert(event)}><label className="block text-xs font-bold">Message for administrators and Rebel Wranglers<textarea autoFocus className="mt-2 min-h-24 w-full resize-y rounded-xl border border-[#cfd4ce] p-3 text-sm font-normal outline-none focus:border-[#385943]" maxLength={8000} name="message" placeholder="Enter an operational reminder or change everyone should read." required /></label><div className="mt-2 flex justify-end gap-2"><button className="min-h-9 rounded-full px-3 text-xs font-bold text-[#68736b]" onClick={() => setIsAddingAlert(false)} type="button">Cancel</button><button className="min-h-9 rounded-full bg-[#1d3528] px-4 text-xs font-bold text-white disabled:opacity-50" disabled={isCreatingAlert} type="submit">{isCreatingAlert ? "Adding…" : "Add alert"}</button></div></form> : null}

    <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1" aria-live="polite">
      {displayedAlerts.map((alert) => <StaffAlertCard
        acknowledgements={acknowledgements.filter((acknowledgement) => acknowledgement.alert_id === alert.id)}
        alert={alert}
        busy={busyAlertId === alert.id}
        currentProfile={currentProfile}
        historical={isShowingHistory}
        key={alert.id}
        people={people}
        onAcknowledge={() => void acknowledge(alert.id)}
        onArchive={() => void archiveAlert(alert.id)}
        onDelete={() => void deleteAlert(alert.id)}
      />)}
      {displayedAlerts.length === 0 ? <div className="rounded-2xl bg-white/10 px-4 py-8 text-center"><Check className="mx-auto mb-2 text-[#b8d2bd]" size={28} /><strong className="block">{isShowingHistory ? "No alert history yet." : "Everything is up to date."}</strong>{!isShowingHistory ? <small className="text-[#cdd9cf]">New stable changes will appear here.</small> : null}</div> : null}
    </div>
  </div>;
}

interface StaffAlertCardProps {
  readonly acknowledgements: readonly StaffAlertAcknowledgement[];
  readonly alert: StaffAlert;
  readonly busy: boolean;
  readonly currentProfile: Profile;
  readonly historical: boolean;
  readonly people: readonly Profile[];
  readonly onAcknowledge: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
}

const alertDateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function StaffAlertCard({ acknowledgements, alert, busy, currentProfile, historical, people, onAcknowledge, onArchive, onDelete }: StaffAlertCardProps): React.JSX.Element {
  const personById = new Map(people.map((person) => [person.id, person]));
  const actor = alert.changed_by ? personById.get(alert.changed_by) : null;
  const currentAcknowledgement = acknowledgements.find((acknowledgement) => acknowledgement.profile_id === currentProfile.id);
  const urgent = alert.priority === "urgent";
  const alertDate = alertDateFormatter.format(new Date(alert.created_at));

  return <article className={`rounded-2xl border p-3 text-[#14261d] ${urgent ? "border-[#e5a48d] bg-[#fff0e9]" : "border-white/70 bg-white"}`}>
    <div className="mb-2 flex items-start justify-between gap-3">
      <p className={`mb-0 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.12em] ${urgent ? "text-[#a13f22]" : "text-[#68736b]"}`}>{urgent ? <TriangleAlert size={14} /> : null}{urgent ? "Urgent care change" : alert.kind === "custom" ? "Staff notice" : "Stable change"}</p>
      <time className="shrink-0 text-xs font-extrabold text-[#385943]" dateTime={alert.created_at}>{alertDate}</time>
    </div>
    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
      <div className="min-w-0">
        <strong className="block leading-5">{alert.title}</strong>
        <p className="mb-0 mt-1 whitespace-pre-wrap text-sm leading-5 text-[#3f5147]">{alert.body}</p>
      </div>
      {!historical ? currentAcknowledgement ? <span className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-[#edf0ed] px-3 text-[10px] font-bold text-[#68736b]"><Check size={13} />Got it</span> : <button className={`min-h-9 shrink-0 rounded-full px-3 text-[10px] font-extrabold text-white shadow-sm disabled:opacity-50 ${urgent ? "bg-[#a13f22]" : "bg-[#1f5f8b]"}`} disabled={busy} onClick={onAcknowledge} type="button">{busy ? "Saving…" : "Got it"}</button> : null}
    </div>
    <div className="mt-2 border-t border-[#dfe3df] pt-2 text-[10px] leading-4 text-[#68736b]">
      <span>Changed by {actor?.full_name ?? "System"}</span>
      {historical ? <span className="ml-2 font-bold">Moved to history</span> : null}
      <div>{acknowledgements.length > 0 ? acknowledgements.map((acknowledgement) => `${firstName(personById.get(acknowledgement.profile_id)?.full_name ?? "Staff")} · Read`).join("  ") : "Not read yet"}</div>
    </div>
    {currentProfile.role === "admin" && !historical ? <button className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[#8a432b] underline disabled:opacity-50" disabled={busy} onClick={onArchive} type="button"><Archive size={12} />Remove to history</button> : null}
    {currentProfile.role === "admin" && historical ? <button className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[#8a432b] underline disabled:opacity-50" disabled={busy} onClick={onDelete} type="button"><Trash2 size={12} />Permanently remove alert</button> : null}
  </article>;
}
