"use client";

import { useEffect } from "react";

import { getPagesBasePath } from "@/lib/environment";

export function ServiceWorkerRegistration(): null {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const basePath = getPagesBasePath();
    const serviceWorkerPath = `${basePath}/service-worker.js`;
    const scope = `${basePath}/`;

    void navigator.serviceWorker.register(serviceWorkerPath, { scope, updateViaCache: "none" });
  }, []);

  return null;
}
