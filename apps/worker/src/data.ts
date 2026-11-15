import type { ExaminerUtterance } from "@sim/contracts";
import type { AttemptData, CandidateSegment } from "@sim/ai";
import { and, asc, caseAttempts, eq, examinerUtterances, sessionEvents, stationSessions, transcriptSegments, type Db } from "@sim/db";
import { CaseVersion, ExamProfileVersion } from "@sim/contracts";
import { caseVersions, examProfiles } from "@sim/db";

/**
 * Assemble the frozen inputs for assessing one case attempt from durable records (spec §10
 * step 1). Versions come from the attempt itself, never from "current" content.
 */
export async function loadAttemptData(db: Db, caseAttemptId: string): Promise<AttemptData & { userId: string; isFixture: boolean; firstExposure: boolean }> {
  const [attempt] = await db.select().from(caseAttempts).where(eq(caseAttempts.id, caseAttemptId));
  if (!attempt) throw new Error(`case attempt ${caseAttemptId} not found`);
  const [session] = await db.select().from(stationSessions).where(eq(stationSessions.id, attempt.sessionId));
  const [cvRow] = await db.select().from(caseVersions).where(eq(caseVersions.versionId, attempt.caseVersionId));
  const [pRow] = await db.select().from(examProfiles).where(eq(examProfiles.versionId, session!.profileVersionId));
  const caseVersion = CaseVersion.parse(cvRow!.payload);
  const profile = ExamProfileVersion.parse(pRow!.payload);

  const events = await db.select().from(sessionEvents).where(and(eq(sessionEvents.sessionId, attempt.sessionId), eq(sessionEvents.caseAttemptId, attempt.id))).orderBy(asc(sessionEvents.seq));
  const stageReveals = events.filter((e) => e.type === "stage.revealed").map((e) => ({ stageId: String(e.payload.stageId), atMs: e.sessionClockMs }));
  const renders = events
    .filter((e) => e.type === "viewer.rendered" || e.type === "viewer.render_failed")
    .map((e) => ({ assetId: String(e.payload.assetId), status: e.type === "viewer.rendered" ? ("rendered" as const) : ("failed" as const), atMs: e.sessionClockMs }));

  // Current transcript revision: final (non-superseded) segments only.
  const segs = await db
    .select()
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.caseAttemptId, attempt.id), eq(transcriptSegments.status, "final")))
    .orderBy(asc(transcriptSegments.startMs));
  const segments: CandidateSegment[] = segs.map((s) => ({ id: s.id, text: s.text, startMs: s.startMs, endMs: s.endMs, source: s.source, confidence: s.confidence, words: s.words }));
  const transcriptRevision = segs.reduce((m, s) => Math.max(m, s.revision), 0);

  const utts = await db.select().from(examinerUtterances).where(eq(examinerUtterances.caseAttemptId, attempt.id)).orderBy(asc(examinerUtterances.plannedAtMs));
  const utterances: ExaminerUtterance[] = utts.map((u) => ({
    id: u.id,
    sessionId: u.sessionId,
    caseAttemptId: u.caseAttemptId,
    kind: u.kind as ExaminerUtterance["kind"],
    refId: u.refId,
    promptClass: u.promptClass as ExaminerUtterance["promptClass"],
    text: u.text,
    targetElementIds: u.targetElementIds,
    suppliesElementIds: u.suppliesElementIds,
    plannedAtMs: u.plannedAtMs,
    playbackStartedAtMs: u.playbackStartedAtMs,
    playbackEndedAtMs: u.playbackEndedAtMs,
    playedChars: u.playedChars,
    deliveryStatus: u.deliveryStatus,
    ttsProvider: u.ttsProvider,
  }));

  return {
    caseAttemptId: attempt.id,
    sessionId: attempt.sessionId,
    userId: attempt.userId,
    mode: session!.mode,
    profile,
    caseVersion,
    caseStartedAtMs: attempt.startedAtMs ?? 0,
    caseEndedAtMs: attempt.endedAtMs ?? attempt.startedAtMs ?? 0,
    closeReason: attempt.closeReason ?? "unknown",
    endedByTechnicalFailure: attempt.closeReason === "technical_failure",
    stageReveals,
    renders,
    segments,
    transcriptRevision,
    utterances,
    technicalNotes: session!.technicalNotes,
    typedInput: segments.some((s) => s.source === "typed"),
    isFixture: caseVersion.isDevelopmentFixture,
    firstExposure: attempt.firstExposure,
  };
}
