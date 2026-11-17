# Evaluation harness

Reproducible evaluation of the assessment pipeline, the live examiner policy, and the required software regression scenarios. The human reference is the owner's approved case truth, rubric anchors and selected ratings. LLM faculty and automated checks help the owner decide; they never certify clinical validity.

## Commands (from the repository root)

```bash
pnpm evals                       # run everything, write evals/reports/<id>.md and latest.md
pnpm evals -- --skip-regression  # skip the mapped vitest run (e.g. no PostgreSQL)
pnpm evals -- --variants base    # base responses only (no stability variants)
pnpm evals -- --llm              # use the configured model assessor (needs ANTHROPIC_API_KEY, or LLM_PROVIDER=gemini with GEMINI_API_KEY; spends money)
pnpm evals -- --llm --llm-examiner
pnpm evals:lock                  # lock the final split (do this BEFORE judging a change)
pnpm evals:blind -- --sample 12 --duplicates 3
pnpm evals:import-ratings evals/owner-ratings/<packet>-ratings.json
pnpm --filter @sim/evals exec tsx src/cli.ts list
```

A model run sends only fictional fixture text, or text from cases whose `externalAiProcessingAllowed` clearance is set. It never sends images. The CLI refuses `--llm` without a key rather than labelling a baseline run as a model run.

## What is evaluated

| Area | How |
|---|---|
| Clinical correctness, accepted alternatives | Element status vs acceptable statuses; behaviour tags |
| False reassurance | `mustNotPass` responses rated meets_expected or better |
| Unfair failure | Reference-passing responses rated below_expected/unsafe; elements failed although demonstrated |
| Evidence-span validity | Every cited quote re-validated against the transcript |
| Omission-opportunity validity | `not_demonstrated` only with an assessable opportunity |
| Prompt dependence | Expected prompting level and credit (e.g. examiner-supplied → no credit) |
| Negation, laterality, uncertainty, self-correction | Tagged edge-case responses |
| Stability | `rephrased`, `verbose`, `asr_noisy` variants vs base |
| Abstention | Uncertain/not-assessable counts reported alongside accuracy |
| Examiner neutrality, leakage, follow-ups, stage control | Simulated sessions driven by each response's candidate speech through the real menu → proposal → validation → fallback path, plus forged proposals at every decision |
| Regression scenarios (spec §18 table) | Mapped tests run with the JSON reporter; coverage stated per scenario |
| Latency and cost | Measured pipeline/policy latency; projected model cost from the real rendered prompts and configured prices |

Statistics: within-range accuracy with Wilson intervals, linear and quadratic weighted kappa with a case-cluster bootstrap interval, confusion matrices. All have denominators. Many responses to one case are not independent learners.

## Reference labels and approval

`src/patterns/*.ts` holds approximately five response patterns per fixture case: strong, satisfactory, borderline, poor, and a consequential-error or uncertainty variant. There are also edge cases for negation, laterality, self-correction, examiner-supplied content, render failure, unavailable requests, low-confidence ASR, prompt injection and an interrupted question. Each lists *acceptable* statuses (the first is the reference label) so defensible alternatives are not penalized.

These intended judgments are **developer-authored and pending owner approval**. The report says so on every run. Only the owner approves anchors:

```bash
pnpm --filter @sim/evals exec tsx src/cli.ts approve-anchors --ids stroke.strong.a,stroke.poor.a \
  --owner-attestation "I reviewed these responses and their intended judgments against the approved rubric"
```

An approval binds to a hash of the pattern. Any later edit makes it `approval_stale`.

## Blind owner ratings and consistency

`pnpm evals:blind` writes a self-contained HTML packet to `owner-ratings/packets/`. It contains transcripts, the approved rubric and the case truth, and no AI result or intended label. It also contains a few items repeated later under new labels. The answer key is a separate file; do not open it before rating. The packet's button downloads your ratings as JSON. `pnpm evals:import-ratings <file>` joins them with the key. After import, your blind ratings replace the developer labels as the reference for those responses, and the report adds owner intra-rater consistency on the duplicates.

## Locked final split

Tuning and final inputs are separated by **case family**, not by response. See `SPLIT_OVERRIDES` in `src/suites.ts`; new families are assigned by a stable hash, about 30% final. `pnpm evals:lock` hashes the final split's responses and case content into `locked/manifest.json`. Every run verifies the lock and appends to `locked/run-log.jsonl`. The report flags a violated lock, and flags repeated evaluation of the final split, so it cannot be presented as unseen validation after tuning. Re-lock only when you intentionally start a new evaluation round.

## Adding consented real attempts

Add real spoken attempts only with the learner's consent, and only after case approval. They are valuable for hesitation, interruptions, self-correction, accents, noise and clinically important ASR errors. Record them as patterns: transcript segments with provider confidence, and examiner turns by approved id. Rate them blind first, and keep them in the split of their case family.

## Reading results

A report has four separate sections:

1. **Model-to-reference agreement:** against the developer labels until the owner approves them or rates blind.
2. **Model-to-model agreement:** only when two independent model passes ran.
3. **Owner consistency.**
4. **Educational outcomes:** not measured; no claim is made.

The development baseline assessor is a lexical stand-in for local development and is refused in production. Its numbers show what the harness detects. They are not the product's assessment quality.
