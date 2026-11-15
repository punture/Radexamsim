import { createHash } from "node:crypto";
import type { CaseVersion } from "@sim/contracts";

/**
 * Content hashing for approval binding (spec §3). Owner approval binds to the exact
 * clinical content, rubric and asset versions. Server-only (uses node:crypto).
 *
 * DISPLAY-ONLY fields — changes to these do NOT invalidate clinical approval:
 *   internalTitle, tags, difficulty, track, eligibleProfileVersions, changeLog,
 *   version metadata (versionId, versionNumber, previousVersionId), workflow state
 *   (publicationStatus, ownerApproval) and governance records (clearances,
 *   source.commercialRightsStatus, source.privacyStatus — approved separately).
 * Storage keys are excluded from the assets hash (moving a file does not change it);
 * frame SHA-256 digests are included, so any pixel change requires re-approval.
 * EVERYTHING ELSE is clinically material, including candidate-visible wording, initial
 * frame/zoom (which can act as hints), questions, replies, rubric and reference responses.
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export type ContentHashes = { clinicalContentHash: string; rubricHash: string; assetsHash: string };

export function computeContentHashes(cv: CaseVersion): ContentHashes {
  const assetsMaterial = cv.assets.map((a) => ({
    ...a,
    frames: a.frames.map(({ storageKey: _omit, ...rest }) => rest),
  }));
  const assetsHash = sha256Hex(canonicalJson(assetsMaterial));
  const rubricHash = sha256Hex(canonicalJson(cv.rubric));
  const clinicalMaterial = {
    schemaVersion: cv.schemaVersion,
    caseId: cv.caseId,
    caseFamilyId: cv.caseFamilyId,
    candidateTitle: cv.candidateTitle,
    isDevelopmentFixture: cv.isDevelopmentFixture,
    source: { references: cv.source.references, diagnosticBasis: cv.source.diagnosticBasis, truthStatus: cv.source.truthStatus },
    clinicalTruth: cv.clinicalTruth,
    openingStageId: cv.openingStageId,
    viewportPresets: cv.viewportPresets,
    stages: cv.stages,
    questions: cv.questions,
    referenceResponses: cv.referenceResponses,
    practice: cv.practice,
    assetsHash,
    rubricHash,
  };
  return { clinicalContentHash: sha256Hex(canonicalJson(clinicalMaterial)), rubricHash, assetsHash };
}

export function approvalMatches(cv: CaseVersion): boolean {
  if (!cv.ownerApproval) return false;
  const h = computeContentHashes(cv);
  return (
    cv.ownerApproval.clinicalContentHash === h.clinicalContentHash &&
    cv.ownerApproval.rubricHash === h.rubricHash &&
    cv.ownerApproval.assetsHash === h.assetsHash
  );
}

export type ChangeClassification = { kind: "identical" | "display_only" | "clinical"; changed: string[] };

/** Classify the difference between two versions of the same case. */
export function classifyChange(prev: CaseVersion, next: CaseVersion): ChangeClassification {
  const a = computeContentHashes(prev);
  const b = computeContentHashes(next);
  const changed: string[] = [];
  if (a.assetsHash !== b.assetsHash) changed.push("assets");
  if (a.rubricHash !== b.rubricHash) changed.push("rubric");
  if (a.clinicalContentHash !== b.clinicalContentHash && changed.length === 0) changed.push("clinical content");
  if (changed.length > 0) return { kind: "clinical", changed };
  const display: (keyof CaseVersion)[] = ["internalTitle", "tags", "difficulty", "track", "eligibleProfileVersions"];
  for (const k of display) if (canonicalJson(prev[k]) !== canonicalJson(next[k])) changed.push(k);
  return { kind: changed.length ? "display_only" : "identical", changed };
}
