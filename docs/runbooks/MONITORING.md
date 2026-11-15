# Monitoring

> **Status, 2026-11-15.** Nothing has been deployed and no monitoring system has been chosen. The application has no metrics exporter, no tracing and no built-in alerting. This runbook lists what to watch, where each value comes from in the code, read-only SQL to collect it, and **alert thresholds that are initial proposals**. Tune them with the owner once real traffic exists. All cost figures are estimates; reconcile them against provider invoices.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) · [INCIDENT.md](INCIDENT.md) · [ROLLBACK.md](ROLLBACK.md) · [BACKUP_RESTORE.md](BACKUP_RESTORE.md)

## 1. Sources of truth

| Source | Where in the code | What it gives | Access |
|---|---|---|---|
| Health endpoint | `GET /api/health`, `apps/api/src/routes/misc.ts` | `{ ok, db, providers: { llm, asr, tts }, fixturesAllowed, devInjection }` | Public. **Returns HTTP 200 even when `ok` is false**: read the body. |
| Worker liveness | `WORKER_HEALTH_PORT` → `GET /health`, `apps/worker/src/main.ts` | Process is alive (`{ ok, worker }`). It does not check the database or the queue. | 127.0.0.1 only |
| Owner metrics | `GET /api/owner/metrics?days=N` (1–365, default 30), `apps/api/src/routes/owner.ts`; Owner console → Metrics | Per model role: calls, ok rate, p50 and p95 latency, tokens, estimated cost. Cost total and per completed station. Live examiner decision latency and image acknowledgement latency (p50, p95). Interruptions and technical pauses. Assessment totals with provisional and withheld rates and disputed elements. Sessions (total, completed, invalidated). | Owner role and second factor |
| Owner overview | `GET /api/owner/overview`; Owner console home | Open review items by kind and priority, case pipeline, content requests, **count of dead jobs** | Owner |
| Owner review items | `GET /api/owner/review-items?status=open&priority=&kind=` | The exception queue: up to 500 rows, urgent first | Owner |
| Dead jobs | `GET /api/owner/jobs/dead`; requeue with `POST /api/owner/jobs/requeue-dead` | Up to 200 dead jobs: id, kind, attempts, last error (credentials redacted), time | Owner |
| `model_calls` table | Written by `recordModelCall` in `apps/api/src/deps.ts` and `apps/worker/src/deps.ts` | One row per model call attempt: role, provider, served model, prompt id and version, session, attempt and case version ids, status, error class, latency, tokens, estimated cost | Database |
| `session_events` table | `packages/db/src/events.ts`, `apps/api/src/live/session.ts` | The durable station timeline (event types in §3.5) | Database |
| `jobs`, `station_sessions`, `usage_ledger`, `stripe_events`, `data_requests`, `owner_review_items`, `case_assessments` | `packages/db/src/schema.ts` | Queue, session states, open reservations, webhook backlog, privacy requests, exceptions, assessor kinds | Database |
| Logs | API: pino JSON on stdout (`apps/api/src/server.ts`). Worker: console lines (`apps/worker/src/main.ts`, `runner.ts`). Live sessions: `console.error("[live <id>] …")` | Startup provider lines, restart recovery count, unhandled errors (name and message only) | Host log store |
| Provider dashboards | Anthropic, Deepgram, ElevenLabs, Stripe | Real usage, invoices and webhook delivery logs. **Speech usage is not recorded by the application.** | Owner accounts |

Not collected:

- `metric_samples` is read by the metrics endpoint, but nothing writes to it. `clientSamples` is always 0, and end-of-turn-to-audible-response latency is not measured.
- There is no count of open WebSocket connections. Use `connection.opened` and `connection.closed` events if needed.

## 2. What the owner metrics actually measure

Read these definitions before comparing numbers (`apps/api/src/routes/owner.ts`):

