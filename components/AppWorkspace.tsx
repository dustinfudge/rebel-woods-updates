"use client";

import { AlertCircle, ArrowLeft, Bell, LogOut, MapPin, MessageCircle, Pill, Settings, ShieldAlert } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ChatWindow, type ChatParticipant } from "@/components/ChatWindow";
import { UpdateComposer, type WeeklyUpdateDraft } from "@/components/UpdateComposer";
import { getPagesBasePath } from "@/lib/environment";
import { readVideoDurationSeconds } from "@/lib/media";
import { getPreviousWeekStartIsoDate, getWeeklyUpdateStatus, getWeekStartIsoDate, type WeeklyUpdateStatus } from "@/lib/week";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { Tables } from "@/types/supabase";

type Profile = Tables<"profiles">;
type Horse = Tables<"horses">;
type Field = Tables<"fields">;
type Herd = Tables<"herds">;
type CareProfile = Tables<"care_profiles">;
type Medication = Tables<"horse_medications">;
type HorseAccess = Tables<"horse_access">;
type WeeklyUpdate = Tables<"weekly_updates">;
type UpdateMedia = Tables<"update_media">;
type Message = Tables<"messages">;
type Notification = Tables<"notifications">;

interface WorkspaceData {
  readonly horses: readonly Horse[];
  readonly fields: readonly Field[];
  readonly herds: readonly Herd[];
  readonly careProfiles: readonly CareProfile[];
  readonly medications: readonly Medication[];
  readonly horseAccess: readonly HorseAccess[];
  readonly weeklyUpdates: readonly WeeklyUpdate[];
  readonly profiles: readonly Profile[];
  readonly notifications: readonly Notification[];
}

interface HorseDashboardItem {
  readonly horse: Horse;
  readonly fieldName: string;
  readonly herdName: string;
  readonly thumbnailUrl: string | null;
  readonly careProfile: CareProfile | null;
  readonly activeMedications: readonly Medication[];
  readonly updates: readonly WeeklyUpdate[];
  readonly currentUpdate: WeeklyUpdate | null;
  readonly latestPublishedUpdate: WeeklyUpdate | null;
  readonly status: WeeklyUpdateStatus;
  readonly unreadCount: number;
  readonly owners: readonly Profile[];
}

interface MediaLink {
  readonly media: UpdateMedia;
  readonly viewUrl: string;
  readonly downloadUrl: string;
}

interface UpdateDetail {
  readonly updateId: string;
  readonly media: readonly MediaLink[];
  readonly messages: readonly Message[];
}

interface WorkspaceNotice {
  readonly tone: "success" | "error";
  readonly message: string;
}

type UpdateFilter = "all" | "attention" | "updated";

const emptyWorkspaceData: WorkspaceData = { horses: [], fields: [], herds: [], careProfiles: [], medications: [], horseAccess: [], weeklyUpdates: [], profiles: [], notifications: [] };
const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#1d3528] px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#cfd4ce] bg-white px-4 py-2 text-sm font-bold text-[#385943] disabled:opacity-50";
const selectInput = "min-h-11 rounded-xl border border-[#cfd4ce] bg-white px-3 text-sm font-semibold text-[#385943] outline-none focus:border-[#385943]";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function roleLabel(profile: Profile): string {
  if (profile.role === "admin") return "Administrator";
  if (profile.role === "stable_hand") return "Rebel Wrangler";
  return "Owner / family";
}

function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `${formatter.format(start)}–${formatter.format(end)}`;
}

function statusPresentation(status: WeeklyUpdateStatus): { readonly label: string; readonly className: string } {
  if (status === "updated") return { label: "Updated", className: "bg-[#dcebdd] text-[#24502f]" };
  if (status === "due_soon") return { label: "Due soon", className: "bg-[#f6e8c9] text-[#75520e]" };
  if (status === "missed") return { label: "Missed last week", className: "bg-[#f3ded3] text-[#73391f]" };
  return { label: "Needs update", className: "bg-[#e9ece8] text-[#516158]" };
}

function safeStorageFilename(filename: string): string {
  const normalizedFilename = filename.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalizedFilename || "media";
}

async function signedThumbnailUrls(horses: readonly Horse[]): Promise<Readonly<Record<string, string>>> {
  const client = getSupabaseBrowserClient();
  const results = await Promise.all(horses.flatMap((horse) => horse.photo_path
    ? [client.storage.from("horse-thumbnails").createSignedUrl(horse.photo_path, 3600).then((result) => ({ path: horse.photo_path, signedUrl: result.data?.signedUrl ?? null }))]
    : []));
  return results.reduce<Record<string, string>>((urls, result) => {
    if (result.signedUrl && result.path) urls[result.path] = result.signedUrl;
    return urls;
  }, {});
}

