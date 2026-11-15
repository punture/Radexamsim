import { runCaseAssessment, SpendTracker, type PipelineDeps, type RunContext } from "@sim/ai";
import {
  and,
  assessmentPasses,
  caseAssessments,
  desc,
  enqueue,
  eq,
  ownerReviewItems,
  skillObservations,
  stationSessions,
  type Db,
} from "@sim/db";
import { loadAttemptData } from "../data";
import { assessmentLlmDisabled, assessmentPolicy, type WorkerDeps } from "../deps";

export class RetryableJobError extends Error {}

/**
 * assess_case_attempt (spec §10). Runs the evidence-linked pipeline on frozen inputs and
 * stores every pass, the final assessment (versioned, never overwritten), derived skill
 * observations and owner review items in one transaction.
 */
export async function assessCaseAttempt(deps: WorkerDeps, payload: { caseAttemptId: string; forceSecondPass?: boolean; reason?: string }): Promise<Record<string, unknown>> {
  const { db } = deps;
  const data = await loadAttemptData(db, payload.caseAttemptId);
  if (data.mode === "owner_preview" && data.segments.length === 0) return { skipped: "owner preview without speech" };
  const disabled = await assessmentLlmDisabled(db);
  const spend = new SpendTracker(deps.config.ASSESSMENT_SPEND_CAP_USD);
  const ctx = (role: Parameters<WorkerDeps["providerFor"]>[0]): RunContext | null => {
    const provider = deps.providerFor(role);
    if (!provider) return null;
    return {
      routing: { provider, model: deps.modelFor(role) },
      spend,
      disabled,
      onTelemetry: (t) => deps.recordModelCall(t, { sessionId: data.sessionId, caseAttemptId: data.caseAttemptId, caseVersionId: data.caseVersion.versionId }),
    };
  };
  const pipeline: PipelineDeps = {
    extractor: ctx("evidence_extractor"),
    assessorA: disabled ? null : ctx("assessor_a"),
    assessorB: disabled ? null : ctx("assessor_b"),
    adjudicator: ctx("adjudicator"),
    policy: await assessmentPolicy(db),
    allowBaseline: deps.config.ALLOW_DEV_BASELINE_ASSESSOR && deps.config.NODE_ENV !== "production",
    forceSecondPass: payload.forceSecondPass,
    now: deps.now,
  };
  const result = await runCaseAssessment(data, pipeline);
  const providerFailure = !result.available && result.passes.some((p) => p.status === "unavailable" && p.validationIssues.some((i) => i.code === "timeout" || i.code === "provider_error" || i.code === "invalid_output"));

  const stored = await db.transaction(async (tx) => {
    for (const p of result.passes) {
      await tx
        .insert(assessmentPasses)
        .values({ caseAttemptId: data.caseAttemptId, stage: p.stage, assessorKind: p.assessorKind, provenance: p.provenance, inputHash: p.inputHash, output: p.output, validationIssues: p.validationIssues, status: p.status, latencyMs: p.latencyMs })
        .onConflictDoNothing();
    }
    for (const item of result.ownerItems) await tx.insert(ownerReviewItems).values(item).onConflictDoNothing();
    if (!result.available) return null;
    const [prev] = await tx.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, data.caseAttemptId)).orderBy(desc(caseAssessments.assessmentVersion)).limit(1);
    const version = (prev?.assessmentVersion ?? 0) + 1;
    const id = crypto.randomUUID();
    const payloadFinal = { ...result.final, id, assessmentVersion: version, supersedesAssessmentId: prev?.id ?? null, supersedeReason: prev ? (payload.reason ?? "reassessment") : null };
    await tx.insert(caseAssessments).values({
      id,
      caseAttemptId: data.caseAttemptId,
      userId: data.userId,
      assessmentVersion: version,
      payload: payloadFinal,
      provisional: payloadFinal.provisional,
      withheld: payloadFinal.globalRating.level === null,
      assessorKind: payloadFinal.assessorKind,
      supersedesId: prev?.id ?? null,
    });
    // Skill observations: one per element × skill, superseding earlier versions for this attempt.
    await tx.update(skillObservations).set({ superseded: true }).where(and(eq(skillObservations.caseAttemptId, data.caseAttemptId), eq(skillObservations.superseded, false)));
    const rows = payloadFinal.elementResults.flatMap((r) => {
      const el = data.caseVersion.rubric.elements.find((e) => e.id === r.elementId)!;
      return el.skills.map((skill) => ({
        userId: data.userId,
        sessionId: data.sessionId,
        caseAttemptId: data.caseAttemptId,
        assessmentId: id,
        mode: data.mode,
        profileVersionId: data.profile.versionId,
        caseFamilyId: data.caseVersion.caseFamilyId,
        elementId: r.elementId,
        skill,
        severity: r.severity,
        status: r.status,
        promptingLevel: r.promptingLevel,
        firstExposure: data.firstExposure,
        assisted: r.promptingLevel !== null && r.promptingLevel !== "spontaneous",
        isFixture: data.isFixture,
      }));
    });
    if (rows.length && data.mode !== "owner_preview") await tx.insert(skillObservations).values(rows);
    return { id, version };
  });

  if (!result.available) {
    if (providerFailure) throw new RetryableJobError(`assessment unavailable: ${result.reason}`);
    await maybeEnqueueDebrief(db, data.sessionId, `${data.caseAttemptId}:unavailable`);
    return { available: false, unavailable: result.reason };
  }
  await maybeEnqueueDebrief(db, data.sessionId, stored!.id);
  return { assessmentId: stored!.id, version: stored!.version, available: true };
}

/** When every started case of a finalizing session is settled, build the debrief. */
export async function maybeEnqueueDebrief(db: Db, sessionId: string, triggeredBy: string): Promise<void> {
  const [s] = await db.select().from(stationSessions).where(eq(stationSessions.id, sessionId));
  // Completed sessions get a new debrief VERSION after reassessment (appeal/owner decision).
  if (!s || (s.status !== "finalizing" && s.status !== "complete" && s.mode !== "practice")) return;
  await enqueue(db, { kind: "build_session_debrief", payload: { sessionId }, dedupeKey: `debrief:${sessionId}:after:${triggeredBy}`, maxAttempts: 10 });
}
