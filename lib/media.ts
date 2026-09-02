export const MAX_UPDATE_PHOTOS = 10;
export const MAX_UPDATE_VIDEOS = 3;
export const MAX_VIDEO_DURATION_SECONDS = 60;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

export interface MediaSelectionSummary {
  readonly photoCount: number;
  readonly videoCount: number;
}

export type MediaValidationResult =
  | { readonly valid: true; readonly summary: MediaSelectionSummary }
  | { readonly valid: false; readonly message: string };

export function validateUpdateMedia(files: readonly File[]): MediaValidationResult {
  let photoCount = 0;
  let videoCount = 0;

  for (const file of files) {
    if (file.type.startsWith("image/")) {
      photoCount += 1;
      if (file.size > MAX_PHOTO_BYTES) {
        return { valid: false, message: `${file.name} is larger than 15 MB.` };
      }
      continue;
    }

    if (file.type.startsWith("video/")) {
      videoCount += 1;
      if (file.size > MAX_VIDEO_BYTES) {
        return { valid: false, message: `${file.name} is larger than 150 MB.` };
      }
      continue;
    }

    return { valid: false, message: `${file.name} is not a supported photo or video.` };
  }

  if (photoCount > MAX_UPDATE_PHOTOS) {
    return { valid: false, message: `Choose no more than ${MAX_UPDATE_PHOTOS} photos.` };
  }

  if (videoCount > MAX_UPDATE_VIDEOS) {
    return { valid: false, message: `Choose no more than ${MAX_UPDATE_VIDEOS} videos.` };
  }

  return { valid: true, summary: { photoCount, videoCount } };
}

export function isVideoDurationAllowed(durationSeconds: number): boolean {
  return Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= MAX_VIDEO_DURATION_SECONDS;
}

export async function readVideoDurationSeconds(file: File): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);

    video.preload = "metadata";
    video.onloadedmetadata = (): void => {
      URL.revokeObjectURL(objectUrl);
      resolve(video.duration);
    };
    video.onerror = (): void => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name}.`));
    };
    video.src = objectUrl;
  });
}
