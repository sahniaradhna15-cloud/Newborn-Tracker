/**
 * Session + recovery-code primitives.
 *
 * Sessions are opaque random tokens; only sha256(token) is stored
 * (sessions table has no RLS — it is read to *resolve* identity before
 * any user context exists — but anon/authenticated are REVOKEd from it,
 * so it is never client-exposed; see migrations/0000_*.sql).
 *
 * Cookie spec is TECHNICAL_SPEC §4.2: name `nt_session`, HttpOnly,
 * Secure in prod, SameSite=Lax, host-only, 1-year Max-Age.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "./db/client";
import { sessions } from "./db/schema";

export const SESSION_COOKIE_NAME = "nt_session";
const ONE_YEAR_SECONDS = 31_536_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Inserts a session row and returns the RAW token (shown to the client
 * once, via the cookie). Only the hash is persisted. Caller sets the
 * cookie with {@link setSessionCookie}.
 */
export async function mintSession(
  userId: string,
  deviceLabel?: string,
): Promise<{ token: string; sessionId: string }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ONE_YEAR_SECONDS * 1000);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      deviceLabel: deviceLabel ?? null,
      expiresAt,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row.id };
}

/**
 * Resolves a raw cookie token to its user. Returns null if the token is
 * unknown, expired, or revoked. Does NOT resolve the household — that is
 * done by withAuth() under the user's RLS context.
 */
export async function verifySessionToken(
  rawToken: string,
): Promise<{ userId: string; sessionId: string } | null> {
  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, sha256(rawToken)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { userId: row.userId, sessionId: row.id };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/* ---- cookie helpers (Next.js App Router; cookies() is async in 15+) ---- */

export async function setSessionCookie(rawToken: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

/* ---- recovery codes (Crockford Base32, ~80 bits, shown once) ---- */

// Crockford Base32: no I, L, O, U (handwriting-confusable).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Returns a formatted code like `K3HM-7TPN-Q9XR-4FBC` (16 symbols). */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += CROCKFORD[bytes[i] % 32];
  }
  return out.replace(/(.{4})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4");
}

/** Strips hyphens/whitespace and uppercases so input is format-agnostic. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return sha256(normalizeRecoveryCode(code));
}
