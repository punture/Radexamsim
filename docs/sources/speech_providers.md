# Speech provider API verification: oral-exam simulator (Node 22 / TypeScript)

Access date for every source below: **2026-11-15**.

---

## 0. How this was verified (read this first)

- **I could not open any vendor page directly in this session.** WebFetch failed with DNS errors
  for `developers.deepgram.com` and `elevenlabs.io` because those hosts are outside the session's
  allowed network. Shell egress was blocked too, and reading the SDK sources on GitHub was not
  permitted. I did not try further hosts after the second DNS failure.
- **Everything below comes from search-result excerpts of the cited pages.** Most are official
  pages on developers.deepgram.com, deepgram.com, elevenlabs.io, developer.mozilla.org and
  developer.chrome.com. I checked each fact with several separate queries. Excerpts are snapshots
  and are sometimes summarized. **I rebuilt the JSON examples from documented field names and
  example values. They are not byte-for-byte copies of the docs.**
- Confidence tags used throughout:
  - **[V]**: stated in an excerpt of the cited official page.
  - **[V?]**: official, but excerpts conflict, were cut off, or the page may be stale.
  - **[S]**: secondary source only (third-party integrations, community issues, SDK forks).
  - **[U]**: unverified. This is my inference or prior knowledge, and you must test it against a
    live call before relying on it.
- **To get exact verification:** allow `developers.deepgram.com`, `elevenlabs.io` and
  `developer.mozilla.org` in the session's network settings, or allow GitHub read access to
  `deepgram/deepgram-js-sdk`, `elevenlabs/elevenlabs-js`, `elevenlabs/skills` and `mdn/content`.
  Then re-run this check. Deepgram docs are also served as `llms.txt` at
  https://developers.deepgram.com/llms.txt.

---

## 1. Deepgram streaming speech-to-text (Nova-3 / Nova-3 Medical, `/v1/listen`)

### 1.1 URLs consulted (2026-11-15, via search excerpts)
- https://developers.deepgram.com/reference/speech-to-text/listen-streaming (Live Audio API reference)
- https://developers.deepgram.com/docs/live-streaming-audio (Getting Started, includes the JS v5 example)
- https://developers.deepgram.com/docs/lower-level-websockets
- https://developers.deepgram.com/docs/keyterm
- https://developers.deepgram.com/docs/configure
- https://developers.deepgram.com/docs/endpointing
- https://developers.deepgram.com/docs/understand-endpointing-interim-results
- https://developers.deepgram.com/docs/understanding-end-of-speech-detection
- https://developers.deepgram.com/docs/interim-results
- https://developers.deepgram.com/docs/utterance-end
- https://developers.deepgram.com/docs/speech-started
- https://developers.deepgram.com/docs/audio-keep-alive
- https://developers.deepgram.com/docs/finalize
- https://developers.deepgram.com/docs/close-stream
- https://developers.deepgram.com/docs/stt-troubleshooting-websocket-data-and-net-errors
- https://developers.deepgram.com/docs/using-the-sec-websocket-protocol
- https://developers.deepgram.com/guides/fundamentals/token-based-authentication
- https://developers.deepgram.com/reference/auth/tokens/grant
- https://developers.deepgram.com/docs/models-languages-overview
- https://developers.deepgram.com/docs/model
- https://developers.deepgram.com/docs/multichannel
- https://developers.deepgram.com/docs/sdk-feature-matrix
- https://developers.deepgram.com/docs/profanity-filter
- https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
- https://developers.deepgram.com/trust-security/your-data
- https://developers.deepgram.com/changelog (entries 2025-12-10, 2026-06-30, 2026-07-02, 2026-08-28)
- https://deepgram.com/blog/introducing-nova-3-medical-multilingual
- https://deepgram.com/blog/introducing-nova-3-medical-speech-to-text-api
- https://deepgram.com/pricing
- https://www.npmjs.com/package/@deepgram/sdk
- https://github.com/deepgram/deepgram-js-sdk (README; releases v5.12.0 and v5.15.0)
- https://deepgram.com/learn/deepgram-javascript-sdk-v5-python-sdk-v6
- Flux STT: https://developers.deepgram.com/reference/speech-to-text/listen-flux, /docs/flux/nova-3-migration, /docs/flux/force-end-turn, /docs/flux/close-stream, /docs/flux/language-prompting, /docs/flux/flux-nova-3-comparison

### 1.2 Endpoint and authentication
- `wss://api.deepgram.com/v1/listen?<query>` **[V]**. Regional hosts `api.eu.deepgram.com`,
  `api.au.deepgram.com` and `api.in.deepgram.com` are named in a changelog entry about Configure
  support **[V]**.
- **API key (server side):** `Authorization: Token <DEEPGRAM_API_KEY>` **[V]**. The docs examples
  use this header. One excerpt only showed it on REST examples, but Deepgram describes the same
  token auth for the WebSocket.
- **Temporary token:** `POST https://api.deepgram.com/v1/auth/grant` with an API key of Member
  role or higher returns a JWT **[V]**. The default TTL is 30 s, and it can be set from 1 to
  3600 s **[V]**. Use it as `Authorization: Bearer <JWT>` **[V]**. It only has to be valid during
  the handshake **[V]**.
- **Browser (cannot set headers):** `Sec-WebSocket-Protocol: token, <API_KEY>`, i.e.
  `new WebSocket(url, ["token", key])` **[V]**. Whether a JWT works in the subprotocol slot is not
  confirmed **[U]**. Our design keeps keys on the server, so use header auth from Node.
- **Node 22 note [U]:** the built-in WHATWG `WebSocket` cannot set arbitrary headers in the standard
  API. Use the `ws` package (`new WebSocket(url, { headers })`), or the subprotocol form.

### 1.3 Models (medical)
- **`model=nova-3-medical` works for streaming on `/v1/listen`** **[V]**. It is the documented
  medical model. Deepgram's model page describes it as "optimized for audio with medical oriented
  vocabulary, available in English and multilingual" **[V]**.
- English: `language=en` or a regional code: `en-US`, `en-AU`, `en-CA`, `en-GB`, `en-IE`, `en-IN`,
  `en-NZ` **[V]**.
- Multilingual: `language=multi` covers 10 languages (nl, en, fr, de, hi, it, ja, pt, ru, es) with
  code-switching, in both batch and streaming **[V]**.
- Vendor-reported streaming benchmarks: English 3.36% WER / 5.68% EER; multilingual average 5.86%
  WER **[V, vendor claim]**.
- There is no medical variant of Flux, Deepgram's turn-based STT on `/v2/listen` **[V, no such
  model found]**. See 1.10.
- The default model, if `model` is omitted, is `base` **[V]**, so always set `model`.

### 1.4 Query parameters

