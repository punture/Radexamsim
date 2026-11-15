import { z } from "zod";
import { IsoDateTime, ModelProvenance, OpaqueId, Slug } from "./common";
import { RatingLevel, Severity } from "./case";
import { EvidenceSpan, ExtractedStatement } from "./session";

/**
 * Assessment contracts (spec §10). Statuses and prompting levels are PRODUCT constructs
 * whose scoring implications are defined in each approved rubric; they are not official
 * board categories.
 */

export const ElementStatus = z.enum([
  "demonstrated",
  "partially_demonstrated",
  "incorrect",
  "not_demonstrated",
  "not_assessable",
  "uncertain",
]);
export type ElementStatus = z.infer<typeof ElementStatus>;

export const PromptingLevel = z.enum(["spontaneous", "standard_question", "targeted_probe", "rescue", "examiner_supplied"]);
export type PromptingLevel = z.infer<typeof PromptingLevel>;
export const PROMPTING_ORDER: readonly PromptingLevel[] = [
  "spontaneous",
  "standard_question",
  "targeted_probe",
  "rescue",
  "examiner_supplied",
];

/**
 * Deterministic opportunity record: what was assessable, when it became available or was
 * asked, and why. Omissions must reference one of these.
 */
export const OpportunityRecord = z.strictObject({
  id: z.string(),
  elementId: Slug,
  assessable: z.boolean(),
  /** Case-relative ms when the required images were rendered (null if never). */
  assetsRenderedAtMs: z.number().int().nullable(),
  /** Case-relative ms when an opening question finished playing (null if never). */
  questionDeliveredAtMs: z.number().int().nullable(),
  openedAtMs: z.number().int().nullable(),
  /** Candidate speaking time available after the opportunity opened. */
  exposureMs: z.number().int().min(0),
  notAssessableReasons: z.array(
    z.enum([
      "required_asset_not_disclosed",
      "required_asset_render_failed",
      "question_not_delivered",
      "question_interrupted_before_heard",
      "insufficient_time_after_opportunity",
      "case_ended_by_technical_failure",
      "blocked_by_prerequisite",
    ]),
  ),
  description: z.string(),
});
export type OpportunityRecord = z.infer<typeof OpportunityRecord>;

export const SelfCorrection = z.strictObject({
  initial: EvidenceSpan,
  correction: EvidenceSpan,
  /** Time between the initial statement and the correction (ms). */
  latencyMs: z.number().int().min(0),
});

export const ElementJudgment = z.strictObject({
  elementId: Slug,
  status: ElementStatus,
  promptingLevel: PromptingLevel.nullable(),
  /** Required (non-empty) for demonstrated / partially_demonstrated / incorrect. */
  evidence: z.array(EvidenceSpan),
  /** Required for not_demonstrated (the opportunity the response did not use). */
  opportunityId: z.string().nullable(),
  selfCorrection: SelfCorrection.nullable(),
  rationale: z.string().min(1).max(600),
  /** Required for uncertain. */
  uncertaintyReason: z.string().max(400).nullable(),
});
export type ElementJudgment = z.infer<typeof ElementJudgment>;

export const UnsafeFlag = z.strictObject({
  elementId: Slug.nullable(),
  /** The approved criterion (one of the rubric's incorrectOrUnsafeClaims). */
  criterion: z.string().min(1),
  evidence: z.array(EvidenceSpan).min(1),
  context: z.string().max(400),
  consequence: z.string().min(1).max(400),
  committed: z.boolean(),
  correctedLater: z.boolean(),
});
export type UnsafeFlag = z.infer<typeof UnsafeFlag>;

export const DomainRating = z.strictObject({
  domain: z.enum(["observation", "interpretation", "management", "communication"]),
  /** Null when withheld (insufficient assessable evidence). */
  level: RatingLevel.nullable(),
  rationale: z.string().max(600),
  supportingElementIds: z.array(Slug),
});
export type DomainRating = z.infer<typeof DomainRating>;

