import type { ExamProfileVersion } from "@sim/contracts";
import { DEFAULT_PRICES } from "@sim/ai";
import type { ExaminerSimResult } from "./examiner-sim";
import type { LockStatus } from "./lock";
import { LEVELS, stability, type Metrics } from "./metrics";
import type { ScenarioResult } from "./regression";
import type { RunRecord } from "./runner";
import { fmt, pct } from "./stats";

export type ReportInput = {
  reportId: string;
  generatedAt: string;
  gitCommit: string | null;
  assessorLabel: string;
  assessorIsProductionCandidate: boolean;
  examinerLabel: string;
  promptVersions: Record<string, string>;
  caseVersions: string[];
  approvals: Record<string, number>;
  ownerRated: number;
  ownerConsistency: { pairs: number; sameGlobal: number; elementAgreement: number | null };
  lock: LockStatus;
  metrics: { all: Metrics; tuning: Metrics; final: Metrics };
  records: RunRecord[];
  examiner: ExaminerSimResult[];
  regression: { scenarios: ScenarioResult[]; ran: boolean; note: string };
  profile: ExamProfileVersion;
  casesPerStation: number;
  pricingModel: string;
};

const frac = (a: number, b: number) => (b === 0 ? "n/a (0)" : `${a}/${b} (${pct(a / b)})`);
const ci = (x: [number, number] | null) => (x ? `95% CI ${pct(x[0])}–${pct(x[1])}` : "CI not computable");
const kci = (x: [number, number] | null) => (x ? `bootstrap 95% CI ${fmt(x[0])} to ${fmt(x[1])}` : "CI not computable (fewer than 2 cases or no variation)");

function gate(name: string, status: "met" | "not met" | "not measurable", evidence: string) {
  return `| ${name} | ${status === "met" ? "✅ met" : status === "not met" ? "❌ not met" : "⚠️ not measurable"} | ${evidence} |`;
}

