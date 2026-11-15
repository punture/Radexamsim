# Incident response

> **Status, 2026-11-15.** Nothing has been deployed and there have been no incidents. This runbook covers the incident types the code can produce, using the levers the code provides. The owner, a practising neuroradiologist, is the sole human clinical reviewer and the decision-maker for clinical, privacy, billing and communication decisions. Response targets are **initial proposals** for a one-person operation.

Related: [MONITORING.md](MONITORING.md) · [ROLLBACK.md](ROLLBACK.md) · [BACKUP_RESTORE.md](BACKUP_RESTORE.md) · [DATA_RETENTION.md](DATA_RETENTION.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

## 1. Severity levels

| Level | Definition | Examples | Proposed response |
|---|---|---|---|
| **SEV-1: critical** | Ongoing or likely harm to privacy, safety or money | Identifiable patient data in an asset or sent somewhere it should not go; hidden answers or another learner's data visible to learners; a database credential or live Stripe key exposed; real charges made without authorization; clinical content that could teach a dangerous error, being shown now | Owner informed within 1 hour; containment at once; post-incident review required |
| **SEV-2: high** | The service is unusable for everyone, or many learners are affected | API or database down; provider outage with no working fallback; systematic grading defect; wrong minutes or entitlements for several learners; a provider key exposed with no sign of misuse; privacy requests overdue | Owner informed the same day; containment within hours; review required |
| **SEV-3: moderate** | One learner or attempt affected, or degraded service with a working fallback | One wrong result found by an appeal; one dead job; examiner falling back to the deterministic policy | Handled in the normal owner queue; short note |
| **SEV-4: low** | No learner impact | Cosmetic or documentation issue | Backlog |

When unsure, choose the higher level, and lower it once the facts are clear.

## 2. First 15 minutes (every incident)

1. **Open an incident record.** Note the time, the reporter, the symptoms, the severity and the lead person. Keep it private. **Never paste secrets, patient images, identifiers or learner transcripts into chat, tickets or AI tools.** Refer to records by id.
2. **Establish the scope** with the queries in MONITORING.md: health, dead jobs, review items, stuck sessions, model-call errors.
3. **Contain with the smallest lever**: a kill switch, `disabledCaseIds`, withdrawal, a rollback (ROLLBACK.md §2).
4. **Preserve evidence.** Do not delete rows, logs or files unless deletion is the containment itself. Note what you changed and when.
5. **Inform the owner**, with the facts, the severity and the decision needed.

## 3. Owner levers referenced below

All of these need the owner role and a verified second factor. The console pages call the same endpoints.

| Lever | Console | Endpoint |
|---|---|---|
| Kill switches, `disabledCaseIds` | Configuration | `PUT /api/owner/config/switches` (send all five fields; read them first with `GET /api/owner/config`) |
| Withdraw a case (one-way) | Case page → Withdraw | `POST /api/owner/cases/:caseId/withdraw` `{ reason }` |
| Retire a version | Case page | `POST /api/owner/case-versions/:versionId/retire` |
| Reassess an attempt | Attempt page | `POST /api/owner/case-attempts/:id/reassess` `{ reason }` |
| Owner decision on an element | Attempt page | `POST /api/owner/case-attempts/:id/resolve-element` |
| Resolve an appeal | Appeals | `POST /api/owner/appeals/:id/resolve` |
| Adjust minutes | Sessions → Adjust | `POST /api/owner/users/:id/adjust-minutes` `{ minutes, reason }` |
| Dead jobs | Configuration | `GET /api/owner/jobs/dead`, `POST /api/owner/jobs/requeue-dead` `{ ids }` |
| Review queue | Home | `GET /api/owner/review-items`, `POST /api/owner/review-items/:id/resolve` |

## 4. Playbooks

### 4.1 Suspected clinical-content error or answer leak

**Signals.** A learner report or appeal; the owner's own review; a critic issue; a leak canary or `pnpm check:leaks` failure; examiner text that reveals an expected answer.

**Severity.** SEV-1 if hidden answers or unsafe teaching are visible to learners now. Otherwise SEV-2 or SEV-3.

1. **Identify** the case id and version. The attempt view (Owner console → Attempts) shows the case version an attempt was examined on.
2. **Stop the exposure:**
   - *Reversible:* add the case id to `disabledCaseIds`. New sessions stop selecting it, including the demonstration case. Past attempts keep their images.
   - *One-way:* **withdraw** the case. This stops selection, clears its published version, revokes media access for every attempt (image requests from live stations and replays then fail) and raises a review item with the number of affected attempts. A withdrawn case **cannot be republished**: no endpoint undoes a withdrawal, so a corrected case needs a new case id. Withdraw when learners must not see the content again.
3. **Stations in progress** that use the case are not ended. Their images stop loading. The render failures make dependent rubric elements "not assessable". Consider whether to contact those learners.
4. **Debriefs already released keep their stored text.** Withdrawal does not change stored debriefs, and no endpoint retracts them. List the affected learners:

   ```sql
   SELECT a.user_id, a.session_id, a.id AS case_attempt_id, a.case_version_id, s.status, s.ended_at
   FROM case_attempts a JOIN station_sessions s ON s.id = a.session_id
   WHERE a.case_version_id IN (SELECT version_id FROM case_versions WHERE case_id = :case_id)
   ORDER BY s.ended_at;
   ```

   The owner decides on notice and corrections. An owner decision on an element creates a new assessment version and a new debrief version. Reassessment uses the attempt's frozen inputs, including the case version it was examined on. Correcting the case does not change past attempts.
5. **If the leak comes from code**, for example an API response exposing hidden fields for every case, treat it as SEV-1:
   1. Block new stations by listing every published case in `disabledCaseIds`.
   2. Roll back the application (ROLLBACK.md §3).
   3. Run `pnpm check:leaks` against the deployed build, and the cross-account end-to-end test.
6. **Correct the content.** Create a new version and get renewed owner approval, or create a new case after a withdrawal. Consider minute adjustments for affected learners.

### 4.2 Privacy incident or identifiable data found in an asset

**Severity.** SEV-1.

1. **Withdraw the case at once.** This revokes learner media access. The owner preview route still shows the images to the owner, for review.
2. **Do not make more copies.** No screenshots to chat or email, no uploads to AI tools, no forwarding.
3. **Establish who saw it.**

   ```sql
   SELECT h.user_id, h.session_id, h.asset_id, h.disclosed_at
   FROM asset_handles h
   WHERE h.case_version_id IN (SELECT version_id FROM case_versions WHERE case_id = :case_id)
   ORDER BY h.disclosed_at;
   ```

   Handles belonging to learners who have since deleted their accounts are gone.
4. **Establish whether case text left the system.** No code path sends image pixels to a model. Case text does go to Anthropic during live examining, assessment and feedback whenever a model is configured (DEPLOYMENT.md, B5).

   ```sql
   SELECT role, provider, model, count(*) AS calls, min(created_at), max(created_at)
   FROM model_calls
   WHERE case_version_id IN (SELECT version_id FROM case_versions WHERE case_id = :case_id)
   GROUP BY role, provider, model;
   ```

5. **Find every copy:**
   - `STORAGE_LOCAL_ROOT/derivatives/cases/<caseId>/…` on the volume;
   - volume snapshots and database backups;
   - any staging copy;
   - learner exports, which contain debrief text but not images;
   - the owner's local ingestion workspace.
6. **Remove or secure the files.** No endpoint deletes derivative images. An authorized operator removes them from the volume **after** the owner and legal advisers decide what evidence must be kept. The case-version record stays in the database. Backups cannot be edited; they expire under the backup policy (BACKUP_RESTORE.md §7).
7. **Legal and contractual duties.** The owner consults counsel. Notification duties and deadlines may apply under privacy law and under any agreement with the institution the material came from.
8. **Root cause and recurrence.** Review the ingestion step for this source. The ingestion README lists the limits: no OCR without `tesseract`, no face detection, a documented subset of the DICOM profile. Re-check the other cases from the same source or case family.

Other privacy incidents follow the same order: contain, scope, preserve, decide. Examples:

- a code defect showing one learner's data to another: roll back, then assess exposure;
- an export file sent to the wrong person;
- transcripts appearing in logs.

### 4.3 Provider outage

| Provider | What the code does automatically | Levers |
|---|---|---|
| Anthropic: live examiner | Each decision waits up to `EXAMINER_LLM_TIMEOUT_MS` (2,500 ms), then the deterministic approved-question policy decides. Stations continue. | `examinerLlmDisabled` removes the wait on every turn. |
| Anthropic: assessment, fast failures | Jobs retry with about a minute of backoff, then become `dead` and raise review items. Debriefs show those cases as "unavailable". | After recovery, requeue the dead jobs. Assessments then run and new debrief versions are built. |
| Anthropic: assessment, slow failures (timeouts) | Each attempt of each prompt can take up to its timeout (90–180 s), so one assessment can occupy the single worker for many minutes. Stripe events, exports and deletions wait behind it (DEPLOYMENT.md, L5). | Turn on `assessmentLlmDisabled`. Jobs then finish quickly as "unavailable"; they are not dead and are not retried. After recovery, switch it off and **reassess each affected attempt** (query in MONITORING.md §3.7). Every reassessment costs money. |
| Deepgram speech recognition | A stream error or a failed connection pauses the station as a platform failure, so the learner's clock stops. If it is not resolved within the profile's maximum pause, the station is invalidated and the minutes are credited automatically. | `serverAsrDisabled` refuses new streams but gives **no voice fallback**. For a longer outage, set `ASR_PROVIDER=browser` and restart the API. This pauses live stations. Learners then need Chrome or Edge and `browser_speech_vendor` consent. |
| ElevenLabs or Deepgram speech synthesis | The question is shown on screen ("Examiner audio failed"). The browser waits about 12 s before treating it as delivered. | `serverTtsDisabled` stops the calls (same 12 s wait). For a longer outage, `TTS_PROVIDER=browser` and restart. |
| Stripe | Checkout and portal requests fail with an error. Webhooks wait at Stripe. Existing entitlements are unaffected: the app does not call Stripe to check access. | After recovery, check Stripe's delivery log and resend failed events (duplicates are ignored). Check `stripe_events` for pending rows. |
| Managed auth (Supabase) | Sign-in fails. The API may also stop accepting tokens if it cannot refresh the provider's signing keys. | No fallback: local auth is refused in production. Wait, and tell the learners. |
| PostgreSQL | Everything fails. `/api/health` shows `ok: false`. Live sessions report "A technical problem occurred". | After recovery, **restart the API** so live sessions reload from durable state. Then check stuck sessions, the queue and dead jobs. |
| Storage volume | Images return 502, so renders fail. Imports and exports fail. | Restore the volume. Then check dead jobs. |

Kill switches take effect immediately and need no restart. Changing a provider setting needs a restart, which pauses live stations (ROLLBACK.md §3). Record each switch change in the incident log; `config.switches` audit events also record them.

### 4.4 Grading defect

**Signals.** Appeals; the owner's attempt reviews; `assessment_disagreement` or `consequential_grading_risk` items; rising withheld or provisional rates (MONITORING.md §3.7); an evaluation regression.

**Severity.** SEV-2 if systematic, for example after a prompt, model or code change. SEV-3 if isolated.

1. **Scope.** Which prompt version, model and time window?

   ```sql
   SELECT p.provenance->>'promptVersion' AS prompt_version, p.provenance->>'model' AS model,
          p.stage, count(*) AS passes, min(p.created_at), max(p.created_at)
   FROM assessment_passes p WHERE p.created_at >= :since
   GROUP BY 1, 2, 3 ORDER BY 5;
   ```

2. **Contain:**
   - roll back the release or the model setting (`MODEL_ASSESSOR_A`, `MODEL_ASSESSOR_B` and so on; restart the worker);
   - make sure the assessment policy is `secondPass: "always"`;
   - if new results would be actively misleading, turn on `assessmentLlmDisabled`. New results then show as unavailable rather than wrong.
3. **Correct the affected attempts:**
   - **Reassess** (`POST /api/owner/case-attempts/:id/reassess`). This forces a second pass, writes a new assessment version and builds a new debrief version. History is kept. Each request enqueues a new job and costs money, so do not repeat clicks.
   - **Owner decisions** on single elements (`resolve-element`) also create new versions. A credited or "incorrect" status needs a verified candidate quote.
4. **Appeals.** Learners appeal from their results (`POST /api/appeals`, 10 per hour). Each appeal raises a `learner_appeal` review item. The owner resolves it as upheld, revised or rejected. Transcript corrections are stored as new revisions and always trigger a reassessment.
5. **Communicate** with learners whose results changed (§5).
6. **Prevent recurrence.** Add the failing pattern to the evaluation set. Re-run `pnpm evals` on the tuning split. Never tune on the locked final split.

### 4.5 Billing defect

**Severity.** SEV-1 if real money moved without authorization. SEV-2 if many learners' minutes or entitlements are wrong. SEV-3 for one learner.

1. **Confirm the Stripe mode:**
   - `GET /api/billing/plans` returns `testMode: true`;
   - `SELECT count(*) FROM stripe_events WHERE livemode` returns 0;
   - `STRIPE_SECRET_KEY` begins `sk_test_`.

   If a live key is present without authorization:
   1. Remove it and restart the API.
   2. Check Stripe for live charges and subscriptions.
   3. The owner decides on refunds and cancellations in Stripe.
   4. Rotate the key.
2. **Read the learner's ledger:**

   ```sql
   SELECT created_at, kind, minutes, session_id, period_key, reason, actor, idempotency_key
   FROM usage_ledger WHERE user_id = :user_id ORDER BY created_at;
   ```

3. **Correct with an owner adjustment** (minutes −1000 to 1000, with a reason). Each request writes a **new** entry with a fresh idempotency key, so check the ledger before submitting again. The ledger itself cannot be edited.
4. **Held minutes from stuck sessions** (MONITORING.md §3.6). No endpoint releases a reservation. An adjustment can compensate a blocked learner, but the open reservation also reduces the balance after the next period starts. Engineering fix needed (DEPLOYMENT.md, L1).
5. **Wrong entitlement or allowance.** Entitlements change only through Stripe events.
   1. Check `stripe_events` for the customer.
   2. Resend missing events from Stripe.
   3. Check that the worker has the same `STRIPE_PRICE_*` and `PLAN_*` values as the API. An unknown price id gets the monthly plan's allowance.
6. **Dead `process_stripe_event` jobs:** fix the cause, then requeue them.
7. **Disputes and refunds.** A dispute suspends the entitlement and raises an `urgent` item. A refund raises a `normal` item. Neither changes minutes automatically. The next subscription event resets the entitlement from the subscription status, so a dispute suspension can be lifted without owner action (BILLING_CHECKLIST.md §3).
8. **Emergency lever:** `BILLING_ENFORCED=false`, then restart the API. Everyone can then start stations without an entitlement, and no usage is recorded. Owner decision only, because of the spend exposure.

### 4.6 Credential leak

**Severity.** SEV-1 for database credentials, a live Stripe key or the owner's account. SEV-2 for provider keys with no sign of misuse.

General order:

1. **Revoke or rotate at the issuer first.**
2. Update the secrets manager.
3. Restart the affected services. Configuration is read only at start.
4. Check for misuse in the issuer's logs.
5. Find the path of the leak:
   - git history;
   - the deployed client bundle (`node scripts/check-client-bundle-leaks.mjs --dist <build dir>`);
   - logs, tickets, chat and shell history.

   Stored job errors have key patterns redacted (`sk-ant-…`, `sk_/rk_/pk_` live or test keys, `Bearer …`). Provider messages in other logs may not be.

| Credential | Used by | Specific steps |
|---|---|---|
| `DATABASE_URL` password | API, worker, migrations | Rotate the role password. Review connection logs. Assess data exposure as a privacy incident (§4.2). Restart both services. |
| `ANTHROPIC_API_KEY` | API, worker | Rotate. Review spending. Set a spending limit at the provider. |
| `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` | API | Rotate. Review usage. |
| `STRIPE_SECRET_KEY` | API | Roll the key in Stripe. Review events and charges. |
| `STRIPE_WEBHOOK_SECRET` | API | Roll the endpoint's signing secret in Stripe, update it, restart the API. Until then forged events could be accepted, so compare `stripe_events` ids with Stripe's event list. |
| `AUTH_ENCRYPTION_KEY` | API | Protects only local-auth TOTP secrets. Rotating it makes stored local TOTP secrets unreadable. Affected local-auth owners must enrol again, which needs a database change (no endpoint). |
| Supabase project keys | None in the code | Rotate any project secret or service-role key in Supabase. Review the auth logs. |
| Owner account | Owner console | Revoke sessions (at the provider; with local auth, set `auth_sessions.revoked_at`). Reset the password. Enrol MFA again. Review `audit_events` since the suspected time: approvals, publications, withdrawals, `config.switches`, `usage.adjusted`, appeal decisions. Check the kill switches and demonstration cases (`GET /api/owner/config`). |

## 5. Communication

- **The owner decides** every message to learners, institutions, processors or regulators.
- **The product cannot message learners.** There is no email integration and no in-app banner; trial and payment notices are in-product only. Choose a channel, for example email from the owner's account. The owner approves the wording.
- **A message to learners says:**
  - what happened;
  - which of their data or results were affected;
  - what has been done;
  - what they should do, if anything;
  - whom to contact.

  It never includes patient material, secrets or other learners' data.
- **Regulatory and contractual notices** (privacy authorities, source institutions, the payment processor) are decided by the owner with legal counsel. Deadlines may apply.
- **Updates.** For SEV-1 and SEV-2, update the incident record at least every 2–4 hours (proposal) until resolved.

## 6. Post-incident review

Required for SEV-1 and SEV-2, within 5 business days (proposal). A short note is enough for SEV-3. The review is blameless and is kept with the incident record.

**Template**

1. **Summary:** one paragraph.
2. **Timeline:** detection, decisions, actions and recovery, with times.
3. **Impact:** learners, attempts, results changed, minutes adjusted, money moved, data exposed.
4. **Detection:** how it was found, and how long it went unnoticed.
5. **Root cause and contributing factors.**
6. **What worked, and what did not.**
7. **Actions:** each with an owner and a date. Typical actions:
   - a test or evaluation pattern;
   - a monitoring threshold;
   - a runbook update;
   - a code fix.
8. **Checks before closing:**
   - kill switches restored to the intended state;
   - dead jobs requeued or explained;
   - review items resolved;
   - affected learners informed as decided;
   - backups and restores verified if used.
