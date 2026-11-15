import type { CaseVersion, DomainRating, ElementStatus, RatingLevel, UnsafeFlag } from "@sim/contracts";
import { RATING_ORDER } from "@sim/contracts";
import type { ValidatedJudgment } from "./postprocess";

/**
 * Rating rules (spec §10). Domain and global ratings are holistic judgments against
 * owner-approved anchors; the deterministic estimate here is (a) the rating for the
 * development baseline and (b) a tie-breaker between adjacent assessor ratings. Owner-
 * approved caps are applied afterwards, and the overall rating is withheld when
 * uncertainty or unresolved disagreement undermines it.
 */

const WEIGHT = { critical: 3, important: 2, minor: 1 } as const;

function scoreOf(j: ValidatedJudgment): number | null {
  if (j.status === "not_assessable" || j.status === "uncertain") return null;
  if (j.status === "demonstrated") return j.credit === "full" ? 1 : j.credit === "partial" ? 0.5 : 0;
  if (j.status === "partially_demonstrated") return j.credit === "none" ? 0 : 0.5;
  return 0;
}

export function deterministicLevel(js: ValidatedJudgment[], flags: UnsafeFlag[]): RatingLevel | null {
  if (flags.some((f) => f.committed && !f.correctedLater)) return "unsafe";
  let num = 0;
  let den = 0;
  for (const j of js) {
    const s = scoreOf(j);
    if (s === null) continue;
    num += s * WEIGHT[j.severity];
    den += WEIGHT[j.severity];
  }
  if (den === 0) return null;
  const r = num / den;
  if (r >= 0.98 && js.every((j) => j.status === "not_assessable" || j.promptingLevel === "spontaneous" || j.promptingLevel === null)) return "exceptional";
  if (r >= 0.85) return "strong";
  if (r >= 0.65) return "meets_expected";
  return "below_expected";
}

export function deterministicDomainRatings(cv: CaseVersion, judgments: Map<string, ValidatedJudgment>, flags: UnsafeFlag[]): DomainRating[] {
  return cv.rubric.domains.map((d) => {
    const els = cv.rubric.elements.filter((e) => e.domain === d.id);
    const js = els.map((e) => judgments.get(e.id)!).filter(Boolean);
    const domainFlags = flags.filter((f) => f.elementId && els.some((e) => e.id === f.elementId));
    const level = deterministicLevel(js, domainFlags);
    return {
      domain: d.id,
      level,
      rationale: level === null ? "No assessable evidence in this domain." : "Derived from element results and severities.",
      supportingElementIds: js.filter((j) => j.status !== "not_assessable").map((j) => j.elementId),
    };
  });
}

export function minLevel(a: RatingLevel, b: RatingLevel): RatingLevel {
  return RATING_ORDER.indexOf(a) <= RATING_ORDER.indexOf(b) ? a : b;
}

/** Reconcile two ordinal ratings: equal → keep; adjacent → nearest to the evidence estimate; far apart → withhold. */
export function reconcileLevels(a: RatingLevel | null, b: RatingLevel | null, estimate: RatingLevel | null): { level: RatingLevel | null; disputed: boolean } {
  if (a === null && b === null) return { level: null, disputed: false };
  if (a === null || b === null) return { level: a ?? b, disputed: false };
  const ia = RATING_ORDER.indexOf(a);
  const ib = RATING_ORDER.indexOf(b);
  if (ia === ib) return { level: a, disputed: false };
  if (Math.abs(ia - ib) === 1) {
    if (estimate) {
      const ie = RATING_ORDER.indexOf(estimate);
      return { level: Math.abs(ia - ie) <= Math.abs(ib - ie) ? a : b, disputed: false };
    }
    return { level: minLevel(a, b), disputed: false };
  }
  return { level: null, disputed: true };
}

export type CapResult = { level: RatingLevel | null; capsApplied: string[]; criticalConcerns: string[] };

export function applyCaps(cv: CaseVersion, level: RatingLevel | null, judgments: Map<string, ValidatedJudgment>, flags: UnsafeFlag[]): CapResult {
  const rules = cv.rubric.globalRules;
  const capsApplied: string[] = [];
  const criticalConcerns: string[] = [];
  let out = level;
  const critical = cv.rubric.elements.filter((e) => e.severity === "critical");
  const unsafeCritical = flags.filter((f) => f.committed && !f.correctedLater && (f.elementId === null || critical.some((c) => c.id === f.elementId)));
  for (const f of unsafeCritical) criticalConcerns.push(`Committed unsafe statement: ${f.criterion}`);
  const missedCritical = critical.filter((e) => {
    const s: ElementStatus | undefined = judgments.get(e.id)?.status;
    return s === "not_demonstrated" || s === "incorrect";
  });
  for (const e of missedCritical) criticalConcerns.push(`Critical element not demonstrated: ${e.construct}`);
  if (out !== null && unsafeCritical.length > 0) {
    const capped = minLevel(out, rules.criticalUnsafeCap);
    if (capped !== out) capsApplied.push(`critical unsafe statement caps the rating at "${rules.criticalUnsafeCap}"`);
    out = capped;
  }
  if (out !== null && missedCritical.length > 0) {
    const capped = minLevel(out, rules.criticalOmissionCap);
    if (capped !== out) capsApplied.push(`missed critical element caps the rating at "${rules.criticalOmissionCap}"`);
    out = capped;
  }
  return { level: out, capsApplied, criticalConcerns };
}

export function withholdReason(cv: CaseVersion, judgments: Map<string, ValidatedJudgment>, disputed: string[]): string | null {
  const weighty = cv.rubric.elements.filter((e) => e.severity !== "minor");
  const uncertain = weighty.filter((e) => judgments.get(e.id)?.status === "uncertain");
  const disputedWeighty = weighty.filter((e) => disputed.includes(e.id));
  if (disputedWeighty.some((e) => e.severity === "critical")) return "An unresolved disagreement on a critical element affects the overall rating; it is awaiting owner review.";
  if (uncertain.length + disputedWeighty.length >= cv.rubric.globalRules.withholdIfUncertainCriticalOrImportant) {
    return "Too many important elements could not be judged confidently to give a defensible overall rating.";
  }
  const assessable = cv.rubric.elements.filter((e) => {
    const s = judgments.get(e.id)?.status;
    return s !== "not_assessable" && s !== "uncertain";
  });
  if (assessable.length === 0) return "No element was assessable (for example because images did not display or the case ended early).";
  return null;
}
