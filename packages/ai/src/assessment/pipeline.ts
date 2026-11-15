import { createHash } from "node:crypto";
import type {
  AssessorKind,
  DomainRating,
  ElementResult,
  ExtractedStatement,
  FinalCaseAssessment,
  OwnerReviewKind,
  RatingLevel,
  UnsafeFlag,
  ValidationIssue,
} from "@sim/contracts";
import { displayRating } from "@sim/clinical-content";
import { runPrompt, type RunContext } from "../llm/runner";
import { adjudicatorPrompt, assessorPrompt, extractorPrompt, type AdjudicatorOutput, type AssessorLlmOutput } from "../prompts/assessment";
import { promptVersions } from "../prompts/registry";
import { comparePasses } from "./agreement";
import { baselineAssess } from "./baseline";
import { validateSpan, type CandidateSegment } from "./evidence";
import { assessorInput, extractorInput, opportunitiesFor, timelineOf, type AttemptData } from "./inputs";
import { creditFor, postprocessPass, type ValidatedJudgment, type ValidatedPass } from "./postprocess";
import { applyCaps, deterministicDomainRatings, deterministicLevel, reconcileLevels, withholdReason } from "./ratings";

export type AssessmentPolicy = {
  /** "always" during the first clinical pilot; "risk_based" only after explicit owner approval. */
  secondPass: "always" | "risk_based";
  randomSampleRate: number;
  shareExtractionWithB: boolean;
};

export const DEFAULT_ASSESSMENT_POLICY: AssessmentPolicy = { secondPass: "always", randomSampleRate: 0.2, shareExtractionWithB: false };

export type PipelineDeps = {
  extractor: RunContext | null;
  assessorA: RunContext | null;
  assessorB: RunContext | null;
  adjudicator: RunContext | null;
  policy: AssessmentPolicy;
  /** Development only: allow the lexical baseline when no assessment model is configured. */
  allowBaseline: boolean;
  forceSecondPass?: boolean;
  random?: () => number;
  now?: () => Date;
};

export type PassRecord = {
  stage: "extraction" | "A" | "B" | "adjudication";
  assessorKind: AssessorKind;
  provenance: Record<string, unknown>;
  inputHash: string;
  output: Record<string, unknown> | null;
  validationIssues: ValidationIssue[];
  status: "valid" | "repaired" | "invalid" | "unavailable";
  latencyMs: number | null;
};

export type OwnerItemDraft = { kind: OwnerReviewKind; priority: "urgent" | "normal" | "digest"; title: string; detail: string; refs: Record<string, string>; dedupeKey: string };

export type PipelineResult =
  | { available: true; final: Omit<FinalCaseAssessment, "id" | "assessmentVersion" | "supersedesAssessmentId" | "supersedeReason">; passes: PassRecord[]; ownerItems: OwnerItemDraft[] }
  | { available: false; reason: string; passes: PassRecord[]; ownerItems: OwnerItemDraft[] };

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

