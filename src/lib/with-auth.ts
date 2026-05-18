/**
 * Unified request authentication → AuthContext.
 *
 * Resolver order (route-handler path):
 *   1. Authorization: Bearer <tok>  — Siri/Watch (api_tokens),
 *                                     wired in Phase 2 Task 3
 *   2. Session cookie (PWA)         — the fallback
 *
 * Household is resolved under the user's own RLS context: once the
 * session yields a userId we open withUserContext(userId) and read
 * household_members. The membership policy returns exactly that user's
 * row, so no privilege escalation is needed.
 *
 * Bearer tokens carry their household directly (`api_tokens.household_id`,
 * resolved by {@link verifyApiToken}), so the bearer path needs no
 * membership lookup.
 */
import { eq } from "drizzle-orm";

import { verifyApiToken } from "./api-token";
import { householdMembers } from "./db/schema";
import { verifySessionToken, readSessionCookie } from "./session";
import { withUserContext } from "./with-user-context";

export type SourceChannel =
  | "pwa"
  | "siri_shortcut"
  | "apple_watch"
  | "web"
  | "health_bridge";

export type AuthContext = {
  user_id: string;
  household_id: string;
  source: SourceChannel;
  auth_method: "session" | "bearer";
};

async function resolveHousehold(userId: string): Promise<string | null> {
  return withUserContext(userId, async (tx) => {
    const [row] = await tx
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId))
      .limit(1);
    return row?.householdId ?? null;
  });
}

/**
 * Session-only auth resolution (no Request needed). Use from server
 * components / pages where there is no bearer path.
 */
export async function getSessionAuthContext(): Promise<AuthContext | null> {
  const rawToken = await readSessionCookie();
  if (!rawToken) return null;

  const session = await verifySessionToken(rawToken);
  if (!session) return null;

  const householdId = await resolveHousehold(session.userId);
  if (!householdId) return null;

  return {
    user_id: session.userId,
    household_id: householdId,
    source: "pwa",
    auth_method: "session",
  };
}

/**
 * Route-handler auth. Tries the bearer token first (Siri/Watch via
 * `api_tokens`), then falls back to the session cookie (PWA).
 *
 * A present-but-invalid bearer returns null (do NOT fall through to the
 * cookie — a Shortcut sending a dead token must get 401, not silently
 * pick up an unrelated browser session on a shared device).
 */
export async function withAuth(req: Request): Promise<AuthContext | null> {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const rawToken = authz.slice(authz.indexOf(" ") + 1).trim();
    if (!rawToken) return null;

    const resolved = await verifyApiToken(rawToken);
    if (!resolved) return null;

    return {
      user_id: resolved.user_id,
      household_id: resolved.household_id,
      source: "siri_shortcut",
      auth_method: "bearer",
    };
  }
  return getSessionAuthContext();
}