| Param | Values / notes | Tag |
|---|---|---|
| `model` | `nova-3-medical` (recommended), `nova-3`, ... | V |
| `language` | `en`, `en-US`, ..., or `multi` | V |
| `encoding` | `linear16` for raw PCM. **Raw audio requires both `encoding` and `sample_rate`**. Leave both out for containerized audio (WAV, Ogg) | V |
| `sample_rate` | int32, e.g. `16000`. Required with raw `encoding` | V |
| `channels` | int, default 1 | U (standard param, not seen in an excerpt) |
| `interim_results` | `true` / `false` | V |
| `endpointing` | int ms of silence before `speech_final=true`; **default 10**; `false` disables | V |
| `utterance_end_ms` | int ms. **Requires `interim_results=true`**. Docs recommend ≥1000, since interim results arrive about every second. Treat this as guidance, not an enforced minimum | V |
| `vad_events` | `true` → `SpeechStarted` messages. Marked **Beta** in the SDK feature matrix | V |
| `smart_format` | bool, GA for streaming | V |
| `punctuate` | bool, GA | V |
| `numerals` | bool, GA | V |
| `profanity_filter` | bool, GA. Replaces profanity with the nearest non-profane word or removes it | V |
| `diarize` | bool. Listed GA in the SDK matrix, **but** the streaming reference marks `diarize` **deprecated in favour of `diarize_model`** (streaming values `latest` (currently v1) or `v1`; `v2` → validation error) | V? |
| `keyterm` | Repeatable. See 1.5 | V |
| `keywords` | Legacy. **Not supported on Nova-3** | V |
| `mip_opt_out` | `true` gives zero data retention (see 1.8) | V |
| `language_hint` | Repeatable, with `language=multi` | V |
| `tag` | String, for usage tagging | U |

Example URL (Nova-3 Medical, 16 kHz mono PCM):
```
wss://api.deepgram.com/v1/listen?model=nova-3-medical&language=en-US&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&endpointing=300&utterance_end_ms=1000&vad_events=true&smart_format=true&punctuate=true&mip_opt_out=true&keyterm=atrial%20fibrillation&keyterm=metoprolol
```

### 1.5 Keyterm prompting
- **Syntax:** repeat the parameter, e.g. `keyterm=term1&keyterm=term2`. Encode spaces in multi-word
  phrases as `%20` or `+` **[V]**. `URLSearchParams.append("keyterm", "atrial fibrillation")` gives
  `+`, which is accepted.
- **Pitfall:** comma-, semicolon- or newline-separated values are **not split**. The API treats the
  whole value as one literal keyterm and returns no error, so the list silently boosts nothing
  **[V]**.
- There are no weights. The legacy `:INTENSIFIER` syntax is not accepted **[V]**.
- **Limit: 500 tokens per request.** Over the limit, you get a "Keyterm limit exceeded" error
  **[V]**. Marketing copy says "up to 100 terms" **[V, marketing]**.
- **Models:** Nova-3 (monolingual, multilingual and **Nova-3 Medical**) and Flux **[V]**.
- **Cost:** keyterm prompting is a paid add-on. The pricing page excerpt shows $0.0013/min
  pay-as-you-go and $0.0012/min on Growth, but the snapshot's age is unclear **[V?]**.
- **Mid-stream replacement:** send a `Configure` message (1.7) with a `keyterms` array. It
  **replaces the whole list**, and an empty array clears it **[V]**. The 500-token limit applies to
  each Configure message **[V]**. Mid-stream keyterm updates work on Nova-3 models only, including
  Nova-3 Medical **[V]**.

### 1.6 Server → client messages

**Results** (rebuilt from the Getting Started example; values are illustrative unless noted):
```json
{
  "type": "Results",
  "channel_index": [0, 1],
  "duration": 1.98,
  "start": 5.99,
  "is_final": true,
  "speech_final": true,
  "channel": {
    "alternatives": [
      {
        "transcript": "Tell me more about this.",
        "confidence": 0.99,
        "words": [
          { "word": "tell", "start": 6.07, "end": 6.35, "confidence": 0.99, "punctuated_word": "Tell" }
        ]
      }
    ]
  },
  "metadata": {
    "request_id": "<uuid>",
    "model_info": { "name": "2-general-nova", "version": "<string>", "arch": "nova-2" },
    "model_uuid": "<uuid>"
  },
  "from_finalize": false
}
```
- These fields appear in the official examples **[V]**: `type`, `channel_index`, `duration`,
  `start`, `is_final`, `speech_final`, `channel.alternatives[].transcript/confidence/words[]`, and
  word fields `word`, `start`, `end`, `confidence`, `punctuated_word`. The example showed
  `word: "tell"` and `punctuated_word: "Tell"`. Also `metadata.request_id`, `model_info`,
  `model_uuid` and `from_finalize` (false by default). A Nova-3 example shows
  `model_info.name: "general-nova-3"`.
- Word `start`/`end` are **seconds from the start of the stream** **[V]**.
- `channel_index` is `[channel, total_channels]` **[V]**.
- **The interim-result examples in the docs leave out `type` and `metadata`** **[V]**. Do not
  require `type === "Results"` on interim results. Fall back to "has `channel.alternatives`".
- `from_finalize: true` marks the result that completes a `Finalize`. It is usually sent, but
  **not guaranteed** if little audio was buffered **[V]**.
- **Utterance assembly (Deepgram guidance):** concatenate `is_final: true` segments until
  `speech_final: true` **[V]**. Do not use `speech_final` alone, because a final can arrive without
  one **[V]**. Background noise can stop `speech_final` from ever firing, so use `UtteranceEnd` as
  the backstop **[V]**.

**UtteranceEnd** (sent when `utterance_end_ms` is set; values illustrative):
```json
{ "type": "UtteranceEnd", "channel": [0, 1], "last_word_end": 2.395 }
```
**[V]** for the field names. `last_word_end` is the end time of the last word before the gap.
The docs advise ignoring duplicate or stale UtteranceEnd events **[V]**.

**SpeechStarted** (sent when `vad_events=true`; these are the doc example values):
```json
{ "type": "SpeechStarted", "channel": [0, 1], "timestamp": 9.54 }
```
**[V]**. `timestamp` is when speech was first detected. It may not line up with word timings,
because a separate system detects speech **[V]**.

**Metadata.** CloseStream makes the server send a summary Metadata object before it closes
**[V]**. The fields differ between pages **[V?]**:
```json
{ "type": "Metadata", "transaction_key": "deprecated", "request_id": "<uuid>", "sha256": "<hex>",
  "created": "<iso8601>", "duration": 12.3, "channels": 1 }
```
That example is from the Close Stream page, which is about two years old. The current reference
object `ListenV1Metadata` also shows `request_id`, `model_info` and `model_uuid`. The lower-level
WebSocket page lists `models`. Parse leniently.

**ConfigureSuccess / ConfigureFailure.** Exactly one is sent per Configure, and each includes the
stream's `request_id` **[V]**. ConfigureSuccess lists the keyterms now in effect and leaves out
fields that did not change **[V]**. ConfigureFailure means **nothing** in the message was applied
**[V]**. Failure codes: `CONFIGURE_KEYTERMS_NOT_SUPPORTED`, `CONFIGURE_KEYTERM_LIMIT_EXCEEDED`,
`CONFIGURE_ALREADY_PENDING`, `CONFIGURE_INTERNAL_ERROR` **[V]**. The exact JSON key that holds the
code was not seen **[U]**.

**Errors and close codes [V]:**
- 1008: undecodable audio (DATA-0000).
- 1011: timeouts. NET-0001 means no frames from the client within about 10 s. NET-0002 means no
  audio within the no-audio window. NET-0000 is an internal error.

### 1.7 Client → server messages
- **Audio:** binary frames of raw `linear16` PCM, matching `encoding`, `sample_rate` and
  `channels` **[V]**.
- **Control messages:** send as **text** frames of UTF-8 JSON **[V]**:
```json
{ "type": "KeepAlive" }
{ "type": "Finalize" }
{ "type": "CloseStream" }
{ "type": "Configure", "keyterms": ["atrial fibrillation", "metoprolol"] }
```
- **KeepAlive:** send every 3–5 s while no audio is flowing. The server does not reply. Without
  audio or a KeepAlive for 10 s, the server closes with NET-0001 **[V]**. The troubleshooting page
  adds that KeepAlive alone does not stop a NET-0001 close: send at least one audio message, or
  silent audio **[V?, the two pages conflict]**.