export async function runCaseAssessment(attempt: AttemptData, deps: PipelineDeps): Promise<PipelineResult> {
  const cv = attempt.caseVersion;
  const timeline = timelineOf(attempt);
  const opportunities = opportunitiesFor(attempt);
  const segMap = new Map(attempt.segments.map((s) => [s.id, s]));
  const passes: PassRecord[] = [];
  const ownerItems: OwnerItemDraft[] = [];
  const now = deps.now ?? (() => new Date());
  const technicalLimitations = technicalLimitationsOf(attempt);

  // ---------------------------------------------------------------- baseline (dev only)
  if (!deps.assessorA?.routing.provider) {
    if (!deps.allowBaseline) {
      return { available: false, reason: "No assessment model is configured. No result has been produced.", passes, ownerItems };
    }
    const raw = baselineAssess(cv, attempt.segments, opportunities, attempt.caseStartedAtMs);
    const pass = postprocessPass(raw, cv, opportunities, attempt.segments, timeline);
    passes.push({ stage: "A", assessorKind: "dev_baseline", provenance: { provider: "dev_baseline", model: "lexical-baseline", promptId: "none", promptVersion: "baseline@2026-11-15.1", simulated: true }, inputHash: hash({ segs: attempt.segments.map((s) => s.text), cv: cv.versionId }), output: raw as unknown as Record<string, unknown>, validationIssues: pass.issues, status: pass.repaired ? "repaired" : "valid", latencyMs: 0 });
    const results = singlePassResults(pass);
    const domainRatings = deterministicDomainRatings(cv, pass.judgments, pass.unsafeFlags);
    return {
      available: true,
      passes,
      ownerItems,
      final: finalize(attempt, "dev_baseline", [], results, pass.unsafeFlags, domainRatings, deterministicLevel([...pass.judgments.values()], pass.unsafeFlags), [], true, technicalLimitations, now, [
        "Development baseline assessor (lexical matching) — not a clinical assessment.",
      ]),
    };
  }

  // ---------------------------------------------------------------- extraction
  let statements: ExtractedStatement[] = [];
  if (deps.extractor?.routing.provider) {
    const input = extractorInput(attempt);
    const r = await runPrompt(extractorPrompt, input, deps.extractor);
    if (r.ok) {
      const issues: ValidationIssue[] = [];
      for (const s of r.data.statements) {
        const v = validateSpan(s.span, segMap);
        if (!v.ok) {
          issues.push({ code: "statement_span_rejected", severity: "error", elementId: null, message: `statement ${s.id}: ${v.reason}` });
          continue;
        }
        statements.push({ ...s, span: v.span, normalizedConcept: s.normalizedConcept.slice(0, 200) });
      }
      passes.push({ stage: "extraction", assessorKind: "llm", provenance: r.provenance, inputHash: hash(input), output: { statements }, validationIssues: issues, status: issues.length ? "repaired" : "valid", latencyMs: r.latencyMs });
    } else {
      passes.push({ stage: "extraction", assessorKind: "llm", provenance: r.provenance ?? {}, inputHash: hash(input), output: null, validationIssues: [{ code: r.reason, severity: "error", elementId: null, message: r.message }], status: "unavailable", latencyMs: null });
      statements = [];
    }
  }
  const sharedStatements = statements.map((s) => ({ id: s.id, kind: s.kind, segmentId: s.span.segmentId, quote: s.span.quote, normalizedConcept: s.normalizedConcept, negated: s.negated, laterality: s.laterality, certainty: s.certainty, correctsStatementId: s.correctsStatementId }));

  // ---------------------------------------------------------------- independent passes
  const runPass = async (stage: "A" | "B", ctx: RunContext, withStatements: boolean): Promise<ValidatedPass | null> => {
    const input = assessorInput(attempt, opportunities, withStatements && sharedStatements.length ? sharedStatements : null);
    const r = await runPrompt(assessorPrompt(stage === "A" ? "assessor_a" : "assessor_b"), input, ctx);
    if (!r.ok) {
      passes.push({ stage, assessorKind: "llm", provenance: r.provenance ?? {}, inputHash: hash(input), output: null, validationIssues: [{ code: r.reason, severity: "error", elementId: null, message: r.message }], status: "unavailable", latencyMs: null });
      return null;
    }
    const v = postprocessPass(r.data as AssessorLlmOutput, cv, opportunities, attempt.segments, timeline);
    const severeIssues = v.issues.filter((i) => i.severity === "error").length;
    passes.push({ stage, assessorKind: ctx.routing.provider!.simulated ? "mock" : "llm", provenance: r.provenance, inputHash: hash(input), output: r.data as unknown as Record<string, unknown>, validationIssues: v.issues, status: severeIssues > cv.rubric.elements.length / 2 ? "invalid" : v.repaired || severeIssues ? "repaired" : "valid", latencyMs: r.latencyMs });
    return v;
  };

  const A = await runPass("A", deps.assessorA, true);
  const needB = deps.forceSecondPass || deps.policy.secondPass === "always" || (A !== null && riskBasedNeedsSecondPass(A, attempt, deps));
  const B = needB && deps.assessorB?.routing.provider ? await runPass("B", deps.assessorB, deps.policy.shareExtractionWithB) : null;
  const assessorKind: AssessorKind = passes.some((p) => (p.stage === "A" || p.stage === "B") && p.assessorKind === "mock") ? "mock" : "llm";

  if (!A && !B) {
    ownerItems.push({ kind: "technical_failure_adjustment", priority: "normal", title: "Assessment unavailable", detail: "Both assessment passes failed. The attempt is preserved and will be retried; no result was shown to the learner.", refs: { caseAttemptId: attempt.caseAttemptId }, dedupeKey: `assessment-unavailable:${attempt.caseAttemptId}` });
    return { available: false, reason: "The assessment service was unavailable. Your attempt is saved and will be assessed when the service recovers.", passes, ownerItems };
  }

  const single = A && B ? null : (A ?? B)!;
  if (single) {
    if (needB) ownerItems.push({ kind: "consequential_grading_risk", priority: "digest", title: "Second assessment pass unavailable", detail: "Policy required two independent passes but only one completed. The result is marked provisional.", refs: { caseAttemptId: attempt.caseAttemptId }, dedupeKey: `single-pass:${attempt.caseAttemptId}` });
    const results = singlePassResults(single);
    const est = deterministicLevel([...single.judgments.values()], single.unsafeFlags);
    const domains = single.domainRatings.length ? single.domainRatings : deterministicDomainRatings(cv, single.judgments, single.unsafeFlags);
    addRiskItems(attempt, results, single.unsafeFlags, [], ownerItems);
    return { available: true, passes, ownerItems, final: finalize(attempt, assessorKind, statements, results, single.unsafeFlags, domains, single.globalRating.level ?? est, [], needB, technicalLimitations, now, []) };
  }

  // ---------------------------------------------------------------- compare and adjudicate
  const { comparisons, flags } = comparePasses(cv, A!, B!);
  const material = [...comparisons.entries()].filter(([, c]) => c.kind === "material");
  const adjudicated = new Map<string, AdjudicatorOutput["resolutions"][number]>();
  if (material.length > 0 && deps.adjudicator?.routing.provider) {
    const adjInput = {
      disputes: material.map(([id, c]) => {
        const el = cv.rubric.elements.find((e) => e.id === id)!;
        const m = c as Extract<typeof c, { kind: "material" }>;
        return {
          elementId: id,
          element: { construct: el.construct, acceptedConcepts: el.acceptedConcepts, acceptableAlternatives: el.acceptableAlternatives, incorrectOrUnsafeClaims: el.incorrectOrUnsafeClaims, severity: el.severity },
          opportunity: opportunities.find((o) => o.elementId === id)!,
          judgmentA: summarizeJudgment(m.a),
          judgmentB: summarizeJudgment(m.b),
        };
      }),
      transcript: assessorInput(attempt, opportunities, null).transcript,
      examinerPrompts: assessorInput(attempt, opportunities, null).examinerPrompts,
    };
    const r = await runPrompt(adjudicatorPrompt, adjInput, deps.adjudicator);
    const issues: ValidationIssue[] = [];
    if (r.ok) {
      for (const res of r.data.resolutions) {
        if (res.outcome !== "resolved" || !res.status) continue;
        const ev = res.evidence.map((e) => validateSpan(e, segMap)).filter((x) => x.ok);
        const needsEvidence = res.status === "demonstrated" || res.status === "partially_demonstrated" || res.status === "incorrect";
        if (needsEvidence && ev.length === 0) {
          issues.push({ code: "adjudication_unsupported", severity: "error", elementId: res.elementId, message: "resolution cited no verifiable evidence; left unresolved" });
          continue;
        }
        adjudicated.set(res.elementId, { ...res, evidence: ev.map((x) => (x as Extract<typeof x, { ok: true }>).span) });
      }
    }
    passes.push({ stage: "adjudication", assessorKind, provenance: r.provenance ?? {}, inputHash: hash(adjInput), output: r.ok ? (r.data as unknown as Record<string, unknown>) : null, validationIssues: r.ok ? issues : [{ code: r.reason, severity: "error", elementId: null, message: r.message }], status: r.ok ? (issues.length ? "repaired" : "valid") : "unavailable", latencyMs: r.ok ? r.latencyMs : null });
  }

  const results: ElementResult[] = [];
  const disputed: string[] = [];
  for (const el of cv.rubric.elements) {
    const c = comparisons.get(el.id)!;
    if (c.kind === "agreed") results.push({ ...c.merged, agreement: "agreed" });
    else if (c.kind === "minor_resolved") results.push({ ...c.merged, rationale: `${c.merged.rationale} (${c.note})`, agreement: "adjudicated" });
    else {
      const adj = adjudicated.get(el.id);
      if (adj && adj.status) {
        const base = adj.status === c.a.status ? c.a : adj.status === c.b.status ? c.b : c.a;
        const promptingLevel = adj.promptingLevel ?? base.promptingLevel;
        results.push({
          ...base,
          status: adj.status,
          promptingLevel: adj.status === "demonstrated" || adj.status === "partially_demonstrated" ? promptingLevel : null,
          credit: creditFor(el, adj.status, promptingLevel),
          evidence: adj.evidence.length ? adj.evidence : base.evidence,
          rationale: `Adjudicated: ${adj.rationale.slice(0, 500)}`,
          uncertaintyReason: adj.status === "uncertain" ? adj.rationale.slice(0, 300) : null,
          agreement: "adjudicated",
        });
      } else {
        disputed.push(el.id);
        results.push({
          ...c.a,
          status: "uncertain",
          promptingLevel: null,
          credit: "not_applicable",
          rationale: `Independent assessments disagreed (${c.reason}). A: ${c.a.status}; B: ${c.b.status}.`,
          uncertaintyReason: "Independent assessments disagreed; this element is awaiting owner review.",
          evidence: [...c.a.evidence, ...c.b.evidence],
          agreement: "disputed",
        });
        ownerItems.push({
          kind: "assessment_disagreement",
          priority: el.severity === "critical" ? "urgent" : "normal",
          title: `Assessment disagreement: ${el.construct.slice(0, 80)}`,
          detail: `${c.reason}. Assessor A: ${c.a.status} — ${c.a.rationale.slice(0, 200)} | Assessor B: ${c.b.status} — ${c.b.rationale.slice(0, 200)}`,
          refs: { caseAttemptId: attempt.caseAttemptId, elementId: el.id, caseVersionId: cv.versionId },
          dedupeKey: `disagreement:${attempt.caseAttemptId}:${el.id}`,
        });
      }
    }
  }

  // Unsafe flags: shared flags stand; a disputed flag stands only if the element was finally judged incorrect.
  const finalStatus = new Map(results.map((r) => [r.elementId, r.status]));
  const unsafeFlags: UnsafeFlag[] = [...flags.shared, ...flags.disputed.filter((f) => f.elementId && finalStatus.get(f.elementId) === "incorrect")];
  for (const f of flags.disputed.filter((x) => !unsafeFlags.includes(x))) {
    ownerItems.push({ kind: "consequential_grading_risk", priority: "normal", title: "Unsafe-statement flag raised by one assessor only", detail: `${f.criterion} — "${f.evidence[0]?.quote ?? ""}". Not applied to the rating pending review.`, refs: { caseAttemptId: attempt.caseAttemptId, ...(f.elementId ? { elementId: f.elementId } : {}) }, dedupeKey: `unsafe-disputed:${attempt.caseAttemptId}:${f.elementId ?? "none"}:${hash(f.criterion).slice(0, 8)}` });
  }

  // Ratings: reconcile A and B; deterministic estimate from final element results breaks adjacent ties.
  const finalJudgments = new Map(results.map((r) => [r.elementId, r as unknown as ValidatedJudgment]));
  const estDomains = deterministicDomainRatings(cv, finalJudgments, unsafeFlags);
  const domainRatings: DomainRating[] = cv.rubric.domains.map((d) => {
    const a = A!.domainRatings.find((x) => x.domain === d.id);
    const b = B!.domainRatings.find((x) => x.domain === d.id);
    const est = estDomains.find((x) => x.domain === d.id)!;
    const r = reconcileLevels(a?.level ?? null, b?.level ?? null, est.level);
    return { domain: d.id, level: r.level, rationale: r.disputed ? "Independent ratings differed by more than one level; withheld." : (a?.rationale || b?.rationale || est.rationale), supportingElementIds: est.supportingElementIds };
  });
  const estGlobal = deterministicLevel([...finalJudgments.values()], unsafeFlags);
  const g = reconcileLevels(A!.globalRating.level, B!.globalRating.level, estGlobal);
  if (g.disputed) {
    ownerItems.push({ kind: "assessment_disagreement", priority: "normal", title: "Overall ratings differed by more than one level", detail: `A: ${A!.globalRating.level}; B: ${B!.globalRating.level}. Overall rating withheld.`, refs: { caseAttemptId: attempt.caseAttemptId }, dedupeKey: `global-disagreement:${attempt.caseAttemptId}` });
  }
  addRiskItems(attempt, results, unsafeFlags, disputed, ownerItems);
  return {
    available: true,
    passes,
    ownerItems,
    final: finalize(attempt, assessorKind, statements, results, unsafeFlags, domainRatings, g.disputed ? null : g.level, disputed, disputed.length > 0, technicalLimitations, now, g.disputed ? ["Independent overall ratings differed by more than one level."] : []),
  };
}

