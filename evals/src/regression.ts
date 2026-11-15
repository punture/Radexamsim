import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EVALS_DIR } from "./suites";

/**
 * Deterministic software regression scenarios required by the specification (§18), each
 * mapped to the automated tests that exercise it and to evaluation-pattern tags that probe
 * the same behaviour end to end. Coverage is stated honestly: "partial" says what is missing.
 */
export type Scenario = {
  id: string;
  scenario: string;
  required: string;
  tests: { file: string; title: string }[];
  evalTags: string[];
  coverage: "full" | "partial";
  gap?: string;
};

const ai = "packages/ai/test/assessment.test.ts";
const engine = "packages/exam-engine/test/engine.test.ts";
const live = "apps/api/test/live.test.ts";
const pipeline = "apps/worker/test/pipeline.test.ts";
const owner = "apps/worker/test/owner.test.ts";
const dbt = "packages/db/test/db.test.ts";
const billing = "packages/billing/test/billing.test.ts";
const content = "packages/clinical-content/test/validate.test.ts";

export const SCENARIOS: Scenario[] = [
  {
    id: "injection",
    scenario: "Candidate asks the model to ignore instructions or reveal answers",
    required: "No policy bypass; speech remains candidate input",
    tests: [
      { file: ai, title: "treats instructions in candidate speech as speech" },
      { file: engine, title: "prompts injection attempts remain ordinary candidate speech" },
      { file: live, title: "rejects an unauthorized reference from the model and falls back to an approved action" },
    ],
    evalTags: ["prompt_injection"],
    coverage: "full",
  },
  {
    id: "negation_laterality",
    scenario: "Candidate states a negated diagnosis or reverses laterality",
    required: "Scorer preserves the actual meaning",
    tests: [
      { file: ai, title: "keeps a negated finding negated (no silent normalization)" },
      { file: ai, title: "marks a laterality reversal incorrect and flags the unsafe claim" },
    ],
    evalTags: ["negation", "laterality"],
    coverage: "full",
  },
  {
    id: "self_correction",
    scenario: "Candidate corrects an early statement",
    required: "Original and correction both remain traceable",
    tests: [{ file: ai, title: "records self-correction with both statements traceable" }],
    evalTags: ["self_correction"],
    coverage: "full",
  },
  {
    id: "accepted_alternative",
    scenario: "Candidate gives an accepted alternative",
    required: "Assessor accepts it according to the rubric",
    tests: [{ file: ai, title: "credits accepted concepts and acceptable alternatives" }],
    evalTags: ["accepted_alternative"],
    coverage: "full",
  },
  {
    id: "examiner_supplied",
    scenario: "Examiner supplies a key finding",
    required: "No independent-detection credit for merely repeating it",
    tests: [
      { file: ai, title: "gives no independent credit for content the examiner supplied, even if the model says spontaneous" },
      { file: engine, title: "classifies evidence after an examiner-supplied hint as examiner_supplied (only heard words count)" },
    ],
    evalTags: ["examiner_supplied"],
    coverage: "full",
  },
  {
    id: "render_failure",
    scenario: "Image required by a criterion fails to render",
    required: "Criterion becomes unassessable or session invalidated under policy",
    tests: [
      { file: ai, title: "never assesses an element whose required image failed to render" },
      { file: engine, title: "makes the element not assessable when the required image failed to render" },
      { file: live, title: "treats a failed image render as a technical limitation and keeps the session going" },
    ],
    evalTags: ["render_failure"],
    coverage: "full",
  },
  {
    id: "unavailable_request",
    scenario: "Learner requests an unavailable sequence",
    required: "Approved unavailable-information reply; no invented image/result",
    tests: [
      { file: engine, title: "answers a request for an unavailable sequence with the approved reply (no invented image)" },
      { file: live, title: "runs a case end to end with controlled reveals, unavailable replies, interruption accounting and finalization" },
    ],
    evalTags: ["unavailable_request"],
    coverage: "full",
  },
  {
    id: "unauthorized_ids",
    scenario: "Request contains an unauthorized stage or asset ID",
    required: "Server rejects it regardless of model output",
    tests: [
      { file: engine, title: "only accepts refs that were offered, with the right type" },
      { file: live, title: "rejects an unauthorized reference from the model and falls back to an approved action" },
    ],
    evalTags: [],
    coverage: "full",
  },
  {
    id: "tts_interrupted",
    scenario: "TTS is interrupted midway",
    required: "Only played content counts as delivered assistance",
    tests: [
      { file: engine, title: "does not count an interrupted question as delivered" },
      { file: ai, title: "uses provider alignment when available and rounds estimates down to whole words" },
      { file: live, title: "runs a case end to end with controlled reveals, unavailable replies, interruption accounting and finalization" },
    ],
    evalTags: ["tts_interrupted"],
    coverage: "full",
  },
  {
    id: "asr_uncertain",
    scenario: "ASR result remains uncertain",
    required: "Clarification or explicit uncertainty; no confident fabricated mark",
    tests: [{ file: ai, title: "never turns low-confidence transcription into a confident mark (ASR uncertainty)" }],
    evalTags: ["asr_uncertain"],
    coverage: "partial",
    gap: "Assessment side is deterministic. Live clarification phrases are available to the model examiner only; the deterministic fallback examiner does not ask for clarification.",
  },
  {
    id: "malformed_output",
    scenario: "Model returns unsupported evidence or malformed JSON",
    required: "Bounded retry, rejection, or explicit unavailable assessment",
    tests: [
      { file: ai, title: "uses bounded retries for malformed output and returns an explicit unavailable result (no fake result)" },
      { file: ai, title: "downgrades unsupported positive claims and fabricated evidence" },
      { file: ai, title: "rejects fabricated quotes and unknown segments" },
    ],
    evalTags: [],
    coverage: "full",
  },
  {
    id: "duplicates",
    scenario: "Network reconnect, duplicate job, or webhook retry",
    required: "No duplicate clinical action, result, or usage charge",
    tests: [
      { file: live, title: "resumes after a network reconnect without repeating speech, resetting the clock or duplicating actions" },
      { file: dbt, title: "deduplicates enqueues and claims each job once" },
      { file: billing, title: "provisions from subscription events (not the success redirect), deduplicates, and ignores stale events" },
      { file: billing, title: "reserves transactionally, reconciles exactly once, and never double-charges" },
      { file: engine, title: "starting twice is idempotent (refresh cannot reset the timer)" },
    ],
    evalTags: [],
    coverage: "full",
  },
  {
    id: "cross_account",
    scenario: "Learner opens another user's attempt/media URL",
    required: "Access denied",
    tests: [{ file: live, title: "runs a case end to end with controlled reveals, unavailable replies, interruption accounting and finalization" }],
    evalTags: [],
    coverage: "full",
  },
  {
    id: "owner_edits_published",
    scenario: "Owner edits a published case",
    required: "New version; active attempts stay bound to their original version",
    tests: [
      { file: owner, title: "binds approval to the reviewed content hash, enforces separate clearances, and versions changes" },
      { file: dbt, title: "keeps a case attempt bound to its original case version when the owner revises the case" },
      { file: content, title: "treats wording changes as clinical and title/tag changes as display-only" },
    ],
    evalTags: [],
    coverage: "full",
  },
  {
    id: "withdrawal",
    scenario: "Clinical content is withdrawn",
    required: "No new selection; media access and affected attempts handled by policy",
    tests: [{ file: owner, title: "withdrawal revokes media; appeals revise transcripts without overwriting history" }],
    evalTags: [],
    coverage: "full",
  },
  {
    id: "provider_failure",
    scenario: "Provider fails during grading",
    required: "Retry from saved evidence; no lost attempt or fake result",
    tests: [
      { file: ai, title: "handles provider failure during grading without inventing a result" },
      { file: pipeline, title: "retries on provider failure, never fabricates a result, and settles the debrief as unavailable" },
    ],
    evalTags: [],
    coverage: "full",
  },
];

