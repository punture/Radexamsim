# HTTP API reference

This document describes the HTTP API served by `apps/api` (Fastify 5). It was written from the
code. Where this document and the code disagree, the code is correct.

- Routes are defined in `apps/api/src/routes/*.ts` through the `route(app, {...})` helper in
  `apps/api/src/http.ts`. The helper validates parameters, query and body with Zod, enforces the
  route's auth level and the CSRF rule, and records the route for the OpenAPI document.
- The live examination uses a WebSocket. This document covers how to connect. The message
  contract is in [EVENTS.md](EVENTS.md).
- The database tables behind these routes are described in [DATA_MODEL.md](DATA_MODEL.md).

## Machine-readable version

`docs/openapi.json` is generated. It is the body of `GET /api/openapi.json`. To regenerate it:

```sh
pnpm --filter @sim/api run openapi
```

The script (`apps/api/src/openapi-cli.ts`) builds the server in-process from the same route
modules, injects `GET /api/openapi.json` and writes the response to `docs/openapi.json`. It opens
no port and needs no database. Run it after adding or changing a route, and commit the result.

The generated document is less detailed than this one:

- It has no query parameters. `GET /api/owner/review-items` and `GET /api/owner/metrics` accept
  query parameters that do not appear in it.
- Every path parameter has the schema `{ "type": "string" }`. UUID and pattern constraints are
  not exported.
- Only 5 operations have a response schema: `GET /api/sessions`, `GET /api/sessions/{id}`,
  `GET /api/sessions/{id}/debrief`, `GET /api/sessions/{id}/transcript` and
  `GET /api/billing/usage`.
- Every operation lists responses 200, 400, 401, 403 and 404, whatever the route can return.
  Codes such as 402, 409, 410, 429, 502 and 503 are not listed.
- The WebSocket endpoint `/ws` is not in it, because it is not registered through `route()`.
- Its `info.description` refers to `docs/EVENT_CONTRACTS.md`. The WebSocket contract is in
  `docs/EVENTS.md`.

## Conventions

- All paths start with `/api/`, except the WebSocket endpoint `/ws`.
- Request bodies are JSON (`content-type: application/json`). The one exception is
  `POST /api/owner/cases/import`, which takes `application/zip`.
- The body limit is 2 MiB. The zip import route allows 200 MiB.
- A body that is not valid JSON returns `400 invalid_json`.
- Path parameters named `:id` must be UUIDs. A malformed value returns `400 invalid_request`.
- Timestamps in responses are ISO 8601 strings. Fields ending in `Ms` that describe session
  time are milliseconds of active station clock time, not wall-clock time.
- Responses are JSON with status 200 unless stated otherwise.

### Errors

Errors have this shape:

```json
{ "code": "invalid_request", "message": "invalid body", "issues": [{ "path": "mode", "message": "...", "code": "invalid_value" }] }
```

`issues` is present only for validation errors. For `invalid_request` each issue has `path`,
`message` and `code`. For `invalid_case` and `invalid_package` each issue has `path` and
`message`.

Errors that any route can return:

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request` | Path parameters, query or body failed schema validation. |
| 400 | `invalid_json` | The body is not valid JSON. |
| 401 | `unauthenticated` | The route needs a signed-in user and there is no valid credential. |
| 403 | `forbidden` | Owner route called by a non-owner, or a handler-level ownership check failed. |
| 403 | `mfa_required` | Owner route without a verified second factor (when `OWNER_MFA_REQUIRED` is true). |
| 403 | `csrf` | Cookie-authenticated non-GET request without `x-sim-csrf: 1`. |
| 404 | `not_found` | The resource does not exist, or it belongs to another user. |
| 429 | `rate_limited` | Rate limit exceeded. |
| 500 | `internal_error` | Unhandled error. The message is always `internal error`. |

The helper runs its checks in this order: authentication (401), owner role (403 `forbidden`),
owner MFA (403 `mfa_required`), CSRF (403 `csrf`), then validation of path parameters, query and
body (400). The handler runs last.

Other client errors raised by Fastify keep their status and use Fastify's error code as `code`,
for example `413 FST_ERR_CTP_BODY_TOO_LARGE` for a body over the limit or
`415 FST_ERR_CTP_INVALID_MEDIA_TYPE` for an unsupported content type. An unknown path gets
Fastify's default 404 body (`{ message, error, statusCode }`).

## Security rules

### Auth levels

Every route has one of three levels. The generated OpenAPI document shows it as `x-auth`.

| Level | Meaning |
|---|---|
| `public` | No credential needed. If a credential is present it is still resolved, so handlers such as `GET /api/auth/me` can use it. |
| `user` | A signed-in user with any role (`learner` or `owner`). |
| `owner` | Role `owner`, and a verified second factor when `OWNER_MFA_REQUIRED` is true. |

Roles come from `users.role` in the database, never from the client or from token claims. At
registration or first sign-in, a user whose email is in `OWNER_EMAILS` gets the role `owner`.

### Credentials

There are two authentication modes, chosen by `AUTH_PROVIDER`.

**Local (`AUTH_PROVIDER=local`).** For development and tests. `loadConfig` refuses it when
`NODE_ENV=production`.

- `POST /api/auth/register` and `POST /api/auth/login` set the cookie `sim_session`.
- Cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production`.
  It expires after `SESSION_TTL_HOURS` (default 12).
- The token is 32 random bytes (base64url). The database stores only its SHA-256 hash in
  `auth_sessions.token_hash`.
- A request is authenticated when the hash matches a row that is not revoked, not expired, and
  whose user is not deleted.
- `POST /api/auth/logout` revokes the row and clears the cookie.

**Supabase (`AUTH_PROVIDER=supabase`).** `Authorization: Bearer <access token>`.

- The token is verified against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. The issuer must
  be `${SUPABASE_URL}/auth/v1` and the audience `authenticated`. Algorithms ES256 and RS256 are
  accepted.
- The token must carry `sub` and `email`. A user row is created on the first request.
- The second factor counts as verified when the token's `aal` claim is `aal2`.
- The code comment notes that this mode has not been verified against a live Supabase project.

A bearer token is only checked when `AUTH_PROVIDER=supabase`. The cookie is only checked when
`AUTH_PROVIDER=local`.

### CSRF header

A request must carry the header `x-sim-csrf: 1` when all of these are true:

- the method is not GET;
- the route level is `user` or `owner`;
- the request is authenticated by the cookie.

Otherwise the request fails with `403 csrf`. Bearer-authenticated requests and `public` routes
(register, login, the Stripe webhook) do not need the header. The API registers no CORS handler,
so a browser on another origin cannot send the custom header without a preflight that the API
does not grant.

