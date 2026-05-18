/**
 * `/recover/success` — shown right after a successful redeem. The
 * redeem auto-rotated the code (TECHNICAL_SPEC §4.5.2); we display the
 * NEW one exactly once, mirroring the onboarding "save this" card. The
 * raw value is only ever in sessionStorage (set by /recover) — never
 * server-rendered, never logged.
 */
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const NEW_CODE_STASH_KEY = "nt_new_recovery_code";

// One-shot read of the stashed code. `useSyncExternalStore` is the
// React-idiomatic, hydration-safe way to surface a client-only value:
// the server snapshot is always null (no sessionStorage on the server),
// the client snapshot reads it once. No setState-in-effect.
const noopSubscribe = () => () => {};
function readStashedCode(): string | null {
  try {
    return sessionStorage.getItem(NEW_CODE_STASH_KEY);
  } catch {
    return null;
  }
}

export default function RecoverSuccessPage() {
  const router = useRouter();
  const code = useSyncExternalStore(
    noopSubscribe,
    readStashedCode,
    () => null,
  );
  const clearedRef = useRef(false);

  useEffect(() => {
    if (clearedRef.current) return;
    clearedRef.current = true;
    try {
      sessionStorage.removeItem(NEW_CODE_STASH_KEY);
    } catch {
      // sessionStorage unavailable — nothing to clear.
    }
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl text-card-foreground">You&apos;re back in</h1>
          <p className="text-sm text-card-foreground/70">
            For security, your old code is now used up and a fresh one has
            been generated.
          </p>
        </div>

        {code ? (
          <>
            <p className="text-sm text-card-foreground/70">
              Save this new code. We can&apos;t show it again.
            </p>
            <div className="rounded-lg bg-[var(--background)] px-4 py-5 text-center font-mono text-2xl tracking-widest text-[var(--foreground)]">
              {code}
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  navigator.clipboard?.writeText(code);
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
          </>
        ) : (
          <>
            <p className="text-sm text-card-foreground/70">
              If you didn&apos;t see your new code, you can rotate it any time
              from Settings → Recovery code.
            </p>
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                router.push("/");
                router.refresh();
              }}
            >
              Go to the dashboard
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
