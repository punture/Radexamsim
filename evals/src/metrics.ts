import type { RatingLevel } from "@sim/contracts";
import type { RunRecord } from "./runner";
import { bootstrap, confusion, kappa, wilson, type Pair } from "./stats";

export const LEVELS: RatingLevel[] = ["unsafe", "below_expected", "meets_expected", "strong", "exceptional"];
const ELEMENT_ORDINAL = ["incorrect", "not_demonstrated", "partially_demonstrated", "demonstrated"] as const;
const PASSING = new Set<RatingLevel | null>(["meets_expected", "strong", "exceptional"]);

export type OwnerReference = Map<string, { global: RatingLevel | null; elements: Record<string, string> }>;

export type Metrics = {
  n: number;
  patterns: number;
  cases: number;
  families: number;
  levelMix: Record<string, number>;
  available: number;
  global: {
    withinRange: number;
    withinRangeCi: [number, number] | null;
    kappaLinear: number | null;
    kappaQuadratic: number | null;
    kappaQuadraticCi: [number, number] | null;
    pairs: number;
    withheld: number;
    confusion: number[][];
  };
  elements: { total: number; ok: number; kappaLinear: number | null; pairs: number; bySeverity: Record<string, { total: number; ok: number }> };
  safety: {
    mustNotPass: number;
    falseReassurance: string[];
    referencePassing: number;
    unfairFailure: string[];
    criticalFalseCredit: { patternId: string; elementId: string; actual: string }[];
    unfairElementFailure: { patternId: string; elementId: string; actual: string }[];
    unsafeRecall: { expected: number; flagged: number };
    unsafeFalseAlarms: { patternId: string; criterion: string }[];
  };
  evidence: { spans: number; valid: number; omissionsWithoutOpportunity: number; prompting: { checked: number; ok: number }; credit: { checked: number; ok: number } };
  abstention: { elementAbstentions: number; elementUnexpectedAbstentions: number; elementsAssessed: number };
  byTag: Record<string, { patterns: number; fullyCorrect: number }>;
  latency: { p50: number | null; p95: number | null };
  modelToModel: { compared: number; agreed: number } | null;
};

const pctile = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : null);

export function referenceGlobal(r: RunRecord, owner: OwnerReference): RatingLevel | null {
  const o = owner.get(r.patternId);
  return o ? o.global : (r.globalExpected[0] ?? null);
}

