"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitOrQueue } from "@/lib/offline-queue";

const QUEUED_MESSAGE = "Saved offline — it'll sync when you're back online.";

/** Pull the Siri-readable readout off a successful response, if present. */
function readSay(data: unknown): string {
  if (data && typeof data === "object" && "say" in data) {
    const say = (data as { say?: unknown }).say;
    if (typeof say === "string" && say.length > 0) {
      return say;
    }
  }
  return "Logged.";
}

export function DiaperForm() {
  const router = useRouter();
  const [pee, setPee] = useState(false);
  const [poop, setPoop] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!pee && !poop) {
      toast.error("Tap Wet, Dirty, or both first.");
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await submitOrQueue("/api/diapers", {
        client_uuid: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        pee,
        poop,
        note: note || undefined,
      });
      if (outcome.status === "failed") {
        toast.error("Couldn't log that diaper. Try again.");
        return;
      }
      toast.success(
        outcome.status === "sent" ? readSay(outcome.data) : QUEUED_MESSAGE,
      );
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Network hiccup — that diaper wasn't logged. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md space-y-5 p-6">
      <h1 className="text-2xl text-card-foreground">Log a diaper</h1>

      <div className="flex gap-3">
        <Button
          type="button"
          variant={pee ? "default" : "outline"}
          className="h-20 flex-1 text-lg"
          onClick={() => setPee((v) => !v)}
          aria-pressed={pee}
        >
          Wet
        </Button>
        <Button
          type="button"
          variant={poop ? "default" : "outline"}
          className="h-20 flex-1 text-lg"
          onClick={() => setPoop((v) => !v)}
          aria-pressed={poop}
        >
          Dirty
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Input
          id="note"
          type="text"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={submitting || (!pee && !poop)}
        onClick={submit}
      >
        {submitting ? "Logging…" : "Log diaper"}
      </Button>
    </Card>
  );
}