- **`cost.totalEstimatedUsd`** sums `model_calls.estimated_cost_usd` for **all** roles in the window, including case authoring, critics and owner-preview examiner calls.
- **`cost.perCompletedStationUsd`** divides that total by the number of completed sessions that are not owner previews. Authoring work therefore inflates it. §5 has a query restricted to station-linked calls.
- **`live.examinerDecisionP50Ms` and `P95Ms`** come from `policy.decision` events. They include the examiner model call when one is made, but not speech synthesis or network time.
- **`live.imageAckP50Ms` and `P95Ms`** are the time from `viewer.command_sent` to `viewer.rendered` for the same command id.
- **`ownerExceptionsOpened`** counts review items that were created in the window **and are still open**.
- **`sessions.total`** includes owner previews and aborted sessions. `completed` excludes owner previews. `invalidated` counts outcome `invalidated_technical`.

## 3. What to watch

### 3.1 Service health

```text
GET /api/health → alert unless body.ok == true && body.db == true
                  in production also alert if body.fixturesAllowed == true or body.devInjection == true
```

- Log lines worth alerting on:
  - `paused sessions left active by a previous process (platform failure)`: the API restarted while stations were live.
  - `unhandled error`: an error not handled by any route.
  - `[worker] runOnce failed`: the worker could not claim or record a job, often a database problem.
  - Any startup line showing an unexpected provider. In production the API must never show `none` for the model, and the worker must not show "DEV BASELINE ASSESSOR".
- Process restarts: count unexpected restarts of the API and the worker.

### 3.2 Dead jobs and owner review items

Every job that exhausts its attempts becomes `dead` and raises a review item of kind `technical_failure_adjustment`, titled "Background job failed permanently: <kind>" (`packages/db/src/queue.ts`).

```sql
-- Dead jobs by kind (newest first)
SELECT kind, count(*) AS dead, max(updated_at) AS latest
FROM jobs WHERE status = 'dead' GROUP BY kind ORDER BY latest DESC;

-- Open owner review items by priority and kind
SELECT priority, kind, count(*) AS open, min(created_at) AS oldest
FROM owner_review_items WHERE status = 'open'
GROUP BY priority, kind ORDER BY priority, kind;
```

Review-item kinds raised by the code at the time of writing:

| Kind | Raised by |
|---|---|
| `technical_failure_adjustment` | Dead jobs; invalidated sessions; Stripe disputes and refunds; assessment unavailable |
| `learner_appeal` | A learner files an appeal |
| `case_ready_for_approval` | A case passes the automated checks |
| `uncertain_finding` | Critic issues needing an owner decision; uncertain assessment findings |
| `assessment_disagreement` | Assessors A and B disagree materially |
| `consequential_grading_risk` | Grading-risk conditions, for example a second pass that did not run |
| `rights_privacy_concern` | Case withdrawal |

Stripe disputes are raised as `urgent`.

### 3.3 Queue

```sql
-- Backlog and age per kind
SELECT kind, status, count(*) AS n, now() - min(run_at) AS oldest_due
FROM jobs WHERE status IN ('queued','running') AND run_at <= now()
GROUP BY kind, status ORDER BY oldest_due DESC;

-- Jobs running longer than 15 minutes (the lease is 5 minutes; long model calls or a stuck worker)
SELECT id, kind, locked_by, now() - locked_at AS running_for, attempts
FROM jobs WHERE status = 'running' AND locked_at < now() - interval '15 minutes';

-- Last successful retention sweep (enqueued only at worker start; see DEPLOYMENT.md L3)
SELECT max(updated_at) AS last_success FROM jobs WHERE kind = 'retention_sweep' AND status = 'succeeded';
```

### 3.4 Model calls (`model_calls`)

`status` is one of `ok`, `invalid_output`, `timeout`, `provider_error`, `refused`, `budget_exceeded` or `disabled`. With the current code paths, the examiner and assessment kill switches skip the call before it is made, so `disabled` rows are not expected. The case author and the critics are not covered by any kill switch. They run only after an owner action (submitting a draft for checks, or requesting a critique or a draft), and only when the case's clearance allows it.

