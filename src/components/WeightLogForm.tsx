"use client";

/**
 * Quick "log a weight reading" form (Phase 3 Task 3). Parents weigh babies
 * in pounds + ounces, so the UI takes those two fields and combines them
 * into the single `weight_oz` the API stores. Submits through the shared
 * offline-queue helper so a reading taken with no signal is queued and
 * replayed (same idempotent `client_uuid` contract as feeds/diapers).
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitOrQueue } from "@/lib/offline-queue";

const QUEUED_MESSAGE = "Saved offline — it'll sync when you're back online.";

const WeightInput = z
  .object({
    pounds: z.coerce.number().int().min(0).max(99),
    ounces: z.coerce.number().min(0).max(15.9),
    occurred_at: z.string().min(1),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.pounds * 16 + v.ounces > 0, {
    message: "Enter a weight greater than zero.",
    path: ["pounds"],
  });

type FormIn = z.input<typeof WeightInput>;
type FormOut = z.output<typeof WeightInput>;

function readSay(data: unknown): string {
  if (data && typeof data === "object" && "say" in data) {
    const say = (data as { say?: unknown }).say;
    if (typeof say === "string" && say.length > 0) return say;
  }
  return "Weight logged.";
}

/** datetime-local <input> wants "YYYY-MM-DDTHH:mm" in local wall time. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function WeightLogForm() {
  const router = useRouter();
  const [occurredIso, setOccurredIso] = useState<string>(
    new Date().toISOString(),
  );

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(WeightInput),
    defaultValues: {
      pounds: 0,
      ounces: 0,
      occurred_at: new Date().toISOString(),
      note: "",
    },
  });

  function changeOccurred(localValue: string) {
    const iso = new Date(localValue).toISOString();
    setOccurredIso(iso);
    setValue("occurred_at", iso, { shouldValidate: true });
  }

  const onSubmit: SubmitHandler<FormOut> = async (values) => {
    const weightOz =
      Math.round((values.pounds * 16 + values.ounces) * 10) / 10;
    try {
      const outcome = await submitOrQueue("/api/weights", {
        client_uuid: crypto.randomUUID(),
        occurred_at: values.occurred_at,
        weight_oz: weightOz,
        note: values.note || undefined,
      });
      if (outcome.status === "failed") {
        toast.error("Couldn't log that weight. Check the fields and try again.");
        return;
      }
      toast.success(
        outcome.status === "sent" ? readSay(outcome.data) : QUEUED_MESSAGE,
      );
      router.refresh();
    } catch {
      toast.error("Network hiccup — that weight wasn't logged. Try again.");
    }
  };

  return (
    <Card className="w-full max-w-md space-y-5 p-6">
      <h2 className="text-xl text-card-foreground">Log a weight</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="pounds">Pounds</Label>
            <Input
              id="pounds"
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              {...register("pounds")}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="ounces">Ounces</Label>
            <Input
              id="ounces"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={15.9}
              {...register("ounces")}
            />
          </div>
        </div>
        {errors.pounds ? (
          <p className="text-xs text-amber-700">{errors.pounds.message}</p>
        ) : null}

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
          {isSubmitting ? "Logging…" : "Log weight"}
        </Button>
      </form>
    </Card>
  );
}
