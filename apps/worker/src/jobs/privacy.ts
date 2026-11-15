import {
  and,
  appeals,
  assessmentPasses,
  assetHandles,
  authSessions,
  caseAssessments,
  caseAttempts,
  consents,
  dataRequests,
  eq,
  examinerUtterances,
  inArray,
  learningPlans,
  lt,
  ownerReviewItems,
  processedCommands,
  recordings,
  sessionDebriefs,
  sessionEvents,
  skillObservations,
  stationSessions,
  transcriptSegments,
  usageLedger,
  users,
  viewerCommands,
  isNull,
  sql,
} from "@sim/db";
import type { WorkerDeps } from "../deps";

/**
 * Privacy jobs (spec §17): export the learner's own data (never the private case bank),
 * delete personal payloads on request, and enforce retention. Audit records and the
 * pseudonymous usage ledger are retained; they contain no transcript or clinical text.
 */
export async function runPrivacyJob(deps: WorkerDeps, kind: "data_export" | "data_deletion" | "retention_sweep", p: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (kind === "retention_sweep") return retentionSweep(deps);
  const requestId = String(p.requestId);
  const userId = String(p.userId);
  await deps.db.update(dataRequests).set({ status: "processing" }).where(eq(dataRequests.id, requestId));
  return kind === "data_export" ? exportData(deps, requestId, userId) : deleteData(deps, requestId, userId);
}

async function exportData(deps: WorkerDeps, requestId: string, userId: string) {
  const db = deps.db;
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const sessions = await db.select().from(stationSessions).where(eq(stationSessions.userId, userId));
  const sessionIds = sessions.map((s) => s.id);
  const segs = sessionIds.length ? await db.select().from(transcriptSegments).where(inArray(transcriptSegments.sessionId, sessionIds)) : [];
  const utts = sessionIds.length ? await db.select().from(examinerUtterances).where(inArray(examinerUtterances.sessionId, sessionIds)) : [];
  const debriefs = await db.select().from(sessionDebriefs).where(eq(sessionDebriefs.userId, userId));
  const plans = await db.select().from(learningPlans).where(eq(learningPlans.userId, userId));
  const myAppeals = await db.select().from(appeals).where(eq(appeals.userId, userId));
  const ledger = await db.select().from(usageLedger).where(eq(usageLedger.userId, userId));
  const myConsents = await db.select().from(consents).where(eq(consents.userId, userId));
  const doc = {
    exportedAt: new Date().toISOString(),
    note: "Your own data. The private case bank (answers, rubrics, source images) is not included; debriefs contain the reference material you were shown.",
    account: { email: u?.email, displayName: u?.displayName, createdAt: u?.createdAt },
    consents: myConsents.map((c) => ({ kind: c.kind, granted: c.granted, policyVersion: c.policyVersion, at: c.createdAt })),
    sessions: sessions.map((s) => ({
      id: s.id,
      mode: s.mode,
      profile: s.profileVersionId,
      status: s.status,
      outcome: s.outcome,
      createdAt: s.createdAt,
      transcript: segs.filter((x) => x.sessionId === s.id).map((x) => ({ atMs: x.startMs, text: x.text, source: x.source })),
      examinerHeard: utts.filter((x) => x.sessionId === s.id && x.playedChars > 0).map((x) => ({ atMs: x.playbackStartedAtMs, text: x.text.slice(0, x.playedChars) })),
      debrief: debriefs.filter((d) => d.sessionId === s.id).at(-1)?.payload ?? null,
    })),
    learningPlans: plans.map((pl) => pl.payload),
    appeals: myAppeals.map((a) => ({ id: a.id, kind: a.kind, statement: a.statement, status: a.status, resolution: a.resolution, createdAt: a.createdAt })),
    usage: ledger.map((l) => ({ kind: l.kind, minutes: l.minutes, at: l.createdAt, reason: l.reason })),
  };
  const key = `exports/${userId}/${requestId}.json`;
  await deps.storage.put("exports", key, new TextEncoder().encode(JSON.stringify(doc, null, 2)), "application/json");
  await db.update(dataRequests).set({ status: "complete", resultStorageKey: key, completedAt: new Date() }).where(eq(dataRequests.id, requestId));
  return { key };
}

