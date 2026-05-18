/**
 * API token (Siri bearer) primitives — TECHNICAL_SPEC §4.4, CLAUDE.md §13.
 *
 * A Shortcut cannot refresh an OAuth token, so the bearer is a long-lived
 * opaque secret: 32 random bytes, base64url, shown to the user EXACTLY
 * ONCE at mint time. Only `sha256(token)` is persisted in
 * `api_tokens.token_hash`; the raw value is never stored or logged.
 *
 * --- Why the resolver runs through `withAdmin` (not the app conn) ----
 * `api_tokens` has RLS ENABLEd with `api_tokens_self`
 * (`user_id = current_user_id()`). `verifyApiToken` runs PRE-SESSION —
 * it is resolving identity from the bearer, so there is no
 * `request.user_id` GUC yet and a plain `app_runtime` query would be
 * filtered to zero rows (chicken-and-egg, identical to the recovery-code
 * redeem path). The accepted codebase pattern for a no-session
 * RLS-table touch is the `adminDb` service-role conduit — exactly as
 * `/api/recovery/redeem` and `/api/invites/[token]/accept` do (Phase 2
 * Task 2). This does NOT add a third `SUPABASE_SERVICE_ROLE_KEY` file:
 * `admin.ts` connects via `DATABASE_URL_ADMIN` and is the single conduit
 * (CLAUDE.md §3/§8). `mintApiToken` / `revokeApiToken` are called from
 * session-authed routes and so run under the caller's RLS context.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { withAdmin } from "./db/admin";
import { apiTokens } from "./db/schema";
import { withUserContext } from "./with-user-context";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Mints an API token for a user+household. Runs under the caller's RLS
 * context (the route that calls this is session-authed). Returns the RAW
 * token EXACTLY ONCE — only its sha256 is persisted (CLAUDE.md §13).
 *
 * @param userId      the owning user (the session caller)
 * @param householdId the household the token logs into
 * @param label       a human label shown in /settings/voice (e.g. "iPhone")
 * @returns `{ id, token }` — `token` is the raw bearer, shown once
 */
export async function mintApiToken(
  userId: string,
  householdId: string,
  label: string | null,
): Promise<{ id: string; token: string }> {
  const token = randomToken();
  const [row] = await withUserContext(userId, async (tx) =>
    tx
      .insert(apiTokens)
      .values({
        userId,
        householdId,
        tokenHash: sha256(token),
        label: label ?? null,
      })
      .returning({ id: apiTokens.id }),
  );
  return { id: row.id, token };
}

/**
 * Resolves a raw bearer token to its owner. Returns null if the token is
 * unknown or revoked. Opportunistically bumps `last_used_at` in the same
 * transaction. Runs through the `adminDb` conduit because it executes
 * pre-session (see file header). The lookup is by the UNIQUE
 * `token_hash` index — never by the raw value.
 *
 * @param rawBearer the raw token from `Authorization: Bearer <tok>`
 * @returns `{ user_id, household_id }` on a live token, else null
 */
export async function verifyApiToken(
  rawBearer: string,
): Promise<{ user_id: string; household_id: string } | null> {
  const tokenHash = sha256(rawBearer);
  return withAdmin(async (tx) => {
    const [row] = await tx
      .select({
        id: apiTokens.id,
        userId: apiTokens.userId,
        householdId: apiTokens.householdId,
      })
      .from(apiTokens)
      .where(
        and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)),
      )
      .limit(1);
    if (!row) return null;

    await tx
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, row.id));

    return { user_id: row.userId, household_id: row.householdId };
  });
}

/**
 * Revokes a token (sets `revoked_at`). Runs under the caller's RLS
 * context: `api_tokens_self` confines the UPDATE to the caller's own
 * tokens, so a caller cannot revoke another user's token even by id.
 *
 * @param userId  the session caller (RLS scope)
 * @param tokenId the token row id to revoke
 * @returns `true` if a row was revoked, `false` if none matched (unknown
 *          id, not the caller's, or already revoked)
 */
export async function revokeApiToken(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  return withUserContext(userId, async (tx) => {
    const revoked = await tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });
    return revoked.length > 0;
  });
}
