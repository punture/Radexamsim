# Deployment plan (provider-neutral)

> **Status, 2026-11-15.** Nothing has been deployed.
>
> - No hosting provider has been chosen or purchased.
> - No live credentials exist: no Anthropic, Deepgram, ElevenLabs, Supabase or Stripe keys, not even test-mode keys.
>
> This document is a plan, not a record of a deployment. Several steps below need the owner's separate, explicit authorization. They are marked **[owner authorization]**: buying a service, making the system reachable from the internet, inviting users, enabling a paid provider, and anything that can move money.

Related: [ROLLBACK.md](ROLLBACK.md) · [BACKUP_RESTORE.md](BACKUP_RESTORE.md) · [MONITORING.md](MONITORING.md) · [DATA_RETENTION.md](DATA_RETENTION.md) · [INCIDENT.md](INCIDENT.md) · [../BILLING_CHECKLIST.md](../BILLING_CHECKLIST.md) · [`.env.example`](../../.env.example) · [../ARCHITECTURE.md](../ARCHITECTURE.md) · [../STATUS.md](../STATUS.md)

## 1. Rules that apply to every step

These come from the product specification and are not relaxed by this plan.

1. **No purchases, no public deployment, no invitations and no real charges** without separate owner authorization.
2. **Stripe stays in test mode** (`sk_test_` keys, test price ids) until the owner authorizes live mode.
3. **Service credentials stay server-side.** Nothing secret goes into a `NEXT_PUBLIC_*` variable, the client bundle, logs, tickets or chat. No code reads a Supabase service-role or secret key. Do not create one for this application.
4. **No storage location is public.** The API streams every object after an authorization check. No bucket, volume or directory is served directly.
5. **A key being present is not permission to process patient material.** Source material is quarantined and de-identified locally with `tools/ingestion` before anything reaches the system or an external service (see [tools/ingestion/README.md](../../tools/ingestion/README.md)).
6. **The owner is the sole human clinical reviewer.** Only owner-approved clinical content is published. Fixtures never run in production.

## 2. Gaps in the code that block a production deployment

These were found by reading and running the code on 2026-11-15. Each must be resolved, or explicitly accepted by the owner, before a production deployment. Items B1 to B4 need engineering work. B5 needs an owner decision, and may also need engineering work.

