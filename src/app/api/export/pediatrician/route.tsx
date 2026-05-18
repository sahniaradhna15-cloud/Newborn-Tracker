/**
 * `GET /api/export/pediatrician?from=&to=` (session) — streams the
 * free single-page pediatrician PDF (Decision #4). Default range is the
 * last 7 logical days.
 *
 * The day-by-day numbers come from the SHARED {@link getRangeSummary}
 * (same per-day reducer as the dashboard — no drift). Notes are read
 * from feed_events / diaper_events ONLY: this query path STRUCTURALLY
 * never touches `mom_events` (Task 4 DoD — we do not merely rely on the
 * `mom_events_self` RLS policy). RLS-bound via `withUserContext`.
 *
 * No caregiver attribution is selected or rendered anywhere.
 *
 * Rendered with `renderToBuffer` (one small page) and returned as a
 * single `application/pdf` body — simpler and version-stable vs. piping
 * a Node stream through `NextResponse`.
 */
import { renderToBuffer } from "@react-pdf/renderer";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { PediatricianPDF, type PediatricianDay, type PediatricianPDFData } from "@/components/PediatricianPDF";
import { getRangeSummary } from "@/lib/day-summary";
import { getDayWindow, dayNumberSinceBirth } from "@/lib/day-window";
import { babies, diaperEvents, feedEvents, households } from "@/lib/db/schema";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

// @react-pdf/renderer needs Node APIs — never the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 31;

/**
 * Renders the PDF to a buffer. Kept as a module-level helper so the JSX
 * element is NOT constructed lexically inside the route's try/catch
 * (lint rule "no JSX in try/catch") — the try/catch still guards the
 * await, which is where a render failure surfaces.
 */
function renderPediatricianPdf(data: PediatricianPDFData): Promise<Buffer> {
  return renderToBuffer(<PediatricianPDF data={data} />);
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

function longDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

export async function GET(req: NextRequest) {
  const ctx = await getSessionAuthContext();
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const toParam = parseDate(req.nextUrl.searchParams.get("to")) ?? now;
  const fromParam =
    parseDate(req.nextUrl.searchParams.get("from")) ??
    new Date(toParam.getTime() - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);

  // Clamp the span so a hand-typed range can't request an unbounded PDF.
  const spanDays = Math.ceil((toParam.getTime() - fromParam.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const from =
    spanDays > MAX_RANGE_DAYS
      ? new Date(toParam.getTime() - (MAX_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000)
      : fromParam;

  try {
    const range = await getRangeSummary(ctx.user_id, ctx.household_id, from, toParam);
    if (!range) {
      return NextResponse.json({ ok: false, error: "no_active_baby" }, { status: 404 });
    }
    const timeZone = range.baby.timeZone;

    const detail = await withUserContext(ctx.user_id, async (tx) => {
      const [household] = await tx
        .select()
        .from(households)
        .where(eq(households.id, ctx.household_id))
        .limit(1);
      const [baby] = await tx
        .select()
        .from(babies)
        .where(eq(babies.householdId, ctx.household_id))
        .limit(1);
      if (!household || !baby) return null;

      const firstWindow = getDayWindow(from, household.timezone, household.dayStartHour);
      const lastWindow = getDayWindow(toParam, household.timezone, household.dayStartHour);

      // NOTE: only feed_events + diaper_events are queried here. mom_events
      // is intentionally NOT imported or selected in this route.
      const feedNotes = await tx
        .select({ occurredAt: feedEvents.occurredAt, kind: feedEvents.kind, note: feedEvents.note })
        .from(feedEvents)
        .where(
          and(
            eq(feedEvents.babyId, baby.id),
            gte(feedEvents.occurredAt, firstWindow.start),
            lt(feedEvents.occurredAt, lastWindow.end),
          ),
        )
        .orderBy(asc(feedEvents.occurredAt));
      const diaperNotes = await tx
        .select({ occurredAt: diaperEvents.occurredAt, note: diaperEvents.note })
        .from(diaperEvents)
        .where(
          and(
            eq(diaperEvents.babyId, baby.id),
            gte(diaperEvents.occurredAt, firstWindow.start),
            lt(diaperEvents.occurredAt, lastWindow.end),
          ),
        )
        .orderBy(asc(diaperEvents.occurredAt));

      return { household, baby, feedNotes, diaperNotes };
    });

    if (!detail) {
      return NextResponse.json({ ok: false, error: "no_active_baby" }, { status: 404 });
    }

    const ageDays = dayNumberSinceBirth(
      now,
      detail.baby.birthDate,
      detail.household.timezone,
      detail.household.dayStartHour,
    );

    const notes = [
      ...detail.feedNotes
        .filter((n) => n.note && n.note.trim() !== "")
        .map((n) => ({
          dateLabel: longDate(n.occurredAt, timeZone),
          kind: n.kind === "nursing" ? "Nursing" : n.kind === "pumped" ? "Pumped" : "Formula",
          text: n.note as string,
        })),
      ...detail.diaperNotes
        .filter((n) => n.note && n.note.trim() !== "")
        .map((n) => ({
          dateLabel: longDate(n.occurredAt, timeZone),
          kind: "Diaper",
          text: n.note as string,
        })),
    ];

    const days: PediatricianDay[] = range.days.map((d) => ({
      ...d,
      dateLabel: longDate(new Date(d.day_start), timeZone),
    }));

    const pdfBuffer = await renderPediatricianPdf({
      babyName: detail.baby.name,
      birthDateLabel: longDate(detail.baby.birthDate, timeZone),
      ageLabel: `${ageDays} days`,
      rangeLabel: `${longDate(from, timeZone)} – ${longDate(toParam, timeZone)}`,
      days,
      notes,
    });

    const filename = `anay-feeding-summary-${ymd(from, timeZone)}-to-${ymd(toParam, timeZone)}.pdf`;

    console.info(
      JSON.stringify({
        event: "pediatrician_export",
        route: "/api/export/pediatrician",
        method: "GET",
        status: "ok",
        days: range.days.length,
        user_id: ctx.user_id,
        household_id: ctx.household_id,
      }),
    );

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "pediatrician_export_failed",
        route: "/api/export/pediatrician",
        method: "GET",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        fix_suggestion:
          "Confirm withUserContext bound request.user_id (RLS denies all rows otherwise), the household has a babies row, and @react-pdf/renderer renderToBuffer runs in the Node runtime (route exports runtime='nodejs', not edge).",
      }),
    );
    return NextResponse.json({ ok: false, error: "export_failed" }, { status: 500 });
  }
}
