/**
 * `/growth` — Anay's weight plotted against WHO percentile curves, plus a
 * quick form to log a new reading.
 *
 * Server component: resolves the session, then reads the household's baby and
 * its `weight_events` inside `withUserContext` (RLS scopes both to the
 * caller's household). Session-gated like the other (app) pages — there is no
 * shared (app) layout.
 */
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { GrowthChart, type WeightPoint } from "@/components/GrowthChart";
import { WeightLogForm } from "@/components/WeightLogForm";
import { babies, weightEvents } from "@/lib/db/schema";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

export default async function GrowthPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const data = await withUserContext(auth.user_id, async (tx) => {
    const [baby] = await tx
      .select({
        id: babies.id,
        name: babies.name,
        birthDate: babies.birthDate,
      })
      .from(babies)
      .where(eq(babies.householdId, auth.household_id))
      .orderBy(asc(babies.createdAt))
      .limit(1);
    if (!baby) return null;

    const rows = await tx
      .select({
        occurredAt: weightEvents.occurredAt,
        weightOz: weightEvents.weightOz,
      })
      .from(weightEvents)
      .where(eq(weightEvents.babyId, baby.id))
      .orderBy(asc(weightEvents.occurredAt));

    const weights: WeightPoint[] = rows.map((r) => ({
      occurredAt: r.occurredAt.toISOString(),
      weightOz: Number(r.weightOz),
    }));
    return {
      name: baby.name,
      birthDate: baby.birthDate.toISOString(),
      weights,
    };
  });

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="text-2xl text-foreground">Growth</h1>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          No baby on this household yet.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-6 py-10">
      <div>
        <h1 className="mb-1 text-2xl text-foreground">Growth</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {data.name} against the WHO weight-for-age curves.
        </p>
      </div>

      <GrowthChart
        babyName={data.name}
        birthDate={data.birthDate}
        weights={data.weights}
      />

      <div className="flex justify-center">
        <WeightLogForm />
      </div>
    </main>
  );
}
