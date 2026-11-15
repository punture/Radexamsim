# Rollback

> **Status, 2026-11-15.** Nothing has been deployed, so no rollback has ever been performed. This runbook describes how to roll back once a deployment exists. It follows the code as it stands. Commands that touch a shared environment are run by the person the owner has authorized for that environment.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) · [BACKUP_RESTORE.md](BACKUP_RESTORE.md) · [INCIDENT.md](INCIDENT.md) · [MONITORING.md](MONITORING.md)

## 1. Principles

1. **Prefer the smallest lever that stops the harm.** In order:
   1. a kill switch or owner configuration change (seconds, no deploy);
   2. an application rollback (minutes);
   3. a forward-fix migration;
   4. a database restore, as a last resort.
2. **Never roll back data by editing history.** The ledger, session events, original transcripts, assessments and attempt bindings are protected by database triggers. Corrections are new records:
   - ledger corrections are `adjust` entries;
   - assessment corrections are new versions;
   - transcript corrections are revisions.
3. **Migrations are forward-only.** There are no down migrations. Undoing a schema change means writing a new migration, or restoring a backup.
4. **Roll back the web app and the API together.** They share the Zod contracts in `packages/contracts`, so a mismatched pair can reject each other's payloads.
5. **Record every rollback**: time, version from, version to, reason, who decided, and any learner impact. Use the incident log (INCIDENT.md).

## 2. Choosing the lever

| Situation | First lever | Then |
|---|---|---|
| A model behaves badly in live examining | Kill switch `examinerLlmDisabled` (§5) | Application or prompt rollback |
| Model assessments are wrong, or the provider is failing | Kill switch `assessmentLlmDisabled`, or leave jobs to dead-letter (INCIDENT.md §4.3) | Reassess the affected attempts after the fix |
| A speech provider is failing | `serverAsrDisabled` / `serverTtsDisabled` (§5) | Change `ASR_PROVIDER` / `TTS_PROVIDER` and restart the API |
| One case is wrong or unsafe | Add its case id to `disabledCaseIds` (reversible), or **withdraw** it (one-way) | Correct it in a new version or a new case |
| A release introduced a defect | Application rollback (§3) | Forward fix |
| A migration is faulty | Forward-fix migration (§4) | Restore only if data are damaged |
| Data are corrupted or lost | Stop writes, then restore (BACKUP_RESTORE.md) | Reconcile (BACKUP_RESTORE.md §6) |

## 3. Application rollback

**Before you start**

1. Identify the last good release: tag, commit and the web build made with that environment's values. The web build embeds its configuration (DEPLOYMENT.md §3.1), so keep the previous build artifact or rebuild it with the same values.
2. Check which migrations ran since the last good release (§4). If they are all additive, the previous code normally runs against the newer schema.
3. Check for live stations. An API restart pauses every active station and resumes it when the learner reconnects (DEPLOYMENT.md §3.2):

   ```sql
   SELECT status, mode, count(*)
   FROM station_sessions
   WHERE status IN ('preflight','ready','active','technically_interrupted','finalizing')
   GROUP BY status, mode;
   ```

   Owner console → Sessions lists the 100 most recent sessions with their status.
4. Optional: stop new stations from starting. There is no maintenance mode. One crude lever: put every published case id into `disabledCaseIds` (§5). New session creation then fails with "No eligible published cases are available". This also blocks the demonstration case. Sessions already created can still start. Owner previews are unaffected. Remove the ids afterwards.

**Rollback steps**

1. Deploy the previous worker build and restart the worker. On SIGTERM the worker finishes its current job, then exits. If it is killed mid-job, that job's lease expires after 5 minutes and the job runs again; jobs are idempotent by dedupe key.
2. Deploy the previous API build and restart the API. On SIGTERM it finishes queued session work and stops session timers. On start it pauses sessions still marked `active` as platform pauses.
3. Deploy the previous web build.
4. Run the smoke checks in DEPLOYMENT.md §11.
5. Watch for **jobs the older worker cannot run.** A newer release may have enqueued job kinds that the older code does not handle ("no handler for job kind"). Those jobs retry, then dead-letter and raise owner review items. Requeue them after rolling forward again (§5.6).
6. Watch for sessions stuck in `technically_interrupted` after the restart (MONITORING.md §3.6). The next process does not resume them automatically (DEPLOYMENT.md, L1).

