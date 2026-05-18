/**
 * `/recover` — recovery-code redemption from a no-session device.
 * Client component: it POSTs to /api/recovery/redeem (X-Requested-With
 * exempt in middleware; same-origin Origin still enforced). On success
 * the server has set the session cookie and returned a freshly rotated
 * code; we stash it for /recover/success to display once.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const NEW_CODE_STASH_KEY = "nt_new_recovery_code";

export default function RecoverPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) {
      toast.error("Enter your recovery code.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/recovery/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error(
          data.message ?? "That code didn't work. Check it and try again.",
        );
        setBusy(false);
        return;
      }
      try {
        sessionStorage.setItem(
          NEW_CODE_STASH_KEY,
          data.new_recovery_code as string,
        );
      } catch {
        // sessionStorage unavailable — the success page degrades to a
        // generic "rotate again in settings" note.
      }
      router.push("/recover/success");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md p-6">
        <div className="mb-5 space-y-1">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">
            Newborn Tracker
          </p>
          <h1 className="text-2xl text-card-foreground">Recover your account</h1>
          <p className="text-sm text-card-foreground/70">
            Enter the recovery code you saved when you set up the app. It
            looks like <span className="font-mono">K3HM-7TPN-Q9XR-4FBC</span>.
            Spacing and case don&apos;t matter.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="code">Recovery code</Label>
            <Input
              id="code"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
