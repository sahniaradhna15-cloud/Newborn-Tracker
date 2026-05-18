"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { submitOrQueue } from "@/lib/offline-queue";
import { FeedInput } from "@/lib/voice-parser";

type FeedKind = "nursing" | "pumped" | "formula";
type FeedSide = "left" | "right" | "both";
type FormIn = z.input<typeof FeedInput>;
type FormOut = z.output<typeof FeedInput>;

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

/** datetime-local <input> wants "YYYY-MM-DDTHH:mm" in local wall time. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function FeedForm() {
  const router = useRouter();
  const [kind, setKind] = useState<FeedKind>("nursing");
  const [side, setSide] = useState<FeedSide | undefined>(undefined);
  const [occurredIso, setOccurredIso] = useState<string>(
    new Date().toISOString(),
  );

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(FeedInput),
    defaultValues: { kind: "nursing", occurred_at: new Date().toISOString() },
  });

  function selectKind(next: FeedKind) {
    setKind(next);
    setValue("kind", next);
  }
  function selectSide(next: FeedSide) {
    setSide(next);
    setValue("side", next, { shouldValidate: true });
  }
  function changeOccurred(localValue: string) {
    const iso = new Date(localValue).toISOString();
    setOccurredIso(iso);
    setValue("occurred_at", iso, { shouldValidate: true });
  }

  const onSubmit: SubmitHandler<FormOut> = async (values) => {
    const payload = {
      client_uuid: crypto.randomUUID(),
      occurred_at: values.occurred_at,
      kind: values.kind,
      side: values.kind === "nursing" ? values.side : undefined,
      duration_min: values.kind === "nursing" ? values.duration_min : undefined,
      volume_oz: values.kind === "nursing" ? undefined : values.volume_oz,
      wasted_oz: values.kind === "nursing" ? undefined : values.wasted_oz,
      note: values.note || undefined,
    };
    try {
      const outcome = await submitOrQueue("/api/feeds", payload);
      if (outcome.status === "failed") {
        toast.error("Couldn't log that feed. Check the fields and try again.");
        return;
      }
      toast.success(
        outcome.status === "sent" ? readSay(outcome.data) : QUEUED_MESSAGE,
      );
      router.refresh();
    } catch {
      toast.error("Network hiccup — your feed wasn't logged. Try again.");
    }
  };

  return (
    <div className="space-y-5">
      <Tabs value={kind} onValueChange={(v) => selectKind(v as FeedKind)}>
        <TabsList className="w-full">
          <TabsTrigger value="nursing" className="flex-1">
            Nursing
          </TabsTrigger>
          <TabsTrigger value="pumped" className="flex-1">
            Pumped
          </TabsTrigger>
          <TabsTrigger value="formula" className="flex-1">
            Formula
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {kind === "nursing" ? (
          <>
            <div className="space-y-1.5">
              <Label>Side</Label>
              <div className="flex gap-2">
                {(["left", "right", "both"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={side === s ? "default" : "outline"}
                    className="flex-1 capitalize"
                    onClick={() => selectSide(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              {errors.side ? (
                <p className="text-xs text-amber-700">{errors.side.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="duration_min">Duration (minutes)</Label>
              <Input
                id="duration_min"
                type="number"
                inputMode="numeric"
                min={1}
                max={180}
                {...register("duration_min")}
              />
              {errors.duration_min ? (
                <p className="text-xs text-amber-700">
                  {errors.duration_min.message}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="volume_oz">Volume (oz)</Label>
              <Input
                id="volume_oz"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0.1}
                max={20}
                {...register("volume_oz")}
              />
              {errors.volume_oz ? (
                <p className="text-xs text-amber-700">
                  {errors.volume_oz.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wasted_oz">Wasted (oz, optional)</Label>
              <Input
                id="wasted_oz"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                max={20}
                {...register("wasted_oz")}
              />
              <p className="text-xs text-card-foreground/55">
                Tracked separately — not counted toward today&apos;s intake.
              </p>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="occurred_at">When</Label>
          <Input
            id="occurred_at"
            type="datetime-local"
            value={isoToLocalInput(occurredIso)}
            onChange={(e) => changeOccurred(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">Note (optional)</Label>
          <Input id="note" type="text" maxLength={500} {...register("note")} />
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Logging…" : "Log feed"}
        </Button>
      </form>
    </div>
  );
}
