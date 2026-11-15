import { z } from "zod";
import {
  Anatomy,
  IsoDateTime,
  Laterality,
  NonEmptyText,
  OpaqueId,
  Sha256,
  SkillId,
  Slug,
  SourceReference,
} from "./common";

/**
 * Case contract (spec §6). Everything here is AUTHORED, versioned content.
 *
 * Information boundaries:
 *  - `clinicalTruth`, rubric, reference responses, annotations and storage keys are never
 *    sent to a candidate. Candidate DTOs are built by explicit allowlists (dto.ts).
 *  - Authored slugs (stage/asset/question ids) are internal; candidates see opaque handles.
 */

export const CASE_SCHEMA_VERSION = 1 as const;

export const PublicationStatus = z.enum([
  "draft",
  "automated_checks",
  "ready_for_owner",
  "owner_approved",
  "published",
  "retired",
]);
export type PublicationStatus = z.infer<typeof PublicationStatus>;

export const TruthStatus = z.enum(["confirmed", "probable", "differential_only"]);
export type TruthStatus = z.infer<typeof TruthStatus>;

export const Severity = z.enum(["minor", "important", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const Modality = z.enum(["CT", "CTA", "CTP", "MR", "MRA", "MRV", "DSA", "US", "XR", "NM", "PET", "other"]);
export type Modality = z.infer<typeof Modality>;

export const Plane = z.enum(["axial", "coronal", "sagittal", "oblique", "3d", "projection", "other"]);

// ---------------------------------------------------------------------------
// Clinical truth (owner-approved; never in candidate or examiner DTOs)
// ---------------------------------------------------------------------------

export const KeyFinding = z.strictObject({
  id: Slug,
  description: NonEmptyText,
  location: NonEmptyText,
  laterality: Laterality,
  /** Assets in which the finding is visible. */
  assetIds: z.array(Slug).min(1),
  conspicuity: z.enum(["obvious", "moderate", "subtle"]),
});
export type KeyFinding = z.infer<typeof KeyFinding>;

export const DifferentialItem = z.strictObject({
  diagnosis: NonEmptyText,
  rank: z.number().int().min(1),
  rationale: NonEmptyText,
});

export const ClinicalTruth = z.strictObject({
  /** The eventual diagnosis (may be more specific than the images support). */
  finalDiagnosis: NonEmptyText,
  /** What the DISPLAYED material supports — scoring must not demand more than this. */
  displayedMaterialSupports: z.enum(["specific_diagnosis", "leading_with_differential", "differential_only"]),
  keyFindings: z.array(KeyFinding).min(1),
  acceptableDiagnoses: z.array(NonEmptyText),
  differential: z.array(DifferentialItem),
  managementExpectations: z.array(NonEmptyText),
  urgency: z.enum(["routine", "urgent", "emergent"]),
  criticalCommunication: z.string().nullable(),
  uncertaintyNotes: z.string(),
  teachingPoints: z.array(NonEmptyText),
  /**
   * Development fixtures only: a unique sentinel string used by automated leak tests to
   * prove clinical truth never reaches a candidate payload or client bundle.
   */
  leakCanary: z.string().nullable().default(null),
});
export type ClinicalTruth = z.infer<typeof ClinicalTruth>;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const AssetFrame = z.strictObject({
  index: z.number().int().min(0),
  /** Server-only storage key inside the approved-derivatives bucket. */
  storageKey: z.string().min(1).max(500),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "application/dicom", "video/mp4", "video/webm"]),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sha256: Sha256,
  byteSize: z.number().int().positive(),
  /** For stacks: slice position along the stack normal (mm) when geometry is valid. */
  sliceLocation: z.number().nullable().default(null),
  instanceNumber: z.number().int().nullable().default(null),
});
export type AssetFrame = z.infer<typeof AssetFrame>;

