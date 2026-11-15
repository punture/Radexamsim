import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { z } from "zod";
import { CaseVersion, type ApprovedAsset } from "@sim/contracts";
import { DRAFT_PLACEHOLDER, approvalMatches, canTransition, classifyChange, computeContentHashes, publicationGate, validateCaseVersion } from "@sim/clinical-content";
import {
  and,
  assetHandles,
  caseAttempts,
  caseReviews,
  caseVersions,
  cases,
  desc,
  enqueue,
  eq,
  inArray,
  ownerReviewItems,
  sql,
  type Db,
} from "@sim/db";
import type { Deps } from "../deps";
import { HttpError, badRequest, conflict, notFound } from "../http";
import { audit } from "./audit";
import { invalidateCaseCache } from "./content";

/**
 * Owner case workflow (spec §3): draft → automated_checks → ready_for_owner →
 * owner_approved → published → retired. Approval binds to the exact content hashes the
 * owner reviewed; any material change requires a new version and renewed approval.
 */

export const ImportPackage = z.object({
  format: z.literal("sim-case-import@1"),
  caseId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  caseFamilyId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  internalTitle: z.string().min(1).max(200),
  sourceDiagnosis: z.string().nullable(),
  diagnosticBasis: z.string().nullable(),
  truthStatus: z.enum(["confirmed", "probable", "differential_only"]).nullable(),
  sourceReferences: z.array(z.object({ id: z.string(), kind: z.enum(["pptx_slide", "image_file", "pdf_page", "dicom_series", "cine_clip"]), sourceFileId: z.string().nullable(), locator: z.string().nullable(), description: z.string() })).min(1),
  assets: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["still", "stack", "cine", "dicom_stack"]),
        modality: z.string(),
        neutralLabel: z.string(),
        sequence: z.string().nullable(),
        plane: z.string().nullable(),
        contrast: z.string().nullable(),
        frames: z.array(z.object({ index: z.number().int(), file: z.string(), mimeType: z.string(), width: z.number().int().nullable(), height: z.number().int().nullable(), sha256: z.string(), byteSize: z.number().int() })).min(1),
        derivation: z.object({ sourceReferenceId: z.string(), method: z.string(), notes: z.string(), preservesDiagnosticContent: z.boolean(), burnedInAnnotationsPresent: z.boolean() }),
        dicom: z.unknown().nullable(),
      }),
    )
    .min(1),
  teachingText: z.string().nullable(),
  privacyFindings: z.array(z.object({ severity: z.string(), location: z.string(), finding: z.string() })),
  privacyStatus: z.enum(["quarantine", "checked"]),
  notes: z.string(),
});
export type ImportPackage = z.infer<typeof ImportPackage>;

const P = DRAFT_PLACEHOLDER;
const DOMAIN_ANCHORS = (["observation", "interpretation", "management", "communication"] as const).map((id) => ({
  id,
  description: `${P} describe the ${id} domain for this case`,
  anchors: (["unsafe", "below_expected", "meets_expected", "strong", "exceptional"] as const).map((level) => ({ level, descriptor: `${P} ${level} anchor` })),
}));

