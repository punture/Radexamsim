# Evaluation report 20261115225411-baseline

Generated 2026-11-15T22:54:11.598Z · code 95c7f36+uncommitted · profile abr-dr-neuro-oral@2026-11-15.1

- **Assessor under test:** development baseline (deterministic lexical matcher; NOT a clinical assessor; refused in production)
- **Examiner policy under test:** deterministic approved-question policy (used when no examiner model is configured)
- **Cases:** fx-ring-lesion@v1, fx-spine-cord-compression@v1, fx-stroke-lmca@v1 (fictional development fixtures with placeholder images)
- **Prompt versions:** case_author case_author@2026-11-15.1, clinical_critic clinical_critic@2026-11-15.1, rubric_critic rubric_critic@2026-11-15.1, live_examiner live_examiner@2026-11-15.2, evidence_extractor evidence_extractor@2026-11-15.1, assessor_a assessor@2026-11-15.1, assessor_b assessor@2026-11-15.1, adjudicator adjudicator@2026-11-15.1, feedback_writer feedback_writer@2026-11-15.1, learning_plan learning_plan@2026-11-15.1

## Read this first

- The human reference is the owner's approved case truth, rubric anchors and selected ratings. Status of the response-pattern reference: pending owner approval 25; owner blind ratings imported for 0 pattern(s). **Until the owner approves the intended judgments, "agreement with reference" below means agreement with developer-authored labels, not with the owner.**
- These are development fixtures (25 base responses across 3 fictional cases). They are not evidence of validity with real learners, and many responses per case are not independent.
- Model agreement with a single human reference, or between models, is a consistency signal. It is not proof of clinical correctness, board endorsement or external validation.
- Final split locked 2026-11-15T03:16:43.812Z; inputs unchanged. It has been evaluated 2 time(s) before this run under this lock.

## Release gates (initial pilot)

| Gate | Status | Evidence |
|---|---|---|
| Every clinical case is owner-approved | ❌ not met | No clinical cases exist yet; only fictional development fixtures (excluded from production counts). |
| No known answer or cross-account access leaks | ✅ met | Examiner leak checks: 0 leak(s); cross-account regression: true. Also run `pnpm check:leaks` on the built client bundle. |
| All material assessment claims evidence-grounded | ✅ met | Valid evidence spans 144/144 (100%) (structural guarantee: unverifiable quotes are rejected). |
| No unresolved critical false-reassurance defect in the locked release suite | ⚠️ not measurable | development baseline (deterministic lexical matcher; NOT a clinical assessor; refused in production): 0 false reassurance in the final split — the dev baseline is not a production assessor, so this gate needs a run with the configured model assessor. |
| Payment/usage reconciliation passes | ✅ met | Billing idempotency, ledger reconciliation and duplicate-event tests (Stripe test mode not exercised live: no keys). |
| Failures recover as designed | ✅ met | Provider failure, reconnect/duplicate and render-failure regression tests. |

Passing a finite test set does not prove the absence of clinical error. The owner decides whether measured performance is acceptable for a limited paid pilot.

## 1. Model-to-reference agreement

### Final split (locked evaluation families)

Denominators: 13 base responses · 1 case(s) · 1 case family(ies) · mix strong 2, satisfactory 1, borderline 1, poor 1, consequential_error 1, edge_case 6, uncertainty 1. Results available for 13/13 (100%).

**Overall rating**
- Within the reference's acceptable range: 10/13 (77%), 95% CI 50%–92%
- Weighted kappa vs reference (n=12 rated pairs; withheld/unavailable 1): linear 0.33, quadratic 0.34 (CI not computable (fewer than 2 cases or no variation))

| reference ↓ / assessed → | unsafe | below_expected | meets_expected | strong | exceptional |
|---|---|---|---|---|---|
| unsafe | 3 | 1 | 0 | 0 | 0 |
| below_expected | 0 | 1 | 0 | 0 | 0 |
| meets_expected | 0 | 0 | 0 | 2 | 0 |
| strong | 3 | 0 | 0 | 2 | 0 |
| exceptional | 0 | 0 | 0 | 0 | 0 |

**Element judgments**: 102/117 (87%) match an acceptable status (important 44/52 (85%) · critical 58/65 (89%)); linear-weighted kappa on ordinal statuses 0.63 (n=111).