export function computeMetrics(records: RunRecord[], owner: OwnerReference = new Map()): Metrics {
  const base = records.filter((r) => r.variant === "base");
  const globalObs: { pair: Pair; cluster: string }[] = [];
  let withheld = 0;
  for (const r of base) {
    const ref = referenceGlobal(r, owner);
    if (!r.available || r.global === null) {
      withheld++;
      continue;
    }
    if (ref === null) continue;
    globalObs.push({ pair: [LEVELS.indexOf(ref), LEVELS.indexOf(r.global)], cluster: r.caseId });
  }
  const globalPairs = globalObs.map((o) => o.pair);
  const withinRange = base.filter((r) => {
    const o = owner.get(r.patternId);
    return o ? o.global === r.global : r.globalOk;
  }).length;
  // Bootstrap over cases (responses within one case are not independent).
  const clusters = [...new Set(globalObs.map((o) => o.cluster))].map((c) => globalObs.filter((o) => o.cluster === c).map((o) => o.pair));

  const elementPairs: Pair[] = [];
  const bySeverity: Record<string, { total: number; ok: number }> = {};
  let elTotal = 0;
  let elOk = 0;
  let abst = 0;
  let unexpectedAbst = 0;
  let assessed = 0;
  const criticalFalseCredit: Metrics["safety"]["criticalFalseCredit"] = [];
  const unfairElementFailure: Metrics["safety"]["unfairElementFailure"] = [];
  let promptingChecked = 0;
  let promptingOk = 0;
  let creditChecked = 0;
  let creditOk = 0;
  for (const r of base) {
    for (const e of r.elements) {
      if (!e.expected.status.length) continue;
      const ownerStatus = owner.get(r.patternId)?.elements[e.elementId];
      const refStatus = ownerStatus ?? e.expected.status[0]!;
      const ok = ownerStatus ? e.actual?.status === ownerStatus : e.statusOk;
      elTotal++;
      if (ok) elOk++;
      bySeverity[e.severity] ??= { total: 0, ok: 0 };
      bySeverity[e.severity]!.total++;
      if (ok) bySeverity[e.severity]!.ok++;
      const a = e.actual?.status;
      if (a === "uncertain" || a === "not_assessable") {
        abst++;
        if (refStatus !== "uncertain" && refStatus !== "not_assessable") unexpectedAbst++;
      } else if (a) assessed++;
      const ri = ELEMENT_ORDINAL.indexOf(refStatus as (typeof ELEMENT_ORDINAL)[number]);
      const ai = a ? ELEMENT_ORDINAL.indexOf(a as (typeof ELEMENT_ORDINAL)[number]) : -1;
      if (ri >= 0 && ai >= 0) elementPairs.push([ri, ai]);
      if (e.severity === "critical" && (refStatus === "incorrect" || refStatus === "not_demonstrated") && (a === "demonstrated" || a === "partially_demonstrated") && !ok) {
        criticalFalseCredit.push({ patternId: r.patternId, elementId: e.elementId, actual: a });
      }
      if (refStatus === "demonstrated" && (a === "incorrect" || a === "not_demonstrated") && !ok) unfairElementFailure.push({ patternId: r.patternId, elementId: e.elementId, actual: a });
      if (e.promptingOk !== null) {
        promptingChecked++;
        if (e.promptingOk) promptingOk++;
      }
      if (e.creditOk !== null) {
        creditChecked++;
        if (e.creditOk) creditOk++;
      }
    }
  }

  const byTag: Metrics["byTag"] = {};
  for (const r of base) {
    const fully = r.available && r.globalOk && r.elements.every((e) => !e.expected.status.length || e.statusOk);
    for (const t of r.tags) {
      byTag[t] ??= { patterns: 0, fullyCorrect: 0 };
      byTag[t]!.patterns++;
      if (fully) byTag[t]!.fullyCorrect++;
    }
  }

  const levelMix: Record<string, number> = {};
  for (const r of base) levelMix[r.level] = (levelMix[r.level] ?? 0) + 1;
  const m2m = base.filter((r) => r.modelToModel).reduce((acc, r) => ({ compared: acc.compared + r.modelToModel!.compared, agreed: acc.agreed + r.modelToModel!.agreed }), { compared: 0, agreed: 0 });

  return {
    n: records.length,
    patterns: base.length,
    cases: new Set(base.map((r) => r.caseId)).size,
    families: new Set(base.map((r) => r.familyId)).size,
    levelMix,
    available: base.filter((r) => r.available).length,
    global: {
      withinRange,
      withinRangeCi: wilson(withinRange, base.length),
      kappaLinear: kappa(globalPairs, LEVELS.length, "linear"),
      kappaQuadratic: kappa(globalPairs, LEVELS.length, "quadratic"),
      kappaQuadraticCi: bootstrap(clusters, (items) => kappa(items, LEVELS.length, "quadratic")),
      pairs: globalPairs.length,
      withheld,
      confusion: confusion(globalPairs, LEVELS.length),
    },
    elements: { total: elTotal, ok: elOk, kappaLinear: kappa(elementPairs, ELEMENT_ORDINAL.length, "linear"), pairs: elementPairs.length, bySeverity },
    safety: {
      mustNotPass: base.filter((r) => r.mustNotPass).length,
      falseReassurance: base.filter((r) => r.falseReassurance || (owner.get(r.patternId) && !PASSING.has(owner.get(r.patternId)!.global) && PASSING.has(r.global))).map((r) => r.patternId),
      referencePassing: base.filter((r) => PASSING.has(referenceGlobal(r, owner))).length,
      unfairFailure: base.filter((r) => PASSING.has(referenceGlobal(r, owner)) && (r.global === "below_expected" || r.global === "unsafe")).map((r) => r.patternId),
      criticalFalseCredit,
      unfairElementFailure,
      unsafeRecall: { expected: base.reduce((a, r) => a + r.unsafeExpected.length, 0), flagged: base.reduce((a, r) => a + r.unsafeExpected.filter((c) => r.unsafeFlagged.includes(c)).length, 0) },
      unsafeFalseAlarms: base.flatMap((r) => (r.unsafeExpected.length === 0 ? r.unsafeFlagged.map((criterion) => ({ patternId: r.patternId, criterion })) : [])),
    },
    evidence: {
      spans: base.reduce((a, r) => a + r.evidence.total, 0),
      valid: base.reduce((a, r) => a + r.evidence.valid, 0),
      omissionsWithoutOpportunity: base.reduce((a, r) => a + r.omissionsWithoutOpportunity, 0),
      prompting: { checked: promptingChecked, ok: promptingOk },
      credit: { checked: creditChecked, ok: creditOk },
    },
    abstention: { elementAbstentions: abst, elementUnexpectedAbstentions: unexpectedAbst, elementsAssessed: assessed },
    byTag,
    latency: { p50: pctile(base.map((r) => r.latencyMs), 0.5), p95: pctile(base.map((r) => r.latencyMs), 0.95) },
    modelToModel: m2m.compared ? m2m : null,
  };
}

/** Stability: share of variant runs whose global rating and element statuses equal the base run. */
export function stability(records: RunRecord[]): Record<string, { runs: number; sameGlobal: number; sameElements: number; changed: string[] }> {
  const base = new Map(records.filter((r) => r.variant === "base").map((r) => [r.patternId, r]));
  const out: Record<string, { runs: number; sameGlobal: number; sameElements: number; changed: string[] }> = {};
  for (const r of records) {
    if (r.variant === "base") continue;
    const b = base.get(r.patternId);
    if (!b) continue;
    out[r.variant] ??= { runs: 0, sameGlobal: 0, sameElements: 0, changed: [] };
    const o = out[r.variant]!;
    o.runs++;
    const sameG = b.global === r.global;
    const sameE = b.elements.every((e) => r.elements.find((x) => x.elementId === e.elementId)?.actual?.status === e.actual?.status);
    if (sameG) o.sameGlobal++;
    if (sameE) o.sameElements++;
    if (!sameG || !sameE) o.changed.push(`${r.patternId}${sameG ? "" : ` (global ${b.global} → ${r.global})`}`);
  }
  return out;
}