/** Build a schema-valid DRAFT from an import package; owner/LLM author completes the placeholders. */
export function draftFromImport(pkg: ImportPackage, storedFrames: Map<string, string>, createdBy: string): CaseVersion {
  const versionId = `${pkg.caseId}@v1`;
  const assets = pkg.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    modality: (["CT", "CTA", "CTP", "MR", "MRA", "MRV", "DSA", "US", "XR", "NM", "PET"].includes(a.modality) ? a.modality : "other") as ApprovedAsset["modality"],
    neutralLabel: a.neutralLabel,
    sequence: a.sequence,
    plane: (["axial", "coronal", "sagittal", "oblique", "3d", "projection"].includes(a.plane ?? "") ? a.plane : null) as ApprovedAsset["plane"],
    contrast: (["none", "intravenous", "intrathecal", "unknown"].includes(a.contrast ?? "") ? a.contrast : null) as ApprovedAsset["contrast"],
    frames: a.frames.map((f) => ({ index: f.index, storageKey: storedFrames.get(`${a.id}/${f.index}`)!, mimeType: f.mimeType as ApprovedAsset["frames"][number]["mimeType"], width: f.width, height: f.height, sha256: f.sha256, byteSize: f.byteSize, sliceLocation: null, instanceNumber: null })),
    derivation: { ...a.derivation, method: a.derivation.method as ApprovedAsset["derivation"]["method"] },
    isPlaceholder: false,
    display: { initialFrameIndex: 0, initialZoom: "fit" as const, frameRateFps: a.kind === "cine" ? 8 : null },
    dicom: (a.dicom ?? null) as ApprovedAsset["dicom"],
    annotations: [],
  }));
  const allAssetIds = assets.map((a) => a.id);
  const draft = {
    schemaVersion: 1 as const,
    caseId: pkg.caseId,
    versionId,
    versionNumber: 1,
    previousVersionId: null,
    caseFamilyId: pkg.caseFamilyId,
    internalTitle: pkg.internalTitle,
    candidateTitle: "Neuroradiology case",
    tags: { anatomy: ["brain" as const], pathology: [], skills: [] },
    eligibleProfileVersions: ["abr-dr-neuro-oral@*", "rcpsc-dr-neuro-practice@*"],
    difficulty: "core" as const,
    track: "core" as const,
    isDevelopmentFixture: false,
    source: {
      references: pkg.sourceReferences.map((r) => ({ ...r, citation: null })),
      diagnosticBasis: pkg.diagnosticBasis ?? `${P} diagnostic basis (pathology, follow-up, consensus…)`,
      truthStatus: pkg.truthStatus ?? ("probable" as const),
      commercialRightsStatus: "unresolved" as const,
      privacyStatus: pkg.privacyStatus,
    },
    clearances: { rights: null, privacy: null, externalAiProcessingAllowed: false },
    clinicalTruth: {
      finalDiagnosis: pkg.sourceDiagnosis ?? `${P} final diagnosis`,
      displayedMaterialSupports: pkg.truthStatus === "differential_only" ? ("differential_only" as const) : ("leading_with_differential" as const),
      keyFindings: [{ id: "kf-1", description: `${P} key finding`, location: `${P} location`, laterality: "not_applicable" as const, assetIds: [allAssetIds[0]!], conspicuity: "moderate" as const }],
      acceptableDiagnoses: [],
      differential: [],
      managementExpectations: [],
      urgency: "routine" as const,
      criticalCommunication: null,
      uncertaintyNotes: "",
      teachingPoints: [],
      leakCanary: null,
    },
    openingStageId: "st-1",
    assets,
    viewportPresets: [],
    stages: [
      {
        id: "st-1",
        ordinal: 0,
        label: "Opening images",
        candidateHistory: `${P} brief candidate history`,
        assetIds: allAssetIds,
        viewportPresetIds: [],
        defaultViewportPresetId: null,
        allowedActions: ["viewer.scroll", "viewer.zoom_pan", "viewer.brightness_contrast", "viewer.compare", "viewer.cine", "examiner.select_series", "examiner.deliver_question", "examiner.deliver_fact_reply", "examiner.advance_case"] as CaseVersion["stages"][number]["allowedActions"],
        allowedQuestionIds: ["q-open", "q-ddx", "q-next"],
        approvedFactReplies: [{ id: "fr-prior", triggerDescription: "candidate asks for prior imaging", triggerPatterns: ["prior", "previous", "comparison"], replyText: "No prior imaging is available.", kind: "unavailable" as const, revealsStageId: null, suppliesElementIds: [], promptClass: "neutral" as const }],
        transitions: [],
        assessableRubricElementIds: ["e-1"],
        examinerNotes: "",
        revealAnnouncement: null,
      },
    ],
    questions: [
      { id: "q-open", text: "Please review the images and present your findings and interpretation.", purpose: "opening" as const, promptClass: "neutral" as const, targetElementIds: [], suppliesElementIds: [], modes: ["exam" as const, "practice" as const], order: 0, skipIfAlreadyAddressed: null, addressedPatterns: [] },
      { id: "q-ddx", text: "What is your leading diagnosis and differential?", purpose: "standard" as const, promptClass: "standard_question" as const, targetElementIds: ["e-1"], suppliesElementIds: [], modes: ["exam" as const, "practice" as const], order: 1, skipIfAlreadyAddressed: null, addressedPatterns: [] },
      { id: "q-next", text: "What would you recommend next?", purpose: "standard" as const, promptClass: "standard_question" as const, targetElementIds: [], suppliesElementIds: [], modes: ["exam" as const, "practice" as const], order: 2, skipIfAlreadyAddressed: null, addressedPatterns: [] },
    ],
    rubric: {
      versionId: `${pkg.caseId}-rubric@v1`,
      domains: DOMAIN_ANCHORS,
      elements: [
        {
          id: "e-1",
          domain: "observation" as const,
          construct: `${P} what is assessed`,
          acceptedConcepts: [`${P} accepted concept`],
          acceptableAlternatives: [],
          incorrectOrUnsafeClaims: [],
          requiredAssetIds: [allAssetIds[0]!],
          opportunityRule: { kind: "from_stage_assets" as const, stageId: "st-1", questionIds: [], requireAllAssetsRendered: true, minExposureSeconds: 20 },
          promptingPolicy: { spontaneousExpected: true, standardQuestionIds: [], targetedProbeIds: [], rescueIds: [], credit: { spontaneous: "full" as const, standard_question: "full" as const, targeted_probe: "partial" as const, rescue: "none" as const, examiner_supplied: "none" as const } },
          severity: "important" as const,
          dependencyElementIds: [],
          referenceIds: [pkg.sourceReferences[0]!.id],
          skills: ["detection" as const],
          feedbackGuidance: { whyItMatters: `${P} why it matters`, strongerResponse: `${P} stronger response`, practiceAction: `${P} practice action` },
        },
      ],
      globalRules: { criticalUnsafeCap: "unsafe" as const, criticalOmissionCap: "below_expected" as const, withholdIfUncertainCriticalOrImportant: 2, anchors: (["unsafe", "below_expected", "meets_expected", "strong", "exceptional"] as const).map((level) => ({ level, descriptor: `${P} ${level}` })) },
    },
    referenceResponses: [{ id: "ref-concise", kind: "concise_reference" as const, text: `${P} concise reference response`, coversElementIds: ["e-1"] }],
    practice: { hints: [], workedExample: null },
    ownerApproval: null,
    publicationStatus: "draft" as const,
    changeLog: [{ at: new Date().toISOString(), by: createdBy, summary: `Imported from package (${pkg.assets.length} assets). Privacy findings: ${pkg.privacyFindings.length}.`, classification: "clinical" as const }],
  };
  return CaseVersion.parse(draft);
}

