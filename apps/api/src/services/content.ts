import { CaseVersion, ExamProfileVersion } from "@sim/contracts";
import { caseVersions, cases, eq, examProfiles, systemConfig, type DbOrTx } from "@sim/db";

/**
 * Content loaders. Case and profile VERSIONS are immutable once referenced by an attempt,
 * so they are safe to cache by version id. Withdrawal state is NOT cached.
 */
const caseCache = new Map<string, CaseVersion>();
const profileCache = new Map<string, ExamProfileVersion>();

export async function getCaseVersion(db: DbOrTx, versionId: string): Promise<CaseVersion> {
  const hit = caseCache.get(versionId);
  if (hit) return hit;
  const [row] = await db.select().from(caseVersions).where(eq(caseVersions.versionId, versionId));
  if (!row) throw new Error(`case version ${versionId} not found`);
  const cv = CaseVersion.parse(row.payload);
  // Only cache versions that can no longer change (anything past draft editing).
  if (row.publicationStatus !== "draft") caseCache.set(versionId, cv);
  return cv;
}

export function invalidateCaseCache(versionId: string): void {
  caseCache.delete(versionId);
}

export async function getProfile(db: DbOrTx, versionId: string): Promise<ExamProfileVersion> {
  const hit = profileCache.get(versionId);
  if (hit) return hit;
  const [row] = await db.select().from(examProfiles).where(eq(examProfiles.versionId, versionId));
  if (!row) throw new Error(`profile ${versionId} not found`);
  const p = ExamProfileVersion.parse(row.payload);
  profileCache.set(versionId, p);
  return p;
}

export async function isCaseWithdrawn(db: DbOrTx, caseId: string): Promise<boolean> {
  const [row] = await db.select({ w: cases.withdrawnAt }).from(cases).where(eq(cases.caseId, caseId));
  return !!row?.w;
}

/** Owner-controlled kill switches and runtime policy (spec §15). */
export type RuntimeSwitches = {
  examinerLlmDisabled: boolean;
  assessmentLlmDisabled: boolean;
  serverTtsDisabled: boolean;
  serverAsrDisabled: boolean;
  disabledCaseIds: string[];
};

export async function getSwitches(db: DbOrTx): Promise<RuntimeSwitches> {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, "switches"));
  const v = (row?.value ?? {}) as Partial<RuntimeSwitches>;
  return {
    examinerLlmDisabled: v.examinerLlmDisabled ?? false,
    assessmentLlmDisabled: v.assessmentLlmDisabled ?? false,
    serverTtsDisabled: v.serverTtsDisabled ?? false,
    serverAsrDisabled: v.serverAsrDisabled ?? false,
    disabledCaseIds: v.disabledCaseIds ?? [],
  };
}