- **Finalize:** makes the server process buffered audio immediately and return final results
  marked `from_finalize: true` **[V]**. Use it when the examiner UI ends a turn, e.g. a push-to-talk
  release.
- **CloseStream:** the server processes the remaining audio, sends the last results and summary
  Metadata, then closes **[V]**. The close code was not documented **[U]**.
- **Configure:** send one at a time. Wait for ConfigureSuccess or ConfigureFailure before sending
  the next. A second Configure sent while one is pending gets `CONFIGURE_ALREADY_PENDING` **[V]**.
  - **The docs conflict on over-limit updates [V?]:** the Configure page says ConfigureFailure with
    `CONFIGURE_KEYTERM_LIMIT_EXCEEDED`. A newer changelog correction says transcription stops and
    the server closes with 1011 (NET-0000) after about 30 s. **Enforce the 500-token cap
    client-side.**

### 1.8 Data retention and privacy
- **By default, requests are in the Model Improvement Program, and Deepgram keeps the audio and
  transcripts to improve its models** **[V]** (https://developers.deepgram.com/trust-security/your-data).
- `mip_opt_out=true` limits retention to the time needed to process the request ("zero data
  retention"). Usage metadata and logs are still recorded, without audio, text or transcripts
  **[V]**.
  - It is a query parameter on STT and TTS **[V]**.
  - You can ask Deepgram to enforce opt-out for the whole account **[V]**.
  - To check it, look under Console → Usage → Logs, where opted-out requests show
    `mip_opt_out` = true **[V]**.
- **Pricing impact of opting out:** the official reference only says "refer to our Docs for
  pricing impacts" **[V]**. Third parties say the list prices assume you are opted in, so opting
  out costs more. One claims about 50% more **[S]**. **Confirm with Deepgram.**
- BAAs are signed for **Enterprise** customers handling ePHI **[V]**. SOC 2 Type 1 & 2 **[V]**.
  Self-hosted and VPC deployment is offered **[V, marketing]**.
- A Deepgram blog post claims zero retention is the default. That contradicts the official data
  page, so trust the data page **[V conflict]**.

### 1.9 Pricing (https://deepgram.com/pricing; read the stale-snapshot caveats)
- Nova-3 monolingual streaming costs **$0.46/h pay-as-you-go (≈$0.0077/min)** and $0.39/h on
  Growth. Multilingual is $0.55/h **[V?]**. The same page also shows a $0.0048/min figure, which
  third parties describe as a limited-time promo **[V? conflict]**.
- **Nova-3 Medical streaming price is not confirmed.** A third-party audit dated 2026-11-02 says the
  current pricing page does not list Nova-3 Medical. The 2025 launch post quoted streaming from
  $0.0077/min and pre-recorded from $0.0043/min **[S / V? dated]**.
- Add-ons, pay-as-you-go: keyterm $0.0013/min, diarization $0.0020/min, redaction $0.0020/min
  **[V?]**.
- Concurrency: 150 streams on pay-as-you-go, 225 on Growth **[V?]**.

### 1.10 Official JS SDK (`@deepgram/sdk`)
- **The current major version is v5. It is stable and supports live streaming in Node** **[V]**.
  - Latest on npm in one excerpt: 5.12.0. GitHub releases mention v5.15.0, which added
    `sendConfigure` **[V?, version numbers move fast]**.
  - v5 has breaking changes: `createClient(key)` became `new DeepgramClient({ apiKey })` **[V]**.
- Minimal usage, assembled from the Getting Started page and README excerpts **[V for the method
  names; U for the exact option value types]**:
```ts
import { DeepgramClient } from "@deepgram/sdk";

const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY! });
const socket = await client.listen.v1.connect({        // README: returns a socket that starts closed
  model: "nova-3-medical", language: "en-US",
  encoding: "linear16", sample_rate: 16000,
  interim_results: true, utterance_end_ms: 1000, vad_events: true,
  smart_format: true, mip_opt_out: true,
});
socket.on("open", () => {/* ... */});
socket.on("message", (msg: any) => {
  if (msg.type === "Results") {/* ... */} else if (msg.type === "UtteranceEnd") {/* ... */}
});
socket.on("error", (e) => {/* ... */});
socket.on("close", () => {/* ... */});
socket.connect();
await socket.waitForOpen();
socket.sendMedia(pcmChunk);   // also: sendKeepAlive(), sendFinalize(), sendCloseStream(), sendConfigure(...)
```
- The README also documents an async-iterator alternative to `on("message")` and an
  `abortSignal` option on `connect()`. v5.12.0 added `off()` and a per-close `shouldReconnect`.
  The README says closes other than an expected one "keep the default retry behavior", which
  implies **sockets retry by default** on unexpected closes **[V?]**. Turn this off or own it in
  your adapter, so a dropped exam turn is not silently replayed.
- **A raw WebSocket is fully supported and documented** **[V]** ("Using Lower-Level Websockets").
  For an adapter that controls reconnects, KeepAlive and Finalize itself, I recommend raw `ws`:
```ts
import WebSocket from "ws";
const q = new URLSearchParams({ model: "nova-3-medical", language: "en-US", encoding: "linear16",
  sample_rate: "16000", interim_results: "true", endpointing: "300", utterance_end_ms: "1000",
  vad_events: "true", smart_format: "true", mip_opt_out: "true" });
for (const t of keyterms) q.append("keyterm", t);
const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${q}`, {
  headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } });
ws.on("message", (data, isBinary) => { if (!isBinary) handle(JSON.parse(data.toString())); });
// audio: ws.send(pcmBuffer); control: ws.send(JSON.stringify({ type: "KeepAlive" }))
```

### 1.11 Flux (`/v2/listen`): alternative for turn-taking, not medical
- Endpoint: `wss://api.deepgram.com/v2/listen?model=flux-general-en` **[V]**. Use
  `flux-general-multi` for multilingual audio; its TurnInfo adds `languages_hinted` and
  `languages` **[V]**.
- **Messages:** `TurnInfo` with `event` ∈ `Update`, `StartOfTurn`, `EagerEndOfTurn`,
  `TurnResumed`, `EndOfTurn` **[V]**. By default only `Update`, `StartOfTurn` and `EndOfTurn` are
  sent. The eager events need `eager_eot_threshold` **[V]**.
- **TurnInfo fields [V]:** `request_id`, `sequence_id`, `turn_index`, `audio_window_start`,
  `audio_window_end`, `transcript`, `words[]` and `end_of_turn_confidence`. Each word has `word`
  and `confidence`, plus `start`/`end` (doubles), added in the 2026-06-30 / 2026-07-02 changelogs.
  `trigger` is `model`, `manual` or `timeout`, and new values may be added.
- **Parameters [V]:**
  - `eot_threshold`: 0.5–1.0, default 0.7.
  - `eager_eot_threshold`: 0.3–0.9.
  - `eot_timeout_ms`: default 5000.
- **Control:** `ForceEndTurn` (Flux only), `CloseStream` and `Configure` (keyterms) **[V]**.
  `keyterm` is supported.
- Raw encodings: `linear16`, `linear32`, `mulaw`, `alaw`, `opus`, `ogg-opus`. Sample rates: 8000,
  16000, 24000, 44100, 48000 **[V]**.
- **No medical variant**, so Nova-3 Medical remains the right choice for clinical vocabulary.

