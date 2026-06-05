"use client";

/**
 * ImportConsole — paste-or-upload backfill UI for `/import`. Client island: it
 * holds the textarea/file state and talks to `POST /api/import`. The parsing
 * and writing both happen SERVER-side (one parser, one write path); this only
 * renders the preview the server returns and, on confirm, the commit summary.
 *
 * Safety model: nothing is written until the parent reviews the per-day totals
 * and presses Import. Re-importing the same notes is a no-op (deterministic
 * client_uuids), so a double-tap can't double-count.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type UnitAmount = { ml: number; oz: number };
type DayPreview = {
  dayStartIso: string;
  label: string;
  ageDays: number;
  formula: UnitAmount;
  breast: UnitAmount;
  total: UnitAmount;
  targetLowOz: number;
  targetHighOz: number;
  withinTarget: boolean;
  feedCount: number;
  pee: number;
  poop: number;
};
type SkippedLine = {
  skipKey: string;
  rawLine: string;
  reason: string;
  dateLabel: string;
  kind: "formula" | "breast";
  occurredAtIso: string;
};
type Counts = { days: number; feeds: number; diapers: number; skipped: number };
type PreviewResponse = {
  ok: true;
  mode: "preview";
  perDay: DayPreview[];
  skipped: SkippedLine[];
  warnings: string[];
  counts: Counts;
  /** AI-normalized text the parser saw; echoed back on commit so it's reused verbatim. */
  normalizedText?: string;
};
type CommitResponse = { ok: true; mode: "commit"; accepted: number; duplicate: number; failed: number; counts: Counts };

const HEADERS = { "Content-Type": "application/json", "X-Requested-With": "fetch" };
const ML_PER_OZ = 29.5735;