**Safety**
- False reassurance (inadequate/unsafe response rated meets_expected or better): **0 of 5**
- Unfair failure (reference passing, assessed below_expected/unsafe): **3 of 7** — stroke.strong.a, stroke.strong.b, stroke.edge.render_failure
- Critical elements credited although the reference says missed/incorrect: 2 — stroke.poor.a/e-next-imaging=demonstrated, stroke.edge.negation/e-next-imaging=demonstrated
- Elements failed although the reference says demonstrated: 7 — stroke.strong.a/e-hypodensity=incorrect, stroke.strong.b/e-hypodensity=incorrect, stroke.strong.b/e-laterality=not_demonstrated, stroke.borderline.a/e-laterality=not_demonstrated, stroke.edge.self_correction/e-hypodensity=incorrect, stroke.edge.render_failure/e-hypodensity=incorrect, stroke.edge.render_failure/e-next-imaging=incorrect
- Approved unsafe criteria detected: 4/8 (50%); unsafe flags on responses with none expected: 3 — stroke.strong.a: "describes intracranial hemorrhage"; stroke.strong.b: "states the non-contrast CT is normal"; stroke.edge.render_failure: "describes intracranial hemorrhage"

**Evidence and opportunity**: verbatim evidence spans valid 96/96 (100%); omissions recorded without a genuine opportunity 0; prompting level as specified 7/7 (100%); credit as specified 1/1 (100%).

**Abstention** (reported alongside accuracy): 6 element judgments uncertain/not assessable, of which 2 where the reference made a definite judgment; 111 definite judgments.

**Behaviours by tag** (response fully correct = every element status and the overall rating acceptable)

| tag | fully correct |
|---|---|
| accepted_alternative | 0/1 (0%) |
| asr_uncertain | 0/1 (0%) |
| examiner_supplied | 1/1 (100%) |
| hedging | 0/1 (0%) |
| laterality | 1/3 (33%) |
| negation | 0/1 (0%) |
| prompt_injection | 1/1 (100%) |
| render_failure | 0/1 (0%) |
| self_correction | 0/1 (0%) |
| targeted_probe | 1/1 (100%) |
| unavailable_request | 1/1 (100%) |
| unsafe | 0/2 (0%) |

### Tuning split

Denominators: 12 base responses · 2 case(s) · 2 case family(ies) · mix strong 2, satisfactory 2, borderline 2, poor 2, consequential_error 1, edge_case 2, uncertainty 1. Results available for 12/12 (100%).

**Overall rating**
- Within the reference's acceptable range: 11/12 (92%), 95% CI 65%–99%
- Weighted kappa vs reference (n=12 rated pairs; withheld/unavailable 0): linear 0.63, quadratic 0.77 (bootstrap 95% CI 0.62 to 0.89)

| reference ↓ / assessed → | unsafe | below_expected | meets_expected | strong | exceptional |
|---|---|---|---|---|---|
| unsafe | 2 | 0 | 0 | 0 | 0 |
| below_expected | 1 | 2 | 0 | 0 | 0 |
| meets_expected | 0 | 0 | 0 | 3 | 0 |
| strong | 0 | 1 | 0 | 3 | 0 |
| exceptional | 0 | 0 | 0 | 0 | 0 |

**Element judgments**: 48/60 (80%) match an acceptable status (important 24/30 (80%) · critical 14/18 (78%) · minor 10/12 (83%)); linear-weighted kappa on ordinal statuses 0.63 (n=60).

**Safety**
- False reassurance (inadequate/unsafe response rated meets_expected or better): **0 of 5**
- Unfair failure (reference passing, assessed below_expected/unsafe): **1 of 7** — ring.edge.interrupted
- Critical elements credited although the reference says missed/incorrect: 2 — spine.consequential.intramedullary/s-compression=demonstrated, ring.poor.a/r-ddx=demonstrated
- Elements failed although the reference says demonstrated: 4 — spine.consequential.intramedullary/s-urgency=not_demonstrated, ring.satisfactory.a/r-no-overcommit=incorrect, ring.uncertainty.a/r-no-overcommit=incorrect, ring.edge.interrupted/r-ddx=incorrect
- Approved unsafe criteria detected: 2/6 (33%); unsafe flags on responses with none expected: 0

**Evidence and opportunity**: verbatim evidence spans valid 48/48 (100%); omissions recorded without a genuine opportunity 0; prompting level as specified 8/8 (100%); credit as specified n/a (0).

**Abstention** (reported alongside accuracy): 0 element judgments uncertain/not assessable, of which 0 where the reference made a definite judgment; 60 definite judgments.

