import type { EntitlementStatus, PlanId, UsageSummary } from "@sim/contracts";
import { and, entitlements, eq, sql, usageLedger, type DbOrTx } from "@sim/db";

/**
 * Usage ledger (spec §16). Immutable signed entries:
 *   allot +N | reserve -N | release +N | consume -N | adjust ±N | expire -N
 * Available balance = SUM(minutes). Reservations are taken transactionally at station start
 * (with a row lock on the user's entitlement) and reconciled at completion or recovery:
 * the reservation is released in full and the actual consumption is recorded. Every entry
 * has a unique idempotency key, so retries, reconnects and duplicate jobs cannot
 * double-charge.
 */

export type LedgerRow = { kind: string; minutes: number; sessionId: string | null };

export function summarize(rows: readonly LedgerRow[]) {
  let allotted = 0;
  let consumed = 0;
  let adjusted = 0;
  let expired = 0;
  const reserveBySession = new Map<string, number>();
  for (const r of rows) {
    switch (r.kind) {
      case "allot":
        allotted += r.minutes;
        break;
      case "consume":
        consumed += -r.minutes;
        break;
      case "adjust":
        adjusted += r.minutes;
        break;
      case "expire":
        expired += -r.minutes;
        break;
      case "reserve":
      case "release":
        if (r.sessionId) reserveBySession.set(r.sessionId, (reserveBySession.get(r.sessionId) ?? 0) - r.minutes);
        break;
    }
  }
  const reserved = [...reserveBySession.values()].reduce((a, b) => a + Math.max(0, b), 0);
  const available = rows.reduce((a, r) => a + r.minutes, 0);
  return { allotted, reserved, consumed, adjusted, expired, available };
}

export function canStart(status: EntitlementStatus): boolean {
  return status === "active" || status === "trialing" || status === "canceled_pending_period_end";
}

export async function usageSummary(db: DbOrTx, userId: string): Promise<UsageSummary> {
  const rows = await db
    .select({ kind: usageLedger.kind, minutes: usageLedger.minutes, sessionId: usageLedger.sessionId, createdAt: usageLedger.createdAt })
    .from(usageLedger)
    .where(eq(usageLedger.userId, userId));
  // The current period starts at the most recent allowance; earlier leftovers were expired then.
  const lastAllot = rows.filter((r) => r.kind === "allot").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const period = lastAllot ? summarize(rows.filter((r) => r.createdAt.getTime() >= lastAllot.createdAt.getTime() && r.kind !== "expire")) : null;
  const [ent] = await db.select().from(entitlements).where(eq(entitlements.userId, userId));
  const s = summarize(rows);
  const status = (ent?.status ?? "none") as EntitlementStatus;
  const blockingReason = !canStart(status)
    ? status === "past_due"
      ? "Payment failed. Update your payment method in the billing portal to start new stations."
      : status === "suspended"
        ? "Your account is under review. Contact support."
        : "No active subscription. The free demonstration case remains available."
    : s.available <= 0
      ? "No examination minutes remaining in this period."
      : null;
  return {
    plan: (ent?.planId ?? null) as PlanId | null,
    entitlementStatus: status,
    periodEndsAt: ent?.periodEnd ? ent.periodEnd.toISOString() : null,
    allottedMinutes: s.allotted,
    reservedMinutes: s.reserved,
    consumedMinutes: s.consumed,
    adjustedMinutes: s.adjusted,
    availableMinutes: Math.max(0, s.available),
    demoCasesRemaining: ent?.demoCasesRemaining ?? 1,
    canStartPaidStation: canStart(status) && s.available > 0,
    blockingReason,
    currentPeriod: lastAllot && period ? { startedAt: lastAllot.createdAt.toISOString(), allottedMinutes: period.allotted, consumedMinutes: period.consumed, adjustedMinutes: period.adjusted } : null,
  };
}

async function lockEntitlement(tx: DbOrTx, userId: string) {
  await tx.insert(entitlements).values({ userId }).onConflictDoNothing();
  const res = await tx.execute<{ status: string; demo_cases_remaining: number }>(
    sql`SELECT status, demo_cases_remaining FROM entitlements WHERE user_id = ${userId} FOR UPDATE`,
  );
  return res.rows[0]!;
}

async function insertEntry(
  tx: DbOrTx,
  e: { userId: string; kind: LedgerRow["kind"]; minutes: number; sessionId?: string | null; periodKey?: string | null; idempotencyKey: string; reason: string; actor: string },
): Promise<boolean> {
  const r = await tx
    .insert(usageLedger)
    .values({
      userId: e.userId,
      kind: e.kind as "allot",
      minutes: e.minutes,
      sessionId: e.sessionId ?? null,
      periodKey: e.periodKey ?? null,
      idempotencyKey: e.idempotencyKey,
      reason: e.reason,
      actor: e.actor,
    })
    .onConflictDoNothing({ target: usageLedger.idempotencyKey })
    .returning({ id: usageLedger.id });
  return r.length > 0;
}

export type ReserveResult = { ok: true; reservedMinutes: number; alreadyReserved: boolean } | { ok: false; code: "not_entitled" | "insufficient_minutes"; message: string };

