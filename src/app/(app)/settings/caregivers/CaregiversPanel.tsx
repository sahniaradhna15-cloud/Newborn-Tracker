"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type RosterMember = {
  user_id: string;
  role: "owner" | "caregiver";
  display_name: string;
  is_self: boolean;
};

type Props = {
  roster: RosterMember[];
  callerRole: "owner" | "caregiver";
};

const JSON_FETCH = {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
} as const;

export function CaregiversPanel({ roster, callerRole }: Props) {
  const router = useRouter();
  const isOwner = callerRole === "owner";
  const [inviteName, setInviteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function mintInvite() {
    if (!inviteName.trim()) {
      toast.error("Enter a name for the invite.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/invites", {
        ...JSON_FETCH,
        body: JSON.stringify({ display_name: inviteName.trim() }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error("Couldn't create the invite link.");
        return;
      }
      setShareUrl(data.url as string);
    } finally {
      setBusy(false);
    }
  }

  async function sendAccessLink(forUserId: string, name: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/access-links", {
        ...JSON_FETCH,
        body: JSON.stringify({ for_user_id: forUserId }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error(
          data.message ?? `Couldn't create an access link for ${name}.`,
        );
        return;
      }
      setShareUrl(data.url as string);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string, name: string) {
    if (!confirm(`Sign ${name} out of all their devices?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/caregivers/${userId}/revoke`, JSON_FETCH);
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error(`Couldn't revoke ${name}.`);
        return;
      }
      toast.success(`${name} has been signed out.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function transfer(userId: string, name: string) {
    const typed = prompt(
      `Transfer ownership to ${name}? You will become a caregiver and can no longer invite or revoke. Type TRANSFER to confirm.`,
    );
    if (typed !== "TRANSFER") return;
    setBusy(true);
    try {
      const res = await fetch("/api/caregivers/transfer-ownership", {
        ...JSON_FETCH,
        body: JSON.stringify({ to_user_id: userId }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error("Couldn't transfer ownership.");
        return;
      }
      toast.success(`${name} is now the owner.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {roster.map((m) => (
          <li
            key={m.user_id}
            className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {m.display_name}
                {m.is_self ? " (you)" : ""}
              </p>
              <p className="text-xs uppercase tracking-wide text-stone-500">
                {m.role}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {!m.is_self ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => sendAccessLink(m.user_id, m.display_name)}
                >
                  Send access link
                </Button>
              ) : null}
              {isOwner && !m.is_self ? (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => revoke(m.user_id, m.display_name)}
                  >
                    Revoke
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => transfer(m.user_id, m.display_name)}
                  >
                    Make owner
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {isOwner ? (
        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
          <Label htmlFor="invite_name">Invite a caregiver</Label>
          <div className="flex gap-2">
            <Input
              id="invite_name"
              placeholder="e.g. Dad"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
            />
            <Button type="button" disabled={busy} onClick={mintInvite}>
              Create link
            </Button>
          </div>
        </div>
      ) : null}

      {shareUrl ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm text-stone-700 dark:text-stone-300">
            Share this link with the person. It can be used once.
          </p>
          <div className="break-all rounded-lg bg-background px-3 py-2 font-mono text-xs text-foreground">
            {shareUrl}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(shareUrl);
                toast.success("Copied");
              }}
            >
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShareUrl(null)}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