### 1.12 Unverified / could not confirm (Deepgram STT)
- Current complete field list of the streaming `Metadata` message.
- `channels` default, and the full `encoding` enum for `/v1/listen` with Nova-3 Medical.
- Whether Configure on `/v1/listen` can change formatting features (smart_format, numerals); only
  keyterms are confirmed.
- How the server handles an over-limit Configure (the docs conflict).
- `diarize` vs `diarize_model` status on streaming. It is not needed here.
- Option value types (bool vs string) in SDK v5, and its default reconnect policy in detail.
- Nova-3 Medical streaming list price, and the price change from `mip_opt_out=true`.
- Whether `smart_format` normalizes medical dosage expressions ("5 mg") for Nova-3 Medical in
  streaming.

---

## 2. Deepgram text-to-speech

### 2.1 URLs consulted (2026-11-15)
- https://developers.deepgram.com/reference/text-to-speech-api (Single Text Request, REST)
- https://developers.deepgram.com/reference/text-to-speech/speak-request
- https://developers.deepgram.com/reference/text-to-speech/speak-streaming (Continuous Text Stream, WS)
- https://developers.deepgram.com/docs/streaming-text-to-speech
- https://developers.deepgram.com/docs/tts-websocket-streaming
- https://developers.deepgram.com/docs/tts-media-output-settings, /docs/tts-encoding, /docs/tts-container, /docs/tts-sample-rate, /docs/tts-bit-rate
- https://developers.deepgram.com/docs/tts-ws-clear, /docs/tts-ws-close, /docs/tts-ws-flush
- https://developers.deepgram.com/docs/tts-voice-controls
- https://developers.deepgram.com/docs/tts-models, /docs/tts-models-languages-overview
- Flux TTS: https://developers.deepgram.com/docs/flux-tts/overview, /docs/flux-tts/quickstart, /docs/flux-tts/feature-overview, /docs/flux-tts/server-messages, /docs/flux-tts/interrupt-handling, /docs/flux-tts/voice-agent, /docs/flux-tts/migrating, /docs/flux-tts/batch-vs-streaming, /docs/deploy-flux-tts
- https://developers.deepgram.com/changelog/2026/8/12 (Flux TTS GA), /changelog/2026/10/23
- https://deepgram.com/product/text-to-speech, https://deepgram.com/pricing
- https://github.com/orgs/deepgram/discussions/894 and https://github.com/deepgram/deepgram-js-sdk/issues/394 (TTS word alignment)

### 2.2 Aura-2 on `/v1/speak`: REST
- `POST https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&container=none&sample_rate=24000`
  **[V]**.
  - Headers: `Authorization: Token <key>`, `Content-Type: application/json` **[V]**.
  - Body: `{"text": "..."}`. Only `text` goes in the body; everything else is a query parameter
    **[V]**.
  - The response body is the audio bytes **[V]**.
