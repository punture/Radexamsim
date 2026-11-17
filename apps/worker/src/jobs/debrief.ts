import { randomBytes } from "node:crypto";
import type { SessionDebrief } from "@sim/contracts";
import { CaseVersion, ExamProfileVersion } from "@sim/contracts";
import {
  buildLearningPlan,
  composeCaseDebrief,
  feedbackWriterPrompt,
  runPrompt,
  validateFeedbackSummary,
  type CaseOption,
  type SkillObservation,
} from "@sim/ai";
import { modelUseAllowed } from "@sim/clinical-content";
import {
  and,
  appendEvent,
  asc,
  caseAssessments,
  caseAttempts,
  caseVersions,
  cases,
  desc,
  enqueue,
  eq,
  examProfiles,
  isNull,
  jobs,
  learningPlans,
  sessionDebriefs,
  skillObservations,
  stationSessions,
  transcriptSegments,
  type Db,
} from "@sim/db";
import type { WorkerDeps } from "../deps";
import { RetryableJobError } from "./assess";

/**
 * build_session_debrief (spec §4.9–10, §11): compose the debrief from supported assessment
 * facts once every started case is settled, then complete the session. Exam-mode feedback
 * is released only now.
 */
export async function buildDebrief(deps: WorkerDeps, payload: { sessionId: string }): Promise<Record<string, unknown>> {
  const { db } = deps;
  const [session] = await db.select().from(stationSessions).where(eq(stationSessions.id, payload.sessionId));
  if (!session) return { skipped: "session not found" };
  if (session.status !== "finalizing" && session.status !== "complete") return { skipped: `session is ${session.status}` };
  const [pRow] = await db.select().from(examProfiles).where(eq(examProfiles.versionId, session.profileVersionId));
  const profile = ExamProfileVersion.parse(pRow!.payload);
  const attempts = await db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, session.id)).orderBy(asc(caseAttempts.ordinal));
  const started = attempts.filter((a) => a.startedAtMs !== null);

  const cases_: SessionDebrief["cases"] = [];
  let unavailable = 0;
  for (const at of started) {
    const [a] = await db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, at.id)).orderBy(desc(caseAssessments.assessmentVersion)).limit(1);
    if (!a) {
      const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `assess:${at.id}:v1`));
      const settled = job && (job.status === "dead" || (job.status === "succeeded" && (job.result as { available?: boolean } | null)?.available === false));
      if (!settled) throw new RetryableJobError(`case ${at.ordinal + 1} is still being assessed`);
      unavailable++;
      continue;
    }
    const [cvRow] = await db.select().from(caseVersions).where(eq(caseVersions.versionId, at.caseVersionId));
    const cv = CaseVersion.parse(cvRow!.payload);
    const segs = await db.select().from(transcriptSegments).where(and(eq(transcriptSegments.caseAttemptId, at.id), eq(transcriptSegments.status, "final"))).orderBy(asc(transcriptSegments.startMs));
    const segments = segs.map((s) => ({ id: s.id, text: s.text, startMs: s.startMs, endMs: s.endMs, source: s.source, confidence: s.confidence, words: s.words }));
    const label = `Case ${at.ordinal + 1} of ${attempts.length}`;
    let debrief = composeCaseDebrief({ assessmentId: a.id, assessment: a.payload, caseVersion: cv, profile, caseLabel: label, segments, caseStartedAtMs: at.startedAtMs ?? 0 });

    // Optional model-written summary, accepted only if it stays within supported facts.
    const provider = deps.providerFor("feedback_writer");
    if (provider && deps.config.USE_LLM_FEEDBACK_SUMMARY && a.payload.assessorKind !== "dev_baseline" && modelUseAllowed(cv, deps.config.LLM_FIXTURES_ONLY)) {
      const input = {
        caseLabel: label,
        ratingDisplay: debrief.overall.ratingDisplay,
        provisional: debrief.overall.provisional,
        withheldReason: debrief.overall.withheldReason,
        uncertaintyReasons: a.payload.uncertaintyReasons,
        strengths: debrief.strengths.map((s) => ({ construct: s.summary, quote: s.evidence[0]?.quote ?? "", prompting: s.promptingLevel })),
        issues: debrief.issues.slice(0, 4).map((i) => ({ construct: i.whatHappened, severity: i.severity, status: i.status, whatHappened: i.whatHappened, whyItMatters: i.whyItMatters })),
        technicalLimitations: debrief.technicalLimitations,
      };
      const r = await runPrompt(feedbackWriterPrompt, input, {
        routing: { provider, model: deps.modelFor("feedback_writer") },
        onTelemetry: (t) => deps.recordModelCall(t, { sessionId: session.id, caseAttemptId: at.id, caseVersionId: cv.versionId }),
      });
      if (r.ok && validateFeedbackSummary(r.data.overallSummary, input).length === 0) {
        debrief = composeCaseDebrief({ assessmentId: a.id, assessment: a.payload, caseVersion: cv, profile, caseLabel: label, segments, caseStartedAtMs: at.startedAtMs ?? 0, validatedSummary: r.data.overallSummary });
      }
    }
    cases_.push(debrief);
  }

  const plan = await computePlan(db, session.userId, deps.now());
  const first = plan.plan.items.find((i) => i.kind === "unseen_case" || i.kind === "revision_practice") ?? plan.plan.items[0];
  const debrief: SessionDebrief = {
    sessionId: session.id,
    mode: session.mode,
    status: unavailable > 0 ? (cases_.length ? "partial" : "unavailable") : "available",
    pendingReason: unavailable > 0 ? "The assessment service could not produce a result for some cases. Your attempt is saved; nothing was estimated in its place." : null,
    cases: cases_,
    nextActivity: first
      ? { kind: first.kind === "unseen_case" ? "unseen_case" : first.kind === "revision_practice" ? "revision_practice" : "none_available", description: first.description, targetSkills: first.targetSkills }
      : null,
  };

  await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(sessionDebriefs).where(eq(sessionDebriefs.sessionId, session.id)).orderBy(desc(sessionDebriefs.version)).limit(1);
    await tx.insert(sessionDebriefs).values({ sessionId: session.id, userId: session.userId, version: (prev?.version ?? 0) + 1, payload: debrief });
    if (session.status === "finalizing") {
      await tx.update(stationSessions).set({ status: "complete", finalizedAt: new Date() }).where(eq(stationSessions.id, session.id));
      await appendEvent(tx, { sessionId: session.id, caseAttemptId: null, type: "session.finalized", sessionClockMs: session.clock.accumulatedActiveMs, payload: { cases: cases_.length, unavailable }, contentVersions: { profileVersionId: session.profileVersionId, caseVersionId: null, rubricVersionId: null } });
    }
    await enqueue(tx, { kind: "update_learning_plan", payload: { userId: session.userId }, dedupeKey: `plan:${session.userId}:${session.id}` });
  });
  return { cases: cases_.length, unavailable };
}

