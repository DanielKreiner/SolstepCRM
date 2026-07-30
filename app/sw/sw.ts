/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/*
 * Nur /m/* wird offlinefähig (CLAUDE.md Abschnitt 8). Das Backoffice
 * absichtlich nicht: dort arbeitet niemand ohne Netz, und ein veralteter
 * Cache auf einem Rechnungsscreen richtet mehr Schaden an als Nutzen.
 *
 * Der ServiceWorker cacht nur die App-Hülle. Die Buchungen selbst laufen
 * über die IndexedDB-Warteschlange in lib/offline/queue.ts — ein Cache
 * ersetzt keine Warteschlange.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
