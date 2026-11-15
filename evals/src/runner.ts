import { performance } from "node:perf_hooks";
import type { CaseVersion, ElementResult, ExamProfileVersion, RatingLevel } from "@sim/contracts";
import {
  DEFAULT_ASSESSMENT_POLICY,
  DEFAULT_PRICES,
  assessorInput,
  assessorPrompt,
  extractorInput,
  extractorPrompt,
  opportunitiesFor,
  runCaseAssessment,
  validateSpan,
  type CallTelemetry,
  type LlmProvider,
  type PipelineDeps,
  type RunContext,
} from "@sim/ai";
import { buildAttempt } from "./attempt";
import { splitForFamily } from "./suites";
import type { ElementExpectation, ResponsePattern, Split, Variant } from "./types";
import { applyVariant } from "./variants";

export type AssessorConfig =
  | { kind: "baseline" }
  | { kind: "llm"; provider: LlmProvider; models: { extractor: string; assessorA: string; assessorB: string; adjudicator: string } };

export type ElementRecord = {
  elementId: string;
  severity: "critical" | "important" | "minor";
  expected: ElementExpectation;
  actual: { status: ElementResult["status"]; promptingLevel: ElementResult["promptingLevel"]; credit: ElementResult["credit"]; evidence: number; selfCorrection: boolean; agreement: ElementResult["agreement"]; opportunityAssessable: boolean } | null;
  statusOk: boolean;
  promptingOk: boolean | null;
  creditOk: boolean | null;
};

export type RunRecord = {
  patternId: string;
  caseId: string;
  familyId: string;
  split: Split;
  level: ResponsePattern["level"];
  tags: string[];
  variant: Variant;
  available: boolean;
  unavailableReason: string | null;
  global: RatingLevel | null;
  globalExpected: (RatingLevel | null)[];
  globalOk: boolean;
  mustNotPass: boolean;
  falseReassurance: boolean;
  unfairFailure: boolean;
  elements: ElementRecord[];
  unsafeExpected: string[];
  unsafeFlagged: string[];
  evidence: { total: number; valid: number };
  omissionsWithoutOpportunity: number;
  disputed: string[];
  passes: { stage: string; kind: string; status: string; latencyMs: number | null }[];
  modelToModel: { compared: number; agreed: number } | null;
  latencyMs: number;
  telemetry: CallTelemetry[];
  projection: { inputTokens: Record<string, number> };
};

const PASSING: (RatingLevel | null)[] = ["meets_expected", "strong", "exceptional"];
const FAILING: (RatingLevel | null)[] = ["below_expected", "unsafe"];

function depsFor(cfg: AssessorConfig, telemetry: CallTelemetry[]): PipelineDeps {
  if (cfg.kind === "baseline") return { extractor: null, assessorA: null, assessorB: null, adjudicator: null, policy: DEFAULT_ASSESSMENT_POLICY, allowBaseline: true, random: () => 0.5, now: () => new Date("2026-11-15T00:00:00Z") };
  const ctx = (model: string): RunContext => ({ routing: { provider: cfg.provider, model }, prices: DEFAULT_PRICES, onTelemetry: (t) => void telemetry.push(t) });
  return { extractor: ctx(cfg.models.extractor), assessorA: ctx(cfg.models.assessorA), assessorB: ctx(cfg.models.assessorB), adjudicator: ctx(cfg.models.adjudicator), policy: DEFAULT_ASSESSMENT_POLICY, allowBaseline: false };
}

/** Rendered prompt sizes (characters → tokens at ~3.8 chars/token) for cost projection. */
function promptTokens(attempt: ReturnType<typeof buildAttempt>): Record<string, number> {
  const tok = (s: { system: string; user: string }) => Math.round((s.system.length + s.user.length) / 3.8);
  const ex = extractorPrompt.render(extractorPrompt.inputSchema.parse(extractorInput(attempt)));
  const asIn = assessorInput(attempt, opportunitiesFor(attempt), []);
  const as = assessorPrompt("assessor_a").render(assessorPrompt("assessor_a").inputSchema.parse(asIn));
  return { evidence_extractor: tok(ex), assessor_a: tok(as), assessor_b: tok(as) };
}

