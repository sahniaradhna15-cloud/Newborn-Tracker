"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FormSchema = z.object({
  household_name: z.string().trim().min(1, "Required").max(100),
  owner_display_name: z.string().trim().min(1, "Required").max(60),
  baby_name: z.string().trim().min(1, "Required").max(100),
  baby_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  baby_birth_weight_oz: z.coerce.number().positive("Must be > 0").max(400),
});
type FormValues = z.input<typeof FormSchema>;

export default function OnboardingPage() {
  const router = useRouter();
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      household_name: "My Family",
      owner_display_name: "Mom",
      baby_name: "Anay Srivastava",
      baby_dob: "2026-04-23",
      baby_birth_weight_oz: 109,
    },
  });

  async function onSubmit(values: FormValues) {
    const res = await fetch("/api/onboarding/create-household", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
      },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      toast.error("Couldn't finish setup. Please check the form and try again.");
      return;
    }
    setRecoveryCode(data.recovery_code as string);
  }

  if (recoveryCode) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <Card className="w-full max-w-md space-y-5 p-6 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500">
          <div className="space-y-1">
            <h1 className="text-2xl text-card-foreground">
              Save your recovery code
            </h1>
            <p className="text-sm text-card-foreground/70">
              If you lose your phone before anyone else has joined, this is your
              only way back in. Write it down or save it in a password manager.
              We can&apos;t show it again.
            </p>
          </div>
          <div className="rounded-lg bg-[var(--background)] px-4 py-5 text-center font-mono text-2xl tracking-widest text-[var(--foreground)]">
            {recoveryCode}
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                navigator.clipboard?.writeText(recoveryCode);
                toast.success("Copied to clipboard");
              }}
            >
              Copy
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                router.push("/");
                router.refresh();
              }}
            >
              I&apos;ve saved it
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-stone-50 px-6 py-12 dark:bg-stone-950">
      <Card className="w-full max-w-md p-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500">
        <div className="mb-5 space-y-1">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">
            Newborn Tracker
          </p>
          <h1 className="text-2xl text-card-foreground">
            Let&apos;s set up your family
          </h1>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field
            id="household_name"
            label="Household name"
            error={errors.household_name?.message}
            {...register("household_name")}
          />
          <Field
            id="owner_display_name"
            label="Your name on logs (e.g. Mom)"
            error={errors.owner_display_name?.message}
            {...register("owner_display_name")}
          />
          <Field
            id="baby_name"
            label="Baby's name"
            error={errors.baby_name?.message}
            {...register("baby_name")}
          />
          <Field
            id="baby_dob"
            label="Date of birth"
            type="date"
            error={errors.baby_dob?.message}
            {...register("baby_dob")}
          />
          <Field
            id="baby_birth_weight_oz"
            label="Birth weight (oz)"
            type="number"
            step="0.1"
            error={errors.baby_birth_weight_oz?.message}
            {...register("baby_birth_weight_oz")}
          />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Setting up…" : "Create"}
          </Button>
        </form>
      </Card>
    </main>
  );
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
};

function Field({ id, label, error, ...input }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...input} />
      {error ? <p className="text-xs text-amber-700">{error}</p> : null}
    </div>
  );
}
