/**
 * The canonical `InboundEvent` — every integration (PWA forms, Siri, Watch,
 * future Alexa/WhatsApp) converges on this one shape and is validated by this
 * one Zod schema before it ever reaches {@link recordEvent}. Mirrors
 * TECHNICAL_SPEC §5.1.
 *
 * Zod 4 adaptations vs. the spec's pseudocode (behaviour identical):
 * - `event` is a `z.union`, not `z.discriminatedUnion('type', …)`: `FeedEvent`
 *   is a `ZodIntersection` (object ∧ discriminatedUnion-on-kind), and Zod
 *   cannot read a discriminator key through an intersection. Validation is
 *   still exhaustive; only the failure message is slightly less targeted.
 * - `z.record(z.string(), z.unknown())` (Zod 4 requires the explicit key type).
 * - `z.uuid()` / `z.iso.datetime()` (Zod 4 top-level forms).
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* event variants                                                      */
/* ------------------------------------------------------------------ */

const FeedNursing = z.object({
  kind: z.literal("nursing"),
  side: z.enum(["left", "right", "both"]),
  duration_min: z.number().int().positive().max(180),
});

const FeedBottle = z.object({
  kind: z.enum(["pumped", "formula"]),
  volume_oz: z.number().positive().max(20),
  wasted_oz: z.number().nonnegative().max(20).optional(),
});

const FeedEvent = z
  .object({ type: z.literal("feed") })
  .and(z.discriminatedUnion("kind", [FeedNursing, FeedBottle]));

const DiaperEvent = z
  .object({
    type: z.literal("diaper"),
    pee: z.boolean().default(false),
    poop: z.boolean().default(false),
  })
  .refine((d) => d.pee || d.poop, "diaper must be pee or poop");

const MomEvent = z.object({
  type: z.literal("mom"),
  kind: z.enum(["medication", "mood", "note", "pump_only"]),
  payload: z.record(z.string(), z.unknown()),
});

/* ------------------------------------------------------------------ */
/* the wire envelope                                                   */
/* ------------------------------------------------------------------ */

export const InboundEvent = z.object({
  client_uuid: z.uuid(),
  source: z.enum(["pwa", "siri_shortcut", "apple_watch", "web", "health_bridge", "import"]),
  source_event_id: z.string().optional(),
  occurred_at: z.iso.datetime(),
  baby_id: z.uuid().optional(),
  event: z.union([FeedEvent, DiaperEvent, MomEvent]),
  raw: z.record(z.string(), z.unknown()).optional(),
  note: z.string().max(500).optional(),
});

export type InboundEvent = z.infer<typeof InboundEvent>;
export type InboundFeedEvent = z.infer<typeof FeedEvent>;
export type InboundDiaperEvent = z.infer<typeof DiaperEvent>;
export type InboundMomEvent = z.infer<typeof MomEvent>;

/* ------------------------------------------------------------------ */
/* shared form-input schemas (react-hook-form ⇄ route handler)         */
/* ------------------------------------------------------------------ */
/**
 * The flat shapes the PWA forms post to `/api/feeds` and `/api/diapers`.
 * The route handlers re-validate with these same schemas, then lift the
 * result into an {@link InboundEvent} for {@link recordEvent}. `client_uuid`
 * is generated client-side at submit (not a user-facing field), so it is
 * validated on the wire schema below, not the form schema.
 */
/** Blank form fields arrive as "" — treat them as absent before coercion. */
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const FeedInput = z
  .object({
    kind: z.enum(["nursing", "pumped", "formula"]),
    side: z.enum(["left", "right", "both"]).optional(),
    duration_min: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().max(180).optional(),
    ),
    volume_oz: z.preprocess(
      emptyToUndefined,
      z.coerce.number().positive().max(20).optional(),
    ),
    wasted_oz: z.preprocess(
      emptyToUndefined,
      z.coerce.number().nonnegative().max(20).optional(),
    ),
    occurred_at: z.iso.datetime(),
    note: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "nursing") {
      if (!v.side)
        ctx.addIssue({ code: "custom", path: ["side"], message: "Pick a side" });
      if (v.duration_min == null)
        ctx.addIssue({
          code: "custom",
          path: ["duration_min"],
          message: "Enter minutes",
        });
    } else if (v.volume_oz == null) {
      ctx.addIssue({
        code: "custom",
        path: ["volume_oz"],
        message: "Enter ounces",
      });
    }
  });
export type FeedInput = z.infer<typeof FeedInput>;

export const DiaperInput = z
  .object({
    pee: z.boolean().default(false),
    poop: z.boolean().default(false),
    occurred_at: z.iso.datetime(),
    note: z.string().max(500).optional(),
  })
  .refine((d) => d.pee || d.poop, "Tap Wet, Dirty, or both");
export type DiaperInput = z.infer<typeof DiaperInput>;

export const FEED_WASTED_NOTE = "wasted_oz is tracked separately and excluded from intake totals";
