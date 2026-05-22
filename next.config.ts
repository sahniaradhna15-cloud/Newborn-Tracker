import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  // Local dev only: lets a phone reach the dev server's client assets through
  // the Cloudflare quick-tunnel host. Safe to remove once we deploy.
  allowedDevOrigins: ["perceived-south-echo-her.trycloudflare.com"],
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The SW only complicates local dev (stale caches across HMR). It is built
  // and registered in production builds only; offline writes still work in
  // dev because the IndexedDB queue is independent of the SW.
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
