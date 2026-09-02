"use client";

import { Camera, ImagePlus, X } from "lucide-react";
import { type ChangeEvent, type FormEvent, useState } from "react";

import { isVideoDurationAllowed, readVideoDurationSeconds, validateUpdateMedia } from "@/lib/media";

export interface WeeklyUpdateDraft {
  readonly body: string;
  readonly media: readonly File[];
}

export interface UpdateComposerProps {
  readonly horseName: string;
  readonly hasExistingMedia?: boolean;
  readonly initialBody?: string;
  readonly isSubmitting: boolean;
  readonly onSubmit: (draft: WeeklyUpdateDraft) => Promise<boolean>;
  readonly progressMessage?: string | null;
  readonly submitLabel?: string;
}

export function UpdateComposer({
  horseName,
  hasExistingMedia = false,
  initialBody = "",
  isSubmitting,
  onSubmit,
  progressMessage = null,
  submitLabel = "Publish weekly update",
}: UpdateComposerProps): React.JSX.Element {
  const [body, setBody] = useState(initialBody);
  const [media, setMedia] = useState<readonly File[]>([]);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  async function addMedia(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    const nextMedia = [...media, ...selectedFiles];
    const validation = validateUpdateMedia(nextMedia);

    if (!validation.valid) {
      setValidationMessage(validation.message);
      return;
    }

    try {
      for (const videoFile of selectedFiles.filter((file) => file.type.startsWith("video/"))) {
        const durationSeconds = await readVideoDurationSeconds(videoFile);
        if (!isVideoDurationAllowed(durationSeconds)) {
          setValidationMessage(`${videoFile.name} must be 60 seconds or shorter.`);
          return;
        }
      }
    } catch {
      setValidationMessage("One of the selected videos could not be read.");
      return;
    }

    setMedia(nextMedia);
    setValidationMessage(null);
  }

  function removeMedia(fileToRemove: File): void {
    setMedia((currentMedia) => currentMedia.filter((file) => file !== fileToRemove));
  }

  async function publishUpdate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!body.trim() || (media.length === 0 && !hasExistingMedia) || isSubmitting) {
      return;
    }
    const wasSaved = await onSubmit({ body: body.trim(), media });
    if (wasSaved) {
      setBody("");
      setMedia([]);
    }
  }

  return (
    <form className="space-y-5 rounded-3xl border border-[#dedfd8] bg-[#fffdf8] p-5" onSubmit={(event) => void publishUpdate(event)}>
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-[#a65333]">Weekly update</p>
        <h2 className="mb-0 font-serif text-3xl text-[#14261d]">How is {horseName}?</h2>
      </div>
      <label className="block">
        <span className="mb-2 block text-sm font-bold text-[#385943]">Quick update</span>
        <textarea className="min-h-32 w-full resize-y rounded-2xl border border-[#cfd4ce] bg-white p-4 text-base leading-7 outline-none focus:border-[#385943]" maxLength={4_000} onChange={(event) => setBody(event.target.value)} placeholder="Share the highlights from this week…" value={body} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#9eaaa0] bg-[#f7f3e9] text-sm font-bold text-[#385943]">
          <Camera className="mb-2" aria-hidden="true" size={22} />Take photo or video
          <input className="sr-only" type="file" accept="image/*,video/*" capture="environment" onChange={(event) => void addMedia(event)} />
        </label>
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#9eaaa0] bg-[#f7f3e9] text-sm font-bold text-[#385943]">
          <ImagePlus className="mb-2" aria-hidden="true" size={22} />Choose from phone
          <input className="sr-only" type="file" accept="image/*,video/*" multiple onChange={(event) => void addMedia(event)} />
        </label>
      </div>
      {media.length > 0 ? (
        <ul className="space-y-2" aria-label="Selected photos and videos">
          {media.map((file) => (
            <li className="flex items-center justify-between rounded-xl bg-[#e4ece4] px-3 py-2 text-sm" key={`${file.name}-${file.lastModified}`}>
              <span className="truncate pr-3">{file.name}</span>
              <button type="button" onClick={() => removeMedia(file)} aria-label={`Remove ${file.name}`}><X aria-hidden="true" size={17} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {validationMessage ? <p className="text-sm text-red-700" role="alert">{validationMessage}</p> : null}
      {progressMessage ? <p className="rounded-xl bg-[#e4ece4] p-3 text-sm font-semibold text-[#385943]" role="status">{progressMessage}</p> : null}
      <p className="text-xs leading-5 text-[#68736b]">Up to 10 photos and 3 videos. Videos may be up to 60 seconds.</p>
      <button className="w-full rounded-full bg-[#a65333] px-5 py-3.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!body.trim() || (media.length === 0 && !hasExistingMedia) || isSubmitting}>
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
