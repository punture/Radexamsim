# Assessment

How a spoken case attempt becomes an evidence-linked judgment, feedback and a learning plan. The code is in `packages/ai/src/assessment`, `packages/exam-engine/src/opportunities.ts`, `packages/ai/src/feedback` and `packages/ai/src/learning`. The contracts are in `packages/contracts/src/assessment.ts`.

The statuses, prompting levels and caps below are **product constructs**. Their scoring consequences are defined in each owner-approved rubric. They are not official board categories, and a rating is a practice estimate, not a board score.

## 1. Inputs are frozen

Each assessment records the profile version, case version, rubric version, transcript revision and every prompt version it used. It reads only durable records:

- candidate transcript segments (current revision);
- examiner utterances with their **played** portion;
- stage reveals, image renders and render failures;
- the case close reason.

Re-assessment after an appeal or owner decision creates a **new assessment version** that links to the one it supersedes. The earlier version is preserved, and an update trigger forbids editing it.

## 2. Opportunities (deterministic)

An omission can only be charged when the candidate genuinely had the opportunity. For every rubric element, `computeOpportunity` derives an opportunity record from the timeline:

- **Images:** the required assets (or the stage's assets) must have been disclosed **and rendered**. A failed render gives `required_asset_render_failed`; material never shown gives `required_asset_not_disclosed`.
- **Questions:** an approved question counts as delivered only if at least 90% of it was played (`DELIVERED_FRACTION`). A question interrupted earlier gives `question_interrupted_before_heard`.
- **Rule kinds:**
  - `from_stage_assets`: the opportunity opens when the images render;
  - `after_question`: it opens when the question is heard;
  - `either`: it opens via the question, or via the images when spontaneous mention is expected.
- **Minimum exposure:** the element's `minExposureSeconds` must have elapsed after the opportunity opened. This protects candidates who were cut off by time expiry or a technical failure. It does **not** apply when the candidate responded after the opportunity opened and the case then closed normally, because the examiner moved on after a completed answer or the candidate asked to move on. A short, complete answer is a real opportunity.
- A case ended by technical failure needs twice the minimum exposure.

## 3. Evidence

Every `demonstrated`, `partially_demonstrated` or `incorrect` judgment, and every unsafe flag, must cite **verbatim candidate words**: segment ID, character offsets and quote. Each span is re-validated against the stored transcript. Small offset or whitespace errors are repaired and logged; fabricated quotes and unknown segments are rejected.

## 4. Element statuses and prompting

| Status | Meaning | Requirement |
|---|---|---|
| `demonstrated` | Accepted concept or acceptable alternative stated | Verified quote |
| `partially_demonstrated` | Partly correct or incomplete | Verified quote |
| `incorrect` | Wrong or unsafe claim about the element | Verified quote |
| `not_demonstrated` | Not stated despite a genuine opportunity | Assessable opportunity record |
| `not_assessable` | No genuine opportunity (images failed or were not shown, question not heard, insufficient time) | Opportunity reasons |
| `uncertain` | No defensible judgment can be made | Stated reason |

Prompting levels, from least to most assisted: `spontaneous`, `standard_question`, `targeted_probe`, `rescue`, `examiner_supplied`. The level is the **most assisted** heard examiner prompt that preceded the first evidence for the element. Only utterances played to at least 30% count as heard assistance (`ASSISTANCE_FRACTION`), and only the played words count. The deterministic level is a floor: a model may raise it but never lower it. Each rubric element's `promptingPolicy.credit` maps level to credit (`full`, `partial` or `none`). In the fixtures, a targeted probe earns partial credit, and rescue or examiner-supplied content earns none. Repeating a finding the examiner supplied never earns independent-detection credit.

## 5. Post-processing rules (applied to every assessor pass, model or baseline)

1. A positive or incorrect status without verifiable evidence becomes `uncertain`.
2. Positive evidence must postdate display of the required images; otherwise the status becomes `uncertain`, or `not_assessable` if the images were never shown.
3. `not_demonstrated` without an assessable opportunity becomes `not_assessable`.
4. A model saying "not assessable" when the opportunity was available becomes `uncertain`.
5. **Speech-recognition uncertainty.** Recognized words below provider confidence 0.6 (`LOW_ASR_CONFIDENCE`) cannot support a confident mark:
   - a positive or incorrect status resting only on such words becomes `uncertain`;
   - an omission during a window containing such words becomes `uncertain`;
   - an unsafe flag resting only on such words is kept visible but marked *not committed*, so it cannot cap the rating.
6. An unsafe flag must match one of the rubric's approved `incorrectOrUnsafeClaims` and quote real words; otherwise it is dropped.
7. Self-corrections keep both the initial and the corrected statement, with timing.
8. Dependency blocking records upstream failures, so feedback does not deduct twice for one root error.

## 6. Two passes, agreement and adjudication

- **Assessor A** and **assessor B** run independently. By default B does not see the shared statement extraction.
- **Policy** is `always` by default: every attempt gets a second pass. `risk_based` runs B for:
  - committed unsafe statements or a missed critical element;
  - borderline overall levels;
  - uncertain elements;
  - low-confidence transcription;
  - plus a random sample.

  Switching to `risk_based` requires the owner's explicit acknowledgement in the console (`acknowledgeReducedCoverage`).
- Element disagreements that matter go to the **adjudicator**. Disagreements that remain unresolved are recorded as `disputed`.
- **Overall level.** Model passes give holistic levels. Two equal levels are kept. Adjacent levels resolve to the one nearer the deterministic evidence estimate. Levels further apart are withheld and the attempt goes to owner review.
- **Caps** come from the rubric's `globalRules`:
  - a committed, uncorrected unsafe statement on a critical element caps the rating at `criticalUnsafeCap` (`unsafe` in the fixtures);
  - a missed critical element caps it at `criticalOmissionCap` (`below_expected`).
- **Withholding:** the overall rating is withheld when an unresolved dispute affects a critical element, when `withholdIfUncertainCriticalOrImportant` or more important elements are uncertain or disputed, or when nothing was assessable. Such results are provisional and raise an owner review item.

The deterministic estimate, used by the development baseline and as the reconciliation anchor, never awards `exceptional`: that requires a holistic judgment against the owner's anchors. It returns `unsafe` whenever a committed, uncorrected unsafe statement exists.

## 7. Failure behaviour

- Malformed model output gets a bounded number of schema repairs and retries, then the pass is marked `invalid` or `unavailable`.
- A provider failure is retried from saved evidence by the durable job. After the maximum attempts, the result is an explicit "assessment unavailable" and an owner item. **No result is ever invented.**
- Without an assessment model, production produces no result. The development baseline (`packages/ai/src/assessment/baseline.ts`, a lexical matcher) runs only when `ALLOW_DEV_BASELINE_ASSESSOR` is on outside production, and its output is labelled "dev baseline (not clinical)" everywhere it appears.

## 8. Feedback

The deterministic composer (`packages/ai/src/feedback/composer.ts`) builds the debrief from the final assessment:

- strengths linked to the candidate's own quotes;
- issues ranked by severity and consequence, with blocked dependencies collapsed;
- the rubric's "why it matters" and "stronger response" guidance;
- at most three practice actions;
- uncertainty stated only where an element was actually uncertain;
- technical limitations stated plainly.

An optional LLM feedback writer may reword the composer's text. Output that adds quotes, percentages or certainty is rejected. In exam mode, feedback is released only after the station is complete. In practice mode it may be shown per case.

## 9. Learning plans

`packages/ai/src/learning/plan.ts` selects the next practice deterministically from weak skills, with exposure separated from first-attempt evidence. The schedule is a worked example now, a focused verbal exercise after 1 day, a related unseen case after about 3 days, and a mixed timed reassessment after about 7 days. Learners can change the pace (compressed ×0.5, standard, relaxed ×2) and mark steps done or skipped. Both are stored separately; the generated plan is never edited. Plan items carry **server-only assignment tokens** (`as_` plus 24 hex characters), so the browser never learns which case will be served. Progress views show counts with denominators. They separate exam from practice, first exposure from repeat exposure, and assisted from unassisted credit, and they report development-fixture results separately.

## 10. Board-specific practice display

| Profile | Display | Mapping |
|---|---|---|
| ABR-oriented (`abr_68_72_practice`) | "70 — Satisfactory (practice estimate)" | unsafe→68, below_expected→69, meets_expected→70, strong→71, exceptional→72 (publicly described anchors). Never a percentage; no category or exam prediction; no panel review simulated |
| RCPSC-oriented (`rcpsc_domains_qualitative`) | Qualitative level per product domain; no numeric totals | Canonical domains map to product domains: observation→detection, interpretation→integration, management→management, communication→consultancy. Levels run from major concern to exemplary. Descriptors are product-defined and unverified |
| Advanced track | Qualitative practice levels | No examination equivalence |

## 11. Appeals and owner decisions

- Learners can dispute a **transcription** or a **grading decision**. The original result stays visible.
- The owner resolves an appeal as one of:
  - **original result confirmed** (`upheld`): the assessment is unchanged after review;
  - **result revised** (`revised`);
  - **not accepted for review** (`rejected`): no basis, or out of scope.
- Accepted transcript corrections create new transcript **revisions**; the original text is immutable. Optional reassessment creates a new assessment version and a new debrief version.
- Owner element decisions (`resolve-element`) also create a new version. Credit still requires a verified quote, so the owner cannot award credit for words the candidate did not say.

## 12. What the system does not claim

Agreement between models, or between models and the single human reference, is a consistency signal. It is not proof of clinical correctness, board endorsement or external validation. Development fixtures are fictional and excluded from scores, readiness and production counts. Evaluation results and their limits are reported by the harness; see `evals/README.md` and `evals/reports/latest.md`.
