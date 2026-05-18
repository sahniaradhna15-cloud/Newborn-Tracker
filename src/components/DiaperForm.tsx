"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      const res = await fetch("/api/diapers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({
          client_uuid: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          pee,
          poop,
          note: note || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error("Couldn't log that diaper. Try again.");
        return;
      }
      toast.success(data.say ?? "Logged.");
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
      <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-50">
        Log a diaper
      </h1>

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
