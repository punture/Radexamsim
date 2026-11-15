# Neuroradiology oral examination simulator

A browser-based simulator for spoken neuroradiology oral-exam practice. An AI examiner presents images and asks approved questions. The learner answers by voice, and the result is an evidence-linked assessment with feedback and a learning plan. One owner, a practising neuroradiologist, is the sole human clinical reviewer; language models do the faculty work around that reference.

> **Status:** runnable development build with fictional fixtures. No approved clinical cases yet. Live AI, speech and payment providers are implemented but not verified (no credentials in the build environment). Nothing is deployed. See [docs/STATUS.md](docs/STATUS.md).
>
> This is an independent practice tool. It is not affiliated with or endorsed by the ABR or the Royal College, and it has no access to confidential examination material.

## Requirements

- Node.js ≥ 22 and pnpm 10 (`corepack enable`)
- PostgreSQL 16, local or via Docker (`pnpm db:start` handles both)
- Chromium for end-to-end tests. The pinned Playwright falls back to `/opt/pw-browsers/chromium` when present.
- Optional: Python ≥ 3.11 for `tools/ingestion` (quarantine and de-identification of source material)

## Quick start (local development)

```bash
pnpm install
pnpm db:start        # PostgreSQL 16 via Docker or a local cluster; creates sim_dev and sim_test
pnpm db:migrate
pnpm db:seed         # fictional fixture cases, placeholder media, dev accounts, content requests
pnpm dev             # API :4000, worker, web :3000 (scripts/dev.sh)
```

Open http://localhost:3000. Development accounts are created by the seed:

| Account | Email | Password |
|---|---|---|
| Learner | `learner@example.test` | `learner-dev-password-123` |
| Owner | `owner@example.test` | `owner-dev-password-123` |

The owner console requires a second factor. The seed prints a TOTP secret: add it to an authenticator app, or print the current code with `pnpm --filter @sim/api run totp`.

Without model keys, `scripts/dev.sh` enables the **development baseline assessor**. It is a lexical stand-in, labelled "dev baseline (not clinical)" wherever its results appear, and the configuration refuses it in production. Examiner speech uses the browser's speech synthesis. Recognition uses the browser's speech recognition (Chrome), after explicit consent, because it may send audio to the browser vendor.

Configuration is in environment variables. Copy `.env.example` to `.env` and adjust it; `scripts/dev.sh` loads `.env` if present. Never commit `.env`.

## Tests and checks

```bash
pnpm typecheck                         # all workspaces
pnpm test                              # vitest; database tests use per-file databases cloned from a migrated template
pnpm e2e                               # Playwright: learner completes the demo case; cross-account access denied
pnpm evals                             # evaluation harness → evals/reports/latest.md (see evals/README.md)
pnpm check:leaks                       # builds the web client and scans it for clinical truth, rubric text, canaries, secrets
pnpm --filter @sim/api run openapi     # regenerate docs/openapi.json
```

`pnpm test` and `pnpm evals` need PostgreSQL running (`pnpm db:start`). `pnpm evals -- --llm` uses the configured model assessor and spends money; run it only with the owner's approval.

## Repository layout

```
apps/web             Next.js 16: public site, learner app, owner console
apps/api             Fastify API + WebSocket live sessions
apps/worker          durable background jobs (assessment, debrief, plans, authoring, privacy)
packages/contracts   Zod schemas shared by every service
packages/exam-engine pure exam logic: clock, stages, examiner menu/validation/fallback, opportunities
packages/clinical-content  exam profiles, case validation, hashing, publication workflow
packages/ai          LLM runner, prompt registry, assessment pipeline, feedback, learning plans, speech adapters
packages/db          Drizzle schema, SQL migrations (RLS, triggers), durable queue
packages/storage     private object storage adapter
packages/billing     Stripe events, plans, immutable usage ledger
packages/viewer, ui  image viewer, shared UI
fixtures             fictional development cases (excluded from clinical use)
evals                evaluation harness, locked final split, blind owner ratings, reports
tools/ingestion      Python quarantine and de-identification tool
docs                 architecture, API, events, data model, profiles, authoring, assessment, prompts, runbooks
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) (decisions and backlog)
- [Status report](docs/STATUS.md)
- [API](docs/API.md), [events](docs/EVENTS.md), [data model](docs/DATA_MODEL.md)
- [Exam profiles](docs/EXAM_PROFILES.md), [source registry](docs/SOURCES.md)
- [Case authoring and owner workflow](docs/CASE_AUTHORING.md)
- [Assessment](docs/ASSESSMENT.md), [prompt registry](docs/PROMPTS.md)
- [Evaluation harness](evals/README.md)
- Runbooks: [deployment](docs/runbooks/DEPLOYMENT.md), [rollback](docs/runbooks/ROLLBACK.md), [backup and restore](docs/runbooks/BACKUP_RESTORE.md), [monitoring](docs/runbooks/MONITORING.md), [data retention](docs/runbooks/DATA_RETENTION.md), [incidents](docs/runbooks/INCIDENT.md)
- [Billing checklist](docs/BILLING_CHECKLIST.md)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | `pnpm db:start`, then `bash scripts/dev-db.sh status` |
| Tests fail with "database … does not exist" | The vitest global setup rebuilds the test template on each run; check that the `sim` role has `CREATEDB` (`pnpm db:start` creates it) |
| Results say "assessment unavailable" | No assessment model is configured and the dev baseline is off. Set `ALLOW_DEV_BASELINE_ASSESSOR=true` for the worker (development only), or configure `LLM_PROVIDER=anthropic` with a key |
| The microphone prompt never appears | Browsers allow the microphone only on secure origins; use `http://localhost:3000`, not a LAN IP |
| "Consent required" when speaking | Record microphone consent (and browser-speech consent) in station setup or Account |
| No speech recognition option | Browser recognition needs Chrome or Edge; otherwise configure server ASR (`ASR_PROVIDER=deepgram`) |
| Owner console asks for a code you don't have | Run `pnpm --filter @sim/api run totp`; check your system clock if codes are rejected |
| Playwright cannot find a browser | Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, or install Chromium. The config falls back to `/opt/pw-browsers/chromium` |
| `next-env.d.ts` changed after a build | A build with a custom `NEXT_DIST_DIR` rewrites it; restore it with `git checkout apps/web/next-env.d.ts` |
| Port 3000 or 4000 already in use | Stop the other process, or set `API_PORT` and update `NEXT_PUBLIC_API_WS_URL` and the web rewrite target |

## Rules that are never relaxed

These are summarized from the specification; see [CLAUDE.md](CLAUDE.md).

- Hidden answers never reach the browser.
- Only owner-approved clinical content is published.
- Fixtures are never counted as clinical cases.
- Patient material is never sent to an external model without per-case clearance and prior quarantine.
- No real charges, public deployment or invitations without the owner's separate authorization.
