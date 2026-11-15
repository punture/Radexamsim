import { z } from "zod";
import { Board, IsoDate, NonEmptyText, Slug } from "./common";

/**
 * Versioned examination profile (spec §2). Board-specific conditions live here and
 * nowhere else. Every attempt freezes the exact profile version it started with.
 */

export const ProfileSourceReference = z.strictObject({
  /** Id in docs/SOURCE_REGISTRY.json */
  registryId: z.string().min(1),
  url: z.url(),
  title: NonEmptyText,
  accessDate: IsoDate,
  supportedClaims: z.array(z.string()).default([]),
});
export type ProfileSourceReference = z.infer<typeof ProfileSourceReference>;

export const VerificationStatus = z.enum([
  /** Every timing/scoring setting is supported by a current official source. */
  "verified",
  /** Practice configuration; at least one setting is not confirmed by a current official source. */
  "provisional",
  /** Not checked against official material. Must not be used for board-equivalence claims. */
  "unverified",
]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const TechnicalPausePolicy = z.enum([
  /** Platform failures pause the station clock; the station resumes on recovery within limits. */
  "pause_and_resume",
  /** Any technical interruption invalidates the station (no clinical result, usage restored). */
  "invalidate",
]);

export const WindowingCapability = z.enum([
  "none",
  /** Display brightness/contrast on still images. Never described as DICOM windowing. */
  "display_brightness_contrast",
  /** True DICOM window/level (only for validated DICOM stacks). */
  "dicom_window_level",
]);

export const PromptingAllowance = z.strictObject({
  allowRequestedHints: z.boolean(),
  allowTeaching: z.boolean(),
  allowRetries: z.boolean(),
  allowPause: z.boolean(),
  /** Max targeted probes the examiner may deliver per rubric element. */
  maxTargetedProbesPerElement: z.number().int().min(0).max(5),
  /** Whether rescue questions may be used (they never earn independent credit). */
  allowRescue: z.boolean(),
  /** Whether a live transcript is shown during the case by default (accessibility can override). */
  showLiveTranscriptByDefault: z.boolean(),
});
export type PromptingAllowance = z.infer<typeof PromptingAllowance>;

export const Abr6872Anchor = z.strictObject({
  score: z.union([z.literal(68), z.literal(69), z.literal(70), z.literal(71), z.literal(72)]),
  label: NonEmptyText,
  description: NonEmptyText,
});

/** Maps the canonical 5-level rating ordinal (case.ts RatingLevel) onto a profile's labels. */
export const CanonicalLevelMap = z.strictObject({
  unsafe: Slug,
  below_expected: Slug,
  meets_expected: Slug,
  strong: Slug,
  exceptional: Slug,
});

/** Maps canonical rubric domains onto a profile's domain ids. */
export const CanonicalDomainMap = z.strictObject({
  observation: Slug,
  interpretation: Slug,
  management: Slug,
  communication: Slug,
});

export const ScoringPolicy = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("abr_68_72_practice"),
    anchors: z.array(Abr6872Anchor).length(5),
    /** Source wording for the anchors; alternative public phrasings are listed in EXAM_PROFILES.md. */
    anchorSourceRegistryIds: z.array(z.string()),
    /** Public category threshold is ordinarily an average of 70; we display a practice estimate only. */
    categoryThresholdAverage: z.number(),
    disclaimer: NonEmptyText,
  }),
  z.strictObject({
    kind: z.literal("rcpsc_domains_qualitative"),
    domains: z.array(
      z.strictObject({ id: Slug, label: NonEmptyText, description: NonEmptyText, sourceStatus: VerificationStatus }),
    ),
    ratingLevels: z.array(z.strictObject({ id: Slug, label: NonEmptyText, description: NonEmptyText })),
    levelForCanonical: CanonicalLevelMap,
    canonicalDomainMap: CanonicalDomainMap,
    /** Must stay false until the owner approves a defensible numeric mapping. */
    numericTotalsEnabled: z.literal(false),
    disclaimer: NonEmptyText,
  }),
  z.strictObject({
    kind: z.literal("qualitative_practice"),
    ratingLevels: z.array(z.strictObject({ id: Slug, label: NonEmptyText, description: NonEmptyText })),
    levelForCanonical: CanonicalLevelMap,
    disclaimer: NonEmptyText,
  }),
]);
export type ScoringPolicy = z.infer<typeof ScoringPolicy>;

export const ExamProfileVersion = z.strictObject({
  profileId: Slug,
  versionId: z.string().regex(/^[a-z0-9-]+@\d{4}-\d{2}-\d{2}\.\d+$/, "expected <profileId>@YYYY-MM-DD.N"),
  displayName: NonEmptyText,
  board: Board,
  discipline: z.literal("diagnostic_radiology"),
  category: z.literal("neuroradiology"),
  track: z.enum(["board_oriented", "advanced_practice"]),
  /** Cohort/year this configuration targets, in the board's own words where possible. */
  cohort: NonEmptyText,
  sources: z.array(ProfileSourceReference),
  verification: z.strictObject({
    status: VerificationStatus,
    verifiedOn: IsoDate,
    method: z.enum(["owner_confirmed", "automated_source_review", "not_verified"]),
    notes: z.string(),
    unresolvedConflicts: z.array(z.string()),
  }),
  station: z.strictObject({
    /** Station (session) duration — NOT the case duration. */
    durationSeconds: z.number().int().min(60).max(4 * 3600),
    minCases: z.number().int().min(1),
    maxCases: z.number().int().min(1),
    /** Optional soft guidance per case, used only for pacing prompts. */
    caseTimeGuidanceSeconds: z.number().int().positive().nullable(),
    /** Whether the server stops the station exactly at the duration. */
    hardStop: z.boolean(),
    timeWarningsAtSecondsRemaining: z.array(z.number().int().positive()),
  }),
  timing: z.strictObject({
    technicalPausePolicy: TechnicalPausePolicy,
    /** A disconnect shorter than this does not pause the clock (prevents gaming). */
    reconnectGraceSeconds: z.number().int().min(0).max(120),
    /** A technical pause longer than this invalidates the station. */
    maxTechnicalPauseSeconds: z.number().int().min(0).max(3600),
    /** Candidate silence and navigation never pause the clock; recorded for documentation. */
    silencePausesClock: z.literal(false),
  }),
  viewer: z.strictObject({
    allowScroll: z.boolean(),
    allowZoomPan: z.boolean(),
    windowing: WindowingCapability,
    allowCine: z.boolean(),
    allowComparison: z.boolean(),
    examinerDrivenPresentationDefault: z.boolean(),
  }),
  turnTaking: z.strictObject({
    /** Silence after final candidate speech before the examiner may respond. */
    endOfTurnSilenceMs: z.number().int().min(500).max(15000),
    /** After this much silence the examiner may offer a neutral continuation. */
    extendedSilenceMs: z.number().int().min(3000).max(120000),
    allowBargeIn: z.boolean(),
  }),
  prompting: z.strictObject({
    exam: PromptingAllowance,
    practice: PromptingAllowance,
  }),
  scoring: ScoringPolicy,
  feedbackRelease: z.strictObject({
    exam: z.literal("after_station"),
    practice: z.enum(["after_each_case", "after_station"]),
  }),
  modes: z.array(z.enum(["exam", "practice"])).min(1),
  /** Short, accurate claim text the public site may display for this profile. */
  publicDescription: NonEmptyText,
});
export type ExamProfileVersion = z.infer<typeof ExamProfileVersion>;
