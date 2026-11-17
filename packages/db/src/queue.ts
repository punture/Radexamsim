import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "./client";
import { jobs, ownerReviewItems } from "./schema";

/**
 * Durable job queue in PostgreSQL (spec §14). Jobs are enqueued inside the same
 * transaction as the state change that requires them (transactional outbox), so a
 * committed finalization always has its assessment job and a rolled-back one never does.
 * Claiming uses FOR UPDATE SKIP LOCKED; retries are bounded with exponential backoff and
 * exhausted jobs move to a dead-letter status that raises an owner review item.
 * Redis is not required; nothing durable lives in an ephemeral store.
 */

export type JobKind =
  | "assess_case_attempt"
  | "build_session_debrief"
  | "update_learning_plan"
  | "process_stripe_event"
  | "case_automated_checks"
  | "case_llm_critique"
  | "case_llm_author"
  | "reassess_after_appeal"
  | "data_export"
  | "data_deletion"
  | "retention_sweep";

export type EnqueueOptions = {
  kind: JobKind;
  payload: Record<string, unknown>;
  /** Unique key: re-enqueueing the same logical job is a no-op (idempotent). */
  dedupeKey: string;
  runAt?: Date;
  maxAttempts?: number;
};

export async function enqueue(tx: DbOrTx, opts: EnqueueOptions): Promise<{ id: string; created: boolean }> {
  const inserted = await tx
    .insert(jobs)
    .values({
      kind: opts.kind,
      payload: opts.payload,
      dedupeKey: opts.dedupeKey,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  if (inserted[0]) return { id: inserted[0].id, created: true };
  const existing = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, opts.dedupeKey));
  return { id: existing[0]!.id, created: false };
}

export type ClaimedJob = typeof jobs.$inferSelect;

/** Claim the next due job of the given kinds. Leases expire after `leaseMs`. */
export async function claimJob(db: Db, workerId: string, kinds: readonly JobKind[], leaseMs = 5 * 60_000): Promise<ClaimedJob | null> {
  // Requeue jobs whose worker died mid-run (lease expired).
  await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, lastError: sql`coalesce(${jobs.lastError}, '') || ' [lease expired]'`, updatedAt: new Date() })
    .where(and(eq(jobs.status, "running"), lte(jobs.lockedAt, new Date(Date.now() - leaseMs))));

  const res = await db.execute<ClaimedJob>(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_at <= now() AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      ORDER BY run_at, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, payload, status, attempts, max_attempts AS "maxAttempts", run_at AS "runAt", locked_at AS "lockedAt",
              locked_by AS "lockedBy", last_error AS "lastError", dedupe_key AS "dedupeKey", result, created_at AS "createdAt", updated_at AS "updatedAt"`);
  return res.rows[0] ?? null;
}

export async function completeJob(db: DbOrTx, id: string, result: Record<string, unknown> = {}): Promise<void> {
  await db.update(jobs).set({ status: "succeeded", result, lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, id));
}

export function backoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** Record a failure: retry with backoff, or dead-letter and raise an owner review item. */
export async function failJob(db: Db, job: ClaimedJob, error: unknown): Promise<"retry" | "dead"> {
  const message = redactError(error);
  if (job.attempts >= job.maxAttempts) {
    await db.transaction(async (tx) => {
      await tx.update(jobs).set({ status: "dead", lastError: message, lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      await tx
        .insert(ownerReviewItems)
        .values({
          kind: "technical_failure_adjustment",
          priority: "normal",
          title: `Background job failed permanently: ${job.kind}`,
          detail: `Job ${job.id} exhausted ${job.maxAttempts} attempts. Last error: ${message}. No result was fabricated; the affected item shows as unavailable until retried.`,
          refs: { jobId: job.id, kind: job.kind },
          dedupeKey: `dead-job:${job.id}`,
        })
        .onConflictDoNothing();
    });
    return "dead";
  }
  await db
    .update(jobs)
    .set({ status: "queued", lastError: message, lockedAt: null, lockedBy: null, runAt: new Date(Date.now() + backoffMs(job.attempts)), updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
  return "retry";
}

/** Manually requeue dead jobs (owner action). */
export async function requeueDead(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await db
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(and(inArray(jobs.id, ids), eq(jobs.status, "dead")))
    .returning({ id: jobs.id });
  return r.length;
}

/** Errors are stored without clinical text or credentials. */
export function redactError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "[redacted-key]")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/AIza[0-9A-Za-z_-]{35}/g, "[redacted-key]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}
