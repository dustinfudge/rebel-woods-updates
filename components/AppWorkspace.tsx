"use client";

import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { AlertCircle, ArrowLeft, Bell, LogOut, MapPin, MessageCircle, Pill, Settings, ShieldAlert } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ChatParticipant } from "@/components/ChatWindow";
import { ConversationTimeline } from "@/components/ConversationTimeline";
import { getPagesBasePath } from "@/lib/environment";
import { getHerdRosterLabel } from "@/lib/herds";
import { getHorseNotificationCounts } from "@/lib/notifications";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { Tables } from "@/types/supabase";

type Profile = Tables<"profiles">;
type Horse = Tables<"horses">;
type Field = Tables<"fields">;
type Herd = Tables<"herds">;
type CareProfile = Tables<"care_profiles">;
type Medication = Tables<"horse_medications">;
type HorseAccess = Tables<"horse_access">;
type HorseConversation = Tables<"horse_conversations">;
type Notification = Tables<"notifications">;

interface WorkspaceData {
  readonly horses: readonly Horse[];
  readonly fields: readonly Field[];
  readonly herds: readonly Herd[];
  readonly careProfiles: readonly CareProfile[];
  readonly medications: readonly Medication[];
  readonly horseAccess: readonly HorseAccess[];
  readonly conversations: readonly HorseConversation[];
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
  readonly conversation: HorseConversation;
  readonly daysSinceStaffCommunication: number | null;
  readonly needsStaffCommunication: boolean;
  readonly unreadReplyCount: number;
  readonly unreadAlertCount: number;
  readonly owners: readonly Profile[];
}

interface WorkspaceNotice {
  readonly tone: "success" | "error";
  readonly message: string;
}

interface HerdOption {
  readonly id: string;
  readonly label: string;
}

type CommunicationFilter = "all" | "attention" | "recent";

const emptyWorkspaceData: WorkspaceData = { horses: [], fields: [], herds: [], careProfiles: [], medications: [], horseAccess: [], conversations: [], profiles: [], notifications: [] };
const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#1d3528] px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#cfd4ce] bg-white px-4 py-2 text-sm font-bold text-[#385943] disabled:opacity-50";
const selectInput = "min-w-0 min-h-10 rounded-lg border border-[#cfd4ce] bg-white px-2 text-xs font-semibold text-[#385943] outline-none focus:border-[#385943] sm:min-h-11 sm:rounded-xl sm:px-3 sm:text-sm";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function roleLabel(profile: Profile): string {
  if (profile.role === "admin") return "Administrator";
  if (profile.role === "stable_hand") return "Rebel Wrangler";
  return "Owner / family";
}

function calendarDaysSince(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const today = new Date();
  const date = new Date(timestamp);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.max(0, Math.round((todayStart - dateStart) / 86_400_000));
}

function communicationPresentation(daysSinceStaffCommunication: number | null): { readonly label: string; readonly className: string } {
  if (daysSinceStaffCommunication === null) return { label: "No staff update yet", className: "bg-[#f3ded3] text-[#73391f]" };
  if (daysSinceStaffCommunication === 0) return { label: "Updated today", className: "bg-[#dcebdd] text-[#24502f]" };
  if (daysSinceStaffCommunication < 7) return { label: `${daysSinceStaffCommunication} ${daysSinceStaffCommunication === 1 ? "day" : "days"} ago`, className: "bg-[#dcebdd] text-[#24502f]" };
  return { label: `${daysSinceStaffCommunication} days ago`, className: "bg-[#f3ded3] text-[#73391f]" };
}