function summarizeJudgment(j: ValidatedJudgment): Record<string, unknown> {
  return { status: j.status, promptingLevel: j.promptingLevel, evidence: j.evidence, rationale: j.rationale, uncertaintyReason: j.uncertaintyReason };
}

function singlePassResults(p: ValidatedPass): ElementResult[] {
  return [...p.judgments.values()].map((j) => ({ ...j, agreement: "single_pass" as const }));
}

function riskBasedNeedsSecondPass(A: ValidatedPass, attempt: AttemptData, deps: PipelineDeps): boolean {
  const statuses = [...A.judgments.values()];
  const critical = A.unsafeFlags.length > 0 || statuses.some((j) => j.severity === "critical" && (j.status === "incorrect" || j.status === "not_demonstrated"));
  const borderline = A.globalRating.level === "below_expected" || A.globalRating.level === "meets_expected";
  const uncertain = statuses.some((j) => j.status === "uncertain");
  const lowConfidence = attempt.segments.some((s) => s.confidence !== null && s.confidence < 0.75);
  const sampled = (deps.random ?? Math.random)() < deps.policy.randomSampleRate;
  return critical || borderline || uncertain || lowConfidence || sampled;
}

function addRiskItems(attempt: AttemptData, results: ElementResult[], flags: UnsafeFlag[], disputed: string[], items: OwnerItemDraft[]): void {
  for (const f of flags.filter((x) => x.committed && !x.correctedLater)) {
    items.push({ kind: "consequential_grading_risk", priority: "digest", title: "Committed unsafe statement recorded", detail: `${f.criterion} — "${f.evidence[0]?.quote ?? ""}"`, refs: { caseAttemptId: attempt.caseAttemptId, ...(f.elementId ? { elementId: f.elementId } : {}) }, dedupeKey: `unsafe:${attempt.caseAttemptId}:${f.elementId ?? "none"}:${hash(f.criterion).slice(0, 8)}` });
  }
  const lowConf = results.filter((r) => r.status === "uncertain" && !disputed.includes(r.elementId));
  if (lowConf.length > 0) {
    items.push({ kind: "uncertain_finding", priority: "digest", title: `${lowConf.length} element(s) could not be judged confidently`, detail: lowConf.map((r) => `${r.elementId}: ${r.uncertaintyReason ?? ""}`).join("; ").slice(0, 900), refs: { caseAttemptId: attempt.caseAttemptId }, dedupeKey: `uncertain:${attempt.caseAttemptId}` });
  }
}

