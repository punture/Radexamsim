import type { CaseVersion, ElementStatus, UnsafeFlag } from "@sim/contracts";
import { morePrompted } from "@sim/exam-engine";
import type { ValidatedJudgment, ValidatedPass } from "./postprocess";

/**
 * Compare two independent validated passes (spec §10 step 7). Agreement is NOT treated as
 * proof of correctness; it only decides whether adjudication is needed.
 */

const POS: ElementStatus[] = ["demonstrated", "partially_demonstrated"];
const NEG: ElementStatus[] = ["not_demonstrated", "incorrect"];

export type ElementComparison =
  | { kind: "agreed"; merged: ValidatedJudgment }
  | { kind: "minor_resolved"; merged: ValidatedJudgment; note: string }
  | { kind: "material"; a: ValidatedJudgment; b: ValidatedJudgment; reason: string };

function mergeEvidence(a: ValidatedJudgment, b: ValidatedJudgment) {
  const key = (e: { segmentId: string; charStart: number; charEnd: number }) => `${e.segmentId}:${e.charStart}:${e.charEnd}`;
  const seen = new Set<string>();
  return [...a.evidence, ...b.evidence].filter((e) => (seen.has(key(e)) ? false : (seen.add(key(e)), true)));
}

export function compareElement(a: ValidatedJudgment, b: ValidatedJudgment): ElementComparison {
  if (a.status === b.status) {
    const promptingLevel = a.promptingLevel && b.promptingLevel ? morePrompted(a.promptingLevel, b.promptingLevel) : a.promptingLevel ?? b.promptingLevel;
    const credit = a.credit === b.credit ? a.credit : a.credit === "none" || b.credit === "none" ? "none" : "partial";
    return { kind: "agreed", merged: { ...a, promptingLevel, credit, evidence: mergeEvidence(a, b), rationale: a.rationale } };
  }
  const pair = new Set([a.status, b.status]);
  // Demonstrated vs partially demonstrated on a non-critical element: settle at partial.
  if (pair.has("demonstrated") && pair.has("partially_demonstrated") && a.severity !== "critical") {
    const partial = a.status === "partially_demonstrated" ? a : b;
    return { kind: "minor_resolved", merged: { ...partial, evidence: mergeEvidence(a, b) }, note: "assessors split between demonstrated and partially demonstrated; recorded as partially demonstrated" };
  }
  if (pair.has("not_assessable") && (pair.has("uncertain") || a.severity === "minor")) {
    const na = a.status === "not_assessable" ? a : b;
    return { kind: "minor_resolved", merged: na, note: "one assessor found the element not assessable" };
  }
  const crossesPolarity = (POS.includes(a.status) && NEG.includes(b.status)) || (POS.includes(b.status) && NEG.includes(a.status));
  const reason = crossesPolarity
    ? "assessors disagree on whether the element was demonstrated"
    : pair.has("incorrect")
      ? "only one assessor judged the response incorrect"
      : pair.has("uncertain")
        ? "one assessor could not judge the element"
        : "assessors assigned different statuses";
  return { kind: "material", a, b, reason };
}

export function compareUnsafeFlags(a: UnsafeFlag[], b: UnsafeFlag[]): { shared: UnsafeFlag[]; disputed: UnsafeFlag[] } {
  const k = (f: UnsafeFlag) => `${f.elementId ?? "-"}|${f.criterion}`;
  const bk = new Set(b.map(k));
  const ak = new Set(a.map(k));
  return { shared: a.filter((f) => bk.has(k(f))), disputed: [...a.filter((f) => !bk.has(k(f))), ...b.filter((f) => !ak.has(k(f)))] };
}

export function comparePasses(cv: CaseVersion, A: ValidatedPass, B: ValidatedPass) {
  const comparisons = new Map<string, ElementComparison>();
  for (const el of cv.rubric.elements) comparisons.set(el.id, compareElement(A.judgments.get(el.id)!, B.judgments.get(el.id)!));
  return { comparisons, flags: compareUnsafeFlags(A.unsafeFlags, B.unsafeFlags) };
}