### Owner second factor

- Owner routes (`/api/owner/*`) require role `owner`. When `OWNER_MFA_REQUIRED` is true (the
  default; `loadConfig` requires it in production) they also require a verified second factor.
- Local mode: the owner enrols with `POST /api/auth/mfa/enroll` and verifies a code with
  `POST /api/auth/mfa/verify`. Verification sets `auth_sessions.mfa_verified_at` for that sign-in
  session only. TOTP uses SHA-1, a 30-second step, 6 digits, and accepts one step either side.
- Supabase mode: the token must have `aal: "aal2"`.
- The MFA check applies only to `owner` routes. Some `user` routes also give the owner role extra
  access, and they do not check MFA:
  - Session routes that use `accessibleSession` let the owner read any learner's session
    (state, debrief, transcript, replay) and abort any learner's session that has not started.
  - `GET /api/media/:handle/:frame` lets the owner stream any learner's media handle.
  - `POST /api/sessions` with `mode: "owner_preview"` checks the role but not MFA.

### Rate limits

`@fastify/rate-limit` runs after authentication. A signed-in request is counted per user
(`user:<id>`), so learners behind one network address do not throttle each other. An anonymous
request is counted per client address (`ip:<address>`). In production the address comes from
`X-Forwarded-For`, read through `TRUST_PROXY` trusted hops (default 1; see
[DEPLOYMENT.md §3.2](runbooks/DEPLOYMENT.md)).

- Routes without their own limit share one counter: 600 requests per minute per user or
  address. This includes the WebSocket upgrade on `/ws`.
- A route with its own limit has a separate counter:

| Route | Limit |
|---|---|
| `POST /api/auth/register` | 10 per minute |
| `POST /api/auth/login` | 10 per minute |
| `POST /api/auth/mfa/verify` | 10 per minute |
| `POST /api/sessions` | 20 per minute |
| `POST /api/sessions/:id/ws-ticket` | 30 per minute |
| `GET /api/media/:handle/:frame` | 1200 per minute |
| `POST /api/account/export` | 3 per hour |
| `POST /api/account/delete` | 3 per hour |
| `POST /api/appeals` | 10 per hour |
| `POST /api/stripe/webhook` | 600 per minute |
| `POST /api/owner/cases/import` | 20 per hour |

Exceeding a limit returns `429 rate_limited`.

### Response headers

- Every response: `x-content-type-options: nosniff`, `referrer-policy: no-referrer`,
  `x-frame-options: DENY`.
- Every `/api/` response gets `cache-control: no-store` unless the handler set its own value.
- The logger redacts `authorization`, `cookie` and `set-cookie` headers and does not log request
  bodies. Logging is off when `NODE_ENV=test`.

### Media handles and media delivery

Candidates never see authored asset ids or storage keys. They see opaque handles.

- A handle is `h_` followed by 32 lowercase hex characters (16 random bytes).
- The live session creates one handle per disclosed asset per case attempt: when a case starts
  (opening stage assets) and when a stage reveal discloses new assets.
- Each handle is stored in `asset_handles` with the user, session, case attempt, case version and
  asset id. `(case_attempt_id, asset_id)` is unique, so a new attempt gets new handles.
- `GET /api/media/:handle/:frame` authorizes every request:
  - The handle must exist and not be revoked. Withdrawing a case revokes all its handles.
  - The handle must belong to the caller, or the caller has role `owner`.
  - Missing, revoked and other users' handles all return `404 not_found`, so a caller cannot
    tell whether a handle exists.
  - While the session is `active` or `technically_interrupted`, only handles of the active case
    attempt are served. Others return `403 not_current_case`.
  - A withdrawn case returns `410 withdrawn`. The withdrawal check is not cached.
- Media is streamed by the API from the `derivatives` bucket. There are no public URLs. Response
  headers: `cache-control: private, no-store, max-age=0`, `vary: Cookie, Authorization`,
  `content-disposition: inline`, `cross-origin-resource-policy: same-site`,
  `x-content-type-options: nosniff`.

## WebSocket connection

The live session runs over one WebSocket per session. Cookies are not used on the socket.

1. Call `POST /api/sessions/:id/ws-ticket` (auth `user`, CSRF header needed with the cookie). It
   returns `{ ticket, url }`. `url` is `${PUBLIC_API_WS_URL}/ws` (default `ws://localhost:4000/ws`).
2. Open `${url}?ticket=<ticket>` (URL-encode the ticket).

Ticket rules (`apps/api/src/live/tickets.ts`):

- 24 random bytes, base64url.
- Valid for 60 seconds.
- Single use: redeeming deletes it, whether or not it was still valid.
- Kept in memory in the API process that issued it. With several API instances, the ticket
  request and the socket must reach the same instance, and a session's sockets must always be
  routed to one instance (sticky routing by session id).
- Only the session's own learner can get a ticket. The owner gets `403 forbidden` for another
  user's session; any other user gets `404 not_found`. Sessions that are `complete` or `aborted`
  return `409 session_over`.

Close codes sent by the server:

| Code | Reason | Cause |
|---|---|---|
| 4401 | `invalid or expired ticket` | Ticket unknown, already used or expired. |
| 4403 | `origin not allowed` | `NODE_ENV=production`, an `Origin` header is present and it is not `PUBLIC_WEB_ORIGIN`. |
| 4403 | `forbidden` | The ticket's user is not the session's user. |
| 4001 | `superseded` | Another socket attached to the same session. The old socket first receives a `notice` with code `superseded`. |
| 1011 | `session unavailable` | The session controller could not be loaded. |
| 1012 | `service restart` | The API process is shutting down (`LiveRegistry.shutdown`). The session stays `active` in the database and is paused when the API starts again. |

Messages that arrive before the session controller has loaded are buffered and processed in
order once it attaches. The maximum WebSocket message size is 1 MiB. To reconnect, request a new
ticket. See [EVENTS.md](EVENTS.md) for the messages and for what happens on disconnect.

## Routes