async function signedThumbnailUrls(horses: readonly Horse[]): Promise<Readonly<Record<string, string>>> {
  const client = getSupabaseBrowserClient();
  const results = await Promise.all(horses.flatMap((horse) => horse.photo_path
    ? [client.storage.from("horse-thumbnails").createSignedUrl(horse.photo_path, 3600, {
        transform: { width: 720, height: 540, resize: "cover", quality: 75 },
      }).then((result) => ({ path: horse.photo_path, signedUrl: result.data?.signedUrl ?? null }))]
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
  const [communicationFilter, setCommunicationFilter] = useState<CommunicationFilter>("all");
  const [fieldFilter, setFieldFilter] = useState("");
  const [herdFilter, setHerdFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);

  const loadWorkspace = useCallback(async (currentProfile: Profile, refreshThumbnails = false): Promise<void> => {
    const client = getSupabaseBrowserClient();
    const [horsesResult, fieldsResult, herdsResult, careResult, medicationsResult, accessResult, conversationsResult, profilesResult, notificationsResult] = await Promise.all([
      client.from("horses").select("*").eq("is_active", true).order("name"),
      client.from("fields").select("*").eq("is_active", true).order("name"),
      client.from("herds").select("*").eq("is_active", true).order("name"),
      client.from("care_profiles").select("*").order("updated_at", { ascending: false }),
      client.from("horse_medications").select("*").order("starts_on", { ascending: false }),
      client.from("horse_access").select("*"),
      client.from("horse_conversations").select("*").order("last_staff_communication_at", { ascending: true, nullsFirst: true }),
      client.from("profiles").select("*").eq("is_active", true).order("full_name"),
      client.from("notifications").select("*").eq("user_id", currentProfile.id).is("read_at", null).order("created_at", { ascending: false }),
    ]);
    const firstError = [horsesResult, fieldsResult, herdsResult, careResult, medicationsResult, accessResult, conversationsResult, profilesResult, notificationsResult].map((result) => result.error).find((error) => error !== null);
    if (firstError) throw firstError;
    const horses = horsesResult.data ?? [];
    setWorkspaceData({
      horses,
      fields: fieldsResult.data ?? [],
      herds: herdsResult.data ?? [],
      careProfiles: careResult.data ?? [],
      medications: medicationsResult.data ?? [],
      horseAccess: accessResult.data ?? [],
      conversations: conversationsResult.data ?? [],
      profiles: profilesResult.data ?? [],
      notifications: notificationsResult.data ?? [],
    });
    if (refreshThumbnails) setThumbnailUrls(await signedThumbnailUrls(horses));
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
        await loadWorkspace(currentProfile, true);
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

  useEffect(() => {
    if (!profile) return;

    const client = getSupabaseBrowserClient();
    const notificationsChannel = client
      .channel(`workspace-notifications:${profile.id}`)
      .on<Notification>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}` },
        (payload: RealtimePostgresInsertPayload<Notification>): void => {
          if (payload.new.read_at !== null) return;
          setWorkspaceData((currentData) => currentData.notifications.some((notification) => notification.id === payload.new.id)
            ? currentData
            : { ...currentData, notifications: [payload.new, ...currentData.notifications] });
        },
      )
      .subscribe();

    return (): void => {
      void client.removeChannel(notificationsChannel);
    };
  }, [profile]);

  const horseItems = useMemo<readonly HorseDashboardItem[]>(() => {
    const fieldNames = new Map(workspaceData.fields.map((field) => [field.id, field.name]));
    const careByHorse = new Map(workspaceData.careProfiles.map((careProfile) => [careProfile.horse_id, careProfile]));
    const conversationByHorse = new Map(workspaceData.conversations.map((conversation) => [conversation.horse_id, conversation]));
    const profileById = new Map(workspaceData.profiles.map((person) => [person.id, person]));
    return workspaceData.horses.flatMap((horse) => {
      const conversation = conversationByHorse.get(horse.id);
      if (!conversation) return [];
      const notificationCounts = getHorseNotificationCounts(workspaceData.notifications, horse.id);
      const daysSinceStaffCommunication = calendarDaysSince(conversation.last_staff_communication_at);
      return [{
        horse,
        fieldName: horse.field_id ? fieldNames.get(horse.field_id) ?? "Unassigned" : "Unassigned",
        herdName: getHerdRosterLabel(horse.herd_id, workspaceData.horses),
        thumbnailUrl: horse.photo_path ? thumbnailUrls[horse.photo_path] ?? null : null,
        careProfile: careByHorse.get(horse.id) ?? null,
        activeMedications: workspaceData.medications.filter((medication) => medication.horse_id === horse.id && medication.status === "active"),
        conversation,
        daysSinceStaffCommunication,
        needsStaffCommunication: daysSinceStaffCommunication === null || daysSinceStaffCommunication >= 7,
        unreadReplyCount: notificationCounts.replyCount,
        unreadAlertCount: notificationCounts.otherCount,
        owners: workspaceData.horseAccess
          .filter((access) => access.horse_id === horse.id)
          .flatMap((access) => {
            const owner = profileById.get(access.profile_id);
            return owner ? [owner] : [];
          }),
      }];
    });
  }, [thumbnailUrls, workspaceData]);

  const herdOptions: readonly HerdOption[] = workspaceData.herds
    .filter((herd) => herd.is_active)
    .map((herd) => ({ id: herd.id, label: getHerdRosterLabel(herd.id, workspaceData.horses) }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const filteredHorseItems = useMemo<readonly HorseDashboardItem[]>(() => horseItems
    .filter((item) => !fieldFilter || item.horse.field_id === fieldFilter)
    .filter((item) => !herdFilter || item.horse.herd_id === herdFilter)
    .filter((item) => communicationFilter === "all" || (communicationFilter === "attention" ? item.needsStaffCommunication : !item.needsStaffCommunication))
    .sort((left, right) => {
      if (left.needsStaffCommunication !== right.needsStaffCommunication) return left.needsStaffCommunication ? -1 : 1;
      const ageDifference = (right.daysSinceStaffCommunication ?? Number.MAX_SAFE_INTEGER) - (left.daysSinceStaffCommunication ?? Number.MAX_SAFE_INTEGER);
      if (ageDifference !== 0) return ageDifference;
      return left.horse.name.localeCompare(right.horse.name);
    }), [communicationFilter, fieldFilter, herdFilter, horseItems]);

  const selectedHorse = horseItems.find((item) => item.horse.id === selectedHorseId) ?? null;
  const participants = useMemo<Readonly<Record<string, ChatParticipant>>>(() => workspaceData.profiles.reduce<Record<string, ChatParticipant>>((people, person) => {
    people[person.id] = { id: person.id, displayName: person.full_name, roleLabel: roleLabel(person) };
    return people;
  }, {}), [workspaceData.profiles]);

  async function openHorse(horseId: string): Promise<void> {
    setSelectedHorseId(horseId);
    setNotice(null);
    if (!profile) return;
    const unreadNotifications = workspaceData.notifications.filter((notification) => notification.horse_id === horseId);
    setWorkspaceData((currentData) => ({
      ...currentData,
      notifications: currentData.notifications.filter((notification) => notification.horse_id !== horseId),
    }));
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).eq("horse_id", horseId).is("read_at", null);
    if (error) {
      setWorkspaceData((currentData) => ({ ...currentData, notifications: [...unreadNotifications, ...currentData.notifications] }));
      setNotice({ tone: "error", message: "The notification could not be marked as read." });
    }
  }

  function recordConversationMessage(conversationId: string, createdAt: string): void {
    if (!profile) return;
    setWorkspaceData((currentData) => ({
      ...currentData,
      conversations: currentData.conversations.map((conversation) => conversation.id === conversationId ? {
        ...conversation,
        last_message_at: createdAt,
        last_staff_communication_at: profile.role === "owner" ? conversation.last_staff_communication_at : createdAt,
      } : conversation),
    }));
  }

  async function updateHorseLocation(horseId: string, fieldId: string | null, herdId: string | null): Promise<boolean> {
    if (profile?.role !== "admin") return false;
    setNotice(null);
    const { error } = await getSupabaseBrowserClient().from("horses").update({ field_id: fieldId, herd_id: herdId }).eq("id", horseId);
    if (error) {
      setNotice({ tone: "error", message: "The field and herd could not be updated." });
      return false;
    }
    setWorkspaceData((currentData) => ({
      ...currentData,
      horses: currentData.horses.map((horse) => horse.id === horseId ? { ...horse, field_id: fieldId, herd_id: herdId } : horse),
    }));
    setNotice({ tone: "success", message: "The horse’s field and herd were updated." });
    return true;
  }

  if (isLoading) return <main className="grid min-h-screen place-items-center bg-[#f7f3e9] text-[#385943]"><p className="font-bold">Opening Rebel Woods…</p></main>;
  if (!profile) return <main className="grid min-h-screen place-items-center bg-[#f7f3e9] px-5"><section className="max-w-lg rounded-3xl bg-white p-7 text-center shadow-xl"><AlertCircle className="mx-auto mb-4 text-[#a65333]" /><h1 className="mb-3 font-serif text-3xl">We couldn’t open your account.</h1><p className="mb-5 text-[#68736b]">{notice?.message ?? "Please sign in again."}</p><button className={primaryButton} onClick={() => router.replace("/login/")} type="button">Return to sign in</button></section></main>;

  const isStaff = profile.role !== "owner";
  return <div className="min-h-screen bg-[#f7f3e9] pb-20 text-[#14261d]">
    <header className="sticky top-0 z-20 border-b border-[#dedfd8] bg-[#fffdf8]/95 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3"><div><strong className="block font-serif text-xl">Rebel Woods</strong><small className="font-bold uppercase tracking-[0.14em] text-[#a65333]">{roleLabel(profile)}</small></div><div className="flex items-center gap-2">{profile.role === "admin" ? <a className={secondaryButton} href={`${getPagesBasePath()}/setup/`}><Settings size={16} /><span className="hidden sm:inline">Setup</span></a> : null}<button aria-label="Sign out" className="grid h-10 w-10 place-items-center rounded-full border border-[#dedfd8] bg-white" onClick={() => void getSupabaseBrowserClient().auth.signOut()} type="button"><LogOut size={17} /></button></div></div></header>
    <main className="mx-auto max-w-6xl px-4 py-7 sm:px-5 sm:py-10">
      {notice ? <div className={`mb-5 rounded-2xl border p-4 text-sm font-semibold ${notice.tone === "success" ? "border-[#b8c9bb] bg-[#e4ece4] text-[#1d3528]" : "border-[#e1b8a6] bg-[#f3ded3] text-[#73391f]"}`} role="status">{notice.message}</div> : null}
      {selectedHorse ? <HorseWorkspace fields={workspaceData.fields} herdOptions={herdOptions} horseItem={selectedHorse} participants={participants} profile={profile} onBack={() => { setSelectedHorseId(null); setNotice(null); }} onLocationUpdate={updateHorseLocation} onMessageSent={(createdAt) => recordConversationMessage(selectedHorse.conversation.id, createdAt)} /> : <Dashboard communicationFilter={communicationFilter} fieldFilter={fieldFilter} fields={workspaceData.fields} filteredHorses={filteredHorseItems} herdFilter={herdFilter} herdOptions={herdOptions} horses={horseItems} isStaff={isStaff} profile={profile} onCommunicationFilter={setCommunicationFilter} onFieldFilter={setFieldFilter} onHerdFilter={setHerdFilter} onOpenHorse={(horseId) => void openHorse(horseId)} />}
    </main>
  </div>;
}

interface DashboardProps {
  readonly communicationFilter: CommunicationFilter;
  readonly fieldFilter: string;
  readonly fields: readonly Field[];
  readonly filteredHorses: readonly HorseDashboardItem[];
  readonly herdFilter: string;
  readonly herdOptions: readonly HerdOption[];
  readonly horses: readonly HorseDashboardItem[];
  readonly isStaff: boolean;
  readonly profile: Profile;
  readonly onCommunicationFilter: (filter: CommunicationFilter) => void;
  readonly onFieldFilter: (fieldId: string) => void;
  readonly onHerdFilter: (herdId: string) => void;
  readonly onOpenHorse: (horseId: string) => void;
}

function Dashboard({ communicationFilter, fieldFilter, fields, filteredHorses, herdFilter, herdOptions, horses, isStaff, profile, onCommunicationFilter, onFieldFilter, onHerdFilter, onOpenHorse }: DashboardProps): React.JSX.Element {
  const attentionCount = horses.filter((item) => item.needsStaffCommunication).length;
  const recentlyUpdatedCount = horses.length - attentionCount;

  return <>
    <section className="mb-4 overflow-hidden rounded-2xl bg-[#1d3528] p-5 text-white shadow-xl sm:mb-7 sm:rounded-[2rem] sm:p-9">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#d9a27b] sm:mb-2 sm:text-xs">{isStaff ? "Stable overview" : "Your horses"}</p>
      <div className="grid gap-3 sm:gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div><h1 className="mb-0 max-w-2xl font-serif text-3xl leading-tight sm:mb-3 sm:text-5xl">Welcome, {profile.full_name.split(" ")[0]}.</h1><p className="mb-0 hidden max-w-2xl leading-7 text-[#cdd9cf] sm:block">{isStaff ? "Horses without a staff message in seven days appear first. Open a card to review care or continue the conversation." : "Open a horse to see care information and the complete private conversation."}</p></div>
        {isStaff ? <div className="grid grid-cols-2 gap-2 sm:gap-3"><div className="rounded-xl bg-white/10 px-3 py-2 sm:rounded-2xl sm:px-5 sm:py-4"><strong className="mr-1 text-2xl sm:block sm:text-3xl">{attentionCount}</strong><small className="text-[#cdd9cf]">need contact</small></div><div className="rounded-xl bg-white/10 px-3 py-2 sm:rounded-2xl sm:px-5 sm:py-4"><strong className="mr-1 text-2xl sm:block sm:text-3xl">{recentlyUpdatedCount}</strong><small className="text-[#cdd9cf]">recent contact</small></div></div> : null}
      </div>
    </section>

    {isStaff ? <section className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-[#dedfd8] bg-[#fffdf8] p-2 sm:mb-6 sm:flex sm:flex-wrap sm:gap-3 sm:rounded-2xl sm:p-4" aria-label="Horse filters">
      <select aria-label="Filter by staff contact" className={selectInput} onChange={(event) => onCommunicationFilter(event.target.value as CommunicationFilter)} value={communicationFilter}><option value="all">All horses</option><option value="attention">Needs contact</option><option value="recent">Recent contact</option></select>
      <select aria-label="Filter by field" className={selectInput} onChange={(event) => onFieldFilter(event.target.value)} value={fieldFilter}><option value="">All fields</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
      <select aria-label="Filter by herd" className={selectInput} onChange={(event) => onHerdFilter(event.target.value)} value={herdFilter}><option value="">All herds</option>{herdOptions.map((herd) => <option key={herd.id} value={herd.id}>{herd.label}</option>)}</select>
    </section> : null}

    {filteredHorses.length > 0 ? <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4" aria-label="Horses">{filteredHorses.map((item) => <HorseCard item={item} key={item.horse.id} onOpen={() => onOpenHorse(item.horse.id)} />)}</section> : <section className="rounded-3xl border border-dashed border-[#bfc6bf] bg-[#fffdf8] p-10 text-center"><h2 className="mb-2 font-serif text-3xl">No horses to show</h2><p className="mb-0 text-[#68736b]">{horses.length === 0 ? "An administrator can add the first horse in Setup." : "Try clearing one of the filters."}</p></section>}
  </>;
}

interface HorseCardProps {
  readonly item: HorseDashboardItem;
  readonly onOpen: () => void;
}

function HorseCard({ item, onOpen }: HorseCardProps): React.JSX.Element {
  const communication = communicationPresentation(item.daysSinceStaffCommunication);
  const hasSpecialRequirements = Boolean(item.careProfile?.special_requirements.trim());
  return <button className="group overflow-hidden rounded-2xl border border-[#dedfd8] bg-[#fffdf8] text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#385943] sm:rounded-[1.75rem]" onClick={onOpen} type="button">
    <div className="relative aspect-[5/4] overflow-hidden bg-[#dfe5df] sm:aspect-[4/3]">
      {item.thumbnailUrl ? <Image alt={`${item.horse.name} thumbnail`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" decoding="async" height={540} loading="lazy" src={item.thumbnailUrl} unoptimized width={720} /> : <div className="grid h-full place-items-center font-serif text-4xl text-[#789080] sm:text-6xl">{item.horse.name.slice(0, 1).toUpperCase()}</div>}
      <span className={`absolute bottom-2 left-2 rounded-full px-2 py-1 text-[10px] font-bold shadow-sm sm:bottom-auto sm:left-3 sm:top-3 sm:px-3 sm:text-xs ${communication.className}`}>{communication.label}</span>
      {item.unreadReplyCount > 0 ? <span aria-label={`${item.unreadReplyCount} unread ${item.unreadReplyCount === 1 ? "reply" : "replies"}`} className="absolute right-2 top-2 inline-flex min-h-7 items-center justify-center gap-1 rounded-full bg-[#1f5f8b] px-2 text-[10px] font-extrabold text-white shadow-lg ring-2 ring-white"><MessageCircle aria-hidden="true" size={13} />{item.unreadReplyCount === 1 ? "New reply" : `${item.unreadReplyCount} replies`}</span> : item.unreadAlertCount > 0 ? <span aria-label={`${item.unreadAlertCount} unread care ${item.unreadAlertCount === 1 ? "alert" : "alerts"}`} className="absolute right-2 top-2 inline-flex min-h-7 min-w-7 items-center justify-center rounded-full bg-[#f6e8c9] px-2 text-[10px] font-extrabold text-[#75520e] shadow-lg ring-2 ring-white"><Bell aria-hidden="true" className="mr-1" size={13} />{item.unreadAlertCount}</span> : null}
    </div>
    <span className="block p-3 sm:p-5"><strong className="mb-2 block truncate font-serif text-xl sm:text-3xl">{item.horse.name}</strong><span className="grid grid-cols-2 gap-1.5"><HorseLocationBox label="Field" value={item.fieldName} /><HorseLocationBox label="Herd" value={item.herdName} /></span>{hasSpecialRequirements ? <span className="mt-2 flex items-center gap-1.5 rounded-lg border-2 border-[#a65333] bg-[#f3ded3] px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.06em] text-[#73391f] sm:mt-4 sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs"><ShieldAlert aria-hidden="true" size={16} /><span className="sm:hidden">Special</span><span className="hidden sm:inline">Special requirements</span></span> : null}{item.activeMedications.length > 0 ? <span className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-[#f6e8c9] px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.06em] text-[#75520e] sm:mt-2 sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs"><Pill aria-hidden="true" size={15} /><span className="sm:hidden">Medication</span><span className="hidden sm:inline">Current medication</span></span> : null}</span>
  </button>;
}

function HorseLocationBox({ label, value }: { readonly label: "Field" | "Herd"; readonly value: string }): React.JSX.Element {
  return <span className="min-w-0 rounded-lg border border-[#d8ddd7] bg-[#f3f6f2] px-2 py-1.5"><small className="mb-0.5 block text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#68736b] sm:text-[9px]">{label}</small><span className="block truncate text-[11px] font-bold text-[#1d3528] sm:text-xs">{value}</span></span>;
}

interface HorseWorkspaceProps {
  readonly fields: readonly Field[];
  readonly herdOptions: readonly HerdOption[];
  readonly horseItem: HorseDashboardItem;
  readonly participants: Readonly<Record<string, ChatParticipant>>;
  readonly profile: Profile;
  readonly onBack: () => void;
  readonly onLocationUpdate: (horseId: string, fieldId: string | null, herdId: string | null) => Promise<boolean>;
  readonly onMessageSent: (createdAt: string) => void;
}

function HorseWorkspace({ fields, herdOptions, horseItem, participants, profile, onBack, onLocationUpdate, onMessageSent }: HorseWorkspaceProps): React.JSX.Element {
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const communication = communicationPresentation(horseItem.daysSinceStaffCommunication);

  async function saveLocation(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const fieldValue = formData.get("fieldId");
    const herdValue = formData.get("herdId");
    setIsSavingLocation(true);
    const wasSaved = await onLocationUpdate(
      horseItem.horse.id,
      typeof fieldValue === "string" && fieldValue ? fieldValue : null,
      typeof herdValue === "string" && herdValue ? herdValue : null,
    );
    setIsSavingLocation(false);
    if (wasSaved) setIsEditingLocation(false);
  }

  return <>
    <button className={`${secondaryButton} mb-5`} onClick={onBack} type="button"><ArrowLeft size={16} />All horses</button>
    <section className="mb-7 grid overflow-hidden rounded-[2rem] bg-[#1d3528] text-white shadow-xl md:grid-cols-[minmax(16rem,0.8fr)_1.2fr]">
      <div className="aspect-[4/3] bg-[#385943] md:aspect-auto">{horseItem.thumbnailUrl ? <Image alt={horseItem.horse.name} className="h-full min-h-64 w-full object-cover" height={700} src={horseItem.thumbnailUrl} unoptimized width={900} /> : <div className="grid h-full min-h-64 place-items-center font-serif text-8xl text-[#9fb0a3]">{horseItem.horse.name.slice(0, 1).toUpperCase()}</div>}</div>
      <div className="p-7 sm:p-9"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="mb-0 text-xs font-bold uppercase tracking-[0.18em] text-[#d9a27b]">Horse information</p><span className={`rounded-full px-3 py-1 text-xs font-bold ${communication.className}`}>{communication.label}</span></div><h1 className="mb-5 font-serif text-5xl">{horseItem.horse.name}</h1><div className="grid gap-3 sm:grid-cols-2"><HorseInformationTile label="Field" value={horseItem.fieldName} /><HorseInformationTile label="Herd" value={horseItem.herdName} /><HorseInformationTile label="Type" value={horseItem.horse.horse_type || "Not entered"} /><HorseInformationTile label="Born" value={horseItem.horse.birth_year?.toString() ?? "Not entered"} /></div>{profile.role === "admin" ? <button className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 text-sm font-bold text-white" onClick={() => setIsEditingLocation((currentValue) => !currentValue)} type="button"><MapPin size={16} />Change field or herd</button> : null}{isEditingLocation ? <form className="mt-4 grid gap-3 rounded-2xl bg-white/10 p-4 sm:grid-cols-2" onSubmit={(event) => void saveLocation(event)}><label className="text-xs font-bold">Field<select className="mt-1 min-h-11 w-full rounded-xl bg-white px-3 text-sm text-[#1d3528]" defaultValue={horseItem.horse.field_id ?? ""} name="fieldId"><option value="">Unassigned</option>{fields.filter((field) => field.is_active).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label><label className="text-xs font-bold">Herd membership<select className="mt-1 min-h-11 w-full rounded-xl bg-white px-3 text-sm text-[#1d3528]" defaultValue={horseItem.horse.herd_id ?? ""} name="herdId"><option value="">Remove from herd</option>{herdOptions.map((herd) => <option key={herd.id} value={herd.id}>{herd.label}</option>)}</select></label><button className="min-h-11 rounded-full bg-[#d9a27b] px-4 text-sm font-bold text-[#1d3528] sm:col-span-2" disabled={isSavingLocation} type="submit">{isSavingLocation ? "Saving…" : "Save field and herd"}</button></form> : null}</div>
    </section>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
      <ConversationTimeline conversationId={horseItem.conversation.id} currentUserId={profile.id} horseId={horseItem.horse.id} horseName={horseItem.horse.name} organizationId={profile.organization_id} participants={participants} onMessageSent={onMessageSent} />

      <aside className="space-y-6">
        <CareSummary horseItem={horseItem} />
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
