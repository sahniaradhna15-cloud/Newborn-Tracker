"use client";

/**
 * DateNav — the dashboard's day selector. The dashboard is a Server Component
 * (CLAUDE.md §3 rule 3); this small client island only navigates by URL
 * (`/?date=YYYY-MM-DD`, or bare `/` for today) and lets the server re-render
 * the selected day's summary. No client-side data fetching, no cache.
 *
 * Calendar stepping is pure UTC date math so a ±1-day prev/next never trips on
 * a DST boundary — the server re-derives the real logical-day window from
 * whatever date lands in the URL.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** Shift a `YYYY-MM-DD` calendar date by whole days, with month/year rollover. */
function shiftCalendarDate(dateString: string, deltaDays: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const scratch = new Date(Date.UTC(year, month - 1, day));
  scratch.setUTCDate(scratch.getUTCDate() + deltaDays);
  return `${scratch.getUTCFullYear()}-${pad2(scratch.getUTCMonth() + 1)}-${pad2(scratch.getUTCDate())}`;
}

export function DateNav({
  label,
  selectedDate,
  todayDate,
}: {
  label: string;
  selectedDate: string;
  todayDate: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const isToday = selectedDate === todayDate;

  const goToDate = (next: string) => {
    router.push(next === todayDate ? "/" : `/?date=${next}`);
  };

  // Tapping the label opens the native picker. `showPicker` is the only
  // reliable cross-browser trigger (Safari/Firefox don't open on a text tap);
  // it throws if unsupported, so the overlaid focusable input is the fallback.
  const openPicker = () => {
    try {
      inputRef.current?.showPicker();
    } catch {
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => goToDate(shiftCalendarDate(selectedDate, -1))}
        className="grid size-8 shrink-0 place-items-center rounded-full text-foreground/55 transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <ChevronLeft className="size-5" />
      </button>

      <div className="relative">
        <span className="font-heading text-2xl leading-tight text-foreground sm:text-3xl">{label}</span>
        <input
          ref={inputRef}
          type="date"
          aria-label="Pick a date"
          value={selectedDate}
          onClick={openPicker}
          onChange={(event) => {
            if (event.target.value) goToDate(event.target.value);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <button
        type="button"
        aria-label="Next day"
        onClick={() => goToDate(shiftCalendarDate(selectedDate, 1))}
        className="grid size-8 shrink-0 place-items-center rounded-full text-foreground/55 transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <ChevronRight className="size-5" />
      </button>

      {!isToday ? (
        <button
          type="button"
          onClick={() => router.push("/")}
          className="ml-1 rounded-full bg-foreground/5 px-2.5 py-1 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          Today
        </button>
      ) : null}
    </div>
  );
}
