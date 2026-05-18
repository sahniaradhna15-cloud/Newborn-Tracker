/**
 * `/settings/voice` — Siri bearer tokens + Shortcut install deep links.
 * Server-rendered roster of the caller's tokens (label, last used,
 * status) with an interactive client island for Generate (modal shows
 * the raw token ONCE — CLAUDE.md §13) and Revoke. Mirrors the Task 2
 * settings convention (server page + client island, session-gated;
 * there is no shared (app) layout until Phase 2 Task 4).
 *
 * The six `shortcuts://import-shortcut/?url=…&name=…` deep links let the
 * user one-tap-import the hand-built Shortcuts. The iCloud share URLs
 * are filled in by the user AFTER they upload each built `.shortcut`
 * (see shortcuts/README.md). They live as a clearly-named placeholder
 * constant below — empty until the user pastes them.
 */
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { apiTokens } from "@/lib/db/schema";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

import { VoiceTokensPanel, type VoiceToken } from "./VoiceTokensPanel";

/**
 * The six hand-built Shortcuts (shortcuts/*.shortcut.md). `icloudUrl`
 * is the iCloud share link the user pastes AFTER uploading the built
 * `.shortcut` — left empty here on purpose; the import deep link is
 * only rendered once a URL is present. Keep these `name`s in sync with
 * shortcuts/README.md "The six Shortcuts" table.
 */
const SIRI_SHORTCUTS: ReadonlyArray<{ name: string; icloudUrl: string }> = [
  { name: "Log a pee", icloudUrl: "" },
  { name: "Log a poop", icloudUrl: "" },
  { name: "Log a dirty diaper", icloudUrl: "" },
  { name: "Log formula", icloudUrl: "" },
  { name: "Log pumped milk", icloudUrl: "" },
  { name: "Log nursing", icloudUrl: "" },
];

function buildImportDeepLink(icloudUrl: string, name: string): string {
  const params = new URLSearchParams({ url: icloudUrl, name });
  return `shortcuts://import-shortcut/?${params.toString()}`;
}

export default async function VoiceSettingsPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const tokens = await withUserContext(auth.user_id, async (tx) => {
    const rows = await tx
      .select({
        id: apiTokens.id,
        label: apiTokens.label,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, auth.user_id))
      .orderBy(desc(apiTokens.createdAt));

    return rows.map(
      (r): VoiceToken => ({
        id: r.id,
        label: r.label,
        last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        status: r.revokedAt ? "revoked" : "active",
        created_at: r.createdAt.toISOString(),
      }),
    );
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const shortcutLinks = SIRI_SHORTCUTS.map((s) => ({
    name: s.name,
    importUrl: s.icloudUrl ? buildImportDeepLink(s.icloudUrl, s.name) : null,
  }));

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl text-foreground">Siri voice</h1>
      <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
        Generate a token, paste it into your Shortcuts once, then say
        &ldquo;Hey Siri, log a pee.&rdquo; Revoking a token instantly
        stops every Shortcut using it.
      </p>
      <VoiceTokensPanel
        tokens={tokens}
        appUrl={appUrl}
        shortcutLinks={shortcutLinks}
      />
    </main>
  );
}
