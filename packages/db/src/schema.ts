import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CaseVersion,
  ClockState,
  ExamProfileVersion,
  FinalCaseAssessment,
  LearningPlan,
  SessionDebrief,
  StageState,
} from "@sim/contracts";

/**
 * PostgreSQL schema (spec §14). Durable source of truth for attempts, assessments, usage
 * and payments. Column names are snake_case via drizzle `casing: "snake_case"`.
 *
 * Tenant boundary: every learner-owned row carries user_id and every query in the API is
 * scoped by the authenticated user (plus RLS deny-by-default for Supabase API roles).
 */

const ts = (name?: string) => (name ? timestamp(name, { withTimezone: true, mode: "date" }) : timestamp({ withTimezone: true, mode: "date" }));
const createdAt = () => ts().notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity, auth, consent
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    displayName: text(),
    role: text().$type<"learner" | "owner">().notNull().default("learner"),
    authProvider: text().$type<"local" | "supabase">().notNull(),
    externalAuthId: text(),
    passwordHash: text(),
    totpSecret: text(),
    totpEnabled: boolean().notNull().default(false),
    stripeCustomerId: text(),
    /** Learner-chosen spacing for learning-plan timing (spec §12: timing is adjustable). */
    planPace: text().$type<"compressed" | "standard" | "relaxed">().notNull().default("standard"),
    createdAt: createdAt(),
    deletedAt: ts(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    uniqueIndex("users_external_auth_uq").on(t.authProvider, t.externalAuthId),
    uniqueIndex("users_stripe_customer_uq").on(t.stripeCustomerId),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => users.id),
    tokenHash: text().notNull(),
    createdAt: createdAt(),
    expiresAt: ts().notNull(),
    lastSeenAt: ts().notNull().defaultNow(),
    mfaVerifiedAt: ts(),
    revokedAt: ts(),
  },
  (t) => [uniqueIndex("auth_sessions_token_uq").on(t.tokenHash), index("auth_sessions_user_idx").on(t.userId)],
);

