/**
 * `recomputeBabyCurrentWeight` — re-derive the denormalized
 * `babies.current_weight_oz` / `weight_updated_at` cache from the latest
 * `weight_events` row (Phase 3 Task 3).
 *
 * PLAN.md keeps `current_weight_oz` denormalized on `babies` so the
 * TodayCard intake band (targets.ts) reads one column instead of a
 * MAX(occurred_at) subquery on every dashboard render. Every weight write
 * path — POST /api/weights, PATCH/DELETE /api/weights/[id], and the
 * settings "current weight" field — funnels through this single helper so
 * the cache cannot drift from the event log (e.g. deleting the newest
 * reading must roll the cache back to the prior one, not leave it stale).
 *
 * Runs inside the caller's `withUserContext` transaction so the recompute
 * and the mutation that triggered it commit or roll back together.
 */
import { desc, eq } from "drizzle-orm";

import type { db } from "./db/client";
import { babies, weightEvents } from "./db/schema";

type TransactionCallback = Parameters<typeof db.transaction>[0];
type Tx = Parameters<TransactionCallback>[0];

export async function recomputeBabyCurrentWeight(
  tx: Tx,
  babyId: string,
): Promise<void> {
  const [latest] = await tx
    .select({
      weightOz: weightEvents.weightOz,
      occurredAt: weightEvents.occurredAt,
    })
    .from(weightEvents)
    .where(eq(weightEvents.babyId, babyId))
    .orderBy(desc(weightEvents.occurredAt))
    .limit(1);

  await tx
    .update(babies)
    .set({
      currentWeightOz: latest ? latest.weightOz : null,
      weightUpdatedAt: latest ? latest.occurredAt : null,
    })
    .where(eq(babies.id, babyId));
}