export const DicomSeriesMetadata = z.strictObject({
  transferSyntaxUid: NonEmptyText,
  photometricInterpretation: z.enum(["MONOCHROME1", "MONOCHROME2", "RGB"]),
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
  bitsAllocated: z.number().int().positive(),
  rescaleSlope: z.number(),
  rescaleIntercept: z.number(),
  pixelSpacing: z.tuple([z.number().positive(), z.number().positive()]).nullable(),
  sliceThickness: z.number().positive().nullable(),
  imageOrientationPatient: z.array(z.number()).length(6).nullable(),
  sortedBy: z.enum(["image_position_patient", "instance_number"]),
  /** True only if spatial metadata was checked for consistency across the series. */
  geometryValidated: z.boolean(),
  windowPresets: z.array(z.strictObject({ label: NonEmptyText, center: z.number(), width: z.number().positive() })),
});
export type DicomSeriesMetadata = z.infer<typeof DicomSeriesMetadata>;

export const AssetDerivation = z.strictObject({
  sourceReferenceId: Slug,
  method: z.enum([
    "original_embedded", // extracted untouched from PPTX/PDF media
    "format_converted", // lossless conversion (e.g. EMF/TIFF -> PNG)
    "cropped_non_diagnostic_margin", // removed slide chrome only
    "annotation_removed_clean_source", // replaced with a clean source image
    "dicom_export",
    "placeholder", // labelled non-clinical development placeholder
  ]),
  notes: z.string(),
  /** Owner/tool attestation that diagnostic content, orientation and labels are preserved. */
  preservesDiagnosticContent: z.boolean(),
  burnedInAnnotationsPresent: z.boolean(),
});

export const Annotation = z.strictObject({
  id: Slug,
  assetId: Slug,
  frameIndex: z.number().int().min(0),
  kind: z.enum(["arrow", "ellipse", "polygon", "key_frame"]),
  /** Normalized [0,1] coordinates relative to the frame. Empty for key_frame. */
  points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])),
  label: z.string().max(200),
  findingId: Slug.nullable(),
});
export type Annotation = z.infer<typeof Annotation>;

export const ApprovedAsset = z.strictObject({
  id: Slug,
  kind: z.enum(["still", "stack", "cine", "dicom_stack"]),
  modality: Modality,
  /**
   * Candidate-visible label, e.g. "MRI brain, axial DWI (b=1000)". Must not contain
   * diagnosis-bearing words (enforced by automated checks).
   */
  neutralLabel: NonEmptyText.max(120),
  sequence: z.string().max(60).nullable(),
  plane: Plane.nullable(),
  contrast: z.enum(["none", "intravenous", "intrathecal", "unknown"]).nullable(),
  frames: z.array(AssetFrame).min(1),
  derivation: AssetDerivation,
  isPlaceholder: z.boolean(),
  display: z.strictObject({
    initialFrameIndex: z.number().int().min(0),
    /** "fit" keeps whole-image context; numeric zoom can itself become a hint. */
    initialZoom: z.union([z.literal("fit"), z.number().min(0.25).max(8)]),
    frameRateFps: z.number().positive().max(60).nullable(),
  }),
  dicom: DicomSeriesMetadata.nullable(),
  annotations: z.array(Annotation),
});
export type ApprovedAsset = z.infer<typeof ApprovedAsset>;

export const ViewportPreset = z.strictObject({
  id: Slug,
  layout: z.enum(["single", "side_by_side", "grid_2x2"]),
  panes: z
    .array(
      z.strictObject({
        assetId: Slug,
        frameIndex: z.number().int().min(0).nullable(),
        zoom: z.union([z.literal("fit"), z.number().min(0.25).max(8)]),
      }),
    )
    .min(1)
    .max(4),
  /** True if this preset frames or zooms a lesion (a potential hint). */
  containsLesionCue: z.boolean(),
});
export type ViewportPreset = z.infer<typeof ViewportPreset>;

// ---------------------------------------------------------------------------
// Dialogue: questions, fact replies, transitions
// ---------------------------------------------------------------------------

/** How an examiner utterance is classified for prompt-dependence (spec §10). */
export const PromptClass = z.enum(["neutral", "standard_question", "targeted_probe", "rescue", "examiner_supplied"]);
export type PromptClass = z.infer<typeof PromptClass>;

