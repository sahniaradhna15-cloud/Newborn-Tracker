"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function RotateRecoveryCode() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rotate() {
    if (
      !confirm(
        "Rotate your recovery code? Any previous code stops working immediately.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/recovery-code/rotate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "fetch",
        },
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error("Couldn't rotate the recovery code.");
        return;
      }
      setCode(data.code as string);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-stone-700 dark:text-stone-300">
          Save this now. We can&apos;t show it again.
        </p>
        <div className="rounded-lg bg-background px-4 py-5 text-center font-mono text-xl tracking-widest text-foreground">
          {code}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => {
              navigator.clipboard?.writeText(code);
              toast.success("Copied");
            }}
          >
            Copy
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={() => setCode(null)}
          >
            I&apos;ve saved it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button type="button" disabled={busy} onClick={rotate}>
      {busy ? "Rotating…" : "Rotate recovery code"}
    </Button>
  );
}
