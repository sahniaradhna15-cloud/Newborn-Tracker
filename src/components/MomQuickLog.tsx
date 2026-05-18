"use client";

/**
 * Postpartum mom quick-log (Phase 3 Task 4). Four calm cards — medication,
 * mood, note, pump-only — each posting through `submitOrQueue`, so an entry
 * logged with no signal is queued and replayed exactly like a feed/diaper
 * (Phase 3 Task 2). `pump_only` is mom-side data: it goes to `mom_events`,
 * never `feed_events`, so it never moves the baby's intake target.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitOrQueue } from "@/lib/offline-queue";

type MomKind = "medication" | "mood" | "note" | "pump_only";
type Side = "left" | "right" | "both";

const QUEUED_MESSAGE = "Saved offline — it'll sync when you're back online.";

const KINDS: { value: MomKind; label: string }[] = [
  { value: "medication", label: "Pain med" },
  { value: "mood", label: "Mood" },
  { value: "note", label: "Note" },
  { value: "pump_only", label: "Pump-only" },
];

function readSay(data: unknown): string {
  if (data && typeof data === "object" && "say" in data) {
    const say = (data as { say?: unknown }).say;
    if (typeof say === "string" && say.length > 0) return say;
  }
  return "Logged.";
}

export function MomQuickLog() {
  const router = useRouter();
  const [kind, setKind] = useState<MomKind | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // medication
  const [medName, setMedName] = useState("");
  const [medDose, setMedDose] = useState("");
  // mood
  const [moodScore, setMoodScore] = useState<number | null>(null);
  // note
  const [noteText, setNoteText] = useState("");
  // pump_only
  const [pumpMin, setPumpMin] = useState("");
  const [pumpOz, setPumpOz] = useState("");
  const [pumpSide, setPumpSide] = useState<Side | undefined>(undefined);
  // shared optional note for medication/mood
  const [extraNote, setExtraNote] = useState("");

  function reset() {
    setKind(null);
    setMedName("");
    setMedDose("");
    setMoodScore(null);
    setNoteText("");
    setPumpMin("");
    setPumpOz("");
    setPumpSide(undefined);
    setExtraNote("");
  }

  function buildPayload(): Record<string, unknown> | { error: string } {
    if (kind === "medication") {
      if (!medName.trim()) return { error: "Enter the medication name." };
      const payload: Record<string, unknown> = { name: medName.trim() };
      if (medDose.trim()) payload.dose_mg = Number(medDose);
      if (extraNote.trim()) payload.note = extraNote.trim();
      return payload;
    }
    if (kind === "mood") {
      if (moodScore === null) return { error: "Pick how you're feeling." };
      const payload: Record<string, unknown> = { score: moodScore };
      if (extraNote.trim()) payload.note = extraNote.trim();
      return payload;
    }
    if (kind === "note") {
      if (!noteText.trim()) return { error: "Write something first." };
      return { text: noteText.trim() };
    }
    // pump_only
    if (!pumpMin.trim()) return { error: "Enter pumping minutes." };
    const payload: Record<string, unknown> = { duration_min: Number(pumpMin) };
    if (pumpOz.trim()) payload.volume_oz = Number(pumpOz);
    if (pumpSide) payload.side = pumpSide;
    return payload;
  }

  async function submit() {
    if (!kind) return;
    const payload = buildPayload();
    if ("error" in payload) {
      toast.error(payload.error as string);
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await submitOrQueue("/api/mom-events", {
        client_uuid: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        kind,
        payload,
      });
      if (outcome.status === "failed") {
        toast.error("Couldn't save that. Check the fields and try again.");
        return;
      }
      toast.success(
        outcome.status === "sent" ? readSay(outcome.data) : QUEUED_MESSAGE,
      );
      reset();
      router.refresh();
    } catch {
      toast.error("Network hiccup — that wasn't saved. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md space-y-4 p-5">
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => (
          <Button
            key={k.value}
            type="button"
            variant={kind === k.value ? "default" : "outline"}
            className="h-14 text-base"
            onClick={() => setKind(kind === k.value ? null : k.value)}
          >
            {k.label}
          </Button>
        ))}
      </div>

      {kind === "medication" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="med-name">Medication</Label>
            <Input
              id="med-name"
              value={medName}
              maxLength={120}
              placeholder="Tylenol, ibuprofen, stool softener…"
              onChange={(e) => setMedName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-dose">Dose (mg, optional)</Label>
            <Input
              id="med-dose"
              type="number"
              inputMode="decimal"
              min={0}
              value={medDose}
              onChange={(e) => setMedDose(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {kind === "mood" ? (
        <div className="space-y-1.5">
          <Label>How are you feeling? (1 low – 5 good)</Label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                type="button"
                variant={moodScore === n ? "default" : "outline"}
                className="h-12 flex-1 text-base"
                onClick={() => setMoodScore(n)}
                aria-pressed={moodScore === n}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {kind === "note" ? (
        <div className="space-y-1.5">
          <Label htmlFor="mom-note">Note</Label>
          <textarea
            id="mom-note"
            value={noteText}
            maxLength={2000}
            rows={3}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onChange={(e) => setNoteText(e.target.value)}
          />
        </div>
      ) : null}

      {kind === "pump_only" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pump-min">Minutes</Label>
            <Input
              id="pump-min"
              type="number"
              inputMode="numeric"
              min={1}
              max={180}
              value={pumpMin}
              onChange={(e) => setPumpMin(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pump-oz">Volume (oz, optional)</Label>
            <Input
              id="pump-oz"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              value={pumpOz}
              onChange={(e) => setPumpOz(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Side (optional)</Label>
            <div className="flex gap-2">
              {(["left", "right", "both"] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={pumpSide === s ? "default" : "outline"}
                  className="flex-1 capitalize"
                  onClick={() =>
                    setPumpSide((cur) => (cur === s ? undefined : s))
                  }
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {kind === "medication" || kind === "mood" ? (
        <div className="space-y-1.5">
          <Label htmlFor="mom-extra-note">Note (optional)</Label>
          <Input
            id="mom-extra-note"
            value={extraNote}
            maxLength={500}
            onChange={(e) => setExtraNote(e.target.value)}
          />
        </div>
      ) : null}

      {kind ? (
        <Button
          type="button"
          className="w-full"
          disabled={submitting}
          onClick={submit}
        >
          {submitting ? "Saving…" : "Save"}
        </Button>
      ) : null}
    </Card>
  );
}
