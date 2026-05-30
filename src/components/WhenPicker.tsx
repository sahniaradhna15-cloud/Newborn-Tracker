"use client";

/**
 * WhenPicker — an iOS-alarm-style scroll wheel for choosing when an event
 * happened, replacing the bare `datetime-local` box. Four scroll-snap columns
 * (Day · Hour · Minute · AM/PM) read the centered row as the selected value.
 *
 * Cross-browser (CLAUDE.md §6): pure CSS scroll-snap + `scrollTop` math, no
 * `scrollend` (Safari-late) and no pointer-capture drag. The browser's own
 * momentum scrolling drives it; we only read the settled position. Keyboard
 * users get ↑/↓ per column (role="spinbutton").
 *
 * Timezone: like the old input, columns are built and read in the browser's
 * local wall time, then emitted as an ISO instant — no behavior change versus
 * the `datetime-local` it replaces.
 *
 * @param value   current instant as an ISO 8601 string (mount-time seed only)
 * @param onChange called with a fresh ISO string each time a column settles
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const ITEM_HEIGHT = 36;
const VISIBLE_ROWS = 5;
const VIEWPORT_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
// Top/bottom spacer so the first and last real rows can scroll to the center.
const SPACER_HEIGHT = (VIEWPORT_HEIGHT - ITEM_HEIGHT) / 2;
const DAY_OPTION_COUNT = 30;

// useLayoutEffect warns under SSR; this client component still renders on the
// server, so fall back to useEffect there to keep the initial scroll flash-free
// without the warning.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type DayOption = { year: number; month: number; date: number; label: string };

type Selection = {
  dayIndex: number;
  hourIndex: number; // 0..11 → 1..12 o'clock
  minuteIndex: number; // 0..59
  meridiemIndex: number; // 0 = AM, 1 = PM
};

/** Recent calendar days, oldest first so "today" sits at the bottom of the wheel. */
function buildDayOptions(count: number): DayOption[] {
  const now = new Date();
  const labelFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
  const options: DayOption[] = [];
  for (let daysAgo = count - 1; daysAgo >= 0; daysAgo--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
    const label = daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : labelFmt.format(day);
    options.push({ year: day.getFullYear(), month: day.getMonth(), date: day.getDate(), label });
  }
  return options;
}

function decompose(iso: string, days: DayOption[]): Selection {
  const d = new Date(iso);
  const hours24 = d.getHours();
  const meridiemIndex = hours24 >= 12 ? 1 : 0;
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const dayIndex = days.findIndex((o) => o.year === d.getFullYear() && o.month === d.getMonth() && o.date === d.getDate());
  return {
    dayIndex: dayIndex < 0 ? days.length - 1 : dayIndex,
    hourIndex: hour12 - 1,
    minuteIndex: d.getMinutes(),
    meridiemIndex,
  };
}

function toHours24(hour12: number, meridiemIndex: number): number {
  if (meridiemIndex === 1) return hour12 === 12 ? 12 : hour12 + 12;
  return hour12 === 12 ? 0 : hour12;
}

function selectionToIso(sel: Selection, days: DayOption[]): string {
  const day = days[sel.dayIndex];
  const hours24 = toHours24(sel.hourIndex + 1, sel.meridiemIndex);
  return new Date(day.year, day.month, day.date, hours24, sel.minuteIndex, 0, 0).toISOString();
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(length - 1, value));
}