- **Defaults [V]:**
  - `model`: `aura-asteria-en` (the reference's default; always set `model`).
  - `encoding`: `mp3`.
  - `container`: `wav`. Use `container=none` for raw PCM.
  - `sample_rate`: 24000.
  - `bit_rate`: 48000 (compressed formats only).
- `speed`: 0.7–1.5 for Aura-2 **[V]**.
- **Model strings:** `aura-2-{voice}-{lang}`, e.g. `aura-2-thalia-en`, `aura-2-asteria-en`,
  `aura-2-aquila-es` **[V]**.
- **Aura-2 languages:** en, es, de, fr, nl, it, ja **[V]**.

### 2.3 Aura-2 on `/v1/speak`: WebSocket
- `wss://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=24000`
  **[V]**.
- **Raw encodings only [V]:**
  - `linear16` (default) at 8000, 16000, 24000 (default), 32000 or 48000.
  - `mulaw` / `alaw` at 8000 (default) or 16000.
  - No mp3 or opus over WS.
- **Client → server [V]:**
```json
{ "type": "Speak", "text": "Good morning. Please present your case." }
{ "type": "Flush" }
{ "type": "Clear" }
{ "type": "Close" }
```
  - `Flush`: generate and return audio for the buffered text. **Limited to 20 per 60 s.**
  - `Clear`: drop the buffer and start a new generation. It can discard queued text. Use it for
    barge-in.
  - `Close`: the docs conflict. The reference says it flushes, then closes gracefully. The Clear
    and Close pages say it closes immediately **[V? conflict]**.
- **Server → client:** binary audio frames, plus text frames **[V]**:
```json
{ "type": "Flushed", "sequence_id": 0 }
{ "type": "Cleared", "sequence_id": 0 }
{ "type": "Warning", "description": "<text>", "code": "TEXT_LENGTH_WARNING" }
{ "type": "Metadata", "request_id": "<uuid>", "model_name": "<string>", "model_version": "<string>", "model_uuid": "<uuid>" }
```
  The `Metadata` fields are **[U]**. The reference lists a `SpeakV1Metadata` message, but no
  excerpt showed its fields.
- Maximum session is 1 hour **[V]**.
- **Timestamps: Aura `/v1/speak` returns no word or character alignment [S].** A Deepgram staffer
  said so in a 2024 GitHub discussion. A mid-2025 SDK feature request is still open, and I found
  nothing official since. The workarounds are flushing per sentence and estimating, or running
  the output back through STT at extra cost. **To track the played portion with Aura-2, you would
  need sentence-level chunking plus estimation.**
- Pricing: $0.030/1k chars pay-as-you-go, $0.027/1k on Growth **[V?]**.

### 2.4 Flux TTS on `/v2/speak` (GA 2026-08-12): has server-side "what was heard" accounting
- Endpoint: `wss://api.deepgram.com/v2/speak?model=<flux voice>` **[V]**.
  - A model is required on every connection. Auth is the same `Authorization: Token ...` header
    **[V]**.
  - Aura voices work only on v1 and Flux voices only on v2 **[V]**.
  - There is also a batch REST variant: `POST /v2/speak` with the same parameters. Its metadata
    comes back in headers such as `dg-char-count` **[V]**.
- **Model strings:** `flux-{voice}-{language}` **[V]**.
  - The quickstart and self-hosted excerpts use `flux-haley-en` **[V?]**.
  - Other excerpts confirm `flux-alexis-en`, and `flux-kit-en` as the Voice Agent default **[V]**.
  - The product page lists the English voices Alexis, Drew, Haley and Jack. A changelog mentions
    36 English voices across several accents **[V?]**. Check the voice list before hard-coding one.
- **Query parameters [V]:**
  - `encoding`: `linear16` (default), `mulaw` or `alaw`.
  - `sample_rate`: for `linear16`, 8000, 16000, 24000, 32000, 44100 or 48000; for mulaw/alaw,
    8000 or 16000. The default is the model's native rate.
  - `speed`: one excerpt says 0.5–1.5 in 0.05 steps. The Configure description says seven
    multipliers from 0.85 to 1.15 **[V? conflict]**.
  - `expressivity`: beta, −2 to 2.
  - `mip_opt_out` and `tag`.
- **Client → server [V for the message names; JSON rebuilt]:** the migration guide says Speak is
  "unchanged" from v1.
```json
{ "type": "Speak", "text": "First, what is your differential diagnosis? " }
{ "type": "Flush" }
{ "type": "Interrupt", "playback_offset": { "type": "time_ms", "value": 2340 } }
{ "type": "Configure", "speed": 1.05 }
{ "type": "Close" }
```
  - `Flush` **ends the turn**: the server generates the rest and emits `SpeechMetadata`. There is
    no separate Finalize **[V]**.
  - `Interrupt` cancels the active turn **[V]**.
  - `Configure` changes speed at the next segment boundary and is answered with ConfigureSuccess
    or ConfigureFailure **[V]**. The `speed` field name inside Configure is **[U]**.
  - `Close` makes the server send a final `SessionMetadata` **[V]**.
  - Do not set `speech_id`; the server assigns it **[V]**.
  - The server does **not** add whitespace between Speak messages, so add it yourself **[V]**.
- **Server → client:** binary audio frames, plus JSON **[V for the names and fields listed]**:
```json
{ "type": "Connected", "request_id": "<uuid>", "model_name": "<string>", "model_version": "<string>", "model_uuids": ["<uuid>"] }
{ "type": "SpeechStarted", "speech_id": "dg_sp_0123456789ab" }
{ "type": "Flushed", "speech_id": "dg_sp_0123456789ab" }
{ "type": "SpeechMetadata", "speech_id": "dg_sp_0123456789ab", "audio_duration_ms": 4210,
  "input_character_count": 87, "billable_character_count": 87,
  "controls_applied": { "pronunciations_applied": 0, "breaks_applied": 0, "pronunciation_warnings": [] } }
{ "type": "SpeechInterrupted", "speech_id": "dg_sp_0123456789ab", "audio_played_ms": 2340,
  "text_spoken": "First, what is your", "text_remaining": " differential diagnosis? ",
  "metadata": { "audio_duration_ms": 2340, "input_character_count": 45, "billable_character_count": 45 } }
{ "type": "SessionMetadata", "total_audio_duration_ms": 9120, "total_input_character_count": 310 }
{ "type": "Warning", "code": "INVALID_INTERRUPT_OFFSET", "description": "<text>" }
```
  - `Connected` replaces v1's Metadata-on-open **[V]**.
  - `SpeechStarted` comes once per turn **[V]**.
  - `Flushed` is sent when the buffer has actually been flushed after a manual Flush, and the
    turn's SpeechMetadata follows **[V]**.
  - `SpeechMetadata` comes once per completed turn **[V]**. `breaks_applied` is always 0 on the
    WebSocket. The type of `pronunciation_warnings` is **[U]**.
  - `SpeechInterrupted` carries a `metadata` object with the same per-turn fields; the nested
    values above are illustrative **[V]**.
  - `SessionMetadata` holds cumulative totals **[V]**. Other fields are **[U]**.
  - `Warning` codes for interrupts: `NO_AUDIO_GENERATED`, `INTERRUPT_IN_PROGRESS`,
    `INVALID_INTERRUPT_OFFSET` **[V]**. The `description` key is **[U]**.
  - `Error` and ConfigureSuccess/ConfigureFailure also exist **[V]**.
- **Interrupt semantics. This is the feature that matters for us [V]:**
  - `playback_offset.value` is the number of **milliseconds of this session's audio that the
    listener actually played**. It is measured from the start of the **session**, not the turn.
    Keep one session-wide counter.
  - Each offset must be larger than the last one. Otherwise you get `INVALID_INTERRUPT_OFFSET`
    and the Interrupt is ignored.
  - `SpeechInterrupted.text_spoken` is the portion of the turn's text the user heard, aligned
    against `audio_played_ms`. Feed it into the dialogue history. `text_remaining` is the unheard
    rest.
  - **Both are present only if the Interrupt carried `playback_offset`.** Without it,
    `audio_played_ms` falls back to the server's count of audio generated.
  - On an interrupt, **only** SpeechInterrupted is sent, with no separate SpeechMetadata.
  - Interrupt before any audio exists → `NO_AUDIO_GENERATED`. Interrupt while one is in progress
    → `INTERRUPT_IN_PROGRESS`.
  - **Recommended order:** stop local playback first, then send Interrupt. Drop any audio frames
    that arrive before `SpeechInterrupted`.
  - An Interrupt rebases `total_audio_duration_ms` onto the audio that was actually played, so
    session totals can go down.
- **Limits [V]:**
  - 1-hour maximum session.
  - **60-second inactivity timeout** (new in v2). Send WebSocket ping/pong to keep idle sessions
    open.
  - Prosody carries across turns, so you do not need to reconnect to reset.
- **No per-word timestamps** were found for `/v2/speak` **[V?, absence]**.
- **Languages:** the excerpts conflict. One page says English only, with Aura-2 recommended for
  other languages. Others list English plus 10 languages, or 41 other languages for Voice Agent
  **[V? conflict]**.
- Pricing: **$0.045/1k chars pay-as-you-go**, with volume discounts **[V]**.

### 2.5 Unverified / could not confirm (Deepgram TTS)
- Exact JSON of Flux `Interrupt`. It was rebuilt from documented fields: `playback_offset` object,
  `type` `time_ms`, integer `value`; the docs example value is 2340.
- The field name for speed inside Flux `Configure`, and the speed ranges (the docs conflict).
- The Flux voice catalog, and whether `flux-haley-en` is current.
- Field lists of v1 `Metadata`, Flux `SessionMetadata` and Flux `Warning`/`Error`.
- Whether v1 `Close` flushes first (the docs conflict).
- Character limit per `Speak` message (only a `TEXT_LENGTH_WARNING` code was seen).

---

## 3. ElevenLabs text-to-speech

### 3.1 URLs consulted (2026-11-15)
- https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input (WebSocket reference)
- https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts (also served at https://elevenlabs.io/docs/websockets)
- https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-multi-stream-input
- https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/multi-context-web-socket
- https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets
- https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd, https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps, https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert (output_format enum)
- https://elevenlabs.io/docs/overview/models, https://elevenlabs.io/docs/eleven-api/choosing-the-right-model, https://elevenlabs.io/v4
- https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode, https://elevenlabs.io/docs/overview/administration/data-residency
- https://elevenlabs.io/pricing/api
- https://github.com/elevenlabs/skills/blob/main/text-to-speech/references/streaming.md (official ElevenLabs repo)
- Secondary: https://docs.fish.audio/developer-guide/compat/migrate-from-elevenlabs, https://github.com/pipecat-ai/pipecat/issues/4316, https://reference-server.pipecat.ai/en/stable/_modules/pipecat/services/elevenlabs/tts.html, https://huggingface.co/spaces/nvidia/voice-agent-examples (pipecat ElevenLabs service), https://pkg.go.dev/github.com/clearlyip/elevenlabs-go, https://github.com/livekit/agents/issues/7773

### 3.2 `stream-input` WebSocket (single context)
- URL template:
  `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=...` **[V]**.
- **Query parameters [V]:**
  - `model_id`: defaults to `eleven_multilingual_v2`. **This endpoint does not support
    `eleven_v3` or `eleven_v4`**; those models use the Text to Dialogue WebSocket (3.4).
  - `output_format`: pattern `codec_sample_rate_bitrate`, e.g. `mp3_22050_32`. The enum includes
    `pcm_8000`, `pcm_16000`, `pcm_22050`, `pcm_24000`, `pcm_32000`, `pcm_44100`, `pcm_48000`,
    `ulaw_8000`, `alaw_8000`, `opus_48000_{32|64|96|128|192}`, mp3 variants and `wav_*`
    (enum from the REST convert page).
    - The default is `mp3_44100_128`.
    - `pcm_44100` needs the Pro tier, and 192 kbps mp3 needs Creator or higher.
  - `sync_alignment`: default **false**. "Sync the text alignment to every returned response."
  - `auto_mode`: default false. Turns off the chunk schedule and buffers for lower latency. **Only
    use it with full sentences**; partial sentences give much lower quality.
  - `inactivity_timeout`: seconds, **default 20, max 180**.
  - `enable_logging`: default true. **`false` gives Zero Retention Mode, which is enterprise
    only**, and turns off history features including request stitching.
  - Also: `language_code`, `apply_text_normalization`, `seed`, `enable_ssml_parsing` (required for
    phoneme pronunciation dictionaries over WS), `authorization`, and `single_use_token` for client
    sessions.
- **Auth:**
  - `xi-api-key: <key>` header on the handshake, or `"xi_api_key"` in the first message **[V]**.
    The docs show both and do not say which takes precedence.
  - For browsers, use a single-use token **[V]**. Our server holds the key, so use the header with
    `ws`.
- **Initialize, the first message [V]:**
```json
{ "text": " ",
  "voice_settings": { "stability": 0.5, "similarity_boost": 0.8 },
  "generation_config": { "chunk_length_schedule": [120, 160, 250, 290] },
  "xi_api_key": "<key, only if not using the header>" }
```
  - `chunk_length_schedule` sets the character counts that trigger generation **[V]**.
  - Pronunciation dictionaries must be set in the Initialize message **[V]**. The field name
    (`pronunciation_dictionary_locators`) is **[U]**.
- **Send text and flush [V]:**
```json
{ "text": "Good morning. " }
{ "text": "What is your differential diagnosis? ", "flush": true }
```
  - The docs recommend `flush: true` at the end of each conversational turn **[V]**.
  - `try_trigger_generation` is legacy, and its semantics are unconfirmed **[U]**.
- **Close [V]:** an empty string ends input; the server finishes, then closes:
```json
{ "text": "" }
```
- **Server → client [V? casing conflict, see below]:**
```json
{ "audio": "<base64 in output_format>",
  "isFinal": null,
  "normalizedAlignment": { "charStartTimesMs": [0, 3, 7], "charDurationsMs": [3, 4, 2], "chars": ["H", "e", "l"] },
  "alignment":           { "charStartTimesMs": [0, 3, 7], "charDurationsMs": [3, 4, 2], "chars": ["H", "e", "l"] } }
{ "isFinal": true }
```
  The final message has `audio` null **[S]**.
  - **Top-level keys `audio`, `isFinal`, `normalizedAlignment` and `alignment` are camelCase.**
    Production integrations rely on this: pipecat, a Go SDK, promptfoo, and Fish Audio's
    ElevenLabs-compatible API **[S]**. ElevenLabs' own realtime guide checks `isFinal` **[V]**.
  - **Inner keys are inconsistent across sources:**
    - pipecat and the NVIDIA voice-agent code read `chars`, `charStartTimesMs` and
      `charDurationsMs` **[S]**.
    - Older ElevenLabs docs (from memory) and one guide spell it `charsDurationsMs` **[U/S]**.
    - The current API reference example payload reportedly shows snake_case: `is_final`,
      `char_start_times_ms`, `char_durations_ms` **[V?]**.
    - **Write a tolerant parser:** `starts = a.charStartTimesMs ?? a.char_start_times_ms`;
      `durs = a.charDurationsMs ?? a.charsDurationsMs ?? a.char_durations_ms ?? a.chars_durations_ms`;
      `final = m.isFinal ?? m.is_final`. If durations are missing, derive them from consecutive
      start times.
  - `alignment` maps to the **original input text**. `normalizedAlignment` maps to the
    **normalized** text (numbers spelled out, and SSML rendered, e.g. breaks become periods)
    **[V for REST; V for the SSML note]**. Use `alignment` to map the played portion back to the
    examiner's text.
  - **Time base is unclear:** times may be relative to each chunk, not the session. Older docs said
    chunk-relative; Fish's compat API uses the session timeline; LiveKit reports chunk-relative
    times on the dialogue socket **[S/U]**.
    - Track cumulative audio duration from decoded chunk sizes. With `pcm_16000` that is
      `bytes / 2 / 16000 * 1000` ms.
    - If a message's first start time is lower than the previous message's last start time, treat
      its times as chunk-relative.
  - **Known quirks [S]:**
    - ElevenLabs can send **two alignment messages per sentence**: a partial one, then a second
      that restarts at char 0. Pipecat issue #4316 recommends preferring `normalizedAlignment`
      because it is sequential and complete. Deduplicate either way.
    - With `sync_alignment=true`, a turn can end with a frame that has alignment but no `audio`.
    - Whether `isFinal` arrives after each flush or only at end of stream is debated. Do not use it
      as a per-turn marker; the multi-context socket gives cleaner per-turn boundaries (3.3).
- **How to compute the played portion:**
  1. The browser reports how many ms of TTS audio it actually played.
  2. The server finds the last character whose absolute start time is at or before that value.
  3. `text_spoken = originalText.slice(0, idx + 1)`.

### 3.3 `multi-stream-input` WebSocket (multi-context; better for barge-in)
- `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/multi-stream-input?model_id=...` **[V]**.
  Up to **5 concurrent contexts per connection** **[V]**.
- **Messages [V for the shapes listed in the docs]:**
```json
{ "text": " ", "voice_settings": { "stability": 0.5, "similarity_boost": 0.8 }, "context_id": "turn-7" }
{ "text": "What is the next investigation? ", "context_id": "turn-7" }
{ "context_id": "turn-7", "flush": true }
{ "context_id": "turn-7", "close_context": true }
{ "close_socket": true }
```
  - Send `voice_settings` only once per context.
  - **To handle an interruption, close the interrupted context and start a new `context_id`**
    **[V]**.
- **Server messages:** `audio` (base64) plus the context id, and a final message per context
  **[V]**. The id field's casing differs: protocol examples use `context_id`, while sample code
  reads `contextId` **[V? conflict]**. Parse both.
- Close semantics and the 20-s idle auto-flush are documented on the Text-to-Dialogue
  multi-context page and probably apply here too **[V?]**.

### 3.4 Text to Dialogue WebSocket (needed for `eleven_v4_turbo` / `eleven_v3`)
- `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=...`
  **[V]**. It is intended for `eleven_v3*` and `eleven_v4*` models only. The TTS socket rejects
  those models with HTTP 400 `unsupported_model` **[V/S]**.
- **Messages:**
  - The first message registers `voices`, plus `xi_api_key` if no header is used **[V]**.
  - Later frames send `inputs: [{ text, voice_id, new_turn? }]` **[V]**. The server buffers about
    40 characters / 8 words unless you send `{"flush": true}` **[V]**.
  - Close with `close_socket` **[V]**.
- **Responses use snake_case**, e.g. `is_final` and `char_start_times_ms` **[V]**. The end-of-turn
  field name conflicts: `is_final` in one place, `is_final_audio_for_turn` in another **[V?]**.
- `eleven_v4_turbo` allows one registered voice per connection; `eleven_v4` allows up to 10
  **[V]**.
- A multi-context variant exists at `/v1/text-to-dialogue/multi-stream-input` **[V]**.

### 3.5 REST alternative: with timestamps
- `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps` **[V]**.
  - Headers: `xi-api-key`, `Content-Type: application/json`.
  - Body: `text`, `model_id`, `voice_settings` and so on. `output_format` is a query parameter
    **[U, by analogy with convert]**.
- Response **[V for keys; units are seconds]**:
```json
{ "audio_base64": "<base64>",
  "alignment": { "characters": ["H","e"], "character_start_times_seconds": [0.0, 0.03], "character_end_times_seconds": [0.03, 0.07] },
  "normalized_alignment": { "characters": [...], "character_start_times_seconds": [...], "character_end_times_seconds": [...] } }
```
- Streaming variant: `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps` returns a stream
  of JSON objects, each with base64 audio and character timing **[V]**. The exact framing
  (newline-delimited or not) is **[U]**. It also accepts `previous_text` / `next_text` for
  continuity **[V]**.
- Separately, a Forced Alignment API aligns existing audio with text **[V]**.

### 3.6 Models (low latency)
- **`eleven_flash_v2_5` is confirmed and recommended for real time [V].**
  - The current models page lists a median latency of about 100 ms. Older pages say about 75 ms,
    which is model inference only.
  - 32 languages, up to 40,000 chars per request, and 50% cheaper per character than the
    multilingual models.
  - It works on `stream-input`.
- **`eleven_v4_turbo`** launched 2026-09-28 **[S for the date]**. It is ElevenLabs' "most
  expressive real-time" model, at about 100 ms **[V]**. It is **Text to Dialogue WebSocket only**
  (3.4).
- `eleven_multilingual_v2` is the default when `model_id` is omitted on stream-input **[V]**.
  Whether `eleven_turbo_v2_5` is still listed is unconfirmed **[U]**.

### 3.7 Data handling and pricing
- **Zero Retention Mode (ZRM) [V]:**
  - Enterprise only. Enable it per request with `enable_logging=false`.
  - It covers all `/v1/text-to-speech/*` endpoints and the TTS WebSocket, plus STT, realtime STT,
    text-to-dialogue and others. Realtime translation uses `enable_zrm=true`.
  - It does not cover the web UI, support tickets or emails.
  - Usage analytics still record that a request happened, without its content.
- **HIPAA requires both ZRM and a BAA [V].**
- **EU data residency [V]:** enterprise only. The WebSocket host is
  `wss://api.eu.residency.elevenlabs.io`. Storage is pinned to the EU; processing stays in the EU
  only with ZRM plus the API.
- **Pricing (https://elevenlabs.io/pricing/api) [V?]:** one current snapshot shows **$0.04/1k
  chars for Flash/Turbo** and $0.08/1k for the multilingual models. An older snapshot showed
  Flash/Turbo at $0.05/1k.

### 3.8 Unverified / could not confirm (ElevenLabs TTS)
- **Exact inner alignment key names and casing on `stream-input`,** and whether times are
  chunk-relative. This is the highest-risk item; test with a live key.
- Whether `isFinal` is sent after each `flush`.
- `try_trigger_generation` status, and the pronunciation-dictionary field name.
- Whether `eleven_turbo_v2_5` is still offered. Current pricing per model and plan.
- The context-id field casing in multi-context responses.

---

## 4. ElevenLabs realtime speech-to-text (Scribe v2 Realtime / Scribe v3 Live)

### 4.1 URLs consulted (2026-11-15)
- https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
- https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/event-reference (also served under /docs/developers/guides/cookbooks/...)
- https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
- https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/server-side-streaming, .../client-side-streaming, .../language-options
- https://elevenlabs.io/docs/overview/capabilities/speech-to-text, https://elevenlabs.io/docs/overview/models
- https://elevenlabs.io/blog/scribe-v3, https://elevenlabs.io/realtime-speech-to-text
- https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/batch/keyterm-prompting
- https://elevenlabs.io/docs/eleven-api/resources/libraries/scribe-stt/react-scribe (parameter ranges)
- https://github.com/elevenlabs/skills/blob/main/speech-to-text/references/realtime-events.md, .../realtime-server-side.md, .../realtime-commit-strategies.md

### 4.2 Endpoint, authentication and parameters
- **Endpoint:** `wss://api.elevenlabs.io/v1/speech-to-text/realtime` **[V]**.
- **Auth:** `xi-api-key` header, or a `token` query parameter holding a single-use token that
  expires after 15 min **[V]**.
- **Query parameters:**
  - `model_id`: default `scribe_v2_realtime`. **`scribe_v3_live` is the successor on the same
    socket** **[V]**.
  - `audio_format`: `pcm_8000`, `pcm_16000`, `pcm_22050`, `pcm_24000`, `pcm_44100`, `pcm_48000`
    or `ulaw_8000` **[V]**.
  - `commit_strategy`: `manual`, `vad` or `turn_prediction` **[V]**. The docs conflict on the
    default for `scribe_v3_live`, and **the SDKs do not support `turn_prediction` yet; use the raw
    WebSocket** **[V?]**.
  - `vad_silence_threshold_secs`: 0.3–3.0, default 1.5 **[V via the React SDK page]**.
  - `vad_threshold`: 0.1–0.9, default 0.4 **[V via the React SDK page]**.
  - `min_speech_duration_ms` / `min_silence_duration_ms`: 50–2000, default 100
    **[V via the React SDK page]**.
  - `language_code`: ISO 639-1 or 639-3. If omitted, the language is auto-detected **[V]**.
  - `include_timestamps`: default false **[V]**.
  - `include_language_detection` **[V]**.
  - `keyterms`: repeated query parameter, **max 50 terms of up to 20 chars each**, at extra cost.
    Scribe v3 Live adds a separate keyterm library of up to 10,000 terms that the model consults
    only when it hears a likely match **[V]**. One excerpt says a 20% premium **[V?]**.
  - `enable_logging=false` for ZRM. If ZRM was not applied, the server sends a non-fatal warning
    after `session_started`, and the session is still logged **[V]**.

### 4.3 Messages
- **Client → server [V for the field names; example values illustrative]:**
```json
{ "message_type": "input_audio_chunk", "audio_base_64": "<base64 PCM16 mono>", "commit": false, "sample_rate": 16000 }
```
  - `previous_text` is accepted **only on the first chunk**; later chunks give an error. Keep it
    under about 50 chars **[V]**. Do not put expected answers in it.
  - Recommended chunk size is 0.1–1 s **[V]**.
  - **Manual commit:** set `"commit": true` on a chunk **[V]**, or send
    `{"message_type": "commit"}` **[S/U]**.
- **Server → client [V for the names; field details partly U]:**
```json
{ "message_type": "session_started", "session_id": "<id>", "config": { "sample_rate": 16000, "audio_format": "pcm_16000", "model_id": "scribe_v3_live" } }
{ "message_type": "partial_transcript", "text": "the patient has" }
{ "message_type": "committed_transcript", "text": "The patient has central chest pain." }
{ "message_type": "committed_transcript_with_timestamps", "text": "The patient has central chest pain.", "language_code": "en",
  "words": [ { "text": "The", "start": 0.12, "end": 0.25, "type": "word", "logprob": -0.05 },
             { "text": " ", "start": 0.25, "end": 0.26, "type": "spacing" } ] }
```
  - Later `partial_transcript` messages replace earlier ones **[V]**.
  - `committed_transcript` is final and will not change **[V]**.
  - `committed_transcript_with_timestamps` arrives only with `include_timestamps=true` or
    `include_language_detection=true` **[V]**.
  - **Word fields:** `text`, `start`, `end` (seconds) and `type` (`word`, `spacing` or
    `audio_event`) **[V/S]**.
  - **`logprob` appears only in one example in ElevenLabs' skills repo. No explicit `confidence`
    field was found** **[S]**.
  - `session_id` in `session_started` is **[U]**.
  - Optional events also exist: `committed_transcript_entities`, `redacted_transcript` and
    `edited_transcript` **[V]**.
- **Errors:** an error message is sent before the socket closes **[V]**. Types:
  `auth_error`, `quota_exceeded`, `rate_limited`, `queue_overflow`, `resource_exhausted`,
  `input_error`, `invalid_request`, `session_time_limit_exceeded` **[V]**. The exact JSON shape is
  **[U]**.

### 4.4 Medical support, privacy and pricing
- **Medical:** `scribe_v2_medical` is **batch only**. There is **no realtime medical model**
  **[V]**.
- **ZRM:** enterprise only via `enable_logging=false`. HIPAA requires ZRM plus a BAA **[V]**.
- **Pricing [V? conflicting snapshots]:** realtime $0.22/h in one snapshot and $0.39/h (Scribe v2
  Realtime) in another. Batch Scribe is about $0.20–0.22/h. Silence is billed **[V]**.

### 4.5 Unverified / could not confirm (ElevenLabs STT)
- Per-word confidence. `logprob` was seen only in an example.
- The exact manual-commit message, the error JSON shape, and the `session_started` fields.
- The default commit strategy per model.
- Current realtime price, and the keyterm surcharge.

---

## 5. Browser APIs (MDN / Chrome)

### 5.1 URLs consulted (2026-11-15)
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/boundary_event
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisEvent, /charIndex, /charLength
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/install_static
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/phrases, https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionPhrase
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/on-device-speech-recognition
- https://developer.chrome.com/blog/new-in-chrome-139, https://developer.chrome.com/release-notes/150
- https://webaudio.github.io/web-speech-api/ (spec), https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md
- Secondary: https://github.com/mdn/browser-compat-data/issues/28419, https://issues.chromium.org/issues/40715888, https://issues.chromium.org/issues/40064827, https://issues.chromium.org/issues/521896368, https://github.com/HadrienGardeur/read-aloud-best-practices/issues/4, https://codersblock.com/blog/javascript-text-to-speech-and-its-many-quirks/

### 5.2 `SpeechSynthesisUtterance` `boundary` event
- The event fires when speech reaches a word or sentence boundary. MDN marks it **not Baseline**
  **[V]**.
- `charIndex` is the index into `utterance.text` being spoken when the event fired **[V]**.
- `charLength`, per MDN, is the number of characters, and **"if the speaking engine can't provide
  the information, it returns 0"** **[V]**.
- **Chrome support:**
  - Desktop Chrome has supported `boundary` since Chrome 33 (BCD discussion) **[S/V?]**.
  - **Google network voices, e.g. "Google US English" with `localService === false`, do not
    fire boundary events** on desktop Chrome **[S]**. They also stop after about 15 s on long
    utterances (Chromium bug 679437, cited by PhET) **[S]**.
  - OS/local voices (Windows SAPI, macOS) do fire word boundaries, but on Windows, sentence
    boundaries give `charLength` 0 **[S]**.
  - **Chrome for Android does not fire `boundary`** (Chromium issue 40715888) **[S]**.
- **Conclusion:** `charIndex` works for **local** voices on desktop Chrome. `charLength` is
  unreliable, so compute the word length yourself from `charIndex`. Browser TTS is not a
  dependable way to track the played portion across devices.

### 5.3 `SpeechRecognition` / `webkitSpeechRecognition`
- **Default Chrome behaviour sends audio to a server.** MDN: "On some browsers, like Chrome,
  using Speech Recognition on a web page involves a server-based recognition engine. Your audio
  is sent to a web service for recognition processing, so it won't work offline." **[V]** (Google
  runs the service).
- **On-device mode exists. It shipped in Chrome 139 (Aug 2025).** Chrome's release post says
  sites can query on-device availability per language and that audio need not go to a third
  party **[V]**.
  - `recognition.processLocally = true`: a boolean, default false, that requires recognition on
    the device. Marked experimental **[V]**.
  - `SpeechRecognition.available({ langs: ["en-US"], processLocally: true })` returns
    `"available"`, `"downloadable"`, `"downloading"` or `"unavailable"`. It can't guarantee that a
    remote service supports a language **[V]**.
  - `SpeechRecognition.install({ langs: ["en-US"] })` returns `Promise<boolean>`. `false` means an
    unsupported language, a failed install, or an empty array **[V]**. The other option names
    for install are **[U]**.
  - The `quality` option (`"command"` default, `"dictation"`, `"conversation"`) for both methods
    is new in **Chrome 150** **[V]**.
  - Both static methods are gated by the `on-device-speech-recognition` Permissions-Policy, with
    default allowlist `self` **[V]**.
  - The spec forbids training on-device models on user speech obtained through the API **[V]**.
  - **Caveat:** an open Chromium issue (521896368) says `processLocally = false` may silently
    prefer on-device recognition when a pack is installed. MDN's fallback pattern is to set
    `processLocally = false` to use the cloud **[S/V]**. If audio must stay on the device, treat
    any cloud fallback as a failure.
- **Contextual biasing:** `recognition.phrases = [new SpeechRecognitionPhrase("tachycardia", 3.0)]`
  with boost 0.0–10.0 (default 1.0) **[V]**. MDN's example pairs it with `processLocally = true`
  **[V]**. MDN warns that high values (9–10) cause false recognitions **[V]**. Experimental.
- **Output:** each `SpeechRecognitionAlternative` has `transcript` and `confidence`. **There are
  no word timestamps** **[V/U]**.

---

## 6. Fit against requirements

| Requirement | Deepgram Nova-3 Medical (STT) | ElevenLabs Scribe v3 Live (STT) | Chrome SpeechRecognition |
|---|---|---|---|
| Low latency streaming | Yes. Interim results, endpointing, UtteranceEnd, Finalize | Yes. Partials, VAD / turn-prediction commits | Varies; cloud by default |
| Word timestamps + confidence | **Yes: start/end/confidence/punctuated_word per word** | start/end per word; confidence only as `logprob` (unconfirmed) | No word timestamps |
| Medical vocabulary | **Medical-tuned streaming model**, optional keyterm (500 tokens, mid-stream Configure) | No realtime medical model; keyterms ≤50×20 chars | `phrases` biasing (experimental) |
| Retention control | `mip_opt_out=true` per request (zero data retention; possible price uplift); BAA (Enterprise) | ZRM enterprise only; BAA | Audio goes to Google unless on-device |

| Requirement | Deepgram Flux TTS (`/v2/speak`) | ElevenLabs Flash v2.5 (`stream-input`) | Deepgram Aura-2 (`/v1/speak`) | Browser speechSynthesis |
|---|---|---|---|---|
| Played-portion tracking | **Built in: Interrupt + `playback_offset` → `text_spoken` / `text_remaining`** | Char-level alignment (`sync_alignment=true`); you do the maths; casing and time-base quirks | None; estimation only | `boundary` events on local voices only |
| Latency | Streaming, turn-based | About 75–100 ms model latency | Under 200 ms TTFB (vendor claim) | Local |
| Retention | `mip_opt_out` | ZRM enterprise only | `mip_opt_out` | n/a |
| Price | $0.045/1k chars | about $0.04–0.05/1k chars | $0.030/1k chars | free |

**Medical vocabulary without biasing toward a per-case answer key (design guidance, not vendor
documentation):**
1. Rely on `nova-3-medical`'s built-in domain vocabulary first.
2. If you add keyterms, use **one static, case-independent specialty lexicon** that is versioned
   and logged with each transcript. Never use the case's expected findings or diagnoses.
3. Do not use mid-stream `Configure` to inject case-specific terms.
4. Never put expected answers in ElevenLabs `previous_text`.
5. Validate with recordings that include near-miss distractors (e.g. hydralazine vs hydroxyzine),
   with and without keyterms. Keyterm and phrase boosting can turn near-misses into false
   positives.