export async function importPackage(deps: Deps, ownerId: string, zip: Uint8Array): Promise<{ versionId: string; issues: unknown[] }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw badRequest("invalid_zip", "the upload is not a valid zip archive");
  }
  const manifestName = Object.keys(files).find((n) => n.endsWith("case-import.json"));
  if (!manifestName) throw badRequest("missing_manifest", "case-import.json not found in the package");
  const base = manifestName.slice(0, -"case-import.json".length);
  const parsed = ImportPackage.safeParse(JSON.parse(new TextDecoder().decode(files[manifestName]!)));
  if (!parsed.success) throw new HttpError(400, "invalid_package", "the import package does not match sim-case-import@1", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const pkg = parsed.data;
  if (pkg.privacyFindings.some((f) => f.severity === "high")) throw new HttpError(409, "privacy_findings", "the package has unresolved high-severity privacy findings; resolve them in the ingestion tool first");
  const [existing] = await deps.db.select().from(cases).where(eq(cases.caseId, pkg.caseId));
  if (existing) throw conflict("case_exists", "a case with this id already exists; create a new version instead");
  const versionId = `${pkg.caseId}@v1`;
  const stored = new Map<string, string>();
  for (const a of pkg.assets) {
    for (const f of a.frames) {
      const bytes = files[base + f.file];
      if (!bytes) throw badRequest("missing_frame", `frame file ${f.file} not found in package`);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== f.sha256) throw badRequest("digest_mismatch", `frame ${f.file} digest does not match the manifest`);
      if (bytes.byteLength > 50 * 1024 * 1024) throw badRequest("frame_too_large", `frame ${f.file} exceeds 50 MB`);
      const ext = f.mimeType === "image/png" ? "png" : f.mimeType === "image/jpeg" ? "jpg" : f.mimeType === "image/webp" ? "webp" : f.mimeType === "application/dicom" ? "dcm" : "bin";
      const key = `cases/${pkg.caseId}/${versionId.replace("@", "_")}/${a.id}/${f.index}.${ext}`;
      await deps.storage.put("derivatives", key, bytes, f.mimeType);
      stored.set(`${a.id}/${f.index}`, key);
    }
  }
  const draft = draftFromImport(pkg, stored, ownerId);
  const v = validateCaseVersion(draft);
  const hashes = computeContentHashes(draft);
  await deps.db.transaction(async (tx) => {
    await tx.insert(cases).values({ caseId: pkg.caseId, caseFamilyId: pkg.caseFamilyId });
    await tx.insert(caseVersions).values({ versionId, caseId: pkg.caseId, versionNumber: 1, payload: draft, publicationStatus: "draft", ...hashes, isFixture: false, validationIssues: v.ok ? v.warnings : v.issues, createdBy: ownerId });
  });
  await audit(deps.db, ownerId, "case.imported", "case_version", versionId, { assets: pkg.assets.length });
  return { versionId, issues: v.ok ? v.warnings : v.issues };
}

