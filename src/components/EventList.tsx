"use client";

/**
 * EventList — the editable history list (Phase 2 Task 4). Events grouped
 * by logical day; each row shows the time, kind, the key fields, "logged
 * by <name>" and, when `event_audit` shows a later edit, "edited by
 * <name> Nh ago". Inline edit PATCHes `/api/feeds|diapers/[id]`; delete
 * confirms then DELETEs. Optimistic UI: the row updates/disappears
 * immediately and rolls back with a toast on failure, then a
 * `router.refresh()` re-pulls the authoritative server state (which also
 * propagates to other devices via Realtime — CLAUDE.md §3 rule 4).
 *
 * Attribution names come from the server (resolved from `event_audit` +
 * `household_members`); this client never queries names itself.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  groups: EventDayGroup[];
  timeZone: string;
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

function feedSummary(e: FeedEventRow): string {
  if (e.kind === "nursing") {
    const side = e.side ? ` ${e.side}` : "";
    return `Nursing${side} · ${e.duration_min ?? 0} min · ~${e.estimated_oz} oz`;
  }
  const label = e.kind === "pumped" ? "Pumped" : "Formula";
  return `${label} · ${e.volume_oz ?? e.estimated_oz} oz`;
}

function diaperSummary(e: DiaperEventRow): string {
  if (e.pee && e.poop) return "Wet + dirty";
  if (e.pee) return "Wet";
  return "Dirty";
}

export function EventList({ groups, timeZone }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Optimistically hidden rows (deleted) — re-shown on rollback.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

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

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
        No feeds or diapers logged in this range yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const visible = group.events.filter((e) => !hiddenIds.has(e.id));
        if (visible.length === 0) return null;
        return (
          <section key={group.day_start}>
            <h3 className="mb-2 font-mono text-xs font-medium uppercase tracking-[0.18em] text-foreground/55">
              {group.label}
            </h3>
            <ul className="space-y-2">
              {visible.map((e) => (
                <li
                  key={e.id}
                  className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="tabular-nums text-foreground/70">
                          {formatTime(e.occurred_at, timeZone)}
                        </span>{" "}
                        · {e.type === "feed" ? feedSummary(e) : diaperSummary(e)}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        logged by {e.logged_by_name}
                        {e.edited_by_name && e.edited_at
                          ? ` · edited by ${e.edited_by_name} ${hoursAgo(e.edited_at)}`
                          : ""}
                      </p>
                      {e.note ? (
                        <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{e.note}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId === e.id}
                        onClick={() => setEditingId(editingId === e.id ? null : e.id)}
                      >
                        {editingId === e.id ? "Close" : "Edit"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busyId === e.id}
                        onClick={() => remove(e)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {editingId === e.id ? (
                    <EditForm
                      event={e}
                      busy={busyId === e.id}
                      onSaved={() => {
                        setEditingId(null);
                        router.refresh();
                      }}
                      onBusyChange={(b) => setBusyId(b ? e.id : null)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
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
    <div className="mt-3 space-y-2 border-t border-stone-200 pt-3 dark:border-stone-800">
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
        <div className="flex gap-4 text-sm text-foreground">
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