async function deleteData(deps: WorkerDeps, requestId: string, userId: string) {
  const db = deps.db;
  const recs = await db.select().from(recordings).where(eq(recordings.userId, userId));
  for (const r of recs) await deps.storage.delete("recordings", r.storageKey);
  await db.transaction(async (tx) => {
    const sessionIds = (await tx.select({ id: stationSessions.id }).from(stationSessions).where(eq(stationSessions.userId, userId))).map((s) => s.id);
    const attemptIds = (await tx.select({ id: caseAttempts.id }).from(caseAttempts).where(eq(caseAttempts.userId, userId))).map((a) => a.id);
    if (attemptIds.length) {
      // Owner review items may quote the learner: redact rather than keep the text.
      for (const id of attemptIds) {
        await tx.update(ownerReviewItems).set({ detail: "[redacted after learner data deletion]", status: "dismissed" }).where(sql`${ownerReviewItems.refs}->>'caseAttemptId' = ${id}`);
      }
      await tx.delete(appeals).where(inArray(appeals.caseAttemptId, attemptIds));
      await tx.delete(skillObservations).where(inArray(skillObservations.caseAttemptId, attemptIds));
      await tx.delete(assessmentPasses).where(inArray(assessmentPasses.caseAttemptId, attemptIds));
      await tx.delete(caseAssessments).where(inArray(caseAssessments.caseAttemptId, attemptIds));
    }
    if (sessionIds.length) {
      await tx.delete(sessionDebriefs).where(inArray(sessionDebriefs.sessionId, sessionIds));
      await tx.delete(transcriptSegments).where(inArray(transcriptSegments.sessionId, sessionIds));
      await tx.delete(examinerUtterances).where(inArray(examinerUtterances.sessionId, sessionIds));
      await tx.delete(sessionEvents).where(inArray(sessionEvents.sessionId, sessionIds));
      await tx.delete(processedCommands).where(inArray(processedCommands.sessionId, sessionIds));
      await tx.delete(viewerCommands).where(inArray(viewerCommands.sessionId, sessionIds));
      await tx.delete(assetHandles).where(inArray(assetHandles.sessionId, sessionIds));
      await tx.delete(recordings).where(inArray(recordings.sessionId, sessionIds));
      // Session/attempt skeletons are kept (no personal text) for usage reconciliation.
      await tx.update(stationSessions).set({ preflight: null, technicalNotes: [] }).where(inArray(stationSessions.id, sessionIds));
    }
    await tx.delete(learningPlans).where(eq(learningPlans.userId, userId));
    await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
    await tx
      .update(users)
      .set({ email: `deleted-${userId}@deleted.invalid`, displayName: null, passwordHash: null, totpSecret: null, totpEnabled: false, externalAuthId: null, deletedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.update(dataRequests).set({ status: "complete", completedAt: new Date() }).where(eq(dataRequests.id, requestId));
  });
  return { deleted: true };
}

async function retentionSweep(deps: WorkerDeps) {
  const db = deps.db;
  const now = new Date();
  const expired = await db.select().from(recordings).where(and(lt(recordings.retainedUntil, now), isNull(recordings.deletedAt)));
  for (const r of expired) {
    await deps.storage.delete("recordings", r.storageKey);
    await db.update(recordings).set({ deletedAt: now }).where(eq(recordings.id, r.id));
  }
  const cutoff = new Date(now.getTime() - deps.config.EXPORT_RETENTION_DAYS * 86400_000);
  const oldExports = await db.select().from(dataRequests).where(and(eq(dataRequests.kind, "export"), lt(dataRequests.createdAt, cutoff)));
  for (const e of oldExports) if (e.resultStorageKey) {
    await deps.storage.delete("exports", e.resultStorageKey);
    await db.update(dataRequests).set({ resultStorageKey: null }).where(eq(dataRequests.id, e.id));
  }
  return { recordingsDeleted: expired.length, exportsDeleted: oldExports.length };
}
