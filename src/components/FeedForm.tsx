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
import { WhenPicker } from "@/components/WhenPicker";
import { submitOrQueue } from "@/lib/offline-queue";
import { mlToOz, ozToMl, type VolumeUnit } from "@/lib/units";
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

/**
 * Two independent Left/Right toggles fold back into the stored enum: both on →
 * "both", neither → undefined (lets the schema flag "pick a side"). There is no
 * "both" button — selecting Left and Right together expresses it.
 */
function deriveSide(isLeftOn: boolean, isRightOn: boolean): FeedSide | undefined {
  if (isLeftOn && isRightOn) return "both";
  if (isLeftOn) return "left";
  if (isRightOn) return "right";
  return undefined;
}

/** Parse a free-typed volume field; blank or non-numeric yields undefined. */
function parseVolume(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Convert a displayed value in the chosen unit to canonical ounces. */
function displayToOz(raw: string, unit: VolumeUnit): number | undefined {
  const n = parseVolume(raw);
  if (n === undefined) return undefined;
  return unit === "ml" ? mlToOz(n) : n;
}

export function FeedForm() {
  const router = useRouter();
  const [kind, setKind] = useState<FeedKind>("nursing");
  const [isLeftOn, setIsLeftOn] = useState(false);
  const [isRightOn, setIsRightOn] = useState(false);
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>("oz");
  const [volumeDisplay, setVolumeDisplay] = useState("");
  const [wastedDisplay, setWastedDisplay] = useState("");
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
  function toggleSide(which: "left" | "right") {
    const nextLeftOn = which === "left" ? !isLeftOn : isLeftOn;
    const nextRightOn = which === "right" ? !isRightOn : isRightOn;
    setIsLeftOn(nextLeftOn);
    setIsRightOn(nextRightOn);
    setValue("side", deriveSide(nextLeftOn, nextRightOn), { shouldValidate: true });
  }
  function pickOccurred(iso: string) {
    setOccurredIso(iso);
    setValue("occurred_at", iso, { shouldValidate: true });
  }

  // The visible inputs hold the user's chosen unit; RHF always holds canonical oz.
  function changeVolume(raw: string) {
    setVolumeDisplay(raw);
    setValue("volume_oz", displayToOz(raw, volumeUnit), { shouldValidate: true });
  }
  function changeWasted(raw: string) {
    setWastedDisplay(raw);
    setValue("wasted_oz", displayToOz(raw, volumeUnit), { shouldValidate: true });
  }
  // Switching unit re-labels the same physical amount: oz stays canonical, only
  // the displayed number is re-expressed so "3 oz" becomes "89 ml", not "3 ml".
  function selectVolumeUnit(next: VolumeUnit) {
    if (next === volumeUnit) return;
    const reexpress = (raw: string): string => {
      const oz = displayToOz(raw, volumeUnit);
      if (oz === undefined) return raw;
      return String(next === "ml" ? ozToMl(oz) : oz);
    };
    setVolumeDisplay(reexpress);
    setWastedDisplay(reexpress);
    setVolumeUnit(next);
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
                {(["left", "right"] as const).map((s) => {
                  const isOn = s === "left" ? isLeftOn : isRightOn;
                  return (
                    <Button
                      key={s}
                      type="button"
                      variant={isOn ? "default" : "outline"}
                      className="flex-1 capitalize"
                      onClick={() => toggleSide(s)}
                      aria-pressed={isOn}
                    >
                      {s}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-card-foreground/55">
                Fed on both sides? Tap Left and Right.
              </p>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="volume_oz">Volume ({volumeUnit})</Label>
                <div className="flex gap-1" role="group" aria-label="Volume unit">
                  {(["oz", "ml"] as const).map((u) => (
                    <Button
                      key={u}
                      type="button"
                      size="sm"
                      variant={volumeUnit === u ? "default" : "outline"}
                      className="h-7 px-3 text-xs"
                      onClick={() => selectVolumeUnit(u)}
                      aria-pressed={volumeUnit === u}
                    >
                      {u}
                    </Button>
                  ))}
                </div>
              </div>
              <Input
                id="volume_oz"
                type="number"
                inputMode="decimal"
                step={volumeUnit === "ml" ? "1" : "0.1"}
                min={volumeUnit === "ml" ? 1 : 0.1}
                max={volumeUnit === "ml" ? 600 : 20}
                value={volumeDisplay}
                onChange={(e) => changeVolume(e.target.value)}
              />
              {volumeUnit === "ml" && displayToOz(volumeDisplay, "ml") !== undefined ? (
                <p className="text-xs text-card-foreground/55">
                  ≈ {displayToOz(volumeDisplay, "ml")} oz logged.
                </p>
              ) : null}
              {errors.volume_oz ? (
                <p className="text-xs text-amber-700">
                  {errors.volume_oz.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wasted_oz">Wasted ({volumeUnit}, optional)</Label>
              <Input
                id="wasted_oz"
                type="number"
                inputMode="decimal"
                step={volumeUnit === "ml" ? "1" : "0.1"}
                min={0}
                max={volumeUnit === "ml" ? 600 : 20}
                value={wastedDisplay}
                onChange={(e) => changeWasted(e.target.value)}
              />
              <p className="text-xs text-card-foreground/55">
                Tracked separately — not counted toward today&apos;s intake.
              </p>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label>When</Label>
          <WhenPicker value={occurredIso} onChange={pickOccurred} />
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
