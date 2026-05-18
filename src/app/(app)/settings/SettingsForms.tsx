"use client";

/**
 * Client island for the Household + Baby settings cards (Phase 3 Task 3).
 * Server page passes current values + the caller's owner flag; each save
 * PATCHes its endpoint, then toasts and `router.refresh()` so server
 * components (TodayCard target band, growth header) re-read the new state.
 *
 * Owner gating is enforced server-side (403); the UI mirrors it by disabling
 * owner-only fields for caregivers so the affordance matches the authority.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const COMMON_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
];

async function patchJson(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    return { ok: res.ok, error: data?.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

export type SettingsFormsProps = {
  isOwner: boolean;
  household: { name: string; dayStartHour: number; timezone: string };
  baby: {
    name: string;
    /** YYYY-MM-DD */
    birthDate: string;
    birthWeightOz: number | null;
    currentWeightOz: number | null;
  };
};

export function SettingsForms({
  isOwner,
  household,
  baby,
}: SettingsFormsProps) {
  const router = useRouter();

  const [hName, setHName] = useState(household.name);
  const [dayStartHour, setDayStartHour] = useState(
    String(household.dayStartHour),
  );
  const [timezone, setTimezone] = useState(household.timezone);
  const [savingHousehold, setSavingHousehold] = useState(false);

  const [bName, setBName] = useState(baby.name);
  const [birthDate, setBirthDate] = useState(baby.birthDate);
  const [birthWeightOz, setBirthWeightOz] = useState(
    baby.birthWeightOz != null ? String(baby.birthWeightOz) : "",
  );
  const [currentWeightOz, setCurrentWeightOz] = useState("");
  const [savingBaby, setSavingBaby] = useState(false);

  async function saveHousehold() {
    setSavingHousehold(true);
    try {
      const result = await patchJson("/api/settings/household", {
        name: hName,
        day_start_hour: Number(dayStartHour),
        timezone,
      });
      if (!result.ok) {
        toast.error(
          result.error === "forbidden"
            ? "Only the household owner can change these."
            : "Couldn't save household settings.",
        );
        return;
      }
      toast.success("Household settings saved.");
      router.refresh();
    } finally {
      setSavingHousehold(false);
    }
  }

  async function saveBaby() {
    setSavingBaby(true);
    try {
      const body: Record<string, unknown> = {};
      if (isOwner) {
        body.name = bName;
        body.birth_date = birthDate;
        if (birthWeightOz !== "") body.birth_weight_oz = Number(birthWeightOz);
      }
      if (currentWeightOz !== "") {
        body.current_weight_oz = Number(currentWeightOz);
      }
      if (Object.keys(body).length === 0) {
        toast.error("Nothing to save.");
        return;
      }
      const result = await patchJson("/api/settings/baby", body);
      if (!result.ok) {
        toast.error(
          result.error === "forbidden"
            ? "Only the household owner can change the baby's profile."
            : "Couldn't save baby settings.",
        );
        return;
      }
      toast.success("Baby settings saved.");
      setCurrentWeightOz("");
      router.refresh();
    } finally {
      setSavingBaby(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-lg text-card-foreground">Household</h2>
          {!isOwner ? (
            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-500">
              Only the household owner can change these.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-name">Household name</Label>
          <Input
            id="h-name"
            value={hName}
            disabled={!isOwner}
            maxLength={120}
            onChange={(e) => setHName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-day-start">Day-start hour (0–23)</Label>
          <Input
            id="h-day-start"
            type="number"
            inputMode="numeric"
            min={0}
            max={23}
            value={dayStartHour}
            disabled={!isOwner}
            onChange={(e) => setDayStartHour(e.target.value)}
          />
          <p className="text-xs text-stone-500 dark:text-stone-500">
            The hour a new tracking day begins (default 4 = 4&nbsp;am
            rollover).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-tz">Timezone</Label>
          <Input
            id="h-tz"
            list="tz-options"
            value={timezone}
            disabled={!isOwner}
            onChange={(e) => setTimezone(e.target.value)}
          />
          <datalist id="tz-options">
            {COMMON_TIMEZONES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <Button
          type="button"
          className="w-full"
          disabled={!isOwner || savingHousehold}
          onClick={saveHousehold}
        >
          {savingHousehold ? "Saving…" : "Save household"}
        </Button>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-lg text-card-foreground">Baby</h2>
          {!isOwner ? (
            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-500">
              You can log a current weight; only the owner can edit the
              profile.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-name">Name</Label>
          <Input
            id="b-name"
            value={bName}
            disabled={!isOwner}
            maxLength={120}
            onChange={(e) => setBName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-dob">Date of birth</Label>
          <Input
            id="b-dob"
            type="date"
            value={birthDate}
            disabled={!isOwner}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-birth-weight">Birth weight (oz)</Label>
          <Input
            id="b-birth-weight"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0.1}
            max={9999.9}
            value={birthWeightOz}
            disabled={!isOwner}
            onChange={(e) => setBirthWeightOz(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-current-weight">
            Log a current weight (oz, optional)
          </Label>
          <Input
            id="b-current-weight"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0.1}
            max={9999.9}
            placeholder={
              baby.currentWeightOz != null
                ? `Latest: ${baby.currentWeightOz} oz`
                : "Not set yet"
            }
            value={currentWeightOz}
            onChange={(e) => setCurrentWeightOz(e.target.value)}
          />
          <p className="text-xs text-stone-500 dark:text-stone-500">
            Saving this adds a weight reading and updates today&apos;s intake
            target band.
          </p>
        </div>
        <Button
          type="button"
          className="w-full"
          disabled={savingBaby}
          onClick={saveBaby}
        >
          {savingBaby ? "Saving…" : "Save baby"}
        </Button>
      </Card>
    </div>
  );
}
