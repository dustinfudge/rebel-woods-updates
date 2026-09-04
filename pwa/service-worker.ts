interface RebelWoodsNotificationPayload {
  readonly badgeCount?: number;
  readonly title: string;
  readonly body: string;
  readonly url?: string;
}

interface WorkerNavigatorWithApplicationBadging {
  readonly setAppBadge?: (contents?: number) => Promise<void>;
}

const CACHE_NAME = "rebel-woods-shell-v1";
const serviceWorker = globalThis as unknown as ServiceWorkerGlobalScope;

function isNotificationPayload(value: unknown): value is RebelWoodsNotificationPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const hasValidBadgeCount = candidate.badgeCount === undefined
    || (typeof candidate.badgeCount === "number" && Number.isInteger(candidate.badgeCount) && candidate.badgeCount >= 0);
  return typeof candidate.title === "string" && typeof candidate.body === "string" && hasValidBadgeCount;
}

serviceWorker.addEventListener("install", (event: ExtendableEvent): void => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(serviceWorker.registration.scope)));
  void serviceWorker.skipWaiting();
});

serviceWorker.addEventListener("activate", (event: ExtendableEvent): void => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.filter((cacheName) => cacheName !== CACHE_NAME).map((cacheName) => caches.delete(cacheName))),
      )
      .then(() => serviceWorker.clients.claim()),
  );
});

serviceWorker.addEventListener("fetch", (event: FetchEvent): void => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseForCache = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseForCache));
        return response;
      })
      .catch(async () => (await caches.match(event.request)) ?? (await caches.match(serviceWorker.registration.scope)) ?? Response.error()),
  );
});

serviceWorker.addEventListener("push", (event: PushEvent): void => {
  const receivedPayload: unknown = event.data?.json();

  if (!isNotificationPayload(receivedPayload)) {
    return;
  }

  const pushTasks: Promise<unknown>[] = [
    serviceWorker.registration.showNotification(receivedPayload.title, {
      body: receivedPayload.body,
      icon: `${serviceWorker.registration.scope}icon-192.png`,
      badge: `${serviceWorker.registration.scope}icon-192.png`,
      data: { url: receivedPayload.url ?? serviceWorker.registration.scope },
    }),
  ];
  const workerNavigator = serviceWorker.navigator as WorkerNavigator & WorkerNavigatorWithApplicationBadging;
  if (receivedPayload.badgeCount !== undefined && workerNavigator.setAppBadge) {
    pushTasks.push(workerNavigator.setAppBadge(receivedPayload.badgeCount));
  }
  event.waitUntil(Promise.all(pushTasks));
});

serviceWorker.addEventListener("notificationclick", (event: NotificationEvent): void => {
  event.notification.close();
  const notificationData: unknown = event.notification.data;
  const targetUrl =
    typeof notificationData === "object" &&
    notificationData !== null &&
    "url" in notificationData &&
    typeof notificationData.url === "string"
      ? notificationData.url
      : serviceWorker.registration.scope;

  event.waitUntil(
    serviceWorker.clients.matchAll({ includeUncontrolled: true, type: "window" }).then(async (windowClients) => {
      const openApplication = windowClients.find((client) => client.url.startsWith(serviceWorker.registration.scope));
      if (openApplication) {
        await openApplication.navigate(targetUrl);
        return openApplication.focus();
      }
      return serviceWorker.clients.openWindow(targetUrl);
    }),
  );
});
