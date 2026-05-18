/**
 * `POST /api/tokens` (session) — mint a Siri bearer token for the
 * caller. Body `{ label? }`. Returns `{ id, token, label }` where
 * `token` is the RAW bearer, shown to the user EXACTLY ONCE (only its
 * sha256 is stored — CLAUDE.md §13). A normal cookie-authed fetch, so
 * it is subject to the CSRF/Origin middleware (not bearer-exempt).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { mintApiToken } from "@/lib/api-token";
import { getSessionAuthContext } from "@/lib/with-auth";

const Body = z.object({
  label: z.string().trim().min(1).max(60).optional(),
});

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const ctx = await getSessionAuthContext();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const label = parsed.data.label ?? null;
    const { id, token } = await mintApiToken(
      ctx.user_id,
      ctx.household_id,
      label,
    );
    console.info(
      JSON.stringify({
        event: "api_token_minted",
        route: "/api/tokens",
        method: "POST",
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        token_id: id,
        duration_ms: Date.now() - startedAt,
      }),
    );
    return NextResponse.json({ ok: true, id, token, label });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "api_token_mint_failed",
        route: "/api/tokens",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "withUserContext must bind request.user_id so api_tokens_self WITH CHECK passes; confirm the caller's user_id+household_id are valid FKs.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "api_token_mint_failed" },
      { status: 500 },
    );
  }
}