**Configuration-only rollbacks.** Configuration is read once at process start, so changing an environment variable needs a restart of that service. Web values need a rebuild. This covers the provider choice, model ids, spending caps and Stripe keys.

## 4. Database migration rollback strategy

### 4.1 Inventory of migrations at the time of writing

| Migration | What it does | Class | Effect on rolling the code back |
|---|---|---|---|
| `0000_init.sql` | Creates all 37 tables, indexes and foreign keys | Initial schema | n/a |
| `0001_security_policies.sql` | Enables row-level security on every public table that existed (no permissive policies). Revokes privileges from `anon` and `authenticated` if those roles exist. Adds the functions `forbid_update()`, `forbid_update_delete()`, `transcript_original_immutable()` and `notify_job()`, and these triggers:<br>• `session_events_no_update` (BEFORE UPDATE)<br>• `usage_ledger_immutable` (BEFORE UPDATE OR DELETE)<br>• `transcript_segments_immutable` (BEFORE UPDATE; blocks changes to text, timing, source, provider, words)<br>• `case_assessments_no_update` (BEFORE UPDATE)<br>• `jobs_notify` (AFTER INSERT; wakes workers) | Security and integrity | Keep in place. Earlier code never needed to update these rows. |
| `0002_learning_plan_assignments.sql` | Adds `learning_plans.assignments jsonb NOT NULL DEFAULT '{}'` | Additive | Older code inserts still work because of the default. |
| `0003_attempt_version_binding.sql` | Adds `case_attempt_binding_immutable()` and the trigger `case_attempts_binding_immutable` (BEFORE UPDATE). `case_version_id`, `session_id` and `ordinal` of an attempt cannot change. | Integrity (additive) | No effect unless code tries to re-point an attempt, which it must not. |
| `0004_plan_pace_and_item_states.sql` | Adds `learning_plans.item_states jsonb NOT NULL DEFAULT '{}'` and `users.plan_pace text NOT NULL DEFAULT 'standard'` | Additive | Older code ignores the new columns. Inserts still work because of the defaults. |

All schema changes so far are additive, and the triggers only forbid operations the application never performs. A code rollback across `0002`–`0004` therefore does not need a schema rollback.

### 4.2 Forward fix (default)

1. Write a new migration that corrects the problem: add the missing column or index, relax a constraint, or create a replacement trigger function. Follow the conventions in DEPLOYMENT.md §6:
   - expand first;
   - enable row-level security on new tables;
   - keep journal timestamps increasing.
2. Test it on staging, preferably on a restored copy of production-like data (BACKUP_RESTORE.md §9).
3. Release it through the normal pre-deploy checklist.

### 4.3 Manual reversal (exceptional)

- Drizzle records applied migrations in `drizzle.__drizzle_migrations` (hash and journal timestamp) and decides what to run from the latest timestamp. Deleting rows there, or editing an applied migration file, can make it skip or re-run migrations. Do not do this.
- Dropping or disabling an integrity trigger removes a protection the specification requires. Do it only with the owner's written approval, for a stated time and reason, and recreate the trigger with a migration afterwards. Never disable `usage_ledger_immutable` to "fix" balances. Use an owner adjustment instead (INCIDENT.md §4.5).

### 4.4 Restore (last resort)

- Restore only when data are damaged or lost and no forward fix can repair them. A point-in-time restore discards **every write after the restore point**: sessions, transcripts, assessments, ledger entries, Stripe events, consent records, data requests and completed deletions.
- Follow BACKUP_RESTORE.md §6, including the reconciliation steps: replay Stripe events, re-apply deletions, check jobs and live sessions, and tell affected learners.

## 5. Feature and kill-switch rollback (owner configuration)

All of these are owner routes. Each needs the owner role and a verified second factor. Cookie-authenticated calls also need the header `x-sim-csrf: 1`. The owner console pages call the same endpoints. Settings are stored in `system_config` and read from the database on each use, so they take effect immediately, without a restart.

### 5.1 Kill switches: `PUT /api/owner/config/switches`

Owner console → Configuration. The request body **replaces the whole set**, so read the current values first with `GET /api/owner/config` and send all five fields back:

```json
{ "examinerLlmDisabled": false, "assessmentLlmDisabled": false,
  "serverTtsDisabled": false, "serverAsrDisabled": false, "disabledCaseIds": [] }
```

