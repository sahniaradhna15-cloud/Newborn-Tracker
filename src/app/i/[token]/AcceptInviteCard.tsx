"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Props = {
  token: string;
  isPeerRecovery: boolean;
};

export function AcceptInviteCard({ token, isPeerRecovery }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function accept() {
    setSubmitting(true);
    try {
      // /api/invites/[token]/accept is X-Requested-With-exempt in
      // middleware (no-session device); the same-origin Origin header is
      // still sent automatically by fetch and is still enforced.
      const res = await fetch(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error(
          data.message ?? "This link is invalid, expired, or already used.",
        );
        setSubmitting(false);
        return;
      }
      router.push(data.redirect ?? "/");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Button className="w-full" onClick={accept} disabled={submitting}>
      {submitting
        ? "One moment…"
        : isPeerRecovery
          ? "Sign in on this device"
          : "Join the family"}
    </Button>
  );
}