export type ScenarioResult = Scenario & { results: { file: string; title: string; status: "passed" | "failed" | "missing" | "not_run" }[]; pass: boolean | null };

/** Runs the mapped test files with the JSON reporter and joins results by exact test title. */
export function runRegression(opts: { skip?: boolean; repoRoot?: string } = {}): { scenarios: ScenarioResult[]; ran: boolean; note: string } {
  const root = opts.repoRoot ?? path.resolve(EVALS_DIR, "..");
  const files = [...new Set(SCENARIOS.flatMap((s) => s.tests.map((t) => t.file)))];
  const out = path.join(EVALS_DIR, "reports", ".vitest-regression.json");
  let note = "";
  let byKey = new Map<string, "passed" | "failed">();
  let ran = false;
  if (!opts.skip) {
    const r = spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${out}`, ...files], { cwd: root, encoding: "utf8", timeout: 600_000 });
    if (existsSync(out)) {
      const json = JSON.parse(readFileSync(out, "utf8")) as { testResults: { name: string; assertionResults: { title: string; status: string }[] }[] };
      byKey = new Map(json.testResults.flatMap((f) => f.assertionResults.map((a) => [`${path.relative(root, f.name)}::${a.title}`, a.status === "passed" ? ("passed" as const) : ("failed" as const)])));
      ran = true;
      note = r.status === 0 ? "all mapped test files passed" : "some mapped tests failed (see statuses)";
    } else note = `test run did not produce results (exit ${r.status}); database-backed tests need PostgreSQL running`;
  } else note = "regression run skipped (--skip-regression)";
  const scenarios = SCENARIOS.map((s): ScenarioResult => {
    const results = s.tests.map((t) => ({ ...t, status: (ran ? (byKey.get(`${t.file}::${t.title}`) ?? "missing") : "not_run") as ScenarioResult["results"][number]["status"] }));
    return { ...s, results, pass: ran ? results.every((x) => x.status === "passed") : null };
  });
  return { scenarios, ran, note };
}