export async function loadVersionRow(db: Db, versionId: string) {
  const [row] = await db.select().from(caseVersions).where(eq(caseVersions.versionId, versionId));
  if (!row) throw notFound("case version");
  return row;
}

export async function versionDetail(deps: Deps, versionId: string) {
  const row = await loadVersionRow(deps.db, versionId);
  const cv = CaseVersion.parse(row.payload);
  const reviews = await deps.db.select().from(caseReviews).where(eq(caseReviews.caseVersionId, versionId)).orderBy(desc(caseReviews.createdAt));
  const [caseRow] = await deps.db.select().from(cases).where(eq(cases.caseId, cv.caseId));
  const versions = await deps.db.select({ versionId: caseVersions.versionId, versionNumber: caseVersions.versionNumber, status: caseVersions.publicationStatus }).from(caseVersions).where(eq(caseVersions.caseId, cv.caseId)).orderBy(caseVersions.versionNumber);
  const prevRow = cv.previousVersionId ? await loadVersionRow(deps.db, cv.previousVersionId).catch(() => null) : null;
  const gate = publicationGate(cv, { allowFixtures: deps.config.ALLOW_FIXTURES });
  return {
    versionId,
    rowVersion: row.rowVersion,
    status: row.publicationStatus,
    payload: cv,
    hashes: computeContentHashes(cv),
    approvalValid: cv.ownerApproval ? approvalMatches(cv) : null,
    validationIssues: row.validationIssues,
    reviews: reviews.map((r) => ({ id: r.id, reviewer: r.reviewer, status: r.status, summary: r.summary, issues: r.issues, createdAt: r.createdAt.toISOString() })),
    publicationGate: gate,
    case: { caseId: cv.caseId, publishedVersionId: caseRow?.publishedVersionId ?? null, withdrawnAt: caseRow?.withdrawnAt?.toISOString() ?? null, withdrawalReason: caseRow?.withdrawalReason ?? null },
    versions,
    changeFromPrevious: prevRow ? classifyChange(CaseVersion.parse(prevRow.payload), cv) : null,
  };
}

