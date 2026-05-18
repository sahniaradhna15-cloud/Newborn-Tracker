"use client";

/**
 * The caller's own postpartum history (Phase 3 Task 4). Server-filtered by
 * the `mom_events_self` RLS policy — this only ever receives the author's
 * rows. Delete is available on every kind; inline edit is offered for the
 * two free-form kinds the DoD names (note text, mood score). Edits/deletes
 * are online-only (history maintenance is out of the offline-queue scope).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export type MomEventRow = {
  id: string;
  kind: "medication" | "mood" | "note" | "pump_only";
  payload: Record<string, unknown> | null;
  occurred_at: string;
};

const MUTATION_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "fetch",
};

function pick(payload: Record<string, unknown> | null, key: string): unknown {
  return payload ? payload[key] : undefined;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarize(row: MomEventRow): string {
  const p = row.payload;
  if (row.kind === "medication") {
    const dose = numeric(pick(p, "dose_mg"));
    return `Medication · ${str(pick(p, "name")) ?? "—"}${dose !== null ? ` ${dose} mg` : ""}`;
  }
  if (row.kind === "mood") {
    return `Mood · ${numeric(pick(p, "score")) ?? "—"}/5`;
  }
  if (row.kind === "note") {
    return str(pick(p, "text")) ?? "Note";
  }
  const min = numeric(pick(p, "duration_min"));
  const oz = numeric(pick(p, "volume_oz"));
  const side = str(pick(p, "side"));
  return `Pump-only · ${min ?? "—"} min${oz !== null ? ` · ${oz} oz` : ""}${side ? ` · ${side}` : ""}`;
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}
function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function MomEventList({ events }: { events: MomEventRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");

  async function patchPayload(row: MomEventRow, payload: Record<string, unknown>) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/mom-events/${row.id}`, {
        method: "PATCH",
        headers: MUTATION_HEADERS,
        body: JSON.stringify({ payload }),
      });
      if (!res.ok) {
        toast.error("Couldn't update that. Try again.");
        return;
      }
      toast.success("Updated.");
      setEditingId(null);
      router.refresh();
    } catch {
      toast.error("Network hiccup — not updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: MomEventRow) {
    if (!window.confirm("Delete this entry?")) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/mom-events/${row.id}`, {
        method: "DELETE",
        headers: MUTATION_HEADERS,
      });
      if (!res.ok && res.status !== 204) {
        toast.error("Couldn't delete that. Try again.");
        return;
      }
      toast.success("Deleted.");
      router.refresh();
    } catch {
      toast.error("Network hiccup — not deleted.");
    } finally {
      setBusyId(null);
    }
  }

  if (events.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-foreground/60">
        Nothing logged in the last 30 days.
      </p>
    );
  }

  const groups: { label: string; rows: MomEventRow[] }[] = [];
  for (const row of events) {
    const label = dayLabel(row.occurred_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div className="w-full max-w-md space-y-5">
      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-foreground/55">
            {group.label}
          </p>
          {group.rows.map((row) => (
            <div
              key={row.id}
              className="rounded-lg bg-card p-3 text-sm shadow-sm ring-1 ring-black/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-foreground/60">{timeLabel(row.occurred_at)}</p>
                  <p className="mt-0.5 break-words text-card-foreground">
                    {summarize(row)}
                  </p>
                  {str(pick(row.payload, "note")) ? (
                    <p className="mt-0.5 text-foreground/60">
                      {str(pick(row.payload, "note"))}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {row.kind === "note" || row.kind === "mood" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setEditingId(editingId === row.id ? null : row.id);
                        setDraftText(
                          row.kind === "note"
                            ? (str(pick(row.payload, "text")) ?? "")
                            : "",
                        );
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 px-2 text-xs"
                    disabled={busyId === row.id}
                    onClick={() => remove(row)}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {editingId === row.id && row.kind === "note" ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={draftText}
                    rows={3}
                    maxLength={2000}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onChange={(e) => setDraftText(e.target.value)}
                  />
                  <Button
                    type="button"
                    className="h-8 text-xs"
                    disabled={busyId === row.id || !draftText.trim()}
                    onClick={() => patchPayload(row, { text: draftText.trim() })}
                  >
                    Save
                  </Button>
                </div>
              ) : null}

              {editingId === row.id && row.kind === "mood" ? (
                <div className="mt-3 flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant="outline"
                      className="h-9 flex-1 text-xs"
                      disabled={busyId === row.id}
                      onClick={() => {
                        const prevNote = str(pick(row.payload, "note"));
                        patchPayload(
                          row,
                          prevNote ? { score: n, note: prevNote } : { score: n },
                        );
                      }}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
