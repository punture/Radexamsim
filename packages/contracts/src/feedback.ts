import { z } from "zod";
import { IsoDateTime, OpaqueId, SkillId } from "./common";
import { ElementStatus, PromptingLevel } from "./assessment";

/**
 * Learner-facing debrief (spec §11). Every item is generated from supported assessment
 * facts; quotes are copied from validated evidence spans.
 */

export const QuoteRef = z.strictObject({
  segmentId: OpaqueId,
  quote: z.string(),
  atMs: z.number().int().min(0),
});

export const DebriefStrength = z.strictObject({
  elementId: z.string(),
  summary: z.string(),
  promptingLevel: PromptingLevel.nullable(),
  evidence: z.array(QuoteRef).min(1),
});

export const DebriefIssue = z.strictObject({
  elementId: z.string(),
  rank: z.number().int().min(1),
  severity: z.enum(["minor", "important", "critical"]),
  status: ElementStatus,
  /** What you said or omitted. */
  whatHappened: z.string(),
  evidence: z.array(QuoteRef),
  opportunityDescription: z.string().nullable(),
  whyItMatters: z.string(),
  strongerResponse: z.string(),
  howToPractise: z.string(),
  promptingLevel: PromptingLevel.nullable(),
  relatedElementIds: z.array(z.string()),
});

export const DebriefPromptingRow = z.strictObject({
  elementId: z.string(),
  construct: z.string(),
  status: ElementStatus,
  promptingLevel: PromptingLevel.nullable(),
  corrected: z.boolean(),
});

export const CaseDebrief = z.strictObject({
  caseAttemptId: OpaqueId,
  caseLabel: z.string(),
  assessmentId: OpaqueId,
  assessorKind: z.enum(["llm", "dev_baseline", "mock"]),
  overall: z.strictObject({
    summary: z.string(),
    ratingDisplay: z.string().nullable(),
    ratingDisclaimer: z.string(),
    withheldReason: z.string().nullable(),
    provisional: z.boolean(),
    uncertaintyStatement: z.string().nullable(),
  }),
  strengths: z.array(DebriefStrength).max(3),
  issues: z.array(DebriefIssue),
  promptingTable: z.array(DebriefPromptingRow),
  referenceApproach: z.strictObject({ text: z.string(), alternatives: z.array(z.string()) }),
  technicalLimitations: z.array(z.string()),
  improvementActions: z.array(z.string()).max(3),
  isDevelopmentFixture: z.boolean(),
  createdAt: IsoDateTime,
});
export type CaseDebrief = z.infer<typeof CaseDebrief>;

export const SessionDebrief = z.strictObject({
  sessionId: OpaqueId,
  mode: z.enum(["exam", "practice", "owner_preview"]),
  status: z.enum(["pending", "available", "partial", "unavailable"]),
  pendingReason: z.string().nullable(),
  cases: z.array(CaseDebrief),
  nextActivity: z
    .strictObject({
      kind: z.enum(["unseen_case", "revision_practice", "none_available"]),
      description: z.string(),
      targetSkills: z.array(SkillId),
    })
    .nullable(),
});
export type SessionDebrief = z.infer<typeof SessionDebrief>;

export const LearningPlanItem = z.strictObject({
  id: z.string(),
  order: z.number().int().min(1),
  kind: z.enum(["worked_example", "focused_verbal_exercise", "unseen_case", "mixed_timed_reassessment", "revision_practice"]),
  title: z.string(),
  description: z.string(),
  targetSkills: z.array(SkillId),
  /** Opaque assignment token — never a diagnosis-revealing case title. */
  assignmentToken: z.string().nullable(),
  suggestedAfterDays: z.number().int().min(0),
  status: z.enum(["suggested", "started", "completed", "skipped"]),
});

export const SkillObservationSummary = z.strictObject({
  skill: SkillId,
  observations: z.number().int().min(0),
  distinctCaseFamilies: z.number().int().min(0),
  demonstratedRate: z.number().min(0).max(1).nullable(),
  /** Narrative trend statement (no pass probabilities). */
  statement: z.string(),
});

export const LearningPlan = z.strictObject({
  id: OpaqueId,
  userId: OpaqueId,
  createdAt: IsoDateTime,
  basis: z.string(),
  focusSkills: z.array(SkillId),
  items: z.array(LearningPlanItem),
  skillSummaries: z.array(SkillObservationSummary),
  generatedBy: z.enum(["deterministic", "deterministic_with_llm_explanation"]),
});
export type LearningPlan = z.infer<typeof LearningPlan>;