export function AppWorkspace(): React.JSX.Element {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspaceData, setWorkspaceData] = useState<WorkspaceData>(emptyWorkspaceData);
  const [thumbnailUrls, setThumbnailUrls] = useState<Readonly<Record<string, string>>>({});
  const [selectedHorseId, setSelectedHorseId] = useState<string | null>(null);
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(null);
  const [updateDetail, setUpdateDetail] = useState<UpdateDetail | null>(null);
  const [updateFilter, setUpdateFilter] = useState<UpdateFilter>("all");
  const [fieldFilter, setFieldFilter] = useState("");
  const [herdFilter, setHerdFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isEditingUpdate, setIsEditingUpdate] = useState(false);
  const [publicationProgress, setPublicationProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);

  const loadWorkspace = useCallback(async (currentProfile: Profile): Promise<void> => {
    const client = getSupabaseBrowserClient();
    const [horsesResult, fieldsResult, herdsResult, careResult, medicationsResult, accessResult, updatesResult, profilesResult, notificationsResult] = await Promise.all([
      client.from("horses").select("*").eq("is_active", true).order("name"),
      client.from("fields").select("*").eq("is_active", true).order("name"),
      client.from("herds").select("*").eq("is_active", true).order("name"),
      client.from("care_profiles").select("*").order("updated_at", { ascending: false }),
      client.from("horse_medications").select("*").order("starts_on", { ascending: false }),
      client.from("horse_access").select("*"),
      client.from("weekly_updates").select("*").order("week_start", { ascending: false }),
      client.from("profiles").select("*").eq("is_active", true).order("full_name"),
      client.from("notifications").select("*").eq("user_id", currentProfile.id).is("read_at", null).order("created_at", { ascending: false }),
    ]);
    const firstError = [horsesResult, fieldsResult, herdsResult, careResult, medicationsResult, accessResult, updatesResult, profilesResult, notificationsResult].map((result) => result.error).find((error) => error !== null);
    if (firstError) throw firstError;
    const horses = horsesResult.data ?? [];
    setWorkspaceData({
      horses,
      fields: fieldsResult.data ?? [],
      herds: herdsResult.data ?? [],
      careProfiles: careResult.data ?? [],
      medications: medicationsResult.data ?? [],
      horseAccess: accessResult.data ?? [],
      weeklyUpdates: updatesResult.data ?? [],
      profiles: profilesResult.data ?? [],
      notifications: notificationsResult.data ?? [],
    });
    setThumbnailUrls(await signedThumbnailUrls(horses));
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    async function initialize(): Promise<void> {
      try {
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError || !userData.user) {
          router.replace("/login/");
          return;
        }
        const { data: currentProfile, error: profileError } = await client.from("profiles").select("*").eq("id", userData.user.id).maybeSingle();
        if (profileError) throw profileError;
        if (!currentProfile?.is_active) throw new Error("This Rebel Woods account is not active.");
        setProfile(currentProfile);
        await loadWorkspace(currentProfile);
      } catch (error: unknown) {
        setNotice({ tone: "error", message: errorMessage(error) });
      } finally {
        setIsLoading(false);
      }
    }
    void initialize();
    const { data: authSubscription } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login/");
    });
    return (): void => authSubscription.subscription.unsubscribe();
  }, [loadWorkspace, router]);

  const horseItems = useMemo<readonly HorseDashboardItem[]>(() => {
    const today = new Date();
    const currentWeekStart = getWeekStartIsoDate(today);
    const previousWeekStart = getPreviousWeekStartIsoDate(today);
    const fieldNames = new Map(workspaceData.fields.map((field) => [field.id, field.name]));
    const herdNames = new Map(workspaceData.herds.map((herd) => [herd.id, herd.name]));
    const careByHorse = new Map(workspaceData.careProfiles.map((careProfile) => [careProfile.horse_id, careProfile]));
    const profileById = new Map(workspaceData.profiles.map((person) => [person.id, person]));
    return workspaceData.horses.map((horse) => {
      const updates = workspaceData.weeklyUpdates.filter((update) => update.horse_id === horse.id);
      const currentUpdate = updates.find((update) => update.week_start === currentWeekStart) ?? null;
      const hasCurrentPublishedUpdate = currentUpdate !== null && currentUpdate.published_at !== null;
      const hasPreviousPublishedUpdate = updates.some((update) => update.week_start === previousWeekStart && update.published_at !== null);
      return {
        horse,
        fieldName: horse.field_id ? fieldNames.get(horse.field_id) ?? "Unassigned" : "Unassigned",
        herdName: horse.herd_id ? herdNames.get(horse.herd_id) ?? "Unassigned" : "Unassigned",
        thumbnailUrl: horse.photo_path ? thumbnailUrls[horse.photo_path] ?? null : null,
        careProfile: careByHorse.get(horse.id) ?? null,
        activeMedications: workspaceData.medications.filter((medication) => medication.horse_id === horse.id && medication.status === "active"),
        updates,
        currentUpdate,
        latestPublishedUpdate: updates.find((update) => update.published_at !== null) ?? null,
        status: getWeeklyUpdateStatus(hasCurrentPublishedUpdate, hasPreviousPublishedUpdate, today),
        unreadCount: workspaceData.notifications.filter((notification) => notification.horse_id === horse.id).length,
        owners: workspaceData.horseAccess
          .filter((access) => access.horse_id === horse.id)
          .flatMap((access) => {
            const owner = profileById.get(access.profile_id);
            return owner ? [owner] : [];
          }),
      };
    });
  }, [thumbnailUrls, workspaceData]);


  const filteredHorseItems = useMemo<readonly HorseDashboardItem[]>(() => horseItems
    .filter((item) => !fieldFilter || item.horse.field_id === fieldFilter)
    .filter((item) => !herdFilter || item.horse.herd_id === herdFilter)
    .filter((item) => updateFilter === "all" || (updateFilter === "updated" ? item.status === "updated" : item.status !== "updated"))
    .sort((left, right) => {
      if (left.status === "updated" && right.status !== "updated") return 1;
      if (left.status !== "updated" && right.status === "updated") return -1;
      return left.horse.name.localeCompare(right.horse.name);
    }), [fieldFilter, herdFilter, horseItems, updateFilter]);

  const selectedHorse = horseItems.find((item) => item.horse.id === selectedHorseId) ?? null;
  const displayedUpdate = selectedHorse?.updates.find((update) => update.id === selectedUpdateId)
    ?? selectedHorse?.currentUpdate
    ?? selectedHorse?.latestPublishedUpdate
    ?? null;
  const participants = useMemo<Readonly<Record<string, ChatParticipant>>>(() => workspaceData.profiles.reduce<Record<string, ChatParticipant>>((people, person) => {
    people[person.id] = { id: person.id, displayName: person.full_name, roleLabel: roleLabel(person) };
    return people;
  }, {}), [workspaceData.profiles]);

  const loadUpdateDetail = useCallback(async (updateId: string): Promise<void> => {
    const client = getSupabaseBrowserClient();
    const [mediaResult, messagesResult] = await Promise.all([
      client.from("update_media").select("*").eq("update_id", updateId).order("sort_order"),
      client.from("messages").select("*").eq("update_id", updateId).order("created_at"),
    ]);
    if (mediaResult.error) throw mediaResult.error;
    if (messagesResult.error) throw messagesResult.error;
    const mediaLinks = await Promise.all((mediaResult.data ?? []).map(async (media): Promise<MediaLink> => {
      const [viewResult, downloadResult] = await Promise.all([
        client.storage.from("update-media").createSignedUrl(media.storage_path, 3600),
        client.storage.from("update-media").createSignedUrl(media.storage_path, 3600, { download: media.original_filename }),
      ]);
      if (viewResult.error) throw viewResult.error;
      if (downloadResult.error) throw downloadResult.error;
      return { media, viewUrl: viewResult.data.signedUrl, downloadUrl: downloadResult.data.signedUrl };
    }));
    setUpdateDetail({ updateId, media: mediaLinks, messages: messagesResult.data ?? [] });
  }, []);

  useEffect(() => {
    if (!displayedUpdate) return;
    async function refreshUpdateDetail(updateId: string): Promise<void> {
      try {
        await loadUpdateDetail(updateId);
      } catch (error: unknown) {
        setNotice({ tone: "error", message: errorMessage(error) });
      }
    }
    void refreshUpdateDetail(displayedUpdate.id);
  }, [displayedUpdate, loadUpdateDetail]);

  async function openHorse(horseId: string): Promise<void> {
    setSelectedHorseId(horseId);
    setSelectedUpdateId(null);
    setIsEditingUpdate(false);
    setNotice(null);
    if (!profile) return;
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).eq("horse_id", horseId).is("read_at", null);
    if (!error) await loadWorkspace(profile);
  }

  async function uploadMedia(update: WeeklyUpdate, files: readonly File[]): Promise<void> {
    if (!profile) return;
    const client = getSupabaseBrowserClient();
    for (const [index, file] of files.entries()) {
      setPublicationProgress(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      const isVideo = file.type.startsWith("video/");
      const durationSeconds = isVideo ? await readVideoDurationSeconds(file) : null;
      const storagePath = `${profile.organization_id}/${update.horse_id}/${update.id}/${crypto.randomUUID()}-${safeStorageFilename(file.name)}`;
      const { error: uploadError } = await client.storage.from("update-media").upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: mediaError } = await client.from("update_media").insert({
        update_id: update.id,
        uploaded_by: profile.id,
        storage_path: storagePath,
        media_type: isVideo ? "video" : "photo",
        mime_type: file.type,
        original_filename: file.name,
        byte_size: file.size,
        duration_seconds: durationSeconds,
        sort_order: index,
      });
      if (mediaError) {
        await client.storage.from("update-media").remove([storagePath]);
        throw mediaError;
      }
    }
  }

  async function saveWeeklyUpdate(draft: WeeklyUpdateDraft): Promise<boolean> {
    if (!profile || !selectedHorse || profile.role === "owner") return false;
    setIsPublishing(true);
    setNotice(null);
    setPublicationProgress("Preparing the weekly update…");
    try {
      const client = getSupabaseBrowserClient();
      let weeklyUpdate = selectedHorse.currentUpdate;
      if (weeklyUpdate) {
        const { data, error } = await client.from("weekly_updates").update({ body: draft.body }).eq("id", weeklyUpdate.id).select("*").single();
        if (error) throw error;
        weeklyUpdate = data;
      } else {
        const { data, error } = await client.from("weekly_updates").insert({
          organization_id: profile.organization_id,
          horse_id: selectedHorse.horse.id,
          author_id: profile.id,
          week_start: getWeekStartIsoDate(new Date()),
          body: draft.body,
          published_at: null,
        }).select("*").single();
        if (error) throw error;
        weeklyUpdate = data;
      }
      await uploadMedia(weeklyUpdate, draft.media);
      if (!weeklyUpdate.published_at) {
        setPublicationProgress("Publishing and notifying the owner…");
        const { error } = await client.from("weekly_updates").update({ published_at: new Date().toISOString() }).eq("id", weeklyUpdate.id);
        if (error) throw error;
      }
      await loadWorkspace(profile);
      await loadUpdateDetail(weeklyUpdate.id);
      setSelectedUpdateId(weeklyUpdate.id);
      setIsEditingUpdate(false);
      setNotice({ tone: "success", message: `${selectedHorse.horse.name}’s weekly update is ready for their owner.` });
      return true;
    } catch (error: unknown) {
      setNotice({ tone: "error", message: `The update was not published: ${errorMessage(error)}` });
      return false;
    } finally {
      setIsPublishing(false);
      setPublicationProgress(null);
    }
  }

  async function notifyOwnerAgain(updateId: string): Promise<void> {
    setNotice(null);
    const { error } = await getSupabaseBrowserClient().rpc("renotify_weekly_update", { target_update_id: updateId });
    setNotice(error ? { tone: "error", message: errorMessage(error) } : { tone: "success", message: "The owner was notified about the updated weekly report." });
  }

  if (isLoading) return <main className="grid min-h-screen place-items-center bg-[#f7f3e9] text-[#385943]"><p className="font-bold">Opening Rebel Woods…</p></main>;
  if (!profile) return <main className="grid min-h-screen place-items-center bg-[#f7f3e9] px-5"><section className="max-w-lg rounded-3xl bg-white p-7 text-center shadow-xl"><AlertCircle className="mx-auto mb-4 text-[#a65333]" /><h1 className="mb-3 font-serif text-3xl">We couldn’t open your account.</h1><p className="mb-5 text-[#68736b]">{notice?.message ?? "Please sign in again."}</p><button className={primaryButton} onClick={() => router.replace("/login/")} type="button">Return to sign in</button></section></main>;

  const isStaff = profile.role !== "owner";
  return <div className="min-h-screen bg-[#f7f3e9] pb-20 text-[#14261d]">
    <header className="sticky top-0 z-20 border-b border-[#dedfd8] bg-[#fffdf8]/95 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3"><div><strong className="block font-serif text-xl">Rebel Woods</strong><small className="font-bold uppercase tracking-[0.14em] text-[#a65333]">{roleLabel(profile)}</small></div><div className="flex items-center gap-2">{profile.role === "admin" ? <a className={secondaryButton} href={`${getPagesBasePath()}/setup/`}><Settings size={16} /><span className="hidden sm:inline">Setup</span></a> : null}<button aria-label="Sign out" className="grid h-10 w-10 place-items-center rounded-full border border-[#dedfd8] bg-white" onClick={() => void getSupabaseBrowserClient().auth.signOut()} type="button"><LogOut size={17} /></button></div></div></header>
    <main className="mx-auto max-w-6xl px-4 py-7 sm:px-5 sm:py-10">
      {notice ? <div className={`mb-5 rounded-2xl border p-4 text-sm font-semibold ${notice.tone === "success" ? "border-[#b8c9bb] bg-[#e4ece4] text-[#1d3528]" : "border-[#e1b8a6] bg-[#f3ded3] text-[#73391f]"}`} role="status">{notice.message}</div> : null}
      {selectedHorse ? <HorseWorkspace detail={updateDetail?.updateId === displayedUpdate?.id ? updateDetail : null} displayedUpdate={displayedUpdate} horseItem={selectedHorse} isEditingUpdate={isEditingUpdate} isPublishing={isPublishing} isStaff={isStaff} participants={participants} profile={profile} progressMessage={publicationProgress} onBack={() => { setSelectedHorseId(null); setSelectedUpdateId(null); setNotice(null); }} onEdit={() => setIsEditingUpdate(true)} onNotifyAgain={(updateId) => void notifyOwnerAgain(updateId)} onSaveUpdate={saveWeeklyUpdate} onSelectUpdate={setSelectedUpdateId} /> : <Dashboard fieldFilter={fieldFilter} fields={workspaceData.fields} filteredHorses={filteredHorseItems} herdFilter={herdFilter} herds={workspaceData.herds} horses={horseItems} isStaff={isStaff} profile={profile} updateFilter={updateFilter} onFieldFilter={setFieldFilter} onHerdFilter={setHerdFilter} onOpenHorse={(horseId) => void openHorse(horseId)} onUpdateFilter={setUpdateFilter} />}
    </main>
  </div>;
}

