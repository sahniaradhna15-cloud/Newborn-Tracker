import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { ssl: "require" });

  const householdId = "2855eb2d-5f70-4e80-bf72-0d7288f50258";

  // All babies in her household (not just LIMIT 1)
  const allBabies = await sql`
    SELECT id, name, birth_date, current_weight_oz, weight_updated_at
    FROM babies
    WHERE household_id = ${householdId}
    ORDER BY name
  `;
  console.log(`All babies in household ${householdId}:`);
  console.log(JSON.stringify(allBabies, null, 2));

  // For each baby, how many May 26 feeds?
  for (const b of allBabies) {
    const r = await sql`
      SELECT count(*) AS feeds_may26
      FROM feed_events
      WHERE baby_id = ${b.id}
        AND occurred_at >= '2026-05-26T09:00Z'
        AND occurred_at < '2026-05-27T09:00Z'
    `;
    console.log(`baby ${b.id} (${b.name}): May 26 feeds = ${r[0].feeds_may26}`);
  }

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
