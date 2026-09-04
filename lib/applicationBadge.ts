export async function synchronizeApplicationBadge(unreadMessageCount: number): Promise<void> {
  if (typeof navigator === "undefined") return;

  try {
    if (unreadMessageCount > 0 && typeof navigator.setAppBadge === "function") {
      await navigator.setAppBadge(unreadMessageCount);
      return;
    }

    if (typeof navigator.clearAppBadge === "function") await navigator.clearAppBadge();
  } catch {
    return;
  }
}
