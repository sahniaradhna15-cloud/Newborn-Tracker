/**
 * `/i/[token]` — invite-accept landing. No session: the visitor's
 * device has none yet. We resolve the invite via the `adminDb`
 * service-role conduit (no RLS context exists pre-session; admin.ts is
 * the only such conduit — does NOT add a third SUPABASE_SERVICE_ROLE_KEY
 * file, CLAUDE.md §3/§8).
 *
 * Two shapes:
 *   - target_user_id IS NULL  → "Welcome — your role is {name}. Join."
 *   - target_user_id IS NOT NULL → "Welcome back, {name}. Sign in here."
 *
 * Invalid / expired / used all collapse to ONE generic friendly card —
 * we never leak which case it was.
 */
import { createHash } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import { withAdmin } from "@/lib/db/admin";
import { invites } from "@/lib/db/schema";

import { AcceptInviteCard } from "./AcceptInviteCard";

type PageProps = { params: Promise<{ token: string }> };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export default async function InviteLandingPage({ params }: PageProps) {
  const { token } = await params;

  const invite =
    token && token.length >= 16
      ? await withAdmin(async (tx) => {
          const [row] = await tx
            .select({
              displayName: invites.displayName,
              role: invites.role,
              isPeerRecovery: invites.targetUserId,
            })
            .from(invites)
            .where(
              and(
                eq(invites.tokenHash, sha256(token)),
                isNull(invites.acceptedAt),
                gt(invites.expiresAt, new Date()),
              ),
            )
            .limit(1);
          return row ?? null;
        })
      : null;

  if (!invite) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-6 text-center dark:border-stone-800 dark:bg-stone-900">
          <h1 className="text-xl text-stone-900 dark:text-stone-100">
            This link can&apos;t be used
          </h1>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            It may have expired or already been used. Ask whoever sent it to
            share a fresh link.
          </p>
        </div>
      </main>
    );
  }

  const isPeerRecovery = invite.isPeerRecovery !== null;
  const displayName = invite.displayName ?? "there";

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-950">
        <div className="space-y-1.5">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
            Newborn Tracker
          </p>
          {isPeerRecovery ? (
            <>
              <h1 className="text-2xl text-stone-900 dark:text-stone-100">
                Welcome back, {displayName}
              </h1>
              <p className="text-sm text-stone-600 dark:text-stone-400">
                Tap below to sign in on this device. Your full history is here.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl text-stone-900 dark:text-stone-100">
                You&apos;re invited to help
              </h1>
              <p className="text-sm text-stone-600 dark:text-stone-400">
                You&apos;ll join as <strong>{displayName}</strong>. You can edit
                your name after joining.
              </p>
            </>
          )}
        </div>
        <AcceptInviteCard
          token={token}
          isPeerRecovery={isPeerRecovery}
        />
      </div>
    </main>
  );
}
