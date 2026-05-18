"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type VoiceToken = {
  id: string;
  label: string | null;
  last_used_at: string | null;
  status: "active" | "revoked";
  created_at: string;
};

type ShortcutLink = {
  name: string;
  /** null until the user pastes the iCloud share URL (see README). */
  importUrl: string | null;
};

type Props = {
  tokens: VoiceToken[];
  appUrl: string;
  shortcutLinks: ShortcutLink[];
};

const JSON_FETCH = {
  headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
} as const;

function formatWhen(iso: string | null): string {
  if (!iso) return "never used";
  const d = new Date(iso);
  return `last used ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function VoiceTokensPanel({ tokens, appUrl, shortcutLinks }: Props) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch("/api/tokens", {
        ...JSON_FETCH,
        method: "POST",
        body: JSON.stringify(label.trim() ? { label: label.trim() } : {}),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error("Couldn't generate a token.");
        return;
      }
      setFreshToken(data.token as string);
      setLabel("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (
      !confirm(
        `Revoke "${name}"? Every Shortcut using this token stops working immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/tokens/${id}`, {
        ...JSON_FETCH,
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        toast.error("Couldn't revoke the token.");
        return;
      }
      toast.success("Token revoked.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {freshToken ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm text-stone-700 dark:text-stone-300">
            Save this now. We can&apos;t show it again. Paste it into the
            <span className="font-medium"> API_TOKEN</span> text action in
            each Shortcut.
          </p>
          <div className="break-all rounded-lg bg-background px-3 py-2 font-mono text-xs text-foreground">
            {freshToken}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(freshToken);
                toast.success("Copied");
              }}
            >
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFreshToken(null)}
            >
              I&apos;ve saved it
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
        <Label htmlFor="token_label">New token</Label>
        <div className="flex gap-2">
          <Input
            id="token_label"
            placeholder="e.g. My iPhone"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="button" disabled={busy} onClick={generate}>
            Generate
          </Button>
        </div>
      </div>

      <ul className="space-y-2">
        {tokens.length === 0 ? (
          <li className="rounded-xl border border-stone-200 bg-white p-3 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
            No tokens yet. Generate one to set up Siri logging.
          </li>
        ) : null}
        {tokens.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {t.label ?? "Unnamed token"}
              </p>
              <p className="text-xs text-stone-500">
                {t.status === "revoked" ? "revoked" : formatWhen(t.last_used_at)}
              </p>
            </div>
            {t.status === "active" ? (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => revoke(t.id, t.label ?? "Unnamed token")}
              >
                Revoke
              </Button>
            ) : (
              <span className="text-xs uppercase tracking-wide text-stone-400">
                revoked
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
        <p className="text-sm text-foreground">Add the Siri Shortcuts</p>
        <p className="text-xs text-stone-600 dark:text-stone-400">
          App URL for the Shortcuts&apos; <span className="font-mono">APP_URL</span>{" "}
          action: <span className="break-all font-mono">{appUrl || "(set NEXT_PUBLIC_APP_URL)"}</span>
        </p>
        <ul className="mt-1 space-y-1">
          {shortcutLinks.map((s) => (
            <li key={s.name} className="text-sm">
              {s.importUrl ? (
                <a
                  href={s.importUrl}
                  className="text-foreground underline underline-offset-4"
                >
                  Add &ldquo;{s.name}&rdquo;
                </a>
              ) : (
                <span className="text-stone-500">
                  {s.name} — paste its iCloud share URL in the Shortcut recipe
                  to enable one-tap import
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
