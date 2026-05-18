/**
 * Unified request authentication → AuthContext.
 *
 * Resolver order:
 *   1. Session cookie (PWA)         — implemented here
 *   2. Authorization: Bearer <tok>  — Siri/Watch; STUB in Phase 1,
 *                                     wired in Phase 2 Task 2 (api_tokens)
 *
 * Household is resolved under the user's own RLS context: once the
 * session yields a userId we open withUserContext(userId) and read
 * household_members. The membership policy returns exactly that user's
 * row, so no privilege escalation is needed.
 */
import { eq } from "drizzle-orm";

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
 * Route-handler auth. Tries bearer first (Siri/Watch — STUB in Phase 1,
 * wired in Phase 2 Task 2), then the session cookie.
 */
export async function withAuth(req: Request): Promise<AuthContext | null> {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return getSessionAuthContext();
}