export async function saveDraft(deps: Deps, ownerId: string, versionId: string, payload: unknown, expectedRowVersion: number) {
  const row = await loadVersionRow(deps.db, versionId);
  if (row.publicationStatus !== "draft") throw conflict("not_draft", "only draft versions can be edited; create a new version to revise approved or published content");
  const parsed = CaseVersion.safeParse(payload);
  if (!parsed.success) throw new HttpError(400, "invalid_case", "the case does not match the schema", parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })));
  const cv = parsed.data;
  if (cv.versionId !== versionId || cv.caseId !== row.caseId) throw badRequest("id_mismatch", "caseId/versionId cannot be changed");
  const next: CaseVersion = { ...cv, publicationStatus: "draft", ownerApproval: null };
  const v = validateCaseVersion(next);
  const hashes = computeContentHashes(next);
  const updated = await deps.db
    .update(caseVersions)
    .set({ payload: next, ...hashes, validationIssues: v.ok ? v.warnings : v.issues, updatedAt: new Date(), rowVersion: sql`${caseVersions.rowVersion} + 1` })
    .where(and(eq(caseVersions.versionId, versionId), eq(caseVersions.rowVersion, expectedRowVersion)))
    .returning({ rowVersion: caseVersions.rowVersion });
  if (!updated[0]) throw conflict("stale_version", "this draft was changed elsewhere; reload before saving");
  invalidateCaseCache(versionId);
  await audit(deps.db, ownerId, "case.draft_saved", "case_version", versionId);
  return { rowVersion: updated[0].rowVersion, issues: v.ok ? v.warnings : v.issues, valid: v.ok };
}

export async function newVersion(deps: Deps, ownerId: string, fromVersionId: string) {
  const row = await loadVersionRow(deps.db, fromVersionId);
  const cv = CaseVersion.parse(row.payload);
  const [latest] = await deps.db.select().from(caseVersions).where(eq(caseVersions.caseId, cv.caseId)).orderBy(desc(caseVersions.versionNumber)).limit(1);
  const n = (latest?.versionNumber ?? cv.versionNumber) + 1;
  const versionId = `${cv.caseId}@v${n}`;
  const next: CaseVersion = { ...cv, versionId, versionNumber: n, previousVersionId: fromVersionId, ownerApproval: null, publicationStatus: "draft", rubric: { ...cv.rubric, versionId: `${cv.caseId}-rubric@v${n}` }, changeLog: [...cv.changeLog, { at: new Date().toISOString(), by: ownerId, summary: `New version from ${fromVersionId}`, classification: "clinical" }] };
  const v = validateCaseVersion(next);
  await deps.db.insert(caseVersions).values({ versionId, caseId: cv.caseId, versionNumber: n, payload: next, publicationStatus: "draft", ...computeContentHashes(next), isFixture: cv.isDevelopmentFixture, validationIssues: v.ok ? v.warnings : v.issues, createdBy: ownerId });
  await audit(deps.db, ownerId, "case.version_created", "case_version", versionId, { from: fromVersionId });
  return { versionId };
}

async function setStatus(deps: Deps, versionId: string, cv: CaseVersion, to: CaseVersion["publicationStatus"], extra: Partial<CaseVersion> = {}) {
  const t = canTransition(cv.publicationStatus, to);
  if (!t.ok) throw conflict(t.code, t.message);
  const payload: CaseVersion = { ...cv, ...extra, publicationStatus: to };
  await deps.db.update(caseVersions).set({ payload, publicationStatus: to, ...computeContentHashes(payload), updatedAt: new Date(), rowVersion: sql`${caseVersions.rowVersion} + 1` }).where(eq(caseVersions.versionId, versionId));
  invalidateCaseCache(versionId);
  return payload;
}

export async function submitForChecks(deps: Deps, ownerId: string, versionId: string) {
  const row = await loadVersionRow(deps.db, versionId);
  const cv = CaseVersion.parse(row.payload);
  await setStatus(deps, versionId, cv, "automated_checks");
  await enqueue(deps.db, { kind: "case_automated_checks", payload: { versionId }, dedupeKey: `checks:${versionId}:${row.rowVersion + 1}` });
  await audit(deps.db, ownerId, "case.submitted_for_checks", "case_version", versionId);
  return { status: "automated_checks" };
}

