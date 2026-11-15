import type { SessionDebrief, TranscriptLine } from "@sim/contracts";
import { composeCaseDebrief } from "@sim/ai";
import { and, asc, caseAssessments, caseAttempts, desc, eq, examinerUtterances, sessionDebriefs, stationSessions, transcriptSegments, type Db } from "@sim/db";
import { getCaseVersion, getProfile } from "./content";

type SessionRow = typeof stationSessions.$inferSelect;

/**
 * Feedback-release policy (spec §2, §4): exam mode releases nothing until every case in
 * the station is complete and assessed; practice mode may release each case after it closes.
 */
export function caseReleased(session: SessionRow, attempt: typeof caseAttempts.$inferSelect): boolean {
  if (session.mode === "practice") return attempt.status === "closed";
  return session.status === "complete";
}

export async function latestAssessment(db: Db, caseAttemptId: string) {
  const [a] = await db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, caseAttemptId)).orderBy(desc(caseAssessments.assessmentVersion)).limit(1);
  return a ?? null;
}

export async function candidateSegmentsFor(db: Db, caseAttemptId: string) {
  return db
    .select()
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.caseAttemptId, caseAttemptId), eq(transcriptSegments.status, "final")))
    .orderBy(asc(transcriptSegments.startMs));
}

export async function buildSessionDebrief(db: Db, session: SessionRow): Promise<SessionDebrief> {
  const [stored] = await db.select().from(sessionDebriefs).where(eq(sessionDebriefs.sessionId, session.id)).orderBy(desc(sessionDebriefs.version)).limit(1);
  if (stored) return stored.payload;
  if (session.mode !== "practice") {
    return {
      sessionId: session.id,
      mode: session.mode,
      status: "pending",
      pendingReason: session.status === "finalizing" ? "Your assessment is being prepared." : "Feedback is released after the whole station is complete.",
      cases: [],
      nextActivity: null,
    };
  }
  const profile = await getProfile(db, session.profileVersionId);
  const attempts = await db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, session.id)).orderBy(asc(caseAttempts.ordinal));
  const cases: SessionDebrief["cases"] = [];
  let pending = 0;
  for (const at of attempts) {
    if (!caseReleased(session, at) || at.startedAtMs === null) continue;
    const a = await latestAssessment(db, at.id);
    if (!a) {
      pending++;
      continue;
    }
    const cv = await getCaseVersion(db, at.caseVersionId);
    const segs = await candidateSegmentsFor(db, at.id);
    cases.push(
      composeCaseDebrief({
        assessmentId: a.id,
        assessment: a.payload,
        caseVersion: cv,
        profile,
        caseLabel: `Case ${at.ordinal + 1} of ${attempts.length}`,
        segments: segs.map((s) => ({ id: s.id, text: s.text, startMs: s.startMs, endMs: s.endMs, source: s.source, confidence: s.confidence, words: s.words })),
        caseStartedAtMs: at.startedAtMs ?? 0,
      }),
    );
  }
  return {
    sessionId: session.id,
    mode: session.mode,
    status: cases.length === 0 ? "pending" : pending > 0 ? "partial" : "available",
    pendingReason: pending > 0 || cases.length === 0 ? "Some case results are still being prepared." : null,
    cases,
    nextActivity: null,
  };
}

/** Transcript with examiner lines limited to the words actually played. */
export async function sessionTranscript(db: Db, session: SessionRow): Promise<TranscriptLine[]> {
  const attempts = await db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, session.id));
  const released = new Set(attempts.filter((a) => caseReleased(session, a)).map((a) => a.id));
  const segs = await db.select().from(transcriptSegments).where(and(eq(transcriptSegments.sessionId, session.id), eq(transcriptSegments.status, "final")));
  const utts = await db.select().from(examinerUtterances).where(eq(examinerUtterances.sessionId, session.id));
  const lines: TranscriptLine[] = [
    ...segs
      .filter((s) => s.caseAttemptId && released.has(s.caseAttemptId))
      .map((s) => ({ id: s.id, speaker: "candidate" as const, text: s.text, interrupted: false, atMs: s.startMs, source: s.source, caseAttemptId: s.caseAttemptId, stageOrdinal: null, confidence: s.confidence })),
    ...utts
      .filter((u) => u.caseAttemptId && released.has(u.caseAttemptId) && u.playedChars > 0)
      .map((u) => ({
        id: u.id,
        speaker: "examiner" as const,
        text: u.text.slice(0, u.playedChars),
        interrupted: u.deliveryStatus !== "completed",
        atMs: u.playbackStartedAtMs ?? u.plannedAtMs,
        source: "examiner_tts" as const,
        caseAttemptId: u.caseAttemptId,
        stageOrdinal: null,
        confidence: null,
      })),
  ];
  return lines.sort((a, b) => a.atMs - b.atMs);
}