| ID | Gap | Evidence | Consequence |
|---|---|---|---|
| B1 | **Production sign-in is not wired end to end.** In production the API requires `AUTH_PROVIDER=supabase` and accepts Supabase access tokens as `Authorization: Bearer`. The web app only implements the local email/password form and the local session cookie. It never sends a bearer token. | `apps/api/src/config.ts` (refuses `local` in production); `apps/api/src/auth/plugin.ts`; `apps/web/lib/api.ts`; `apps/web/components/AuthForm.tsx` | With the current code, a production configuration has no working way to sign in from the browser. A managed-auth sign-in flow must be added to the web app, including how tokens reach the API through the `/api` rewrite and the WebSocket ticket call. |
| B2 | **The build artifacts for the API and the worker do not start.** `pnpm build` bundles with esbuild `--packages=external`, which leaves the workspace packages as TypeScript source. `node dist/main.js` then fails under Node 22: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only mode` in `packages/storage/src/index.ts`. Reproduced for both services; the test bundles were deleted afterwards. | `apps/api/package.json`, `apps/worker/package.json` (`build`, `start`) | Until the bundling is fixed, the services can only run through `tsx`, as the end-to-end harness does (`pnpm --filter @sim/api exec tsx src/main.ts`). `tsx` is a development dependency, so the runtime image must include development dependencies. Engineering decision: fix the bundle (include workspace packages) or run under `tsx` deliberately. |
| B3 | **Storage is the local filesystem only.** `LocalFsStorage` is the only driver; `STORAGE_DRIVER` accepts only `local-fs` and is not read. No S3-compatible driver exists. `packages/storage/src/index.ts` refers to `docs/runbooks/STORAGE.md`, which does not exist. | `packages/storage/src/index.ts`; `apps/api/src/deps.ts`; `apps/worker/src/deps.ts` | The API and the worker must mount the **same** private volume at the same absolute `STORAGE_LOCAL_ROOT`: the worker writes exports that the API serves, and the API writes imported images. Versioning and encryption have to come from the volume or host (see BACKUP_RESTORE.md). This limits the deployment to one host or one shared volume. |
| B4 | **No production bootstrap for examination profiles.** Only the development seed inserts `exam_profiles` rows, and the seed refuses `NODE_ENV=production`. | `apps/api/src/services/seed.ts`; `apps/api/src/seed.ts` | A fresh production database has no examination profiles, so no session can be created. A reviewed, production-safe bootstrap is needed: profiles only, no fixtures, no development accounts. |
| B5 | **The per-case "external AI processing" clearance is enforced only for authoring and critique.** The case author and both critics check `externalAiAllowed()`. The live examiner, the assessment pipeline and the optional feedback writer do not. | `packages/clinical-content/src/workflow.ts` (`publicationGate`, `externalAiAllowed`); `apps/worker/src/jobs/content.ts` (checked); `apps/worker/src/jobs/assess.ts`, `apps/worker/src/jobs/debrief.ts`, `apps/api/src/live/session.ts` (not checked) | With `LLM_PROVIDER=anthropic`, the text of every published case goes to the provider during live examining and assessment, together with learner transcripts: stage history, questions, key findings, rubric and reference material. This happens whether or not the case's flag is on. Publication requires privacy and rights clearance, but not this flag. No code path sends image pixels to a model. Owner decision before enabling a model with real cases: accept environment-wide processing of published case text, or require the code to honour the flag first. `docs/ARCHITECTURE.md` §5 and `docs/CASE_AUTHORING.md` §2.6 describe the flag as also covering model assessors; the code does not do that yet. |

### Known operational limitations to plan around

| ID | Limitation | Evidence | Plan |
|---|---|---|---|
| L1 | Sessions that were already paused (`technically_interrupted`) when the API stopped are not picked up again at the next start. Only `active` sessions are recovered. They keep their reserved minutes and never reach finalization unless the learner reconnects. | `apps/api/src/live/registry.ts` (`recoverOrphans`) | Watch for them (MONITORING.md, stuck sessions) and resolve by hand. Engineering fix needed. |
| L2 | Every API process, when it starts, pauses **every** session marked `active` in the database, including sessions served by another healthy process. | `apps/api/src/main.ts`, `apps/api/src/live/registry.ts` | Run exactly one API process (section 3.2). |
| L3 | The retention sweep is enqueued only when the worker starts, once per UTC day. A worker that runs for weeks sweeps only on the day it started. | `apps/worker/src/main.ts` | Restart the worker daily, or add a scheduler. Monitor the last successful sweep (MONITORING.md). |
| L4 | Job leases last 5 minutes with no renewal. An assessment or authoring job can take longer, and a second worker would then claim it again. | `packages/db/src/queue.ts` (`claimJob`); prompt timeouts in `packages/ai/src/prompts/*.ts` | Run one worker process until leases are renewed. |
| L5 | One worker process runs one job at a time. When model calls are timing out, assessment jobs occupy it and delay Stripe events, exports and deletions. | `apps/worker/src/runner.ts` | Watch queue age. In an outage use the kill switches (INCIDENT.md). |
| L6 | `GET /api/health` returns HTTP 200 even when the database is unreachable. The body carries `ok: false`. | `apps/api/src/routes/misc.ts` | Health checks must read the JSON body (MONITORING.md). |

## 3. Components and process model

| Component | Code | Process | Durable state | Scaling with the current code |
|---|---|---|---|---|
| Web app | `apps/web` (Next.js 16) | `next build`, then `next start --port 3000` | None | Any number of processes |
| API and live examination | `apps/api` (Fastify, `@fastify/websocket`) | One Node process: HTTP `/api/*` and WebSocket `/ws` | PostgreSQL; live sessions and socket tickets are also held **in process memory** | **Exactly one process** (see 3.2) |
| Worker | `apps/worker` | One Node process running the job loop | PostgreSQL `jobs` table | One process recommended (L4, L5) |
| Database | `packages/db` (Drizzle, SQL migrations) | PostgreSQL 16 | All state | Managed service with point-in-time recovery |
| Object storage | `packages/storage` | Local filesystem directory (`STORAGE_LOCAL_ROOT`) | Imported case images, learner exports | One volume shared by the API and the worker (B3) |

### 3.1 Web app

- `pnpm --filter @sim/web build`, then `pnpm --filter @sim/web start` (fixed to port 3000 in `apps/web/package.json`).
- The browser calls the API **same-origin** through the rewrite `/api/:path* → ${API_INTERNAL_URL}/api/:path*` (`apps/web/next.config.ts`), so session cookies stay first-party.
- The rewrite destination and the security headers, including the CSP, are written into `.next/routes-manifest.json` at build time. `NEXT_PUBLIC_*` values are compiled into the client bundle. All of these come from the environment at `next build` time. Build with the target environment's values, and rebuild if they change.
- The web tier holds no state.
- Owner case imports (zip, up to 200 MB) also pass through this rewrite. That path has not been tested at that size. Test a realistic import through the full proxy chain before relying on it.

### 3.2 API and live sessions

- **Start.** `pnpm --filter @sim/api exec tsx src/main.ts` (see B2). Startup order:
  1. Load and check the configuration.
  2. Build the providers.
  3. Register the routes.
  4. **Recover orphans**: sessions still marked `active` are paused as a platform failure, from the time of their last durable event.
  5. Listen on `API_HOST:API_PORT`.

  The log line `paused sessions left active by a previous process (platform failure)` reports how many sessions were paused.
- **Production startup checks** (`apps/api/src/config.ts`). With `NODE_ENV=production` the API refuses to start unless all of these hold:
  - `ALLOW_DEV_INJECTION=false`
  - `ALLOW_FIXTURES=false` (the default is `true`, so set it explicitly)
  - `AUTH_PROVIDER=supabase`
  - `AUTH_ENCRYPTION_KEY` does not start with `dev-only`
  - `OWNER_MFA_REQUIRED=true`
  - `LLM_PROVIDER=anthropic`

  It also requires `SUPABASE_URL` when auth is Supabase, and `ANTHROPIC_API_KEY` when the provider is Anthropic. It does **not** refuse `ASR_PROVIDER=dev_injection_only`, which would leave no working voice input in production, so check that by hand.
- **Live examination socket.**
  1. The browser asks for a single-use ticket: `POST /api/sessions/:id/ws-ticket`. Tickets live 60 seconds and are held **in memory** (`apps/api/src/live/tickets.ts`).
  2. It then opens `${PUBLIC_API_WS_URL}/ws?ticket=…`.
  3. In production the socket is closed unless the `Origin` header equals `PUBLIC_WEB_ORIGIN`.

  The browser reconnects automatically, except after close codes 4401 (invalid or expired ticket), 4403 (origin or forbidden) and 4001 (session opened in another window).
- **In-memory live sessions.** `LiveRegistry` (`apps/api/src/live/registry.ts`) keeps one controller per session in the process that loaded it. Every state change is written to PostgreSQL in the same transaction as its durable event. However, `station_sessions` updates do not check `row_version`, so two controllers for one session in two processes would overwrite each other.
- **What this means for scaling:**
  1. **Run exactly one API process** for the pilot.
  2. A ticket issued by one process cannot be redeemed by another. The socket closes with 4401, and the browser stops retrying.
  3. `GET /api/sessions/:id` and the preflight route also load the controller, so both HTTP calls and the socket would need sticky routing by session id. The HTTP calls go through the Next.js rewrite, which makes this harder.
  4. Because of L2, starting a second process pauses the first process's live sessions.
  5. Rate limits are kept in process memory, so each process enforces them separately.

  More than one API process therefore needs engineering work first.
- **Stop and restart.**
  1. On SIGTERM or SIGINT the API finishes each live session's queued work, stops session timers and closes the process.
  2. On the next start, sessions still `active` are paused as `technical_platform` (the clock stops at the last durable event, so no exam time is lost).
  3. The learner's browser reconnects with a new ticket and the station resumes.

  This is tested in `apps/api/test/live.test.ts`: "recovers a live session after an API restart: platform pause, resume on reconnect, no lost time or repeated speech". If the learner does not reconnect within the profile's `maxTechnicalPauseSeconds` (600 s for the ABR and RCPSC profiles, 1800 s for the advanced profile, in `packages/clinical-content/src/profiles.ts` at the time of writing), the station is invalidated, the consumed minutes are credited back automatically and a review item is raised. Sessions already paused before the stop are not recovered (L1). **Deploy the API when no station is active** where possible (query in ROLLBACK.md §3).
- **Limits.**

  | Limit | Value |
  |---|---|
  | JSON request body | 2 MB |
  | Owner import (`application/zip`) | 200 MB |
  | One WebSocket message | 1 MB |
  | Global rate limit | 600 requests per minute per client IP |
  | Sign-in and registration | 10 per minute |
  | Data export and deletion requests | 3 per hour each |
  | Appeals | 10 per hour |
  | Session creation | 20 per minute |
  | WebSocket tickets | 30 per minute |
  | Media frames | 1200 per minute |
  | Stripe webhook | 600 per minute |
  | Case import | 20 per hour |

- **Trusted proxy.** In production Fastify trusts `X-Forwarded-*` headers (`trustProxy`). The API port must be reachable only from your proxy. Otherwise clients can spoof their IP and get around the rate limits. Also check which client address the API actually sees for requests that arrive through the Next.js rewrite. If every request appears to come from the web server, all learners share one rate-limit bucket.
- **Logs.** Pino JSON on stdout, at level `info` in production. The `authorization`, `cookie` and `set-cookie` headers are redacted, and request bodies are not logged. Request URLs are logged: they contain record ids, and the `/ws` URL contains the single-use ticket.

### 3.3 Worker

- **Start.** `pnpm --filter @sim/worker exec tsx src/main.ts` (see B2). The worker refuses `ALLOW_DEV_BASELINE_ASSESSOR=true` in production. It does **not** check `LLM_PROVIDER` or `ALLOW_FIXTURES` there.
- **Loop** (`apps/worker/src/runner.ts`, `packages/db/src/queue.ts`):
  - It claims one job at a time with `FOR UPDATE SKIP LOCKED`.
  - It wakes on `LISTEN jobs_queued`, and otherwise polls every 2 seconds.
  - A lease lasts 5 minutes. Expired leases are put back in the queue.
  - Failed jobs retry after 2 s, doubling up to 10 minutes.
  - After the maximum number of attempts the job becomes `dead` and raises an owner review item.
- **Maximum attempts per job kind.** Default 5, with these exceptions:

  | Job kind | Attempts |
  |---|---|
  | `assess_case_attempt` | 6 |
  | `build_session_debrief`, enqueued when the station ends | 30 |
  | `build_session_debrief`, enqueued after a (re)assessment | 10 |
  | `process_stripe_event` | 8 |

- **Daily retention sweep.** Enqueued at startup only (L3).
- **Liveness.** If `WORKER_HEALTH_PORT` is set, `GET /health` is served on 127.0.0.1 only.
- **Connection pooling.** The worker holds one dedicated connection for `LISTEN`. Through a transaction-mode connection pooler the notifications do not arrive, and the worker falls back to polling every 2 seconds.

### 3.4 PostgreSQL 16

- 37 tables, all created by `0000_init.sql`. Migration `0001_security_policies.sql` enables row-level security on every one of them, with no permissive policies. It also revokes all privileges from the `anon` and `authenticated` roles where those exist. The application connects as the **table owner**, which row-level security does not restrict, so authorization is enforced in the API.
- Triggers protect the integrity of the history:
  - `session_events`: no UPDATE.
  - `usage_ledger`: no UPDATE or DELETE.
  - `transcript_segments`: original text and timing cannot change.
  - `case_assessments`: no UPDATE.
  - `case_attempts`: the version binding cannot change (0003).

  `jobs_notify` wakes the worker. See ROLLBACK.md §4.
- **Connections.** Each service has a pool of up to 10 connections (`packages/db/src/client.ts`). The worker adds one listener. Allow at least about 25 connections for one API, one worker, migrations and administration.
- `gen_random_uuid()` is used for ids. It is built into PostgreSQL 13 and later; no extension is needed.

### 3.5 Private object storage

- **Buckets** (directories under `STORAGE_LOCAL_ROOT`):
  - `derivatives`: imported, de-identified case images. Served only by `/api/media/:handle/:frame` and the owner preview route.
  - `exports`: learner data exports.
  - `recordings`: nothing writes here yet.
  - `quarantine`: the server never writes here. Quarantine lives on the owner's computer, under the ingestion tool's `QDIR`.
- **Safeguards in the code.** Keys are checked against path traversal. Files are created `0600` and directories `0700`. Responses carry `Cache-Control: private, no-store`.
- **Requirements for the volume:**
  1. Persistent and encrypted at rest.
  2. Mounted by the API and the worker at the same absolute path.
  3. Readable only by the service account.
  4. Never exposed by a web server or a static-file route.
  5. Included in backups (BACKUP_RESTORE.md).
- **A future S3-compatible driver** (not implemented) must keep the same rules: a private bucket with public access blocked, server-side encryption, versioning, and no long-lived URLs.

### 3.6 External services (all optional; none configured; none exercised live)

| Service | Called from | What is sent | Enabled by |
|---|---|---|---|
| Anthropic | API (live examiner) | Per-turn menu: stage history text, approved question and reply text, the conversation so far | `LLM_PROVIDER=anthropic` + key; kill switch `examinerLlmDisabled` |
| Anthropic | Worker (assessment, optional feedback summary) | Learner transcript, rubric, key findings, opportunity records; assessed facts and quotes | Same; kill switch `assessmentLlmDisabled`; `USE_LLM_FEEDBACK_SUMMARY` |
| Anthropic | Worker (case author, critics) | Case JSON without image files, the owner's notes and teaching text | Same, **and** the case passes `externalAiAllowed()` |
| Deepgram | API | Learner microphone audio (`ASR_PROVIDER=deepgram`, after `microphone_processing` consent; `mip_opt_out=true`); examiner text (`TTS_PROVIDER=deepgram`) | Key + provider setting; kill switches `serverAsrDisabled`, `serverTtsDisabled` |
| ElevenLabs | API | Examiner text | Key + voice id; kill switch `serverTtsDisabled` |
| Browser vendor | Learner's browser | Microphone audio, when `ASR_PROVIDER=browser` (needs `browser_speech_vendor` consent) | Default setting |
| Supabase | API | Nothing sensitive: the API fetches the public signing keys (JWKS) | `AUTH_PROVIDER=supabase` |
| Stripe | API, and Stripe to API | Customer email and user id (metadata), checkout and portal requests; Stripe sends signed webhooks | Stripe keys and price ids |

No code path sends image pixels to a model (`packages/ai/src/llm/anthropic.ts` supports images, but no caller passes any). Each provider needs the owner's authorization and a data-processing review before it is enabled. See also B5.

### 3.7 The only topology the current code supports without changes

```
Browser ──TLS──▶ reverse proxy ──▶ web (Next.js, :3000) ──rewrite /api/*──▶ API (:4000, one process)
Browser ──WSS──▶ reverse proxy ──────────────────────────────────▶ API /ws
Stripe  ──TLS──▶ reverse proxy ──▶ /api/stripe/webhook (through the web rewrite, or straight to the API)
API (1 process) ─┬─▶ PostgreSQL 16 (private network, TLS)
Worker (1 proc) ─┤
                 └─▶ shared private encrypted volume (STORAGE_LOCAL_ROOT)
```

The WebSocket can live on its own API hostname, for example `PUBLIC_API_WS_URL=wss://api.example.org`. It can also share the web hostname if the proxy sends `/ws` to the API. In that case both `PUBLIC_API_WS_URL` and `NEXT_PUBLIC_API_WS_URL` hold the web origin with `wss://`. If the API has its own public hostname, expose only `/ws` there (and the webhook, if you route it that way). Every other route stays behind the web origin.

## 4. Environments and separation

| | Development | Test / CI | Staging (proposed) | Production (proposed) |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | `production` |
| Data | Fixtures, dev accounts (`pnpm db:seed`) | Per-file databases cloned from a migrated template | Separate database. No production copy without an owner decision | Real learners and owner-approved cases only |
| Auth | Local accounts | Local | Separate managed-auth project | Managed auth (blocked by B1) |
| Fixtures | Allowed | Allowed | Refused by the startup checks | Refused |
| Models and speech | Optional dev keys; dev baseline assessor | Scripted providers | Separate keys with low spending limits **[owner authorization]** | Separate keys **[owner authorization]** |
| Stripe | Test mode, optional | Locally signed payloads | Test mode, its own webhook endpoint and secret | **Test mode until the owner authorizes live mode** |
| Storage | `./var/...` | `var/test-storage` | Its own private volume | Its own private volume |

Rules:

- Never share a database, a storage volume, a key or a webhook secret between environments.
- Never copy production data into development or staging. It contains learner transcripts and personal data.
- Never point a developer `.env` at a shared database. `scripts/dev.sh` runs migrations and the development seed against whatever `DATABASE_URL` it finds.
- A staging environment configured like production refuses fixtures. It can therefore only exercise flows with owner-approved cases, which would put more copies of patient-derived material in more places. **Owner decision:** run staging without clinical content and accept limited testing, or approve specific cases for staging.

## 5. Build and release artifacts

- **Toolchain:** Node.js 22 or later (`engines`), pnpm 10.28.0 (`packageManager`). Run `pnpm install --frozen-lockfile`.
- **Web:** `next build` with the target environment's `API_INTERNAL_URL`, `NEXT_PUBLIC_API_WS_URL` and `NEXT_PUBLIC_BRAND_NAME`. Check the rewrite destination and the CSP in `.next/routes-manifest.json`, then run `next start`.
- **API and worker:** see B2. Until that is fixed, install with development dependencies and run the entry points with `tsx`.
- **Release identity:** deploy only a tagged commit with a clean working tree. Record it in the release notes. The `code` line in `evals/reports/latest.md` must show that commit without `+uncommitted`.
- **Code location:** no git remote is configured (docs/STATUS.md). The repository exists only in the build container until the owner decides where the code is hosted.

## 6. Database migrations

**The migration files:**

- SQL files live in `packages/db/migrations` (`0000`–`0004` at the time of writing).
- They are listed in `packages/db/migrations/meta/_journal.json`.
- `packages/db/src/migrate.ts` (Drizzle's migrator) applies them.

**Command:**

```bash
DATABASE_URL='<target connection string>' pnpm db:migrate
```

**How the migrator behaves:**

- It creates the schema `drizzle` and the table `drizzle.__drizzle_migrations` if they are missing.
- It applies every migration whose journal timestamp is later than the last one applied, **all inside one transaction**.
- There is no lock against two migrators running at once, so run migrations as a single one-off task.
- There are no down migrations.
- The API and the worker never run migrations. Only the development seed does (`apps/api/src/seed.ts`).

**Procedure for every release:**

1. Confirm that a recent backup exists, and note the point-in-time-recovery timestamp just before migrating.
2. Review the new migration files. Are they additive? Do they add triggers? Does each new table enable row-level security? See the conventions below.
3. Run the migration once, as a role that owns the tables, before starting the new application version.
4. Check the result: the expected rows in `drizzle.__drizzle_migrations`, the triggers present, and row-level security on (queries in BACKUP_RESTORE.md §7).
5. Start the worker, then the API, then the web app.

**Conventions for new migrations:**

- **Expand first.** Add nullable columns or columns with defaults. Drop or rename only in a later release.
- **Enable row-level security** in every migration that creates a table. `0001` covered only the tables that existed then.
- **Keep journal timestamps increasing.** Drizzle skips any migration whose timestamp is older than the last applied one.
- **Never rewrite history** in the protected tables. Corrections are new rows.

Migration inventory and rollback classes: ROLLBACK.md §4.

## 7. Seeding and bootstrap data

- **`pnpm db:seed` is development only.** It runs `apps/api/src/seed.ts` and `apps/api/src/services/seed.ts`. It runs migrations first, then creates:
  - the examination profiles;
  - an owner account and a learner account with **known passwords**, and a TOTP secret printed to the console;
  - the three fictional fixture cases, two of them auto-published with the attestation "DEVELOPMENT FIXTURE AUTO-APPROVAL BY SEED SCRIPT — NOT A CLINICAL APPROVAL";
  - ten content requests;
  - the demonstration case id `fx-stroke-lmca`;
  - an active entitlement and 300 minutes for the learner.
- The seed refuses `NODE_ENV=production`, but the guard reads the **NODE_ENV of the shell running it**, not anything in the target database. Never run it, or `scripts/dev.sh`, with a `DATABASE_URL` that points at staging or production.
- **Fixtures in production are prevented by:**
  - `ALLOW_FIXTURES=false`, which the API requires in production;
  - the publication gate, which refuses fixture versions when fixtures are not allowed;
  - the media fallback to fixture images, which is off when `ALLOW_FIXTURES=false`.
- **Production bootstrap.** These items are needed in production and none of them is automated today:

  | Item | State in production |
  |---|---|
  | Examination profiles | Required. No production path exists (B4). |
  | Owner account | Created at the owner's first managed sign-in, if the email is listed in `OWNER_EMAILS`. The role is assigned only when the account is created. Configure managed auth to require email confirmation before sign-up is open, and have the owner sign in first. |
  | Demonstration cases | None without configuration. The owner sets them with `PUT /api/owner/config/demo-cases` (Owner console → Configuration). The fixture fallback applies only when fixtures are allowed. |
  | Kill switches and assessment policy | Default when no row exists: all switches off; two assessment passes always. |
  | Content requests | Not created outside the seed. |

## 8. Pre-deploy checklist

Run on the exact commit to be deployed.

- [ ] Clean working tree, tagged commit, release notes started.
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes against PostgreSQL 16. The tests need a role with `CREATEDB`; the admin connection comes from `TEST_DATABASE_ADMIN_URL`.
- [ ] `pnpm e2e` passes: the Playwright vertical slice with development speech channels.
- [ ] `pnpm evals` has been run on this commit. In `evals/reports/latest.md`:
  - the `code` line names this commit without `+uncommitted`;
  - all regression scenarios pass;
  - examiner leaks are 0;
  - the release gates are recorded below.
- [ ] Model-assessor gate. When a model assessor will be used, run `pnpm evals -- --llm` once. It spends money: **[owner authorization]**. It sends only fixture text, or cases cleared for external AI. No release-gate run with a model assessor exists yet.
- [ ] `pnpm check:leaks` passes. Also scan the exact build being shipped: `node scripts/check-client-bundle-leaks.mjs --dist .next` after building with the production values. The scan looks for fixture clinical truth, rubric text, leak canaries, server-only packages and secret names.
- [ ] Configuration check. Start the API and the worker once in the target environment. The production checks refuse unsafe settings at startup. Also confirm by hand:
  - `ASR_PROVIDER` is not `dev_injection_only`;
  - `BILLING_ENFORCED` is as the owner decided;
  - `STRIPE_SECRET_KEY` begins `sk_test_`, unless live mode has been authorized;
  - `STORAGE_LOCAL_ROOT` is the same absolute path for the API and the worker;
  - `EXPORT_RETENTION_DAYS` matches in both services;
  - the Stripe price ids and `PLAN_*` values are identical in the API and the worker.
- [ ] Migrations reviewed (§6). The backup and point-in-time timestamp are recorded.
- [ ] No station is active, or the owner accepts the pauses (ROLLBACK.md §3).
- [ ] Owner sign-off: the release-gate table below and the decisions in §12.

**Release gates**, from `evals/reports/latest.md`. Regenerate them on the commit being deployed. Status at the time of writing (report `20261115033338-baseline`, code `33ce33d+uncommitted`, development baseline assessor, fictional fixtures):

| Gate | Status |
|---|---|
| Every clinical case is owner-approved | Not met: no clinical cases exist yet |
| No known answer or cross-account access leaks | Met for fixtures. Also run `pnpm check:leaks` |
| All material assessment claims evidence-grounded | Met (144/144 evidence spans) |
| No unresolved critical false-reassurance defect in the locked release suite | Not measurable: needs a run with the configured model assessor |
| Payment/usage reconciliation passes | Met in tests. Stripe test mode has never been exercised against Stripe (no keys) |
| Failures recover as designed | Met in regression tests |

Passing a finite test set does not show the absence of clinical error. The owner decides whether measured performance is acceptable for a limited pilot.

## 9. TLS, cookies, CSP, CORS and proxy settings

**TLS**

- The application speaks plain HTTP: the API on `API_HOST:API_PORT`, Next.js on port 3000. Terminate TLS at the reverse proxy or load balancer.
- Use `https://` for `PUBLIC_WEB_ORIGIN` and `wss://` for `PUBLIC_API_WS_URL` and `NEXT_PUBLIC_API_WS_URL`.
- The application does not send `Strict-Transport-Security`. Add HSTS at the proxy after HTTPS works on every hostname.
- Use TLS on the database connection as your provider documents it.
- Browsers allow the microphone only on secure origins, so voice stations need HTTPS.

**Cookies**

- `sim_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production`. It expires after `SESSION_TTL_HOURS`.
- It is used only by local authentication, which is refused in production.
- The cookie has no `Domain` attribute. Because the browser reaches the API through the web origin, it is a host-only, first-party cookie.
- Cookie-authenticated requests that change state must carry the header `x-sim-csrf: 1`. Requests with a bearer token are exempt (`apps/api/src/http.ts`).

**Content-Security-Policy and headers set by the web app** (`apps/web/next.config.ts`, every path)

```
default-src 'self'
script-src 'self' 'unsafe-inline'            ('unsafe-eval' added only when NODE_ENV=development)
style-src 'self' 'unsafe-inline'
img-src 'self' blob: data:
media-src 'self' blob:
connect-src 'self' <NEXT_PUBLIC_API_WS_URL> <the same URL with ws→http>
worker-src 'self' blob:
frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff · Referrer-Policy: no-referrer · X-Frame-Options: DENY
Permissions-Policy: microphone=(self), camera=(), geolocation=()
```

- The policy is fixed at build time. If `NEXT_PUBLIC_API_WS_URL` is wrong at build time, the browser blocks the live-examination socket.
- `'unsafe-inline'` remains for scripts and styles. Removing it needs nonce support (engineering backlog).
- The API adds `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, and `Cache-Control: no-store` on `/api/*` unless a route sets its own. Media responses add `Cross-Origin-Resource-Policy: same-site` and `Vary: Cookie, Authorization`.

**CORS**

- No CORS plugin is registered and no CORS headers are sent. Browser API calls are same-origin through the rewrite. The WebSocket is protected by its ticket and, in production, by the `Origin` check.
- **Do not add CORS headers at the proxy.** The CSRF design relies on cross-site preflights never being granted.

**Reverse proxy**

- Forward `X-Forwarded-For` and `X-Forwarded-Proto`. Do not let clients reach the API port directly.
- For `/ws`: allow the WebSocket upgrade, and set the idle timeout to at least 120 s. During an active station the server sends a clock message about every 5 s. The browser does not send keep-alive pings, so a socket that is idle before the station starts may be closed and then reopened.
- Allow request bodies of 200 MB on `/api/owner/cases/import` only. Keep the default elsewhere: the API itself limits JSON to 2 MB.
- Do not cache `/api/*`.
- Optional: block `/api/openapi.json`, which is public and lists every route. Owner decision.

## 10. Deployment sequence (plan)

**Phase 0: decisions and authorization**

1. Record the owner's decisions from §12.
2. Resolve B1–B4, and record the decision on B5.
3. Get **[owner authorization]** for each purchase and each external provider.

**Phase 1: staging, no public users**

1. Provision PostgreSQL 16 with point-in-time recovery and encryption at rest, a private encrypted volume, a secrets manager and TLS. **[owner authorization]**
2. Create a separate managed-auth project. Require email confirmation and owner MFA. Leave sign-up closed.
3. Fill the environment from `.env.example` for each service. Put the secrets in the secrets manager.
4. Build the web app with the staging values.
5. Run migrations (§6) and the profile bootstrap (B4).
6. Start the worker, then the API (one process), then the web app.
7. Run the smoke checks (§11).
8. If billing is in scope: in Stripe test mode, register the staging webhook endpoint, set `STRIPE_WEBHOOK_SECRET` and run the scenarios in BILLING_CHECKLIST.md §5.
9. Set up monitoring and alerts (MONITORING.md).
10. Run a restore drill (BACKUP_RESTORE.md §9).

**Phase 2: production.** Only after the owner has explicitly authorized a public deployment, a defined pilot and any invitations.

1. Repeat Phase 1 with production resources and separate credentials.
2. Keep Stripe in test mode unless live mode has been separately authorized (BILLING_CHECKLIST.md §4).
3. Keep sign-up closed until the owner opens it. The owner signs in first.
4. Publish only owner-approved clinical cases. Fixtures are refused.

## 11. Post-deploy smoke checks

1. `GET /api/health` returns `ok: true` and `db: true`. In production it must also return `fixturesAllowed: false` and `devInjection: false`. `providers` must match what was authorized.
2. The startup log of each service shows the expected provider and model setup. The API line is "API ready"; the worker line is "[worker] … started; assessment model: …".
3. The owner signs in with the second factor. Owner console → Configuration shows the providers, the kill switches and the assessment policy. Owner console → Overview shows 0 dead jobs.
4. The dead-job list is empty (`GET /api/owner/jobs/dead`). A `retention_sweep` job has succeeded today.
5. With an owner-approved case: the owner runs an owner preview (Owner console → case → Preview), completes preflight and hears or reads the first question. Owner previews never consume minutes.
6. Media requests for another user's handle return 404, and responses carry `Cache-Control: private, no-store`.
7. If billing is configured in test mode: a webhook test delivery reaches `stripe_events` and is processed. `GET /api/billing/plans` reports `testMode: true`.

## 12. Owner decisions still required

1. **Authorization to proceed at all:** which purchases, which environments, a public deployment, pilot size and invitations.
2. **Hosting provider and region**, including where learner data and transcripts may be stored and processed, and which privacy law applies.
3. **Managed authentication:** provider and project settings (email confirmation, owner MFA, open or invite-only sign-up), and approval of the engineering work for B1.
4. **Database hosting and backup policy:** recovery point and recovery time objectives, backup retention (BACKUP_RESTORE.md).
5. **Storage:** a single host with a shared encrypted volume (supported now), or funding the S3-compatible driver (B3).
6. **External processors.** For each of Anthropic, Deepgram, ElevenLabs and Stripe: whether it is used, its data-processing terms, and spending limits. Whether learner audio may go to Deepgram, to the learner's browser vendor, or to neither.
7. **Model processing of published case text** in live examining and assessment, given B5.
8. **Staging content:** no clinical content, or specific approved cases (§4).
9. **Domains and the product name.** `NEXT_PUBLIC_BRAND_NAME` defaults to the working name "NeuroOral Practice".
10. **Production access:** who holds access to production, the secrets manager and the database, and how access is reviewed.
11. **Billing:** prices, allowances, taxes, refunds, live mode, and whether `BILLING_ENFORCED` stays on for the pilot (BILLING_CHECKLIST.md §4).
12. **Retention periods and legal review** of the draft privacy notice and terms. Changing `POLICY_VERSION` in `apps/api/src/policy.ts` makes every learner consent again before microphone audio is processed (DATA_RETENTION.md).
13. **Monitoring:** alert destinations and response expectations for a one-person operation (MONITORING.md, INCIDENT.md).
14. **Profile verification:** the examination profiles are provisional until the owner verifies them against current official pages (docs/EXAM_PROFILES.md).
15. **Release gates:** acceptance of measured performance before any paid use (§8).
16. **Whether `/api/openapi.json` stays public.**