export async function approve(deps: Deps, ownerId: string, versionId: string, body: { attestation: string; notes: string; expectedClinicalContentHash: string }) {
  const row = await loadVersionRow(deps.db, versionId);
  const cv = CaseVersion.parse(row.payload);
  if (cv.publicationStatus !== "ready_for_owner") throw conflict("not_ready", "only versions that passed automated checks can be approved");
  const v = validateCaseVersion(cv);
  if (!v.ok) throw conflict("validation_errors", "the version has validation errors");
  const hashes = computeContentHashes(cv);
  // The owner approves exactly what was shown; a concurrent change invalidates the approval.
  if (hashes.clinicalContentHash !== body.expectedClinicalContentHash) throw conflict("content_changed", "the content changed since you opened it; reload and review again");
  await setStatus(deps, versionId, cv, "owner_approved", { ownerApproval: { approvedBy: ownerId, approvedAt: new Date().toISOString(), ...hashes, attestation: body.attestation, notes: body.notes } });
  await deps.db.update(ownerReviewItems).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: ownerId, resolution: "approved" }).where(and(eq(ownerReviewItems.kind, "case_ready_for_approval"), sql`${ownerReviewItems.refs}->>'versionId' = ${versionId}`));
  await audit(deps.db, ownerId, "case.approved", "case_version", versionId, { clinicalContentHash: hashes.clinicalContentHash });
  return { status: "owner_approved", hashes };
}

export async function requestChanges(deps: Deps, ownerId: string, versionId: string, notes: string) {
  const row = await loadVersionRow(deps.db, versionId);
  const cv = CaseVersion.parse(row.payload);
  await setStatus(deps, versionId, cv, "draft", { ownerApproval: null, changeLog: [...cv.changeLog, { at: new Date().toISOString(), by: ownerId, summary: `Changes requested: ${notes.slice(0, 300)}`, classification: "clinical" }] });
  await audit(deps.db, ownerId, "case.changes_requested", "case_version", versionId);
  return { status: "draft" };
}

export async function updateClearances(deps: Deps, ownerId: string, versionId: string, body: { rights?: { status: "unresolved" | "cleared" | "restricted" | "withdrawn"; basis: string; restrictions: string }; privacy?: { status: "unresolved" | "cleared" | "restricted" | "withdrawn"; basis: string; restrictions: string }; externalAiProcessingAllowed?: boolean }) {
  const row = await loadVersionRow(deps.db, versionId);
  const cv = CaseVersion.parse(row.payload);
  if (cv.publicationStatus === "retired") throw conflict("retired", "retired versions cannot be changed");
  const now = new Date().toISOString();
  const clearances = {
    rights: body.rights ? { ...body.rights, recordedBy: ownerId, recordedAt: now } : cv.clearances.rights,
    privacy: body.privacy ? { ...body.privacy, recordedBy: ownerId, recordedAt: now } : cv.clearances.privacy,
    externalAiProcessingAllowed: body.externalAiProcessingAllowed ?? cv.clearances.externalAiProcessingAllowed,
  };
  const source = {
    ...cv.source,
    commercialRightsStatus: clearances.rights?.status === "cleared" ? ("cleared" as const) : clearances.rights?.status === "restricted" ? ("restricted" as const) : ("unresolved" as const),
    privacyStatus: clearances.privacy?.status === "cleared" ? ("approved" as const) : cv.source.privacyStatus === "approved" ? ("checked" as const) : cv.source.privacyStatus,
  };
  // Governance records are excluded from the clinical hash: approval stays valid.
  const payload: CaseVersion = { ...cv, clearances, source };
  await deps.db.update(caseVersions).set({ payload, updatedAt: new Date(), rowVersion: sql`${caseVersions.rowVersion} + 1` }).where(eq(caseVersions.versionId, versionId));
  invalidateCaseCache(versionId);
  await audit(deps.db, ownerId, "case.clearances_updated", "case_version", versionId, { rights: clearances.rights?.status ?? null, privacy: clearances.privacy?.status ?? null, externalAi: clearances.externalAiProcessingAllowed });
  return { clearances, source };
}