/** Reserve the full station duration at start. Idempotent per session. */
export async function reserveForSession(tx: DbOrTx, userId: string, sessionId: string, minutes: number): Promise<ReserveResult> {
  const ent = await lockEntitlement(tx, userId);
  const existing = await tx.select().from(usageLedger).where(and(eq(usageLedger.idempotencyKey, `reserve:${sessionId}`)));
  if (existing[0]) return { ok: true, reservedMinutes: -existing[0].minutes, alreadyReserved: true };
  if (!canStart(ent.status as EntitlementStatus)) {
    return { ok: false, code: "not_entitled", message: "An active subscription is required to start this station." };
  }
  const bal = await tx.select({ total: sql<number>`coalesce(sum(${usageLedger.minutes}), 0)::int` }).from(usageLedger).where(eq(usageLedger.userId, userId));
  const available = bal[0]?.total ?? 0;
  if (available < minutes) {
    return { ok: false, code: "insufficient_minutes", message: `This station needs ${minutes} minutes; ${Math.max(0, available)} remain in this period.` };
  }
  await insertEntry(tx, { userId, kind: "reserve", minutes: -minutes, sessionId, idempotencyKey: `reserve:${sessionId}`, reason: "station start", actor: "system" });
  return { ok: true, reservedMinutes: minutes, alreadyReserved: false };
}

/**
 * Reconcile at station end/recovery: release the reservation and record actual use.
 * `platformFailure` adds an automatic adjustment restoring the consumed minutes.
 */
export async function reconcileSession(
  tx: DbOrTx,
  userId: string,
  sessionId: string,
  consumedMinutes: number,
  opts: { platformFailure?: boolean } = {},
): Promise<{ released: number; consumed: number; adjusted: number }> {
  await lockEntitlement(tx, userId);
  const [reserve] = await tx.select().from(usageLedger).where(eq(usageLedger.idempotencyKey, `reserve:${sessionId}`));
  if (!reserve) return { released: 0, consumed: 0, adjusted: 0 }; // demo/owner sessions reserve nothing
  const reserved = -reserve.minutes;
  const consumed = Math.min(reserved, Math.max(0, consumedMinutes));
  await insertEntry(tx, { userId, kind: "release", minutes: reserved, sessionId, idempotencyKey: `release:${sessionId}`, reason: "station reconciled", actor: "system" });
  await insertEntry(tx, { userId, kind: "consume", minutes: -consumed, sessionId, idempotencyKey: `consume:${sessionId}`, reason: "active station time", actor: "system" });
  let adjusted = 0;
  if (opts.platformFailure && consumed > 0) {
    const inserted = await insertEntry(tx, { userId, kind: "adjust", minutes: consumed, sessionId, idempotencyKey: `adjust:platform-failure:${sessionId}`, reason: "automatic credit: verified platform failure", actor: "system" });
    if (inserted) adjusted = consumed;
  }
  return { released: reserved, consumed, adjusted };
}

/** Owner-controlled adjustment (positive credit or negative correction). */
export async function ownerAdjust(tx: DbOrTx, userId: string, minutes: number, reason: string, actor: string, key: string): Promise<boolean> {
  return insertEntry(tx, { userId, kind: "adjust", minutes, idempotencyKey: `adjust:owner:${key}`, reason, actor });
}

/** Start a new allowance period: expire leftovers from the previous period, then allot. */
export async function allotPeriod(
  tx: DbOrTx,
  userId: string,
  periodKey: string,
  minutes: number,
  actor: string,
): Promise<boolean> {
  await lockEntitlement(tx, userId);
  const already = await tx.select().from(usageLedger).where(eq(usageLedger.idempotencyKey, `allot:${periodKey}`));
  if (already[0]) return false;
  const bal = await tx.select({ total: sql<number>`coalesce(sum(${usageLedger.minutes}), 0)::int` }).from(usageLedger).where(eq(usageLedger.userId, userId));
  const openReserved = await tx.execute<{ reserved: number }>(sql`
    SELECT coalesce(sum(-minutes), 0)::int AS reserved FROM usage_ledger r
    WHERE r.user_id = ${userId} AND r.kind = 'reserve'
      AND NOT EXISTS (SELECT 1 FROM usage_ledger x WHERE x.idempotency_key = 'release:' || r.session_id::text)`);
  const leftover = (bal[0]?.total ?? 0) + (openReserved.rows[0]?.reserved ?? 0);
  if (leftover > 0) {
    await insertEntry(tx, { userId, kind: "expire", minutes: -leftover, periodKey, idempotencyKey: `expire-before:${periodKey}`, reason: "unused minutes expire at period end (no rollover)", actor });
  }
  return insertEntry(tx, { userId, kind: "allot", minutes, periodKey, idempotencyKey: `allot:${periodKey}`, reason: "period allowance", actor });
}

/** Consume one free demonstration case (no minutes). */
export async function consumeDemoCase(tx: DbOrTx, userId: string): Promise<boolean> {
  const ent = await lockEntitlement(tx, userId);
  if (ent.demo_cases_remaining <= 0) return false;
  await tx.update(entitlements).set({ demoCasesRemaining: sql`${entitlements.demoCasesRemaining} - 1`, updatedAt: new Date() }).where(eq(entitlements.userId, userId));
  return true;
}