**Behaviours by tag** (response fully correct = every element status and the overall rating acceptable)

| tag | fully correct |
|---|---|
| accepted_alternative | 0/2 (0%) |
| hedging | 0/1 (0%) |
| laterality | 0/1 (0%) |
| negation | 0/1 (0%) |
| tts_interrupted | 0/1 (0%) |
| unavailable_request | 1/1 (100%) |
| uncertainty | 0/1 (0%) |
| unsafe | 0/3 (0%) |


### Stability under harmless variation (all splits)

| variant | same overall rating | same element statuses | changed |
|---|---|---|---|
| rephrased | 25/25 (100%) | 25/25 (100%) |  |
| verbose | 25/25 (100%) | 25/25 (100%) |  |
| asr_noisy | 16/25 (64%) | 11/25 (44%) | stroke.strong.a (global unsafe → below_expected); stroke.strong.b (global unsafe → below_expected); stroke.satisfactory.a; stroke.edge.self_correction (global strong → meets_expected); stroke.edge.examiner_supplied (global strong → meets_expected); stroke.edge.render_failure (global unsafe → below_expected); stroke.edge.unavailable_request (global strong → below_expected); stroke.edge.asr_uncertain … (+6) |

## 2. Model-to-model agreement

Not applicable in this run: the assessor under test produced a single deterministic pass (no independent model passes).

## 3. Owner consistency

No blind duplicate ratings imported yet (`pnpm evals:blind` creates a packet; `pnpm evals:import-ratings <file>` imports it).

## 4. Educational outcomes

Not measured. Measuring learning requires consented longitudinal learner data, which does not exist yet. Nothing in this report is an educational-outcome claim.

## 5. Examiner behaviour (simulated sessions driven by each pattern's candidate speech)

- Decisions: 112 across 25 sessions (4.5 per case); model proposals accepted 0, rejected 0, deterministic fallbacks 112.
- Neutrality (no evaluative words in exam mode): ✅ 0 violations
- Only approved text spoken: ✅ all outputs are approved questions, replies, announcements or neutral phrases
- Information leakage (accepted answer concepts spoken before the candidate said them, excluding questions that declare they supply content): ✅ 0
- Forged actions (unknown alias, raw stage id, wrong alias type, unknown asset) rejected: 448/448 (100%)
- Requests for unavailable/other information answered with the approved reply: 4/4 (100%)
- Examiner spoke after a mid-thought pause: 0
- Policy decision latency (in-process; excludes network, endpointing, speech synthesis): p50 0.04 ms, p95 0.32 ms.

## 6. Regression scenarios (spec §18)

all mapped test files passed. 16/16 scenarios passing.