/** Append-only consent records (latest per kind wins). */
export const consents = pgTable(
  "consents",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => users.id),
    kind: text()
      .$type<"terms" | "privacy" | "microphone_processing" | "audio_retention" | "browser_speech_vendor" | "evaluation_use">()
      .notNull(),
    granted: boolean().notNull(),
    policyVersion: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("consents_user_kind_idx").on(t.userId, t.kind, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Content: profiles, cases, versions, governance
// ---------------------------------------------------------------------------

export const examProfiles = pgTable("exam_profiles", {
  versionId: text().primaryKey(),
  profileId: text().notNull(),
  payload: jsonb().$type<ExamProfileVersion>().notNull(),
  active: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const cases = pgTable("cases", {
  caseId: text().primaryKey(),
  caseFamilyId: text().notNull(),
  publishedVersionId: text(),
  withdrawnAt: ts(),
  withdrawalReason: text(),
  createdAt: createdAt(),
});

export const caseVersions = pgTable(
  "case_versions",
  {
    versionId: text().primaryKey(),
    caseId: text().notNull().references(() => cases.caseId),
    versionNumber: integer().notNull(),
    payload: jsonb().$type<CaseVersion>().notNull(),
    publicationStatus: text().$type<CaseVersion["publicationStatus"]>().notNull(),
    clinicalContentHash: text().notNull(),
    rubricHash: text().notNull(),
    assetsHash: text().notNull(),
    isFixture: boolean().notNull(),
    validationIssues: jsonb().$type<unknown[]>().notNull().default([]),
    createdBy: text().notNull(),
    createdAt: createdAt(),
    updatedAt: ts().notNull().defaultNow(),
    rowVersion: integer().notNull().default(1),
  },
  (t) => [uniqueIndex("case_versions_case_number_uq").on(t.caseId, t.versionNumber), index("case_versions_status_idx").on(t.publicationStatus)],
);

/** LLM critique and automated-check runs on a case version. */
export const caseReviews = pgTable(
  "case_reviews",
  {
    id: uuid().primaryKey().defaultRandom(),
    caseVersionId: text().notNull().references(() => caseVersions.versionId),
    reviewer: text().$type<"automated_checks" | "clinical_critic" | "rubric_critic" | "case_author" | "owner">().notNull(),
    status: text().$type<"pending" | "complete" | "failed" | "unavailable">().notNull(),
    issues: jsonb().$type<unknown[]>().notNull().default([]),
    summary: text(),
    provenance: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("case_reviews_version_idx").on(t.caseVersionId)],
);

/** Restricted source registry (quarantine). Never stores patient identifiers in labels. */
export const sourceFiles = pgTable("source_files", {
  id: uuid().primaryKey().defaultRandom(),
  label: text().notNull(),
  kind: text().$type<"pptx" | "image" | "pdf" | "dicom" | "cine" | "other">().notNull(),
  sha256: text().notNull(),
  quarantineStorageKey: text().notNull(),
  privacyStatus: text().$type<"quarantine" | "checked" | "approved" | "rejected">().notNull().default("quarantine"),
  rightsStatus: text().$type<"unresolved" | "cleared" | "restricted">().notNull().default("unresolved"),
  notes: text().notNull().default(""),
  createdBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});

export const sourceInventoryItems = pgTable("source_inventory_items", {
  id: uuid().primaryKey().defaultRandom(),
  sourceFileId: uuid().references(() => sourceFiles.id),
  locator: text().notNull(),
  caseFamilyId: text(),
  sourceDiagnosis: text(),
  diagnosisBasis: text(),
  modalities: jsonb().$type<string[]>().notNull().default([]),
  imageQuality: text(),
  teachingAnnotations: boolean().notNull().default(false),
  identifiersFound: boolean().notNull().default(false),
  identifierNotes: text(),
  commercialUseStatus: text().notNull().default("unresolved"),
  missingMaterial: text(),
  createdAt: createdAt(),
});

/** Explicit content requests for missing cases (never fabricated as patient cases). */
export const contentRequests = pgTable("content_requests", {
  id: uuid().primaryKey().defaultRandom(),
  slot: text().notNull(),
  title: text().notNull(),
  description: text().notNull(),
  categories: jsonb().$type<string[]>().notNull().default([]),
  status: text().$type<"open" | "in_progress" | "fulfilled" | "withdrawn">().notNull().default("open"),
  caseId: text(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export const examForms = pgTable("exam_forms", {
  id: uuid().primaryKey().defaultRandom(),
  profileVersionId: text().notNull().references(() => examProfiles.versionId),
  mode: text().$type<"exam" | "practice" | "owner_preview">().notNull(),
  caseVersionIds: jsonb().$type<string[]>().notNull(),
  seed: text().notNull(),
  notes: jsonb().$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const stationSessions = pgTable(
  "station_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => users.id),
    profileVersionId: text().notNull().references(() => examProfiles.versionId),
    mode: text().$type<"exam" | "practice" | "owner_preview">().notNull(),
    formId: uuid().notNull().references(() => examForms.id),
    status: text().$type<"preflight" | "ready" | "active" | "technically_interrupted" | "finalizing" | "complete" | "aborted">().notNull(),
    outcome: text().$type<"completed" | "time_expired" | "candidate_ended" | "user_aborted" | "invalidated_technical">(),
    clock: jsonb().$type<ClockState>().notNull(),
    caseCount: integer().notNull(),
    currentCaseIndex: integer().notNull().default(0),
    inputMode: text().$type<"voice" | "typed_practice">().notNull(),
    speechConfig: jsonb().$type<{ asr: string; tts: string }>().notNull(),
    preflight: jsonb().$type<Record<string, unknown>>(),
    containsFixtures: boolean().notNull(),
    eventSeq: integer().notNull().default(0),
    viewerSeq: integer().notNull().default(0),
    rowVersion: integer().notNull().default(1),
    technicalNotes: jsonb().$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    startedAt: ts(),
    endedAt: ts(),
    finalizedAt: ts(),
  },
  (t) => [index("station_sessions_user_idx").on(t.userId, t.createdAt)],
);

export const caseAttempts = pgTable(
  "case_attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid().notNull().references(() => stationSessions.id),
    userId: uuid().notNull().references(() => users.id),
    caseVersionId: text().notNull().references(() => caseVersions.versionId),
    caseFamilyId: text().notNull(),
    ordinal: integer().notNull(),
    status: text().$type<"pending" | "active" | "closed">().notNull().default("pending"),
    stageState: jsonb().$type<StageState>(),
    startedAtMs: integer(),
    endedAtMs: integer(),
    closeReason: text(),
    firstExposure: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("case_attempts_session_ordinal_uq").on(t.sessionId, t.ordinal), index("case_attempts_user_idx").on(t.userId)],
);

/** Opaque per-attempt media handles. Media requests are authorized against this table. */
export const assetHandles = pgTable(
  "asset_handles",
  {
    handle: text().primaryKey(),
    userId: uuid().notNull().references(() => users.id),
    sessionId: uuid().notNull().references(() => stationSessions.id),
    caseAttemptId: uuid().notNull().references(() => caseAttempts.id),
    caseVersionId: text().notNull(),
    assetId: text().notNull(),
    disclosedAt: ts().notNull().defaultNow(),
    revokedAt: ts(),
  },
  (t) => [uniqueIndex("asset_handles_attempt_asset_uq").on(t.caseAttemptId, t.assetId)],
);

/** Append-only durable session events with per-session sequence numbers. */
export const sessionEvents = pgTable(
  "session_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid().notNull().references(() => stationSessions.id),
    caseAttemptId: uuid(),
    seq: integer().notNull(),
    serverTime: ts().notNull().defaultNow(),
    sessionClockMs: integer().notNull(),
    type: text().notNull(),
    payloadSchemaVersion: integer().notNull().default(1),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    contentVersions: jsonb().$type<{ profileVersionId: string; caseVersionId: string | null; rubricVersionId: string | null }>().notNull(),
  },
  (t) => [uniqueIndex("session_events_seq_uq").on(t.sessionId, t.seq), index("session_events_type_idx").on(t.sessionId, t.type)],
);

/** Client commands already applied (deduplicates retries and reconnects). */
export const processedCommands = pgTable(
  "processed_commands",
  {
    sessionId: uuid().notNull().references(() => stationSessions.id),
    commandId: text().notNull(),
    result: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.commandId] })],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid().notNull().references(() => stationSessions.id),
    caseAttemptId: uuid(),
    source: text().$type<"server_asr" | "client_asr" | "typed" | "dev_injected">().notNull(),
    text: text().notNull(),
    startMs: integer().notNull(),
    endMs: integer().notNull(),
    words: jsonb().$type<{ text: string; startMs: number; endMs: number; confidence: number | null }[]>(),
    confidence: doublePrecision(),
    provider: jsonb().$type<{ name: string; model: string | null; requestId: string | null }>().notNull(),
    revision: integer().notNull().default(0),
    supersedesSegmentId: uuid(),
    status: text().$type<"final" | "superseded">().notNull().default("final"),
    revisionReason: text(),
    revisedBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index("transcript_segments_session_idx").on(t.sessionId, t.startMs)],
);

export const examinerUtterances = pgTable(
  "examiner_utterances",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid().notNull().references(() => stationSessions.id),
    caseAttemptId: uuid(),
    kind: text().notNull(),
    refId: text(),
    promptClass: text().notNull(),
    text: text().notNull(),
    targetElementIds: jsonb().$type<string[]>().notNull().default([]),
    suppliesElementIds: jsonb().$type<string[]>().notNull().default([]),
    plannedAtMs: integer().notNull(),
    playbackStartedAtMs: integer(),
    playbackEndedAtMs: integer(),
    playedChars: integer().notNull().default(0),
    playedPortionMethod: text().$type<"provider_alignment" | "browser_boundary" | "proportional_estimate" | "completed" | "none">().notNull().default("none"),
    deliveryStatus: text().$type<"planned" | "playing" | "completed" | "interrupted" | "failed" | "cancelled">().notNull(),
    ttsProvider: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("examiner_utterances_session_idx").on(t.sessionId, t.plannedAtMs)],
);

