# Prompt registry

Every LLM role is a versioned `PromptDefinition` in `packages/ai/src/prompts/`. A definition versions four things together: the input schema (Zod), the output schema (Zod, built per input so it can constrain IDs to the ones offered), the model defaults, and the template. The registry is `PROMPTS` in `packages/ai/src/prompts/registry.ts`.

Every model call records `promptId`, `promptVersion`, the provider, the requested and served model, latency, token usage and estimated cost in `model_calls`. Assessments also store the prompt versions they used in `frozenVersions.promptVersions`.

## Rules common to every role

- **Structured output only.** Calls use the provider's structured-output mode (`messages.parse` with a Zod output format). Invalid output gets a bounded number of schema repairs, then retries, then an explicit failure (`invalid_output`, `refused`, `timeout`, `provider_error`). No caller invents a result on failure.
- **Isolation.** Each role receives only what it needs:
  - the live examiner never receives clinical truth, the rubric or authored IDs; it sees one-time aliases only;
  - assessors receive the clinical truth and rubric but not the other assessor's output;
  - candidate speech is wrapped as data and never treated as instructions.
- **No private chain-of-thought is requested or stored.** Prompts ask for short rationales tied to evidence. Adaptive thinking may be enabled on the provider side, but the thinking content is not persisted.
- **No tools that act.** Models get no SQL, shell, file, account-administration or billing tools. Examiner proposals are validated against the issued menu; nothing a model emits is executed as code.
- **Kill switches and spend caps.** The owner can disable the examiner and assessment roles in **Configuration**. A per-session spend cap (`SESSION_SPEND_CAP_USD`, default $3) stops further calls.
- **Model routing is configuration.** `MODEL_DEFAULT` (default `claude-opus-5-5`) can be overridden per role: `MODEL_LIVE_EXAMINER`, `MODEL_EVIDENCE_EXTRACTOR`, `MODEL_ASSESSOR_A`, `MODEL_ASSESSOR_B`, `MODEL_ADJUDICATOR`, `MODEL_FEEDBACK_WRITER`, `MODEL_LEARNING_PLAN`, `MODEL_CASE_AUTHOR` and `MODEL_CRITIC`. Prices live in `DEFAULT_PRICES` (`packages/ai/src/llm/runner.ts`) and must be checked against current provider pricing before cost reports are trusted.
- **Server-side refusal fallbacks** (Anthropic beta) are enabled by default in the provider adapter (`LLM_SERVER_SIDE_FALLBACKS`). When the primary model declines, the provider may serve a fallback model; the served model is recorded per call.

## Roles

| Registry key | Version | Effort / max tokens / timeout / attempts | Input (top-level fields) | Output | Used by |
|---|---|---|---|---|---|
| `live_examiner` | `live_examiner@2026-11-15.2` | low / 2,000 / 2.5 s / 1 (no repair; the deterministic fallback takes over) | mode, trigger, timing, stage, questions, factReplies, neutralPhrases, revealOptions, viewportOptions, canAdvanceCase, conversation, secondsSinceCandidateSpoke, lastCandidateTurnPoorlyRecognized | `{action, ref, reason, note}`; `ref` restricted to the aliases offered this turn | API live session |
| `evidence_extractor` | `evidence_extractor@2026-11-15.1` | medium / 16,000 / 90 s / 3 | transcript, examinerPrompts (heard text only) | Extracted statements with verbatim spans, negation, laterality, certainty, corrections | Worker assessment |
| `assessor_a`, `assessor_b` | `assessor@2026-11-15.1` | high / 32,000 / 180 s / 3 | scoringContext, clinicalTruth, rubric, transcript, examinerPrompts, imageEvents, sessionConditions, extractedStatements (empty for B by default) | Element judgments with evidence and opportunity IDs, unsafe flags citing approved criteria, domain and global ratings, abstention | Worker assessment |
| `adjudicator` | `adjudicator@2026-11-15.1` | high / 16,000 / 120 s / 2 | disputes (element, both judgments), transcript, examinerPrompts | A resolution per disputed element, or "still disputed" | Worker assessment |
| `feedback_writer` | `feedback_writer@2026-11-15.1` | medium / 4,000 / 60 s / 2 | caseLabel, ratingDisplay, provisional, withheldReason, uncertaintyReasons, strengths, issues, technicalLimitations | Reworded summary. Rejected if it adds quotes, percentages or certainty | Worker debrief (optional; the deterministic composer is the default) |
| `learning_plan` | `learning_plan@2026-11-15.1` | low / 3,000 / 45 s / 2 | focusSkills, skillSummaries, items | Wording for plan items. Selection stays deterministic | Worker learning plan (optional) |
| `case_author` | `case_author@2026-11-15.1` | high / 48,000 / 240 s / 2 | ownerNotes, sourceDiagnosis, diagnosticBasis, truthStatus, availableImages, teachingTextFromSource, targetProfiles, imagesAttached | Draft stages, questions, rubric, reference responses, plus open questions for the owner | Owner console → worker (only if external AI processing is allowed for the case) |
| `clinical_critic` | `clinical_critic@2026-11-15.1` | high / 24,000 / 180 s / 2 | caseJson, focus, automatedIssues | Issues with severity, area, path, problem, suggested revision, `requiresOwnerDecision` | Owner console → worker (advisory) |
| `rubric_critic` | `rubric_critic@2026-11-15.1` | high / 24,000 / 180 s / 2 | caseJson, focus, automatedIssues | As above, focused on rubric fairness and opportunity design | Owner console → worker (advisory) |

The exact Zod input and output schemas are next to each template: `examiner.ts`, `assessment.ts`, `feedback.ts` and `authoring.ts` in `packages/ai/src/prompts/`.

## Changing a prompt

1. Edit the template or schema and **bump the version** (`<id>@<date>.<n>`). Never change the behaviour of a published version silently.
2. Run `pnpm test`, and `pnpm evals` with the baseline for structural checks. With a key and the owner's approval for the spend, also run `pnpm evals -- --llm`. Compare on the **tuning** split; do not tune against the locked final split.
3. When a change is judged, run the locked final split once and report the result. The run log records each final-split evaluation.
4. Previously stored assessments keep their recorded prompt versions; re-assessment creates new versions.

## Live verification status

None of the model roles has been exercised against the live provider from this build environment, because no API key was available. The adapters, structured-output parsing, retries and fallbacks are tested with a scripted provider (`ScriptedLlmProvider`). Real latency, refusal rates and output quality are unmeasured until a key is configured.
