# Status report

As of 2026-11-15. The build environment is an ephemeral cloud container with no provider credentials and a restricted network. Work is committed to a local git repository only; no remote has been configured.

## Summary

The first complete examination flow runs end to end on fictional development fixtures:

1. sign in;
2. eligible case selection and microphone/image preflight;
3. a spoken examination with server-controlled image stages and controlled follow-ups;
4. a transcript;
5. an evidence-linked assessment;
6. a debrief and a learning activity;
7. results found again after signing back in.

The owner can import, review, approve, publish, revise, retire and withdraw cases, and resolve disputed results. Billing and account boundaries are enforced by the backend.

What is **not** yet true:

- there are no approved clinical cases;
- no live AI, speech, auth or payment provider has been exercised;
- nothing is deployed.

The product must not be offered to paying clinical users in this state.

## Ledger: implemented, tested, simulated, blocked

| Area | State | Evidence |
|---|---|---|
| Contracts, exam engine (clock, stages, examiner menu/validation/fallback, opportunities, prompting, form assembly, projections) | Implemented, unit-tested | `packages/exam-engine/test/engine.test.ts` |
| Case validation, hashing, change classification, publication gate | Implemented, unit-tested | `packages/clinical-content/test/validate.test.ts` |
| Database: migrations, RLS, append-only events, immutable ledger/transcripts/assessments, attempt-to-version binding, durable queue with dead letters | Implemented, tested against PostgreSQL 16 | `packages/db/test/db.test.ts` |
| Live session controller: WebSocket tickets, deterministic examiner, reveals, unavailable replies, interruption accounting, duplicate commands, reconnect, restart recovery, render failure, consent gates | Implemented, integration-tested | `apps/api/test/live.test.ts` |
| Assessment pipeline: extraction, independent A/B, deterministic post-processing, adjudication, caps, withholding, owner items, ASR-confidence rules | Implemented, tested with scripted models | `packages/ai/test/assessment.test.ts` |
| Worker: assessment, debrief, learning plan, authoring, critique, privacy jobs | Implemented, integration-tested (dev baseline and scripted providers) | `apps/worker/test/*.test.ts` |
| Owner console (API and UI): import, structured editor, critics, hash-bound approval, clearances, publish, versions, retire, withdraw, attempts, appeals, coverage, metrics, configuration | Implemented; API integration-tested; UI browser smoke-tested (MFA sign-in, readable review package with image previews, coverage, configuration, metrics, learner lockout) | `apps/worker/test/owner.test.ts`, `apps/web/e2e/owner-console.spec.ts` |
| Learner web app and public site | Implemented; vertical slice browser-tested | `apps/web/e2e/vertical-slice.spec.ts` |
| Billing: Stripe event processing, idempotency, ledger reserve/reconcile, entitlements, demo allowance | Implemented, unit-tested with locally signed payloads | `packages/billing/test/billing.test.ts` |
| Evaluation harness: 25 response patterns, variants, examiner simulation, 16-scenario regression matrix, locked final split, blind owner ratings, report | Implemented, tested | `evals/test/evals.test.ts`, `evals/reports/latest.md` |
| Client-bundle leak scan | Implemented; passes | `pnpm check:leaks` |
| Anthropic models (examiner, extractor, assessors, adjudicator, author, critics) | **Simulated**: adapter written to the SDK typings; never called live | Scripted-provider tests only |
| Deepgram streaming ASR, ElevenLabs and Deepgram TTS | **Simulated**: adapters only; never called live | Mock providers; alignment parsing tested |
| Browser speech (synthesis, recognition) | Implemented; not tested with a real microphone in automation (E2E uses dev-injected speech) | Manual check pending |
| Supabase auth (JWT/JWKS, aal2) | **Simulated**: never connected to a project | Local dev auth is tested |
| Stripe checkout, portal and webhooks against Stripe | **Simulated**: no test-mode keys | Signature verification tested locally |
| Python ingestion and de-identification (quarantine, inventory, extraction, DICOM PS3.15 basic-profile subset, packaging) | Implemented, tested on synthetic inputs. Its package was verified against the API import schema and digest checks. OCR is untested here (no `tesseract`); there is no face detection; EMF/WMF cannot be converted | `tools/ingestion/tests` (74 pytest tests) |
| S3-compatible private storage driver | **Not implemented** (local filesystem only) | Backlog |
| Cornerstone3D DICOM stack viewer | **Not implemented** (still/stack image adapter only; awaits suitable de-identified DICOM) | Backlog |
| Approved clinical cases | **Blocked on owner content**: 0 approved; 10 content-request slots open | Owner console → Coverage |
| Deployment | **Blocked on owner decision and authorization** | `docs/runbooks/DEPLOYMENT.md` |

