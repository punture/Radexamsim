# Neuroradiology oral examination simulator

A browser-based simulator for spoken neuroradiology oral-exam practice. An AI examiner presents images and asks approved questions. The learner answers by voice, and the result is an evidence-linked assessment with feedback and a learning plan. One owner, a practising neuroradiologist, is the sole human clinical reviewer; language models do the faculty work around that reference.

> **Status:** runnable development build with fictional fixtures. No approved clinical cases yet. Live AI, speech and payment providers are implemented but not verified (no credentials in the build environment). Nothing is deployed. See [docs/STATUS.md](docs/STATUS.md).
>
> This is an independent practice tool. It is not affiliated with or endorsed by the ABR or the Royal College, and it has no access to confidential examination material.

## Requirements

- Node.js ≥ 22 and pnpm 10 (`corepack enable`)
- PostgreSQL 16, local or via Docker (`pnpm db:start` handles both)
- Chromium for end-to-end tests. The pinned Playwright falls back to `/opt/pw-browsers/chromium` when present.
- Optional: Python ≥ 3.13 and `tesseract` for `tools/ingestion` (quarantine and de-identification of source material; OCR for burned-in text)

### On Windows

The project runs natively on Windows 10 and 11, without WSL. On Windows, `pnpm dev`, `pnpm db:start`, `pnpm db:stop` and `pnpm intake` run Node versions of the shell scripts (`scripts/windows/`, chosen by `scripts/platform.mjs`); macOS and Linux keep using the shell scripts. Keep the repository under your user profile and outside OneDrive, Box or Dropbox, because intake copies raw case files into its git-ignored `quarantine\` folder. Install:

- Node.js 22 or newer, then `npm install -g pnpm@10.28.0`.
- PostgreSQL 16: unpack the `pgsql\bin`, `pgsql\lib` and `pgsql\share` folders of the [EDB Windows binaries zip](https://www.enterprisedb.com/download-postgresql-binaries) into `%LOCALAPPDATA%\Programs\PostgreSQL\16`, or set `PG_BIN` to another PostgreSQL 16 `bin` folder. `pnpm db:start` then runs a private development cluster in `var\postgres-16`. It listens on 127.0.0.1 only and keeps running in the background until `pnpm db:stop` or sign-out. If a PostgreSQL service already listens on port 5432, `pnpm db:start` uses it and prints the one-time `psql` command that creates the development role.
- For case intake: Python 3.13 or newer (`winget install Python.Python.3.13`) and Tesseract OCR (`winget install UB-Mannheim.TesseractOCR`). The first `pnpm intake` sets up the tool's virtual environment.

In PowerShell, if running scripts is disabled (the Windows default), `pnpm` fails to load `pnpm.ps1`; type `pnpm.cmd` instead (for example `pnpm.cmd dev`), or use Command Prompt.

Windows has no 0700/0600 file modes, so quarantined files get the NTFS permissions of the folder they are in. Not ported to, or not checked on, Windows: `pnpm test:s3` (bash), the live-session load test (`pgrep`) and the end-to-end tests (they call `psql`).

WSL 2 with Ubuntu also works. Keep the project inside Ubuntu (for example `~/radexamsim`, not under `/mnt/c`), run `sudo apt install -y postgresql-16 python3-venv tesseract-ocr`, install Node 22 with nvm or NodeSource, then follow the quick start. The first `pnpm db:start` prints a one-time `sudo` command that creates the development database role. Intake needs Python 3.13 or newer; Ubuntu 24.04's own Python is 3.12.

## Quick start (local development)

```bash
pnpm install
pnpm db:start        # PostgreSQL 16 via Docker or a local cluster; creates sim_dev and sim_test
pnpm db:migrate
pnpm db:seed         # fictional fixture cases, placeholder media, dev accounts, content requests
pnpm dev             # API :4000, worker, web :3000 (scripts/dev.sh; Windows: scripts/windows/dev.mjs)
```

Open http://localhost:3000. Development accounts are created by the seed:

| Account | Email | Password |
|---|---|---|
| Learner | `learner@example.test` | `learner-dev-password-123` |
| Owner | `owner@example.test` | `owner-dev-password-123` |

The owner console requires a second factor. The seed prints a TOTP secret: add it to an authenticator app, or print the current code with `pnpm --filter @sim/api run totp`.

Without model keys, `pnpm dev` enables the **development baseline assessor**. It is a lexical stand-in, labelled "dev baseline (not clinical)" wherever its results appear, and the configuration refuses it in production. Examiner speech uses the browser's speech synthesis. Recognition uses the browser's speech recognition (Chrome), after explicit consent, because it may send audio to the browser vendor.

Configuration is in environment variables. Copy `.env.example` to `.env` and adjust it; `pnpm dev` loads `.env` if present. Never commit `.env`.

Model provider: `LLM_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` (Claude Opus 5.5 by default), or `LLM_PROVIDER=gemini` with `GEMINI_API_KEY` (Gemini 4 Hydrogen by default; use a billing-enabled Google Cloud project, see `.env.example`). A free-tier Gemini key is for development only: also set `LLM_FIXTURES_ONLY=true`, so only the fictional fixture cases reach the model. Both adapters are untested against the live services. Enable either only after the owner has authorized sending case text and learner transcripts to that provider.

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
| `ECONNREFUSED 127.0.0.1:5432` | `pnpm db:start`, then `bash scripts/dev-db.sh status` (Windows: `node scripts/platform.mjs dev-db status`) |
| Tests fail with "database … does not exist" | The vitest global setup rebuilds the test template on each run; check that the `sim` role has `CREATEDB` (`pnpm db:start` creates it) |
| Results say "assessment unavailable" | No assessment model is configured and the dev baseline is off. Set `ALLOW_DEV_BASELINE_ASSESSOR=true` for the worker (development only), or configure `LLM_PROVIDER=anthropic` or `LLM_PROVIDER=gemini` with that provider's key |
| The microphone prompt never appears | Browsers allow the microphone only on secure origins; use `http://localhost:3000`, not a LAN IP |
| "Consent required" when speaking | Record microphone consent (and browser-speech consent) in station setup or Account |
| No speech recognition option | Browser recognition needs Chrome or Edge; otherwise configure server ASR (`ASR_PROVIDER=deepgram`) |
| Owner console asks for a code you don't have | Run `pnpm --filter @sim/api run totp`; check your system clock if codes are rejected |
| Playwright cannot find a browser | Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, or install Chromium. The config falls back to `/opt/pw-browsers/chromium` |
| `next-env.d.ts` keeps changing | It is regenerated by every Next.js build or dev run and is git-ignored. Stable type references live in `apps/web/next-types.d.ts` |
| Port 3000 or 4000 already in use | Stop the other process, or set `API_PORT` and update `NEXT_PUBLIC_API_WS_URL` and the web rewrite target |

## Rules that are never relaxed

These are summarized from the specification; see [CLAUDE.md](CLAUDE.md).

- Hidden answers never reach the browser.
- Only owner-approved clinical content is published.
- Fixtures are never counted as clinical cases.
- Patient material is never sent to an external model without per-case clearance and prior quarantine.
- No real charges, public deployment or invitations without the owner's separate authorization.