/** Deterministic plan from the learner's observations and the published case bank. */
export async function computePlan(db: Db, userId: string, now: Date) {
  const obs = await db.select().from(skillObservations).where(and(eq(skillObservations.userId, userId), eq(skillObservations.superseded, false)));
  const published = await db
    .select({ payload: caseVersions.payload })
    .from(cases)
    .innerJoin(caseVersions, eq(caseVersions.versionId, cases.publishedVersionId))
    .where(isNull(cases.withdrawnAt));
  const seenRows = await db.select({ f: caseAttempts.caseFamilyId }).from(caseAttempts).where(and(eq(caseAttempts.userId, userId), eq(caseAttempts.status, "closed")));
  const seen = new Set(seenRows.map((r) => r.f));
  const available: CaseOption[] = published.map((p) => ({ caseId: p.payload.caseId, caseFamilyId: p.payload.caseFamilyId, skills: p.payload.tags.skills, track: p.payload.track }));
  const assignments: Record<string, string> = {};
  const practiceActionFor = new Map<string, string>();
  for (const p of published) for (const el of p.payload.rubric.elements) practiceActionFor.set(`${p.payload.caseFamilyId}:${el.id}`, el.feedbackGuidance.practiceAction);
  const observations: SkillObservation[] = obs.map((o) => ({
    skill: o.skill as SkillObservation["skill"],
    status: o.status,
    severity: o.severity as SkillObservation["severity"],
    mode: o.mode,
    caseFamilyId: o.caseFamilyId,
    firstExposure: o.firstExposure,
    assisted: o.assisted,
    isFixture: o.isFixture,
    createdAt: o.createdAt,
    practiceAction: practiceActionFor.get(`${o.caseFamilyId}:${o.elementId}`) ?? null,
  }));
  const plan = buildLearningPlan({
    userId,
    observations,
    availableCases: available,
    seenFamilyIds: seen,
    now,
    planId: crypto.randomUUID(),
    tokenFor: (caseId) => {
      const t = `as_${randomBytes(12).toString("hex")}`;
      assignments[t] = caseId;
      return t;
    },
  });
  return { plan, assignments };
}

export async function updateLearningPlan(deps: WorkerDeps, payload: { userId: string }): Promise<Record<string, unknown>> {
  const { plan, assignments } = await computePlan(deps.db, payload.userId, deps.now());
  await deps.db.transaction(async (tx) => {
    await tx.update(learningPlans).set({ supersededAt: new Date() }).where(and(eq(learningPlans.userId, payload.userId), isNull(learningPlans.supersededAt)));
    await tx.insert(learningPlans).values({ id: plan.id, userId: payload.userId, payload: plan, assignments });
  });
  return { planId: plan.id, focus: plan.focusSkills };
}
