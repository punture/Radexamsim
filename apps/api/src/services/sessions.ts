import type { ExamMode } from "@sim/contracts";
import { usageSummary } from "@sim/billing";
import { assembleForm, newClock, type CaseCandidate } from "@sim/exam-engine";
import {
  and,
  caseAttempts,
  caseVersions,
  cases,
  entitlements,
  eq,
  examForms,
  inArray,
  isNull,
  stationSessions,
  systemConfig,
  type Db,
} from "@sim/db";
import type { AuthContext } from "../auth/context";
import type { Deps } from "../deps";
import { HttpError, badRequest, forbidden } from "../http";
import { getCaseVersion, getProfile, getSwitches } from "./content";

export type CreateSessionInput = {
  profileVersionId: string;
  mode: ExamMode;
  caseCount?: number;
  inputMode: "voice" | "typed_practice";
  demo?: boolean;
  /** Owner preview of specific case versions (any status). */
  previewCaseVersionIds?: string[];
  /** Learning-plan assignment: case ids resolved server-side from an opaque token. */
  assignedCaseIds?: string[];
  preferredSkills?: string[];
};

export async function demoCaseIds(db: Db, allowFixtures: boolean): Promise<string[]> {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, "demo_case_ids"));
  const configured = (row?.value as string[] | undefined) ?? [];
  if (configured.length) return configured;
  return allowFixtures ? ["fx-stroke-lmca"] : [];
}

/** Published, non-withdrawn, non-disabled cases as form-assembly candidates. */
export async function publishedCandidates(db: Db): Promise<(CaseCandidate & { caseId: string })[]> {
  const switches = await getSwitches(db);
  const rows = await db
    .select({ versionId: caseVersions.versionId })
    .from(cases)
    .innerJoin(caseVersions, eq(caseVersions.versionId, cases.publishedVersionId))
    .where(and(isNull(cases.withdrawnAt), eq(caseVersions.publicationStatus, "published")));
  const out: (CaseCandidate & { caseId: string })[] = [];
  for (const r of rows) {
    const cv = await getCaseVersion(db, r.versionId);
    if (switches.disabledCaseIds.includes(cv.caseId)) continue;
    out.push(cv);
  }
  return out;
}

export async function seenFamilies(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.select({ f: caseAttempts.caseFamilyId }).from(caseAttempts).where(and(eq(caseAttempts.userId, userId), eq(caseAttempts.status, "closed")));
  return new Set(rows.map((r) => r.f));
}

