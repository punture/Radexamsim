import { z } from "zod";
import { IsoDateTime, Laterality, OpaqueId, Slug } from "./common";
import { PromptClass } from "./case";

/**
 * Session (station) lifecycle is modelled separately from per-case stage progression
 * (spec §7). Each active case runs its own authored stage graph.
 */
export const SessionStatus = z.enum([
  "preflight",
  "ready",
  "active",
  "technically_interrupted",
  "finalizing",
  "complete",
  "aborted",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionOutcome = z.enum([
  "completed",
  "time_expired",
  "candidate_ended",
  "user_aborted",
  /** Platform failure exceeded policy; no clinical result for the affected case(s). */
  "invalidated_technical",
]);
export type SessionOutcome = z.infer<typeof SessionOutcome>;

export const CaseAttemptStatus = z.enum(["pending", "active", "closed"]);
export type CaseAttemptStatus = z.infer<typeof CaseAttemptStatus>;

export const CaseCloseReason = z.enum([
  "examiner_completed",
  "time_expired",
  "candidate_requested",
  "station_ended",
  "technical_failure",
]);
export type CaseCloseReason = z.infer<typeof CaseCloseReason>;

/** Server-owned per-case stage state. Pure engine functions transform it. */
export const StageState = z.strictObject({
  currentStageId: Slug,
  revealedStageIds: z.array(Slug),
  deliveredQuestionIds: z.array(Slug),
  deliveredFactReplyIds: z.array(Slug),
  /** Count of targeted probes delivered per rubric element (prompt policy limit). */
  probesPerElement: z.record(z.string(), z.number().int().min(0)),
  /** Assets rendered successfully at least once, with first render time (case-relative ms). */
  renderedAssets: z.record(z.string(), z.number().int().min(0)),
  failedAssets: z.record(z.string(), z.string()),
});
export type StageState = z.infer<typeof StageState>;

/** Server-held clock. Time is accumulated active milliseconds; pauses are explicit. */
export const ClockState = z.strictObject({
  durationMs: z.number().int().positive(),
  accumulatedActiveMs: z.number().int().min(0),
  /** Wall-clock instant the current running segment started; null when not running. */
  runningSinceMs: z.number().int().nullable(),
  pauses: z.array(
    z.strictObject({
      startedAtActiveMs: z.number().int().min(0),
      reason: z.enum(["technical_platform", "technical_connection", "practice_pause"]),
      startedAtWallMs: z.number().int(),
      endedAtWallMs: z.number().int().nullable(),
    }),
  ),
});
export type ClockState = z.infer<typeof ClockState>;

// ---------------------------------------------------------------------------
// Transcript and examiner speech (spec §9)
// ---------------------------------------------------------------------------

export const TranscriptSource = z.enum([
  "server_asr", // streamed audio transcribed by a server-side ASR provider
  "client_asr", // browser speech recognition (labelled; vendor may process audio)
  "typed", // typed fallback: separate practice experience, NOT spoken evidence
  "dev_injected", // development/test injection only
]);
export type TranscriptSource = z.infer<typeof TranscriptSource>;

export const TranscriptWord = z.strictObject({
  text: z.string(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  /** Only when the provider supplies it. Never synthesized. */
  confidence: z.number().min(0).max(1).nullable(),
});

export const TranscriptSegment = z.strictObject({
  id: OpaqueId,
  sessionId: OpaqueId,
  caseAttemptId: OpaqueId.nullable(),
  speaker: z.literal("candidate"),
  source: TranscriptSource,
  /** Immutable original text as produced by the provider. */
  text: z.string(),
  /** Session-clock milliseconds (server-assigned). */
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  words: z.array(TranscriptWord).nullable(),
  /** Provider-supplied confidence only; null if the provider gives none. */
  confidence: z.number().min(0).max(1).nullable(),
  provider: z.strictObject({ name: z.string(), model: z.string().nullable(), requestId: z.string().nullable() }),
  revision: z.number().int().min(0),
  supersedesSegmentId: OpaqueId.nullable(),
  status: z.enum(["final", "superseded"]),
  revisionReason: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const UtteranceKind = z.enum([
  "opening",
  "question",
  "fact_reply",
  "neutral",
  "reveal_announcement",
  "closing",
  "clarification",
  "technical",
  "practice_hint",
]);
export type UtteranceKind = z.infer<typeof UtteranceKind>;

export const DeliveryStatus = z.enum(["planned", "playing", "completed", "interrupted", "failed", "cancelled"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const ExaminerUtterance = z.strictObject({
  id: OpaqueId,
  sessionId: OpaqueId,
  caseAttemptId: OpaqueId.nullable(),
  kind: UtteranceKind,
  /** Approved source id (question id, fact reply id, neutral phrase id, hint id). */
  refId: z.string().nullable(),
  promptClass: PromptClass,
  /** Full intended text. What the candidate heard is text.slice(0, playedChars). */
  text: z.string(),
  targetElementIds: z.array(Slug),
  suppliesElementIds: z.array(Slug),
  plannedAtMs: z.number().int().min(0),
  playbackStartedAtMs: z.number().int().min(0).nullable(),
  playbackEndedAtMs: z.number().int().min(0).nullable(),
  playedChars: z.number().int().min(0),
  deliveryStatus: DeliveryStatus,
  ttsProvider: z.string(),
});
export type ExaminerUtterance = z.infer<typeof ExaminerUtterance>;

/** Fraction of an utterance actually played (what the learner could have heard). */
export function playedFraction(u: Pick<ExaminerUtterance, "text" | "playedChars" | "deliveryStatus">): number {
  if (u.deliveryStatus === "completed") return 1;
  if (u.text.length === 0) return 0;
  return Math.max(0, Math.min(1, u.playedChars / u.text.length));
}

// ---------------------------------------------------------------------------
// Extracted candidate statements (assessment step 2)
// ---------------------------------------------------------------------------

export const EvidenceSpan = z.strictObject({
  segmentId: OpaqueId,
  charStart: z.number().int().min(0),
  charEnd: z.number().int().min(1),
  /** Must equal segment.text.slice(charStart, charEnd) (validated programmatically). */
  quote: z.string().min(1),
});
export type EvidenceSpan = z.infer<typeof EvidenceSpan>;

export const StatementKind = z.enum([
  "observation",
  "localization",
  "feature_description",
  "diagnostic_hypothesis",
  "leading_diagnosis",
  "rejected_diagnosis",
  "recommendation",
  "urgency",
  "communication",
  "self_correction",
  "request_for_information",
  "other",
]);

export const ExtractedStatement = z.strictObject({
  id: z.string().min(1),
  kind: StatementKind,
  span: EvidenceSpan,
  /** Normalized clinical concept, kept separate from the original words. */
  normalizedConcept: z.string().min(1).max(200),
  negated: z.boolean(),
  laterality: Laterality.nullable(),
  certainty: z.enum(["committed", "tentative", "hedged"]),
  /** If this statement corrects an earlier one, that statement's id (both stay traceable). */
  correctsStatementId: z.string().nullable(),
});
export type ExtractedStatement = z.infer<typeof ExtractedStatement>;