/** Raw output of one assessor pass, validated before use. */
export const AssessorOutput = z.strictObject({
  elementJudgments: z.array(ElementJudgment),
  unsafeFlags: z.array(UnsafeFlag),
  domainRatings: z.array(DomainRating),
  globalRating: z.strictObject({ level: RatingLevel.nullable(), rationale: z.string().max(800) }),
  abstained: z.boolean(),
  abstentionReason: z.string().nullable(),
});
export type AssessorOutput = z.infer<typeof AssessorOutput>;

export const AssessorKind = z.enum(["llm", "dev_baseline", "mock"]);
export type AssessorKind = z.infer<typeof AssessorKind>;

export const ValidationIssue = z.strictObject({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  elementId: z.string().nullable(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const AssessmentPass = z.strictObject({
  id: OpaqueId,
  caseAttemptId: OpaqueId,
  pass: z.enum(["A", "B"]),
  assessorKind: AssessorKind,
  provenance: ModelProvenance,
  output: AssessorOutput.nullable(),
  validationIssues: z.array(ValidationIssue),
  status: z.enum(["valid", "repaired", "invalid", "unavailable"]),
  createdAt: IsoDateTime,
});
export type AssessmentPass = z.infer<typeof AssessmentPass>;

export const ElementResult = z.strictObject({
  elementId: Slug,
  severity: Severity,
  status: ElementStatus,
  promptingLevel: PromptingLevel.nullable(),
  credit: z.enum(["full", "partial", "none", "not_applicable"]),
  evidence: z.array(EvidenceSpan),
  opportunity: OpportunityRecord,
  selfCorrection: SelfCorrection.nullable(),
  rationale: z.string(),
  uncertaintyReason: z.string().nullable(),
  /** Upstream elements whose failure explains this one (prevents double deduction). */
  blockedByElementIds: z.array(Slug),
  agreement: z.enum(["agreed", "adjudicated", "disputed", "single_pass"]),
});
export type ElementResult = z.infer<typeof ElementResult>;

export const FinalCaseAssessment = z.strictObject({
  id: OpaqueId,
  caseAttemptId: OpaqueId,
  assessmentVersion: z.number().int().min(1),
  frozenVersions: z.strictObject({
    profileVersionId: z.string(),
    caseVersionId: z.string(),
    rubricVersionId: z.string(),
    transcriptRevision: z.number().int().min(0),
    promptVersions: z.record(z.string(), z.string()),
  }),
  assessorKind: AssessorKind,
  statements: z.array(ExtractedStatement),
  elementResults: z.array(ElementResult),
  unsafeFlags: z.array(UnsafeFlag),
  domainRatings: z.array(DomainRating),
  globalRating: z.strictObject({
    level: RatingLevel.nullable(),
    /** Profile-specific display (e.g. "70 — satisfactory (practice estimate)"). */
    display: z.string().nullable(),
    withheldReason: z.string().nullable(),
    capsApplied: z.array(z.string()),
  }),
  criticalConcerns: z.array(z.string()),
  uncertaintyReasons: z.array(z.string()),
  disputedElementIds: z.array(Slug),
  provisional: z.boolean(),
  technicalLimitations: z.array(z.string()),
  createdAt: IsoDateTime,
  supersedesAssessmentId: OpaqueId.nullable(),
  supersedeReason: z.string().nullable(),
});
export type FinalCaseAssessment = z.infer<typeof FinalCaseAssessment>;

export const OwnerReviewKind = z.enum([
  "assessment_disagreement",
  "uncertain_finding",
  "consequential_grading_risk",
  "rights_privacy_concern",
  "learner_appeal",
  "changed_clinical_content",
  "case_ready_for_approval",
  "technical_failure_adjustment",
]);
export type OwnerReviewKind = z.infer<typeof OwnerReviewKind>;

export const OwnerReviewItem = z.strictObject({
  id: OpaqueId,
  kind: OwnerReviewKind,
  priority: z.enum(["urgent", "normal", "digest"]),
  status: z.enum(["open", "resolved", "dismissed"]),
  title: z.string(),
  detail: z.string(),
  refs: z.record(z.string(), z.string()),
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
  resolution: z.string().nullable(),
});
export type OwnerReviewItem = z.infer<typeof OwnerReviewItem>;