export const viewerCommands = pgTable(
  "viewer_commands",
  {
    id: text().primaryKey(),
    sessionId: uuid().notNull().references(() => stationSessions.id),
    caseAttemptId: uuid().notNull(),
    seq: integer().notNull(),
    kind: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    awaitAck: boolean().notNull(),
    status: text().$type<"sent" | "rendered" | "failed" | "superseded" | "deferred">().notNull().default("sent"),
    createdAt: createdAt(),
    ackedAt: ts(),
  },
  (t) => [uniqueIndex("viewer_commands_seq_uq").on(t.sessionId, t.seq)],
);

// ---------------------------------------------------------------------------
// Durable job queue (transactional outbox: jobs are inserted in the same transaction
// as the state change that requires them).
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  "jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().$type<"queued" | "running" | "succeeded" | "dead">().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    runAt: ts().notNull().defaultNow(),
    lockedAt: ts(),
    lockedBy: text(),
    lastError: text(),
    dedupeKey: text().notNull(),
    result: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jobs_dedupe_uq").on(t.dedupeKey), index("jobs_claim_idx").on(t.status, t.runAt)],
);

// ---------------------------------------------------------------------------
// Assessment, feedback, appeals, learning
// ---------------------------------------------------------------------------

export const assessmentPasses = pgTable(
  "assessment_passes",
  {
    id: uuid().primaryKey().defaultRandom(),
    caseAttemptId: uuid().notNull().references(() => caseAttempts.id),
    stage: text().$type<"extraction" | "A" | "B" | "adjudication" | "feedback">().notNull(),
    run: integer().notNull().default(1),
    assessorKind: text().$type<"llm" | "dev_baseline" | "mock">().notNull(),
    provenance: jsonb().$type<Record<string, unknown>>().notNull(),
    inputHash: text().notNull(),
    output: jsonb().$type<Record<string, unknown>>(),
    validationIssues: jsonb().$type<unknown[]>().notNull().default([]),
    status: text().$type<"valid" | "repaired" | "invalid" | "unavailable">().notNull(),
    latencyMs: integer(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("assessment_passes_uq").on(t.caseAttemptId, t.stage, t.run, t.inputHash)],
);

export const caseAssessments = pgTable(
  "case_assessments",
  {
    id: uuid().primaryKey().defaultRandom(),
    caseAttemptId: uuid().notNull().references(() => caseAttempts.id),
    userId: uuid().notNull().references(() => users.id),
    assessmentVersion: integer().notNull(),
    payload: jsonb().$type<FinalCaseAssessment>().notNull(),
    provisional: boolean().notNull(),
    withheld: boolean().notNull(),
    assessorKind: text().notNull(),
    supersedesId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("case_assessments_version_uq").on(t.caseAttemptId, t.assessmentVersion)],
);

export const sessionDebriefs = pgTable(
  "session_debriefs",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid().notNull().references(() => stationSessions.id),
    userId: uuid().notNull().references(() => users.id),
    version: integer().notNull(),
    payload: jsonb().$type<SessionDebrief>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("session_debriefs_version_uq").on(t.sessionId, t.version)],
);

