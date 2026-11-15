import type { ElementResult, FinalCaseAssessment, RatingLevel } from "@sim/contracts";
import { CaseVersion } from "@sim/contracts";
import { displayRating } from "@sim/clinical-content";
import { applyCaps, creditFor, deterministicLevel, withholdReason, type ValidatedJudgment } from "@sim/ai";
import {
  and,
  appeals,
  assessmentPasses,
  asc,
  caseAssessments,
  caseAttempts,
  caseVersions,
  desc,
  enqueue,
  eq,
  examinerUtterances,
  ownerReviewItems,
  sessionEvents,
  sql,
  stationSessions,
  transcriptSegments,
} from "@sim/db";
import type { Deps } from "../deps";
import { HttpError, conflict, notFound } from "../http";
import { audit } from "./audit";
import { getProfile } from "./content";

/** Everything about one attempt for owner review (owner-only view; includes truth and passes). */
export async function ownerAttemptView(deps: Deps, caseAttemptId: string) {
  const { db } = deps;
  const [at] = await db.select().from(caseAttempts).where(eq(caseAttempts.id, caseAttemptId));
  if (!at) throw notFound("case attempt");
  const [session] = await db.select().from(stationSessions).where(eq(stationSessions.id, at.sessionId));
  const [cvRow] = await db.select().from(caseVersions).where(eq(caseVersions.versionId, at.caseVersionId));
  const segments = await db.select().from(transcriptSegments).where(eq(transcriptSegments.caseAttemptId, at.id)).orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.revision));
  const utterances = await db.select().from(examinerUtterances).where(eq(examinerUtterances.caseAttemptId, at.id)).orderBy(asc(examinerUtterances.plannedAtMs));
  const passes = await db.select().from(assessmentPasses).where(eq(assessmentPasses.caseAttemptId, at.id)).orderBy(asc(assessmentPasses.createdAt));
  const assessments = await db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, at.id)).orderBy(asc(caseAssessments.assessmentVersion));
  const events = await db.select({ seq: sessionEvents.seq, type: sessionEvents.type, ms: sessionEvents.sessionClockMs, payload: sessionEvents.payload }).from(sessionEvents).where(and(eq(sessionEvents.sessionId, at.sessionId), eq(sessionEvents.caseAttemptId, at.id))).orderBy(asc(sessionEvents.seq));
  const items = await db.select().from(ownerReviewItems).where(sql`${ownerReviewItems.refs}->>'caseAttemptId' = ${at.id}`);
  const attemptAppeals = await db.select().from(appeals).where(eq(appeals.caseAttemptId, at.id));
  return {
    attempt: { id: at.id, ordinal: at.ordinal, status: at.status, closeReason: at.closeReason, startedAtMs: at.startedAtMs, endedAtMs: at.endedAtMs, firstExposure: at.firstExposure },
    session: session ? { id: session.id, mode: session.mode, status: session.status, outcome: session.outcome, profileVersionId: session.profileVersionId, technicalNotes: session.technicalNotes } : null,
    caseVersion: cvRow ? CaseVersion.parse(cvRow.payload) : null,
    segments,
    utterances,
    passes,
    assessments,
    events,
    reviewItems: items,
    appeals: attemptAppeals,
  };
}

async function latest(deps: Deps, caseAttemptId: string) {
  const [a] = await deps.db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, caseAttemptId)).orderBy(desc(caseAssessments.assessmentVersion)).limit(1);
  if (!a) throw notFound("assessment");
  return a;
}

/**
 * Owner decision on a disputed or uncertain element. Creates a NEW assessment version (the
 * previous one is preserved), recomputes caps/withholding, and rebuilds the debrief.
 */
