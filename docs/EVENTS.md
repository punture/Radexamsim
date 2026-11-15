# Event contracts

This document describes the messages and events that move between the parts of the system:

1. [WebSocket protocol](#1-websocket-protocol): browser ↔ live session controller.
2. [Durable session events](#2-durable-session-events): the append-only log in `session_events`.
3. [Background jobs](#3-background-jobs): the PostgreSQL job queue between the API and the worker.
4. [Stripe webhook events](#4-stripe-webhook-events): how billing events are taken in and applied.

It was written from the code. Where this document and the code disagree, the code is correct.
HTTP routes are in [API.md](API.md). Tables are in [DATA_MODEL.md](DATA_MODEL.md).

Main sources:

| Topic | Files |
|---|---|
| WebSocket message schemas, binary framing | `packages/contracts/src/ws.ts`, `packages/contracts/src/viewer.ts`, `packages/contracts/src/dto.ts` |
| WebSocket endpoint and tickets | `apps/api/src/routes/misc.ts` (`wsRoute`), `apps/api/src/live/tickets.ts` |
| Live session controller | `apps/api/src/live/session.ts`, `apps/api/src/live/registry.ts` |
| Event types, event append | `packages/contracts/src/events.ts`, `packages/db/src/events.ts` |
| Job queue, worker loop | `packages/db/src/queue.ts`, `apps/worker/src/runner.ts`, `apps/worker/src/jobs/*.ts` |
| Stripe events, usage ledger | `packages/billing/src/stripe-events.ts`, `packages/billing/src/ledger.ts` |

## 1. WebSocket protocol

### 1.1 Overview

- One socket per station session. Connect with a single-use ticket: `POST /api/sessions/:id/ws-ticket`,
  then open `/ws?ticket=<ticket>`. Ticket rules and close codes are in
  [API.md](API.md#websocket-connection).
- The server owns the clock, case order, stage state, allowed actions and usage accounting. The
  browser renders, plays audio, captures speech and reports what happened.
- The controller processes every input one at a time through a per-session queue: client
  messages, speech recognition callbacks and timers.
- Text frames carry JSON messages. Client messages must match `ClientMessage`, a union keyed on
  `type`. Every variant is a strict object, so unknown fields make the message invalid. An invalid
  message is dropped and the server sends a `notice` with code `invalid_message`.
- Binary frames carry audio ([1.9](#19-binary-audio-frames)).
- If processing an input throws, the server sends a `notice` with code `server_error` ("A
  technical problem occurred. Your work so far is saved.") and goes on with the next input.

### 1.2 Connection lifecycle

When a socket attaches, the controller:

1. Sends a `notice` with code `superseded` to the previously attached socket, if any, and closes
   it with code 4001.
2. Cancels the reconnect grace timer, if one is running.
3. Appends the event `connection.opened`.
4. If the status is `technically_interrupted`, resumes: the clock restarts, the status becomes
   `active`, the event `session.resumed` is appended and, if a case is active, the examiner says
   the technical-resume phrase.
5. Sends a `state` message.
6. Sends again every viewer command still waiting for an acknowledgement (same `commandId` and
   `seq`).
7. Starts the one-second tick if the session is `active`.

When the socket closes, the controller:

1. Appends the event `connection.closed`.
2. Ends any examiner utterance in progress as interrupted (reason `connection_lost`).
3. If the session is `active`, starts a grace timer of `profile.timing.reconnectGraceSeconds`.
   When it fires, the session pauses with reason `technical_connection`. The clock pause starts at
   the end of the grace period. The event `session.technical_pause` is appended.
4. If no socket reattaches within `profile.timing.maxTechnicalPauseSeconds` of the pause, the
   station ends with reason `technical_invalidation` (outcome `invalidated_technical`).

When the API process stops (`SIGINT` or `SIGTERM`), `LiveRegistry.shutdown` lets each
controller finish its queued work, then stops its timers and speech recognition stream and closes
its socket with code 1012 (`service restart`). Nothing is written at that point; the session stays
`active` in the database.

When the API process starts, it pauses every session left `active` with reason
`technical_platform`, starting the pause at the time of that session's last durable event
(`LiveRegistry.recoverOrphans`). The same maximum pause applies. If a station ends by technical
invalidation after a platform pause, the consumed minutes are credited back automatically (see
[`usage.consumed`](#23-event-types-written-by-the-code)).

Server speech recognition errors also cause a `technical_platform` pause.

### 1.3 Sequence numbers

There are two unrelated counters.

**Message `seq`.** The server messages `state`, `examiner_utterance`, `examiner_cancel`,
`viewer_command`, `transcript_echo`, `notice` and `station_ended` carry `seq`. The messages
`clock`, `command_result` and `pong` do not.

- `seq` is held in memory by the session controller. It starts at 1 for each controller instance.
  After an API restart a new controller starts again from 1.
- It is not stored anywhere.
- A number is used even when no socket is attached (the message is then dropped), so a client can
  see gaps.
- `state.lastServerSeq` is the counter value when the snapshot was built.
- The client's `hello.lastServerSeq` is not used. The server does not replay missed messages.
  After reconnecting, a client receives a fresh `state` snapshot and the pending viewer commands.

**Viewer command `seq`.** `ViewerCommand.seq` counts viewer commands per session. It is stored in
`station_sessions.viewer_seq` and is unique per session in `viewer_commands`. The contract says
clients ignore commands with a `seq` less than or equal to the last applied one. The web client
does this for commands that disclose no new assets.

### 1.4 Commands and idempotency

Client messages that change server state carry a `commandId`: `start_station`,
`candidate_transcript`, `end_turn`, `request_end_case`, `request_end_station`,
`practice_request_hint`, `practice_pause` and `practice_resume`.

- `commandId` is a client-chosen string of 8 to 64 characters, unique within the session.
- When the server applies a command, it inserts `(session_id, command_id)` into
  `processed_commands` in the same transaction as the state change.
- Before applying a command, the server looks it up. If it is already there, the server sends
  `command_result { commandId, ok: true, error: null }` and does nothing else. The table is
  durable, so this holds across reconnects and API restarts. The stored result is not replayed:
  a duplicate always gets `ok: true`.
- A command that fails is not recorded. Sending the same `commandId` again evaluates it again.
- On first processing, `start_station`, `candidate_transcript`, `practice_request_hint`,
  `practice_pause` and `practice_resume` always get a `command_result` (success or error).
  `end_turn`, `request_end_case` and `request_end_station` get no `command_result` when they
  succeed. Only a duplicate of them gets one.

Other client messages have no `commandId` and are not deduplicated. `tts_playback` reports for
an utterance other than the one in progress are ignored. A repeated `viewer_ack` is processed
again: it updates the stored command and appends render events again, but it does not run the
continuation a second time.

### 1.5 Client → server messages

| `type` | Fields | `commandId` | Reply |
|---|---|---|---|
| `hello` | `sessionId: string`, `lastServerSeq: int ≥ 0` | no | `state` |
| `start_station` | `commandId` | yes | `command_result`, then `state`, viewer command, opening utterance |
| `candidate_transcript` | `commandId`, `source`, `text`, `clientStartMs`, `clientEndMs`, `confidence`, `provider` | yes | `transcript_echo`, `command_result` |
| `speech_activity` | `state: "started" \| "stopped"`, `clientMs: int` | no | possibly `examiner_cancel` |
| `end_turn` | `commandId` | yes | none (decision follows) |
| `tts_playback` | `utteranceId: string`, `event`, `playedChars: int ≥ 0`, `error: string ≤ 300 \| null` | no | none |
| `viewer_ack` | `ack: ViewerAck` | no | none (continuation follows) |
| `viewer_view` | `samples: ViewerViewSample[]` (at most 50) | no | none |
| `viewer_interaction` | `active: boolean` | no | none |
| `request_end_case` | `commandId` | yes | none (decision follows) |
| `request_end_station` | `commandId` | yes | `station_ended`, then `state` (no `state` when aborting before the start) |
| `practice_request_hint` | `commandId` | yes | `command_result`, then a hint utterance or a `notice` |
| `practice_pause` | `commandId` | yes | `command_result`, `state` |
| `practice_resume` | `commandId` | yes | `command_result`, `state` |
| `audio_start` | `encoding: "linear16"`, `sampleRate: 16000 \| 24000 \| 48000` | no | none, or a `notice` |
| `audio_stop` | none | no | none |
| `ping` | `clientMs: number` | no | `pong` |

#### `hello`

The server sends a `state` snapshot. `sessionId` and `lastServerSeq` are not checked or used;
the ticket decides the session.

#### `start_station`

Starts the station. Required status: `ready` (set by the preflight route).

- If the session is already `active`, the server replies `command_result ok: true` and does
  nothing else.
- In one transaction, with the session row locked (`SELECT ... FOR UPDATE`):
  - re-checks that the stored status is `ready`;
  - demo session: consumes the free demonstration case (`entitlements.demo_cases_remaining - 1`);
  - other non-preview session with `BILLING_ENFORCED`: reserves `ceil(durationSeconds / 60)`
    minutes in the usage ledger and appends `usage.reserved`;
  - starts the clock, sets status `active`, sets `started_at`, appends `session.started`, records
    the command.
- Then sends `command_result ok: true`, starts the tick and starts the first case: event
  `case.started`, event `stage.revealed`, `state`, and a `load_assets` viewer command. The opening
  question is spoken after the images are acknowledged.
- Errors: `not_ready`, `demo_used`, `not_entitled`, `insufficient_minutes`.

#### `candidate_transcript`

A final piece of candidate speech or typed text produced by the client.

- Fields:
  - `source`: `client_asr` (browser speech recognition), `typed` or `dev_injected`.
  - `text`: 1 to 4000 characters.
  - `clientStartMs`, `clientEndMs`: integers ≥ 0.
  - `confidence`: number 0 to 1, or `null`.
  - `provider`: `{ name: string ≤ 60, model: string ≤ 60 | null }`.
- Accepted sources:
  - `client_asr` only when the server's ASR mode is `browser`;
  - `typed` only for `typed_practice` sessions and owner previews;
  - `dev_injected` only when `ALLOW_DEV_INJECTION` is true and `NODE_ENV` is not `production`.
- `client_asr` also needs the latest `microphone_processing` and `browser_speech_vendor`
  consents to be granted under the current policy version.
- The session must be `active`, with a current case, and not practice-paused.
- The server assigns the times. `endMs` is the session clock now. `startMs` is `endMs` minus the
  client duration (`clientEndMs - clientStartMs`, clamped to 0..120000 ms), but not before the
  case start.
- In one transaction: inserts a `transcript_segments` row, appends
  `transcript.segment_finalized` and records the command. Then sends `transcript_echo`
  (`interim: false`, `segmentId` = the stored id) and `command_result ok: true`, and starts the
  end-of-turn timer (`profile.turnTaking.endOfTurnSilenceMs`).
- The segment's `confidence` is also kept in memory as the latest candidate confidence for the
  case. When it is below 0.6 (`LOW_RECOGNITION_CONFIDENCE` in
  `packages/exam-engine/src/examiner.ts`), the next examiner decision context sets
  `lastCandidateTurnPoorlyRecognized: true`. The model prompt then prefers a clarification
  phrase. On a `candidate_turn_ended` decision where no approved fact reply matches, the
  deterministic fallback asks the candidate to repeat (`n_clarify_repeat`), unless the last
  examiner line already asked for a repeat or clarification. A `null` confidence never sets the
  flag. The value is not stored, so it is lost when the controller is reloaded.
- Errors: `source_not_allowed`, `consent_required`, `not_active`.

#### `speech_activity`

Voice activity detected by the client.

- `started`: cancels the end-of-turn and silence timers. If the examiner is speaking and the
  profile allows barge-in, the server sends `examiner_cancel` with reason `barge_in`.
- `stopped`: starts the end-of-turn timer. When it fires, the server asks the examiner policy
  for a decision (trigger `candidate_turn_ended`).
- `clientMs` is not used. No event is stored.

#### `end_turn`

The candidate says they have finished. The server records the command, sets an explicit
end-of-turn flag for the next decision, cancels the turn timers and asks for a decision (trigger
`candidate_turn_ended`). If the examiner is speaking or images are loading, the decision is
deferred until both are done.

#### `tts_playback`

Playback report for an examiner utterance. See [1.8](#18-examiner-speech-and-played-portion-accounting).

#### `viewer_ack`

Acknowledgement of a viewer command. See [1.7](#17-viewer-commands-and-acknowledgements).

#### `viewer_view`

Viewing telemetry: up to 50 samples of `{ handle, frameIndex: int ≥ 0, viewedMs: int 0..60000 }`.
Samples for handles outside the current case are dropped. If any remain, the server appends
`viewer.viewed` with the handles replaced by asset ids.

#### `viewer_interaction`

Whether the candidate is interacting with the viewer. The server stores the flag in memory. The
current server code does not act on it. Deferral while interacting is decided by the client (see
`deferWhileInteracting`).

#### `request_end_case`

The server treats this like `end_turn`: it records the command, sets the explicit end-of-turn
flag and asks for a decision. It does not close the case by itself. The case closes only if the
examiner policy then executes `advance_case`. That action is offered only when the current stage
allows it, the candidate has spoken in the case, and no mandatory question or required reveal
remains (unless case time is short). The policy may also ask a remaining question first.

#### `request_end_station`

The server records the command.

- Status `ready` or `preflight`: the session is aborted. Status `aborted`, outcome
  `user_aborted`, event `session.ended` with reason `user_aborted_before_start`, message
  `station_ended`.
- Otherwise: the station ends with reason `candidate_ended` (see station end below).

Station end (`endStation`):

1. Closes the current case (reason `candidate_requested` for a candidate end, `time_expired`,
   `technical_failure` or `station_ended`), which appends `case.closed` and enqueues its
   assessment job.
2. Stops the clock. Status becomes `finalizing`. Outcome is `completed`, `time_expired`,
   `candidate_ended` or `invalidated_technical`.
3. In one transaction with the session row locked: reconciles usage (non-preview sessions;
   appends `usage.consumed` when there was a reservation); closes pending cases that never started
   (no assessment); saves the session; appends `session.ended`; enqueues `build_session_debrief`;
   for technical invalidation, opens an owner review item (`technical_failure_adjustment`).
4. Sends `station_ended` and `state`.

#### `practice_request_hint`

Practice mode only, and only when the profile allows requested hints and a case is active.

- Fails with `not_allowed` otherwise, and with `busy` while the examiner is speaking.
- The server picks the first hint not yet given whose elements are assessable in the revealed
  stages. It records the command, appends `practice.hint_requested` (`hintId`, or `null` when
  none is left) and sends `command_result ok: true`.
- No hint left: `notice` with code `no_hint`.
- Otherwise the examiner speaks the hint (utterance kind `practice_hint`). Prompt class is
  `targeted_probe` for a `nudge` hint and `examiner_supplied` otherwise. A `targeted` hint also
  records its elements as supplied.
- The list of hints already given is kept in memory only.

#### `practice_pause` and `practice_resume`

Practice mode only, and only when the profile allows pausing. Otherwise `not_allowed`.

- Pause stops the clock (pause reason `practice_pause`). Resume restarts it.
- The server saves the session row, records the command, sends `command_result ok: true` and a
  `state` message. No session event is appended.
- While paused, candidate transcripts are rejected (`not_active`), microphone frames are dropped
  and no examiner decisions are made.

#### `audio_start` and `audio_stop`

Server speech recognition. `audio_start`:

- needs the latest `microphone_processing` consent under the current policy version; otherwise
  `notice` `consent_required`;
- opens a recognition stream only when the server ASR mode is `server_stream`, a provider is
  configured and no stream is open;
- sends `notice` `asr_disabled` when the owner kill switch `serverAsrDisabled` is on;
- on connection failure, pauses the session (`technical_platform`) and sends `notice`
  `asr_unavailable`.

Stream callbacks:

- speech started: handled like `speech_activity` `started`;
- interim text: `transcript_echo` with `segmentId: "interim"` and `interim: true` (not stored);
- final segment: stored like a candidate transcript with source `server_asr`, provider word
  timings shifted onto the session clock, and the vocabulary version in the event. Its provider
  confidence feeds the same low-confidence flag;
- utterance end: handled like `speech_activity` `stopped`;
- error: a technical note and a `technical_platform` pause.

`audio_stop` asks the provider to finalize the stream.

#### `ping`

The server replies `pong { clientMs, serverNowMs }`.

### 1.6 Server → client messages

| `type` | Fields | Sent when |
|---|---|---|
| `state` | `seq`, `state: CandidateSessionState` | After `hello`, attach, case start, stage reveal, practice pause/resume, station end. |
| `examiner_utterance` | `seq`, `utteranceId`, `kind`, `text`, `tts: { mode, voice }` | Each examiner utterance. `voice` is always `null`. |
| `examiner_cancel` | `seq`, `utteranceId`, `reason` | Barge-in (`barge_in`) or time expiry (`time_expired`). |
| `viewer_command` | `seq`, `command: ViewerCommand` | Each viewer command, and again on reattach while unacknowledged. |
| `clock` | `remainingMs`, `running`, `serverNowMs` | From the one-second tick while `active`, when more than 5 seconds have passed since the last `clock` message. |
| `transcript_echo` | `seq`, `segmentId`, `text`, `interim` | Each stored candidate segment, and each server ASR interim result. |
| `notice` | `seq`, `level: info \| warning \| error`, `code`, `message` | See the table below. |
| `command_result` | `commandId`, `ok`, `error: { code, message } \| null` | See [1.4](#14-commands-and-idempotency). |
| `station_ended` | `seq`, `outcome` | The station ended or was aborted. |
| `pong` | `clientMs`, `serverNowMs` | Reply to `ping`. |

`state` holds the full candidate-safe snapshot: status, outcome, clock, case index and count, the
current case view (neutral label, history, disclosed assets with opaque handles, viewer
permissions, layout and panes, prompts as heard), input mode, speech modes, practice state and
fixture flag. It never contains authored ids, clinical truth or rubric content.

`notice` codes:

| Code | Level | Meaning |
|---|---|---|
| `superseded` | warning | The session was opened in another window. This socket is closed. |
| `server_error` | error | Processing an input failed. |
| `invalid_message` | error | A text frame was not valid JSON or did not match the schema. |
| `consent_required` | error | `audio_start` without microphone-processing consent. |
| `time_warning` | warning | A configured time warning was reached (`profile.station.timeWarningsAtSecondsRemaining`). |
| `technical_pause` | warning | The session paused for a technical reason. |
| `asr_disabled` | error | Server speech recognition is switched off by the owner. |
| `asr_unavailable` | error | Server speech recognition could not connect. |
| `tts_disabled` | warning | Server examiner audio is switched off; the text is shown. |
| `tts_failed` | warning | Examiner audio synthesis failed; the text is shown. |
| `no_hint` | info | No further practice hint is available. |

`command_result` error codes:

| Message | Codes |
|---|---|
| `start_station` | `not_ready`, `demo_used`, `not_entitled`, `insufficient_minutes` |
| `candidate_transcript` | `source_not_allowed`, `consent_required`, `not_active` |
| `practice_request_hint` | `not_allowed`, `busy` |
| `practice_pause`, `practice_resume` | `not_allowed` |

### 1.7 Viewer commands and acknowledgements

The viewer protocol (`packages/contracts/src/viewer.ts`) is the same for still images, image
stacks and DICOM stacks.

`ViewerCommand` fields:

- `commandId`: a UUID.
- `seq`: per-session viewer command counter ([1.3](#13-sequence-numbers)).
- `caseAttemptId`.
- `kind`: `load_assets`, `set_layout`, `select_series` or `clear`.
- `layout`: `single`, `side_by_side` or `grid_2x2`.
- `panes`: at most 4 `{ paneId, handle, frameIndex: int | null, zoom: "fit" | number }`.
- `newAssets`: `CandidateAsset[]` disclosed by this command: `{ handle, label, kind, modality, sequence, plane, frameCount, mimeType, initialFrameIndex, initialZoom, frameRateFps, disclosedAtStage, isPlaceholder }`.
- `deferWhileInteracting`: the client may postpone applying the command while the candidate is
  interacting. False only for the `load_assets` command that opens a case.
- `awaitAck`: the examiner will not speak about the new images until a `rendered` acknowledgement
  arrives.

When commands are sent:

- `load_assets` with `awaitAck: true`: at case start (opening stage assets), and after a stage
  reveal that discloses new assets.
- `set_layout` (examiner action `set_viewport`) and `select_series` (examiner action
  `select_series`) with `awaitAck: false`.
- `clear` is in the schema but the server never sends it.

Each command is inserted into `viewer_commands` and logged as `viewer.command_sent` in one
transaction, together with the session's `viewer_seq`.

`viewer_ack` carries `ack: { commandId, status, panes }`:

- `status`: `rendered`, `failed`, `superseded` or `deferred`.
- `panes`: `{ handle, status: "rendered" | "failed", error: string ≤ 300 | null, renderMs: int | null }`.

How the server handles an acknowledgement:

- `deferred`: the client postponed the command. The server waits up to 36 seconds instead of
  12 and does nothing else.
- Any other status:
  - pane handles are mapped to asset ids of the current case (unknown handles are ignored);
  - for a `failed` ack, pending assets that the ack does not mention count as failed ("not
    displayed");
  - each asset's first successful render time, or its failure, is recorded in the attempt's
    stage state, which the assessment uses to decide what the candidate could see;
  - `viewer_commands.status` and `acked_at` are updated;
  - `viewer.rendered` or `viewer.render_failed` is appended per asset, and `viewer.superseded`
    for a `superseded` ack.
- If the command was waiting for an acknowledgement:
  - all new assets rendered: the continuation runs (at case start, the opening question; after a
    reveal, the reveal announcement);
  - otherwise a technical note is added and the examiner says the technical-image phrase. At case
    start the opening question follows. After a reveal nothing else is said, and any deferred
    decision runs.
- If no acknowledgement arrives within 12 seconds, the server acts as if a `failed` ack arrived
  for all new assets (error `acknowledgement timeout`).
- `renderMs` is accepted but not stored.

### 1.8 Examiner speech and played-portion accounting

The server plans every examiner utterance. In one transaction it inserts an
`examiner_utterances` row (status `planned`), appends `examiner.utterance_planned`, and appends
`prompt.recorded` when the prompt class is not `neutral` or the utterance targets or supplies
rubric elements. Then it sends `examiner_utterance`.

Utterance kinds: `opening`, `question`, `fact_reply`, `neutral`, `reveal_announcement`,
`closing`, `clarification`, `technical`, `practice_hint`.

`tts.mode` tells the client how to play it:

- `browser`: the client speaks the text with browser speech synthesis.
- `server_stream`: the server synthesizes the audio and sends it in one binary frame after the
  `examiner_utterance` message ([1.9](#19-binary-audio-frames)). If synthesis fails the server
  sends `notice` `tts_failed`. If the owner switched server audio off it sends `notice`
  `tts_disabled`. In both cases the text is shown on screen.
- `none`: no audio. The server marks the utterance started and completed at once.

The client reports playback with `tts_playback`:

| `event` | Server action |
|---|---|
| `started` | First one only: status `playing`, `playback_started_at_ms` set, event `examiner.audio_started`. |
| `progress` | Keeps the highest `playedChars` in memory. Nothing is stored yet. |
| `completed` | Ends the utterance as `completed`. Played characters = full text length. |
| `interrupted` | Ends it as `interrupted`. Played characters = the larger of the last progress value and the reported value. |
| `failed` | Ends it as `failed`. Played characters = the reported value. |

Rules:

- Reported counts are clamped to 0..text length. The server does not recompute them from audio
  alignment; it stores what the client reports.
- The web client reports `failed` with the full text length when it shows the text instead of
  playing audio, so that text counts as delivered.
- Ending an utterance updates `played_chars`, `playback_ended_at_ms`, `delivery_status` and
  `played_portion_method`, and appends `examiner.audio_completed`, `examiner.audio_interrupted`
  or `examiner.audio_failed` with `{ utteranceId, playedChars, totalChars, reason, method }`.
- `played_portion_method` is `completed` for a completed utterance. Otherwise it is
  `provider_alignment` if server synthesis returned alignment, `browser_boundary` if the TTS mode
  is `browser`, and `proportional_estimate` in other cases.
- Only `text.slice(0, played_chars)` counts as heard. That portion goes into the conversation the
  examiner policy sees, into `deliveredPrompts` in the candidate state, into the learner
  transcript and data export, and into the assessment inputs.

The server also ends utterances itself:

- Barge-in: the candidate starts speaking while the examiner speaks and the profile allows
  barge-in. The server sends `examiner_cancel` with reason `barge_in` and waits for the client's
  `interrupted` report.
- Time expiry (profiles with `hardStop`): the server sends `examiner_cancel` with reason
  `time_expired` and ends the utterance at once as interrupted, using the last progress value it
  holds. A later client report for that utterance is ignored. The examiner then says the
  time-up phrase and the station ends.
- Disconnect: the utterance ends as interrupted with reason `connection_lost`.
- Safety timeout: if no final report arrives within `max(4000, 90 × characters) + 15000` ms
  (8000 ms for the time-up phrase), the utterance ends as `interrupted` if playback started, or
  `failed` if not, with reason `playback_timeout`, and a technical note is added.

While the examiner is speaking or images are waiting for acknowledgement, a requested examiner
decision is deferred and runs once both are done.

### 1.9 Binary audio frames

Layout (`encodeBinaryFrame` / `decodeBinaryFrame` in `packages/contracts/src/ws.ts`):

| Bytes | Content |
|---|---|
| 0 | Frame type (unsigned 8-bit). |
| 1–2 | Header length in bytes (unsigned 16-bit, big-endian). |
| 3 … 3+n−1 | Header: UTF-8 JSON. |
| rest | Payload. |

| Type | Direction | Header | Payload |
|---|---|---|---|
| 1 (`BINARY_FRAME_MIC`) | client → server | The contract comment specifies `{ seq }`. The web client sends `{}`. The server does not read the header. | Microphone audio, PCM 16-bit little-endian, mono, at the `audio_start` sample rate. |
| 2 (`BINARY_FRAME_TTS`) | server → client | `{ utteranceId, chunkIndex, mime, durationMs, alignment }`. `chunkIndex` is always 0 (one frame per utterance). `alignment` is `{ chars: string[], startMs: number[], endMs: number[] }` or `null`. | Encoded examiner audio of type `mime`. |

Microphone frames are passed to the server speech recognition stream only when a stream is open,
the session is `active` and it is not practice-paused. Other microphone frames and malformed
frames are dropped without a reply.

The contract comment for type 2 lists `alignment?` and does not mention `durationMs`. The server
always sends both.

## 2. Durable session events

### 2.1 Storage

Events are rows in `session_events`:

| Column | Content |
|---|---|
| `id` | UUID. |
| `session_id` | The station session. |
| `case_attempt_id` | The case attempt for case-level events; `null` for session-level events. |
| `seq` | Per-session sequence number, starting at 1. |
| `server_time` | Database `now()` at insert. |
| `session_clock_ms` | Active station time (pauses excluded) when the event was appended. |
| `type` | One of the `EventType` values. |
| `payload_schema_version` | Always 1. |
| `payload` | JSON object; fields per type below. |
| `content_versions` | `{ profileVersionId, caseVersionId, rubricVersionId }` in force at the time. |

Events are written only through `appendEvent` (`packages/db/src/events.ts`). Two callers use it:
the live session controller and the `build_session_debrief` job.

### 2.2 Guarantees

- **Gap-free sequence per session.** `appendEvent` increments `station_sessions.event_seq` with
  `UPDATE ... RETURNING` and inserts the event with that number, inside the caller's transaction.
  If the transaction rolls back, both changes roll back, so committed numbers have no gaps. The
  row lock taken by the `UPDATE` makes concurrent appends for the same session wait for each
  other. A unique index on `(session_id, seq)` rejects duplicates.
- **Append-only.** The trigger `session_events_no_update` rejects every `UPDATE`. `DELETE` is
  allowed; the data deletion job removes all events of a user's sessions. Like all row triggers,
  it does not fire on `TRUNCATE`.
- **Same transaction as the state change.** The controller writes a state change and its event in
  one transaction. Examples: `case.closed` with the attempt update and the assessment job;
  `session.ended` with the session row, usage reconciliation and the debrief job;
  `transcript.segment_finalized` with the segment and the command record. Exceptions in the
  current code:
  - practice pause and resume change the clock and write no event;
  - marking a question as delivered (stage state) is committed in a separate transaction just
    before the utterance and its `examiner.utterance_planned` event;
  - `policy.decision` is committed in its own transaction, before the chosen action runs;
  - the HTTP routes `POST /api/sessions/:id/preflight` and `POST /api/sessions/:id/abort` change
    the session row without an event.
- `server_time` comes from PostgreSQL `now()`, which is the transaction start time. Events
  appended in one transaction share it.
- Payloads are not checked against a schema when they are written.

### 2.3 Event types written by the code

Written by the live session controller (`apps/api/src/live/session.ts`):

| Type | When | `case_attempt_id` | Payload |
|---|---|---|---|
| `connection.opened` | A socket attaches. | current attempt or null | `{}` |
| `connection.closed` | The attached socket closes. | current attempt or null | `{}` |
| `session.started` | `start_station` accepted. Same transaction as status `active`, the reservation and the command record. | null | `{ mode, caseCount }` |
| `usage.reserved` | `start_station`, only when a ledger reservation is made (`BILLING_ENFORCED`, not demo, not owner preview). | null | `{ minutes }` |
| `case.started` | A case begins. Same transaction as the attempt update, the new media handles and the session row. | attempt | `{ ordinal, caseVersionId }` |
| `stage.revealed` | Case start, and each authorized stage reveal. | attempt | Case start: `{ stageId, assetIds, via: "case_start" }`. Reveal: `{ stageId, assetIds, via: "examiner" \| "fact_reply", transitionId }`. `assetIds` lists newly disclosed assets. |
| `viewer.command_sent` | Each viewer command. | attempt | `{ commandId, seq, kind, assetIds }` (`assetIds`: new assets) |
| `viewer.rendered` | Per rendered asset in an acknowledgement. | attempt | `{ commandId, assetId, error: null }` |
| `viewer.render_failed` | Per failed asset, including acknowledgement timeouts. | attempt | `{ commandId, assetId, error }` |
| `viewer.superseded` | An acknowledgement with status `superseded`. | attempt | `{ commandId }` |
| `viewer.viewed` | `viewer_view` with at least one current-case handle. | attempt | `{ samples: [{ assetId, frameIndex, viewedMs }] }` |
| `transcript.segment_finalized` | Each stored candidate segment. | attempt | `{ segmentId, source, chars, vocabularyVersion }` (`vocabularyVersion` only for `server_asr`, else null) |
| `examiner.utterance_planned` | Each examiner utterance, with its `examiner_utterances` row. | current attempt or null | `{ utteranceId, kind, refId, promptClass }` |
| `prompt.recorded` | Same transaction, when the prompt class is not `neutral` or the utterance targets or supplies elements. | current attempt or null | `{ utteranceId, refId, promptClass, targetElementIds, suppliesElementIds }` |
| `examiner.audio_started` | First `started` report (immediately for TTS mode `none`). | current attempt or null | `{ utteranceId }` |
| `examiner.audio_completed`, `examiner.audio_interrupted`, `examiner.audio_failed` | The utterance ends. | current attempt or null | `{ utteranceId, playedChars, totalChars, reason, method }` |
| `policy.decision` | Each examiner decision that is actually made. | attempt | `{ trigger, proposer, proposed, accepted, rejectionReason, executed, latencyMs, model, promptVersion }` |
| `practice.hint_requested` | A practice hint request is accepted. | attempt | `{ hintId }` (null when none is left) |
| `case.closed` | A case closes. Same transaction as the attempt update and the `assess_case_attempt` job. | attempt | `{ reason, ordinal }` |
| `session.time_warning` | A configured warning time is reached. | null | `{ secondsRemaining }` |
| `session.technical_pause` | Grace period expired after a disconnect, or a platform failure. | null | `{ reason: "technical_connection" \| "technical_platform" }` |
| `session.resumed` | A socket attaches during a technical pause. | null | `{}` |
| `usage.consumed` | Station end, only when the session had a ledger reservation. Same transaction as the ledger `release`, `consume` and (platform failure) `adjust` entries. | null | `{ consumedMinutes, releasedMinutes, adjustedMinutes }` |
| `session.ended` | Station end. | null | `{ reason, outcome, activeMs }` with `reason` one of `time_expired`, `candidate_ended`, `all_cases_complete`, `technical_invalidation`. Abort before start: `{ reason: "user_aborted_before_start" }`. |

Written by the worker (`apps/worker/src/jobs/debrief.ts`):

| Type | When | `case_attempt_id` | Payload |
|---|---|---|---|
| `session.finalized` | `build_session_debrief` for a session in status `finalizing`. Same transaction as the debrief insert and status `complete`. `session_clock_ms` is the clock's accumulated active time. | null | `{ cases, unavailable }` |

Field notes:

- `examiner.audio_*` `reason`: `null` when completed; otherwise `barge_in`, `time_expired`,
  `connection_lost`, `playback_timeout`, the client's error text, or `playback_failed`.
- `examiner.audio_*` `method`: see [1.8](#18-examiner-speech-and-played-portion-accounting).
- `case.closed` `reason`: `examiner_completed`, `time_expired`, `candidate_requested`,
  `station_ended` or `technical_failure`.
- `policy.decision`:
  - `trigger`: `candidate_turn_ended`, `extended_silence` or `time_check`.
  - `proposer`: `llm` when an accepted model proposal was executed, otherwise
    `deterministic_fallback`.
  - `proposed`: the model's proposal `{ action, ref, reason, note }` when it passed schema
    validation, otherwise `{ fallback: <note> }`.
  - `accepted`: false only when a model proposal was rejected. With no model configured, or the
    examiner model switched off, it is true.
  - `rejectionReason`: `schema`, the prompt runner's reason, or the menu validator's reason (for
    example `ref_not_in_menu`).
  - `executed`: the command that ran, for example `{ kind: "wait" }` or
    `{ kind: "deliver_question", questionId }`.
  - `model`: the model reported by the provider, or null. `promptVersion`: the examiner prompt
    version when a model was called, otherwise null.
  - No `policy.decision` is written when the decision is deferred or skipped (session not active,
    no current case, practice pause, or a turn end before the candidate has spoken in the case).
  - The decision input (`ExaminerContext` in `packages/contracts/src/dto.ts`, including
    `lastCandidateTurnPoorlyRecognized`) is not stored in the event.

### 2.4 Declared but not written

`EventType` also lists `session.created`, `session.preflight_recorded`,
`transcript.segment_revised`, `usage.released` and `usage.adjusted`. No code appends them.

- The ledger release and platform-failure adjustment at station end are reported in
  `usage.consumed`.
- Owner minute adjustments write an audit event (`usage.adjusted`) but no session event.
- Transcript corrections from appeals are stored as new segment revisions and an audit event
  (`appeal.resolved`), with no session event.

`PolicyDecisionPayload` in `packages/contracts/src/events.ts` is a strict schema without a
`trigger` field. No code checks stored payloads against it, and the stored payload does include
`trigger`.

### 2.5 Related durable records

These are not session events, but they are durable logs written alongside them:

- `audit_events` (`apps/api/src/services/audit.ts`): actor, action, target and detail, without
  clinical text or credentials. Actions written: `auth.login`, `auth.mfa_verified`,
  `account.deletion_requested`, `billing.checkout_created`, `review_item.resolved`,
  `case.imported`, `case.draft_saved`, `case.version_created`, `case.submitted_for_checks`,
  `case.approved`, `case.changes_requested`, `case.clearances_updated`, `case.published`,
  `case.retired`, `case.withdrawn`, `case.critique_requested`, `case.author_requested`,
  `assessment.owner_resolution`, `assessment.reassess_requested`, `appeal.resolved`,
  `config.switches`, `config.assessment_policy`, `profile.verification`, `usage.adjusted`.
- `owner_review_items`: the owner's exception queue, deduplicated by `dedupe_key`. See
  [DATA_MODEL.md](DATA_MODEL.md#owner_review_items).

## 3. Background jobs

### 3.1 Queue mechanics

The queue is the `jobs` table (`packages/db/src/queue.ts`). There is no other broker.

**Enqueue.** `enqueue(tx, { kind, payload, dedupeKey, runAt?, maxAttempts? })`:

- inserts a row with `ON CONFLICT (dedupe_key) DO NOTHING` and returns the existing job's id
  when the key is taken;
- a dedupe key can be used once, whatever the status of the existing job (queued, running,
  succeeded or dead);
- defaults: `max_attempts` 5, `run_at` now.

Most callers enqueue inside the transaction that makes the change (a transactional outbox): if
the transaction rolls back, the job does not exist. The table in [3.2](#32-job-kinds) says which
calls do not. Some owner routes insert into `jobs` directly with keys that contain the current
time in milliseconds, so they are not deduplicated in practice.

**Wake-up.** The trigger `jobs_notify` (`AFTER INSERT ON jobs FOR EACH ROW`) runs
`pg_notify('jobs_queued', kind)`. PostgreSQL delivers a notification when the inserting
transaction commits and discards it on rollback. The worker keeps a dedicated connection that
runs `LISTEN jobs_queued`. When it finds no due job, it waits for a notification or 2 seconds,
whichever comes first, then tries again. Retries and owner requeues are updates, not inserts, so
they send no notification; the 2-second poll picks them up.

**Claim.** `claimJob` runs before each job:

1. Jobs in status `running` whose `locked_at` is older than the lease (5 minutes) return to
   `queued`, with ` [lease expired]` appended to `last_error`.
2. One due job is taken: `status = 'queued'`, `run_at <= now()`, kind handled by the worker,
   ordered by `run_at` then `created_at`, selected `FOR UPDATE SKIP LOCKED`. It becomes `running`
   with `locked_at = now()`, `locked_by = WORKER_ID` and `attempts + 1`.

Several worker processes can run at the same time; `SKIP LOCKED` gives each job to one of them.

**Outcome.**

- Success: status `succeeded`, `result` = the handler's return value.
- Any thrown error:
  - `attempts >= max_attempts`: status `dead`, plus an owner review item (kind
    `technical_failure_adjustment`, priority `normal`, dedupe key `dead-job:<jobId>`), in one
    transaction.
  - Otherwise: status `queued`, `run_at = now + backoff`, where backoff is
    `min(10 minutes, 2 s × 2^(attempts − 1))`: 2 s, 4 s, 8 s and so on, up to 10 minutes.
- `last_error` is redacted (Stripe keys, Anthropic keys and bearer tokens are masked) and cut to
  500 characters.
- A lease expiry does not dead-letter a job by itself. `attempts` grows at each claim, but the
  dead-letter check runs only when a handler throws.
- `POST /api/owner/jobs/requeue-dead` sets dead jobs back to `queued` with `attempts` 0.

The worker (`apps/worker/src/main.ts`) handles every kind in `HANDLED_KINDS`. At start-up it
enqueues one `retention_sweep` for the current UTC date.

### 3.2 Job kinds

| Kind | Enqueued by | Payload | Dedupe key | Max attempts | Same transaction as the change |
|---|---|---|---|---|---|
| `assess_case_attempt` | Live session, case close (`closeCase`) | `{ caseAttemptId }` | `assess:<caseAttemptId>:v1` | 6 | yes (with `case.closed`) |
| `build_session_debrief` | Live session, station end (`endStation`); runs 3 s later | `{ sessionId }` | `debrief:<sessionId>:v1` | 30 | yes (with `session.ended`) |
| `build_session_debrief` | Owner element decision (`resolveElement`) | `{ sessionId }` | `debrief:<sessionId>:owner:<assessmentId>` | 5 | yes (with the new assessment version) |
| `build_session_debrief` | Worker, after an assessment (`maybeEnqueueDebrief`) | `{ sessionId }` | `debrief:<sessionId>:after:<assessmentId>`, or `debrief:<sessionId>:after:<caseAttemptId>:unavailable` | 10 | no (after the assessment transaction) |
| `update_learning_plan` | Worker, debrief build | `{ userId }` | `plan:<userId>:<sessionId>` | 5 | yes (with the debrief insert) |
| `process_stripe_event` | Stripe webhook route (`recordStripeEvent`) | `{ eventId }` | `stripe:<eventId>` | 8 | yes (with the `stripe_events` insert) |
| `case_automated_checks` | `POST /api/owner/case-versions/:versionId/submit` | `{ versionId }` | `checks:<versionId>:<rowVersion>` (row version after the status change) | 5 | no (after the status update) |
| `case_llm_critique` | `POST /api/owner/case-versions/:versionId/critique` (two rows, direct insert) | `{ versionId, focus: "clinical" \| "rubric" }` | `critique:<focus>:<versionId>:<epoch ms>` | 5 | n/a (single insert) |
| `case_llm_critique` | Worker, automated checks passed and a critic model is configured | `{ versionId, focus }` | `critique:<focus>:<versionId>:<first 12 hex of clinical hash>` | 5 | yes (with the status update) |
| `case_llm_author` | `POST /api/owner/case-versions/:versionId/author` (direct insert) | `{ versionId, ownerNotes, teachingText }` | `author:<versionId>:<epoch ms>` | 5 | n/a (single insert) |
| `reassess_after_appeal` | `POST /api/owner/case-attempts/:id/reassess` (direct insert) | `{ caseAttemptId, reason }` | `reassess:owner:<caseAttemptId>:<epoch ms>` | 5 | n/a (single insert) |
| `reassess_after_appeal` | Owner appeal resolution, when `reassess` is true or there are corrections | `{ caseAttemptId, reason: "appeal <appealId>" }` | `reassess:<appealId>` | 5 | yes (with the corrections and appeal update) |
| `data_export` | `POST /api/account/export` | `{ requestId, userId }` | `export:<requestId>` | 5 | yes (with the `data_requests` insert) |
| `data_deletion` | `POST /api/account/delete` | `{ requestId, userId }` | `deletion:<userId>` | 5 | yes (with the `data_requests` insert) |
| `retention_sweep` | Worker start-up | `{}` | `retention:<YYYY-MM-DD>` (UTC) | 5 | n/a |

### 3.3 Handlers

**`assess_case_attempt` and `reassess_after_appeal`** (`apps/worker/src/jobs/assess.ts`). Both
call `assessCaseAttempt`; the reassessment forces the second assessment pass.

- Inputs are loaded from durable records only: the attempt, its session, the attempt's own case
  version and the session's profile version, the attempt's `stage.revealed` and
  `viewer.rendered`/`viewer.render_failed` events, the `final` transcript segments and the
  examiner utterances with their played portions.
- An owner-preview attempt with no candidate speech is skipped: result `{ skipped }`.
- In one transaction: every assessment pass is inserted (duplicates ignored), owner review items
  from the pipeline are inserted (duplicates ignored), and, when a result is available, a new
  `case_assessments` version is inserted, the attempt's earlier skill observations are marked
  superseded and new ones are inserted (not for owner previews).
- No result because a provider failed (timeout, provider error or invalid output): the job
  throws and is retried.
- No result for another reason: result `{ available: false, unavailable }`.
- Result available: `{ assessmentId, version, available: true }`.
- Afterwards a `build_session_debrief` job is enqueued when the session is `finalizing` or
  `complete`, or is in practice mode.

**`build_session_debrief`** (`apps/worker/src/jobs/debrief.ts`).

- Skipped unless the session is `finalizing` or `complete`.
- For each case attempt that started, it takes the latest assessment. A case with no assessment
  counts as settled only if its `assess:<id>:v1` job is `dead`, or `succeeded` with
  `available: false`. Otherwise the job throws and is retried later. (The `{ skipped }` result of
  an owner preview without speech has no `available: false`, so it does not count as settled.)
- Composes a debrief per case. An optional model-written summary is used only if it passes
  `validateFeedbackSummary`.
- In one transaction: inserts a new `session_debriefs` version; if the session is `finalizing`,
  sets it `complete`, sets `finalized_at` and appends `session.finalized`; enqueues
  `update_learning_plan`.
- Result: `{ cases, unavailable }`.

**`update_learning_plan`**. Computes a deterministic plan from the user's current skill
observations and the published, non-withdrawn cases. In one transaction it marks the current plan
superseded and inserts the new plan with its server-only map of assignment tokens to case ids.

**`process_stripe_event`**. See [section 4](#4-stripe-webhook-events).

**`case_automated_checks`** (`apps/worker/src/jobs/content.ts`).

- Runs the case validator. With errors the version returns to `draft`; otherwise it becomes
  `ready_for_owner`. An existing approval whose hashes no longer match is removed.
- Inserts a `case_reviews` row (reviewer `automated_checks`).
- When the checks pass: opens a `case_ready_for_approval` review item (dedupe
  `ready:<versionId>:<first 12 hex of clinical hash>`) and, if a critic model is configured,
  enqueues the two critiques. All in one transaction.

**`case_llm_critique`**.

- Skipped without a model. If external AI processing is not permitted for the case, it records
  an `unavailable` review and stops.
- Otherwise it stores the critique as a `case_reviews` row. Issues that are blockers or need an
  owner decision open an `uncertain_finding` review item (dedupe
  `critic:<focus>:<versionId>:<epoch ms>`).

**`case_llm_author`**.

- Only for drafts, with a model configured and external AI processing permitted.
- Merges the model's draft into the version payload and stores a `case_reviews` row listing
  unknowns and assumptions for the owner.
- It does not update the hash columns or `row_version`, and it does not submit the version for
  checks.

**`data_export`, `data_deletion`, `retention_sweep`** (`apps/worker/src/jobs/privacy.ts`). See
[DATA_MODEL.md](DATA_MODEL.md#privacy-jobs).

## 4. Stripe webhook events

### 4.1 Intake

`POST /api/stripe/webhook` (`apps/api/src/routes/billing.ts`):

1. Requires `STRIPE_WEBHOOK_SECRET`; otherwise `503 billing_not_configured`.
2. Verifies the `Stripe-Signature` header against the raw request body with Stripe's
   `constructEvent`. On failure: `400 invalid_signature`.
3. In one transaction (`recordStripeEvent`): inserts the event into `stripe_events` (primary key =
   Stripe event id, `ON CONFLICT DO NOTHING`). If the row is new, enqueues `process_stripe_event`
   with dedupe key `stripe:<eventId>` and 8 attempts.
4. Responds `{ received: true, duplicate }`. A redelivered event returns `duplicate: true` and
   enqueues nothing.

The full event is stored in `stripe_events.payload`.

### 4.2 Deduplication and ordering

- The `stripe_events` primary key stores each event id once.
- The job dedupe key `stripe:<eventId>` allows one processing job per event.
- `processStripeEvent` returns at once when the stored status is already `processed` or
  `ignored`.
- Ledger allotments use the idempotency key `allot:<periodKey>`, so a billing period is allotted
  once even if several events describe it.
- Subscription events carry Stripe's `created` time. If the stored subscription has a newer
  `last_event_created`, the event is ignored as stale (out of order). Equal times are applied.

### 4.3 Processing

`processStripeEvent` runs in one transaction in the worker:

| Event type | Effect |
|---|---|
| `checkout.session.completed` | Links the Stripe customer to the user named by `client_reference_id` (sets `users.stripe_customer_id` unless the customer is already linked). Grants nothing. Without a `client_reference_id` or a customer the event is ignored. |
| `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed` | Applies the subscription: resolves the user, applies the ordering guard, upserts `subscriptions`, updates `entitlements`, and allots the period's minutes when the new entitlement allows stations. |
| `customer.subscription.trial_will_end` | Noted only. |
| `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required` | Noted only. Status changes arrive through `customer.subscription.updated`. |
| `charge.dispute.created` | Sets the user's entitlement to `suspended` and opens an `urgent` owner review item (kind `technical_failure_adjustment`, dedupe `stripe-review:<eventId>`). |
| `charge.refunded` | Opens a `normal` owner review item (same kind and dedupe pattern). No entitlement change. |
| Any other type | Ignored. |

The outcome is a short string returned as the job result. The `stripe_events` row gets status
`ignored` when the outcome starts with `ignored`, otherwise `processed`, plus `processed_at` and
`attempts + 1`. If processing throws, the transaction rolls back, the row stays `pending` and the
job is retried. The status `failed` exists in the schema but is never set.

Applying a subscription:

- **User.** Found by `users.stripe_customer_id`. If none matches, the subscription's
  `metadata.user_id` is used and the customer id is saved on that user. If neither works, the
  event is ignored (`unknown customer`).
- **Plan.** The first item's price id is matched against `STRIPE_PRICE_MONTHLY` and
  `STRIPE_PRICE_ANNUAL`. An unknown price maps to `individual_monthly`.
- **Period.** Read from the subscription, or from its first item in newer API versions.
- **Entitlement status** from the Stripe subscription status:

| Stripe status | Entitlement |
|---|---|
| `active` | `active`, or `canceled_pending_period_end` when `cancel_at_period_end` is true |
| `trialing` | `trialing` |
| `past_due` | `past_due` |
| `paused` | `suspended` |
| `unpaid`, `canceled`, `incomplete_expired` | `canceled` |
| `incomplete` and anything else | `none` |

- **Allotment.** When the entitlement is `active`, `trialing` or `canceled_pending_period_end` and
  the period start is known, `allotPeriod` runs with period key
  `<subscriptionId>:<current period start>` and the plan's `includedMinutesPerPeriod`. Before
  allotting, any positive leftover balance (counting open reservations as available) is expired
  with an `expire` entry (`expire-before:<periodKey>`); minutes do not roll over. Allotment
  happens once per Stripe billing period. For the annual plan the amount comes from
  `PLAN_ANNUAL_MINUTES_PER_MONTH` (default 300) but is allotted once per annual period.
