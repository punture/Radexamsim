# Backup and restore

> **Status, 2026-11-15.** Nothing has been deployed and **no backups exist**. No database or storage provider has been chosen. This runbook sets out what must be backed up, how restores must behave, and the drills to run before and after launch. Retention periods, recovery objectives and the choice of provider are owner decisions, marked as such. Buying a backup service needs owner authorization.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) · [ROLLBACK.md](ROLLBACK.md) · [DATA_RETENTION.md](DATA_RETENTION.md) · [INCIDENT.md](INCIDENT.md)

## 1. What must be backed up

| Store | Contents | Without a backup | Method |
|---|---|---|---|
| PostgreSQL 16 | Everything the application records: accounts, consents, case versions and approvals, sessions, events, transcripts, assessments, appeals, the usage ledger, Stripe events, jobs, audit events, owner review items | Total loss of learner history, billing records and clinical approvals | Continuous archiving with point-in-time recovery, plus periodic full backups (§2) |
| Object storage volume (`STORAGE_LOCAL_ROOT`) | `derivatives/`: imported, de-identified case images, the only server-side copy. `exports/`: learner exports, short-lived. `recordings/`: empty (nothing writes recordings). `quarantine/`: unused by the server. | Published cases lose their images. Media requests then fail with 502, the "image could not be loaded" error. | Volume snapshots (`local-fs`) or bucket versioning (`s3`), §3 |
| Secrets | Database credentials, `AUTH_ENCRYPTION_KEY`, provider keys, Stripe webhook secrets | Services cannot start. Local-auth TOTP secrets become unreadable if `AUTH_ENCRYPTION_KEY` is lost. | The secrets manager's own backup and versioning, kept separate from data backups |
| Code and migrations | The git repository | No reproducible build | **No git remote is configured** (docs/STATUS.md). Owner decision: where the repository is hosted. |
| Owner's local ingestion workspace | `QDIR` (untouched sources, and a manifest that maps digests to original file paths), derivatives, packages (`tools/ingestion`) | Re-ingestion would be impossible | **Not part of the system's backups.** The ingestion README requires QDIR to stay on the owner's computer: never in a cloud-synced folder, never uploaded. Owner decision: local encrypted backup, or secure deletion once cases are approved. |

Not needed: the web build (rebuild from the tagged commit), and in-memory live-session state (rebuilt from PostgreSQL).

## 2. PostgreSQL

**Requirements**

- Point-in-time recovery: continuous WAL archiving plus base backups, or a managed service that provides it.
- Encrypted backups, stored in a separate account or project from the live database, with access limited to named people.
- Monitoring of every backup and archiving job (MONITORING.md §4).
- A logical dump (`pg_dump -Fc`) before every migration, kept until the next release has been stable for an agreed period.

**Proposed starting policy.** Owner decision; these are initial proposals only.

| Item | Proposal | Owner decision needed |
|---|---|---|
| Point-in-time window | 14 days | Window length versus how long deleted data persist in backups (§7) |
| Full backups | Daily, kept 30 days | Retention and legal hold |
| Recovery point objective | ≤ 15 minutes of writes lost | Acceptable loss of learner work and billing records |
| Recovery time objective | ≤ 4 hours | Acceptable downtime for a one-person operation |
| Off-site copy | One region away, encrypted | Data residency |

**Logical restores and the triggers.**

- `pg_restore` creates triggers in its post-data step, after the rows are loaded, so the immutability triggers do not block a full restore.
- Every protected trigger fires only on UPDATE or DELETE, so a data-only load into an existing schema is not blocked either. The `jobs_notify` trigger fires on each inserted job, which is harmless.
- Never restore "around" the triggers by disabling them and then editing rows.

## 3. Object storage

**Local filesystem (`STORAGE_DRIVER=local-fs`).**

- Snapshot the whole volume on the same schedule as the database backups. Keep snapshots for the same period.
- Encrypt the volume and its snapshots at rest.
- Never expose the volume or a snapshot through a web server or a public link.
- Back up the volume itself, not copies. The application creates files `0600` and directories `0700`, so a restore must keep the owner and permissions.

**S3-compatible bucket (`STORAGE_DRIVER=s3`; setup in [STORAGE.md](STORAGE.md) §5).** Bucket settings:

- public access blocked at account and bucket level;
- default server-side encryption;
- **versioning on** for `derivatives`;
- lifecycle rules that expire noncurrent versions of `exports` (and later `recordings`) within days, so that deleted personal data do not survive in old versions longer than the policy allows (DATA_RETENTION.md);
- no public or long-lived URLs. The API streams objects after authorization.

