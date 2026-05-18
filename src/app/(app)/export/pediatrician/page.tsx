/**
 * `/export/pediatrician` — HTML preview that mirrors the one-page PDF,
 * plus a date-range picker and a "Download PDF" link to
 * `/api/export/pediatrician`. Server component (CLAUDE.md §3): the
 * preview numbers come from the SHARED {@link getRangeSummary} (same
 * reducer as the dashboard and the PDF — they can never disagree).
 *
 * Mirrors the PDF exactly: NO caregiver attribution, NO mom data (the
 * range rollup carries neither). Tone is calm/informational; the footer
 * is the PDF's "Informational, not medical advice."
 */
import { redirect } from "next/navigation";

import { getRangeSummary } from "@/lib/day-summary";
import { getSessionAuthContext } from "@/lib/with-auth";

import { ExportControls } from "./ExportControls";

const DEFAULT_RANGE_DAYS = 7;

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

function longDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date(iso));
}

function statusLabel(total: number, low: number, high: number): string {
  if (total < low) return "below band";
  if (total > high) return "above band";
  return "within band";
}

type SearchParams = Promise<{ from?: string; to?: string }>;

export default async function PediatricianExportPage({ searchParams }: { searchParams: SearchParams }) {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const sp = await searchParams;
  const now = new Date();
  const to = parseDate(sp.to) ?? now;
  const from =
    parseDate(sp.from) ?? new Date(to.getTime() - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);

  const range = await getRangeSummary(auth.user_id, auth.household_id, from, to);
  if (!range) redirect("/onboarding");

  const timeZone = range.baby.timeZone;
  const fromYmd = ymd(from, timeZone);
  const toYmd = ymd(to, timeZone);
  const downloadHref = `/api/export/pediatrician?from=${fromYmd}&to=${toYmd}`;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <h1 className="mb-1 text-2xl text-foreground">Pediatrician summary</h1>
      <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
        A single page your pediatrician can read at a glance. No private mom
        notes are ever included.
      </p>

      <ExportControls fromYmd={fromYmd} toYmd={toYmd} downloadHref={downloadHref} />

      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
        <h2 className="text-base text-foreground">Feeding (per day)</h2>
        <div className="mt-3 space-y-2">
          {range.days.map((d) => (
            <div
              key={d.day_start}
              className="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 text-sm last:border-b-0 last:pb-0 dark:border-stone-900"
            >
              <span className="text-foreground">{longDate(d.day_start, timeZone)}</span>
              <span className="text-stone-600 dark:text-stone-400">
                {d.feeds.total_oz} oz (N {d.feeds.nursing_oz} · P {d.feeds.pumped_oz} · F{" "}
                {d.feeds.formula_oz}) · {statusLabel(d.feeds.total_oz, d.target.low_oz, d.target.high_oz)}
              </span>
            </div>
          ))}
        </div>

        <h2 className="mt-5 text-base text-foreground">Diapers (per day)</h2>
        <div className="mt-3 space-y-2">
          {range.days.map((d) => (
            <div
              key={d.day_start}
              className="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 text-sm last:border-b-0 last:pb-0 dark:border-stone-900"
            >
              <span className="text-foreground">{longDate(d.day_start, timeZone)}</span>
              <span className="text-stone-600 dark:text-stone-400">
                {d.diapers.pee_count} wet · {d.diapers.poop_count} dirty
              </span>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-8 border-t border-stone-200 pt-3 text-center text-xs text-stone-500 dark:border-stone-800">
        Informational, not medical advice.
      </p>
    </main>
  );
}