```sql
-- Health per role, last hour
SELECT role, count(*) AS calls,
       round(avg((status = 'ok')::int)::numeric, 3)          AS ok_rate,
       count(*) FILTER (WHERE status = 'timeout')             AS timeouts,
       count(*) FILTER (WHERE status = 'provider_error')      AS provider_errors,
       count(*) FILTER (WHERE status = 'refused')             AS refusals,
       count(*) FILTER (WHERE status = 'budget_exceeded')     AS budget_exceeded,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
       round(sum(estimated_cost_usd)::numeric, 4)             AS est_usd
FROM model_calls WHERE created_at >= now() - interval '1 hour'
GROUP BY role ORDER BY role;

-- Calls that used tokens but were costed at $0 (served model missing from the price table)
SELECT model, count(*) AS calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
FROM model_calls WHERE estimated_cost_usd = 0 AND (input_tokens + output_tokens) > 0
GROUP BY model;
```

### 3.5 Live examination (`session_events`)

Event types include:

- session: `session.started`, `session.technical_pause`, `session.resumed`, `session.ended`;
- connection: `connection.opened`, `connection.closed`;
- viewer: `viewer.command_sent`, `viewer.rendered`, `viewer.render_failed`;
- examiner: `examiner.utterance_planned`, `examiner.audio_completed`, `examiner.audio_interrupted`, `examiner.audio_failed`;
- other: `policy.decision`, `transcript.segment_finalized`, `usage.reserved`, `usage.consumed`.

The full list is in `packages/contracts/src/events.ts`.

```sql
-- Examiner proposer mix and rejection reasons, last 24 h
-- proposer = 'llm' or 'deterministic_fallback'
SELECT payload->>'proposer' AS proposer, payload->>'rejectionReason' AS rejection, count(*)
FROM session_events WHERE type = 'policy.decision' AND server_time >= now() - interval '24 hours'
GROUP BY 1, 2 ORDER BY 3 DESC;

-- Technical pauses by reason per day ('technical_connection' | 'technical_platform')
SELECT date_trunc('day', server_time) AS day, payload->>'reason' AS reason, count(*)
FROM session_events WHERE type = 'session.technical_pause'
GROUP BY 1, 2 ORDER BY 1 DESC;

-- Image render failures per day
SELECT date_trunc('day', server_time) AS day, count(*)
FROM session_events WHERE type = 'viewer.render_failed' GROUP BY 1 ORDER BY 1 DESC;

-- Session outcomes, last 7 days
SELECT outcome, mode, count(*) FROM station_sessions
WHERE ended_at >= now() - interval '7 days' GROUP BY 1, 2 ORDER BY 3 DESC;
```

### 3.6 Stuck sessions and held minutes

```sql
-- Sessions that should have finished
-- (longest station is 25 min; maximum technical pause is 10-30 min per profile)
SELECT id, user_id, mode, status, created_at, started_at
FROM station_sessions
WHERE status IN ('active','technically_interrupted','finalizing')
  AND coalesce(started_at, created_at) < now() - interval '2 hours'
ORDER BY created_at;

-- Reservations never released (minutes held from the learner)
SELECT r.user_id, r.session_id, -r.minutes AS reserved_minutes, r.created_at
FROM usage_ledger r
WHERE r.kind = 'reserve'
  AND NOT EXISTS (SELECT 1 FROM usage_ledger x WHERE x.idempotency_key = 'release:' || r.session_id::text)
  AND r.created_at < now() - interval '2 hours';
```

Sessions left `technically_interrupted` across an API restart are not resumed automatically (DEPLOYMENT.md, L1). There is no endpoint to finalize them. Escalate to engineering, and decide on a minute adjustment (INCIDENT.md §4.5).

### 3.7 Assessments

```sql
-- Assessor kinds in the last 7 days ('dev_baseline' must be 0 in production)
SELECT assessor_kind, count(*) AS n,
       round(avg(provisional::int)::numeric, 3) AS provisional_rate,
       round(avg(withheld::int)::numeric, 3)    AS withheld_rate
FROM case_assessments WHERE created_at >= now() - interval '7 days'
GROUP BY assessor_kind;

-- Assessment jobs that finished as "unavailable" (not retried automatically; see INCIDENT.md §4.3)
SELECT payload->>'caseAttemptId' AS case_attempt_id, updated_at
FROM jobs WHERE kind IN ('assess_case_attempt','reassess_after_appeal')
  AND status = 'succeeded' AND result->>'available' = 'false'
ORDER BY updated_at DESC;
```

### 3.8 Billing