export const ApprovedQuestion = z.strictObject({
  id: Slug,
  /** Exact approved wording. The examiner may not paraphrase it. */
  text: NonEmptyText.max(600),
  purpose: z.enum(["opening", "standard", "targeted_probe", "clarification", "rescue", "closing"]),
  promptClass: PromptClass,
  /** Rubric elements this question invites (used for prompt-dependence classification). */
  targetElementIds: z.array(Slug),
  /** Rubric elements whose content this question itself discloses (no detection credit after). */
  suppliesElementIds: z.array(Slug),
  modes: z.array(z.enum(["exam", "practice"])).min(1),
  /** Lower order = asked earlier when several are eligible. */
  order: z.number().int().min(0),
  /**
   * Plain-language description of when the question is redundant (e.g. "the candidate has
   * already given a ranked differential"). Must not contain the answer.
   */
  skipIfAlreadyAddressed: z.string().max(300).nullable(),
  /** Deterministic fallback: lowercase phrases indicating the topic was already addressed. */
  addressedPatterns: z.array(z.string().max(80)),
});
export type ApprovedQuestion = z.infer<typeof ApprovedQuestion>;

export const FactReply = z.strictObject({
  id: Slug,
  /** What candidate request this answers, e.g. "candidate asks for diffusion-weighted imaging". */
  triggerDescription: NonEmptyText.max(300),
  /** Deterministic fallback trigger phrases (lowercase). Not used for assessment. */
  triggerPatterns: z.array(z.string().max(80)).min(1),
  /** Exact approved reply. */
  replyText: NonEmptyText.max(600),
  kind: z.enum(["information", "unavailable", "reveal"]),
  /** For kind=reveal: the stage revealed together with this reply. */
  revealsStageId: Slug.nullable(),
  suppliesElementIds: z.array(Slug),
  promptClass: PromptClass,
});
export type FactReply = z.infer<typeof FactReply>;

export const StageTransition = z.strictObject({
  id: Slug,
  toStageId: Slug,
  trigger: z.enum(["examiner_decision", "candidate_request", "after_question"]),
  /** For candidate_request: the fact reply that performs the reveal. */
  viaFactReplyId: Slug.nullable(),
  /** For after_question: the transition opens once these questions were delivered. */
  afterQuestionIds: z.array(Slug),
  /** Earliest case time (seconds since case start) at which this transition may occur. */
  minCaseElapsedSeconds: z.number().int().min(0).nullable(),
  description: NonEmptyText,
});
export type StageTransition = z.infer<typeof StageTransition>;

export const AllowedAction = z.enum([
  "viewer.scroll",
  "viewer.zoom_pan",
  "viewer.brightness_contrast",
  "viewer.window_level",
  "viewer.cine",
  "viewer.compare",
  "examiner.select_series",
  "examiner.set_viewport",
  "examiner.request_stage_reveal",
  "examiner.deliver_question",
  "examiner.deliver_fact_reply",
  "examiner.advance_case",
]);
export type AllowedAction = z.infer<typeof AllowedAction>;

export const CaseStage = z.strictObject({
  id: Slug,
  ordinal: z.number().int().min(0),
  /** Owner-facing label only. */
  label: NonEmptyText,
  /** History shown to the candidate when this stage is reached (appended to earlier stages). */
  candidateHistory: z.string().max(2000),
  /** Assets newly disclosed at this stage. */
  assetIds: z.array(Slug),
  viewportPresetIds: z.array(Slug),
  defaultViewportPresetId: Slug.nullable(),
  allowedActions: z.array(AllowedAction),
  allowedQuestionIds: z.array(Slug),
  approvedFactReplies: z.array(FactReply),
  transitions: z.array(StageTransition),
  assessableRubricElementIds: z.array(Slug),
  /** Guidance passed to the live examiner. Must not contain answers (checked). */
  examinerNotes: z.string().max(1000),
  /** Spoken when this stage's images are shown, after the viewer acknowledges rendering. */
  revealAnnouncement: z.string().max(300).nullable(),
});
export type CaseStage = z.infer<typeof CaseStage>;

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

