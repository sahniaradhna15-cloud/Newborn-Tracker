/**
 * Volume-unit conversion. The whole app stores and computes intake in ounces
 * (oz) — DB columns, daily totals, targets, and insights are all oz. Milliliters
 * exist only at the edges (the notes importer and the bottle-entry form) and are
 * converted to oz before anything downstream sees them. One factor, one place.
 */

export const ML_PER_OZ = 29.5735;

export type VolumeUnit = "oz" | "ml";

/** Convert milliliters to ounces, rounded to 1 decimal (the DB stores 1 dp). */
export function mlToOz(ml: number): number {
  return Math.round((ml / ML_PER_OZ) * 10) / 10;
}

/** Convert ounces to milliliters, rounded to a whole ml for display. */
export function ozToMl(oz: number): number {
  return Math.round(oz * ML_PER_OZ);
}