| Switch | Read when | Effect when on | Side effects to know |
|---|---|---|---|
| `examinerLlmDisabled` | Every examiner decision | The deterministic approved-question policy decides; no examiner model calls | The fallback asks approved questions in order. Clarification phrases are available only to the model examiner. |
| `assessmentLlmDisabled` | Start of each assessment job | The pipeline stops before any model call. In production the result is **"assessment unavailable"**. In development with `ALLOW_DEV_BASELINE_ASSESSOR` the labelled baseline runs. | These jobs **succeed** with an unavailable result. They are not retried and are not in the dead-job list. After switching it off, reassess the affected attempts individually (INCIDENT.md §4.3 has the query). |
| `serverTtsDisabled` | Each examiner utterance | No server speech synthesis. The question is shown as text. | The browser waits about 12 s for audio that never comes before it treats the text as delivered, so every prompt is delayed. For a longer outage, set `TTS_PROVIDER=browser` and restart the API. |
| `serverAsrDisabled` | Each time a server speech-recognition stream opens | New server streams are refused with "Speech recognition is temporarily disabled" | Learners do **not** fall back to browser recognition. In server-ASR mode they cannot answer by voice until it is switched off, or until `ASR_PROVIDER=browser` is set and the API restarted. Browser recognition needs Chrome or Edge and the learner's `browser_speech_vendor` consent. |
| `disabledCaseIds` | Session creation (form assembly) | Listed cases are not selected for new sessions, including the demonstration case | Sessions already created, and media for past attempts, are unaffected. Reversible. |

Rollback means sending the previous values back. `config.switches` audit events record each change and its full body.

### 5.2 Assessment policy: `PUT /api/owner/config/assessment-policy`

- Body: `{ secondPass: "always" | "risk_based", randomSampleRate, shareExtractionWithB, acknowledgeReducedCoverage }`.
- Changing to `risk_based` needs `acknowledgeReducedCoverage: true`.
- To roll back, set `secondPass: "always"`, the default when no row exists. Audit event: `config.assessment_policy`.

### 5.3 Demonstration cases: `PUT /api/owner/config/demo-cases`

- Body: `{ caseIds: [...] }`, at most 5.
- Send the previous list to roll back. This route writes no audit event, so note the previous list before changing it.

### 5.4 Cases

| Action | Endpoint | Reversible? |
|---|---|---|
| Retire a published version | `POST /api/owner/case-versions/:versionId/retire` | Yes: publish an approved version again |
| Create a corrected version | `POST /api/owner/case-versions/:versionId/new-version`, then review, approve, publish | n/a. Existing attempts stay bound to their version (trigger from 0003). |
| Withdraw | `POST /api/owner/cases/:caseId/withdraw` with `{ reason }` (5–1000 characters) | **No.** It stops selection, clears the published version and revokes media access for every attempt, replays included. The publish route refuses withdrawn cases, and no endpoint undoes a withdrawal. A corrected case needs a new case id. |

Prefer `disabledCaseIds` or retirement when you are not yet sure. Withdraw when content must stop being shown at once (INCIDENT.md §4.1, §4.2).

### 5.5 Profile verification

`POST /api/owner/profiles/:versionId/verification` creates a **new** profile version and deactivates the one it was based on. Attempts stay bound to the version they started with. To roll back, record a new verification on the current version. There is no endpoint that reactivates an old version.

### 5.6 Dead jobs

- `GET /api/owner/jobs/dead` lists up to 200 dead jobs: id, kind, attempts, last error and time.
- After fixing the cause, `POST /api/owner/jobs/requeue-dead` with `{ ids: [...] }` (1–100 ids per call) puts them back with attempts reset to 0. Owner console → Configuration has a button for this.
- Requeueing writes no audit event. Note it in the incident log.
- Requeued assessment jobs call the model again and cost money.

## 6. After any rollback

- [ ] `GET /api/health` shows `ok: true` and the expected providers.
- [ ] No new dead jobs. The queue age is normal (MONITORING.md §3.3).
- [ ] No sessions stuck in `active`, `technically_interrupted` or `finalizing` (MONITORING.md §3.6).
- [ ] Kill switches are back to the intended state (`GET /api/owner/config`).
- [ ] Owner review items raised during the event have been triaged.
- [ ] Incident log updated. Follow-up tasks are recorded (INCIDENT.md §6).
