"use client";

import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { Camera, Download, ImagePlus, Send, X } from "lucide-react";
import Image from "next/image";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatParticipant } from "@/components/ChatWindow";
import { isVideoDurationAllowed, readVideoDurationSeconds, validateUpdateMedia } from "@/lib/media";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { Tables } from "@/types/supabase";

type ConversationMessage = Tables<"conversation_messages">;
type ConversationMedia = Tables<"conversation_media">;
type ConversationMessageRead = Tables<"conversation_message_reads">;

interface ConversationMediaLink {
  readonly media: ConversationMedia;
  readonly viewUrl: string;
  readonly downloadUrl: string;
}

interface ConversationTimelineProps {
  readonly conversationId: string;
  readonly currentUserId: string;
  readonly horseId: string;
  readonly horseName: string;
  readonly organizationId: string;
  readonly participants: Readonly<Record<string, ChatParticipant>>;
  readonly onMessageSent: (createdAt: string) => void;
}

const messageBatchSize = 50;

function safeStorageFilename(filename: string): string {
  return filename.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-") || "media";
}

function chunkItems<Item>(items: readonly Item[], size: number): readonly (readonly Item[])[] {
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function formatMessageTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  const today = new Date();
  const isToday = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return new Intl.DateTimeFormat("en-US", isToday
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function ConversationTimeline({ conversationId, currentUserId, horseId, horseName, organizationId, participants, onMessageSent }: ConversationTimelineProps): React.JSX.Element {
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([]);
  const [messageReads, setMessageReads] = useState<readonly ConversationMessageRead[]>([]);
  const [mediaLinks, setMediaLinks] = useState<Readonly<Record<string, ConversationMediaLink>>>({});
  const [draft, setDraft] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<readonly File[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const addSignedMedia = useCallback(async (media: ConversationMedia): Promise<void> => {
    const bucket = supabase.storage.from(media.storage_bucket);
    const [viewResult, downloadResult] = await Promise.all([
      bucket.createSignedUrl(media.storage_path, 3600),
      bucket.createSignedUrl(media.storage_path, 3600, { download: media.original_filename }),
    ]);
    if (viewResult.error || downloadResult.error) return;
    setMediaLinks((currentLinks) => ({
      ...currentLinks,
      [media.id]: { media, viewUrl: viewResult.data.signedUrl, downloadUrl: downloadResult.data.signedUrl },
    }));
  }, [supabase]);

  const loadConversation = useCallback(async (): Promise<void> => {
    const messagesResult = await supabase
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(250);
    if (messagesResult.error) {
      setErrorMessage("This conversation could not be loaded.");
      setIsLoading(false);
      return;
    }

    const loadedMessages = [...(messagesResult.data ?? [])].reverse();
    const messageIds = loadedMessages.map((message) => message.id);
    const loadedMedia: ConversationMedia[] = [];
    const loadedReads: ConversationMessageRead[] = [];
    for (const idBatch of chunkItems(messageIds, messageBatchSize)) {
      const [mediaResult, readsResult] = await Promise.all([
        supabase.from("conversation_media").select("*").in("message_id", [...idBatch]).order("sort_order"),
        supabase.from("conversation_message_reads").select("*").in("message_id", [...idBatch]),
      ]);
      if (mediaResult.error || readsResult.error) {
        setErrorMessage("Some conversation details could not be loaded.");
        setIsLoading(false);
        return;
      }
      loadedMedia.push(...(mediaResult.data ?? []));
      loadedReads.push(...(readsResult.data ?? []));
    }

    setMessages(loadedMessages);
    setMessageReads(loadedReads);
    await Promise.all(loadedMedia.map(addSignedMedia));
    setIsLoading(false);
  }, [addSignedMedia, conversationId, supabase]);

  useEffect(() => {
    const loadTimeout = window.setTimeout(() => void loadConversation(), 0);
    return (): void => window.clearTimeout(loadTimeout);
  }, [loadConversation]);

  useEffect(() => {
    const unreadMessages = messages.filter((message) => message.sender_id !== currentUserId
      && !messageReads.some((read) => read.message_id === message.id && read.profile_id === currentUserId));
    if (unreadMessages.length === 0) return;

    async function recordReads(): Promise<void> {
      const { data, error } = await supabase
        .from("conversation_message_reads")
        .upsert(unreadMessages.map((message) => ({ message_id: message.id, profile_id: currentUserId })), {
          onConflict: "message_id,profile_id",
          ignoreDuplicates: true,
        })
        .select("*");
      if (error) return;
      setMessageReads((currentReads) => [...currentReads, ...(data ?? [])].filter((read, index, allReads) =>
        allReads.findIndex((candidate) => candidate.message_id === read.message_id && candidate.profile_id === read.profile_id) === index));
    }

    void recordReads();
  }, [currentUserId, messageReads, messages, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`horse-conversation:${conversationId}`)
      .on<ConversationMessage>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload: RealtimePostgresInsertPayload<ConversationMessage>): void => {
          setMessages((currentMessages) => currentMessages.some((message) => message.id === payload.new.id)
            ? currentMessages
            : [...currentMessages, payload.new]);
        },
      )
      .on<ConversationMessage>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload: RealtimePostgresUpdatePayload<ConversationMessage>): void => {
          setMessages((currentMessages) => currentMessages.map((message) => message.id === payload.new.id ? payload.new : message));
        },
      )
      .on<ConversationMedia>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_media" },
        (payload: RealtimePostgresInsertPayload<ConversationMedia>): void => {
          void supabase.from("conversation_messages").select("id").eq("id", payload.new.message_id).eq("conversation_id", conversationId).maybeSingle().then(({ data }) => {
            if (data) void addSignedMedia(payload.new);
          });
        },
      )
      .on<ConversationMessageRead>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_message_reads" },
        (payload: RealtimePostgresInsertPayload<ConversationMessageRead>): void => {
          void supabase.from("conversation_messages").select("id").eq("id", payload.new.message_id).eq("conversation_id", conversationId).maybeSingle().then(({ data }) => {
            if (!data) return;
            setMessageReads((currentReads) => currentReads.some((read) => read.message_id === payload.new.message_id && read.profile_id === payload.new.profile_id)
              ? currentReads
              : [...currentReads, payload.new]);
          });
        },
      )
      .subscribe();

    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [addSignedMedia, conversationId, supabase]);

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: isLoading ? "instant" : "smooth" });
  }, [isLoading, messages]);

  const mediaByMessage = useMemo<ReadonlyMap<string, readonly ConversationMediaLink[]>>(() => {
    const groupedMedia = new Map<string, ConversationMediaLink[]>();
    for (const link of Object.values(mediaLinks)) {
      const existingLinks = groupedMedia.get(link.media.message_id) ?? [];
      groupedMedia.set(link.media.message_id, [...existingLinks, link].sort((left, right) => left.media.sort_order - right.media.sort_order));
    }
    return groupedMedia;
  }, [mediaLinks]);

  async function addMedia(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const newFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    const nextMedia = [...selectedMedia, ...newFiles];
    const validation = validateUpdateMedia(nextMedia);
    if (!validation.valid) {
      setErrorMessage(validation.message);
      return;
    }
    try {
      for (const video of newFiles.filter((file) => file.type.startsWith("video/"))) {
        if (!isVideoDurationAllowed(await readVideoDurationSeconds(video))) {
          setErrorMessage(`${video.name} must be 60 seconds or shorter.`);
          return;
        }
      }
    } catch {
      setErrorMessage("One of the selected videos could not be read.");
      return;
    }
    setSelectedMedia(nextMedia);
    setErrorMessage(null);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && selectedMedia.length === 0) || isSending) return;
    setIsSending(true);
    setErrorMessage(null);

    const messageId = crypto.randomUUID();
    const messageResult = await supabase.from("conversation_messages").insert({
      id: messageId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      body,
    }).select("*").single();
    if (messageResult.error) {
      setErrorMessage("Your message could not be sent. Please try again.");
      setIsSending(false);
      return;
    }

    setMessages((currentMessages) => currentMessages.some((message) => message.id === messageResult.data.id)
      ? currentMessages
      : [...currentMessages, messageResult.data]);
    onMessageSent(messageResult.data.created_at);

    for (const [index, file] of selectedMedia.entries()) {
      setProgressMessage(`Uploading ${index + 1} of ${selectedMedia.length}: ${file.name}`);
      const isVideo = file.type.startsWith("video/");
      const durationSeconds = isVideo ? await readVideoDurationSeconds(file) : null;
      const storagePath = `${organizationId}/${horseId}/${messageId}/${crypto.randomUUID()}-${safeStorageFilename(file.name)}`;
      const uploadResult = await supabase.storage.from("conversation-media").upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadResult.error) {
        setErrorMessage("Your message was sent, but at least one attachment could not be uploaded.");
        continue;
      }
      const mediaResult = await supabase.from("conversation_media").insert({
        message_id: messageId,
        uploaded_by: currentUserId,
        storage_bucket: "conversation-media",
        storage_path: storagePath,
        media_type: isVideo ? "video" : "photo",
        mime_type: file.type,
        original_filename: file.name,
        byte_size: file.size,
        duration_seconds: durationSeconds,
        sort_order: index,
      }).select("*").single();
      if (mediaResult.error) {
        await supabase.storage.from("conversation-media").remove([storagePath]);
        setErrorMessage("Your message was sent, but at least one attachment could not be saved.");
        continue;
      }
      await addSignedMedia(mediaResult.data);
    }

    setDraft("");
    setSelectedMedia([]);
    setProgressMessage(null);
    setIsSending(false);
  }

  return <section className="flex min-h-[36rem] flex-col overflow-hidden rounded-3xl border border-[#dedfd8] bg-[#fffdf8]" aria-label={`${horseName} conversation`}>
    <header className="border-b border-[#dedfd8] px-5 py-4"><h2 className="mb-1 font-serif text-2xl">{horseName}’s conversation</h2><p className="mb-0 text-xs text-[#68736b]">Messages, photos, and videos stay together in one continuous thread.</p></header>
    <div className="max-h-[65vh] flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" ref={timelineRef} aria-live="polite">
      {isLoading ? <p className="rounded-2xl bg-[#f7f3e9] p-5 text-center text-sm text-[#68736b]">Loading conversation…</p> : null}
      {!isLoading && messages.length === 0 ? <p className="rounded-2xl bg-[#f7f3e9] p-5 text-center text-sm text-[#68736b]">No messages yet. Start the conversation about {horseName}.</p> : null}
      {messages.map((message) => {
        const isCurrentUser = message.sender_id === currentUserId;
        const participant = participants[message.sender_id];
        const messageMedia = mediaByMessage.get(message.id) ?? [];
        const readerNames = messageReads
          .filter((read) => read.message_id === message.id && read.profile_id !== message.sender_id)
          .map((read) => read.profile_id === currentUserId ? "You" : participants[read.profile_id]?.displayName ?? "A participant");
        return <article className={`flex ${isCurrentUser ? "justify-end" : "justify-start"}`} key={message.id}>
          <div className={`max-w-[88%] sm:max-w-[78%] ${isCurrentUser ? "text-right" : "text-left"}`}>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#68736b]">{participant?.displayName ?? "Rebel Woods"} · {participant?.roleLabel ?? "Member"}</p>
            <div className={`overflow-hidden rounded-2xl text-sm leading-6 ${isCurrentUser ? "rounded-br-md bg-[#1d3528] text-white" : "rounded-bl-md bg-[#e4ece4] text-[#14261d]"}`}>
              {message.kind === "historical_update" ? <p className={`mb-0 px-4 pt-3 text-[10px] font-extrabold uppercase tracking-[0.12em] ${isCurrentUser ? "text-[#d9a27b]" : "text-[#a65333]"}`}>Previous update</p> : null}
              {message.hidden_at ? <p className="mb-0 px-4 py-3"><em>Message removed by Rebel Woods.</em></p> : <>{message.body ? <p className="mb-0 whitespace-pre-wrap px-4 py-3">{message.body}</p> : null}<ConversationMediaGallery links={messageMedia} horseName={horseName} /></>}
            </div>
            <p className="mt-1 text-[10px] text-[#7c857e]">{formatMessageTimestamp(message.created_at)}{readerNames.length > 0 ? ` · Read by ${readerNames.join(", ")}` : ""}</p>
          </div>
        </article>;
      })}
    </div>
    <form className="border-t border-[#dedfd8] p-4" onSubmit={(event) => void sendMessage(event)}>
      {selectedMedia.length > 0 ? <ul className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Selected attachments">{selectedMedia.map((file) => <SelectedMediaPreview file={file} key={`${file.name}-${file.lastModified}`} onRemove={() => setSelectedMedia((currentMedia) => currentMedia.filter((item) => item !== file))} />)}</ul> : null}
      {progressMessage ? <p className="mb-3 rounded-xl bg-[#e4ece4] p-3 text-xs font-semibold text-[#385943]" role="status">{progressMessage}</p> : null}
      <label className="sr-only" htmlFor="conversation-message">Write a message</label>
      <textarea className="mb-3 min-h-20 w-full resize-y rounded-2xl border border-[#cfd4ce] bg-white px-4 py-3 text-sm outline-none focus:border-[#385943]" id="conversation-message" maxLength={4000} onChange={(event) => setDraft(event.target.value)} placeholder={`Share an update or message about ${horseName}…`} value={draft} />
      <div className="flex items-center gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-[#cfd4ce] bg-white px-3 text-xs font-bold text-[#385943]"><Camera size={17} />Take photo/video<input accept="image/*,video/*" capture="environment" className="sr-only" onChange={(event) => void addMedia(event)} type="file" /></label>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-[#cfd4ce] bg-white px-3 text-xs font-bold text-[#385943]"><ImagePlus size={17} /><span className="hidden sm:inline">Choose media</span><span className="sm:hidden">Gallery</span><input accept="image/*,video/*" className="sr-only" multiple onChange={(event) => void addMedia(event)} type="file" /></label>
        <button aria-label="Send message" className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#a65333] text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={(!draft.trim() && selectedMedia.length === 0) || isSending} type="submit"><Send size={18} /></button>
      </div>
      <p className="mb-0 mt-2 text-[10px] leading-4 text-[#68736b]">Up to 10 photos and 3 videos per message. Videos may be up to 60 seconds.</p>
      {errorMessage ? <p className="mb-0 mt-2 text-xs font-semibold text-red-700" role="alert">{errorMessage}</p> : null}
    </form>
  </section>;
}

function ConversationMediaGallery({ horseName, links }: { readonly horseName: string; readonly links: readonly ConversationMediaLink[] }): React.JSX.Element | null {
  if (links.length === 0) return null;
  return <div className={`grid max-w-full gap-1.5 p-2 ${links.length > 1 ? "w-64 grid-cols-2 sm:w-72" : "w-44 grid-cols-1 sm:w-52"}`}>{links.map((link, index) => <figure className="relative overflow-hidden rounded-xl bg-black/10" key={link.media.id}>{link.media.media_type === "video" ? <video className="aspect-[4/3] w-full object-cover" controls playsInline preload="metadata" src={link.viewUrl} /> : <a href={link.viewUrl} rel="noreferrer" target="_blank"><Image alt={`${horseName} photo ${index + 1}`} className="aspect-[4/3] w-full object-cover" decoding="async" height={300} loading="lazy" src={link.viewUrl} unoptimized width={400} /></a>}<a aria-label={`Download ${link.media.original_filename}`} className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[#1d3528] shadow" download href={link.downloadUrl}><Download size={15} /></a></figure>)}</div>;
}

function SelectedMediaPreview({ file, onRemove }: { readonly file: File; readonly onRemove: () => void }): React.JSX.Element {
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => (): void => URL.revokeObjectURL(previewUrl), [previewUrl]);

  const isVideo = file.type.startsWith("video/");
  return <li className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[#cfd4ce] bg-[#e4ece4] shadow-sm">
    {isVideo ? <video aria-label={`Preview of ${file.name}`} className="h-full w-full object-cover" muted playsInline preload="metadata" src={previewUrl} /> : <Image alt={`Preview of ${file.name}`} className="h-full w-full object-cover" height={160} src={previewUrl} unoptimized width={160} />}
    {isVideo ? <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Video</span> : null}
    <button aria-label={`Remove ${file.name}`} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/95 text-[#1d3528] shadow" onClick={onRemove} type="button"><X size={14} /></button>
  </li>;
}