interface DashboardProps {
  readonly fieldFilter: string;
  readonly fields: readonly Field[];
  readonly filteredHorses: readonly HorseDashboardItem[];
  readonly herdFilter: string;
  readonly herds: readonly Herd[];
  readonly horses: readonly HorseDashboardItem[];
  readonly isStaff: boolean;
  readonly profile: Profile;
  readonly updateFilter: UpdateFilter;
  readonly onFieldFilter: (fieldId: string) => void;
  readonly onHerdFilter: (herdId: string) => void;
  readonly onOpenHorse: (horseId: string) => void;
  readonly onUpdateFilter: (filter: UpdateFilter) => void;
}

function Dashboard({ fieldFilter, fields, filteredHorses, herdFilter, herds, horses, isStaff, profile, updateFilter, onFieldFilter, onHerdFilter, onOpenHorse, onUpdateFilter }: DashboardProps): React.JSX.Element {
  const attentionCount = horses.filter((item) => item.status !== "updated").length;
  const updatedCount = horses.length - attentionCount;

  return <>
    <section className="mb-7 overflow-hidden rounded-[2rem] bg-[#1d3528] p-7 text-white shadow-xl sm:p-9">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#d9a27b]">{isStaff ? "Stable overview" : "Your horses"}</p>
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div><h1 className="mb-3 max-w-2xl font-serif text-4xl leading-tight sm:text-5xl">Welcome, {profile.full_name.split(" ")[0]}.</h1><p className="mb-0 max-w-2xl leading-7 text-[#cdd9cf]">{isStaff ? "Horses needing attention appear first. Open a card to review care details or send this week’s update." : "Open a horse to see care information, weekly photos and videos, and private replies."}</p></div>
        {isStaff ? <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-white/10 px-5 py-4"><strong className="block text-3xl">{attentionCount}</strong><small className="text-[#cdd9cf]">need attention</small></div><div className="rounded-2xl bg-white/10 px-5 py-4"><strong className="block text-3xl">{updatedCount}</strong><small className="text-[#cdd9cf]">updated</small></div></div> : null}
      </div>
    </section>

    {isStaff ? <section className="mb-6 flex flex-wrap gap-3 rounded-2xl border border-[#dedfd8] bg-[#fffdf8] p-4" aria-label="Horse filters">
      <select aria-label="Filter by update status" className={selectInput} onChange={(event) => onUpdateFilter(event.target.value as UpdateFilter)} value={updateFilter}><option value="all">All updates</option><option value="attention">Needs attention</option><option value="updated">Updated</option></select>
      <select aria-label="Filter by field" className={selectInput} onChange={(event) => onFieldFilter(event.target.value)} value={fieldFilter}><option value="">All fields</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
      <select aria-label="Filter by herd" className={selectInput} onChange={(event) => onHerdFilter(event.target.value)} value={herdFilter}><option value="">All herds</option>{herds.map((herd) => <option key={herd.id} value={herd.id}>{herd.name}</option>)}</select>
    </section> : null}

    {filteredHorses.length > 0 ? <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Horses">{filteredHorses.map((item) => <HorseCard item={item} key={item.horse.id} onOpen={() => onOpenHorse(item.horse.id)} />)}</section> : <section className="rounded-3xl border border-dashed border-[#bfc6bf] bg-[#fffdf8] p-10 text-center"><h2 className="mb-2 font-serif text-3xl">No horses to show</h2><p className="mb-0 text-[#68736b]">{horses.length === 0 ? "An administrator can add the first horse in Setup." : "Try clearing one of the filters."}</p></section>}
  </>;
}

interface HorseCardProps {
  readonly item: HorseDashboardItem;
  readonly onOpen: () => void;
}

function HorseCard({ item, onOpen }: HorseCardProps): React.JSX.Element {
  const status = statusPresentation(item.status);
  const hasSpecialRequirements = Boolean(item.careProfile?.special_requirements.trim());
  return <button className="group overflow-hidden rounded-[1.75rem] border border-[#dedfd8] bg-[#fffdf8] text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#385943]" onClick={onOpen} type="button">
    <div className="relative aspect-[4/3] overflow-hidden bg-[#dfe5df]">
      {item.thumbnailUrl ? <Image alt={`${item.horse.name} thumbnail`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" height={600} src={item.thumbnailUrl} unoptimized width={800} /> : <div className="grid h-full place-items-center font-serif text-6xl text-[#789080]">{item.horse.name.slice(0, 1).toUpperCase()}</div>}
      <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
      {item.unreadCount > 0 ? <span className="absolute right-3 top-3 inline-flex min-h-7 min-w-7 items-center justify-center rounded-full bg-[#a65333] px-2 text-xs font-bold text-white"><Bell size={13} className="mr-1" />{item.unreadCount}</span> : null}
    </div>
    <span className="block p-5"><strong className="mb-2 block font-serif text-3xl">{item.horse.name}</strong><span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#68736b]"><span className="inline-flex items-center gap-1"><MapPin size={14} />{item.fieldName}</span><span>{item.herdName} herd</span></span>{hasSpecialRequirements ? <span className="mt-4 flex items-center gap-2 rounded-xl border-2 border-[#a65333] bg-[#f3ded3] px-3 py-2 text-xs font-extrabold uppercase tracking-[0.08em] text-[#73391f]"><ShieldAlert aria-hidden="true" size={20} />Special requirements</span> : null}{item.activeMedications.length > 0 ? <span className="mt-2 flex items-center gap-2 rounded-xl bg-[#f6e8c9] px-3 py-2 text-xs font-extrabold uppercase tracking-[0.08em] text-[#75520e]"><Pill aria-hidden="true" size={18} />Current medication</span> : null}</span>
  </button>;
}

interface HorseWorkspaceProps {
  readonly detail: UpdateDetail | null;
  readonly displayedUpdate: WeeklyUpdate | null;
  readonly horseItem: HorseDashboardItem;
  readonly isEditingUpdate: boolean;
  readonly isPublishing: boolean;
  readonly isStaff: boolean;
  readonly participants: Readonly<Record<string, ChatParticipant>>;
  readonly profile: Profile;
  readonly progressMessage: string | null;
  readonly onBack: () => void;
  readonly onEdit: () => void;
  readonly onNotifyAgain: (updateId: string) => void;
  readonly onSaveUpdate: (draft: WeeklyUpdateDraft) => Promise<boolean>;
  readonly onSelectUpdate: (updateId: string) => void;
}

function HorseWorkspace({ detail, displayedUpdate, horseItem, isEditingUpdate, isPublishing, isStaff, participants, profile, progressMessage, onBack, onEdit, onNotifyAgain, onSaveUpdate, onSelectUpdate }: HorseWorkspaceProps): React.JSX.Element {
  const isCurrentUpdate = displayedUpdate?.id === horseItem.currentUpdate?.id;
  const showComposer = isStaff && (!horseItem.currentUpdate?.published_at || (isCurrentUpdate && isEditingUpdate));
  const publishedUpdates = horseItem.updates.filter((update) => update.published_at !== null);
  const hasEditedPublishedUpdate = displayedUpdate?.published_at
    ? new Date(displayedUpdate.updated_at).getTime() - new Date(displayedUpdate.published_at).getTime() > 1_000
    : false;

  return <>
    <button className={`${secondaryButton} mb-5`} onClick={onBack} type="button"><ArrowLeft size={16} />All horses</button>
    <section className="mb-7 grid overflow-hidden rounded-[2rem] bg-[#1d3528] text-white shadow-xl md:grid-cols-[minmax(16rem,0.8fr)_1.2fr]">
      <div className="aspect-[4/3] bg-[#385943] md:aspect-auto">{horseItem.thumbnailUrl ? <Image alt={horseItem.horse.name} className="h-full min-h-64 w-full object-cover" height={700} src={horseItem.thumbnailUrl} unoptimized width={900} /> : <div className="grid h-full min-h-64 place-items-center font-serif text-8xl text-[#9fb0a3]">{horseItem.horse.name.slice(0, 1).toUpperCase()}</div>}</div>
      <div className="p-7 sm:p-9"><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#d9a27b]">Horse information</p><h1 className="mb-5 font-serif text-5xl">{horseItem.horse.name}</h1><div className="grid gap-3 sm:grid-cols-2"><HorseInformationTile label="Field" value={horseItem.fieldName} /><HorseInformationTile label="Herd" value={horseItem.herdName} /><HorseInformationTile label="Type" value={horseItem.horse.horse_type || "Not entered"} /><HorseInformationTile label="Born" value={horseItem.horse.birth_year?.toString() ?? "Not entered"} /></div></div>
    </section>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
      <div className="space-y-6">
        {showComposer ? <UpdateComposer hasExistingMedia={Boolean(detail?.media.length)} horseName={horseItem.horse.name} initialBody={horseItem.currentUpdate?.body ?? ""} isSubmitting={isPublishing} key={horseItem.currentUpdate?.id ?? "new"} onSubmit={onSaveUpdate} progressMessage={progressMessage} submitLabel={horseItem.currentUpdate?.published_at ? "Save update" : "Publish weekly update"} /> : null}

        {displayedUpdate?.published_at ? <article className="rounded-3xl border border-[#dedfd8] bg-[#fffdf8] p-5 sm:p-7">
          <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-[#a65333]">Week of {weekLabel(displayedUpdate.week_start)}</p><h2 className="mb-1 font-serif text-3xl">Weekly update</h2><p className="text-xs text-[#68736b]">Published {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(displayedUpdate.published_at))}{hasEditedPublishedUpdate ? ` · Edited ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(displayedUpdate.updated_at))}` : ""}</p></div>{isStaff && isCurrentUpdate ? <div className="flex flex-wrap gap-2"><button className={secondaryButton} onClick={onEdit} type="button">Edit update</button><button className={secondaryButton} onClick={() => onNotifyAgain(displayedUpdate.id)} type="button"><Bell size={15} />Notify owner again</button></div> : null}</header>
          <p className="mb-6 whitespace-pre-wrap leading-7 text-[#293b31]">{displayedUpdate.body}</p>
          {detail ? <UpdateMediaGallery media={detail.media} horseName={horseItem.horse.name} /> : <p className="rounded-2xl bg-[#f7f3e9] p-4 text-sm text-[#68736b]">Loading photos and videos…</p>}
        </article> : !showComposer ? <section className="rounded-3xl border border-dashed border-[#bfc6bf] bg-[#fffdf8] p-8 text-center"><h2 className="mb-2 font-serif text-3xl">No weekly update yet</h2><p className="mb-0 text-[#68736b]">This week’s update will appear here once it is published.</p></section> : null}

        {displayedUpdate?.published_at && detail ? <ChatWindow currentUserId={profile.id} horseId={horseItem.horse.id} initialMessages={detail.messages} key={displayedUpdate.id} organizationId={profile.organization_id} participants={participants} updateId={displayedUpdate.id} /> : null}
      </div>

      <aside className="space-y-6">
        <CareSummary horseItem={horseItem} />
        <section className="rounded-3xl border border-[#dedfd8] bg-[#fffdf8] p-5"><h2 className="mb-4 font-serif text-2xl">Update history</h2>{publishedUpdates.length > 0 ? <div className="space-y-2">{publishedUpdates.map((update) => <button className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-semibold ${displayedUpdate?.id === update.id ? "border-[#385943] bg-[#e4ece4]" : "border-[#dedfd8] bg-white"}`} key={update.id} onClick={() => onSelectUpdate(update.id)} type="button"><span>{weekLabel(update.week_start)}</span><MessageCircle size={16} /></button>)}</div> : <p className="mb-0 text-sm text-[#68736b]">Past updates will be kept here.</p>}</section>
      </aside>
    </div>
  </>;
}

function CareSummary({ horseItem }: { readonly horseItem: HorseDashboardItem }): React.JSX.Element {
  const careProfile = horseItem.careProfile;
  return <section className="rounded-3xl border border-[#dedfd8] bg-[#fffdf8] p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-serif text-2xl">Care card</h2>{careProfile?.special_requirements.trim() ? <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-[#a65333] bg-[#f3ded3] text-[#a65333]"><ShieldAlert aria-label="Special care requirements" size={25} /></span> : null}</div><div className="space-y-4 text-sm"><CareValue label="AM FEED" value={careProfile?.am_feed} /><CareValue label="PM FEED" value={careProfile?.pm_feed} /><CareValue label="AM SUPPLEMENTS" value={careProfile?.supplements_am} /><CareValue label="PM SUPPLEMENTS" value={careProfile?.supplements_pm} />{careProfile?.special_requirements.trim() ? <div className="rounded-2xl border-2 border-[#a65333] bg-[#f3ded3] p-4 text-[#73391f]"><strong className="mb-1 flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.08em]"><ShieldAlert aria-hidden="true" size={19} />Special requirements</strong><p className="mb-0 whitespace-pre-wrap font-semibold leading-6">{careProfile.special_requirements}</p></div> : null}</div>
    {horseItem.activeMedications.length > 0 ? <div className="mt-5 border-t border-[#dedfd8] pt-5"><h3 className="mb-3 flex items-center gap-2 font-bold"><Pill size={17} />Current medications</h3><div className="space-y-3">{horseItem.activeMedications.map((medication) => <article className="rounded-2xl bg-[#f6e8c9] p-4 text-sm" key={medication.id}><strong className="block">{medication.name} · {medication.dosage}</strong><p className="mb-0 mt-1 whitespace-pre-wrap leading-5">{medication.instructions}</p>{medication.ends_on ? <small className="mt-2 block">Through {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(`${medication.ends_on}T12:00:00`))}</small> : null}</article>)}</div></div> : null}
    <div className="mt-5 border-t border-[#dedfd8] pt-5"><h3 className="mb-3 font-bold">Contacts & schedules</h3><CareValue label="Owner / family" value={horseItem.owners.map((owner) => `${owner.full_name}${owner.phone ? ` · ${owner.phone}` : ""}`).join("\n")} /><CareValue label="Veterinarian" value={[horseItem.horse.veterinarian_name, horseItem.horse.veterinarian_phone].filter(Boolean).join(" · ")} /><CareValue label="Farrier" value={[horseItem.horse.farrier_name, horseItem.horse.farrier_phone].filter(Boolean).join(" · ")} /><CareValue label="Deworming" value={horseItem.horse.deworming_schedule} /><CareValue label="Vaccines" value={horseItem.horse.vaccine_schedule} /></div>
  </section>;
}

function CareValue({ label, value }: { readonly label: string; readonly value?: string | null }): React.JSX.Element {
  return <div><strong className="mb-1 block text-sm font-extrabold uppercase tracking-[0.08em] text-[#1d3528]">{label}</strong><p className="mb-0 whitespace-pre-wrap leading-6 text-[#293b31]">{value?.trim() || "Not entered"}</p></div>;
}

function HorseInformationTile({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3"><strong className="mb-1 block text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#d9a27b]">{label}</strong><span className="block text-sm font-bold leading-5 text-white">{value}</span></div>;
}

function UpdateMediaGallery({ horseName, media }: { readonly horseName: string; readonly media: readonly MediaLink[] }): React.JSX.Element {
  return media.length > 0 ? <div className="grid gap-3 sm:grid-cols-2">{media.map((item, index) => <figure className="overflow-hidden rounded-2xl bg-[#e4ece4]" key={item.media.id}>{item.media.media_type === "video" ? <video className="aspect-[4/3] w-full object-cover" controls playsInline preload="metadata" src={item.viewUrl} /> : <Image alt={`${horseName} weekly update photo ${index + 1}`} className="aspect-[4/3] w-full object-cover" height={600} loading="lazy" src={item.viewUrl} unoptimized width={800} />}<figcaption className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><span className="truncate text-[#68736b]">{item.media.original_filename}</span><a className="font-bold text-[#385943] underline" download href={item.downloadUrl}>Download</a></figcaption></figure>)}</div> : <p className="rounded-2xl bg-[#f7f3e9] p-4 text-sm text-[#68736b]">No media was added to this update.</p>;
}