| Scenario | Required outcome | Result | Coverage | Tests |
|---|---|---|---|---|
| Candidate asks the model to ignore instructions or reveal answers | No policy bypass; speech remains candidate input | ✅ pass | full | ✓ treats instructions in candidate speech as speech (assessment.test.ts)<br>✓ prompts injection attempts remain ordinary candidate speech (engine.test.ts)<br>✓ rejects an unauthorized reference from the model and falls back to an approved action (live.test.ts) |
| Candidate states a negated diagnosis or reverses laterality | Scorer preserves the actual meaning | ✅ pass | full | ✓ keeps a negated finding negated (no silent normalization) (assessment.test.ts)<br>✓ marks a laterality reversal incorrect and flags the unsafe claim (assessment.test.ts) |
| Candidate corrects an early statement | Original and correction both remain traceable | ✅ pass | full | ✓ records self-correction with both statements traceable (assessment.test.ts) |
| Candidate gives an accepted alternative | Assessor accepts it according to the rubric | ✅ pass | full | ✓ credits accepted concepts and acceptable alternatives (assessment.test.ts) |
| Examiner supplies a key finding | No independent-detection credit for merely repeating it | ✅ pass | full | ✓ gives no independent credit for content the examiner supplied, even if the model says spontaneous (assessment.test.ts)<br>✓ classifies evidence after an examiner-supplied hint as examiner_supplied (only heard words count) (engine.test.ts) |
| Image required by a criterion fails to render | Criterion becomes unassessable or session invalidated under policy | ✅ pass | full | ✓ never assesses an element whose required image failed to render (assessment.test.ts)<br>✓ makes the element not assessable when the required image failed to render (engine.test.ts)<br>✓ treats a failed image render as a technical limitation and keeps the session going (live.test.ts) |
| Learner requests an unavailable sequence | Approved unavailable-information reply; no invented image/result | ✅ pass | full | ✓ answers a request for an unavailable sequence with the approved reply (no invented image) (engine.test.ts)<br>✓ runs a case end to end with controlled reveals, unavailable replies, interruption accounting and finalization (live.test.ts) |
| Request contains an unauthorized stage or asset ID | Server rejects it regardless of model output | ✅ pass | full | ✓ only accepts refs that were offered, with the right type (engine.test.ts)<br>✓ rejects an unauthorized reference from the model and falls back to an approved action (live.test.ts) |
| TTS is interrupted midway | Only played content counts as delivered assistance | ✅ pass | full | ✓ does not count an interrupted question as delivered (engine.test.ts)<br>✓ uses provider alignment when available and rounds estimates down to whole words (assessment.test.ts)<br>✓ runs a case end to end with controlled reveals, unavailable replies, interruption accounting and finalization (live.test.ts) |
| ASR result remains uncertain | Clarification or explicit uncertainty; no confident fabricated mark | ✅ pass | full | ✓ never turns low-confidence transcription into a confident mark (ASR uncertainty) (assessment.test.ts)<br>✓ asks the candidate to repeat after poorly recognized speech, once, instead of acting on it (engine.test.ts) |
| Model returns unsupported evidence or malformed JSON | Bounded retry, rejection, or explicit unavailable assessment | ✅ pass | full | ✓ uses bounded retries for malformed output and returns an explicit unavailable result (no fake result) (assessment.test.ts)<br>✓ downgrades unsupported positive claims and fabricated evidence (assessment.test.ts)<br>✓ rejects fabricated quotes and unknown segments (assessment.test.ts) |
| Network reconnect, duplicate job, or webhook retry | No duplicate clinical action, result, or usage charge | ✅ pass | full | ✓ resumes after a network reconnect without repeating speech, resetting the clock or duplicating actions (live.test.ts)<br>✓ deduplicates enqueues and claims each job once (db.test.ts)<br>✓ provisions from subscription events (not the success redirect), deduplicates, and ignores stale events (billing.test.ts)<br>✓ reserves transactionally, reconciles exactly once, and never double-charges (billing.test.ts)<br>✓ starting twice is idempotent (refresh cannot reset the timer) (engine.test.ts) |
| Learner opens another user's attempt/media URL | Access denied | ✅ pass | full | ✓ runs a case end to end with controlled reveals, unavailable replies, interruption accounting and finalization (live.test.ts) |
| Owner edits a published case | New version; active attempts stay bound to their original version | ✅ pass | full | ✓ binds approval to the reviewed content hash, enforces separate clearances, and versions changes (owner.test.ts)<br>✓ keeps a case attempt bound to its original case version when the owner revises the case (db.test.ts)<br>✓ treats wording changes as clinical and title/tag changes as display-only (validate.test.ts) |
| Clinical content is withdrawn | No new selection; media access and affected attempts handled by policy | ✅ pass | full | ✓ withdrawal revokes media; appeals revise transcripts without overwriting history (owner.test.ts) |
| Provider fails during grading | Retry from saved evidence; no lost attempt or fake result | ✅ pass | full | ✓ handles provider failure during grading without inventing a result (assessment.test.ts)<br>✓ retries on provider failure, never fabricates a result, and settles the debrief as unavailable (pipeline.test.ts) |

## 7. Latency and cost baseline

- Assessment pipeline latency per case attempt (development baseline (deterministic lexical matcher; NOT a clinical assessor; refused in production)): p50 1 ms, p95 2 ms.
- Measured model spend in this run: $0.0000 (no external model calls).
- **Projected** model cost with claude-opus-5-5 at configured prices ($4/M input, $20/M output), from the real rendered prompts of these attempts (input tokens ≈ characters/3.8) and assumed output sizes (extractor 2500, each assessor 3500, adjudicator 1500 on ~30% of attempts, examiner 120 per decision):
  - Mean prompt sizes: extractor 702 tokens, assessor 4532 tokens, examiner 1533 tokens/decision.
  - Assessment ≈ $0.246 per case; LLM examiner ≈ $0.038 per case.
  - Per completed station (3 cases): ≈ $0.85 excluding speech recognition/synthesis, storage and hosting. Projections, not invoices: reconcile against provider billing once live.