Object lock or immutability for `derivatives` is an owner decision. It conflicts with removing an image after a privacy incident (INCIDENT.md §4.2).

**Keeping the database and storage consistent**

- The database refers to storage keys in three places:
  - `case_versions.payload` (`assets[].frames[].storageKey`);
  - `data_requests.result_storage_key`;
  - `recordings.storage_key`.
- Take storage snapshots at least as often as database backups.
- When restoring both, restore storage to a time **at or after** the database restore point. Extra objects are harmless; missing objects break media and export downloads.
- After a restore, run the check in §6.2 step 7.

## 4. What is immutable or append-only, and why restores must keep it

| Data | Protection | Why it matters |
|---|---|---|
| `usage_ledger` | Trigger `usage_ledger_immutable`: no UPDATE or DELETE (0001) | Balances are the sum of signed entries. Entries carry unique idempotency keys (`reserve:`, `release:`, `consume:`, `allot:`, `expire-before:`, `adjust:`), which stop double charges. Editing or partially restoring entries breaks both the balance and the idempotency guarantees. |
| `session_events` | Trigger `session_events_no_update` (0001). Deletion is allowed only for erasure. | The durable record of each station, with a gap-free sequence per session (unique `session_id, seq`). Opportunity records, assessments, latency metrics and appeals depend on it. |
| `transcript_segments` | Trigger `transcript_segments_immutable`: original text, timing, source, provider and words cannot change. Corrections are new revision rows. | Assessment evidence quotes must match the original words. Appeals keep the history. |
| `case_assessments` | Trigger `case_assessments_no_update`. New versions supersede old ones. | Results are never overwritten. Reassessments and owner decisions are traceable. |
| `case_attempts` binding | Trigger `case_attempts_binding_immutable` (0003) | An attempt stays bound to the exact case version it was examined on. |
| `case_versions` approvals | Approval is bound to content hashes (`clinical_content_hash`, `rubric_hash`, `assets_hash`) | A restore must not alter payloads, or approvals no longer match. |
| `stripe_events` | Event id is the primary key (deduplication) | Replaying events after a restore is safe only because duplicates are ignored. |
| `consents` | Append-only by convention (the code only inserts). No trigger. | The latest record per kind is the learner's current consent. Earlier rows show consent history. |
| `audit_events` | Append-only by convention (the code only inserts). No trigger. | The record of owner actions: approvals, publications, withdrawals, configuration changes, adjustments. |

Rules for every restore:

1. **Restore whole databases to one consistent point in time.** Never restore a single table over newer data. That would mix two points in time, break idempotency keys and per-session sequences, and lose correction records.
2. **Never "fix" a restored database by editing protected rows.** Use the application's correction paths:
   - ledger: `adjust` entries;
   - results: new assessment versions;
   - transcripts: revisions.
3. **Check after every restore** that the triggers and row-level security are present (§6.2).

## 5. Encryption at rest

| Layer | Expectation | Notes from the code |
|---|---|---|
| Database storage and backups | Encrypted by the provider or with a customer-managed key (owner decision) | Transcripts, emails, Stripe event payloads and case content are stored in **plain text** in the database. Encryption at rest and access control are the only protection. |
| Object storage volume and snapshots | Encrypted disk or volume; encrypted snapshots | Imported case images and learner exports are stored as plain files (`0600`). |
| Application-level encryption | Only local-auth TOTP secrets (AES-256-GCM, key from `AUTH_ENCRYPTION_KEY`) | Production uses managed auth, so this applies mainly to development. Losing or rotating the key makes stored local TOTP secrets unreadable. |
| Backups of secrets | In the secrets manager, never in a data backup or repository | `.env` files are git-ignored |
| In transit | TLS to the database, TLS at the proxy | DEPLOYMENT.md §9 |

## 6. Restore procedures

### 6.1 Before restoring

1. Declare an incident (INCIDENT.md). Record the target restore time and the reason.
2. **Stop writes.** Stop the worker and the API so jobs, webhooks and sessions do not write to the database being replaced. Stripe keeps retrying webhooks it cannot deliver. A failed delivery can be resent from the Stripe dashboard.
3. Record the last good time, and **export the list of data requests completed after it** if the damaged database is still readable:

   ```sql
   SELECT id, user_id, kind, completed_at
   FROM data_requests
   WHERE status = 'complete' AND completed_at > :restore_point;
   ```

   Learners whose deletion completed after the restore point would otherwise reappear (§7).

### 6.2 Database and storage restore

