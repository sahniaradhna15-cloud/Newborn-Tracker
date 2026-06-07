/**
 * `/import` — backfill historical feeds & diapers from free-form notes.
 * Server component: it only gates the session; all parsing/writing happens in
 * `POST /api/import` through the canonical {@link recordEvent} write path. The
 * interactive paste/upload/preview lives in the {@link ImportConsole} island.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { ImportConsole } from "@/components/ImportConsole";
import { getSessionAuthContext } from "@/lib/with-auth";

export default async function ImportPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <Link
        href="/history"
        className="mb-4 inline-flex items-center text-sm text-foreground/70 transition-colors hover:text-foreground"
      >
        ← History
      </Link>
      <h1 className="mb-1 text-2xl text-foreground">Import past notes</h1>
      <p className="mb-6 text-sm text-foreground/60">
        Paste or upload your daily notes in whatever format you keep them — we’ll read the dates, amounts, diapers, and
        any other remarks and turn them into entries. You’ll see every day’s totals to review before anything is saved —
        and re-importing is always safe.
      </p>

      <ImportConsole />

      <p className="mt-8 border-t border-white/10 pt-3 text-xs text-foreground/55">
        To read free-form notes, the text you paste is sent to Google’s Gemini AI to interpret. Dates can be month names
        or numbers; amounts can be ml or oz. Nothing is saved until you review and press Import. Not medical advice.
      </p>
    </main>
  );
}