function metricsSection(title: string, m: Metrics): string {
  const conf = m.global.confusion;
  const confTable = [
    `| reference ↓ / assessed → | ${LEVELS.join(" | ")} |`,
    `|---|${LEVELS.map(() => "---").join("|")}|`,
    ...LEVELS.map((l, i) => `| ${l} | ${conf[i]!.join(" | ")} |`),
  ].join("\n");
  const sev = Object.entries(m.elements.bySeverity).map(([k, v]) => `${k} ${frac(v.ok, v.total)}`).join(" · ");
  const tags = Object.entries(m.byTag).sort().map(([k, v]) => `| ${k} | ${frac(v.fullyCorrect, v.patterns)} |`).join("\n");
  return `### ${title}

Denominators: ${m.patterns} base responses · ${m.cases} case(s) · ${m.families} case family(ies) · mix ${Object.entries(m.levelMix).map(([k, v]) => `${k} ${v}`).join(", ")}. Results available for ${frac(m.available, m.patterns)}.

**Overall rating**
- Within the reference's acceptable range: ${frac(m.global.withinRange, m.patterns)}, ${ci(m.global.withinRangeCi)}
- Weighted kappa vs reference (n=${m.global.pairs} rated pairs; withheld/unavailable ${m.global.withheld}): linear ${fmt(m.global.kappaLinear)}, quadratic ${fmt(m.global.kappaQuadratic)} (${kci(m.global.kappaQuadraticCi)})

${confTable}

**Element judgments**: ${frac(m.elements.ok, m.elements.total)} match an acceptable status (${sev}); linear-weighted kappa on ordinal statuses ${fmt(m.elements.kappaLinear)} (n=${m.elements.pairs}).

**Safety**
- False reassurance (inadequate/unsafe response rated meets_expected or better): **${m.safety.falseReassurance.length} of ${m.safety.mustNotPass}**${m.safety.falseReassurance.length ? ` — ${m.safety.falseReassurance.join(", ")}` : ""}
- Unfair failure (reference passing, assessed below_expected/unsafe): **${m.safety.unfairFailure.length} of ${m.safety.referencePassing}**${m.safety.unfairFailure.length ? ` — ${m.safety.unfairFailure.join(", ")}` : ""}
- Critical elements credited although the reference says missed/incorrect: ${m.safety.criticalFalseCredit.length}${m.safety.criticalFalseCredit.length ? ` — ${m.safety.criticalFalseCredit.map((x) => `${x.patternId}/${x.elementId}=${x.actual}`).join(", ")}` : ""}
- Elements failed although the reference says demonstrated: ${m.safety.unfairElementFailure.length}${m.safety.unfairElementFailure.length ? ` — ${m.safety.unfairElementFailure.map((x) => `${x.patternId}/${x.elementId}=${x.actual}`).join(", ")}` : ""}
- Approved unsafe criteria detected: ${frac(m.safety.unsafeRecall.flagged, m.safety.unsafeRecall.expected)}; unsafe flags on responses with none expected: ${m.safety.unsafeFalseAlarms.length}${m.safety.unsafeFalseAlarms.length ? ` — ${m.safety.unsafeFalseAlarms.map((x) => `${x.patternId}: "${x.criterion}"`).join("; ")}` : ""}

**Evidence and opportunity**: verbatim evidence spans valid ${frac(m.evidence.valid, m.evidence.spans)}; omissions recorded without a genuine opportunity ${m.evidence.omissionsWithoutOpportunity}; prompting level as specified ${frac(m.evidence.prompting.ok, m.evidence.prompting.checked)}; credit as specified ${frac(m.evidence.credit.ok, m.evidence.credit.checked)}.

**Abstention** (reported alongside accuracy): ${m.abstention.elementAbstentions} element judgments uncertain/not assessable, of which ${m.abstention.elementUnexpectedAbstentions} where the reference made a definite judgment; ${m.abstention.elementsAssessed} definite judgments.

**Behaviours by tag** (response fully correct = every element status and the overall rating acceptable)

| tag | fully correct |
|---|---|
${tags || "| (none) | |"}
`;
}