/** Canonical rubric domains; each exam profile maps them to its own labels. */
export const RubricDomainId = z.enum(["observation", "interpretation", "management", "communication"]);
export type RubricDomainId = z.infer<typeof RubricDomainId>;

/** Canonical 5-level ordinal used for domain and global ratings; profiles map it for display. */
export const RatingLevel = z.enum(["unsafe", "below_expected", "meets_expected", "strong", "exceptional"]);
export type RatingLevel = z.infer<typeof RatingLevel>;
export const RATING_ORDER: readonly RatingLevel[] = ["unsafe", "below_expected", "meets_expected", "strong", "exceptional"];

export const OpportunityRule = z.strictObject({
  /**
   * from_stage_assets: assessable once `stageId` assets were rendered (spontaneous expected).
   * after_question:    assessable only after one of `questionIds` was delivered (heard).
   * either:            whichever opens first.
   */
  kind: z.enum(["from_stage_assets", "after_question", "either"]),
  stageId: Slug,
  questionIds: z.array(Slug),
  requireAllAssetsRendered: z.boolean(),
  /** Minimum time the candidate needs after the opportunity opens before omission can count. */
  minExposureSeconds: z.number().int().min(0).max(600),
});
export type OpportunityRule = z.infer<typeof OpportunityRule>;

export const CreditLevel = z.enum(["full", "partial", "none"]);
export const PromptingPolicy = z.strictObject({
  spontaneousExpected: z.boolean(),
  standardQuestionIds: z.array(Slug),
  targetedProbeIds: z.array(Slug),
  rescueIds: z.array(Slug),
  /** Product construct (not an official board category): credit by prompting level. */
  credit: z.strictObject({
    spontaneous: z.literal("full"),
    standard_question: CreditLevel,
    targeted_probe: CreditLevel,
    rescue: z.literal("none"),
    examiner_supplied: z.literal("none"),
  }),
});
export type PromptingPolicy = z.infer<typeof PromptingPolicy>;

export const RubricElement = z.strictObject({
  id: Slug,
  domain: RubricDomainId,
  /** What is being assessed, in one sentence. */
  construct: NonEmptyText.max(400),
  acceptedConcepts: z.array(NonEmptyText).min(1),
  acceptableAlternatives: z.array(NonEmptyText),
  incorrectOrUnsafeClaims: z.array(NonEmptyText),
  requiredAssetIds: z.array(Slug),
  opportunityRule: OpportunityRule,
  promptingPolicy: PromptingPolicy,
  severity: Severity,
  dependencyElementIds: z.array(Slug),
  referenceIds: z.array(Slug),
  skills: z.array(SkillId).min(1),
  /** Owner-approved feedback text; feedback never invents its own clinical teaching. */
  feedbackGuidance: z.strictObject({
    whyItMatters: NonEmptyText.max(500),
    strongerResponse: NonEmptyText.max(500),
    practiceAction: NonEmptyText.max(300),
  }),
});
export type RubricElement = z.infer<typeof RubricElement>;

export const DomainAnchor = z.strictObject({
  level: RatingLevel,
  descriptor: NonEmptyText.max(600),
});

export const RubricDomain = z.strictObject({
  id: RubricDomainId,
  description: NonEmptyText,
  anchors: z.array(DomainAnchor).length(5),
});

export const GlobalRatingRules = z.strictObject({
  /** A committed, uncorrected critical unsafe claim caps the global rating at this level. */
  criticalUnsafeCap: RatingLevel,
  /** An assessable, missed critical element caps the global rating at this level. */
  criticalOmissionCap: RatingLevel,
  /** Withhold the overall rating if this many critical/important elements are uncertain. */
  withholdIfUncertainCriticalOrImportant: z.number().int().min(1),
  anchors: z.array(DomainAnchor).length(5),
});

export const RubricVersion = z.strictObject({
  versionId: z.string().min(1),
  domains: z.array(RubricDomain).min(1),
  elements: z.array(RubricElement).min(1),
  globalRules: GlobalRatingRules,
});
export type RubricVersion = z.infer<typeof RubricVersion>;