The 77 operations are grouped by area. Each entry gives the method and path, the `summary` from
the route definition, the auth level, the request fields with their constraints, the response,
and the error codes the handler returns. Errors from the table under [Errors](#errors) are not
repeated.

### Service and catalogue

#### `GET /api/health`

Liveness and dependency status (no secrets).

- Auth: `public`.
- Response: `{ ok, db, providers: { llm: { name, simulated } | null, asr, tts }, fixturesAllowed, devInjection }`.
  `ok` and `db` are true when `select 1` succeeds. `asr` is `server_stream`, `browser` or
  `dev_injection_only`. `tts` is `server_stream`, `browser` or `none`.

#### `GET /api/profiles`

Available examination profiles (with verification status and unresolved conflicts).

- Auth: `public`.
- Response: array of active profile versions, each
  `{ versionId, profileId, displayName, board, track, cohort, modes, stationDurationSeconds, minCases, maxCases, verification, scoringKind, scoringDisclaimer, publicDescription, sources: [{ title, url, accessDate }] }`.

#### `GET /api/openapi.json`

OpenAPI 3.1 description of the HTTP API.

- Auth: `public`.
- Response: the OpenAPI document. See [Machine-readable version](#machine-readable-version).

### Auth

#### `POST /api/auth/register`

Create a local development account (disabled when managed auth is configured).

- Auth: `public`. Rate limit: 10 per minute.
- Body:
  - `email`: email address, at most 200 characters. Stored in lower case.
  - `password`: string, 10 to 200 characters. Stored as an scrypt hash.
  - `displayName`: string, at most 100 characters. Optional.
  - `acceptTerms`: must be `true`.
- Response: `{ userId, role }`. Sets the `sim_session` cookie.
- Errors: `404 not_available` (auth provider is not local), `409 email_taken`.
- Side effects: inserts `terms` and `privacy` consent records with policy version
  `draft-2026-11-15`.

#### `POST /api/auth/login`

Sign in with a local development account.

- Auth: `public`. Rate limit: 10 per minute.
- Body: `email` (email, at most 200 characters), `password` (string, 10 to 200 characters).
- Response: `{ userId, role, mfaRequired, mfaEnrolled }`. `mfaRequired` is true for an owner
  when `OWNER_MFA_REQUIRED` is true. Sets the `sim_session` cookie.
- Errors: `404 not_available` (auth provider is not local), `401 invalid_credentials`. The same
  error is returned for an unknown email, a wrong password and a deleted account.
- Side effects: audit event `auth.login`.

#### `POST /api/auth/logout`

Sign out.

- Auth: `user`.
- Response: `{ ok: true }`. Revokes the local auth session (if any) and clears the cookie.

#### `GET /api/auth/me`

Current user.

- Auth: `public`.
- Response when signed out: `{ authenticated: false, authProvider }`.
- Response when signed in:
  `{ authenticated: true, authProvider, user: { id, email, displayName, role }, mfa: { verified, enrolled, requiredForOwner } }`.

#### `POST /api/auth/mfa/enroll`

Begin TOTP enrolment (owner, local auth).

- Auth: `user`. The handler requires role `owner`.
- Response: `{ secret, otpauthUri }`. The secret is base32. It is stored encrypted
  (AES-256-GCM, key derived from `AUTH_ENCRYPTION_KEY`).
- Errors: `404 not_available` (auth provider is not local), `403 forbidden` (not an owner),
  `409 already_enrolled`.

#### `POST /api/auth/mfa/verify`

Verify a TOTP code for this sign-in session.

- Auth: `user`. Rate limit: 10 per minute.
- Body: `code`, exactly 6 digits.
- Response: `{ ok: true }`. Marks the second factor as enrolled (first time) and as verified for
  the current auth session.
- Errors: `404 not_available` (auth provider is not local, or the request is not
  cookie-authenticated), `400 not_enrolled`, `401 invalid_code`.
- Side effects: audit event `auth.mfa_verified`.

### Sessions

A station session moves through these statuses: `preflight` → `ready` → `active` (↔
`technically_interrupted`) → `finalizing` → `complete`, or `aborted`. HTTP routes create and
prepare sessions. The WebSocket runs them.

Results are released by this rule (`caseReleased` in `apps/api/src/services/results.ts`):
in `practice` mode a case is released once it is closed; in `exam` and `owner_preview` modes
nothing is released until the session status is `complete`.

#### `POST /api/sessions`

Create a station session (assembles an exam form; checks entitlement).

- Auth: `user`. Rate limit: 20 per minute.
- Body:
  - `profileVersionId`: string, at least 3 characters.
  - `mode`: `exam`, `practice` or `owner_preview`.
  - `caseCount`: integer 1 to 10. Optional. The value is clamped to the profile's `minCases` and
    `maxCases`. Without it the server uses 3, clamped the same way.
  - `inputMode`: `voice` (default) or `typed_practice`.
  - `demo`: boolean. Optional. Starts the free demonstration: practice mode, one case, chosen
    from `system_config.demo_case_ids` (or `fx-stroke-lmca` when that is empty and fixtures are
    allowed).
  - `previewCaseVersionIds`: array of at most 10 strings. Required and non-empty for
    `owner_preview`.
- Response: `{ sessionId, notes }`. `notes` are form-assembly notes.
- Errors:
  - `400 unknown_profile`
  - `403 forbidden`: `owner_preview` requested by a non-owner.
  - `400 mode_not_available`: the profile does not offer this mode.
  - `400 typed_not_allowed`: `typed_practice` with `mode: "exam"`.
  - `400 demo_practice_only`: `demo: true` with a mode other than `practice`.
  - `409 demo_unavailable`: no demonstration case is configured.
  - `402 demo_used`: the user's `demoCasesRemaining` is 0.
  - `402 not_entitled`, `402 insufficient_minutes`: only when `BILLING_ENFORCED` is true and the
    session is neither a demo nor an owner preview. The station needs
    `ceil(durationSeconds / 60)` available minutes.
  - `400 preview_cases_required`
  - `409 no_eligible_cases`: form assembly found no eligible published case.
- Notes:
  - Minutes are not reserved here. They are reserved when the station starts over the WebSocket.
  - The `exam_forms`, `station_sessions` (status `preflight`) and `case_attempts` rows are
    inserted in one transaction.
  - An unknown id in `previewCaseVersionIds` currently produces `500 internal_error`.

#### `GET /api/sessions`

List my sessions.

- Auth: `user`. Returns only the caller's sessions, newest first, at most 100.
- Response: array of `SessionSummary`:
  `{ sessionId, mode, status, outcome, profileDisplayName, createdAt, endedAt, caseCount, resultStatus }`.
  `resultStatus` is `available` (status `complete`), `pending` (`finalizing`), `unavailable`
  (`aborted`) or `not_started` (any other status).

#### `GET /api/sessions/:id`

Session state (candidate-safe DTO).

- Auth: `user`. The session's learner or the owner.
- Response: `CandidateSessionState` (`packages/contracts/src/dto.ts`): status, outcome, profile
  summary, clock, case index and count, the current case view (neutral label, history,
  disclosed assets with handles, viewer permissions and layout, delivered prompts limited to what
  was played), input mode, speech modes, practice state, fixture flag and `lastServerSeq`.
- Errors: `404 not_found`.
- Note: the state comes from the in-memory session controller, which this route loads if needed.

#### `POST /api/sessions/:id/preflight`

Record preflight checks (microphone, audio, rendering, connection, browser).

- Auth: `user`. Only the session's learner.
- Body (all fields required):
  - `microphone`: `granted`, `denied`, `unavailable` or `not_required`.
  - `audioPlayback`: `ok`, `failed` or `skipped`.
  - `imageRender`: `ok` or `failed`.
  - `connectionRttMs`: integer 0 to 60000, or `null`.
  - `speechRecognition`: `available`, `unavailable` or `not_required`.
  - `browser`: `{ userAgentFamily` (string, at most 60), `webAudio` (boolean), `webSocket`
    (boolean), `screenWidth` (integer), `screenHeight` (integer) `}`.
- Response: `{ ready, problems: string[] }`. The session becomes `ready` when there are no
  problems, otherwise it stays `preflight`. Problems are raised when:
  - voice input, microphone not `granted`, and server ASR mode is not `dev_injection_only`;
  - `imageRender` is not `ok`;
  - `browser.webSocket` is false;
  - voice input, browser ASR mode, and `speechRecognition` is not `available`.
- Errors: `403 forbidden` (the owner calling for another user's session; any other user gets
  `404 not_found`), `409 not_in_preflight` (status is neither `preflight` nor `ready`).

#### `POST /api/sessions/:id/ws-ticket`

Issue a single-use WebSocket ticket for the live session.

- Auth: `user`. Only the session's learner. Rate limit: 30 per minute.
- Response: `{ ticket, url }`. See [WebSocket connection](#websocket-connection).
- Errors: `403 forbidden` (the owner, for another user's session), `409 session_over` (status
  `complete` or `aborted`).

#### `GET /api/sessions/:id/debrief`

Debrief (released according to the profile's feedback-release policy).

- Auth: `user`. The session's learner or the owner.
- Response: `SessionDebrief` (`packages/contracts/src/feedback.ts`):
  `{ sessionId, mode, status, pendingReason, cases: CaseDebrief[], nextActivity }`. `status` is
  `pending`, `available`, `partial` or `unavailable`.
  - If the worker has stored a debrief, the latest stored version is returned.
  - Otherwise, in `exam` and `owner_preview` modes, a `pending` debrief with no cases.
  - Otherwise, in `practice` mode, a debrief composed now from the latest assessment of each
    closed, started case.

#### `GET /api/sessions/:id/transcript`

Transcript of released cases (examiner lines show only what was played).

- Auth: `user`. The session's learner or the owner.
- Response: array of `TranscriptLine`
  `{ id, speaker, text, interrupted, atMs, source, caseAttemptId, stageOrdinal, confidence }`,
  sorted by `atMs`.
  - Candidate lines: transcript segments with status `final` (current revisions only).
  - Examiner lines: utterances with `playedChars > 0`. `text` is cut to `playedChars`.
    `interrupted` is true unless the delivery status is `completed`.
  - `stageOrdinal` is always `null`.

#### `GET /api/sessions/:id/replay`

Replay material for released cases: images (opaque handles) and owner-approved key annotations.

- Auth: `user`. The session's learner or the owner.
- Response: `{ sessionId, cases: [{ caseAttemptId, caseLabel, caseStartedAtMs, isDevelopmentFixture, assets: [{ handle, label, frameCount, isPlaceholder, annotations: [{ frameIndex, kind, points, label }] }] }] }`.
  Only released cases that started are included. Frames are fetched with
  `GET /api/media/:handle/:frame`. Handles revoked by withdrawal are still listed, but the media
  route returns 404 for them.

#### `POST /api/sessions/:id/abort`

Abandon a session that has not started.

- Auth: `user`. The session's learner or the owner.
- Response: `{ ok: true }`. Sets status `aborted`, outcome `user_aborted` and `ended_at`.
- Errors: `400 already_started` (status is not `preflight` or `ready`).
- Note: this route updates the row directly. It writes no session event and does not notify a
  loaded session controller. Inside a live session, abort with the WebSocket message
  `request_end_station` instead.

### Media

#### `GET /api/media/:handle/:frame`

Stream one frame of a disclosed asset (authorized per request).

- Auth: `user`. Rate limit: 1200 per minute.
- Path parameters: `handle` matches `^h_[a-f0-9]{32}$`; `frame` is an integer 0 to 5000.
- Response: the frame bytes with the frame's MIME type and the headers listed under
  [Media handles and media delivery](#media-handles-and-media-delivery).
- Errors: `404 not_found` (unknown, revoked or other user's handle; unknown asset or frame),
  `403 not_current_case`, `410 withdrawn`, `502 media_unavailable` (file missing in storage).

### Learning

#### `GET /api/learning/plan`

Current learning plan (opaque assignment tokens only).

- Auth: `user`.
- Response: `{ plan: LearningPlan | null, pace }`.
  - `plan` is the newest plan row that has not been superseded, with the learner's preferences
    applied for display (`applyPlanPreferences` in `packages/ai/src/learning/plan.ts`). The
    stored plan is not changed.
  - `pace` is the user's `plan_pace`: `compressed`, `standard` (default) or `relaxed`. Each
    item's `suggestedAfterDays` is multiplied by 0.5, 1 or 2 and rounded; a value of 0 stays 0,
    any other value is at least 1.
  - Each item's `status` is taken from the stored item progress (`learning_plans.item_states`)
    when there is an entry for it, otherwise from the generated plan.
  - Items reference cases only through `assignmentToken`. The token-to-case map
    (`learning_plans.assignments`) is never sent.

#### `PUT /api/learning/preferences`

Set the learner's plan pace (spacing between plan items).

- Auth: `user`.
- Body: `pace`: `compressed`, `standard` or `relaxed`.
- Response: `{ pace }`. Stored in `users.plan_pace`. It applies to every plan shown afterwards.

#### `POST /api/learning/plan/items/:itemId/status`

Record progress on a plan item (the generated plan itself is not edited).

- Auth: `user`.
- Path: `itemId`, string of 1 to 80 characters.
- Body: `status`: `suggested`, `started`, `completed` or `skipped`.
- Response: `{ itemId, status }`. The status is stored in `item_states` of the current plan
  row. The worker generates a new plan when a finished session's debrief is first built; the new
  plan starts with no item progress.
- Errors: `404 not_found` (no current plan, or the plan has no item with this id).

#### `POST /api/learning/plan/start`

Start the practice station for a plan item (resolves the opaque assignment server-side).

- Auth: `user`.
- Body: `assignmentToken` matches `^as_[a-f0-9]{24}$`; `profileVersionId` string.
- Response: `{ sessionId, notes }`. Creates a practice session with voice input and one case,
  restricted to the assigned case.
- Errors: `404 not_found` (token not in the current plan), plus the errors of
  `POST /api/sessions`.

#### `GET /api/learning/progress`

Skill trends with denominators, separated by mode/exposure/assistance.

- Auth: `user`.
- Response: `{ note, perSkill, anatomyCoverage, fixtureAnatomyCoverage }`.
  - `perSkill`: one entry per skill, `{ skill, label, exam, practice, firstExposure, repeatExposure, developmentFixtures }`.
  - Each bucket is `{ observations, credited, uncertainOrNotAssessable, caseFamilies }`.
    `credited` counts `demonstrated` observations without assistance.
  - Only non-superseded skill observations are used. Development-fixture observations appear
    only in `developmentFixtures`.
  - Coverage maps count closed attempts by anatomy tag.

#### `GET /api/learning/practice-recommendation`

Practice targeting from the learner's weakest skill (deterministic).

- Auth: `user`.
- Response: `{ focusSkills }` from the current learning plan.
- Errors: `404 no_plan`.

### Account, consents and data requests

#### `GET /api/account/consents`

Current consent state (latest record per kind).

- Auth: `user`.
- Response: `{ policyVersion, consents: [{ kind, granted, policyVersion, at }] }`. `policyVersion`
  is the current `POLICY_VERSION` (`draft-2026-11-15`). A consent counts only if its
  `policyVersion` equals the current one.

#### `POST /api/account/consents`

Grant or withdraw a consent (append-only record).

- Auth: `user`.
- Body: `kind` (`microphone_processing`, `audio_retention`, `browser_speech_vendor`,
  `evaluation_use`, `terms` or `privacy`); `granted` (boolean).
- Response: `{ ok: true }`. Appends a record with the current policy version.
- Note: the live session checks `microphone_processing` before server speech recognition, and
  both `microphone_processing` and `browser_speech_vendor` before accepting browser speech
  recognition transcripts.

#### `POST /api/account/export`

Request an export of my own data (the private case bank is excluded).

- Auth: `user`. Rate limit: 3 per hour.
- Response: `{ requestId }`. Inserts a `data_requests` row (kind `export`) and enqueues a
  `data_export` job in the same transaction.

#### `GET /api/account/data-requests`

My export/deletion requests.

- Auth: `user`.
- Response: array of `{ id, kind, status, createdAt, completedAt, downloadable, expiresAt }`,
  newest first.
  - `downloadable` is true for a complete export whose file still exists.
  - `expiresAt` is set for completed exports: `completedAt` plus the API's
    `EXPORT_RETENTION_DAYS` (default 7, allowed 1 to 90). Otherwise `null`. The file is actually
    deleted by the worker's retention sweep, which uses the worker's own `EXPORT_RETENTION_DAYS`
    and the request's `createdAt` (see [DATA_MODEL.md](DATA_MODEL.md#privacy-jobs)).

#### `GET /api/account/exports/:id/download`

Download a completed export.

- Auth: `user`. Only the caller's own exports.
- Response: the export JSON as an attachment (`my-data-export.json`), with
  `cache-control: private, no-store`.
- Errors: `404 not_found` (not the caller's, not an export, or no file).

#### `POST /api/account/delete`

Delete my account and personal data (confirmation required).

- Auth: `user`. Rate limit: 3 per hour.
- Body: `confirmEmail`: email address. It must equal the account email (case-insensitive).
- Response: `{ requestId }`. Inserts a `data_requests` row (kind `deletion`) and enqueues a
  `data_deletion` job in the same transaction. See [DATA_MODEL.md](DATA_MODEL.md#privacy-jobs)
  for what the job deletes and keeps.
- Errors: `400 confirmation_mismatch`, `409 owner_account` (the owner account cannot be deleted
  here).
- Side effects: audit event `account.deletion_requested`.

#### `GET /api/account/recordings`

Retained audio recordings (only with opt-in consent).

- Auth: `user`.
- Response: array of `{ id, sessionId, retainedUntil, bytes }` for recordings not yet deleted.
  No code in this repository creates recordings, so the list is empty.

### Appeals

#### `POST /api/appeals`

Dispute a transcription or a grading decision (original result is preserved).

- Auth: `user`. Rate limit: 10 per hour.
- Body:
  - `caseAttemptId`: UUID.
  - `assessmentId`: UUID.
  - `kind`: `transcript` or `grading`.
  - `statement`: string, 10 to 4000 characters.
  - `disputedElementIds`: array of at most 20 strings, each at most 80 characters. Default `[]`.
  - `transcriptCorrections`: array of at most 20 `{ segmentId: UUID, proposedText: string (1 to 4000) }`.
    Default `[]`.
- Response: `{ appealId }`.
- Errors: `404 not_found` when the attempt is not the caller's or the assessment does not belong
  to that attempt.
- Side effects: inserts the appeal and an owner review item (kind `learner_appeal`, priority
  `normal`, dedupe key `appeal:<appealId>`) in one transaction.

#### `GET /api/appeals`

My appeals and their outcomes.

- Auth: `user`.
- Response: array of
  `{ id, kind, status, resolution, createdAt, caseAttemptId, sessionId, caseNumber }`, newest
  first. `status` is `submitted`, `upheld`, `revised` or `rejected` (the schema also allows
  `under_review`, which no code sets).

### Billing

Card handling stays in Stripe-hosted pages. A return from Checkout does not grant anything:
entitlements change only when the worker processes verified webhook events (see
[EVENTS.md](EVENTS.md#4-stripe-webhook-events)).

#### `GET /api/billing/usage`

Allowance, reserved, consumed and adjusted minutes; demo allowance.

- Auth: `user`.
- Response: `UsageSummary`:
  `{ plan, entitlementStatus, periodEndsAt, allottedMinutes, reservedMinutes, consumedMinutes, adjustedMinutes, availableMinutes, demoCasesRemaining, canStartPaidStation, blockingReason, currentPeriod }`.
  - All minute totals are computed from the usage ledger over the user's whole history.
    `reservedMinutes` counts reservations not yet released. `availableMinutes` is the sum of all
    ledger entries, never shown below 0.
  - `currentPeriod` is `{ startedAt, allottedMinutes, consumedMinutes, adjustedMinutes }` for the
    ledger entries since the most recent `allot` entry (excluding `expire` entries), or `null`
    before the first allowance. `startedAt` is that `allot` entry's creation time.
  - A paid station can start when the entitlement status is `active`, `trialing` or
    `canceled_pending_period_end` and available minutes are above 0.

#### `GET /api/billing/plans`

Plan catalogue (display only; Stripe holds authoritative prices).

- Auth: `public`.
- Response: `{ plans: [{ id, displayName, priceDisplay, includedMinutesPerPeriod, purchasable }], testMode }`.
  The `demo` plan is not listed. `purchasable` is true when `STRIPE_SECRET_KEY` and the plan's
  price variable (`STRIPE_PRICE_MONTHLY` or `STRIPE_PRICE_ANNUAL`) are set. `testMode` is true
  when there is no secret key or it starts with `sk_test_`.

#### `POST /api/billing/checkout`

Create a Stripe Checkout session (subscription mode).

- Auth: `user`.
- Body: `plan`: `individual_monthly` or `individual_annual`.
- Response: `{ url }` of the Checkout page. Creates a Stripe customer first if the user has none
  (metadata `user_id`). The Checkout session carries `client_reference_id` = user id and
  subscription metadata `user_id`. Success and cancel URLs point to
  `${PUBLIC_WEB_ORIGIN}/app/billing`.
- Errors: `503 billing_not_configured` (no secret key or no price for the plan),
  `409 live_key_outside_production` (a non-test key outside production).
- Side effects: audit event `billing.checkout_created`.

#### `POST /api/billing/portal`

Open the Stripe customer portal.

- Auth: `user`.
- Response: `{ url }`.
- Errors: `503 billing_not_configured`, `409 no_customer`.

#### `POST /api/stripe/webhook`

Stripe webhook (signature-verified on the raw body; durable and deduplicated).

- Auth: `public`. Rate limit: 600 per minute. No CSRF header.
- Body: the raw Stripe event (`application/json`) with the `Stripe-Signature` header.
- Response: `{ received: true, duplicate }`. `duplicate` is true when the event id was already
  stored.
- Errors: `503 billing_not_configured` (no `STRIPE_WEBHOOK_SECRET`), `400 no_body`,
  `400 invalid_signature`.

### Owner console

Every route in this section has auth level `owner`: role `owner` plus a verified second factor
when `OWNER_MFA_REQUIRED` is true. All have the tag `owner`.

#### Review queue

##### `GET /api/owner/overview`

Owner overview: queue counts, case pipeline, content requests, dead jobs.

- Response: `{ queue: [{ kind, priority, n }], pipeline: [{ status, fixture, n }], contentRequests: [{ status, n }], deadJobs }`.
  `queue` counts open review items.

##### `GET /api/owner/review-items`

Exception queue (filter by status/priority/kind).

- Query:
  - `status`: `open` (default), `resolved` or `dismissed`.
  - `priority`: `urgent`, `normal` or `digest`. Optional.
  - `kind`: string. Optional.
- Response: array of review item rows
  `{ id, kind, priority, status, title, detail, refs, dedupeKey, resolution, resolvedBy, createdAt, resolvedAt }`,
  sorted `urgent`, `normal`, `digest`, newest first within a priority.
- Note: the query takes the 500 newest items with the given status, then filters by `priority`
  and `kind`.

##### `POST /api/owner/review-items/:id/resolve`

Resolve or dismiss a queue item.

- Body: `status` (`resolved` or `dismissed`); `resolution` (string, 1 to 2000).
- Response: `{ ok: true }`.
- Errors: `404 not_found`.
- Side effects: audit event `review_item.resolved`.

#### Cases and versions

Case version ids have the form `<caseId>@v<n>`. The workflow is `draft` → `automated_checks` →
`ready_for_owner` → `owner_approved` → `published` → `retired`. A version can go back to `draft`
from `automated_checks`, `ready_for_owner` and `owner_approved`. Any other move returns
`409 invalid_transition`. The `:versionId` parameter is a string of 3 to 100 characters.

##### `GET /api/owner/cases`

Cases with their versions and status.

- Response: `[{ caseId, versions: [{ versionId, versionNumber, status, internalTitle, isFixture, errors, warnings, updatedAt, isPublished, withdrawn, anatomy, difficulty }] }]`,
  versions newest first.

##### `GET /api/owner/case-versions/:versionId`

Full case version for review: content, hashes, validation, critiques, gate, diff.

- Response: `{ versionId, rowVersion, status, payload, hashes, approvalValid, validationIssues, reviews, publicationGate, case, versions, changeFromPrevious }`.
  - `payload` is the full `CaseVersion`, including clinical truth and rubric.
  - `hashes` is `{ clinicalContentHash, rubricHash, assetsHash }`, computed now.
  - `approvalValid` is `null` without an approval, otherwise whether the approval hashes still
    match.
  - `reviews` are the version's `case_reviews` rows (automated checks, critics, LLM author),
    newest first.
  - `changeFromPrevious` classifies the difference from the previous version as `identical`,
    `display_only` or `clinical`.
- Errors: `404 not_found`.

##### `PUT /api/owner/case-versions/:versionId`

Save a draft (optimistic concurrency via rowVersion).

- Body: `rowVersion` (integer; the value you loaded); `payload` (a full `CaseVersion` object).
- Response: `{ rowVersion, issues, valid }`. The saved version keeps status `draft` and loses any
  approval.
- Errors: `404 not_found`, `409 not_draft`, `400 invalid_case` (schema errors in `issues`),
  `400 id_mismatch` (`caseId` or `versionId` changed), `409 stale_version` (`rowVersion` no
  longer matches).
- Side effects: audit event `case.draft_saved`.

##### `POST /api/owner/cases`

Create a draft case from a full case JSON.

- Body: `payload` (a full `CaseVersion` object).
- Response: `{ versionId }`. The version id is `<caseId>@v1`, status `draft`, no approval.
- Errors: `400 invalid_case`, `409 case_exists`.

##### `POST /api/owner/cases/import`

Import a sim-case-import@1 package (zip) produced by tools/ingestion as a DRAFT.

- Rate limit: 20 per hour. Body: `application/zip`, at most 200 MiB.
- The zip must contain a `case-import.json` manifest matching the `sim-case-import@1` schema
  (`ImportPackage` in `apps/api/src/services/owner-cases.ts`). Each frame file must exist, match
  its SHA-256 digest and be at most 50 MB. Frames are written to the `derivatives` bucket under
  `cases/<caseId>/<caseId>_v1/<assetId>/<index>.<ext>`.
- Response: `{ versionId, issues }`. The draft contains placeholders for the owner or the LLM
  author to complete.
- Errors: `400 zip_required`, `400 invalid_zip`, `400 missing_manifest`, `400 invalid_package`,
  `400 missing_frame`, `400 digest_mismatch`, `400 frame_too_large`, `409 privacy_findings`
  (a high-severity privacy finding), `409 case_exists`.
- Side effects: audit event `case.imported`.

##### `POST /api/owner/case-versions/:versionId/new-version`

Create a new draft version (revision).

- Response: `{ versionId }` of the new draft `<caseId>@v<latest + 1>`. It copies the source
  version, clears the approval and sets `previousVersionId`.
- Errors: `404 not_found`.
- Side effects: audit event `case.version_created`.

##### `POST /api/owner/case-versions/:versionId/submit`

Submit a draft for automated checks.

- Response: `{ status: "automated_checks" }`. Enqueues a `case_automated_checks` job.
- Errors: `404 not_found`, `409 invalid_transition`.
- Side effects: audit event `case.submitted_for_checks`.

##### `POST /api/owner/case-versions/:versionId/approve`

Owner clinical approval bound to the reviewed content hash.

- Body: `attestation` (string, 10 to 500); `notes` (string, at most 2000, default `""`);
  `expectedClinicalContentHash` (64 lowercase hex characters: the hash shown when you reviewed).
- Response: `{ status: "owner_approved", hashes }`. The approval stores the clinical, rubric and
  assets hashes. Review items of kind `case_ready_for_approval` for the version are marked
  resolved.
- Errors: `404 not_found`, `409 not_ready` (status is not `ready_for_owner`),
  `409 validation_errors`, `409 content_changed` (current hash differs from the expected one).
- Side effects: audit event `case.approved`.

##### `POST /api/owner/case-versions/:versionId/request-changes`

Return a version to draft with notes.

- Body: `notes` (string, 1 to 2000).
- Response: `{ status: "draft" }`. Clears the approval and adds a change-log entry.
- Errors: `404 not_found`, `409 invalid_transition`.
- Side effects: audit event `case.changes_requested`.

##### `POST /api/owner/case-versions/:versionId/clearances`

Record rights/privacy clearance (separate from clinical approval).

- Body (all optional): `rights` and `privacy`, each `{ status: "unresolved" | "cleared" | "restricted" | "withdrawn", basis: string (at most 1000), restrictions: string (at most 1000) }`;
  `externalAiProcessingAllowed` (boolean).
- Response: `{ clearances, source }`. Clearances are governance fields outside the clinical
  hash, so an existing approval stays valid.
- Errors: `404 not_found`, `409 retired`.
- Side effects: audit event `case.clearances_updated`.

##### `POST /api/owner/case-versions/:versionId/publish`

Publish an approved version (gates: approval hash, rights, privacy).

- Response: `{ status: "published" }`. A previously published version of the case is retired,
  and `cases.published_version_id` points to this version.
- Errors: `404 not_found`, `409 not_owner_approved`, `409 approval_hash_mismatch`,
  `409 fixture_not_publishable` (fixtures when `ALLOW_FIXTURES` is false),
  `409 privacy_not_cleared`, `409 rights_not_cleared`, `409 withdrawn`,
  `409 invalid_transition`.
- Side effects: audit event `case.published`.

##### `POST /api/owner/case-versions/:versionId/retire`

Retire a published version (no new selection).

- Response: `{ status: "retired" }`. Clears `cases.published_version_id` if it pointed to this
  version.
- Errors: `404 not_found`, `409 invalid_transition`.
- Side effects: audit event `case.retired`.

##### `POST /api/owner/case-versions/:versionId/critique`

Run LLM clinical and rubric critics (if permitted).

- Response: `{ queued: 2 }`. Inserts two `case_llm_critique` jobs (`focus` `clinical` and
  `rubric`). The worker skips them when no model is configured or external AI processing is not
  permitted for the case.
- Side effects: audit event `case.critique_requested`.

##### `POST /api/owner/case-versions/:versionId/author`

Ask the LLM case author to draft stages, questions and rubric (drafts only).

- Body: `ownerNotes` (string, at most 20000); `teachingText` (string, at most 50000, default
  `""`).
- Response: `{ queued: 1 }`. Inserts a `case_llm_author` job.
- Errors: `404 not_found`, `409 not_draft`.
- Side effects: audit event `case.author_requested`.

##### `POST /api/owner/case-versions/:versionId/preview`

Start an owner preview session for this version (excluded from learner progress and billing).

- Response: `{ sessionId, notes }`. Creates an `owner_preview` session for this version. The
  profile is the first entry of the version's `eligibleProfileVersions`, matched by profile id or
  version id.
- Errors: `404 not_found`, `400 no_profile`, plus the errors of `POST /api/sessions`.

##### `POST /api/owner/cases/:caseId/withdraw`

Withdraw unsafe/unauthorized content: stop selection and revoke media access.

- Path: `caseId`, 1 to 80 characters.
- Body: `reason` (string, 5 to 1000).
- Response: `{ affectedAttempts }`. Sets `withdrawn_at` and clears the published version. Revokes
  every media handle of every version of the case, including replay access. Opens a
  `rights_privacy_concern` review item. Assessments are kept.
- Errors: `404 not_found`.
- Side effects: audit event `case.withdrawn`.

##### `GET /api/owner/case-versions/:versionId/assets/:assetId/:frame`

Owner preview of any version's images (drafts included).

- Path: `versionId`, `assetId` strings; `frame` integer of at least 0.
- Response: the frame bytes, with `cache-control: private, no-store`.
- Errors: `404 not_found` (unknown version, asset or frame). A file missing from storage gives
  `500 internal_error` here (the learner media route returns `502 media_unavailable`).

#### Attempts, disputes and appeals

##### `GET /api/owner/case-attempts/:id`

Owner view of an attempt: transcript revisions, prompts, events, passes, versions.

- Response: `{ attempt, session, caseVersion, segments, utterances, passes, assessments, events, reviewItems, appeals }`.
  `segments` includes all revisions. `assessments` includes all versions. `events` are the
  attempt's session events (`seq`, `type`, `ms`, `payload`) in order.
- Errors: `404 not_found`.

##### `POST /api/owner/case-attempts/:id/resolve-element`

Owner decision on a disputed/uncertain element (new assessment version).

- Body:
  - `elementId`: string.
  - `status`: `demonstrated`, `partially_demonstrated`, `incorrect`, `not_demonstrated`,
    `not_assessable` or `uncertain`.
  - `rationale`: string, 5 to 2000.
  - `globalLevel`: `unsafe`, `below_expected`, `meets_expected`, `strong`, `exceptional` or
    `null`. Optional.
- Response: `{ assessmentId, version, globalRating }`. Inserts a new `case_assessments` version
  (the previous one is kept), resolves the matching disagreement review item and enqueues a
  `build_session_debrief` job, all in one transaction.
- Errors: `404 not_found` (no assessment, or unknown rubric element), `400 evidence_required`
  (a crediting status for an element with no evidence quote).
- Side effects: audit event `assessment.owner_resolution`.

##### `POST /api/owner/case-attempts/:id/reassess`

Queue a versioned reassessment (forced second pass).

- Body: `reason` (string, 3 to 500).
- Response: `{ queued: true }`. Inserts a `reassess_after_appeal` job.
- Side effects: audit event `assessment.reassess_requested`.

##### `GET /api/owner/appeals`

Learner appeals.

- Response: array of appeal rows (all columns), newest first, at most 200.

##### `POST /api/owner/appeals/:id/resolve`

Resolve an appeal (transcript revisions + versioned reassessment; history preserved).

- Body:
  - `decision`: `upheld`, `revised` or `rejected`.
  - `resolution`: string, 5 to 2000.
  - `transcriptCorrections`: array of at most 50 `{ segmentId: UUID, correctedText: string (1 to 4000) }`.
    Default `[]`.
  - `reassess`: boolean, default `false`.
- Response: `{ status }` (the decision).
- In one transaction: each correction marks the original segment `superseded` and inserts a new
  segment (revision + 1, provider `owner_correction`); the appeal and its review item are
  resolved; a `reassess_after_appeal` job is enqueued when `reassess` is true or there are
  corrections.
- Errors: `404 not_found` (appeal, or a segment not in the appeal's attempt),
  `409 already_resolved`, `409 already_revised` (segment already superseded).
- Side effects: audit event `appeal.resolved`.

#### Content requests and coverage

##### `GET /api/owner/content-requests`

Explicit content requests (missing cases are requests, never fabricated cases).

- Response: array of `content_requests` rows, ordered by `slot`.

##### `PATCH /api/owner/content-requests/:id`

Update a content request.

- Body: `status` (`open`, `in_progress`, `fulfilled` or `withdrawn`); `caseId` (string or
  `null`, optional).
- Response: `{ ok: true }`. An unknown id also returns `{ ok: true }`.

##### `GET /api/owner/coverage`

Published case coverage (fixtures excluded from production counts).

- Response: `{ publishedClinicalCases, publishedFixtures, byAnatomy, byPathology, byDifficulty, byTrack, urgent, differentialOnly, stackBased }`.

#### Metrics

##### `GET /api/owner/metrics`

Cost, latency, quality and exception metrics (last N days).

- Query: `days`, integer 1 to 365, default 30.
- Response: `{ days, models, cost, live, assessments, ownerExceptionsOpened, sessions, clientSamples }`.
  - `models`: per model role, call count, ok rate, p50/p95 latency, token totals and estimated
    cost.
  - `cost`: estimated total, completed non-preview stations and cost per completed station.
  - `live`: examiner decision latency (from `policy.decision` events), image acknowledgement
    latency (`viewer.command_sent` to `viewer.rendered`), interruptions and technical pauses.
  - `assessments`: totals, provisional and withheld rates, disputed elements, counts by assessor
    kind.
  - `clientSamples` counts `metric_samples` rows. No code writes that table, so it is 0.

#### Configuration

##### `GET /api/owner/config`

Kill switches, assessment policy, demo cases, profiles.

- Response: `{ switches, assessmentPolicy, demoCaseIds, profiles, providers }`.
  - `switches`: `{ examinerLlmDisabled, assessmentLlmDisabled, serverTtsDisabled, serverAsrDisabled, disabledCaseIds }`.
  - `assessmentPolicy`: stored value, or `{ secondPass: "always", randomSampleRate: 0.2, shareExtractionWithB: false }`.
  - `profiles`: `[{ versionId, active, displayName, verification }]`, all versions.
  - `providers`: `{ llm, examinerModel, asr, tts }`.

##### `PUT /api/owner/config/switches`

Kill switches for model roles, voice providers and cases.

- Body (all required): `examinerLlmDisabled`, `assessmentLlmDisabled`, `serverTtsDisabled`,
  `serverAsrDisabled` (booleans); `disabledCaseIds` (array of at most 500 strings).
- Response: `{ ok: true }`. Stored in `system_config` under key `switches`.
- Side effects: audit event `config.switches`.

##### `PUT /api/owner/config/assessment-policy`

Second-pass policy; reducing coverage requires explicit acknowledgement.

- Body: `secondPass` (`always` or `risk_based`); `randomSampleRate` (number 0 to 1);
  `shareExtractionWithB` (boolean); `acknowledgeReducedCoverage` (boolean, default `false`).
- Response: `{ ok: true }`. Stored under key `assessment_policy` (without the acknowledgement
  flag).
- Errors: `409 acknowledgement_required` (`risk_based` without `acknowledgeReducedCoverage: true`).
- Side effects: audit event `config.assessment_policy`.

##### `PUT /api/owner/config/demo-cases`

Cases used for the free public demonstration.

- Body: `caseIds` (array of at most 5 strings).
- Response: `{ ok: true }`. Stored under key `demo_case_ids`.

##### `POST /api/owner/profiles/:versionId/verification`

Record owner verification of a profile as a NEW profile version (attempts stay frozen).

- Body: `status` (`verified` or `provisional`); `notes` (string, 5 to 2000);
  `unresolvedConflicts` (array of strings, default `[]`).
- Response: `{ versionId }` of the new version, `<profileId>@<YYYY-MM-DD>.<n>`. The old version
  is set inactive in the same transaction. Sessions keep the profile version they were created
  with.
- Errors: `404 not_found`.
- Side effects: audit event `profile.verification`.

#### Users, jobs and sessions

##### `POST /api/owner/users/:id/adjust-minutes`

Owner usage adjustment (e.g. verified platform failure).

- Body: `minutes` (integer −1000 to 1000); `reason` (string, 5 to 500).
- Response: `{ ok: true }`. Appends an `adjust` entry to the usage ledger.
- Side effects: audit event `usage.adjusted`.

##### `GET /api/owner/jobs/dead`

Dead-lettered background jobs (payload ids only; no clinical content).

- Response: array of `{ id, kind, attempts, lastError, updatedAt }`, newest first, at most 200.
  `lastError` is cut to 500 characters.

##### `POST /api/owner/jobs/requeue-dead`

Requeue dead-lettered jobs after fixing the cause.

- Body: `ids` (array of 1 to 100 UUIDs).
- Response: `{ requeued }`: the number of jobs that were `dead` and are now `queued` with
  `attempts` reset to 0.

##### `GET /api/owner/sessions`

Recent sessions with case attempts (for exception review).

- Response: array of
  `{ sessionId, userId, learner, mode, status, outcome, createdAt, attempts: [{ id, ordinal, caseVersionId, status }] }`,
  newest first, at most 100. `learner` is the user's email.
