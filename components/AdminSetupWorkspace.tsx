"use client";

import { AlertCircle, ArrowRight, Check, LoaderCircle, LogOut, MapPin, Plus, ShieldCheck, Stethoscope, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { getPagesBasePath } from "@/lib/environment";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { Database, Tables } from "@/types/supabase";

type Profile = Tables<"profiles">;
type Field = Tables<"fields">;
type Herd = Tables<"herds">;
type Horse = Tables<"horses">;
type CareProfile = Tables<"care_profiles">;
type HorseAccess = Tables<"horse_access">;
type Medication = Tables<"horse_medications">;
type AppRole = Database["public"]["Enums"]["app_role"];
type Relationship = Database["public"]["Enums"]["horse_relationship"];
type Section = "locations" | "horses" | "people";
type HorseInformationUpdate = Pick<Database["public"]["Tables"]["horses"]["Update"], "horse_type" | "birth_year" | "veterinarian_name" | "veterinarian_phone" | "farrier_name" | "farrier_phone" | "deworming_schedule" | "vaccine_schedule">;

interface SetupData {
  fields: readonly Field[];
  herds: readonly Herd[];
  horses: readonly Horse[];
  care: readonly CareProfile[];
  profiles: readonly Profile[];
  access: readonly HorseAccess[];
  medications: readonly Medication[];
}

interface HorseView extends Horse {
  fieldName: string;
  herdName: string;
  thumbnailUrl: string | null;
  careProfile: CareProfile | null;
  medications: readonly Medication[];
}

interface Notice {
  tone: "success" | "error";
  message: string;
}

const emptyData: SetupData = { fields: [], herds: [], horses: [], care: [], profiles: [], access: [], medications: [] };
const input = "min-h-12 w-full rounded-xl border border-[#cfd4ce] bg-white px-4 text-base outline-none focus:border-[#385943] focus:ring-2 focus:ring-[#385943]/10";
const area = `${input} min-h-24 resize-y py-3 leading-6`;
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#1d3528] px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#cfd4ce] bg-white px-4 py-2 text-sm font-bold text-[#385943] disabled:opacity-50";

function value(formData: FormData, name: string): string {
  const formValue = formData.get(name);
  return typeof formValue === "string" ? formValue.trim() : "";
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

async function invitationErrorMessage(error: unknown): Promise<string> {
  if (typeof error === "object" && error !== null && "context" in error && error.context instanceof Response) {
    const responseBody: unknown = await error.context.clone().json().catch((): null => null);
    if (typeof responseBody === "object" && responseBody !== null && "error" in responseBody && typeof responseBody.error === "string") {
      return responseBody.error;
    }
  }
  return messageFrom(error);
}

function horseInformationFrom(formData: FormData): HorseInformationUpdate {
  const birthYearText = value(formData, "birthYear");
  return {
    horse_type: value(formData, "horseType"),
    birth_year: birthYearText ? Number.parseInt(birthYearText, 10) : null,
    veterinarian_name: value(formData, "veterinarianName"),
    veterinarian_phone: value(formData, "veterinarianPhone"),
    farrier_name: value(formData, "farrierName"),
    farrier_phone: value(formData, "farrierPhone"),
    deworming_schedule: value(formData, "dewormingSchedule"),
    vaccine_schedule: value(formData, "vaccineSchedule"),
  };
}

function thumbnailFileFrom(formData: FormData): File | null {
  const file = formData.get("thumbnail");
  return file instanceof File && file.size > 0 ? file : null;
}

function roleLabel(role: AppRole): string {
  return role === "stable_hand" ? "Rebel Wrangler" : role === "admin" ? "Administrator" : "Owner / family";
}

export function AdminSetupWorkspace(): React.JSX.Element {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<SetupData>(emptyData);
  const [thumbnailUrls, setThumbnailUrls] = useState<Readonly<Record<string, string>>>({});
  const [section, setSection] = useState<Section>("locations");
  const [selectedHorseId, setSelectedHorseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [accessProblem, setAccessProblem] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const loadData = useCallback(async (administrator: Profile): Promise<void> => {
    const client = getSupabaseBrowserClient();
    const results = await Promise.all([
      client.from("fields").select("*").eq("organization_id", administrator.organization_id).order("name"),
      client.from("herds").select("*").eq("organization_id", administrator.organization_id).order("name"),
      client.from("horses").select("*").eq("organization_id", administrator.organization_id).order("name"),
      client.from("care_profiles").select("*").order("updated_at", { ascending: false }),
      client.from("profiles").select("*").eq("organization_id", administrator.organization_id).order("full_name"),
      client.from("horse_access").select("*").order("created_at"),
      client.from("horse_medications").select("*").order("starts_on", { ascending: false }),
    ]);
    const firstError = results.map((result) => result.error).find((error) => error !== null);
    if (firstError) throw firstError;
    const loadedHorses = results[2].data ?? [];
    const thumbnailResults = await Promise.all(loadedHorses.flatMap((horse) => horse.photo_path ? [client.storage.from("horse-thumbnails").createSignedUrl(horse.photo_path, 3600).then((result) => ({ path: horse.photo_path, ...result }))] : []));
    const signedThumbnailUrls = thumbnailResults.reduce<Record<string, string>>((urls, result) => {
      if (result.path && result.data?.signedUrl) urls[result.path] = result.data.signedUrl;
      return urls;
    }, {});
    setThumbnailUrls(signedThumbnailUrls);
    setData({
      fields: results[0].data ?? [], herds: results[1].data ?? [], horses: loadedHorses,
      care: results[3].data ?? [], profiles: results[4].data ?? [], access: results[5].data ?? [],
      medications: results[6].data ?? [],
    });
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    async function initialize(): Promise<void> {
      setLoading(true);
      setAccessProblem(null);
      setAccessDenied(false);
      try {
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError || !userData.user) {
          router.replace("/login/");
          return;
        }
        const { data: currentProfile, error } = await client.from("profiles").select("*").eq("id", userData.user.id).maybeSingle();
        if (error) throw error;
        if (!currentProfile) throw new Error("Your sign-in succeeded, but the matching Rebel Woods profile could not be loaded.");
        setProfile(currentProfile);
        if (currentProfile.role !== "admin" || !currentProfile.is_active) {
          setAccessDenied(true);
          return;
        }
        await loadData(currentProfile);
      } catch (error: unknown) {
        setAccessProblem(messageFrom(error));
      } finally {
        setLoading(false);
      }
    }
    void initialize();
    const { data: subscription } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login/");
    });
    return (): void => subscription.subscription.unsubscribe();
  }, [loadData, retryCount, router]);

  const horseViews = useMemo<readonly HorseView[]>(() => {
    const fieldNames = new Map(data.fields.map((field) => [field.id, field.name]));
    const herdNames = new Map(data.herds.map((herd) => [herd.id, herd.name]));
    const careByHorse = new Map(data.care.map((careProfile) => [careProfile.horse_id, careProfile]));
    return data.horses.map((horse) => ({
      ...horse,
      fieldName: horse.field_id ? fieldNames.get(horse.field_id) ?? "Unassigned" : "Unassigned",
      herdName: horse.herd_id ? herdNames.get(horse.herd_id) ?? "Unassigned" : "Unassigned",
      thumbnailUrl: horse.photo_path ? thumbnailUrls[horse.photo_path] ?? null : null,
      careProfile: careByHorse.get(horse.id) ?? null,
      medications: data.medications.filter((medication) => medication.horse_id === horse.id),
    }));
  }, [data, thumbnailUrls]);
  const horses = horseViews.filter((horse) => horse.is_active);
  const owners = data.profiles.filter((person) => person.role === "owner" && person.is_active);
  const hasInvitedPerson = data.profiles.some((person) => person.id !== profile?.id && person.is_active);
  const selectedHorse = horseViews.find((horse) => horse.id === selectedHorseId) ?? null;
  const progress = [data.fields.length > 0 && data.herds.length > 0, horses.length > 0, hasInvitedPerson].filter(Boolean).length;

  async function refresh(successMessage: string): Promise<void> {
    if (!profile) return;
    await loadData(profile);
    setNotice({ tone: "success", message: successMessage });
  }

  async function mutate(action: () => Promise<void>): Promise<void> {
    setSaving(true);
    setNotice(null);
    try { await action(); } catch (error: unknown) { setNotice({ tone: "error", message: messageFrom(error) }); } finally { setSaving(false); }
  }

  async function addLocation(event: FormEvent<HTMLFormElement>, kind: "field" | "herd"): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    const form = event.currentTarget;
    const name = value(new FormData(form), "name");
    if (!name) return;
    await mutate(async () => {
      const client = getSupabaseBrowserClient();
      const result = kind === "field"
        ? await client.from("fields").insert({ name, organization_id: profile.organization_id })
        : await client.from("herds").insert({ name, organization_id: profile.organization_id });
      if (result.error) throw result.error;
      form.reset();
      await refresh(`${name} was added.`);
    });
  }

  async function addHorse(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    await mutate(async () => {
      const client = getSupabaseBrowserClient();
      const { data: horse, error } = await client.from("horses").insert({
        organization_id: profile.organization_id,
        name: value(formData, "horseName"), field_id: value(formData, "fieldId") || null,
        herd_id: value(formData, "herdId") || null, ...horseInformationFrom(formData),
      }).select("*").single();
      if (error) throw error;
      const { error: careError } = await client.from("care_profiles").insert({
        horse_id: horse.id, updated_by: profile.id, am_feed: value(formData, "amFeed"),
        pm_feed: value(formData, "pmFeed"), supplements_am: value(formData, "supplementsAm"),
        supplements_pm: value(formData, "supplementsPm"),
        special_requirements: value(formData, "specialRequirements"),
      });
      if (careError) throw careError;
      form.reset();
      setSelectedHorseId(horse.id);
      await refresh(`${horse.name} and their care card were added.`);
    });
  }

  async function updateCare(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile || !selectedHorse) return;
    const formData = new FormData(event.currentTarget);
    await mutate(async () => {
      const client = getSupabaseBrowserClient();
      const { error: horseError } = await client.from("horses").update({
        field_id: value(formData, "fieldId") || null, herd_id: value(formData, "herdId") || null,
      }).eq("id", selectedHorse.id);
      if (horseError) throw horseError;
      const { error } = await client.from("care_profiles").upsert({
        horse_id: selectedHorse.id, updated_by: profile.id, am_feed: value(formData, "amFeed"),
        pm_feed: value(formData, "pmFeed"), supplements_am: value(formData, "supplementsAm"),
        supplements_pm: value(formData, "supplementsPm"),
        special_requirements: value(formData, "specialRequirements"),
      });
      if (error) throw error;
      await refresh(`${selectedHorse.name}’s care card was updated.`);
    });
  }

  async function updateHorseInformation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile || !selectedHorse) return;
    const formData = new FormData(event.currentTarget);
    const thumbnail = thumbnailFileFrom(formData);
    await mutate(async () => {
      const client = getSupabaseBrowserClient();
      const { error: informationError } = await client.from("horses").update(horseInformationFrom(formData)).eq("id", selectedHorse.id);
      if (informationError) throw informationError;
      if (thumbnail) {
        if (thumbnail.size > 10 * 1024 * 1024) throw new Error("The thumbnail must be 10 MB or smaller.");
        if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(thumbnail.type)) throw new Error("Choose a JPG, PNG, WebP, or HEIC image.");
        const storagePath = `${profile.organization_id}/${selectedHorse.id}/thumbnail`;
        const { error: uploadError } = await client.storage.from("horse-thumbnails").upload(storagePath, thumbnail, { contentType: thumbnail.type, upsert: true });
        if (uploadError) throw uploadError;
        const { error: photoPathError } = await client.from("horses").update({ photo_path: storagePath }).eq("id", selectedHorse.id);
        if (photoPathError) throw photoPathError;
      }
      await refresh(`${selectedHorse.name}’s information card was updated.`);
    });
  }

  async function addMedication(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile || !selectedHorse) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    await mutate(async () => {
      const { error } = await getSupabaseBrowserClient().from("horse_medications").insert({
        horse_id: selectedHorse.id, name: value(formData, "medicationName"), dosage: value(formData, "dosage"),
        instructions: value(formData, "instructions"), starts_on: value(formData, "startsOn"),
        ends_on: value(formData, "endsOn") || null, created_by: profile.id, updated_by: profile.id,
      });
      if (error) throw error;
      form.reset();
      await refresh(`Medication added for ${selectedHorse.name}.`);
    });
  }

  async function completeMedication(medication: Medication): Promise<void> {
    if (!profile) return;
    await mutate(async () => {
      const { error } = await getSupabaseBrowserClient().from("horse_medications").update({ status: "completed", updated_by: profile.id }).eq("id", medication.id);
      if (error) throw error;
      await refresh(`${medication.name} was moved to medication history.`);
    });
  }

  async function invite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const roleValue = value(formData, "role");
    const role: AppRole = roleValue === "admin" ? "admin" : roleValue === "stable_hand" ? "stable_hand" : "owner";
    await mutate(async () => {
      const { error } = await getSupabaseBrowserClient().functions.invoke("invite-user", { body: {
        email: value(formData, "email").toLowerCase(), fullName: value(formData, "fullName"), phone: value(formData, "phone"), role,
      } });
      if (error) throw new Error(await invitationErrorMessage(error));
      form.reset();
      await refresh("The invitation was sent.");
    });
  }

  async function grantAccess(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    const formData = new FormData(event.currentTarget);
    const relationship: Relationship = value(formData, "relationship") === "primary_owner" ? "primary_owner" : "family";
    await mutate(async () => {
      const { error } = await getSupabaseBrowserClient().from("horse_access").upsert({
        horse_id: value(formData, "horseId"), profile_id: value(formData, "profileId"),
        relationship, granted_by: profile.id,
      });
      if (error) throw error;
      await refresh("Horse access was updated.");
    });
  }

  async function updatePersonPhone(event: FormEvent<HTMLFormElement>, personId: string): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await mutate(async () => {
      const { error } = await getSupabaseBrowserClient().from("profiles").update({ phone: value(formData, "phone") }).eq("id", personId);
      if (error) throw error;
      await refresh("The contact phone number was updated.");
    });
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#f7f3e9] text-[#385943]"><span className="flex items-center gap-3 font-bold"><LoaderCircle className="animate-spin" />Opening Rebel Woods…</span></div>;
  if (accessProblem) return <AccessProblem details={accessProblem} onRetry={() => setRetryCount((count) => count + 1)} onSignOut={() => void getSupabaseBrowserClient().auth.signOut()} />;
  if (accessDenied || !profile) return <AccessDenied onSignOut={() => void getSupabaseBrowserClient().auth.signOut()} />;

  return (
    <div className="min-h-screen bg-[#f7f3e9] pb-20 text-[#14261d]">
      <header className="border-b border-[#dedfd8] bg-[#fffdf8]/95 px-5 py-4"><div className="mx-auto flex max-w-6xl items-center justify-between"><Brand /><div className="flex items-center gap-3"><a className={secondary} href={`${getPagesBasePath()}/`}>Stable home</a><span className="hidden text-right sm:block"><strong className="block text-sm">{profile.full_name}</strong><small className="text-[#68736b]">Administrator</small></span><button className="grid h-10 w-10 place-items-center rounded-full border border-[#dedfd8] bg-white" onClick={() => void getSupabaseBrowserClient().auth.signOut()} type="button" aria-label="Sign out"><LogOut size={17} /></button></div></div></header>
      <div className="mx-auto max-w-6xl px-5 py-10">
        <section className="mb-8 grid gap-5 rounded-[2rem] bg-[#1d3528] p-7 text-white shadow-xl md:grid-cols-[1fr_auto] md:items-end md:p-9"><div><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#d9a27b]">Live stable setup</p><h1 className="mb-3 max-w-2xl font-serif text-4xl leading-tight md:text-5xl">Let’s add the real Rebel Woods herd.</h1><p className="mb-0 max-w-2xl leading-7 text-[#cdd9cf]">Start with fields and herds, then add each horse’s care card and invite their people.</p></div><div className="rounded-2xl bg-white/10 px-5 py-4"><strong className="block text-3xl">{progress} / 3</strong><small className="text-[#cdd9cf]">setup areas started</small></div></section>
        {notice ? <div className={`mb-6 flex gap-3 rounded-2xl border p-4 text-sm ${notice.tone === "success" ? "border-[#b8c9bb] bg-[#e4ece4] text-[#1d3528]" : "border-[#e1b8a6] bg-[#f3ded3] text-[#73391f]"}`} role="status">{notice.tone === "success" ? <Check size={18} /> : <AlertCircle size={18} />}<span>{notice.message}</span></div> : null}
        <nav className="mb-7 grid gap-2 rounded-2xl border border-[#dedfd8] bg-[#fffdf8] p-2 sm:grid-cols-3" aria-label="Setup sections">
          <Tab active={section === "locations"} complete={data.fields.length > 0 && data.herds.length > 0} icon={<MapPin size={18} />} label="1. Fields & herds" onClick={() => setSection("locations")} />
          <Tab active={section === "horses"} complete={horses.length > 0} icon={<Stethoscope size={18} />} label="2. Horses & care" onClick={() => setSection("horses")} />
          <Tab active={section === "people"} complete={hasInvitedPerson} icon={<UsersRound size={18} />} label="3. People & access" onClick={() => setSection("people")} />
        </nav>
        {section === "locations" ? <Locations fields={data.fields} herds={data.herds} saving={saving} onAdd={addLocation} onContinue={() => setSection("horses")} /> : null}
        {section === "horses" ? <Horses access={data.access} fields={data.fields} herds={data.herds} horses={horses} profiles={data.profiles} saving={saving} selectedHorse={selectedHorse} onAdd={addHorse} onAddMedication={addMedication} onCompleteMedication={completeMedication} onContinue={() => setSection("people")} onSelect={setSelectedHorseId} onUpdateCare={updateCare} onUpdateInformation={updateHorseInformation} /> : null}
        {section === "people" ? <People access={data.access} horses={horses} owners={owners} profiles={data.profiles} saving={saving} onGrant={grantAccess} onInvite={invite} onUpdatePhone={updatePersonPhone} /> : null}
      </div>
    </div>
  );
}

