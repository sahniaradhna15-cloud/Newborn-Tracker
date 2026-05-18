/**
 * `GET /api/realtime-token` (session) — mints a SHORT-LIVED (5 min)
 * Supabase Realtime JWT scoped to the caller's household, so the browser
 * `RealtimeProvider` can open an authenticated Realtime socket WITHOUT
 * the server-only anon/service keys ever leaving the server.
 *
 * SECURITY (CLAUDE.md §3/§8/§13 — read before editing):
 *   - This route MUST NOT import or reference `SUPABASE_SERVICE_ROLE_KEY`.
 *     That key is capped at exactly two files (`src/lib/db/admin.ts`,
 *     `src/app/api/onboarding/create-household/route.ts`); a third
 *     reference is a P0 policy violation. The Realtime JWT is instead
 *     signed with the project's **Supabase JWT secret**
 *     (`SUPABASE_JWT_SECRET`) via `jose` (HS256) — the same secret
 *     Supabase itself uses to verify Realtime/PostgREST tokens. It is a
 *     DISTINCT secret from the service-role key.
 *   - Claims are the minimum Supabase Realtime needs to authorize a
 *     subscription: `{ role: "authenticated", sub: <user_id>,
 *     app_metadata: { household_id }, exp: now + 300 }`. No PII.
 *   - `Cache-Control: no-store` — a per-user, expiring credential must
 *     never be cached by a CDN/proxy/browser.
 *
 * If `SUPABASE_JWT_SECRET` is unset the route fails cleanly with a 500
 * and a structured-log `fix_suggestion` (CLAUDE.md §10.3) telling the
 * operator exactly where to find the value.
 */
import { NextResponse } from "next/server";
import { SignJWT } from "jose";

import { getSessionAuthContext } from "@/lib/with-auth";

const REALTIME_TOKEN_TTL_SECONDS = 300;

function noStore(json: Record<string, unknown>, status: number): NextResponse {
  const res = NextResponse.json(json, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET() {
  const ctx = await getSessionAuthContext();
  if (!ctx) {
    return noStore({ ok: false, error: "unauthorized" }, 401);
  }

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error(
      JSON.stringify({
        event: "realtime_token_failed",
        route: "/api/realtime-token",
        method: "GET",
        error: "SUPABASE_JWT_SECRET not set",
        user_id: ctx.user_id,
        fix_suggestion:
          "Set SUPABASE_JWT_SECRET in .env.local from Supabase dashboard → Project Settings → API → JWT Settings → JWT secret. It is DISTINCT from SUPABASE_SERVICE_ROLE_KEY and is only used to mint short-lived Realtime tokens.",
      }),
    );
    return noStore({ ok: false, error: "realtime_unconfigured" }, 500);
  }

  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      role: "authenticated",
      app_metadata: { household_id: ctx.household_id },
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(ctx.user_id)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + REALTIME_TOKEN_TTL_SECONDS)
      .sign(new TextEncoder().encode(secret));

    console.info(
      JSON.stringify({
        event: "realtime_token",
        route: "/api/realtime-token",
        method: "GET",
        status: "ok",
        user_id: ctx.user_id,
        household_id: ctx.household_id,
      }),
    );
    return noStore({ ok: true, token, expires_in: REALTIME_TOKEN_TTL_SECONDS }, 200);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "realtime_token_failed",
        route: "/api/realtime-token",
        method: "GET",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        fix_suggestion:
          "JWT signing failed. Confirm SUPABASE_JWT_SECRET is the raw Supabase JWT secret (not base64-wrapped) and `jose` is installed.",
      }),
    );
    return noStore({ ok: false, error: "realtime_token_failed" }, 500);
  }
}