export async function createStationSession(deps: Deps, auth: AuthContext, input: CreateSessionInput): Promise<{ sessionId: string; notes: string[] }> {
  const { db, config } = deps;
  const profile = await getProfile(db, input.profileVersionId).catch(() => {
    throw badRequest("unknown_profile", "unknown examination profile version");
  });
  if (input.mode === "owner_preview") {
    if (auth.role !== "owner") throw forbidden("owner preview requires the owner role");
  } else if (!profile.modes.includes(input.mode)) {
    throw badRequest("mode_not_available", `${input.mode} mode is not available for this profile`);
  }
  if (input.inputMode === "typed_practice" && input.mode === "exam") {
    throw badRequest("typed_not_allowed", "typed answers are a separate practice experience and are not available in examination mode");
  }

  let restrictToCaseIds: string[] | undefined;
  let caseCount = Math.min(profile.station.maxCases, Math.max(profile.station.minCases, input.caseCount ?? Math.min(profile.station.maxCases, Math.max(profile.station.minCases, 3))));
  let isDemo = false;
  if (input.demo) {
    if (input.mode !== "practice") throw badRequest("demo_practice_only", "the demonstration runs in practice mode");
    restrictToCaseIds = await demoCaseIds(db, config.ALLOW_FIXTURES);
    if (restrictToCaseIds.length === 0) throw new HttpError(409, "demo_unavailable", "no demonstration case is configured");
    const [ent] = await db.select().from(entitlements).where(eq(entitlements.userId, auth.userId));
    if ((ent?.demoCasesRemaining ?? 1) <= 0) throw new HttpError(402, "demo_used", "the free demonstration has already been used");
    caseCount = 1;
    isDemo = true;
  } else if (input.mode !== "owner_preview" && config.BILLING_ENFORCED) {
    const usage = await usageSummary(db, auth.userId);
    if (!usage.canStartPaidStation) throw new HttpError(402, "not_entitled", usage.blockingReason ?? "an active subscription is required");
    const needed = Math.ceil(profile.station.durationSeconds / 60);
    if (usage.availableMinutes < needed) throw new HttpError(402, "insufficient_minutes", `This station needs ${needed} minutes; ${usage.availableMinutes} remain.`);
  }
  if (input.assignedCaseIds?.length) restrictToCaseIds = input.assignedCaseIds;

  let caseVersionIds: string[];
  const notes: string[] = [];
  if (input.mode === "owner_preview") {
    if (!input.previewCaseVersionIds?.length) throw badRequest("preview_cases_required", "choose at least one case version to preview");
    for (const v of input.previewCaseVersionIds) await getCaseVersion(db, v);
    caseVersionIds = input.previewCaseVersionIds;
  } else {
    const candidates = await publishedCandidates(db);
    const seen = await seenFamilies(db, auth.userId);
    const res = assembleForm(candidates, {
      profile,
      mode: input.mode === "exam" ? "exam" : "practice",
      caseCount,
      seed: `${auth.userId}:${Date.now()}`,
      seenFamilyIds: seen,
      allowFixtures: config.ALLOW_FIXTURES,
      includeAdvanced: profile.track === "advanced_practice",
      restrictToCaseIds,
      preferredSkills: input.preferredSkills,
    });
    if (!res.ok) throw new HttpError(409, "no_eligible_cases", "No eligible published cases are available for this profile yet.");
    caseVersionIds = res.caseVersionIds;
    notes.push(...res.notes);
  }

  const cvs = await Promise.all(caseVersionIds.map((v) => getCaseVersion(db, v)));
  const seen = await seenFamilies(db, auth.userId);
  const sessionId = await db.transaction(async (tx) => {
    const [form] = await tx.insert(examForms).values({ profileVersionId: profile.versionId, mode: input.mode, caseVersionIds, seed: `${auth.userId}`, notes }).returning();
    const [s] = await tx
      .insert(stationSessions)
      .values({
        userId: auth.userId,
        profileVersionId: profile.versionId,
        mode: input.mode,
        formId: form!.id,
        status: "preflight",
        clock: newClock(profile.station.durationSeconds * 1000),
        caseCount: cvs.length,
        inputMode: input.inputMode,
        speechConfig: { asr: deps.speech.asr, tts: deps.speech.tts, demo: isDemo } as { asr: string; tts: string },
        containsFixtures: cvs.some((c) => c.isDevelopmentFixture),
      })
      .returning();
    await tx.insert(caseAttempts).values(
      cvs.map((cv, i) => ({ sessionId: s!.id, userId: auth.userId, caseVersionId: cv.versionId, caseFamilyId: cv.caseFamilyId, ordinal: i, firstExposure: !seen.has(cv.caseFamilyId) })),
    );
    return s!.id;
  });
  return { sessionId, notes };
}

/** Load a session the caller may access: its learner, or the owner. */
export async function accessibleSession(db: Db, auth: AuthContext, sessionId: string) {
  const [s] = await db.select().from(stationSessions).where(eq(stationSessions.id, sessionId));
  if (!s || (s.userId !== auth.userId && auth.role !== "owner")) throw new HttpError(404, "not_found", "session not found");
  return s;
}

export async function caseAttemptsFor(db: Db, sessionId: string) {
  return db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, sessionId)).orderBy(caseAttempts.ordinal);
}

export { inArray };
