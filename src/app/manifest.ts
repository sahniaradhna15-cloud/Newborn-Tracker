/**
 * PWA web app manifest (Phase 3 Task 1). Next serves this at
 * `/manifest.webmanifest`; the root layout points to it.
 *
 * `theme_color` matches the committed `viewport.themeColor` (#0A3824) in
 * `layout.tsx` so the installed app's status bar and the in-browser address
 * bar agree. `background_color` is the splash behind the app before CSS
 * paints — kept light/calm. Icons are calm placeholders; a design refresh is
 * tracked as post-MVP (see README "Installing as an app").
 */
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Newborn Tracker",
    short_name: "Newborn",
    description:
      "Track your newborn's feeds, diapers, and weight — and know at a glance if today's intake is on target.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fefcf9",
    theme_color: "#0A3824",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
