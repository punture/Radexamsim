import { z } from "zod";

/**
 * Shared primitives. Authored identifiers (stage, asset, question, rubric element ids)
 * are slugs that are meaningful to the owner and MUST NOT be exposed to candidates:
 * candidate DTOs use per-attempt opaque handles instead (see dto.ts).
 */
export const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,79}$/, "must be a lowercase slug (a-z, 0-9, _ or -), max 80 chars");
export type Slug = z.infer<typeof Slug>;

/** Opaque server-generated identifier (UUID or prefixed random id). */
export const OpaqueId = z.string().min(8).max(100);
export type OpaqueId = z.infer<typeof OpaqueId>;

export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();

/** Lower-case hex SHA-256 digest. */
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase hex sha256 digest");

export const NonEmptyText = z.string().trim().min(1);

export const ExamMode = z.enum(["exam", "practice", "owner_preview"]);
export type ExamMode = z.infer<typeof ExamMode>;

export const Board = z.enum(["ABR", "RCPSC", "NONE"]);
export type Board = z.infer<typeof Board>;

export const Anatomy = z.enum(["brain", "spine", "head_and_neck", "vascular", "skull_base", "pediatric_neuro"]);
export type Anatomy = z.infer<typeof Anatomy>;

/**
 * Skill axes for the learner skill profile (spec §12). Anatomy/pathology coverage is a
 * separate axis and is tracked from case tags, not from these skills.
 */
export const SkillId = z.enum([
  "detection",
  "localization",
  "feature_description",
  "differential_prioritization",
  "integration",
  "additional_imaging",
  "urgency",
  "consultation",
  "communication",
]);
export type SkillId = z.infer<typeof SkillId>;

export const SKILL_LABELS: Record<SkillId, string> = {
  detection: "Detection",
  localization: "Localization",
  feature_description: "Feature description",
  differential_prioritization: "Differential prioritization",
  integration: "Integration of sequences and history",
  additional_imaging: "Appropriate additional imaging",
  urgency: "Urgency recognition",
  consultation: "Consultation and communication of results",
  communication: "Concise communication",
};

export const Laterality = z.enum(["left", "right", "bilateral", "midline", "not_applicable"]);
export type Laterality = z.infer<typeof Laterality>;

/** A pointer to a human-checkable source (lecture slide, paper, owner note). */
export const SourceReference = z.strictObject({
  id: Slug,
  kind: z.enum(["pptx_slide", "image_file", "pdf_page", "dicom_series", "cine_clip", "literature", "owner_note"]),
  /** Registry id of the quarantined source file (never a filesystem path). */
  sourceFileId: z.string().max(200).nullable(),
  /** Slide/page/series locator inside the source file. */
  locator: z.string().max(200).nullable(),
  description: NonEmptyText,
  /** Full citation for literature references. */
  citation: z.string().max(1000).nullable(),
});
export type SourceReference = z.infer<typeof SourceReference>;

export const ModelUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
});
export type ModelUsage = z.infer<typeof ModelUsage>;

/** Identifies exactly which model/prompt produced an output (spec §15). */
export const ModelProvenance = z.object({
  role: z.string(),
  provider: z.string(),
  model: z.string(),
  promptId: z.string(),
  promptVersion: z.string(),
  /** True when the output came from a deterministic/mock stand-in rather than a live model. */
  simulated: z.boolean(),
});
export type ModelProvenance = z.infer<typeof ModelProvenance>;
