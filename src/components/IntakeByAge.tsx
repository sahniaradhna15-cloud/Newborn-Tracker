/**
 * IntakeByAge — a calm "what he needs by age vs. what he's actually getting"
 * reference for `/history`. A React **Server Component** (pure, no client JS).
 *
 * Each row is one week of life: the age-appropriate daily intake band (from
 * birth weight, NOT today's weight — see `intakeRangeForWeek`) next to his
 * average intake on the days that week he was actually logged.
 *
 * Tone (CLAUDE.md §11.3): never red, never the words "below"/"problem". A week
 * that reads a little under the band is shown gently and always paired with the
 * reminder that breast feeds are estimated low, so true intake is likely higher.
 */
const ML_PER_OZ = 29.5735;

export type IntakeByAgeRow = {
  weekOfAge: number;
  ageDays: number;
  lowOz: number;
  highOz: number;
  /** His average daily intake over the logged days that week; null if none logged. */
  avgOz: number | null;
  isCurrent: boolean;
  /** True for a week he hasn't reached yet (shown as a preview of what's next). */
  isUpcoming: boolean;
};

function fmtOz(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

/** Approx ml for parents who track in ml, rounded to the nearest 10. */
function fmtMl(oz: number): string {
  return `${Math.round((oz * ML_PER_OZ) / 10) * 10}`;
}

type Tone = "typical" | "under" | "plenty" | "none";

function toneFor(row: IntakeByAgeRow): Tone {
  if (row.avgOz === null) return "none";
  if (row.avgOz < row.lowOz) return "under";
  if (row.avgOz > row.highOz) return "plenty";
  return "typical";
}

const TONE_LABEL: Record<Tone, string> = {
  typical: "in the typical range",
  under: "a little under — breast feeds counted low, so likely higher",
  plenty: "plenty",
  none: "—",
};

export function IntakeByAge({ babyName, rows }: { babyName: string; rows: IntakeByAgeRow[] }) {
  return (
    <section
      aria-label="Intake by age"
      className="w-full rounded-lg bg-card p-5 text-card-foreground shadow-md ring-1 ring-black/5"
    >
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">By age</p>
      <p className="mt-1 text-sm text-card-foreground/60">
        Roughly how much {babyName} needs each day as he grows, next to what he&apos;s been getting.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-card-foreground/10 text-left text-xs text-card-foreground/55">
              <th className="py-2 pr-3 font-medium">Age</th>
              <th className="py-2 pr-3 font-medium">Needs / day</th>
              <th className="py-2 pr-3 font-medium">His average</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = toneFor(row);
              return (
                <tr
                  key={row.weekOfAge}
                  className={
                    row.isCurrent
                      ? "border-b border-card-foreground/5 bg-card-foreground/5"
                      : "border-b border-card-foreground/5"
                  }
                >
                  <td className="py-2 pr-3 whitespace-nowrap text-card-foreground/80">
                    {row.weekOfAge} {row.weekOfAge === 1 ? "week" : "weeks"}
                    {row.isCurrent ? <span className="ml-1.5 text-xs text-card-foreground/45">now</span> : null}
                    {row.isUpcoming ? <span className="ml-1.5 text-xs text-card-foreground/45">next</span> : null}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-card-foreground/80">
                    {fmtOz(row.lowOz)}–{fmtOz(row.highOz)} oz
                    <span className="ml-1 text-card-foreground/40">
                      ({fmtMl(row.lowOz)}–{fmtMl(row.highOz)} ml)
                    </span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                    {row.avgOz === null ? (
                      <span className="text-card-foreground/40">—</span>
                    ) : (
                      <span className="text-card-foreground">
                        {fmtOz(row.avgOz)} oz
                        <span className="ml-1 text-card-foreground/40">({fmtMl(row.avgOz)} ml)</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-xs">
                    {tone === "none" ? (
                      <span className="text-card-foreground/40">—</span>
                    ) : (
                      <span
                        className={
                          tone === "under"
                            ? "text-amber-700"
                            : "text-card-foreground/55"
                        }
                      >
                        {TONE_LABEL[tone]}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 border-t border-card-foreground/10 pt-3 text-xs text-card-foreground/55">
        General guidance only (~2–2½ oz per pound of body weight a day), based on his birth weight — not medical advice.
        Breast feeds use your own conservative estimate, so his real intake is likely a bit higher than shown. Call your
        pediatrician with any concerns.
      </p>
    </section>
  );
}
