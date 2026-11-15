import { describe, expect, it } from "vitest";
import { ABR_NEURO_PROFILE } from "@sim/clinical-content";
import { ALL_PATTERNS, evalCases, kappa, wilson, runAssessmentSuite, simulateExaminer, computeMetrics, applyVariant, splitForFamily, patternHash } from "../src";

describe("agreement statistics", () => {
  it("computes Cohen's kappa, and weighted kappa equals unweighted kappa for two categories", () => {
    const pairs = [...Array(20).fill([0, 0]), ...Array(5).fill([0, 1]), ...Array(10).fill([1, 0]), ...Array(15).fill([1, 1])] as [number, number][];
    expect(kappa(pairs, 2)).toBeCloseTo(0.4, 10);
    expect(kappa(pairs, 2, "linear")).toBeCloseTo(0.4, 10);
    expect(kappa(pairs, 2, "quadratic")).toBeCloseTo(0.4, 10);
    expect(kappa([[2, 2], [0, 0], [4, 4]], 5, "quadratic")).toBe(1);
    expect(kappa([[1, 1], [1, 1]], 5)).toBeNull(); // no variation: undefined, not "perfect"
  });
  it("penalizes distant ordinal disagreements more under quadratic weights", () => {
    const near = [[0, 0], [1, 1], [2, 3], [3, 3], [4, 4], [2, 2]] as [number, number][];
    const far = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 0], [2, 2]] as [number, number][];
    expect(kappa(near, 5, "quadratic")!).toBeGreaterThan(kappa(far, 5, "quadratic")!);
  });
  it("gives Wilson intervals that stay inside [0, 1]", () => {
    const [lo, hi] = wilson(0, 10)!;
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(0.2775, 3);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe("evaluation harness", () => {
  const cases = evalCases();
  it("separates tuning and final inputs by case family, never by response", () => {
    const byFamily = new Map<string, Set<string>>();
    for (const p of ALL_PATTERNS) {
      const fam = cases.get(p.caseId)!.caseFamilyId;
      byFamily.set(fam, (byFamily.get(fam) ?? new Set()).add(splitForFamily(fam)));
    }
    for (const splits of byFamily.values()) expect(splits.size).toBe(1);
    expect(new Set([...byFamily.keys()].map(splitForFamily))).toEqual(new Set(["tuning", "final"]));
  });
  it("has unique pattern ids, references only approved question/reply ids, and hashes content", () => {
    expect(new Set(ALL_PATTERNS.map((p) => p.id)).size).toBe(ALL_PATTERNS.length);
    expect(ALL_PATTERNS.length).toBeGreaterThanOrEqual(15);
    const p = ALL_PATTERNS[0]!;
    expect(patternHash(p)).toBe(patternHash({ ...p }));
    expect(patternHash({ ...p, expected: { ...p.expected, mustNotPass: !p.expected.mustNotPass } })).not.toBe(patternHash(p));
  });
  it("variants preserve polarity, laterality and examiner turns", () => {
    const p = ALL_PATTERNS.find((x) => x.id === "stroke.edge.negation")!;
    for (const v of ["rephrased", "verbose", "asr_noisy"] as const) {
      const turns = applyVariant(p.turns, v);
      expect(turns.filter((t) => t.kind !== "candidate")).toEqual(p.turns.filter((t) => t.kind !== "candidate"));
      const text = turns.flatMap((t) => (t.kind === "candidate" ? [t.text.toLowerCase()] : [])).join(" ");
      expect(text).toMatch(/don't|not|no /);
    }
  });
  it("runs every pattern end to end: verifiable evidence only, no omission without opportunity", async () => {
    const recs = await runAssessmentSuite(ALL_PATTERNS, cases, ABR_NEURO_PROFILE, { kind: "baseline" }, ["base"]);
    const m = computeMetrics(recs);
    expect(m.available).toBe(ALL_PATTERNS.length);
    expect(m.evidence.valid).toBe(m.evidence.spans);
    expect(m.evidence.omissionsWithoutOpportunity).toBe(0);
    // Structural safety guarantees that hold for any assessor:
    const supplied = recs.find((r) => r.patternId === "stroke.edge.examiner_supplied")!.elements.find((e) => e.elementId === "e-dense-mca")!;
    expect(supplied.actual?.credit === "none" || supplied.actual?.status === "not_demonstrated").toBe(true);
    const failed = recs.find((r) => r.patternId === "stroke.edge.render_failure")!.elements.find((e) => e.elementId === "e-m1-occlusion")!;
    expect(failed.actual?.status).toBe("not_assessable");
    const interrupted = recs.find((r) => r.patternId === "ring.edge.interrupted")!.elements.find((e) => e.elementId === "r-next")!;
    expect(interrupted.actual?.promptingLevel).toBe("spontaneous");
  });
  it("the examiner speaks only approved, neutral text, leaks nothing and rejects every forged action", async () => {
    for (const p of ALL_PATTERNS) {
      const r = await simulateExaminer(p, cases.get(p.caseId)!, ABR_NEURO_PROFILE, { kind: "deterministic" });
      expect(r.neutralityViolations, p.id).toEqual([]);
      expect(r.unapprovedOutputs, p.id).toEqual([]);
      expect(r.leaks, p.id).toEqual([]);
      expect(r.forgedRejected, p.id).toBe(r.forgedTotal);
      for (const id of r.unavailable.requested) expect(r.unavailable.delivered, p.id).toContain(id);
    }
  });
});