function WheelColumn({
  items,
  index,
  onIndexChange,
  ariaLabel,
  className,
}: {
  items: string[];
  index: number;
  onIndexChange: (next: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(index);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafId = useRef<number | null>(null);
  const didInit = useRef(false);
  // `active` tracks the centered row live (for the focus styling) without
  // pushing every scroll frame up to the parent; the parent only hears settled values.
  const [active, setActive] = useState(index);

  useEffect(() => {
    committedRef.current = index;
  }, [index]);

  useIsomorphicLayoutEffect(() => {
    const el = scrollRef.current;
    // Mount-only: seed the scroll position from the initial index.
    if (el && !didInit.current) {
      el.scrollTop = index * ITEM_HEIGHT;
      didInit.current = true;
    }
  }, [index]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    if (rafId.current == null) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const node = scrollRef.current;
        if (!node) return;
        setActive(clampIndex(Math.round(node.scrollTop / ITEM_HEIGHT), items.length));
      });
    }
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const node = scrollRef.current;
      if (!node) return;
      const next = clampIndex(Math.round(node.scrollTop / ITEM_HEIGHT), items.length);
      if (next !== committedRef.current) {
        committedRef.current = next;
        onIndexChange(next);
      }
    }, 140);
  }

  function scrollToIndex(next: number) {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: next * ITEM_HEIGHT, behavior: "smooth" });
    setActive(next);
    if (next !== committedRef.current) {
      committedRef.current = next;
      onIndexChange(next);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      scrollToIndex(clampIndex(active - 1, items.length));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      scrollToIndex(clampIndex(active + 1, items.length));
    }
  }

  return (
    <div
      ref={scrollRef}
      role="spinbutton"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuetext={items[active]}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      className={`h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain rounded-md outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-scrollbar]:hidden ${className ?? ""}`}
    >
      <div style={{ height: SPACER_HEIGHT }} aria-hidden="true" />
      {items.map((item, i) => {
        const distance = Math.abs(i - active);
        const opacity = distance === 0 ? 1 : distance === 1 ? 0.4 : 0.15;
        return (
          <div
            key={item}
            className="flex snap-center items-center justify-center tabular-nums transition-opacity duration-100"
            style={{ height: ITEM_HEIGHT, opacity }}
          >
            {item}
          </div>
        );
      })}
      <div style={{ height: SPACER_HEIGHT }} aria-hidden="true" />
    </div>
  );
}

const HOUR_ITEMS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTE_ITEMS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const MERIDIEM_ITEMS = ["AM", "PM"];

export function WhenPicker({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const days = useMemo(() => buildDayOptions(DAY_OPTION_COUNT), []);
  const dayLabels = useMemo(() => days.map((d) => d.label), [days]);
  const [selection, setSelection] = useState<Selection>(() => decompose(value, days));

  function update(patch: Partial<Selection>) {
    const next = { ...selection, ...patch };
    setSelection(next);
    onChange(selectionToIso(next, days));
  }

  return (
    <div className="relative select-none rounded-lg border border-card-foreground/10 bg-card-foreground/[0.02] px-1">
      {/* Centered selection band — sits behind the row text. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-2 z-0 rounded-md border-y border-card-foreground/15 bg-card-foreground/5"
        style={{ top: SPACER_HEIGHT, height: ITEM_HEIGHT }}
      />
      {/* Top/bottom fade for the iOS depth look. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 rounded-t-lg"
        style={{ height: SPACER_HEIGHT, background: "linear-gradient(to bottom, var(--card), transparent)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 rounded-b-lg"
        style={{ height: SPACER_HEIGHT, background: "linear-gradient(to top, var(--card), transparent)" }}
      />

      <div className="relative z-10 flex text-sm text-card-foreground" style={{ height: VIEWPORT_HEIGHT }}>
        <WheelColumn
          items={dayLabels}
          index={selection.dayIndex}
          onIndexChange={(i) => update({ dayIndex: i })}
          ariaLabel="Day"
          className="flex-[1.8]"
        />
        <WheelColumn
          items={HOUR_ITEMS}
          index={selection.hourIndex}
          onIndexChange={(i) => update({ hourIndex: i })}
          ariaLabel="Hour"
          className="flex-1"
        />
        <WheelColumn
          items={MINUTE_ITEMS}
          index={selection.minuteIndex}
          onIndexChange={(i) => update({ minuteIndex: i })}
          ariaLabel="Minute"
          className="flex-1"
        />
        <WheelColumn
          items={MERIDIEM_ITEMS}
          index={selection.meridiemIndex}
          onIndexChange={(i) => update({ meridiemIndex: i })}
          ariaLabel="AM or PM"
          className="flex-1"
        />
      </div>
    </div>
  );
}