export async function resolveElement(
  deps: Deps,
  ownerId: string,
  caseAttemptId: string,
  body: { elementId: string; status: ElementResult["status"]; rationale: string; globalLevel?: RatingLevel | null },
) {
  const { db } = deps;
  const prev = await latest(deps, caseAttemptId);
  const [at] = await db.select().from(caseAttempts).where(eq(caseAttempts.id, caseAttemptId));
  const [cvRow] = await db.select().from(caseVersions).where(eq(caseVersions.versionId, at!.caseVersionId));
  const cv = CaseVersion.parse(cvRow!.payload);
  const [session] = await db.select().from(stationSessions).where(eq(stationSessions.id, at!.sessionId));
  const profile = await getProfile(db, session!.profileVersionId);
  const el = cv.rubric.elements.find((e) => e.id === body.elementId);
  if (!el) throw notFound("rubric element");
  const p = prev.payload;
  const elementResults = p.elementResults.map((r) => {
    if (r.elementId !== body.elementId) return r;
    if ((body.status === "demonstrated" || body.status === "partially_demonstrated" || body.status === "incorrect") && r.evidence.length === 0) {
      throw new HttpError(400, "evidence_required", "this status needs candidate evidence; the existing judgment has no verified quote");
    }
    const prompting = body.status === "demonstrated" || body.status === "partially_demonstrated" ? r.promptingLevel ?? "spontaneous" : null;
    return { ...r, status: body.status, promptingLevel: prompting, credit: creditFor(el, body.status, prompting), rationale: `Owner decision: ${body.rationale}`, uncertaintyReason: null, agreement: "adjudicated" as const };
  });
  const disputed = p.disputedElementIds.filter((id) => id !== body.elementId);
  const judgments = new Map(elementResults.map((r) => [r.elementId, r as unknown as ValidatedJudgment]));
  const base: RatingLevel | null = body.globalLevel !== undefined ? body.globalLevel : (p.globalRating.level ?? deterministicLevel([...judgments.values()], p.unsafeFlags));
  const caps = applyCaps(cv, base, judgments, p.unsafeFlags);
  const withheld = withholdReason(cv, judgments, disputed);
  const level = withheld ? null : caps.level;
  const next: FinalCaseAssessment = {
    ...p,
    id: crypto.randomUUID(),
    assessmentVersion: prev.assessmentVersion + 1,
    elementResults,
    disputedElementIds: disputed,
    provisional: disputed.length > 0 || p.assessorKind === "dev_baseline",
    globalRating: { level, display: level ? displayRating(profile, level) : null, withheldReason: withheld, capsApplied: caps.capsApplied },
    criticalConcerns: caps.criticalConcerns,
    uncertaintyReasons: elementResults.filter((r) => r.status === "uncertain").map((r) => `${r.elementId}: ${r.uncertaintyReason ?? "uncertain"}`),
    supersedesAssessmentId: prev.id,
    supersedeReason: `owner decision on ${body.elementId}`,
    createdAt: new Date().toISOString(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(caseAssessments).values({ id: next.id, caseAttemptId, userId: at!.userId, assessmentVersion: next.assessmentVersion, payload: next, provisional: next.provisional, withheld: level === null, assessorKind: next.assessorKind, supersedesId: prev.id });
    await tx.update(ownerReviewItems).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: ownerId, resolution: `owner set ${body.status}` }).where(and(eq(ownerReviewItems.dedupeKey, `disagreement:${caseAttemptId}:${body.elementId}`)));
    await enqueue(tx, { kind: "build_session_debrief", payload: { sessionId: at!.sessionId }, dedupeKey: `debrief:${at!.sessionId}:owner:${next.id}` });
  });
  await audit(db, ownerId, "assessment.owner_resolution", "case_attempt", caseAttemptId, { elementId: body.elementId, status: body.status, version: next.assessmentVersion });
  return { assessmentId: next.id, version: next.assessmentVersion, globalRating: next.globalRating };
}

/**
 * Resolve a learner appeal. Transcript corrections are inserted as NEW revisions (the
 * original is kept, marked superseded) and trigger a versioned reassessment with a forced
 * second pass. Historical results are never overwritten.
 */
export async function resolveAppeal(
  deps: Deps,
  ownerId: string,
  appealId: string,
  body: { decision: "upheld" | "revised" | "rejected"; resolution: string; transcriptCorrections: { segmentId: string; correctedText: string }[]; reassess: boolean },
) {
  const { db } = deps;
  const [ap] = await db.select().from(appeals).where(eq(appeals.id, appealId));
  if (!ap) throw notFound("appeal");
  if (ap.status === "upheld" || ap.status === "revised" || ap.status === "rejected") throw conflict("already_resolved", "this appeal has been resolved");
  await db.transaction(async (tx) => {
    for (const c of body.transcriptCorrections) {
      const [orig] = await tx.select().from(transcriptSegments).where(and(eq(transcriptSegments.id, c.segmentId), eq(transcriptSegments.caseAttemptId, ap.caseAttemptId)));
      if (!orig) throw notFound("transcript segment");
      if (orig.status !== "final") throw conflict("already_revised", "segment already superseded");
      await tx.update(transcriptSegments).set({ status: "superseded" }).where(eq(transcriptSegments.id, orig.id));
      await tx.insert(transcriptSegments).values({
        sessionId: orig.sessionId,
        caseAttemptId: orig.caseAttemptId,
        source: orig.source,
        text: c.correctedText,
        startMs: orig.startMs,
        endMs: orig.endMs,
        words: null,
        confidence: null,
        provider: { name: "owner_correction", model: null, requestId: null },
        revision: orig.revision + 1,
        supersedesSegmentId: orig.id,
        status: "final",
        revisionReason: `appeal ${appealId}: ${body.resolution.slice(0, 200)}`,
        revisedBy: ownerId,
      });
    }
    await tx.update(appeals).set({ status: body.decision, resolution: body.resolution, resolvedAt: new Date() }).where(eq(appeals.id, appealId));
    await tx.update(ownerReviewItems).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: ownerId, resolution: body.decision }).where(eq(ownerReviewItems.dedupeKey, `appeal:${appealId}`));
    if (body.reassess || body.transcriptCorrections.length > 0) {
      await enqueue(tx, { kind: "reassess_after_appeal", payload: { caseAttemptId: ap.caseAttemptId, reason: `appeal ${appealId}` }, dedupeKey: `reassess:${appealId}` });
    }
  });
  await audit(db, ownerId, "appeal.resolved", "appeal", appealId, { decision: body.decision, corrections: body.transcriptCorrections.length, reassess: body.reassess });
  return { status: body.decision };
}