1. Restore PostgreSQL to the chosen point into a **new** instance. Do not overwrite the damaged one until the new one is checked.
2. Restore the storage volume to a time at or after that point (§3).
3. Point a single API and a single worker at the restored database, but keep them stopped.
4. Check the schema:

   ```sql
   -- Applied migrations
   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
   -- Integrity triggers (expect 6: session_events_no_update, usage_ledger_immutable,
   -- transcript_segments_immutable, case_assessments_no_update, jobs_notify,
   -- case_attempts_binding_immutable)
   SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal ORDER BY 2, 1;
   -- Row-level security enabled on every public table (expect no rows)
   SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
   ```

5. Check that the ledger is consistent. There should be no balance below the open reservations, and no duplicate idempotency keys (the unique index guarantees the latter):

   ```sql
   SELECT user_id, sum(minutes) AS available FROM usage_ledger GROUP BY user_id HAVING sum(minutes) < 0;
   ```

   A negative balance can be legitimate while a reservation is open. Investigate it; do not edit it.
6. Check that the kill switches and assessment policy in `system_config` are what you expect.
7. Spot-check the storage: for a few published case versions, confirm that every `storageKey` in `assets[].frames[]` exists under `STORAGE_LOCAL_ROOT/derivatives/`.
8. Start the worker, then the API. The API pauses sessions marked `active` as platform pauses. Then run the smoke checks (DEPLOYMENT.md §11).

### 6.3 Reconcile after the restore

| What was lost after the restore point | Action |
|---|---|
| Stripe events | In the Stripe dashboard (test mode until live mode is authorized), list the events after the restore point and resend them to the webhook endpoint. Duplicates are ignored by event id. Then check entitlements against Stripe subscriptions. |
| Completed deletions | Re-run deletion for each learner on the list from §6.1. Legal and the owner decide how to record it. |
| Sessions, transcripts, assessments, appeals | They cannot be recovered. Identify the affected learners from the incident window (provider logs, Stripe, support messages). The owner decides on notice and on usage adjustments (`POST /api/owner/users/:id/adjust-minutes`). |
| Jobs | Jobs that were queued or running at the restore point run again. They are idempotent, but assessment jobs call the model again and cost money. Watch the dead-job list. |
| Owner actions (approvals, publications, withdrawals, configuration) | Compare with the audit trail kept outside the database, if any, and with the owner's notes. **Re-apply every withdrawal.** A withdrawn case that comes back after a restore is a safety issue. |
| Consents granted after the restore point | Learners are asked again: the live session refuses microphone processing until the latest consent under the current `POLICY_VERSION` is granted. |

## 7. Erasure and backups

- Learner deletion (DATA_RETENTION.md §4) removes or pseudonymizes data in the live database. **Backups and snapshots still contain the deleted data until they expire.** The point-in-time window and the backup retention therefore set how long deleted data persist. Owner and legal decision.
- After any restore, re-apply the deletions completed after the restore point (§6.1, §6.3).
- Exports deleted by the retention sweep can come back in a storage restore. The next sweep deletes them again, provided their `data_requests` row is older than `EXPORT_RETENTION_DAYS` and still has a `result_storage_key`. A restored object whose key was already cleared in the database is **not** swept. Remove such objects by hand.

## 8. Who does what

| Task | Responsible |
|---|---|
| Decide recovery objectives, retention and provider | Owner |
| Configure backups and archiving, watch backup jobs | The person the owner authorizes for operations (to be named) |
| Approve a production restore | Owner |
| Execute a restore and its checks | Authorized operator, with the owner informed |
| Learner communication after data loss | Owner (INCIDENT.md §5) |

## 9. Restore drills

**When**

- Once on staging before any production launch.
- Then quarterly.
- After any change to the backup setup or a major migration.

**Steps**

1. Pick a random restore point within the point-in-time window.
2. Restore the database and the storage snapshot into an isolated environment. Use no production credentials for providers, and no Stripe webhook endpoint.
3. Run §6.2 steps 4–7.
4. Start the worker and the API in the isolated environment with outbound access to providers blocked and Stripe unset. The API's production checks require `LLM_PROVIDER=anthropic` or `gemini` with that provider's key; a placeholder value is enough while outbound calls are blocked. Confirm that `GET /api/health` returns `ok: true`. Where sign-in is available, have the owner open a published case's images.
5. Measure how long each step took. Compare with the recovery time objective.
6. Destroy the drill environment and its copies of the data.

**Pass criteria**

- All expected migrations are recorded.
- All six triggers are present.
- No table is missing row-level security.
- The ledger query finds nothing unexplained.
- Sampled storage keys resolve.
- The total time is within the recovery time objective.

**Record:** date, restore point, durations, failures, follow-up tasks. Keep the record with the incident log.