```sql
-- Webhook events not yet processed
SELECT type, livemode, count(*) AS pending, min(received_at) AS oldest
FROM stripe_events WHERE status = 'pending' GROUP BY 1, 2;

-- Any live-mode event (must be 0 until the owner authorizes live mode)
SELECT count(*) FROM stripe_events WHERE livemode = true;
```

- Owner adjustments appear as `usage.adjusted` audit events and as `adjust` ledger entries with actor = the owner's user id.
- Webhook signature failures return 400 `invalid_signature`. Watch the Stripe dashboard's delivery log and the API access log.

### 3.9 Privacy requests

```sql
-- Export or deletion requests not completed within 24 h
SELECT id, kind, status, created_at FROM data_requests
WHERE status IN ('requested','processing') AND created_at < now() - interval '24 hours';
```

- A failed export or deletion job leaves its request in `processing`. The code never sets `failed`. A dead-job review item is raised.
- A second deletion request from the same learner creates a new `data_requests` row but no new job, because the job dedupe key is per user. That row stays `requested`.

## 4. Infrastructure (provider-neutral)

Watch these at whatever host is chosen:

- CPU and memory of the API and worker processes;
- free space on the storage volume and the database;
- database connections (each service's pool is 10, plus the worker's listener);
- replication or archiving lag;
- **success of every backup and WAL-archiving job**;
- certificate expiry;
- reverse-proxy 5xx rates and WebSocket upgrade failures.

## 5. Cost monitoring per completed station

**Definitions.** A *completed station* is a `station_sessions` row with `status = 'complete'` and `mode <> 'owner_preview'`. Station-linked model cost is every `model_calls` row whose `session_id` is that session:

- live examiner calls;
- assessment calls (extraction, assessors, adjudication);
- feedback-writer calls.

Authoring and critique calls have no session and are reported separately.

```sql
-- Estimated model cost per completed station, last 30 days
WITH s AS (
  SELECT id FROM station_sessions
  WHERE status = 'complete' AND mode <> 'owner_preview' AND ended_at >= now() - interval '30 days'
), per AS (
  SELECT s.id, coalesce(sum(m.estimated_cost_usd), 0) AS usd
  FROM s LEFT JOIN model_calls m ON m.session_id = s.id GROUP BY s.id
)
SELECT count(*) AS completed_stations,
       round(sum(usd)::numeric, 2) AS est_usd,
       round((sum(usd) / nullif(count(*), 0))::numeric, 4) AS est_usd_per_station,
       round(percentile_disc(0.95) WITHIN GROUP (ORDER BY usd)::numeric, 4) AS p95_station_usd
FROM per;

-- Breakdown by role
SELECT m.role, count(*) AS calls, round(sum(m.estimated_cost_usd)::numeric, 4) AS est_usd
FROM model_calls m JOIN station_sessions s ON s.id = m.session_id
WHERE s.status = 'complete' AND s.mode <> 'owner_preview' AND s.ended_at >= now() - interval '30 days'
GROUP BY m.role ORDER BY est_usd DESC;

-- Authoring and critique cost (not linked to a station)
SELECT role, count(*) AS calls, round(sum(estimated_cost_usd)::numeric, 4) AS est_usd
FROM model_calls WHERE session_id IS NULL AND created_at >= now() - interval '30 days'
GROUP BY role;
```

**Caveats that come from the code:**

- **Estimates, not invoices.** Costs come from token counts and the price table `DEFAULT_PRICES` in `packages/ai/src/llm/runner.ts`. At the time of writing the table holds `claude-opus-5-5` ($4 input, $20 output per million tokens), `claude-sonnet-5-5` ($2 / $10) and `claude-haiku-5-5` ($0.10 / $0.50, without the higher rate that applies to long prompts). Any other model id, including one that served a response through a server-side fallback, is costed at **$0**. That also means the per-session and per-assessment spending caps never stop it (§3.4 query).
- **Speech is not included.** Deepgram and ElevenLabs usage is not recorded. Take it from the provider dashboards and divide by completed stations yourself.
- **Hosting, storage and Stripe fees are not included.**
- **Debrief retries can repeat feedback-writer calls.** While a debrief waits for other cases' assessments, each retry of `build_session_debrief` calls the optional feedback writer again for cases already assessed (up to 30 attempts; `apps/worker/src/jobs/debrief.ts`). Watch the `feedback_writer` call count per station.
- **Requeued and reassessment jobs call the model again.**
- **Spending caps are per unit, not global.** `SESSION_SPEND_CAP_USD` (default $3) applies to examiner calls in one live session. `ASSESSMENT_SPEND_CAP_USD` (default $5) applies to one assessment job. Nothing in the code caps total daily spend. Set spending limits in each provider's account (owner decision).
- **Projection for comparison only.** About $0.85 per 3-case station for model calls, excluding speech, storage and hosting, from `evals/reports/latest.md` §7. It is a projection from rendered prompts, not a measurement.

