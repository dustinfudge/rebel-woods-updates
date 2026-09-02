"use client";

import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { ImagePlus, Send, X } from "lucide-react";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { Tables } from "@/types/supabase";

type Message = Tables<"messages">;
type MessageMedia = Tables<"message_media">;
type MessageRead = Tables<"message_reads">;

interface ReplyPhoto {
  readonly media: MessageMedia;
  readonly signedUrl: string;
}

export interface ChatParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly roleLabel: string;
}

export interface ChatWindowProps {
  readonly updateId: string;
  readonly horseId: string;
  readonly organizationId: string;
  readonly currentUserId: string;
  readonly participants: Readonly<Record<string, ChatParticipant>>;
  readonly initialMessages?: readonly Message[];
}

function formatMessageTime(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

export function ChatWindow({
  updateId,
  horseId,
  organizationId,
  currentUserId,
  participants,
  initialMessages = [],
}: ChatWindowProps): React.JSX.Element {
  const [messages, setMessages] = useState<readonly Message[]>(initialMessages);
  const [messageReads, setMessageReads] = useState<readonly MessageRead[]>([]);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [replyPhotos, setReplyPhotos] = useState<Readonly<Record<string, ReplyPhoto>>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const addSignedReplyPhoto = useCallback(async (media: MessageMedia): Promise<void> => {
    const { data, error } = await supabase.storage.from("message-media").createSignedUrl(media.storage_path, 3600);
    if (error) return;
    setReplyPhotos((currentPhotos) => ({ ...currentPhotos, [media.message_id]: { media, signedUrl: data.signedUrl } }));
  }, [supabase]);

  useEffect(() => {
    async function loadInitialReplyPhotos(messageIds: readonly string[]): Promise<void> {
      if (messageIds.length === 0) return;
      const { data, error } = await supabase.from("message_media").select("*").in("message_id", [...messageIds]);
      if (error) return;
      await Promise.all(data.map(addSignedReplyPhoto));
    }
    void loadInitialReplyPhotos(initialMessages.map((message) => message.id));
  }, [addSignedReplyPhoto, initialMessages, supabase]);

  useEffect(() => {
    async function synchronizeReadReceipts(): Promise<void> {
      const messageIds = messages.map((message) => message.id);
      if (messageIds.length === 0) return;

      const { data: existingReads, error: readError } = await supabase
        .from("message_reads")
        .select("*")
        .in("message_id", messageIds);
      if (readError) return;

      const recordedReadKeys = new Set(existingReads.map((read) => `${read.message_id}:${read.profile_id}`));
      const unreadMessages = messages.filter((message) =>
        message.sender_id !== currentUserId && !recordedReadKeys.has(`${message.id}:${currentUserId}`),
      );
      let synchronizedReads: readonly MessageRead[] = existingReads;

      if (unreadMessages.length > 0) {
        const { data: newReads, error: insertError } = await supabase
          .from("message_reads")
          .upsert(
            unreadMessages.map((message) => ({ message_id: message.id, profile_id: currentUserId })),
            { onConflict: "message_id,profile_id", ignoreDuplicates: true },
          )
          .select("*");
        if (!insertError) synchronizedReads = [...existingReads, ...(newReads ?? [])];
      }

      setMessageReads(synchronizedReads);
    }

    void synchronizeReadReceipts();
  }, [currentUserId, messages, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`update-messages:${updateId}`)
      .on<Message>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `update_id=eq.${updateId}` },
        (payload: RealtimePostgresInsertPayload<Message>): void => {
          setMessages((currentMessages) =>
            currentMessages.some((message) => message.id === payload.new.id)
              ? currentMessages
              : [...currentMessages, payload.new],
          );
        },
      )
      .on<Message>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `update_id=eq.${updateId}` },
        (payload: RealtimePostgresUpdatePayload<Message>): void => {
          setMessages((currentMessages) =>
            currentMessages.map((message) => (message.id === payload.new.id ? payload.new : message)),
          );
        },
      )
      .on<MessageMedia>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_media" },
        (payload: RealtimePostgresInsertPayload<MessageMedia>): void => {
          void supabase.from("messages").select("id").eq("id", payload.new.message_id).eq("update_id", updateId).maybeSingle().then(({ data }) => {
            if (data) void addSignedReplyPhoto(payload.new);
          });
        },
      )
      .on<MessageRead>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads" },
        (payload: RealtimePostgresInsertPayload<MessageRead>): void => {
          void supabase.from("messages").select("id").eq("id", payload.new.message_id).eq("update_id", updateId).maybeSingle().then(({ data }) => {
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
  }, [addSignedReplyPhoto, supabase, updateId]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const body = draft.trim();

    if (!body || isSending) {
      return;
    }

    setIsSending(true);
    setSubmissionError(null);

    const { data, error } = await supabase
      .from("messages")
      .insert({ update_id: updateId, sender_id: currentUserId, body })
      .select()
      .single();

    if (error) {
      setIsSending(false);
      setSubmissionError("Your reply could not be sent. Please try again.");
      return;
    }

    if (photo) {
      const safeFilename = photo.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-") || "reply-photo";
      const storagePath = `${organizationId}/${horseId}/${data.id}/${crypto.randomUUID()}-${safeFilename}`;
      const { error: uploadError } = await supabase.storage.from("message-media").upload(storagePath, photo, { contentType: photo.type, upsert: false });
      if (uploadError) {
        setSubmissionError("Your reply was sent, but the photo could not be attached.");
      } else {
        const { data: media, error: mediaError } = await supabase.from("message_media").insert({ message_id: data.id, uploaded_by: currentUserId, storage_path: storagePath, mime_type: photo.type, original_filename: photo.name, byte_size: photo.size }).select("*").single();
        if (mediaError) {
          await supabase.storage.from("message-media").remove([storagePath]);
          setSubmissionError("Your reply was sent, but the photo could not be attached.");
        } else {
          await addSignedReplyPhoto(media);
        }
      }
    }

    setDraft("");
    setPhoto(null);
    setIsSending(false);
    setMessages((currentMessages) =>
      currentMessages.some((message) => message.id === data.id) ? currentMessages : [...currentMessages, data],
    );
  }

  return (
    <section className="flex min-h-[32rem] flex-col overflow-hidden rounded-3xl border border-[#dedfd8] bg-[#fffdf8]" aria-label="Update replies">
      <header className="border-b border-[#dedfd8] px-5 py-4">
        <p className="mb-1 font-serif text-xl text-[#14261d]">Replies</p>
        <p className="mb-0 text-xs text-[#68736b]">Owners and Rebel Wranglers can respond here.</p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-5" ref={messageListRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="rounded-2xl bg-[#f7f3e9] p-5 text-center text-sm text-[#68736b]">
            No replies yet. Start the conversation about this update.
          </p>
        ) : null}

        {messages.map((message) => {
          const isCurrentUser = message.sender_id === currentUserId;
          const participant = participants[message.sender_id];
          const replyPhoto = replyPhotos[message.id];
          const readerNames = messageReads
            .filter((read) => read.message_id === message.id && read.profile_id !== message.sender_id)
            .map((read) => read.profile_id === currentUserId ? "You" : participants[read.profile_id]?.displayName ?? "A participant");

          return (
            <article className={`flex ${isCurrentUser ? "justify-end" : "justify-start"}`} key={message.id}>
              <div className={`max-w-[82%] ${isCurrentUser ? "text-right" : "text-left"}`}>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#68736b]">
                  {participant?.displayName ?? "Rebel Woods"} · {participant?.roleLabel ?? "Member"}
                </p>
                <div className={`rounded-2xl px-4 py-3 text-sm leading-6 ${isCurrentUser ? "rounded-br-md bg-[#1d3528] text-white" : "rounded-bl-md bg-[#e4ece4] text-[#14261d]"}`}>
                  {message.hidden_at ? <em>Message removed by Rebel Woods.</em> : message.body}
                  {!message.hidden_at && replyPhoto ? <a className="mt-3 block overflow-hidden rounded-xl" href={replyPhoto.signedUrl} target="_blank" rel="noreferrer"><Image alt={replyPhoto.media.original_filename} className="max-h-72 w-full object-cover" height={600} src={replyPhoto.signedUrl} unoptimized width={800} /></a> : null}
                </div>
                <p className="mt-1 text-[10px] text-[#7c857e]">
                  {formatMessageTime(message.created_at)}{readerNames.length > 0 ? ` · Read by ${readerNames.join(", ")}` : ""}
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <form className="border-t border-[#dedfd8] p-4" onSubmit={(event) => void sendMessage(event)}>
        {photo ? <div className="mb-3 flex items-center justify-between rounded-xl bg-[#e4ece4] px-3 py-2 text-sm"><span className="truncate pr-3">{photo.name}</span><button aria-label="Remove reply photo" onClick={() => setPhoto(null)} type="button"><X size={17} /></button></div> : null}
        <div className="flex items-end gap-2">
          <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border border-[#dedfd8] text-[#385943]" aria-label="Attach a photo">
            <ImagePlus aria-hidden="true" size={19} />
            <input accept="image/jpeg,image/png,image/webp,image/heic" className="sr-only" onChange={(event) => {
              const selectedPhoto = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (selectedPhoto && selectedPhoto.size > 15 * 1024 * 1024) {
                setSubmissionError("Reply photos must be 15 MB or smaller.");
                return;
              }
              setPhoto(selectedPhoto);
              setSubmissionError(null);
            }} type="file" />
          </label>
          <label className="sr-only" htmlFor="reply-body">Write a reply</label>
          <textarea
            className="min-h-11 flex-1 resize-none rounded-2xl border border-[#cfd4ce] bg-white px-4 py-3 text-sm outline-none focus:border-[#385943]"
            id="reply-body"
            maxLength={2_000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a reply…"
            rows={1}
            value={draft}
          />
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#a65333] text-white disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!draft.trim() || isSending} aria-label="Send reply">
            <Send aria-hidden="true" size={18} />
          </button>
        </div>
        {submissionError ? <p className="mb-0 mt-2 text-xs text-red-700" role="alert">{submissionError}</p> : null}
      </form>
    </section>
  );
}
