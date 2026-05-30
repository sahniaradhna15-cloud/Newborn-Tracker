"use client";

/**
 * EventList — the editable, one-day-at-a-time history log. The server loads a
 * single logical day (driven by the `?date` param); a date scanner here
 * (◀ / calendar / ▶ / Today) moves to any other day on demand, so the list is
 * never a wall of every day at once. Each row shows the time, a colour-coded
 * type icon (the SAME colours the dashboard donuts use), the value as a chip,
 * and "logged by <name>" + "edited by <name> Nh ago" when audited.
 *
 * Colours: rows live on the cream `--card` surface, so text uses
 * `text-card-foreground` (deep green) — NOT `text-foreground` (white, for the
 * green page ground). The scanner sits on the page ground and stays white.
 *
 * Two delete paths: a per-row trash button, and a "Select" mode with a checkbox
 * per row and a delete bar on top for clearing several. Both are optimistic
 * (rows vanish immediately, roll back with a toast on failure) and then
 * `router.refresh()` re-pulls authoritative state (also fans out to other
 * devices via Realtime, §3 rule 4). Bulk delete reuses the per-id
 * `DELETE /api/feeds|diapers/[id]` routes — no new endpoint.
 */
import { Baby, Check, ChevronLeft, ChevronRight, Droplet, Droplets, Milk, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Colour-coded to match the dashboard donuts so a feed/diaper reads the same
// on the timeline as it does in the at-a-glance rings.
const NURSING_COLOR = "var(--chart-2)";
const PUMPED_COLOR = "var(--chart-4)";
const FORMULA_COLOR = "var(--chart-3)";
const WET_COLOR = "var(--chart-4)";
const DIRTY_COLOR = "var(--chart-1)";
const BOTH_COLOR = "var(--chart-3)";

type EventVisual = { color: string; title: string; Icon: typeof Baby; chips: string[] };

export type FeedEventRow = {
  type: "feed";
  id: string;
  occurred_at: string;
  kind: "nursing" | "pumped" | "formula";
  side: "left" | "right" | "both" | null;
  duration_min: number | null;
  volume_oz: number | null;
  estimated_oz: number;
  note: string | null;
  logged_by_name: string;
  edited_by_name: string | null;
  edited_at: string | null;
};

export type DiaperEventRow = {
  type: "diaper";
  id: string;
  occurred_at: string;
  pee: boolean;
  poop: boolean;
  note: string | null;
  logged_by_name: string;
  edited_by_name: string | null;
  edited_at: string | null;
};

export type EventRow = FeedEventRow | DiaperEventRow;

export type EventDayGroup = {
  /** `day_start` ISO of the logical day (stable key). */
  day_start: string;
  label: string;
  events: EventRow[];
};

type Props = {
  /** The one logical day the server loaded. */
  group: EventDayGroup;
  timeZone: string;
  /** Selected logical day as `YYYY-MM-DD` (drives the scanner + `?date`). */
  selectedDate: string;
  /** Today's logical day as `YYYY-MM-DD` (caps the scanner at the present). */
  todayDate: string;
};

const JSON_FETCH = {
  headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
} as const;

function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

function hoursAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** Shift a `YYYY-MM-DD` date by whole days in UTC, so prev/next never trip DST. */
function shiftCalendarDate(dateString: string, deltaDays: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const scratch = new Date(Date.UTC(year, month - 1, day));
  scratch.setUTCDate(scratch.getUTCDate() + deltaDays);
  return `${scratch.getUTCFullYear()}-${pad2(scratch.getUTCMonth() + 1)}-${pad2(scratch.getUTCDate())}`;
}

function eventVisual(e: EventRow): EventVisual {
  if (e.type === "feed") {
    if (e.kind === "nursing") {
      return {
        color: NURSING_COLOR,
        title: e.side ? `Nursing · ${e.side}` : "Nursing",
        Icon: Baby,
        chips: [`${e.duration_min ?? 0} min`, `~${e.estimated_oz} oz`],
      };
    }
    if (e.kind === "pumped") {
      return { color: PUMPED_COLOR, title: "Pumped", Icon: Droplets, chips: [`${e.volume_oz ?? e.estimated_oz} oz`] };
    }
    return { color: FORMULA_COLOR, title: "Formula", Icon: Milk, chips: [`${e.volume_oz ?? e.estimated_oz} oz`] };
  }
  if (e.pee && e.poop) return { color: BOTH_COLOR, title: "Wet + dirty", Icon: Droplet, chips: [] };
  if (e.pee) return { color: WET_COLOR, title: "Wet", Icon: Droplet, chips: [] };
  return { color: DIRTY_COLOR, title: "Dirty", Icon: Droplet, chips: [] };
}

export function EventList({ group, timeZone, selectedDate, todayDate }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Optimistically hidden rows (deleted) — re-shown on rollback.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const isToday = selectedDate === todayDate;

  const eventById = useMemo(() => {
    const map = new Map<string, EventRow>();
    for (const e of group.events) map.set(e.id, e);
    return map;
  }, [group.events]);

  const visibleEvents = group.events.filter((e) => !hiddenIds.has(e.id));

  function goToDate(next: string) {
    router.push(next === todayDate ? "/history" : `/history?date=${next}`);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visibleEvents.map((e) => e.id)));
  }

  async function remove(e: EventRow) {
    if (!confirm("Delete this entry? This can't be undone.")) return;
    setBusyId(e.id);
    setHiddenIds((prev) => new Set(prev).add(e.id));
    try {
      const path = e.type === "feed" ? `/api/feeds/${e.id}` : `/api/diapers/${e.id}`;
      const res = await fetch(path, { ...JSON_FETCH, method: "DELETE" });
      if (res.status !== 204 && !res.ok) {
        throw new Error("delete_failed");
      }
      toast.success("Entry deleted.");
      router.refresh();
    } catch {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(e.id);
        return next;
      });
      toast.error("Couldn't delete that entry.");
    } finally {
      setBusyId(null);
    }
  }

  async function bulkRemove() {
    const ids = [...selectedIds].filter((id) => eventById.has(id) && !hiddenIds.has(id));
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? "entry" : "entries";
    if (!confirm(`Delete ${ids.length} ${noun}? This can't be undone.`)) return;
    setBulkBusy(true);
    setHiddenIds((prev) => new Set([...prev, ...ids]));
    try {
      const outcomes = await Promise.all(
        ids.map(async (id) => {
          const ev = eventById.get(id)!;
          const path = ev.type === "feed" ? `/api/feeds/${id}` : `/api/diapers/${id}`;
          try {
            const res = await fetch(path, { ...JSON_FETCH, method: "DELETE" });
            if (res.status !== 204 && !res.ok) throw new Error();
            return { id, ok: true };
          } catch {
            return { id, ok: false };
          }
        }),
      );
      const failed = outcomes.filter((o) => !o.ok).map((o) => o.id);
      if (failed.length) {
        setHiddenIds((prev) => {
          const next = new Set(prev);
          failed.forEach((id) => next.delete(id));
          return next;
        });
        toast.error(
          failed.length === ids.length
            ? "Couldn't delete those entries."
            : `Deleted ${ids.length - failed.length} — ${failed.length} couldn't be removed.`,
        );
      } else {
        toast.success(`Deleted ${ids.length} ${noun}.`);
      }
      exitSelectMode();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Date scanner — on the page ground, so text stays white. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => goToDate(shiftCalendarDate(selectedDate, -1))}
            className="grid size-8 shrink-0 place-items-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </button>

          <div className="relative">
            <span className="text-sm font-medium text-foreground">{group.label}</span>
            <input
              type="date"
              aria-label="Pick a date"
              value={selectedDate}
              max={todayDate}
              onChange={(event) => {
                if (event.target.value) goToDate(event.target.value);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          <button
            type="button"
            aria-label="Next day"
            disabled={isToday}
            onClick={() => goToDate(shiftCalendarDate(selectedDate, 1))}
            className={
              isToday
                ? "grid size-8 shrink-0 place-items-center rounded-full text-foreground/20"
                : "grid size-8 shrink-0 place-items-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
            }
          >
            <ChevronRight className="size-5" />
          </button>

          {!isToday ? (
            <button
              type="button"
              onClick={() => router.push("/history")}
              className="ml-1 rounded-full bg-foreground/10 px-2.5 py-1 text-xs font-medium text-foreground/80 transition-colors hover:text-foreground"
            >
              Today
            </button>
          ) : null}
        </div>

        {visibleEvents.length > 0 && !selectMode ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelectMode(true)}>
            <Check />
            Select
          </Button>
        ) : null}
      </div>

      {selectMode ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-card-foreground shadow-sm ring-1 ring-black/5">
          <span className="text-sm tabular-nums text-card-foreground/70">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={selectAllVisible}>
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={exitSelectMode}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={bulkRemove}
            >
              <Trash2 />
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      {visibleEvents.length === 0 ? (
        <p className="rounded-xl bg-card p-4 text-sm text-card-foreground/60 shadow-sm ring-1 ring-black/5">
          Nothing logged on this day.
        </p>
      ) : (
        <ul className="divide-y divide-card-foreground/10 overflow-hidden rounded-2xl bg-card text-card-foreground shadow-sm ring-1 ring-black/5">
          {visibleEvents.map((e) => {
            const v = eventVisual(e);
            const isEditing = editingId === e.id;
            const isSelected = selectedIds.has(e.id);
            return (
              <li key={e.id} className={isSelected ? "bg-card-foreground/[0.05]" : undefined}>
                <div
                  className={`flex items-start gap-3 p-3.5 ${selectMode ? "cursor-pointer" : ""}`}
                  onClick={selectMode ? () => toggleSelect(e.id) : undefined}
                  role={selectMode ? "checkbox" : undefined}
                  aria-checked={selectMode ? isSelected : undefined}
                >
                  {selectMode ? (
                    <span
                      className={`mt-1 grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${
                        isSelected
                          ? "border-card-foreground bg-card-foreground text-card"
                          : "border-card-foreground/30"
                      }`}
                      aria-hidden="true"
                    >
                      {isSelected ? <Check className="size-3.5" /> : null}
                    </span>
                  ) : null}

                  <div className="w-12 shrink-0 pt-0.5 text-right text-xs leading-tight tabular-nums text-card-foreground/55">
                    {formatTime(e.occurred_at, timeZone)}
                  </div>

                  <div
                    className="grid size-9 shrink-0 place-items-center rounded-full"
                    style={{ backgroundColor: `color-mix(in oklch, ${v.color} 22%, transparent)`, color: v.color }}
                    aria-hidden="true"
                  >
                    <v.Icon className="size-[1.1rem]" />
                  </div>

                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-card-foreground">{v.title}</p>
                      <p className="mt-0.5 text-xs text-card-foreground/55">
                        logged by {e.logged_by_name}
                        {e.edited_by_name && e.edited_at
                          ? ` · edited by ${e.edited_by_name} ${hoursAgo(e.edited_at)}`
                          : ""}
                      </p>
                      {e.note ? <p className="mt-1 text-xs text-card-foreground/75">{e.note}</p> : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {v.chips.length ? (
                        <div className="flex flex-wrap justify-end gap-1">
                          {v.chips.map((chip) => (
                            <span
                              key={chip}
                              className="rounded-full bg-card-foreground/8 px-2 py-0.5 text-xs font-medium tabular-nums text-card-foreground/80"
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {!selectMode ? (
                        <div className="flex gap-0.5">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="text-card-foreground/60"
                            aria-label={isEditing ? "Close editor" : "Edit entry"}
                            disabled={busyId === e.id}
                            onClick={() => setEditingId(isEditing ? null : e.id)}
                          >
                            {isEditing ? <X /> : <Pencil />}
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Delete entry"
                            className="text-card-foreground/55 hover:text-destructive"
                            disabled={busyId === e.id}
                            onClick={() => remove(e)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                {!selectMode && isEditing ? (
                  <div className="px-3.5 pb-3.5">
                    <EditForm
                      event={e}
                      busy={busyId === e.id}
                      onSaved={() => {
                        setEditingId(null);
                        router.refresh();
                      }}
                      onBusyChange={(b) => setBusyId(b ? e.id : null)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EditForm({
  event,
  busy,
  onSaved,
  onBusyChange,
}: {
  event: EventRow;
  busy: boolean;
  onSaved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [note, setNote] = useState(event.note ?? "");
  const [durationMin, setDurationMin] = useState(
    event.type === "feed" && event.kind === "nursing" ? String(event.duration_min ?? "") : "",
  );
  const [volumeOz, setVolumeOz] = useState(
    event.type === "feed" && event.kind !== "nursing" ? String(event.volume_oz ?? "") : "",
  );
  const [pee, setPee] = useState(event.type === "diaper" ? event.pee : false);
  const [poop, setPoop] = useState(event.type === "diaper" ? event.poop : false);

  async function save() {
    onBusyChange(true);
    try {
      const path = event.type === "feed" ? `/api/feeds/${event.id}` : `/api/diapers/${event.id}`;
      const body: Record<string, unknown> = { note: note.trim() === "" ? null : note.trim() };
      if (event.type === "feed") {
        if (event.kind === "nursing" && durationMin.trim() !== "") body.duration_min = Number(durationMin);
        if (event.kind !== "nursing" && volumeOz.trim() !== "") body.volume_oz = Number(volumeOz);
      } else {
        if (!pee && !poop) {
          toast.error("A diaper must be wet, dirty, or both.");
          return;
        }
        body.pee = pee;
        body.poop = poop;
      }
      const res = await fetch(path, { ...JSON_FETCH, method: "PATCH", body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error("Couldn't save that change.");
        return;
      }
      toast.success("Saved.");
      onSaved();
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-card-foreground/10 pt-3 text-card-foreground">
      {event.type === "feed" && event.kind === "nursing" ? (
        <Input
          inputMode="numeric"
          placeholder="Duration (min)"
          value={durationMin}
          onChange={(ev) => setDurationMin(ev.target.value)}
        />
      ) : null}
      {event.type === "feed" && event.kind !== "nursing" ? (
        <Input
          inputMode="decimal"
          placeholder="Volume (oz)"
          value={volumeOz}
          onChange={(ev) => setVolumeOz(ev.target.value)}
        />
      ) : null}
      {event.type === "diaper" ? (
        <div className="flex gap-4 text-sm text-card-foreground">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={pee} onChange={(ev) => setPee(ev.target.checked)} />
            Wet
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={poop} onChange={(ev) => setPoop(ev.target.checked)} />
            Dirty
          </label>
        </div>
      ) : null}
      <Input placeholder="Note (optional)" value={note} onChange={(ev) => setNote(ev.target.value)} />
      <Button type="button" size="sm" disabled={busy} onClick={save}>
        Save changes
      </Button>
    </div>
  );
}