function fmtOz(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function parseMl(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fixesPayload(drafts: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const ml = parseMl(draft);
    if (ml !== null) out[key] = ml;
  }
  return out;
}

export function ImportConsole() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState("");
  // The AI-normalized text from the latest preview. Sent back on Recalculate
  // and Import so the server reuses it verbatim (one AI call per import; stable
  // skip/dedupe keys). Cleared whenever the raw notes change so a fresh edit
  // gets a fresh normalization.
  const [normalizedText, setNormalizedText] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // skipKey → ml draft string (kept as a string so the input can be empty
  // without coercing to NaN/0). Survives across "Recalculate" so fixes persist
  // as the user resolves them one by one.
  const [fixDrafts, setFixDrafts] = useState<Record<string, string>>({});
  // Set of skipKeys whose draft has changed since the last preview round-trip,
  // so we can prompt the user to Recalculate before importing.
  const [pendingFixKeys, setPendingFixKeys] = useState<Set<string>>(new Set());

  const totalEntries = preview ? preview.counts.feeds + preview.counts.diapers : 0;
  const stagedFixCount = Object.values(fixDrafts).filter((d) => parseMl(d) !== null).length;
  const hasPendingFixes = pendingFixKeys.size > 0;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    setNormalizedText(null);
    setPreview(null);
    setResult(null);
    setFixDrafts({});
    setPendingFixKeys(new Set());
  }

  async function call(commit: boolean) {
    setBusy(commit ? "commit" : "preview");
    setError(null);
    try {
      const fixes = fixesPayload(fixDrafts);
      const res = await fetch("/api/import", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ rawText, commit, fixes, normalizedText }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        console.error("import failed", { status: res.status, body: data });
        setError(errorMessage(data?.error, res.status));
        return;
      }
      if (commit) {
        setResult(data as CommitResponse);
        router.refresh();
      } else {
        const previewData = data as PreviewResponse;
        setPreview(previewData);
        // Hold the AI-normalized text so Recalculate/Import reuse it verbatim.
        setNormalizedText(previewData.normalizedText ?? null);
        setResult(null);
        // Round-trip done — drafts the server has now seen are no longer pending.
        setPendingFixKeys(new Set());
      }
    } catch {
      setError("Something went wrong reaching the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-card p-5 text-card-foreground shadow-md ring-1 ring-black/5">
        <label htmlFor="notes" className="text-sm font-medium text-card-foreground">
          Paste your notes
        </label>
        <textarea
          id="notes"
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            setNormalizedText(null);
            setPreview(null);
            setResult(null);
            setFixDrafts({});
            setPendingFixKeys(new Set());
          }}
          rows={10}
          placeholder={"April 29 2026\n- 3 am - 70ml formula\n- 7 am - breast milk 80ml\n- Pee and poop\n..."}
          className="mt-2 w-full rounded-lg border border-card-foreground/15 bg-background/5 p-3 font-mono text-sm text-card-foreground placeholder:text-card-foreground/35 focus:border-card-foreground/40 focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.csv,text/plain"
            onChange={onFile}
            className="hidden"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            Upload a file
          </Button>
          <span className="text-xs text-card-foreground/50">…or paste above. .txt / .md / .csv</span>
          <div className="ml-auto">
            <Button type="button" onClick={() => call(false)} disabled={rawText.trim() === "" || busy !== null}>
              {busy === "preview" ? "Reading…" : "Preview"}
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>
      ) : null}

      {result ? (
        <section className="rounded-lg bg-card p-5 text-card-foreground shadow-md ring-1 ring-black/5">
          <p className="font-heading text-xl text-card-foreground">Imported ✓</p>
          <p className="mt-2 text-sm text-card-foreground/75">
            {result.accepted} new {result.accepted === 1 ? "entry" : "entries"} added
            {result.duplicate > 0 ? ` · ${result.duplicate} already there (skipped)` : ""}
            {result.failed > 0 ? ` · ${result.failed} couldn’t be read` : ""}.
          </p>
          <a
            href="/history"
            className="mt-4 inline-flex text-sm text-card-foreground underline underline-offset-4 hover:text-card-foreground/70"
          >
            View your trends →
          </a>
        </section>
      ) : null}

      {preview && !result ? (
        <>
          <section className="rounded-lg bg-card p-5 text-card-foreground shadow-md ring-1 ring-black/5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">
                  Preview
                </p>
                <p className="mt-1 text-sm text-card-foreground/70">
                  {preview.counts.days} {preview.counts.days === 1 ? "day" : "days"} · {preview.counts.feeds} feeds ·{" "}
                  {preview.counts.diapers} diapers
                  {preview.counts.skipped > 0 ? ` · ${preview.counts.skipped} skipped` : ""}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => call(true)}
                disabled={busy !== null || totalEntries === 0 || hasPendingFixes}
                title={hasPendingFixes ? "Recalculate to include your fixes first" : undefined}
              >
                {busy === "commit" ? "Importing…" : `Import ${totalEntries} entries`}
              </Button>
            </div>
            <p className="mt-2 text-xs text-card-foreground/50">
              Check the day totals against your notes. Nothing is saved until you press Import. Re-importing is safe — it
              won’t double-count.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-card-foreground/10 text-left text-xs text-card-foreground/55">
                    <th className="py-2 pr-3 font-medium">Day</th>
                    <th className="py-2 pr-3 font-medium">Breast</th>
                    <th className="py-2 pr-3 font-medium">Formula</th>
                    <th className="py-2 pr-3 font-medium">Total</th>
                    <th className="py-2 pr-3 font-medium">Target</th>
                    <th className="py-2 font-medium">Diapers</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.perDay.map((d) => (
                    <tr key={d.dayStartIso} className="border-b border-card-foreground/5">
                      <td className="py-2 pr-3 whitespace-nowrap text-card-foreground/80">
                        {d.label} <span className="text-card-foreground/40">· {d.ageDays}d</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-card-foreground/70">
                        {fmtOz(d.breast.oz)} oz <span className="text-card-foreground/40">({d.breast.ml} ml)</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-card-foreground/70">
                        {fmtOz(d.formula.oz)} oz <span className="text-card-foreground/40">({d.formula.ml} ml)</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        <span className="font-medium text-card-foreground">{fmtOz(d.total.oz)} oz</span>{" "}
                        <span className="text-card-foreground/40">({d.total.ml} ml)</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            d.withinTarget
                              ? "rounded-full bg-card-foreground/5 px-2 py-0.5 text-xs text-card-foreground/55"
                              : "rounded-full bg-amber-100/70 px-2 py-0.5 text-xs text-amber-800"
                          }
                        >
                          {fmtOz(d.targetLowOz)}–{fmtOz(d.targetHighOz)}
                        </span>
                      </td>
                      <td className="py-2 tabular-nums text-card-foreground/70">
                        {d.pee} wet · {d.poop} dirty
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {preview.skipped.length > 0 ? (
            <section className="rounded-lg bg-card p-5 text-card-foreground shadow-md ring-1 ring-black/5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-card-foreground">Skipped ({preview.skipped.length})</p>
                  <p className="mt-1 text-xs text-card-foreground/55">
                    Breast and formula lines with no readable amount aren’t counted. Type the amount (ml) for any you want
                    included, then Recalculate — or just leave them skipped.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => call(false)}
                  disabled={busy !== null || !hasPendingFixes}
                  title={hasPendingFixes ? "Re-read the notes with your fixes applied" : "No pending fixes to apply"}
                >
                  {busy === "preview" ? "Recalculating…" : "Recalculate"}
                </Button>
              </div>
              {stagedFixCount > 0 ? (
                <p className="mt-2 text-xs text-card-foreground/55">
                  {stagedFixCount} {stagedFixCount === 1 ? "fix" : "fixes"} ready
                  {hasPendingFixes ? " — recalculate to fold them into the totals above." : "."}
                </p>
              ) : null}
              <ul className="mt-4 space-y-2.5 text-sm">
                {preview.skipped.map((s) => {
                  const draft = fixDrafts[s.skipKey] ?? "";
                  const ml = parseMl(draft);
                  return (
                    <li
                      key={s.skipKey}
                      className="rounded-lg border border-card-foreground/10 bg-background/5 p-3"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span
                          className={
                            s.kind === "formula"
                              ? "rounded-full bg-card-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-card-foreground/70"
                              : "rounded-full bg-card-foreground/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-card-foreground/70"
                          }
                        >
                          {s.kind}
                        </span>
                        <span className="text-card-foreground/45">{s.dateLabel}</span>
                        <span className="text-card-foreground/85">“{s.rawLine}”</span>
                      </div>
                      <p className="mt-1 text-xs text-card-foreground/45">{s.reason}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`fix-${s.skipKey}`}
                          className="text-xs text-card-foreground/55"
                        >
                          Add as
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            id={`fix-${s.skipKey}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step={1}
                            value={draft}
                            onChange={(e) => {
                              const v = e.target.value;
                              setFixDrafts((d) => ({ ...d, [s.skipKey]: v }));
                              setPendingFixKeys((p) => {
                                const next = new Set(p);
                                next.add(s.skipKey);
                                return next;
                              });
                            }}
                            placeholder="amount"
                            className="w-24 rounded-md border border-card-foreground/15 bg-background/10 px-2 py-1 text-sm tabular-nums text-card-foreground placeholder:text-card-foreground/35 focus:border-card-foreground/40 focus:outline-none"
                          />
                          <span className="text-xs text-card-foreground/55">ml</span>
                        </div>
                        {ml !== null ? (
                          <span className="text-xs text-card-foreground/55">
                            ≈ {fmtOz(Math.round((ml / ML_PER_OZ) * 10) / 10)} oz
                          </span>
                        ) : null}
                        {draft !== "" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setFixDrafts((d) => {
                                const next = { ...d };
                                delete next[s.skipKey];
                                return next;
                              });
                              setPendingFixKeys((p) => {
                                const next = new Set(p);
                                next.add(s.skipKey);
                                return next;
                              });
                            }}
                            className="text-xs text-card-foreground/45 underline-offset-2 hover:text-card-foreground hover:underline"
                          >
                            clear
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {preview.warnings.length > 0 ? (
            <section className="rounded-lg bg-amber-50 p-5 text-amber-900 shadow-md ring-1 ring-black/5">
              <p className="text-sm font-medium">Heads up ({preview.warnings.length})</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function errorMessage(code: unknown, status?: number): string {
  switch (code) {
    case "empty_notes":
      return "Paste or upload some notes first.";
    case "notes_too_large":
      return "That’s a lot of text — try importing fewer days at a time.";
    case "no_active_baby":
      return "No baby found for your household.";
    case "unauthorized":
      return "Your session expired. Refresh and sign in again.";
    case "csrf_check_failed":
      return "Blocked by the security check — the page’s address doesn’t match the app’s configured URL. Open the app at its proper URL (or update NEXT_PUBLIC_APP_URL) and try again.";
    case "server_error":
      return "The server hit an error reading those notes. The team has been logged; try again.";
    default:
      return `Couldn’t import (server said “${code ?? "unknown"}”${status ? `, HTTP ${status}` : ""}). Try again, or share this message.`;
  }
}
