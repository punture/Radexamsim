# CLAUDE.md

Guidance for AI coding agents working in this repository. Read [docs/STATUS.md](docs/STATUS.md) for the current state and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## The governing rule

**The owner is the sole human clinical reviewer and the final clinical authority.** Language-model roles do the faculty work: drafting cases and rubrics, critiquing, examining, assessing, writing feedback and checking consistency. They never approve clinical content. Their agreement with each other, or with the owner's reference, is never described as validation, board endorsement or external faculty review. Do not reintroduce a requirement for external faculty or a second human reviewer.

## Hard boundaries (never relax)

- **Content**
  - Publish only owner-approved clinical content. Approval binds to the exact clinical content hash; any clinical change needs a new version and renewed approval.
  - Missing cases become **content requests**. Never fabricate cases, and never present fixtures as patients.
  - Development fixtures stay fictional, use labelled placeholder media, and are excluded from clinical scores, readiness and production counts.
- **Information separation**
  - Hidden answers never reach the browser; CSS or an unopened tab is not concealment. The browser gets allowlisted DTOs and opaque media handles only.
  - The live examiner model never sees clinical truth, rubrics or authored IDs. It picks from a per-turn alias menu; the server validates every proposal and executes only approved text.
- **Model safety**
  - Models get no SQL, shell, file, account-administration or billing tools.
  - Never execute free-form model output.
  - Do not request or store private chain-of-thought.
- **Assessment integrity**
  - Credit and criticism need verbatim, re-validated candidate quotes. Omissions need a deterministic opportunity record.
  - When a mark cannot be supported, use `uncertain` or `not_assessable`; never invent a result. When no model is configured in production, the result is explicitly unavailable.
  - Two independent assessor passes is the default. Only the owner may reduce coverage, with explicit acknowledgement.
- **Privacy**
  - Source material goes into quarantine and is de-identified (`tools/ingestion`) before any external processing.
  - Never send patient assets to an external model just because a key is present: external AI processing is a per-case clearance.
  - Keep service credentials server-side; never expose a service-role key.
  - Never make a storage bucket public.
  - Microphone audio is processed only with consent under the current policy version.
- **Business actions**
  - Do not purchase services, deploy publicly, send invitations or activate real charges without the owner's separate authorization. Stripe stays in test mode.
- **Claims**
  - No board logos, no implied affiliation, no claims of access to confidential exam questions, and no advertised validation that has not happened.
  - Board facts are "publicly described" until the owner verifies the profiles.
- **Integrations**
  - Never present a simulated integration as a working live integration.
  - The development baseline assessor is labelled everywhere and refused in production.

## Commands

```bash
pnpm install && pnpm db:start && pnpm db:migrate && pnpm db:seed
pnpm dev                 # API :4000, worker, web :3000
pnpm typecheck
pnpm test                # vitest (needs PostgreSQL)
pnpm e2e                 # Playwright vertical slice
pnpm evals               # evaluation harness; pnpm evals:lock before judging a change
pnpm check:leaks         # client-bundle leak scan
pnpm test:s3             # S3 storage driver + API/worker suites against local moto servers
pnpm --filter @sim/api run openapi
```

Before committing a change that touches assessment, examiner policy, prompts or content validation, run `pnpm test` and `pnpm evals`. Compare on the **tuning** split. Never tune against the locked final split and then present it as unseen; each final-split run is logged in `evals/locked/run-log.jsonl`.

## Conventions

- Contracts are Zod schemas in `packages/contracts`, shared by every service. Change the schema first, then the producers and consumers.
- Version things rather than overwriting them: case versions, profile versions, assessments, transcript revisions, the usage ledger and session events. Database triggers enforce the append-only and immutable tables and attempt-to-version binding.
- Durable state changes and their events or jobs are written in one transaction. Jobs are idempotent by dedupe key, and client commands by `commandId`.
- Prompts are versioned `PromptDefinition`s (`packages/ai/src/prompts`). Bump the version for any behavioural change.
- Pure logic lives in `packages/exam-engine` and `packages/clinical-content`, with unit tests. Services should orchestrate, not reimplement, that logic.
- UI copy must not overstate: a rating is a practice estimate, never a percentage, board score or pass prediction.

## Current status (summary)

- **Working end to end with fixtures:** case selection, preflight, spoken exam (WebSocket controller, deterministic examiner, browser speech), image stages, evidence-linked assessment (two-pass pipeline; dev baseline without keys), debrief, learning plan, results after sign-in, appeals, the owner console (import, author, critique, approve, publish, revise, retire, withdraw, resolve disputes), billing ledger, privacy jobs, and the evaluation harness.
- **Implemented but not live-verified:** Anthropic models, Deepgram ASR, ElevenLabs and Deepgram TTS, Supabase auth, Stripe, and the S3-compatible storage driver (tested against moto). No credentials were available.
- **Missing:** approved clinical cases (owner content), the Cornerstone3D DICOM viewer, a hosting decision and deployment.