function Brand(): React.JSX.Element {
  return <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-[#1d3528] font-serif text-sm text-white">RW</span><span><strong className="block font-serif text-lg">Rebel Woods</strong><small className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#a65333]">Administrator setup</small></span></div>;
}

function AccessDenied({ onSignOut }: { readonly onSignOut: () => void }): React.JSX.Element {
  return <div className="grid min-h-screen place-items-center bg-[#f7f3e9] px-5"><section className="max-w-lg rounded-[2rem] border border-[#dedfd8] bg-[#fffdf8] p-8 text-center shadow-xl"><ShieldCheck className="mx-auto mb-5 text-[#a65333]" size={42} /><h1 className="mb-3 font-serif text-4xl">Administrator access needed</h1><p className="mb-6 leading-7 text-[#68736b]">This setup area is only available to an active Rebel Woods administrator.</p><button className={secondary} onClick={onSignOut} type="button">Sign out</button></section></div>;
}

function AccessProblem({ details, onRetry, onSignOut }: { readonly details: string; readonly onRetry: () => void; readonly onSignOut: () => void }): React.JSX.Element {
  return <div className="grid min-h-screen place-items-center bg-[#f7f3e9] px-5"><section className="max-w-lg rounded-[2rem] border border-[#dedfd8] bg-[#fffdf8] p-8 text-center shadow-xl"><AlertCircle className="mx-auto mb-5 text-[#a65333]" size={42} /><h1 className="mb-3 font-serif text-4xl">We couldn’t open the setup.</h1><p className="mb-4 leading-7 text-[#68736b]">Your account is still safe. The app could not finish loading your administrator profile.</p><p className="mb-6 rounded-xl bg-[#f3ded3] p-3 text-sm text-[#73391f]">{details}</p><div className="flex flex-wrap justify-center gap-3"><button className={primary} onClick={onRetry} type="button">Try again</button><button className={secondary} onClick={onSignOut} type="button">Sign out</button></div></section></div>;
}

function Tab({ active, complete, icon, label, onClick }: { readonly active: boolean; readonly complete: boolean; readonly icon: React.ReactNode; readonly label: string; readonly onClick: () => void }): React.JSX.Element {
  return <button className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-left text-sm font-bold ${active ? "bg-[#1d3528] text-white" : "text-[#385943] hover:bg-[#e4ece4]"}`} onClick={onClick} type="button">{icon}<span className="flex-1">{label}</span>{complete ? <Check size={17} /> : null}</button>;
}

function Intro({ step, title, children }: { readonly step: string; readonly title: string; readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="mb-6"><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#a65333]">{step}</p><h2 className="mb-2 font-serif text-3xl md:text-4xl">{title}</h2><p className="mb-0 max-w-3xl leading-7 text-[#68736b]">{children}</p></div>;
}

function Card({ title, description, children }: { readonly title: string; readonly description: string; readonly children: React.ReactNode }): React.JSX.Element {
  return <article className="rounded-[1.5rem] border border-[#dedfd8] bg-[#fffdf8] p-5 shadow-sm md:p-6"><div className="mb-5"><h3 className="mb-1 font-serif text-2xl">{title}</h3><p className="mb-0 text-sm leading-6 text-[#68736b]">{description}</p></div>{children}</article>;
}

function Label({ name, children }: { readonly name: string; readonly children: React.ReactNode }): React.JSX.Element {
  return <label className="block"><span className="mb-2 block text-sm font-bold text-[#385943]">{name}</span>{children}</label>;
}

function Continue({ disabled, onClick, children }: { readonly disabled: boolean; readonly onClick: () => void; readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="mt-6 flex justify-end"><button className={primary} disabled={disabled} onClick={onClick} type="button">{children}<ArrowRight size={17} /></button></div>;
}

function Empty({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="rounded-2xl border border-dashed border-[#cfd4ce] bg-[#f7f3e9] p-5 text-center text-sm text-[#68736b]">{children}</div>;
}

function Locations({ fields, herds, saving, onAdd, onContinue }: { readonly fields: readonly Field[]; readonly herds: readonly Herd[]; readonly saving: boolean; readonly onAdd: (event: FormEvent<HTMLFormElement>, kind: "field" | "herd") => Promise<void>; readonly onContinue: () => void }): React.JSX.Element {
  return <section><Intro step="Step one" title="Where do the horses live?">Add the field and herd names your team already uses. You can add more later.</Intro><div className="grid gap-5 md:grid-cols-2"><LocationCard title="Fields" example="North Field, Creek Field" items={fields} saving={saving} onSubmit={(event) => onAdd(event, "field")} /><LocationCard title="Herds" example="Willow Herd, Oak Herd" items={herds} saving={saving} onSubmit={(event) => onAdd(event, "herd")} /></div><Continue disabled={fields.length === 0 || herds.length === 0} onClick={onContinue}>Continue to horses</Continue></section>;
}

function LocationCard({ title, example, items, saving, onSubmit }: { readonly title: string; readonly example: string; readonly items: readonly (Field | Herd)[]; readonly saving: boolean; readonly onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }): React.JSX.Element {
  return <Card title={title} description={`Examples: ${example}`}><form className="flex gap-2" onSubmit={(event) => void onSubmit(event)}><input className={input} maxLength={100} name="name" placeholder={`${title.slice(0, -1)} name`} required /><button className={primary} disabled={saving} type="submit"><Plus size={17} /><span className="sr-only sm:not-sr-only">Add</span></button></form><div className="mt-4 flex flex-wrap gap-2">{items.filter((item) => item.is_active).map((item) => <span className="rounded-full bg-[#e4ece4] px-3 py-1.5 text-sm font-bold text-[#385943]" key={item.id}>{item.name}</span>)}{items.length === 0 ? <p className="mb-0 text-sm text-[#68736b]">None added yet.</p> : null}</div></Card>;
}

function LocationSelectors({ fields, herds, horse }: { readonly fields: readonly Field[]; readonly herds: readonly Herd[]; readonly horse?: Horse }): React.JSX.Element {
  return <div className="grid gap-4 sm:grid-cols-2"><Label name="Field"><select className={input} defaultValue={horse?.field_id ?? ""} name="fieldId"><option value="">Not assigned</option>{fields.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Label><Label name="Herd"><select className={input} defaultValue={horse?.herd_id ?? ""} name="herdId"><option value="">Not assigned</option>{herds.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Label></div>;
}

function CareFields({ care }: { readonly care?: CareProfile | null }): React.JSX.Element {
  return <><div className="grid gap-4 sm:grid-cols-2"><Label name="AM feed"><textarea className={area} defaultValue={care?.am_feed ?? ""} maxLength={2000} name="amFeed" /></Label><Label name="PM feed"><textarea className={area} defaultValue={care?.pm_feed ?? ""} maxLength={2000} name="pmFeed" /></Label></div><div className="grid gap-4 sm:grid-cols-2"><Label name="AM supplements"><textarea className={area} defaultValue={care?.supplements_am ?? ""} maxLength={2000} name="supplementsAm" /></Label><Label name="PM supplements"><textarea className={area} defaultValue={care?.supplements_pm ?? ""} maxLength={2000} name="supplementsPm" /></Label></div><Label name="Special requirements"><textarea className={area} defaultValue={care?.special_requirements ?? ""} maxLength={4000} name="specialRequirements" placeholder="Care instructions everyone should know" /></Label></>;
}

interface HorseSectionProps {
  access: readonly HorseAccess[]; fields: readonly Field[]; herds: readonly Herd[]; horses: readonly HorseView[]; profiles: readonly Profile[]; saving: boolean; selectedHorse: HorseView | null;
  onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>; onAddMedication: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCompleteMedication: (medication: Medication) => Promise<void>; onContinue: () => void; onSelect: (id: string | null) => void;
  onUpdateCare: (event: FormEvent<HTMLFormElement>) => Promise<void>; onUpdateInformation: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

function Horses(props: HorseSectionProps): React.JSX.Element {
  const { access, fields, herds, horses, profiles, saving, selectedHorse, onAdd, onAddMedication, onCompleteMedication, onContinue, onSelect, onUpdateCare, onUpdateInformation } = props;
  const people = new Map(profiles.map((person) => [person.id, person]));
  const ownerContacts = selectedHorse ? access.filter((permission) => permission.horse_id === selectedHorse.id).flatMap((permission) => {
    const owner = people.get(permission.profile_id);
    return owner?.role === "owner" ? [{ owner, relationship: permission.relationship }] : [];
  }) : [];
  return <section><Intro step="Step two" title="Add horses, information, and care instructions.">Only administrators can change this information. Special requirement changes automatically alert administrators and Rebel Wranglers.</Intro><div className="grid gap-5 lg:grid-cols-[0.75fr_1.25fr]"><Card title="Your horses" description={`${horses.length} active ${horses.length === 1 ? "horse" : "horses"}`}><div className="space-y-2">{horses.length === 0 ? <Empty>No horses added yet.</Empty> : horses.map((horse) => <button className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${selectedHorse?.id === horse.id ? "border-[#385943] bg-[#e4ece4]" : "border-[#dedfd8] bg-white"}`} key={horse.id} onClick={() => onSelect(horse.id)} type="button">{horse.thumbnailUrl ? <span aria-label={`${horse.name} thumbnail`} className="h-12 w-12 shrink-0 rounded-full bg-cover bg-center" role="img" style={{ backgroundImage: `url(${horse.thumbnailUrl})` }} /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#1d3528] font-serif text-white">{horse.name[0]}</span>}<span className="min-w-0 flex-1"><strong className="block truncate">{horse.name}</strong><small className="block truncate text-[#68736b]">{horse.fieldName} · {horse.herdName}</small></span><ArrowRight size={17} /></button>)}</div></Card>{selectedHorse ? <div className="space-y-5"><HorseInformationCard horse={selectedHorse} ownerContacts={ownerContacts} saving={saving} onUpdate={onUpdateInformation} /><Card title={`${selectedHorse.name}’s care card`} description="Feed, supplements, and daily instructions"><form className="space-y-4" key={selectedHorse.careProfile?.updated_at ?? selectedHorse.id} onSubmit={(event) => void onUpdateCare(event)}><LocationSelectors fields={fields} herds={herds} horse={selectedHorse} /><CareFields care={selectedHorse.careProfile} /><button className={primary} disabled={saving} type="submit"><Check size={17} />Save care card</button></form></Card><MedicationCard horse={selectedHorse} saving={saving} onAdd={onAddMedication} onComplete={onCompleteMedication} /></div> : <AddHorseCard fields={fields} herds={herds} saving={saving} onAdd={onAdd} />}</div>{selectedHorse ? <button className={`${secondary} mt-5`} onClick={() => onSelect(null)} type="button"><Plus size={16} />Add another horse</button> : null}<Continue disabled={horses.length === 0} onClick={onContinue}>Continue to people</Continue></section>;
}

function AddHorseCard({ fields, herds, saving, onAdd }: { readonly fields: readonly Field[]; readonly herds: readonly Herd[]; readonly saving: boolean; readonly onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void> }): React.JSX.Element {
  return <Card title="Add a horse" description="Unknown profile and care details can be finished later."><form className="space-y-4" onSubmit={(event) => void onAdd(event)}><Label name="Horse name"><input className={input} maxLength={100} name="horseName" required /></Label><HorseInformationFields /><LocationSelectors fields={fields} herds={herds} /><CareFields /><button className={primary} disabled={saving} type="submit"><Plus size={17} />Add horse</button></form></Card>;
}

function HorseInformationFields({ horse }: { readonly horse?: Horse }): React.JSX.Element {
  const latestBirthYear = new Date().getFullYear() + 1;
  return <><div className="grid gap-4 sm:grid-cols-2"><Label name="Breed or type"><input className={input} defaultValue={horse?.horse_type ?? ""} maxLength={160} name="horseType" placeholder="Example: Quarter Horse" /></Label><Label name="Year born"><input className={input} defaultValue={horse?.birth_year ?? ""} max={latestBirthYear} min={1900} name="birthYear" placeholder="Example: 2015" type="number" /></Label></div><div className="grid gap-4 sm:grid-cols-2"><Label name="Veterinarian"><input className={input} defaultValue={horse?.veterinarian_name ?? ""} maxLength={160} name="veterinarianName" /></Label><Label name="Veterinarian phone"><input autoComplete="tel" className={input} defaultValue={horse?.veterinarian_phone ?? ""} maxLength={50} name="veterinarianPhone" type="tel" /></Label></div><div className="grid gap-4 sm:grid-cols-2"><Label name="Farrier"><input className={input} defaultValue={horse?.farrier_name ?? ""} maxLength={160} name="farrierName" /></Label><Label name="Farrier phone"><input autoComplete="tel" className={input} defaultValue={horse?.farrier_phone ?? ""} maxLength={50} name="farrierPhone" type="tel" /></Label></div><div className="grid gap-4 sm:grid-cols-2"><Label name="Deworming schedule"><textarea className={area} defaultValue={horse?.deworming_schedule ?? ""} maxLength={4000} name="dewormingSchedule" placeholder="Products, dates, or rotation instructions" /></Label><Label name="Vaccine schedule"><textarea className={area} defaultValue={horse?.vaccine_schedule ?? ""} maxLength={4000} name="vaccineSchedule" placeholder="Vaccines, due dates, and instructions" /></Label></div></>;
}

function HorseInformationCard({ horse, ownerContacts, saving, onUpdate }: { readonly horse: HorseView; readonly ownerContacts: readonly { readonly owner: Profile; readonly relationship: Relationship }[]; readonly saving: boolean; readonly onUpdate: (event: FormEvent<HTMLFormElement>) => Promise<void> }): React.JSX.Element {
  return <Card title={`${horse.name}’s information card`} description="Identity, health contacts, schedules, and owner contacts"><form className="space-y-4" key={horse.updated_at} onSubmit={(event) => void onUpdate(event)}><div className="flex flex-col gap-4 rounded-2xl bg-[#f7f3e9] p-4 sm:flex-row sm:items-center">{horse.thumbnailUrl ? <span aria-label={`${horse.name} thumbnail`} className="h-24 w-24 shrink-0 rounded-2xl bg-cover bg-center" role="img" style={{ backgroundImage: `url(${horse.thumbnailUrl})` }} /> : <span className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-[#1d3528] font-serif text-3xl text-white">{horse.name[0]}</span>}<Label name="Thumbnail photo"><input accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-[#e4ece4] file:px-4 file:py-2 file:font-bold file:text-[#385943]" name="thumbnail" type="file" /></Label></div><HorseInformationFields horse={horse} /><button className={primary} disabled={saving} type="submit"><Check size={17} />Save information card</button></form><div className="mt-6 border-t border-[#dedfd8] pt-5"><h4 className="mb-3 font-serif text-xl">Owners and family</h4>{ownerContacts.length === 0 ? <Empty>Connect an owner in People & access to show their contact information here.</Empty> : <div className="grid gap-3 sm:grid-cols-2">{ownerContacts.map(({ owner, relationship }) => <address className="rounded-xl border border-[#dedfd8] bg-white p-4 text-sm not-italic" key={owner.id}><strong className="block">{owner.full_name}</strong><span className="mb-2 block text-xs text-[#68736b]">{relationship === "primary_owner" ? "Primary owner" : "Authorized family"}</span><a className="block font-bold text-[#385943] underline" href={`mailto:${owner.email}`}>{owner.email}</a>{owner.phone ? <a className="mt-1 block font-bold text-[#385943] underline" href={`tel:${owner.phone}`}>{owner.phone}</a> : <span className="mt-1 block text-[#68736b]">Phone not added</span>}</address>)}</div>}</div></Card>;
}

function MedicationCard({ horse, saving, onAdd, onComplete }: { readonly horse: HorseView; readonly saving: boolean; readonly onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>; readonly onComplete: (medication: Medication) => Promise<void> }): React.JSX.Element {
  const active = horse.medications.filter((medication) => medication.status === "active");
  const history = horse.medications.filter((medication) => medication.status !== "active");
  return <Card title="Temporary medications" description="Completed medications move to history."><div className="mb-4 space-y-2">{active.map((medication) => <div className="flex items-start justify-between gap-3 rounded-xl bg-[#f3ded3] p-3 text-sm" key={medication.id}><span><strong className="block">{medication.name} · {medication.dosage}</strong><small className="text-[#73391f]">{medication.instructions}</small></span><button className={secondary} disabled={saving} onClick={() => void onComplete(medication)} type="button">Complete</button></div>)}{active.length === 0 ? <p className="rounded-xl bg-[#e4ece4] p-3 text-sm text-[#385943]">No active temporary medications.</p> : null}{history.length > 0 ? <details className="rounded-xl border border-[#dedfd8] bg-white p-3"><summary className="cursor-pointer text-sm font-bold">Medication history · {history.length}</summary>{history.map((medication) => <p className="mb-0 mt-2 text-sm text-[#68736b]" key={medication.id}>{medication.name} · {medication.dosage}</p>)}</details> : null}</div><details className="rounded-xl border border-[#dedfd8] bg-white p-3"><summary className="cursor-pointer text-sm font-bold text-[#385943]">Add a medication</summary><form className="mt-4 space-y-4" onSubmit={(event) => void onAdd(event)}><div className="grid gap-4 sm:grid-cols-2"><Label name="Medication"><input className={input} maxLength={160} name="medicationName" required /></Label><Label name="Dosage"><input className={input} maxLength={300} name="dosage" required /></Label></div><Label name="Instructions"><textarea className={area} maxLength={2000} name="instructions" required /></Label><div className="grid gap-4 sm:grid-cols-2"><Label name="Start date"><input className={input} name="startsOn" type="date" required /></Label><Label name="End date (optional)"><input className={input} name="endsOn" type="date" /></Label></div><button className={primary} disabled={saving} type="submit"><Plus size={17} />Add medication</button></form></details></Card>;
}

interface PeopleProps {
  access: readonly HorseAccess[]; horses: readonly HorseView[]; owners: readonly Profile[]; profiles: readonly Profile[]; saving: boolean;
  onGrant: (event: FormEvent<HTMLFormElement>) => Promise<void>; onInvite: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdatePhone: (event: FormEvent<HTMLFormElement>, personId: string) => Promise<void>;
}

function People({ access, horses, owners, profiles, saving, onGrant, onInvite, onUpdatePhone }: PeopleProps): React.JSX.Element {
  const people = new Map(profiles.map((person) => [person.id, person]));
  const horseNames = new Map(horses.map((horse) => [horse.id, horse.name]));
  return <section><Intro step="Step three" title="Invite people and connect owners to horses.">Owners and authorized family receive the same horse access. Their phone numbers appear on each connected horse’s information card.</Intro><div className="grid gap-5 lg:grid-cols-2"><Card title="Invite a person" description="They’ll receive a password-free sign-in link."><form className="space-y-4" onSubmit={(event) => void onInvite(event)}><Label name="Full name"><input className={input} maxLength={120} name="fullName" required /></Label><Label name="Email address"><input autoComplete="email" className={input} name="email" type="email" required /></Label><Label name="Phone number"><input autoComplete="tel" className={input} maxLength={50} name="phone" type="tel" /></Label><Label name="Role"><select className={input} name="role"><option value="owner">Owner or family member</option><option value="stable_hand">Rebel Wrangler</option><option value="admin">Administrator</option></select></Label><button className={primary} disabled={saving} type="submit"><UsersRound size={17} />Send invitation</button></form></Card><Card title="Connect an owner to a horse" description="Primary owners and family have equal app access.">{owners.length > 0 && horses.length > 0 ? <form className="space-y-4" onSubmit={(event) => void onGrant(event)}><Label name="Person"><select className={input} name="profileId">{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.full_name}</option>)}</select></Label><Label name="Horse"><select className={input} name="horseId">{horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}</select></Label><Label name="Relationship"><select className={input} name="relationship"><option value="primary_owner">Primary owner</option><option value="family">Authorized family</option></select></Label><button className={primary} disabled={saving} type="submit"><ShieldCheck size={17} />Save access</button></form> : <Empty>Add a horse and invite an owner first.</Empty>}</Card></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><Card title="People" description={`${profiles.filter((person) => person.is_active).length} active people`}><div className="space-y-3">{profiles.filter((person) => person.is_active).map((person) => <form className="rounded-xl border border-[#dedfd8] bg-white p-3 text-sm" key={person.id} onSubmit={(event) => void onUpdatePhone(event, person.id)}><div className="mb-3 flex items-start justify-between gap-3"><span><strong className="block">{person.full_name}</strong><small className="text-[#68736b]">{person.email}</small></span><span className="rounded-full bg-[#f3ded3] px-2 py-1 text-[10px] font-bold text-[#73391f]">{roleLabel(person.role)}</span></div><div className="flex gap-2"><input aria-label={`${person.full_name} phone number`} className={input} defaultValue={person.phone} maxLength={50} name="phone" placeholder="Phone number" type="tel" /><button className={secondary} disabled={saving} type="submit">Save</button></div></form>)}</div></Card><Card title="Horse access" description="Current owner and family connections">{access.length === 0 ? <Empty>No horse access assigned yet.</Empty> : <div className="space-y-2">{access.map((permission) => <div className="flex justify-between rounded-xl border border-[#dedfd8] bg-white p-3 text-sm" key={`${permission.horse_id}-${permission.profile_id}`}><span><strong className="block">{people.get(permission.profile_id)?.full_name ?? "Unknown person"}</strong><small className="text-[#68736b]">{permission.relationship === "primary_owner" ? "Primary owner" : "Authorized family"}</small></span><strong className="font-serif text-lg">{horseNames.get(permission.horse_id) ?? "Inactive horse"}</strong></div>)}</div>}</Card></div></section>;
}
