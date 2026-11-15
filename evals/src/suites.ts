import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseVersion } from "@sim/contracts";
import { canonicalJson, sha256Hex } from "@sim/clinical-content";
import { loadFixtureCases } from "@sim/fixtures";
import { RING_PATTERNS } from "./patterns/ring";
import { SPINE_PATTERNS } from "./patterns/spine";
import { STROKE_PATTERNS } from "./patterns/stroke";
import type { ApprovalRecord, ResponsePattern, Split } from "./types";

export const EVALS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_FILE = path.join(EVALS_DIR, "locked", "manifest.json");
export const RUN_LOG = path.join(EVALS_DIR, "locked", "run-log.jsonl");
export const APPROVALS_FILE = path.join(EVALS_DIR, "owner-ratings", "approvals.json");
export const REPORTS_DIR = path.join(EVALS_DIR, "reports");

export const ALL_PATTERNS: readonly ResponsePattern[] = [...STROKE_PATTERNS, ...SPINE_PATTERNS, ...RING_PATTERNS];

/**
 * Tuning and final-evaluation inputs are separated by CASE FAMILY (spec §18), never by
 * individual response. Explicit assignments win; new families are assigned by a stable hash
 * (~30% final) so the split cannot be chosen after seeing results.
 */
const SPLIT_OVERRIDES: Record<string, Split> = {
  "fx-family-stroke": "final",
  "fx-family-spine": "tuning",
  "fx-family-ring": "tuning",
};

export function splitForFamily(familyId: string): Split {
  const o = SPLIT_OVERRIDES[familyId];
  if (o) return o;
  return parseInt(sha256Hex(`split:${familyId}`).slice(0, 8), 16) % 10 < 3 ? "final" : "tuning";
}

export function evalCases(): Map<string, CaseVersion> {
  return new Map(loadFixtureCases().map((c) => [c.caseId, c]));
}

export function patternHash(p: ResponsePattern): string {
  return sha256Hex(canonicalJson({ turns: p.turns, expected: p.expected, renderFailures: p.renderFailures ?? [], supplied: p.supplied ?? [], endedByTechnicalFailure: !!p.endedByTechnicalFailure }));
}

export function loadApprovals(): Map<string, ApprovalRecord> {
  if (!existsSync(APPROVALS_FILE)) return new Map();
  const rows = JSON.parse(readFileSync(APPROVALS_FILE, "utf8")) as ApprovalRecord[];
  return new Map(rows.map((r) => [r.patternId, r]));
}

/** Approval is valid only while the pattern content still matches the approved hash. */
export function approvalStatus(p: ResponsePattern, approvals: Map<string, ApprovalRecord>): "owner_approved" | "owner_rejected" | "pending_owner_approval" | "approval_stale" {
  const a = approvals.get(p.id);
  if (!a || a.status === "pending_owner_approval") return "pending_owner_approval";
  if (a.contentHash !== patternHash(p)) return "approval_stale";
  return a.status;
}