export const skillObservations = pgTable(
  "skill_observations",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => users.id),
    sessionId: uuid().notNull(),
    caseAttemptId: uuid().notNull(),
    assessmentId: uuid().notNull(),
    mode: text().notNull(),
    profileVersionId: text().notNull(),
    caseFamilyId: text().notNull(),
    elementId: text().notNull(),
    skill: text().notNull(),
    severity: text().notNull(),
    status: text().notNull(),
    promptingLevel: text(),
    firstExposure: boolean().notNull(),
    assisted: boolean().notNull(),
    isFixture: boolean().notNull(),
    superseded: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("skill_observations_user_idx").on(t.userId, t.skill, t.createdAt)],
);

export const learningPlans = pgTable("learning_plans", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().notNull().references(() => users.id),
  payload: jsonb().$type<LearningPlan>().notNull(),
  /** Server-only map of opaque assignment tokens to case ids (never sent to the browser). */
  assignments: jsonb().$type<Record<string, string>>().notNull().default({}),
  /** Learner progress on plan items (item id → status); the generated plan itself is never edited. */
  itemStates: jsonb().$type<Record<string, "suggested" | "started" | "completed" | "skipped">>().notNull().default({}),
  createdAt: createdAt(),
  supersededAt: ts(),
});

export const appeals = pgTable(
  "appeals",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => users.id),
    caseAttemptId: uuid().notNull().references(() => caseAttempts.id),
    assessmentId: uuid().notNull().references(() => caseAssessments.id),
    kind: text().$type<"transcript" | "grading">().notNull(),
    statement: text().notNull(),
    disputedElementIds: jsonb().$type<string[]>().notNull().default([]),
    transcriptCorrections: jsonb().$type<{ segmentId: string; proposedText: string }[]>().notNull().default([]),
    status: text().$type<"submitted" | "under_review" | "upheld" | "revised" | "rejected">().notNull().default("submitted"),
    resolution: text(),
    revisedAssessmentId: uuid(),
    createdAt: createdAt(),
    resolvedAt: ts(),
  },
  (t) => [index("appeals_user_idx").on(t.userId)],
);

