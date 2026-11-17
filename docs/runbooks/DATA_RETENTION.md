# Data retention and deletion

> **Status, 2026-11-15.** Nothing has been deployed, and no learner data exist outside development databases. This document describes what the code stores and what it deletes. Apart from the two defaults noted (export retention 7 days, recording retention 30 days, the latter unused), **no retention period has been decided**. The privacy notice and terms are drafts pending owner and legal review: `POLICY_VERSION = "draft-2026-11-15"` in `apps/api/src/policy.ts`. Nothing here is legal advice.

Related: [BACKUP_RESTORE.md](BACKUP_RESTORE.md) §7 (erasure and backups) · [INCIDENT.md](INCIDENT.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [tools/ingestion/README.md](../../tools/ingestion/README.md)

## 1. Summary of what is implemented

| Behaviour | Implemented? | Where |
|---|---|---|
| Consent records (append-only, versioned by `POLICY_VERSION`) | Yes | `apps/api/src/routes/account.ts`, `apps/api/src/live/session.ts` |
| Microphone audio processed only with current consent | Yes, for server recognition and browser recognition | `apps/api/src/live/session.ts` (`hasConsent`) |
| Audio recordings retained with opt-in consent | **No.** Nothing captures recordings. The table, bucket, consent kind and sweep exist. | `recordings` table; `RECORDING_RETENTION_DAYS` is declared but not read |
| Learner data export | Yes | `POST /api/account/export` → worker `data_export` |
| Account and personal-data deletion | Yes | `POST /api/account/delete` → worker `data_deletion` |
| Time-based deletion of exports | Yes, at the daily retention sweep | `apps/worker/src/jobs/privacy.ts` (`retentionSweep`) |
| Time-based deletion of transcripts, results or inactive accounts | **No.** Kept until the learner deletes the account. | n/a |
| Purging old jobs, logs, model-call rows, Stripe payloads, audit events | **No** | n/a |
| Automated tests of export, deletion and the sweep | **No.** Only the queue mechanics are tested. | `packages/db/test/db.test.ts` uses these job kinds as queue fixtures only |

## 2. Data inventory

"On deletion" describes what the `data_deletion` job does (`apps/worker/src/jobs/privacy.ts`).

### 2.1 Identity, authentication and consent

| Data | Contents | Retention now | On deletion |
|---|---|---|---|
| `users` | Email, display name, role, auth provider and external id, password hash (local auth), encrypted TOTP secret (local auth), Stripe customer id, plan pace | Indefinite | **Pseudonymized.** Email becomes `deleted-<id>@deleted.invalid`. Display name, password hash, TOTP secret and external auth id are cleared, and `deleted_at` is set. **`stripe_customer_id` is kept.** |
| `auth_sessions` | Token hash, expiry, MFA time | Indefinite; expired rows are not purged | Revoked, rows kept |
| `consents` | Kind, granted, policy version, time | Indefinite, append-only | **Kept** |
| Managed-auth account (Supabase) | The provider's user record | The provider's terms | **Not deleted by the application.** If the same identity signs in again later, a new, empty account is created. |

### 2.2 Learner activity

| Data | Contents | Retention now | On deletion |
|---|---|---|---|
| `transcript_segments` | The learner's words, timings, provider and confidence; owner corrections as revisions | Until account deletion | Deleted |
| `examiner_utterances` | Examiner text and how much was played | Until account deletion | Deleted |
| `session_events` | The station timeline. Payloads hold ids, counts and the examiner policy's decision notes, not transcript text. | Until account deletion | Deleted (the trigger forbids UPDATE, not DELETE) |
| `processed_commands`, `viewer_commands`, `asset_handles` | Command bookkeeping, viewer state, media handles | Until account deletion | Deleted |
| `assessment_passes`, `case_assessments`, `skill_observations` | Model and post-processed outputs, including verbatim evidence quotes | Until account deletion | Deleted |
| `session_debriefs` | Debriefs: quotes, feedback, the reference material shown | Until account deletion | Deleted |
| `learning_plans` | Plan payload, opaque assignments, item states | Until account deletion | Deleted |
| `appeals` | The learner's statement and proposed corrections, the resolution | Until account deletion | Deleted |
| `station_sessions` | User id, mode, status, outcome, clock, speech mode, preflight (browser family, screen size, microphone state, round-trip time), technical notes | Indefinite | **Kept for usage reconciliation.** Preflight and technical notes are cleared. |
| `case_attempts`, `exam_forms` | User id, case version, ordinal, stage state (ids only), timings. `exam_forms.seed` holds the user id. | Indefinite | **Kept** |
| `recordings` and the `recordings/` bucket | None exist | Swept after `retained_until` | Objects and rows deleted |
| `data_requests` | Kind, status, times, export storage key | Indefinite | **Kept** |
| `exports/` bucket | Learner exports (JSON) | Deleted by the retention sweep once the request is older than `EXPORT_RETENTION_DAYS` (default 7) | **Not deleted by the deletion job.** They remain until the sweep removes them. |

### 2.3 Billing

| Data | Contents | Retention now | On deletion |
|---|---|---|---|
| `usage_ledger` | Signed minute entries: user id, session id, period key, reason, actor (`system`, `stripe`, `seed` or the owner's user id) | Indefinite. **Immutable**: a trigger forbids UPDATE and DELETE. | **Kept.** The entries hold no transcript or clinical text. They are pseudonymous only as far as the user row is: `users.stripe_customer_id` still links to the Stripe customer, which holds the email. |
| `subscriptions`, `entitlements` | Stripe ids, plan, status, period dates, demonstration allowance | Indefinite | Kept |
| `stripe_events` | **The full payload of every verified webhook event.** Depending on the event this can include customer email, name, billing address and card brand, last four digits and expiry, as sent by Stripe. | Indefinite | **Kept. Not redacted.** |
| Stripe's own records | Customer, subscriptions, invoices | Stripe's terms | **Not deleted by the application** |

### 2.4 Content, operations and audit

| Data | Contents | Retention now | Notes |
|---|---|---|---|
| `case_versions`, `cases`, `case_reviews`, `exam_profiles`, `content_requests` | Owner-approved clinical content and its history, critic outputs | Indefinite | Withdrawal and retirement only change flags. Content is never deleted by the application. |
| `derivatives/` bucket | Imported de-identified case images | Indefinite | Not deleted by withdrawal (INCIDENT.md §4.2) |
| `source_files`, `source_inventory_items` | Schema only | n/a | Nothing writes these tables |
| Owner's local ingestion workspace (`QDIR`, inventories, derivatives, packages) | Untouched sources, and a manifest that maps digests to **original file paths**, which may contain identifiers | Owner's computer only | Outside the system. Owner decision on secure deletion once cases are approved (ingestion README). |
| `owner_review_items` | Exception titles and details. Appeal items quote up to 1,500 characters of the learner's statement. | Indefinite | On learner deletion, items whose `refs.caseAttemptId` belongs to that learner are redacted and dismissed. **Other items that reference the learner are not redacted**, for example invalidated-session items (`refs.userId`) and Stripe dispute or refund items. |
| `audit_events` | Actor id, action, target, details (for example adjustment reasons, checkout plan) | Indefinite. Append-only by convention, no trigger. | Kept |
| `model_calls` | Role, model, prompt version, ids, status, latency, tokens, estimated cost. No text. | Indefinite | Kept |
| `jobs` | Payloads and results. Mostly ids, but **case-author jobs store the owner's notes and pasted teaching text** (up to 20,000 and 50,000 characters). | Indefinite; succeeded jobs are never purged | Kept |
| `metric_samples` | Nothing writes this table | n/a | n/a |
| Application logs | Request method, URL (with ids; the `/ws` URL carries the single-use ticket), client address, status. No bodies. Authorization, cookie and set-cookie headers redacted. | Set by the log host | Not touched by deletion |
| Backups and snapshots | Everything above, including data deleted since | The backup window (BACKUP_RESTORE.md) | Deleted data persist until the backups expire |
| Noncurrent object versions (S3 bucket with versioning) | Deleted or overwritten exports, recordings and images | Until the noncurrent-version lifecycle rule removes them (STORAGE.md §5) | Deleted objects persist as noncurrent versions until then |

### 2.5 Data held by external processors (when enabled)

| Processor | Data | Control in the code |
|---|---|---|
| Anthropic or Google (Gemini), whichever `LLM_PROVIDER` names | Case text and learner transcripts (examiner, assessment, feedback); case JSON without images (author, critics) | `LLM_PROVIDER`, kill switches, per-case clearance for author and critics only (DEPLOYMENT.md, B5). Gemini requests set `store: false`; use a billing-enabled Google Cloud project, because the unpaid tier allows Google to use prompts and responses |
| Deepgram | Learner microphone audio (server recognition); examiner text (Deepgram TTS) | Consent gate; `mip_opt_out=true` (opt out of use for model improvement); `serverAsrDisabled` |
| ElevenLabs | Examiner text | `serverTtsDisabled` |
| Learner's browser vendor | Microphone audio, with browser recognition | `browser_speech_vendor` consent |
| Stripe | Email, user id (metadata), payment data | Stripe-hosted checkout and portal |
| Supabase | Account identity | Provider settings |

Each processor's retention follows its own terms and any data-processing agreement. Choosing and documenting them is an owner decision. None is configured today.

## 3. Consent

- **Recording.** `POST /api/account/consents` appends a row with kind, granted and the current `POLICY_VERSION`. `GET /api/account/consents` returns the latest row per kind. Consent kinds:
  - `terms`
  - `privacy`
  - `microphone_processing`
  - `audio_retention`
  - `browser_speech_vendor`
  - `evaluation_use`
- **Enforcement** (`apps/api/src/live/session.ts`):
  - Server speech recognition (`audio_start`) needs the latest `microphone_processing` record to be granted **under the current `POLICY_VERSION`**.
  - Browser-recognition transcripts need both `microphone_processing` and `browser_speech_vendor` under the current version.
  - Typed practice answers need no microphone consent.
- **Changing `POLICY_VERSION`** (a code change in `apps/api/src/policy.ts`) makes every learner consent again before any microphone audio is processed. Keep the public Privacy and Terms pages in step with it, and plan the change as a release. Learners are asked at station setup or in Account.
- **Withdrawing consent** appends a row with `granted: false`. Processing stops from then on. Data already processed (transcripts) are not deleted by withdrawal. Deletion is a separate request.
- **Gaps:**
  - Local registration records `terms` and `privacy` with the literal version string `"draft-2026-11-15"` rather than the `POLICY_VERSION` constant (`apps/api/src/routes/auth.ts`).
  - Managed-auth sign-ups record no terms or privacy consent at all, because accounts are created on first token use (`apps/api/src/auth/plugin.ts`).
  - `audio_retention` and `evaluation_use` are recorded, but no code acts on them.

## 4. Learner requests

### 4.1 Data export

1. The learner requests an export in Account (`POST /api/account/export`, at most 3 per hour). The request row and the `data_export` job are created in one transaction.
2. The worker writes `exports/<userId>/<requestId>.json` to the `exports` bucket and marks the request `complete`.
3. The file contains:
   - account email, display name and creation date;
   - consent history;
   - every session, with its transcript (including superseded segments and corrections) and the examiner text the learner actually heard;
   - one stored debrief per session (the code takes the last row returned and does not sort by version);
   - learning plans and appeals;
   - usage ledger entries.

   It does **not** contain the private case bank: answers, rubrics or source images.
4. The learner downloads it with `GET /api/account/exports/:id/download` (`Cache-Control: private, no-store`).
5. The API shows a deletion date: completion time plus `EXPORT_RETENTION_DAYS` (API setting, 1–90). The worker deletes the file at the first retention sweep after the request is older than `EXPORT_RETENTION_DAYS` (worker setting). The sweep runs only when the worker starts, once per UTC day (DEPLOYMENT.md, L3), so files can outlive the displayed date. Keep both settings equal.

### 4.2 Account and personal-data deletion

1. The learner confirms with the account email (`POST /api/account/delete`, at most 3 per hour). **The owner account cannot be deleted this way.** The job's dedupe key is per user. A second request creates another `data_requests` row but no new job, and that row stays `requested`.
2. The worker:
   1. deletes the learner's recording objects (none exist today);
   2. then, in one transaction:
      - redacts and dismisses review items tied to the learner's attempts;
      - deletes appeals, skill observations, assessment passes, assessments, debriefs, transcripts, examiner utterances, session events, processed commands, viewer commands, media handles, recording rows and learning plans;
      - clears session preflight data and technical notes;
      - revokes auth sessions;
      - pseudonymizes the user row;
      - marks the request `complete`.
3. **What remains** is listed in §2:
   - session and attempt skeletons and exam forms;
   - the usage ledger, subscriptions and entitlements;
   - Stripe event payloads, and the Stripe customer id on the user row;
   - consents and data requests;
   - audit events and model-call rows;
   - review items not tied to an attempt;
   - jobs;
   - existing export files, until swept;
   - logs and backups.

   The draft privacy notice says a pseudonymous usage ledger and audit records without transcript text are retained. It does not mention Stripe payloads, consents, export files awaiting the sweep, or backups. Owner and legal review needed.
4. **Failure handling.** If the job exhausts its 5 attempts it becomes `dead` and raises an owner review item. The request stays `processing`. Fix the cause and requeue (ROLLBACK.md §5.6). Watch for requests older than 24 hours (MONITORING.md §3.9).
5. **Restores bring deleted data back.** Re-apply deletions after any restore (BACKUP_RESTORE.md §6, §7).

### 4.3 Retention sweep

Each run of `retention_sweep`:

- deletes recording objects whose `retained_until` has passed and marks them deleted;
- deletes export objects whose request is older than `EXPORT_RETENTION_DAYS`, and clears the key in the database.

It is enqueued only at worker startup (dedupe `retention:<UTC date>`). Monitor the last successful sweep (MONITORING.md §3.3).

## 5. Ledger and billing record retention

- The usage ledger cannot be edited or deleted. A database trigger enforces this. Corrections are `adjust` entries. It is the basis for:
  - available minutes;
  - reconciliation of every station's reservation, consumption and release;
  - responses to disputes and refunds;
  - any accounting or tax record that refers to usage.
- How long ledger entries, `stripe_events`, `subscriptions` and `entitlements` must be kept depends on accounting, tax and consumer-protection rules in the owner's jurisdiction. **Owner and accountant decision.** Until it is made, keep them. Do not plan a purge that the immutability trigger would block. A purge needs a reviewed migration and owner approval.
- `stripe_events` payloads carry more personal data than reconciliation needs. A future change could keep the event id, type, created time and outcome, and redact the payload after a set period. Owner decision.

## 6. Retention periods still to be decided (owner and legal)

1. **Transcripts, assessments, debriefs, learning plans and appeals** of active accounts. Today they are kept until the learner deletes the account.
2. **Inactive accounts.** Today nothing happens to them.
3. **Exports.** `EXPORT_RETENTION_DAYS`, default 7, in both the API and the worker.
4. **Recordings**, if the feature is ever built. The privacy page proposes 30 days. `RECORDING_RETENTION_DAYS` exists but is unused. The `audio_retention` consent exists but is not enforced.
5. **Usage ledger and billing records:** the legal minimum and maximum (§5).
6. **Stripe event payloads:** retention, and redaction of personal and payment fields.
7. **Audit events, owner review items, model-call rows and job rows**, including the owner's notes and teaching text stored in case-author jobs.
8. **Application logs** at the chosen host.
9. **Backups and the point-in-time window.** They set how long deleted data persist (BACKUP_RESTORE.md §2, §7).
10. **Residue of deleted accounts:**
    - whether to delete the Stripe customer and the managed-auth account;
    - whether to clear `users.stripe_customer_id`;
    - whether to keep consent records;
    - whether to redact all review items that reference the user.
11. **Withdrawn or retired case content.** The case-version payload and the `derivatives/` images are never deleted today.
12. **The owner's local ingestion workspace (`QDIR`).** Secure deletion once cases are approved, or encrypted local retention.
13. **Use of learner attempts for evaluation.** The `evaluation_use` consent is recorded. The evals README allows real attempts only with consent; no code imports them.
14. **Policy changes.** When to bump `POLICY_VERSION`, and how learners are told that they must consent again.
15. **Data residency** for the database, storage, logs, backups and each processor.

## 7. Operational checks

- Weekly: data requests older than 24 hours; last successful retention sweep; dead `data_export` and `data_deletion` jobs (MONITORING.md).
- After any restore: re-apply deletions completed after the restore point.
- Before any change to `POLICY_VERSION`, the privacy notice or the terms: owner and legal sign-off, and a release note.
