import { z } from "zod";
import { ExamMode, IsoDateTime, Laterality, OpaqueId } from "./common";
import { CandidateAsset, ViewerPane, ViewerPermissions } from "./viewer";
import { SessionOutcome, SessionStatus, TranscriptSource } from "./session";

/**
 * Role-specific DTOs (spec §6). Each is produced by an explicit allowlist projection in
 * @sim/clinical-content/projections — never by deleting fields from a richer object.
 */

// ---------------------------------------------------------------------------
// Candidate (browser) — current authorized history, permitted assets/controls,
// neutral case label, and questions already delivered. Nothing else.
// ---------------------------------------------------------------------------

export const CandidateDeliveredPrompt = z.strictObject({
  utteranceId: OpaqueId,
  /** Only the portion actually played to the candidate. */
  heardText: z.string(),
  atMs: z.number().int().min(0),
});

export const CandidateCaseView = z.strictObject({
  caseAttemptId: OpaqueId,
  /** e.g. "Case 2 of 3" — never diagnosis-bearing. */
  neutralLabel: z.string(),
  history: z.array(z.string()),
  revealedStageCount: z.number().int().min(1),
  assets: z.array(CandidateAsset),
  viewer: z.strictObject({
    permissions: ViewerPermissions,
    layout: z.enum(["single", "side_by_side", "grid_2x2"]),
    panes: z.array(ViewerPane),
    lastCommandSeq: z.number().int().min(0),
  }),
  deliveredPrompts: z.array(CandidateDeliveredPrompt),
});
export type CandidateCaseView = z.infer<typeof CandidateCaseView>;

export const CandidateSessionState = z.strictObject({
  sessionId: OpaqueId,
  mode: ExamMode,
  status: SessionStatus,
  outcome: SessionOutcome.nullable(),
  profile: z.strictObject({
    versionId: z.string(),
    displayName: z.string(),
    board: z.string(),
    verificationStatus: z.string(),
    stationDurationSeconds: z.number().int(),
  }),
  clock: z.strictObject({
    durationMs: z.number().int(),
    remainingMs: z.number().int(),
    running: z.boolean(),
    serverNowMs: z.number().int(),
  }),
  caseIndex: z.number().int().min(0),
  caseCount: z.number().int().min(0),
  currentCase: CandidateCaseView.nullable(),
  liveTranscriptDefault: z.boolean(),
  inputMode: z.enum(["voice", "typed_practice"]),
  speech: z.strictObject({
    asr: z.enum(["server_stream", "browser", "dev_injection_only"]),
    tts: z.enum(["server_stream", "browser", "none"]),
    endOfTurnSilenceMs: z.number().int(),
    allowBargeIn: z.boolean(),
  }),
  practice: z.strictObject({ hintsAvailable: z.boolean(), paused: z.boolean() }).nullable(),
  /** Development fixture content is labelled in the UI. */
  containsDevelopmentFixtures: z.boolean(),
  lastServerSeq: z.number().int().min(0),
});
export type CandidateSessionState = z.infer<typeof CandidateSessionState>;

// ---------------------------------------------------------------------------
// Live examiner — current stage facts, approved reply bank, allowable actions,
// relevant conversation and timing. Refs are per-call aliases mapped server-side,
// so the model can only choose from what it was shown.
// ---------------------------------------------------------------------------

export const ExaminerMenuItem = z.strictObject({
  ref: z.string(),
  description: z.string(),
});

export const ExaminerContext = z.strictObject({
  mode: z.enum(["exam", "practice", "owner_preview"]),
  trigger: z.enum(["candidate_turn_ended", "extended_silence", "images_rendered", "case_started", "time_check"]),
  timing: z.strictObject({
    stationElapsedSeconds: z.number().int(),
    stationRemainingSeconds: z.number().int(),
    caseElapsedSeconds: z.number().int(),
    caseTimeGuidanceSeconds: z.number().int().nullable(),
    isLastCase: z.boolean(),
  }),
  stage: z.strictObject({
    ordinal: z.number().int(),
    candidateHistory: z.string(),
    examinerNotes: z.string(),
    visibleImages: z.array(ExaminerMenuItem),
  }),
  questions: z.array(
    z.strictObject({
      ref: z.string(),
      text: z.string(),
      purpose: z.string(),
      skipIfAlreadyAddressed: z.string().nullable(),
      alreadyAsked: z.boolean(),
    }),
  ),
  factReplies: z.array(
    z.strictObject({ ref: z.string(), answersRequest: z.string(), revealsNewImages: z.boolean() }),
  ),
  neutralPhrases: z.array(z.strictObject({ ref: z.string(), purpose: z.string(), text: z.string() })),
  revealOptions: z.array(ExaminerMenuItem),
  viewportOptions: z.array(ExaminerMenuItem),
  canAdvanceCase: z.boolean(),
  conversation: z.array(
    z.strictObject({ speaker: z.enum(["examiner", "candidate"]), text: z.string(), atSeconds: z.number().int() }),
  ),
  secondsSinceCandidateSpoke: z.number().int().nullable(),
  /** The last candidate turn came back from speech recognition with low confidence. */
  lastCandidateTurnPoorlyRecognized: z.boolean().default(false),
});
export type ExaminerContext = z.infer<typeof ExaminerContext>;

export const ExaminerActionKind = z.enum([
  "wait",
  "deliver_question",
  "deliver_fact_reply",
  "say_neutral",
  "request_stage_reveal",
  "set_viewport",
  "select_series",
  "advance_case",
]);
export type ExaminerActionKind = z.infer<typeof ExaminerActionKind>;

export const ExaminerReasonCode = z.enum([
  "candidate_still_thinking",
  "candidate_requested_information",
  "candidate_finished_topic",
  "required_probe",
  "clarification_needed",
  "progression",
  "time_management",
  "candidate_requested_end",
  "images_now_visible",
]);

/** Structured action proposed by the examiner model. Server code validates and executes it. */
export const ExaminerProposal = z.object({
  action: ExaminerActionKind,
  /** Alias from the menu (Q1, F2, N3, R1, V1, A1). Null for wait/advance_case. */
  ref: z.string().nullable(),
  reason: ExaminerReasonCode,
  /** Short operational note for audit (not reasoning). */
  note: z.string().max(200),
});
export type ExaminerProposal = z.infer<typeof ExaminerProposal>;

// ---------------------------------------------------------------------------
// Session summary for learner dashboards/history.
// ---------------------------------------------------------------------------

export const SessionSummary = z.strictObject({
  sessionId: OpaqueId,
  mode: ExamMode,
  status: SessionStatus,
  outcome: SessionOutcome.nullable(),
  profileDisplayName: z.string(),
  createdAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  caseCount: z.number().int(),
  resultStatus: z.enum(["not_started", "pending", "available", "provisional", "unavailable"]),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const TranscriptLine = z.strictObject({
  id: OpaqueId,
  speaker: z.enum(["candidate", "examiner"]),
  text: z.string(),
  /** For examiner lines: whether the full text was played. */
  interrupted: z.boolean(),
  atMs: z.number().int().min(0),
  source: z.union([TranscriptSource, z.literal("examiner_tts")]),
  caseAttemptId: OpaqueId.nullable(),
  stageOrdinal: z.number().int().nullable(),
  confidence: z.number().nullable(),
});
export type TranscriptLine = z.infer<typeof TranscriptLine>;

export { Laterality };
