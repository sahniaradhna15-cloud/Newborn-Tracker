/**
 * `GET /api/caregivers` (session) — the household roster for
 * /settings/caregivers: each member with their role, display name, and
 * how many feed/diaper events they have logged ("logged N"). RLS scopes
 * every read to the caller's household via withUserContext.
 */
import { NextResponse, type NextRequest } from "next/server";
import { count, eq, inArray } from "drizzle-orm";

import {
  babies,
  diaperEvents,
  feedEvents,
  householdMembers,
  users,
} from "@/lib/db/schema";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

export async function GET(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const members = await withUserContext(ctx.user_id, async (tx) => {
      const roster = await tx
        .select({
          userId: householdMembers.userId,
          role: householdMembers.role,
          displayName: householdMembers.displayName,
          fallbackName: users.displayName,
        })
        .from(householdMembers)
        .innerJoin(users, eq(users.id, householdMembers.userId))
        .where(eq(householdMembers.householdId, ctx.household_id));

      const babyRows = await tx
        .select({ id: babies.id })
        .from(babies)
        .where(eq(babies.householdId, ctx.household_id));
      const babyIds = babyRows.map((b) => b.id);

      const feedCounts =
        babyIds.length === 0
          ? []
          : await tx
              .select({
                loggedBy: feedEvents.loggedBy,
                n: count().as("n"),
              })
              .from(feedEvents)
              .where(inArray(feedEvents.babyId, babyIds))
              .groupBy(feedEvents.loggedBy);
      const diaperCounts =
        babyIds.length === 0
          ? []
          : await tx
              .select({
                loggedBy: diaperEvents.loggedBy,
                n: count().as("n"),
              })
              .from(diaperEvents)
              .where(inArray(diaperEvents.babyId, babyIds))
              .groupBy(diaperEvents.loggedBy);

      const tally = new Map<string, number>();
      for (const row of [...feedCounts, ...diaperCounts]) {
        if (!row.loggedBy) continue;
        tally.set(row.loggedBy, (tally.get(row.loggedBy) ?? 0) + Number(row.n));
      }

      return roster.map((m) => ({
        user_id: m.userId,
        role: m.role,
        display_name: m.displayName ?? m.fallbackName,
        logged_count: tally.get(m.userId) ?? 0,
        is_self: m.userId === ctx.user_id,
      }));
    });

    return NextResponse.json({ ok: true, members });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "caregivers_list_failed",
        route: "/api/caregivers",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Check withUserContext bound request.user_id; household_members_member RLS must let a member read co-members.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "caregivers_list_failed" },
      { status: 500 },
    );
  }
}