Automated test totals at this commit: **109 vitest tests in 10 files**, **4 Playwright tests**, **74 pytest tests** (ingestion), all passing. Typecheck and the production web build pass.

## Measured results (fixtures, development configuration)

- **Evaluation harness** (`evals/reports/latest.md`) with the labelled dev baseline assessor:
  - all 16 regression scenarios pass, each with full coverage;
  - the examiner simulation spoke only approved, neutral text, with 0 leaks, 448/448 forged actions rejected, and 4/4 unavailable requests answered with approved replies;
  - all evidence spans were valid (144/144).

  The baseline itself shows what a lexical matcher gets wrong. On the locked final split it produced 0/5 false reassurance but 3/7 unfair failures, by misreading phrases such as "hemorrhage is excluded". This is why it is refused in production. It is not a measure of the product's model assessor, which has not been run.
- **Latency:** the deterministic examiner decides in under 1 ms in-process. End-to-end turn latency with real ASR and TTS is **unmeasured** (no providers).
- **Cost (projection):** with Claude Opus 5.5 at configured prices, from the real rendered prompts, about $0.25 per case for two-pass assessment and $0.04 per case for an LLM examiner. That is about $0.85 per 3-case station, excluding speech, storage and hosting. These are projections, not invoices.
- **Reference labels:** all 25 intended judgments are developer-authored and **pending owner approval**. Agreement figures are therefore against developer labels, not against the owner.

## Known limitations

- Live sessions are held in API memory, so horizontal scaling needs sticky routing. Restart recovery (platform pause, then resume on reconnect) is tested.
- Exam profiles are provisional: official pages could not be fetched, so the settings come from search snippets.
- Privacy and terms pages are drafts, pending owner and legal review.
- The learning plan has no endpoint for item state updates. Usage totals are lifetime, not per billing period.
- Owner console browser coverage is a smoke test. The approve/publish/withdraw actions are covered at the API level, not by clicking through the UI.

## Real dependencies (what unblocks the next steps)

1. **Case material from the owner:** the first package described in [CASE_AUTHORING.md](CASE_AUTHORING.md) §5, plus where the archive lives and the rights basis. Source material must be de-identified locally (`tools/ingestion`) before it enters the system.
2. **Credentials** (test or development accounts), added through the environment's secure credential settings, never pasted into chat:
   - Anthropic API key, for the examiner and assessment roles;
   - Deepgram, and/or ElevenLabs, for server speech;
   - Stripe test-mode keys and a webhook secret;
   - a Supabase project, for production-grade auth.
3. **Network allowlist** for official sources, so the profiles can be verified ([SOURCES.md](SOURCES.md)).
4. **Owner decisions:**
   - approve or edit the 25 evaluation anchors (or rate them blind);
   - verify the profiles;
   - approve the policy texts and prices;
   - choose hosting and authorize deployment.
5. **A git remote** if this work should leave the ephemeral container.

## Next concrete task

When the first case package and an Anthropic key are available:

1. Run ingestion and import the case.
2. Draft it with the LLM author.
3. Run the critics.
4. Owner review, approval and clearances.
5. Publish.
6. Run `pnpm evals -- --llm` once on the tuning split and once on the locked final split. With speech keys, also measure real end-to-end turn latency and cost per completed station.