export async function runPattern(p: ResponsePattern, variant: Variant, cv: CaseVersion, profile: ExamProfileVersion, cfg: AssessorConfig): Promise<RunRecord> {
  const turns = applyVariant(p.turns, variant);
  const attempt = buildAttempt(p, turns, cv, profile, `${p.id.replaceAll(".", "-")}-${variant}`);
  const telemetry: CallTelemetry[] = [];
  const t0 = performance.now();
  const result = await runCaseAssessment(attempt, depsFor(cfg, telemetry));
  const latencyMs = Math.round(performance.now() - t0);
  const segMap = new Map(attempt.segments.map((s) => [s.id, s]));
  const base = {
    patternId: p.id,
    caseId: p.caseId,
    familyId: cv.caseFamilyId,
    split: splitForFamily(cv.caseFamilyId),
    level: p.level,
    tags: p.tags,
    variant,
    globalExpected: p.expected.global,
    mustNotPass: p.expected.mustNotPass,
    unsafeExpected: p.expected.unsafeCriteria,
    passes: result.passes.map((x) => ({ stage: x.stage, kind: x.assessorKind, status: x.status, latencyMs: x.latencyMs })),
    latencyMs,
    telemetry,
    projection: { inputTokens: promptTokens(attempt) },
  };
  if (!result.available) {
    return {
      ...base,
      available: false,
      unavailableReason: result.reason,
      global: null,
      globalOk: false,
      falseReassurance: false,
      unfairFailure: false,
      elements: Object.entries(p.expected.elements).map(([elementId, expected]) => ({ elementId, severity: cv.rubric.elements.find((e) => e.id === elementId)?.severity ?? "minor", expected, actual: null, statusOk: false, promptingOk: null, creditOk: null })),
      unsafeFlagged: [],
      evidence: { total: 0, valid: 0 },
      omissionsWithoutOpportunity: 0,
      disputed: [],
      modelToModel: null,
    };
  }
  const f = result.final;
  const elements: ElementRecord[] = cv.rubric.elements.map((el) => {
    const expected = p.expected.elements[el.id] ?? { status: [] };
    const r = f.elementResults.find((x) => x.elementId === el.id) ?? null;
    return {
      elementId: el.id,
      severity: el.severity,
      expected,
      actual: r ? { status: r.status, promptingLevel: r.promptingLevel, credit: r.credit, evidence: r.evidence.length, selfCorrection: r.selfCorrection !== null, agreement: r.agreement, opportunityAssessable: r.opportunity.assessable } : null,
      statusOk: !!r && expected.status.includes(r.status),
      promptingOk: expected.prompting && r ? r.promptingLevel === expected.prompting : null,
      creditOk: expected.credit && r ? r.credit === expected.credit : null,
    };
  });
  const spans = [...f.elementResults.flatMap((r) => r.evidence), ...f.unsafeFlags.flatMap((u) => u.evidence)];
  const valid = spans.filter((s) => validateSpan(s, segMap).ok).length;
  const ref = p.expected.global[0] ?? null;
  // Model-to-model agreement: only when two independent model passes exist.
  const a = result.passes.find((x) => x.stage === "A" && x.status !== "unavailable" && x.assessorKind === "llm");
  const b = result.passes.find((x) => x.stage === "B" && x.status !== "unavailable" && x.assessorKind === "llm");
  let modelToModel: RunRecord["modelToModel"] = null;
  if (a?.output && b?.output) {
    const ja = (a.output.elementJudgments as { elementId: string; status: string }[] | undefined) ?? [];
    const jb = new Map(((b.output.elementJudgments as { elementId: string; status: string }[] | undefined) ?? []).map((j) => [j.elementId, j.status]));
    const compared = ja.filter((j) => jb.has(j.elementId));
    modelToModel = { compared: compared.length, agreed: compared.filter((j) => jb.get(j.elementId) === j.status).length };
  }
  return {
    ...base,
    available: true,
    unavailableReason: null,
    global: f.globalRating.level,
    globalOk: p.expected.global.includes(f.globalRating.level),
    falseReassurance: p.expected.mustNotPass && PASSING.includes(f.globalRating.level),
    unfairFailure: PASSING.includes(ref) && FAILING.includes(f.globalRating.level),
    elements,
    unsafeFlagged: f.unsafeFlags.filter((u) => u.committed && !u.correctedLater).map((u) => u.criterion),
    evidence: { total: spans.length, valid },
    omissionsWithoutOpportunity: f.elementResults.filter((r) => r.status === "not_demonstrated" && !r.opportunity.assessable).length,
    disputed: f.disputedElementIds,
    modelToModel,
  };
}

export async function runAssessmentSuite(patterns: readonly ResponsePattern[], cases: Map<string, CaseVersion>, profile: ExamProfileVersion, cfg: AssessorConfig, variants: Variant[]): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for (const p of patterns) {
    const cv = cases.get(p.caseId);
    if (!cv) throw new Error(`pattern ${p.id}: unknown case ${p.caseId}`);
    for (const v of variants) out.push(await runPattern(p, v, cv, profile, cfg));
  }
  return out;
}
