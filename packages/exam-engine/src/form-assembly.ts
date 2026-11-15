import type { CaseVersion, ExamProfileVersion } from "@sim/contracts";

/**
 * Exam-form assembly (spec §7): exam-mode forms are preassembled from eligible published
 * cases before the station starts, so the scored examination is never made easier while
 * it runs. Practice selection may target weaknesses.
 */

export type CaseCandidate = Pick<
  CaseVersion,
  "caseId" | "versionId" | "caseFamilyId" | "tags" | "difficulty" | "track" | "isDevelopmentFixture" | "eligibleProfileVersions"
>;

export function isEligibleForProfile(c: Pick<CaseVersion, "eligibleProfileVersions">, profile: ExamProfileVersion): boolean {
  return c.eligibleProfileVersions.some((p) => p === profile.versionId || p === `${profile.profileId}@*`);
}

/** Small deterministic PRNG so form assembly is reproducible from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type AssembleOptions = {
  profile: ExamProfileVersion;
  mode: "exam" | "practice";
  caseCount: number;
  seed: string;
  /** Case families the learner has already seen (excluded when alternatives exist). */
  seenFamilyIds: ReadonlySet<string>;
  /** Fixtures are only allowed outside production clinical use. */
  allowFixtures: boolean;
  includeAdvanced: boolean;
  /** Practice targeting: preferred skills (cases tagged with them rank first). */
  preferredSkills?: readonly string[];
  /** Restrict to specific case ids (owner preview / demo). */
  restrictToCaseIds?: readonly string[];
};

export type AssembleResult =
  | { ok: true; caseVersionIds: string[]; usedSeenFamilies: boolean; notes: string[] }
  | { ok: false; reason: string };

export function assembleForm(candidates: readonly CaseCandidate[], opts: AssembleOptions): AssembleResult {
  const notes: string[] = [];
  let pool = candidates.filter((c) => isEligibleForProfile(c, opts.profile));
  if (opts.restrictToCaseIds) pool = pool.filter((c) => opts.restrictToCaseIds!.includes(c.caseId));
  if (!opts.allowFixtures) pool = pool.filter((c) => !c.isDevelopmentFixture);
  if (!opts.includeAdvanced) pool = pool.filter((c) => c.track !== "advanced");
  if (pool.length === 0) return { ok: false, reason: "no_eligible_cases" };

  // One version per family, never two cases from the same patient/case family in a form.
  const byFamily = new Map<string, CaseCandidate>();
  for (const c of pool) if (!byFamily.has(c.caseFamilyId)) byFamily.set(c.caseFamilyId, c);
  const unseen = [...byFamily.values()].filter((c) => !opts.seenFamilyIds.has(c.caseFamilyId));
  const seen = [...byFamily.values()].filter((c) => opts.seenFamilyIds.has(c.caseFamilyId));

  const rand = mulberry32(seedFromString(opts.seed));
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const score = (c: CaseCandidate) =>
    opts.preferredSkills && opts.preferredSkills.length > 0
      ? c.tags.skills.filter((s) => opts.preferredSkills!.includes(s)).length
      : 0;

  const ordered = [...shuffle(unseen).sort((a, b) => score(b) - score(a)), ...shuffle(seen)];
  const picked: CaseCandidate[] = [];
  // Exam mode: try to cover distinct anatomy first (brain / spine / head and neck mix).
  if (opts.mode === "exam") {
    const anatomies = new Set<string>();
    for (const c of ordered) {
      if (picked.length >= opts.caseCount) break;
      const a = c.tags.anatomy[0] ?? "brain";
      if (!anatomies.has(a)) {
        anatomies.add(a);
        picked.push(c);
      }
    }
  }
  for (const c of ordered) {
    if (picked.length >= opts.caseCount) break;
    if (!picked.includes(c)) picked.push(c);
  }
  if (picked.length === 0) return { ok: false, reason: "no_eligible_cases" };
  if (picked.length < opts.caseCount) notes.push(`only ${picked.length} eligible case families available`);
  const usedSeenFamilies = picked.some((c) => opts.seenFamilyIds.has(c.caseFamilyId));
  if (usedSeenFamilies) notes.push("includes previously seen case families (labelled as repeat exposure)");
  return { ok: true, caseVersionIds: picked.map((c) => c.versionId), usedSeenFamilies, notes };
}
