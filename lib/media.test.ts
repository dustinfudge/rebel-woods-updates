import { describe, expect, it } from "vitest";

import { MAX_UPDATE_PHOTOS, MAX_UPDATE_VIDEOS, isVideoDurationAllowed, validateUpdateMedia } from "./media";

function createFile(name: string, type: string, size = 8): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("weekly update media validation", () => {
  it("accepts the expected three-photo, one-video update", () => {
    const files = [
      createFile("one.jpg", "image/jpeg"),
      createFile("two.jpg", "image/jpeg"),
      createFile("three.jpg", "image/jpeg"),
      createFile("clip.mp4", "video/mp4"),
    ];

    expect(validateUpdateMedia(files)).toEqual({ valid: true, summary: { photoCount: 3, videoCount: 1 } });
  });

  it("rejects selections over the photo and video limits", () => {
    const photos = Array.from({ length: MAX_UPDATE_PHOTOS + 1 }, (_, index) => createFile(`${index}.jpg`, "image/jpeg"));
    const videos = Array.from({ length: MAX_UPDATE_VIDEOS + 1 }, (_, index) => createFile(`${index}.mp4`, "video/mp4"));

    expect(validateUpdateMedia(photos).valid).toBe(false);
    expect(validateUpdateMedia(videos).valid).toBe(false);
  });

  it("accepts videos only through sixty seconds", () => {
    expect(isVideoDurationAllowed(60)).toBe(true);
    expect(isVideoDurationAllowed(60.01)).toBe(false);
    expect(isVideoDurationAllowed(0)).toBe(false);
  });
});