export const ReferenceResponse = z.strictObject({
  id: Slug,
  kind: z.enum(["concise_reference", "acceptable_alternative"]),
  text: NonEmptyText.max(3000),
  coversElementIds: z.array(Slug),
});
export type ReferenceResponse = z.infer<typeof ReferenceResponse>;

// ---------------------------------------------------------------------------
// Practice-mode teaching content (never used in exam mode)
// ---------------------------------------------------------------------------

export const PracticeHint = z.strictObject({
  id: Slug,
  elementIds: z.array(Slug).min(1),
  level: z.enum(["nudge", "targeted"]),
  text: NonEmptyText.max(400),
});

export const PracticeContent = z.strictObject({
  hints: z.array(PracticeHint),
  workedExample: z.string().max(4000).nullable(),
});

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export const ClearanceRecord = z.strictObject({
  status: z.enum(["unresolved", "cleared", "restricted", "withdrawn"]),
  basis: z.string().max(1000),
  restrictions: z.string().max(1000),
  recordedBy: OpaqueId,
  recordedAt: IsoDateTime,
});
export type ClearanceRecord = z.infer<typeof ClearanceRecord>;

export const OwnerApproval = z.strictObject({
  approvedBy: OpaqueId,
  approvedAt: IsoDateTime,
  /** Hash of all clinically material content (see clinical-content/hash.ts). */
  clinicalContentHash: Sha256,
  rubricHash: Sha256,
  assetsHash: Sha256,
  attestation: NonEmptyText,
  notes: z.string().max(2000),
});
export type OwnerApproval = z.infer<typeof OwnerApproval>;

export const ChangeLogEntry = z.strictObject({
  at: IsoDateTime,
  by: z.string().min(1),
  summary: NonEmptyText,
  classification: z.enum(["clinical", "display_only"]),
});

export const CaseVersion = z.strictObject({
  schemaVersion: z.literal(CASE_SCHEMA_VERSION),
  caseId: Slug,
  versionId: z.string().min(1).max(100),
  versionNumber: z.number().int().min(1),
  previousVersionId: z.string().nullable(),
  caseFamilyId: Slug,
  internalTitle: NonEmptyText.max(200),
  /** Neutral label shown to candidates; never diagnosis-bearing. */
  candidateTitle: NonEmptyText.max(80),
  tags: z.strictObject({
    anatomy: z.array(Anatomy).min(1),
    pathology: z.array(Slug),
    skills: z.array(SkillId),
  }),
  /** Exact profile version ids or "<profileId>@*". */
  eligibleProfileVersions: z.array(z.string().min(3)).min(1),
  difficulty: z.enum(["core", "challenging", "advanced"]),
  track: z.enum(["core", "advanced"]),
  /** Fixtures are excluded from clinical scores, readiness and paid case counts. */
  isDevelopmentFixture: z.boolean(),
  source: z.strictObject({
    references: z.array(SourceReference).min(1),
    diagnosticBasis: NonEmptyText,
    truthStatus: TruthStatus,
    commercialRightsStatus: z.enum(["unresolved", "cleared", "restricted"]),
    privacyStatus: z.enum(["quarantine", "checked", "approved"]),
  }),
  clearances: z.strictObject({
    rights: ClearanceRecord.nullable(),
    privacy: ClearanceRecord.nullable(),
    /** Separate explicit flag: may approved derivatives be sent to external AI providers? */
    externalAiProcessingAllowed: z.boolean(),
  }),
  clinicalTruth: ClinicalTruth,
  openingStageId: Slug,
  assets: z.array(ApprovedAsset).min(1),
  viewportPresets: z.array(ViewportPreset),
  stages: z.array(CaseStage).min(1),
  questions: z.array(ApprovedQuestion).min(1),
  rubric: RubricVersion,
  referenceResponses: z.array(ReferenceResponse).min(1),
  practice: PracticeContent,
  ownerApproval: OwnerApproval.nullable(),
  publicationStatus: PublicationStatus,
  changeLog: z.array(ChangeLogEntry),
});
export type CaseVersion = z.infer<typeof CaseVersion>;
