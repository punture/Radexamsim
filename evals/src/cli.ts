import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ABR_NEURO_PROFILE } from "@sim/clinical-content";
import { AnthropicProvider, promptVersions } from "@sim/ai";
import { buildBlindPacket, importRatings, loadOwnerReference } from "./blind";
import { simulateExaminer, type ExaminerProposerConfig } from "./examiner-sim";
import { gitCommit, logRun, verifyLock, writeLock } from "./lock";
import { computeMetrics } from "./metrics";
import { runRegression } from "./regression";
import { renderReport } from "./report";
import { runAssessmentSuite, type AssessorConfig } from "./runner";
import { ALL_PATTERNS, APPROVALS_FILE, REPORTS_DIR, approvalStatus, evalCases, loadApprovals, patternHash, splitForFamily } from "./suites";
import type { ApprovalRecord, Variant } from "./types";

const args = process.argv.slice(2);
const cmd = args[0] ?? "run";
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};

async function run(): Promise<void> {
  const cases = evalCases();
  const profile = ABR_NEURO_PROFILE;
  const variants = opt("variants", "base,rephrased,verbose,asr_noisy").split(",") as Variant[];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const wantLlm = flag("llm");
  if (wantLlm && !apiKey) throw new Error("--llm requested but ANTHROPIC_API_KEY is not set; refusing to label a baseline run as a model run.");
  // External processing guard: only fictional fixtures or cases cleared for external AI.
  const blocked = [...cases.values()].filter((c) => !c.isDevelopmentFixture && !c.clearances.externalAiProcessingAllowed);
  if (wantLlm && blocked.length) throw new Error(`external AI processing not permitted for: ${blocked.map((c) => c.caseId).join(", ")}`);
  const provider = wantLlm ? new AnthropicProvider({ apiKey: apiKey!, enableServerSideFallbacks: true }) : null;
  const def = process.env.MODEL_DEFAULT ?? "claude-opus-5-5";
  const models = {
    extractor: process.env.MODEL_EVIDENCE_EXTRACTOR ?? def,
    assessorA: process.env.MODEL_ASSESSOR_A ?? def,
    assessorB: process.env.MODEL_ASSESSOR_B ?? def,
    adjudicator: process.env.MODEL_ADJUDICATOR ?? def,
  };
  const assessor: AssessorConfig = provider ? { kind: "llm", provider, models } : { kind: "baseline" };
  const examiner: ExaminerProposerConfig = provider && flag("llm-examiner") ? { kind: "llm", provider, model: process.env.MODEL_LIVE_EXAMINER ?? def } : { kind: "deterministic" };
  const lock = verifyLock(cases);

  console.log(`Running ${ALL_PATTERNS.length} patterns × ${variants.length} variants with ${assessor.kind === "llm" ? `model assessor (${JSON.stringify(models)})` : "the labelled dev baseline assessor"}…`);
  const records = await runAssessmentSuite(ALL_PATTERNS, cases, profile, assessor, variants);
  const examinerResults = [];
  for (const p of ALL_PATTERNS) examinerResults.push(await simulateExaminer(p, cases.get(p.caseId)!, profile, examiner));
  console.log("Running mapped regression tests…");
  const regression = runRegression({ skip: flag("skip-regression") });

  const approvals = loadApprovals();
  const approvalCounts: Record<string, number> = {};
  for (const p of ALL_PATTERNS) {
    const s = approvalStatus(p, approvals);
    approvalCounts[s] = (approvalCounts[s] ?? 0) + 1;
  }
  const owner = loadOwnerReference();
  const reportId = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "").replace(/-/g, "")}-${assessor.kind}`;
  const input = {
    reportId,
    generatedAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    assessorLabel: assessor.kind === "llm" ? `model assessor — extractor ${models.extractor}, A ${models.assessorA}, B ${models.assessorB}, adjudicator ${models.adjudicator}` : "development baseline (deterministic lexical matcher; NOT a clinical assessor; refused in production)",
    assessorIsProductionCandidate: assessor.kind === "llm",
    examinerLabel: examiner.kind === "llm" ? `model examiner ${examiner.model} with deterministic fallback` : "deterministic approved-question policy (used when no examiner model is configured)",
    promptVersions: promptVersions(),
    caseVersions: [...cases.values()].map((c) => c.versionId),
    approvals: approvalCounts,
    ownerRated: owner.reference.size,
    ownerConsistency: owner.consistency,
    lock,
    metrics: {
      all: computeMetrics(records, owner.reference),
      tuning: computeMetrics(records.filter((r) => r.split === "tuning"), owner.reference),
      final: computeMetrics(records.filter((r) => r.split === "final"), owner.reference),
    },
    records,
    examiner: examinerResults,
    regression,
    profile,
    casesPerStation: Math.min(profile.station.maxCases, Math.max(profile.station.minCases, 3)),
    pricingModel: models.assessorA,
  };
  const md = renderReport(input);
  mkdirSync(REPORTS_DIR, { recursive: true });
  const json = JSON.stringify({ ...input, records: records.map(({ telemetry, ...r }) => ({ ...r, telemetryCalls: telemetry.length })) }, null, 2);
  writeFileSync(path.join(REPORTS_DIR, `${reportId}.md`), md);
  writeFileSync(path.join(REPORTS_DIR, `${reportId}.json`), json);
  writeFileSync(path.join(REPORTS_DIR, "latest.md"), md);
  writeFileSync(path.join(REPORTS_DIR, "latest.json"), json);
  logRun({ at: input.generatedAt, lockedAt: lock.state === "not_locked" ? null : lock.lockedAt, finalEvaluated: true, assessor: assessor.kind, examiner: examiner.kind, gitCommit: input.gitCommit, reportId });
  const f = input.metrics.final;
  console.log(`Report: evals/reports/${reportId}.md (also latest.md)`);
  console.log(`Final split: overall within range ${f.global.withinRange}/${f.patterns}; false reassurance ${f.safety.falseReassurance.length}/${f.safety.mustNotPass}; unfair failure ${f.safety.unfairFailure.length}/${f.safety.referencePassing}; regression ${regression.scenarios.filter((s) => s.pass).length}/${regression.scenarios.length}.`);
}

function approveAnchors(): void {
  // Owner-only: records the owner's approval of intended judgments, bound to content hashes.
  const attestation = opt("owner-attestation", "");
  if (attestation.length < 20) throw new Error('approval requires --owner-attestation "<your statement that you reviewed these anchors>" (owner only)');
  const ids = opt("ids", "").split(",").filter(Boolean);
  if (!ids.length) throw new Error("--ids a,b,c required");
  const approvals = loadApprovals();
  for (const id of ids) {
    const p = ALL_PATTERNS.find((x) => x.id === id);
    if (!p) throw new Error(`unknown pattern ${id}`);
    const rec: ApprovalRecord = { patternId: id, status: flag("reject") ? "owner_rejected" : "owner_approved", contentHash: patternHash(p), approvedOn: new Date().toISOString().slice(0, 10), notes: `${attestation}${opt("notes", "") ? ` — ${opt("notes", "")}` : ""}` };
    approvals.set(id, rec);
  }
  mkdirSync(path.dirname(APPROVALS_FILE), { recursive: true });
  writeFileSync(APPROVALS_FILE, `${JSON.stringify([...approvals.values()].sort((a, b) => a.patternId.localeCompare(b.patternId)), null, 2)}\n`);
  console.log(`Recorded ${ids.length} decision(s) in ${APPROVALS_FILE}`);
}

async function main(): Promise<void> {
  switch (cmd) {
    case "run":
      return run();
    case "lock": {
      const m = writeLock(evalCases());
      console.log(`Locked ${Object.keys(m.patterns).length} final-split patterns and ${Object.keys(m.cases).length} case version(s) (${m.finalFamilies.join(", ")}).`);
      return;
    }
    case "blind-packet": {
      const r = buildBlindPacket(ALL_PATTERNS, evalCases(), { sample: Number(opt("sample", "12")), duplicates: Number(opt("duplicates", "3")), seed: Number(opt("seed", String(Date.now() % 100000))) });
      console.log(`Blind packet with ${r.items} items: ${r.htmlPath}\nAnswer key (do not open before rating): ${r.keyPath}`);
      return;
    }
    case "import-ratings": {
      const file = args[1];
      if (!file || !existsSync(file)) throw new Error("usage: import-ratings <ratings.json>");
      const r = importRatings(file);
      console.log(`Imported ${r.rated} ratings from ${r.packetId} → ${r.stored}; duplicate pairs: ${r.duplicatePairs.length}`);
      return;
    }
    case "approve-anchors":
      return approveAnchors();
    case "list": {
      const cases = evalCases();
      const approvals = loadApprovals();
      for (const p of ALL_PATTERNS) console.log(`${p.id.padEnd(36)} ${splitForFamily(cases.get(p.caseId)!.caseFamilyId).padEnd(7)} ${p.level.padEnd(20)} ${approvalStatus(p, approvals)}`);
      return;
    }
    default:
      console.log(readFileSync(new URL("../README.md", import.meta.url), "utf8"));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
