/**
 * `DELETE /api/tokens/:id` (session) — revoke one of the caller's Siri
 * bearer tokens. `revokeApiToken` runs under the caller's RLS context,
 * so `api_tokens_self` confines the revoke to the caller's own tokens
 * (a caller cannot revoke another user's token even with its id). A
 * mutation → subject to the CSRF/Origin middleware.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { revokeApiToken } from "@/lib/api-token";
import { getSessionAuthContext } from "@/lib/with-auth";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const ctx = await getSessionAuthContext();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  }

  try {
    const revoked = await revokeApiToken(ctx.user_id, id);
    if (!revoked) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }
    console.info(
      JSON.stringify({
        event: "api_token_revoked",
        route: "/api/tokens/[id]",
        method: "DELETE",
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        token_id: id,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "api_token_revoke_failed",
        route: "/api/tokens/[id]",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "withUserContext must bind request.user_id so api_tokens_self matches the row; a 404 means the id is unknown, not the caller's, or already revoked.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "api_token_revoke_failed" },
      { status: 500 },
    );
  }
}
