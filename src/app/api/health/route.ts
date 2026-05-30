/**
 * `GET /api/health` — liveness + keep-warm probe (no auth, no PII).
 *
 * Two jobs:
 *  1. Liveness: a trivial `select 1` confirms the function can reach the
 *     Supabase pooler. Returns 200 `{ ok: true }` or 503 `{ ok: false }`.
 *  2. Keep-warm: Vercel's free tier idles the serverless function after a
 *     few minutes; the next request pays a cold start (function boot +
 *     fresh TLS to the pooler), which on cellular makes iOS Shortcuts give
 *     up with "network connection was lost" (-1005) even though the write
 *     often still completes server-side. An external uptime pinger hitting
 *     this route every ~5 min keeps the function AND the `app_runtime`
 *     connection pool warm, so the Siri write path stays sub-second. This
 *     intentionally touches the SAME runtime pool a real write uses
 *     (src/lib/db/client.ts) — warming a different connection would not
 *     help. `select 1` reads no RLS table, so no `withUserContext` GUC is
 *     needed.
 *
 * GET is not a mutating method, so proxy.ts's CSRF/Origin guard does not
 * apply. `force-dynamic` keeps it from being statically optimized — every
 * ping must actually execute and hit the DB to do its warming job.
 */
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: "up" });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "health_check_failed",
        route: "/api/health",
        error: error instanceof Error ? error.message : String(error),
        fix_suggestion:
          "select 1 on the app_runtime pool failed: check DATABASE_URL (pooled 6543, app_runtime role) and that the Supabase project is not paused.",
      }),
    );
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