**Monthly reconciliation:**

1. Compare the estimated model cost for the month with the Anthropic invoice.
2. Add the speech provider invoices.
3. Divide by completed stations.
4. Record the result with the owner.

## 6. Alert thresholds: initial proposals

All values are starting points to review with the owner after the first weeks of real use. "Notify" means a message to the owner's chosen channel. "Page" means an immediate alert. Who receives pages, and when, is an owner decision (INCIDENT.md §2).

| Signal | Source | Proposed threshold | Level |
|---|---|---|---|
| Health check fails | `/api/health` body | `ok != true` on 2 consecutive checks 1 minute apart | Page |
| Unsafe production flags | `/api/health` | `fixturesAllowed` or `devInjection` true | Page |
| Unexpected API restart with live stations | Log line "paused sessions left active…" | Any, outside a planned deploy | Notify |
| Worker not running | Worker liveness, or no job claimed while jobs are due | Oldest due queued job > 10 min | Notify; > 30 min page |
| Dead jobs | `jobs`, owner overview | Any new dead job: notify. ≥ 5 in 1 hour, or any dead `process_stripe_event`, `data_deletion` or `data_export`: page | Notify / page |
| Long-running jobs | §3.3 | Any job running > 15 min | Notify |
| Retention sweep | §3.3 | No success in the last 26 hours | Notify |
| Model errors per role | §3.4 | ok rate < 95% over 1 hour with ≥ 20 calls: notify. < 80%: page | Notify / page |
| Examiner fallback share | §3.5 | Deterministic fallbacks > 20% of decisions in 1 hour while the examiner model is enabled | Notify |
| Examiner decision latency | Owner metrics | p95 > 2,000 ms (the timeout is 2,500 ms) | Notify |
| Image acknowledgement latency | Owner metrics | p95 > 5,000 ms (the server gives up at 12,000 ms) | Notify |
| Render failures | §3.5 | > 2% of `viewer.command_sent` in a day | Notify |
| Technical pauses | §3.5 | > 0.2 per completed station over a day, or any `technical_platform` pause outside a deploy | Notify |
| Invalidated stations | §3.5 | ≥ 1 per day | Notify |
| Stuck sessions | §3.6 | Any | Notify |
| Held reservations | §3.6 | Any older than 2 hours | Notify |
| Dev baseline in production | §3.7 | Any `dev_baseline` assessment | Page |
| Withheld or provisional rate | §3.7 | Above 30% over 7 days, or doubled from the previous week | Notify |
| Unavailable assessments | §3.7 | Any in production | Notify |
| Urgent review items | §3.2 | Any open urgent item (for example a payment dispute) | Notify immediately |
| Normal review items | §3.2 | Open longer than 3 days | Daily digest |
| Stripe backlog | §3.8 | Pending event older than 15 min | Notify |
| Live-mode Stripe event | §3.8 | Any, before live mode is authorized | Page |
| Privacy requests | §3.9 | Any older than 24 hours | Notify |
| Cost per completed station | §5 | > 2× the trailing 7-day median, or above an owner-set ceiling (proposal: $2.00 model cost) | Notify |
| Daily model spend | `model_calls` | Above the owner-set daily budget | Page |
| Unpriced model calls | §3.4 | Any rows | Notify |
| Storage or database disk | Host | > 80% used | Notify; > 90% page |
| Backup or archiving job | Host | Any failure | Page |
| TLS certificate | Host | < 14 days to expiry | Notify |
