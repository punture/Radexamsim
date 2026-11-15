import pg from "pg";
import { processStripeEvent } from "@sim/billing";
import { claimJob, completeJob, failJob, type ClaimedJob, type JobKind } from "@sim/db";
import type { WorkerDeps } from "./deps";
import { assessCaseAttempt } from "./jobs/assess";
import { buildDebrief, updateLearningPlan } from "./jobs/debrief";
import { runContentJob } from "./jobs/content";
import { runPrivacyJob } from "./jobs/privacy";

/**
 * Durable job runner (spec §14). Jobs are idempotent; failures retry with bounded backoff
 * and dead-letter into the owner queue. Offline grading never runs on the live path.
 */
export const HANDLED_KINDS: JobKind[] = [
  "assess_case_attempt",
  "reassess_after_appeal",
  "build_session_debrief",
  "update_learning_plan",
  "process_stripe_event",
  "case_automated_checks",
  "case_llm_critique",
  "case_llm_author",
  "data_export",
  "data_deletion",
  "retention_sweep",
];

export async function processJob(deps: WorkerDeps, job: ClaimedJob): Promise<Record<string, unknown>> {
  const p = job.payload as Record<string, unknown>;
  switch (job.kind as JobKind) {
    case "assess_case_attempt":
      return assessCaseAttempt(deps, { caseAttemptId: String(p.caseAttemptId) });
    case "reassess_after_appeal":
      return assessCaseAttempt(deps, { caseAttemptId: String(p.caseAttemptId), forceSecondPass: true, reason: String(p.reason ?? "appeal") });
    case "build_session_debrief":
      return buildDebrief(deps, { sessionId: String(p.sessionId) });
    case "update_learning_plan":
      return updateLearningPlan(deps, { userId: String(p.userId) });
    case "process_stripe_event":
      return { outcome: await processStripeEvent(deps.db, String(p.eventId)) };
    case "case_automated_checks":
    case "case_llm_critique":
    case "case_llm_author":
      return runContentJob(deps, job.kind as "case_automated_checks" | "case_llm_critique" | "case_llm_author", p);
    case "data_export":
    case "data_deletion":
    case "retention_sweep":
      return runPrivacyJob(deps, job.kind as "data_export" | "data_deletion" | "retention_sweep", p);
    default:
      throw new Error(`no handler for job kind ${job.kind}`);
  }
}

/** Claim and run one job. Returns false when the queue is empty. */
export async function runOnce(deps: WorkerDeps, kinds: JobKind[] = HANDLED_KINDS): Promise<boolean> {
  const job = await claimJob(deps.db, deps.config.WORKER_ID, kinds);
  if (!job) return false;
  try {
    const result = await processJob(deps, job);
    await completeJob(deps.db, job.id, result);
  } catch (e) {
    await failJob(deps.db, job, e);
  }
  return true;
}

/** Drain everything currently due (tests and one-shot runs). */
export async function drainQueue(deps: WorkerDeps, maxJobs = 200): Promise<number> {
  let n = 0;
  while (n < maxJobs && (await runOnce(deps))) n++;
  return n;
}

export async function runForever(deps: WorkerDeps, signal: AbortSignal): Promise<void> {
  const listener = new pg.Client({ connectionString: deps.config.DATABASE_URL });
  let wake: (() => void) | null = null;
  await listener.connect();
  await listener.query("LISTEN jobs_queued");
  listener.on("notification", () => wake?.());
  try {
    while (!signal.aborted) {
      const worked = await runOnce(deps).catch((e: unknown) => {
        console.error("[worker] runOnce failed", e instanceof Error ? e.message : e);
        return false;
      });
      if (worked) continue;
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 2000).unref();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      wake = null;
    }
  } finally {
    await listener.end();
  }
}
