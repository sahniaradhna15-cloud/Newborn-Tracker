/**
 * TodayCard — the differentiator. A React **Server Component**: first paint
 * on mobile 4G must be a single round-trip (CLAUDE.md architecture rule 3),
 * so there is no "use client" and no client state here. Purely presentational
 * and props-driven; the page fetches the (selected day's) summary server-side
 * and passes it in.
 *
 * Layout: the TargetGauge answers "is he getting enough?" at the top, then two
 * parallel donuts — intake (breast vs formula) and diapers (wet vs dirty vs
 * wet + dirty) — give the day's composition. The donuts
 * (`IntakeDonut`/`DiaperDonut`) are the only "use client" leaves under this
 * server card.
 *
 * Never red, never alarmist (CLAUDE.md §11.3) — the dashboard is a quiet glance.
 */
import { DiaperDonut } from "@/components/DiaperDonut";
import { IntakeDonut } from "@/components/IntakeDonut";
import { TargetGauge } from "@/components/TargetGauge";
import type { DaySummary } from "@/lib/insights";

export function TodayCard({ summary }: { summary: DaySummary }) {
  const { feeds, diapers, target } = summary;

  return (
    <section
      aria-label="At a glance"
      className="w-full rounded-lg bg-card p-6 text-card-foreground shadow-md ring-1 ring-black/5"
    >
      <TargetGauge totalOz={feeds.total_oz} lowOz={target.low_oz} highOz={target.high_oz} />

      <div className="mt-6 grid grid-cols-1 gap-6 border-t border-card-foreground/10 pt-6 sm:grid-cols-2">
        <IntakeDonut
          feeds={{
            total_oz: feeds.total_oz,
            nursing_oz: feeds.nursing_oz,
            pumped_oz: feeds.pumped_oz,
            formula_oz: feeds.formula_oz,
          }}
        />
        <DiaperDonut
          diapers={{
            wet_only_count: diapers.wet_only_count,
            dirty_only_count: diapers.dirty_only_count,
            both_count: diapers.both_count,
            change_count: diapers.change_count,
          }}
        />
      </div>

      <TodayExplainer />

      <p className="mt-6 border-t border-card-foreground/10 pt-3 text-xs text-card-foreground/45">
        Not medical advice. Call your pediatrician if you&apos;re worried.
      </p>
    </section>
  );
}

/**
 * Collapsible plain-language explainer for the three things this card shows —
 * the target band, the intake donut, the diaper donut. Default-collapsed so
 * the dashboard stays a quiet glance for return visits; one-click open the
 * first time. Native `<details>` keeps TodayCard a server component (no JS
 * shipped just for the toggle). Tone follows CLAUDE.md §11.3 — calm,
 * factual, never the banned words.
 */
function TodayExplainer() {
  return (
    <details className="group mt-5 rounded-md bg-card-foreground/[0.04] px-4 py-3 text-sm text-card-foreground/75 open:bg-card-foreground/[0.06]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-card-foreground/85 [&::-webkit-details-marker]:hidden">
        <span>How do I read this?</span>
        <svg
          viewBox="0 0 12 12"
          className="size-3 shrink-0 text-card-foreground/55 transition-transform duration-200 group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </summary>
      <div className="mt-3 space-y-3 leading-relaxed">
        <p>
          <span className="font-medium text-card-foreground/90">The target band.</span> The shaded &ldquo;good
          range&rdquo; on the gauge at the top is a healthy daily intake estimate based on your baby&apos;s age and
          weight — roughly 2 to 2½ ounces per pound of body weight, with extra room for the first few weeks. It
          rises gently as he grows. Landing inside the band most days is the goal.
        </p>
        <p>
          <span className="font-medium text-card-foreground/90">Intake donut.</span> The big number in the middle is
          today&apos;s total ounces across all feeds. Breast milk (nursing + pumped) and formula are colored
          separately so the split reads at a glance. Nursing minutes get converted to ounces using a typical newborn
          rate — useful for trends, not exact.
        </p>
        <p>
          <span className="font-medium text-card-foreground/90">Diaper donut.</span> Every change is sorted into one
          of three slices — wet only, dirty only, or wet + dirty — so a combined diaper gets its own honest category
          instead of being double-counted. Healthy newborns usually have{" "}
          <span className="font-medium">6 or more wet diapers a day</span> once they&apos;re about a week old. Poop
          frequency varies a lot: many a day to one every few days is all normal, especially for breastfed babies.
        </p>
        <p>
          Look at the pattern over a few days rather than any single number. Anything that worries you, call your
          pediatrician — that&apos;s what they&apos;re there for.
        </p>
      </div>
    </details>
  );
}