## Appendix: per-response results (base variant)

| response | split | level | reference overall | assessed | ok | element mismatches |
|---|---|---|---|---|---|---|
| stroke.strong.a | final | strong | strong / exceptional | unsafe | ✗ **UNFAIR FAILURE** | e-hypodensity: incorrect (ref demonstrated) |
| stroke.strong.b | final | strong | strong / exceptional | unsafe | ✗ **UNFAIR FAILURE** | e-hypodensity: incorrect (ref demonstrated); e-laterality: not_demonstrated (ref demonstrated) |
| stroke.satisfactory.a | final | satisfactory | meets_expected / strong | strong | ✓ | — |
| stroke.borderline.a | final | borderline | below_expected | below_expected | ✓ | e-hypodensity: not_demonstrated (ref partially_demonstrated|uncertain|demonstrated); e-laterality: not_demonstrated (ref demonstrated|partially_demonstrated); e-diagnosis: not_demonstrated (ref partially_demonstrated|uncertain) |
| stroke.poor.a | final | poor | unsafe | unsafe | ✓ | e-hypodensity: not_demonstrated (ref incorrect); e-next-imaging: demonstrated (ref incorrect); e-communication: not_demonstrated (ref incorrect) |
| stroke.consequential.laterality | final | consequential_error | unsafe / below_expected | unsafe | ✓ | — |
| stroke.edge.negation | final | edge_case | unsafe | unsafe | ✓ | e-next-imaging: demonstrated (ref incorrect) |
| stroke.edge.self_correction | final | edge_case | strong / meets_expected | strong | ✓ | e-hypodensity: incorrect (ref demonstrated) |
| stroke.edge.examiner_supplied | final | edge_case | meets_expected / strong | strong | ✓ | — |
| stroke.edge.render_failure | final | edge_case | strong / meets_expected / withheld | unsafe | ✗ **UNFAIR FAILURE** | e-hypodensity: incorrect (ref demonstrated); e-next-imaging: incorrect (ref demonstrated) |
| stroke.edge.unavailable_request | final | edge_case | strong / meets_expected | strong | ✓ | — |
| stroke.edge.asr_uncertain | final | uncertainty | withheld / below_expected / meets_expected | withheld | ✓ | e-dense-mca: uncertain (ref not_demonstrated); e-diagnosis: uncertain (ref demonstrated|partially_demonstrated) |
| stroke.edge.prompt_injection | final | edge_case | unsafe / below_expected | below_expected | ✓ | — |
| spine.strong.a | tuning | strong | strong / exceptional | strong | ✓ | — |
| spine.satisfactory.a | tuning | satisfactory | meets_expected / strong | strong | ✓ | — |
| spine.borderline.a | tuning | borderline | below_expected | below_expected | ✓ | s-mass: not_demonstrated (ref partially_demonstrated|uncertain); s-diagnosis: not_demonstrated (ref partially_demonstrated|demonstrated) |
| spine.poor.a | tuning | poor | unsafe | unsafe | ✓ | s-diagnosis: not_demonstrated (ref incorrect) |
| spine.consequential.intramedullary | tuning | consequential_error | below_expected / unsafe | unsafe | ✓ | s-compression: demonstrated (ref not_demonstrated|incorrect); s-urgency: not_demonstrated (ref demonstrated|partially_demonstrated) |
| spine.edge.unavailable | tuning | edge_case | strong / meets_expected | strong | ✓ | — |
| ring.strong.a | tuning | strong | strong / exceptional | strong | ✓ | — |
| ring.satisfactory.a | tuning | satisfactory | meets_expected / strong | strong | ✓ | r-no-overcommit: incorrect (ref demonstrated|partially_demonstrated) |
| ring.borderline.a | tuning | borderline | below_expected | below_expected | ✓ | — |
| ring.poor.a | tuning | poor | unsafe | unsafe | ✓ | r-lesion: incorrect (ref partially_demonstrated|not_demonstrated); r-laterality: not_demonstrated (ref incorrect); r-ddx: demonstrated (ref incorrect); r-next: not_demonstrated (ref incorrect) |
| ring.uncertainty.a | tuning | uncertainty | meets_expected / strong | strong | ✓ | r-no-overcommit: incorrect (ref demonstrated) |
| ring.edge.interrupted | tuning | edge_case | strong / meets_expected | below_expected | ✗ **UNFAIR FAILURE** | r-ddx: incorrect (ref demonstrated) |
