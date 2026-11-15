import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CaseVersion } from "@sim/contracts";
import { computeContentHashes } from "@sim/clinical-content";
import { promptVersions } from "@sim/ai";
import { ALL_PATTERNS, LOCK_FILE, RUN_LOG, patternHash, splitForFamily } from "./suites";

/**
 * Locked final-evaluation inputs (spec §18): the final split's patterns and case content are
 * hashed BEFORE changes are judged. Every later run verifies the lock and appends to a run
 * log, so repeated evaluation against the final split is visible in the report.
 */
export type LockManifest = {
  lockedAt: string;
  gitCommit: string | null;
  promptVersions: Record<string, string>;
  finalFamilies: string[];
  patterns: Record<string, string>;
  cases: Record<string, string>;
};

export function gitCommit(): string | null {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
    return `${sha}${dirty ? "+uncommitted" : ""}`;
  } catch {
    return null;
  }
}

function finalInputs(cases: Map<string, CaseVersion>) {
  const finalPatterns = ALL_PATTERNS.filter((p) => splitForFamily(cases.get(p.caseId)!.caseFamilyId) === "final");
  const finalCases = [...new Set(finalPatterns.map((p) => p.caseId))].map((id) => cases.get(id)!);
  return {
    finalFamilies: [...new Set(finalCases.map((c) => c.caseFamilyId))].sort(),
    patterns: Object.fromEntries(finalPatterns.map((p) => [p.id, patternHash(p)])),
    cases: Object.fromEntries(finalCases.map((c) => [c.versionId, computeContentHashes(c).clinicalContentHash])),
  };
}

export function writeLock(cases: Map<string, CaseVersion>): LockManifest {
  const m: LockManifest = { lockedAt: new Date().toISOString(), gitCommit: gitCommit(), promptVersions: promptVersions(), ...finalInputs(cases) };
  mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  writeFileSync(LOCK_FILE, `${JSON.stringify(m, null, 2)}\n`);
  return m;
}

export type LockStatus =
  | { state: "not_locked" }
  | { state: "intact"; lockedAt: string; priorFinalRuns: number }
  | { state: "violated"; lockedAt: string; changed: string[]; added: string[]; removed: string[]; priorFinalRuns: number };

export function verifyLock(cases: Map<string, CaseVersion>): LockStatus {
  if (!existsSync(LOCK_FILE)) return { state: "not_locked" };
  const m = JSON.parse(readFileSync(LOCK_FILE, "utf8")) as LockManifest;
  const now = finalInputs(cases);
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [k, h] of Object.entries(now.patterns)) {
    if (!(k in m.patterns)) added.push(`pattern ${k}`);
    else if (m.patterns[k] !== h) changed.push(`pattern ${k}`);
  }
  for (const k of Object.keys(m.patterns)) if (!(k in now.patterns)) removed.push(`pattern ${k}`);
  for (const [k, h] of Object.entries(now.cases)) {
    if (!(k in m.cases)) added.push(`case ${k}`);
    else if (m.cases[k] !== h) changed.push(`case ${k}`);
  }
  for (const k of Object.keys(m.cases)) if (!(k in now.cases)) removed.push(`case ${k}`);
  const priorFinalRuns = existsSync(RUN_LOG)
    ? readFileSync(RUN_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { lockedAt: string | null; finalEvaluated: boolean }).filter((r) => r.lockedAt === m.lockedAt && r.finalEvaluated).length
    : 0;
  if (changed.length || added.length || removed.length) return { state: "violated", lockedAt: m.lockedAt, changed, added, removed, priorFinalRuns };
  return { state: "intact", lockedAt: m.lockedAt, priorFinalRuns };
}

export function logRun(entry: { at: string; lockedAt: string | null; finalEvaluated: boolean; assessor: string; examiner: string; gitCommit: string | null; reportId: string }): void {
  mkdirSync(path.dirname(RUN_LOG), { recursive: true });
  appendFileSync(RUN_LOG, `${JSON.stringify(entry)}\n`);
}
