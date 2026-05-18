/// <reference lib="webworker" />
/**
 * Serwist service worker entry (Phase 3 Task 1). Built to `public/sw.js`
 * by `withSerwist` at `pnpm build`; registered automatically by
 * `@serwist/next`.
 *
 * Cache policy (TECHNICAL_SPEC §6.4 — match order matters, first wins):
 *   1. Write/auth endpoints + the short-lived realtime token: NetworkOnly.
 *      The IndexedDB queue (offline-queue.ts) is the offline fallback for
 *      writes — never the SW. A cached realtime token would be stale.
 *   2. `/api/summary`: StaleWhileRevalidate — instant dashboard paint, then
 *      refreshes in the background.
 *   3. Static build assets + app icons: CacheFirst (content-hashed / stable).
 *   4. Everything else (HTML navigations, RSC payloads): NetworkFirst with a
 *      3s timeout so a flaky connection still falls back to the last good
 *      copy instead of hanging.
 *
 * skipWaiting + clientsClaim: a new SW activates without an explicit reload.
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const NETWORK_ONLY_PATHS = [
  "/api/events",
  "/api/feeds",
  "/api/diapers",
  "/api/weights",
  "/api/mom-events",
  "/api/voice",
  "/api/realtime-token",
  "/api/invites",
  "/api/recovery",
  "/api/recovery-code",
  "/api/access-links",
  "/api/caregivers",
  "/api/tokens",
  "/api/settings",
  "/api/onboarding",
];

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ url, sameOrigin }) =>
      sameOrigin &&
      NETWORK_ONLY_PATHS.some(
        (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
      ),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ url, sameOrigin }) =>
      sameOrigin && url.pathname === "/api/summary",
    handler: new StaleWhileRevalidate({ cacheName: "api-summary" }),
  },
  {
    matcher: ({ url, sameOrigin }) =>
      sameOrigin &&
      (url.pathname.startsWith("/_next/static/") ||
        url.pathname.startsWith("/icons/")),
    handler: new CacheFirst({ cacheName: "static-assets" }),
  },
  {
    matcher: ({ request, url, sameOrigin }) =>
      sameOrigin &&
      (request.mode === "navigate" ||
        request.destination === "document" ||
        request.headers.get("RSC") === "1") &&
      !url.pathname.startsWith("/api/"),
    handler: new NetworkFirst({
      cacheName: "pages",
      networkTimeoutSeconds: 3,
    }),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

serwist.addEventListeners();