function technicalLimitationsOf(a: AttemptData): string[] {
  const out = [...a.technicalNotes];
  const label = new Map(a.caseVersion.assets.map((x) => [x.id, x.neutralLabel]));
  const failed = a.renders.filter((r) => r.status === "failed" && !a.renders.some((x) => x.assetId === r.assetId && x.status === "rendered"));
  for (const f of failed) out.push(`Image did not display: ${label.get(f.assetId) ?? "image"}. Elements requiring it were not assessed.`);
  const interrupted = a.utterances.filter((u) => u.deliveryStatus === "interrupted" || u.deliveryStatus === "failed");
  if (interrupted.length) out.push(`${interrupted.length} examiner prompt(s) were interrupted or failed to play; only the heard portion was counted.`);
  if (a.typedInput) out.push("Answers were typed (practice mode), not spoken; this is not equivalent spoken-examination evidence.");
  if (a.endedByTechnicalFailure) out.push("The case ended because of a technical failure.");
  return [...new Set(out)];
}

function finalize(
  attempt: AttemptData,
  assessorKind: AssessorKind,
  statements: ExtractedStatement[],
  results: ElementResult[],
  unsafeFlags: UnsafeFlag[],
  domainRatings: DomainRating[],
  globalLevel: RatingLevel | null,
  disputed: string[],
  provisionalBase: boolean,
  technicalLimitations: string[],
  now: () => Date,
  extraUncertainty: string[],
): Omit<FinalCaseAssessment, "id" | "assessmentVersion" | "supersedesAssessmentId" | "supersedeReason"> {
  const cv = attempt.caseVersion;
  const judgments = new Map(results.map((r) => [r.elementId, r as unknown as ValidatedJudgment]));
  const caps = applyCaps(cv, globalLevel, judgments, unsafeFlags);
  const withheld = withholdReason(cv, judgments, disputed) ?? (globalLevel === null ? "The assessors could not give a defensible overall rating." : null);
  const uncertaintyReasons = [
    ...extraUncertainty,
    ...results.filter((r) => r.status === "uncertain").map((r) => `${cv.rubric.elements.find((e) => e.id === r.elementId)?.construct ?? r.elementId}: ${r.uncertaintyReason ?? "uncertain"}`),
  ];
  const level = withheld ? null : caps.level;
  return {
    caseAttemptId: attempt.caseAttemptId,
    frozenVersions: {
      profileVersionId: attempt.profile.versionId,
      caseVersionId: cv.versionId,
      rubricVersionId: cv.rubric.versionId,
      transcriptRevision: attempt.transcriptRevision,
      promptVersions: promptVersions(),
    },
    assessorKind,
    statements,
    elementResults: results,
    unsafeFlags,
    domainRatings,
    globalRating: { level, display: level ? displayRating(attempt.profile, level) : null, withheldReason: withheld, capsApplied: caps.capsApplied },
    criticalConcerns: caps.criticalConcerns,
    uncertaintyReasons,
    disputedElementIds: disputed,
    provisional: provisionalBase || disputed.length > 0 || assessorKind === "dev_baseline",
    technicalLimitations,
    createdAt: now().toISOString(),
  };
}