export function renderReport(r: ReportInput): string {
  const final = r.metrics.final;
  const all = r.metrics.all;
  const stab = stability(r.records);
  const regAll = r.regression.scenarios;
  const regPass = regAll.filter((s) => s.pass === true).length;
  const ex = r.examiner;
  const exLeaks = ex.flatMap((x) => x.leaks.map((l) => `${x.patternId}: "${l.concept}" in "${l.text}"`));
  const exNeutral = ex.flatMap((x) => x.neutralityViolations.map((v) => `${x.patternId}: ${v}`));
  const exUnapproved = ex.flatMap((x) => x.unapprovedOutputs.map((v) => `${x.patternId}: ${v}`));
  const forged = ex.reduce((a, x) => [a[0]! + x.forgedRejected, a[1]! + x.forgedTotal], [0, 0]);
  const unavailReq = ex.reduce((a, x) => a + x.unavailable.requested.length, 0);
  const unavailOk = ex.reduce((a, x) => a + x.unavailable.requested.filter((id) => x.unavailable.delivered.includes(id)).length, 0);
  const lat = ex.flatMap((x) => x.decisionLatencyMs).sort((a, b) => a - b);
  const p = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]! : null);
  const decisionsPerCase = ex.length ? ex.reduce((a, x) => a + x.decisions, 0) / ex.length : 0;
  const exTokens = ex.flatMap((x) => x.examinerPromptTokens);
  const avgExTok = exTokens.length ? exTokens.reduce((a, b) => a + b, 0) / exTokens.length : 0;
  const base = r.records.filter((x) => x.variant === "base");
  const avg = (role: string) => (base.length ? base.reduce((a, x) => a + (x.projection.inputTokens[role] ?? 0), 0) / base.length : 0);
  const price = DEFAULT_PRICES[r.pricingModel];
  const OUT = { evidence_extractor: 2500, assessor_a: 3500, assessor_b: 3500, adjudicator: 1500, examiner: 120 };
  const roleCost = (inTok: number, outTok: number) => (price ? (inTok * price.input + outTok * price.output) / 1e6 : null);
  const assessCase = price ? roleCost(avg("evidence_extractor"), OUT.evidence_extractor)! + roleCost(avg("assessor_a"), OUT.assessor_a)! + roleCost(avg("assessor_b"), OUT.assessor_b)! + 0.3 * roleCost(avg("assessor_a") * 1.4, OUT.adjudicator)! : null;
  const examCase = price ? decisionsPerCase * roleCost(avgExTok, OUT.examiner)! : null;
  const measuredCost = r.records.reduce((a, x) => a + x.telemetry.reduce((b, t) => b + t.estimatedCostUsd, 0), 0);

  const lockLine =
    r.lock.state === "not_locked"
      ? "⚠️ The final split is **not locked**. Run `pnpm evals:lock` before judging changes against it."
      : r.lock.state === "intact"
        ? `Final split locked ${r.lock.lockedAt}; inputs unchanged. It has been evaluated ${r.lock.priorFinalRuns} time(s) before this run under this lock${r.lock.priorFinalRuns > 3 ? " — **repeated evaluation: treat final-split results as partially tuned, not unseen**" : ""}.`
        : `❌ **Lock violated**: final inputs changed since ${r.lock.lockedAt} (changed: ${r.lock.changed.join(", ") || "none"}; added: ${r.lock.added.join(", ") || "none"}; removed: ${r.lock.removed.join(", ") || "none"}). Final-split numbers are not comparable with earlier locked runs.`;

  const releaseGates = [
    gate("Every clinical case is owner-approved", "not met", "No clinical cases exist yet; only fictional development fixtures (excluded from production counts)."),
    gate(
      "No known answer or cross-account access leaks",
      exLeaks.length === 0 && regAll.find((s) => s.id === "cross_account")?.pass === true ? "met" : regAll.find((s) => s.id === "cross_account")?.pass === null ? "not measurable" : "not met",
      `Examiner leak checks: ${exLeaks.length} leak(s); cross-account regression: ${regAll.find((s) => s.id === "cross_account")?.pass ?? "not run"}. Also run \`pnpm check:leaks\` on the built client bundle.`,
    ),
    gate("All material assessment claims evidence-grounded", all.evidence.spans > 0 && all.evidence.valid === all.evidence.spans ? "met" : "not met", `Valid evidence spans ${frac(all.evidence.valid, all.evidence.spans)} (structural guarantee: unverifiable quotes are rejected).`),
    gate(
      "No unresolved critical false-reassurance defect in the locked release suite",
      r.lock.state !== "intact" ? "not measurable" : !r.assessorIsProductionCandidate ? "not measurable" : final.safety.falseReassurance.length === 0 ? "met" : "not met",
      `${r.assessorLabel}: ${final.safety.falseReassurance.length} false reassurance in the final split${r.assessorIsProductionCandidate ? "" : " — the dev baseline is not a production assessor, so this gate needs a run with the configured model assessor"}${r.lock.state !== "intact" ? "; final split not locked/intact" : ""}.`,
    ),
    gate("Payment/usage reconciliation passes", regAll.find((s) => s.id === "duplicates")?.pass === true ? "met" : regAll.find((s) => s.id === "duplicates")?.pass === null ? "not measurable" : "not met", "Billing idempotency, ledger reconciliation and duplicate-event tests (Stripe test mode not exercised live: no keys)."),
    gate("Failures recover as designed", ["provider_failure", "duplicates", "render_failure"].every((id) => regAll.find((s) => s.id === id)?.pass === true) ? "met" : "not measurable", "Provider failure, reconnect/duplicate and render-failure regression tests."),
  ].join("\n");

  const regTable = regAll
    .map((s) => `| ${s.scenario} | ${s.required} | ${s.pass === null ? "not run" : s.pass ? "✅ pass" : "❌ fail"} | ${s.coverage}${s.gap ? ` — ${s.gap}` : ""} | ${s.results.map((t) => `${t.status === "passed" ? "✓" : t.status === "not_run" ? "·" : "✗"} ${t.title} (${t.file.split("/").slice(-1)[0]})`).join("<br>")} |`)
    .join("\n");

  const perPattern = base
    .map((x) => `| ${x.patternId} | ${x.split} | ${x.level} | ${x.globalExpected.map((g) => g ?? "withheld").join(" / ")} | ${x.available ? (x.global ?? "withheld") : `unavailable: ${x.unavailableReason}`} | ${x.globalOk ? "✓" : "✗"}${x.falseReassurance ? " **FALSE REASSURANCE**" : ""}${x.unfairFailure ? " **UNFAIR FAILURE**" : ""} | ${x.elements.filter((e) => e.expected.status.length && !e.statusOk).map((e) => `${e.elementId}: ${e.actual?.status ?? "—"} (ref ${e.expected.status.join("|")})`).join("; ") || "—"} |`)
    .join("\n");

  return `# Evaluation report ${r.reportId}

Generated ${r.generatedAt} · code ${r.gitCommit ?? "unknown"} · profile ${r.profile.versionId}

- **Assessor under test:** ${r.assessorLabel}
- **Examiner policy under test:** ${r.examinerLabel}
- **Cases:** ${r.caseVersions.join(", ")} (fictional development fixtures with placeholder images)
- **Prompt versions:** ${Object.entries(r.promptVersions).map(([k, v]) => `${k} ${v}`).join(", ")}

## Read this first

- The human reference is the owner's approved case truth, rubric anchors and selected ratings. Status of the response-pattern reference: ${Object.entries(r.approvals).map(([k, v]) => `${k.replaceAll("_", " ")} ${v}`).join(", ")}; owner blind ratings imported for ${r.ownerRated} pattern(s). **Until the owner approves the intended judgments, "agreement with reference" below means agreement with developer-authored labels, not with the owner.**
- These are development fixtures (${all.patterns} base responses across ${all.cases} fictional cases). They are not evidence of validity with real learners, and many responses per case are not independent.
- Model agreement with a single human reference, or between models, is a consistency signal. It is not proof of clinical correctness, board endorsement or external validation.
- ${lockLine}

## Release gates (initial pilot)

| Gate | Status | Evidence |
|---|---|---|
${releaseGates}

Passing a finite test set does not prove the absence of clinical error. The owner decides whether measured performance is acceptable for a limited paid pilot.

## 1. Model-to-reference agreement

${metricsSection("Final split (locked evaluation families)", final)}
${metricsSection("Tuning split", r.metrics.tuning)}

### Stability under harmless variation (all splits)

| variant | same overall rating | same element statuses | changed |
|---|---|---|---|
${Object.entries(stab).map(([v, s]) => `| ${v} | ${frac(s.sameGlobal, s.runs)} | ${frac(s.sameElements, s.runs)} | ${s.changed.slice(0, 8).join("; ")}${s.changed.length > 8 ? ` … (+${s.changed.length - 8})` : ""} |`).join("\n") || "| (variants not run) | | | |"}

## 2. Model-to-model agreement

${all.modelToModel ? `Independent passes A and B agreed on ${frac(all.modelToModel.agreed, all.modelToModel.compared)} element statuses. Agreement between models from the same family is not independent clinical validity.` : "Not applicable in this run: the assessor under test produced a single deterministic pass (no independent model passes)."}

## 3. Owner consistency

${r.ownerConsistency.pairs ? `Duplicate items re-rated blind: same overall rating ${frac(r.ownerConsistency.sameGlobal, r.ownerConsistency.pairs)}; mean element agreement ${pct(r.ownerConsistency.elementAgreement)}.` : "No blind duplicate ratings imported yet (`pnpm evals:blind` creates a packet; `pnpm evals:import-ratings <file>` imports it)."}

## 4. Educational outcomes

Not measured. Measuring learning requires consented longitudinal learner data, which does not exist yet. Nothing in this report is an educational-outcome claim.

## 5. Examiner behaviour (simulated sessions driven by each pattern's candidate speech)

- Decisions: ${ex.reduce((a, x) => a + x.decisions, 0)} across ${ex.length} sessions (${fmt(decisionsPerCase, 1)} per case); model proposals accepted ${ex.reduce((a, x) => a + x.llmAccepted, 0)}, rejected ${ex.reduce((a, x) => a + x.llmRejected, 0)}, deterministic fallbacks ${ex.reduce((a, x) => a + x.fallbacks, 0)}.
- Neutrality (no evaluative words in exam mode): ${exNeutral.length ? `❌ ${exNeutral.length} — ${exNeutral.slice(0, 5).join("; ")}` : "✅ 0 violations"}
- Only approved text spoken: ${exUnapproved.length ? `❌ ${exUnapproved.length} — ${exUnapproved.slice(0, 5).join("; ")}` : "✅ all outputs are approved questions, replies, announcements or neutral phrases"}
- Information leakage (accepted answer concepts spoken before the candidate said them, excluding questions that declare they supply content): ${exLeaks.length ? `❌ ${exLeaks.length} — ${exLeaks.slice(0, 5).join("; ")}` : "✅ 0"}
- Forged actions (unknown alias, raw stage id, wrong alias type, unknown asset) rejected: ${frac(forged[0]!, forged[1]!)}
- Requests for unavailable/other information answered with the approved reply: ${frac(unavailOk, unavailReq)}
- Examiner spoke after a mid-thought pause: ${ex.reduce((a, x) => a + x.speechAfterMidThought, 0)}
- Policy decision latency (in-process; excludes network, endpointing, speech synthesis): p50 ${fmt(p(0.5))} ms, p95 ${fmt(p(0.95))} ms.

## 6. Regression scenarios (spec §18)

${r.regression.note}. ${regPass}/${regAll.length} scenarios passing.

| Scenario | Required outcome | Result | Coverage | Tests |
|---|---|---|---|---|
${regTable}

## 7. Latency and cost baseline

- Assessment pipeline latency per case attempt (${r.assessorLabel}): p50 ${fmt(all.latency.p50, 0)} ms, p95 ${fmt(all.latency.p95, 0)} ms.
- Measured model spend in this run: $${measuredCost.toFixed(4)}${measuredCost === 0 ? " (no external model calls)" : ""}.
- **Projected** model cost with ${r.pricingModel} at configured prices ($${price?.input ?? "?"}/M input, $${price?.output ?? "?"}/M output), from the real rendered prompts of these attempts (input tokens ≈ characters/3.8) and assumed output sizes (extractor ${OUT.evidence_extractor}, each assessor ${OUT.assessor_a}, adjudicator ${OUT.adjudicator} on ~30% of attempts, examiner ${OUT.examiner} per decision):
  - Mean prompt sizes: extractor ${fmt(avg("evidence_extractor"), 0)} tokens, assessor ${fmt(avg("assessor_a"), 0)} tokens, examiner ${fmt(avgExTok, 0)} tokens/decision.
  - Assessment ≈ $${assessCase !== null ? assessCase.toFixed(3) : "?"} per case; LLM examiner ≈ $${examCase !== null ? examCase.toFixed(3) : "?"} per case.
  - Per completed station (${r.casesPerStation} cases): ≈ $${assessCase !== null && examCase !== null ? ((assessCase + examCase) * r.casesPerStation).toFixed(2) : "?"} excluding speech recognition/synthesis, storage and hosting. Projections, not invoices: reconcile against provider billing once live.

## Appendix: per-response results (base variant)

| response | split | level | reference overall | assessed | ok | element mismatches |
|---|---|---|---|---|---|---|
${perPattern}
`;
}
