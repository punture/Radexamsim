import { z } from "zod";
import { IsoDateTime, OpaqueId } from "./common";

/**
 * Usage and entitlement contracts (spec §16).
 *
 * Definition of an "examination minute": one minute of ACTIVE station clock time in exam
 * or practice mode, measured by the server from station start to station end, excluding
 * technical pauses. Each station's consumption is rounded up to the next whole minute.
 * Preflight, finalization, debrief review, replay and owner preview never consume minutes.
 */

export const LedgerEntryKind = z.enum([
  "allot", // plan allowance granted for a period (or demo allowance)
  "reserve", // held at station start
  "release", // unused reservation returned at reconciliation
  "consume", // actual usage at reconciliation
  "adjust", // owner or automatic adjustment (e.g. verified platform failure)
  "expire", // allowance expired at period end
]);
export type LedgerEntryKind = z.infer<typeof LedgerEntryKind>;

export const UsageLedgerEntry = z.strictObject({
  id: OpaqueId,
  userId: OpaqueId,
  kind: LedgerEntryKind,
  /** Signed minutes: positive increases available balance, negative decreases it. */
  minutes: z.number().int(),
  sessionId: OpaqueId.nullable(),
  periodKey: z.string().nullable(),
  /** Unique idempotency key; duplicates are rejected by the database. */
  idempotencyKey: z.string().min(1),
  reason: z.string(),
  createdAt: IsoDateTime,
});
export type UsageLedgerEntry = z.infer<typeof UsageLedgerEntry>;

export const PlanId = z.enum(["demo", "individual_monthly", "individual_annual"]);
export type PlanId = z.infer<typeof PlanId>;

export const EntitlementStatus = z.enum([
  "none",
  "demo",
  "trialing",
  "active",
  "past_due",
  "canceled_pending_period_end",
  "canceled",
  "suspended",
]);
export type EntitlementStatus = z.infer<typeof EntitlementStatus>;

export const UsageSummary = z.strictObject({
  plan: PlanId.nullable(),
  entitlementStatus: EntitlementStatus,
  periodEndsAt: IsoDateTime.nullable(),
  allottedMinutes: z.number().int(),
  reservedMinutes: z.number().int(),
  consumedMinutes: z.number().int(),
  adjustedMinutes: z.number().int(),
  availableMinutes: z.number().int(),
  demoCasesRemaining: z.number().int().min(0),
  canStartPaidStation: z.boolean(),
  blockingReason: z.string().nullable(),
  /** Totals since the most recent period allowance (null before the first allowance). */
  currentPeriod: z
    .strictObject({
      startedAt: IsoDateTime,
      allottedMinutes: z.number().int(),
      consumedMinutes: z.number().int(),
      adjustedMinutes: z.number().int(),
    })
    .nullable(),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

export const PlanConfig = z.strictObject({
  id: PlanId,
  displayName: z.string(),
  /** Price display only; authoritative prices live in Stripe. Hypotheses until owner sets them. */
  priceDisplay: z.string(),
  stripePriceEnvKey: z.string().nullable(),
  includedMinutesPerPeriod: z.number().int().min(0),
  maxConcurrentStations: z.number().int().min(1),
});
export type PlanConfig = z.infer<typeof PlanConfig>;