export async function publish(deps: Deps, ownerId: string, versionId: string) {
  const row = await loadVersionRow(deps.db, versionId);
  const cv = CaseVersion.parse(row.payload);
  const gate = publicationGate(cv, { allowFixtures: deps.config.ALLOW_FIXTURES });
  if (!gate.ok) throw conflict(gate.code, gate.message);
  const [caseRow] = await deps.db.select().from(cases).where(eq(cases.caseId, cv.caseId));
  if (caseRow?.withdrawnAt) throw conflict("withdrawn", "withdrawn cases cannot be republished");
  await setStatus(deps, versionId, cv, "published");
  if (caseRow?.publishedVersionId && caseRow.publishedVersionId !== versionId) {
    const prev = await loadVersionRow(deps.db, caseRow.publishedVersionId);
    const prevCv = CaseVersion.parse(prev.payload);
    if (prevCv.publicationStatus === "published") await setStatus(deps, prev.versionId, prevCv, "retired");
  }
  await deps.db.update(cases).set({ publishedVersionId: versionId }).where(eq(cases.caseId, cv.caseId));
  await audit(deps.db, ownerId, "case.published", "case_version", versionId);
  return { status: "published" };
}

export async function retire(deps: Deps, ownerId: string, versionId: string) {
  const row = await loadVersionRow(deps.db, versionId);
  const cv = CaseVersion.parse(row.payload);
  await setStatus(deps, versionId, cv, "retired");
  await deps.db.update(cases).set({ publishedVersionId: null }).where(and(eq(cases.caseId, cv.caseId), eq(cases.publishedVersionId, versionId)));
  await audit(deps.db, ownerId, "case.retired", "case_version", versionId);
  return { status: "retired" };
}

/**
 * Withdrawal (unsafe or unauthorized material): stops new selection, revokes media access
 * immediately for every attempt (including replay), and lists affected attempts for review.
 * Historical assessments are preserved but flagged.
 */
export async function withdraw(deps: Deps, ownerId: string, caseId: string, reason: string) {
  const [caseRow] = await deps.db.select().from(cases).where(eq(cases.caseId, caseId));
  if (!caseRow) throw notFound("case");
  const versionIds = (await deps.db.select({ v: caseVersions.versionId }).from(caseVersions).where(eq(caseVersions.caseId, caseId))).map((r) => r.v);
  const affected = versionIds.length ? await deps.db.select({ id: caseAttempts.id, sessionId: caseAttempts.sessionId, userId: caseAttempts.userId }).from(caseAttempts).where(inArray(caseAttempts.caseVersionId, versionIds)) : [];
  await deps.db.transaction(async (tx) => {
    await tx.update(cases).set({ withdrawnAt: new Date(), withdrawalReason: reason, publishedVersionId: null }).where(eq(cases.caseId, caseId));
    if (versionIds.length) await tx.update(assetHandles).set({ revokedAt: new Date() }).where(inArray(assetHandles.caseVersionId, versionIds));
    await tx.insert(ownerReviewItems).values({
      kind: "rights_privacy_concern",
      priority: "normal",
      title: `Case withdrawn: ${caseId}`,
      detail: `Reason: ${reason}. Media access revoked for ${affected.length} attempt(s). Review whether affected learners need notice or usage adjustment.`,
      refs: { caseId, affectedAttempts: String(affected.length) },
      dedupeKey: `withdrawn:${caseId}:${Date.now()}`,
    });
  });
  for (const v of versionIds) invalidateCaseCache(v);
  await audit(deps.db, ownerId, "case.withdrawn", "case", caseId, { reason, affectedAttempts: affected.length });
  return { affectedAttempts: affected.length };
}

export { caseReviews };