export const ownerReviewItems = pgTable(
  "owner_review_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    priority: text().$type<"urgent" | "normal" | "digest">().notNull(),
    status: text().$type<"open" | "resolved" | "dismissed">().notNull().default("open"),
    title: text().notNull(),
    detail: text().notNull(),
    refs: jsonb().$type<Record<string, string>>().notNull().default({}),
    dedupeKey: text().notNull(),
    resolution: text(),
    resolvedBy: uuid(),
    createdAt: createdAt(),
    resolvedAt: ts(),
  },
  (t) => [uniqueIndex("owner_review_items_dedupe_uq").on(t.dedupeKey), index("owner_review_items_status_idx").on(t.status, t.priority)],
);

// ---------------------------------------------------------------------------
// Billing: subscriptions, entitlements, usage ledger, Stripe events
// ---------------------------------------------------------------------------

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => users.id),
    stripeSubscriptionId: text().notNull(),
    stripeCustomerId: text().notNull(),
    planId: text().notNull(),
    status: text().notNull(),
    currentPeriodStart: ts(),
    currentPeriodEnd: ts(),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    trialEnd: ts(),
    /** Stripe `created` time of the newest event applied — guards against out-of-order delivery. */
    lastEventCreated: bigint({ mode: "number" }).notNull().default(0),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("subscriptions_stripe_uq").on(t.stripeSubscriptionId)],
);

export const entitlements = pgTable("entitlements", {
  userId: uuid().primaryKey().references(() => users.id),
  status: text().notNull().default("none"),
  planId: text(),
  periodKey: text(),
  periodEnd: ts(),
  demoCasesRemaining: integer().notNull().default(1),
  rowVersion: integer().notNull().default(1),
  updatedAt: ts().notNull().defaultNow(),
});

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => users.id),
    kind: text().$type<"allot" | "reserve" | "release" | "consume" | "adjust" | "expire">().notNull(),
    minutes: integer().notNull(),
    sessionId: uuid(),
    periodKey: text(),
    idempotencyKey: text().notNull(),
    reason: text().notNull(),
    actor: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("usage_ledger_idem_uq").on(t.idempotencyKey), index("usage_ledger_user_idx").on(t.userId, t.createdAt)],
);

export const stripeEvents = pgTable("stripe_events", {
  id: text().primaryKey(),
  type: text().notNull(),
  apiVersion: text(),
  created: bigint({ mode: "number" }).notNull(),
  livemode: boolean().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  status: text().$type<"pending" | "processed" | "ignored" | "failed">().notNull().default("pending"),
  attempts: integer().notNull().default(0),
  lastError: text(),
  receivedAt: ts().notNull().defaultNow(),
  processedAt: ts(),
});

// ---------------------------------------------------------------------------
// Privacy, operations, audit
// ---------------------------------------------------------------------------

export const recordings = pgTable("recordings", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().notNull().references(() => users.id),
  sessionId: uuid().notNull().references(() => stationSessions.id),
  storageKey: text().notNull(),
  bytes: integer().notNull(),
  retainedUntil: ts().notNull(),
  deletedAt: ts(),
  createdAt: createdAt(),
});

export const dataRequests = pgTable("data_requests", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().notNull().references(() => users.id),
  kind: text().$type<"export" | "deletion">().notNull(),
  status: text().$type<"requested" | "processing" | "complete" | "failed">().notNull().default("requested"),
  resultStorageKey: text(),
  createdAt: createdAt(),
  completedAt: ts(),
});

export const modelCalls = pgTable(
  "model_calls",
  {
    id: uuid().primaryKey().defaultRandom(),
    role: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    promptId: text().notNull(),
    promptVersion: text().notNull(),
    sessionId: uuid(),
    caseAttemptId: uuid(),
    caseVersionId: text(),
    status: text().$type<"ok" | "invalid_output" | "timeout" | "provider_error" | "refused" | "budget_exceeded" | "disabled">().notNull(),
    errorClass: text(),
    latencyMs: integer().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    cacheWriteTokens: integer().notNull().default(0),
    estimatedCostUsd: doublePrecision().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("model_calls_role_idx").on(t.role, t.createdAt), index("model_calls_session_idx").on(t.sessionId)],
);

export const metricSamples = pgTable(
  "metric_samples",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    value: doublePrecision().notNull(),
    labels: jsonb().$type<Record<string, string>>().notNull().default({}),
    sessionId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index("metric_samples_name_idx").on(t.name, t.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorUserId: uuid(),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text().notNull(),
    detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_target_idx").on(t.targetType, t.targetId)],
);

/** Kill switches and owner-controlled runtime configuration. */
export const systemConfig = pgTable("system_config", {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedBy: uuid(),
  updatedAt: ts().notNull().defaultNow(),
});
