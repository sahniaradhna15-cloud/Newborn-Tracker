/**
 * Idempotent local-dev seed. Inserts the locked-in development data
 * (Aradhna as owner of "My Family" + baby Anay) ONLY if no household
 * exists yet. Production goes through the /onboarding flow, never this.
 *
 * Run: `pnpm db:seed`. Standalone Node script, so it loads .env.local
 * itself (Next.js' auto-loading does not apply here).
 */
import { sql } from "drizzle-orm";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local absent — rely on the ambient environment.
}

async function main() {
  const { withAdmin } = await import("./admin");
  const { babies, households, householdMembers, recoveryCodes, users } =
    await import("./schema");
  const { generateRecoveryCode, hashRecoveryCode } = await import("../session");

  await withAdmin(async (tx) => {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(households);
    if (count > 0) {
      console.log(
        JSON.stringify({ event: "db_seed", status: "skipped", reason: "households already exist" }),
      );
      return;
    }

    const [user] = await tx
      .insert(users)
      .values({ displayName: "Mom" })
      .returning({ id: users.id });

    const [household] = await tx
      .insert(households)
      .values({ name: "My Family" })
      .returning({ id: households.id });

    await tx.insert(householdMembers).values({
      householdId: household.id,
      userId: user.id,
      role: "owner",
      displayName: "Mom",
    });

    await tx.insert(babies).values({
      householdId: household.id,
      name: "Anay Srivastava",
      birthDate: new Date("2026-04-23T00:00:00Z"),
      birthWeightOz: "109.0",
    });

    await tx.insert(recoveryCodes).values({
      userId: user.id,
      householdId: household.id,
      codeHash: hashRecoveryCode(generateRecoveryCode()),
    });

    console.log(
      JSON.stringify({ event: "db_seed", status: "inserted", household_id: household.id }),
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(
      JSON.stringify({
        event: "db_seed",
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        fix_suggestion:
          "Confirm DATABASE_URL in .env.local points at the Supabase pooled connection and migrations have been applied (pnpm db:migrate).",
      }),
    );
    process.exit(1);
  });
