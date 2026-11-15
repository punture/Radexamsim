# Live-session load test

## Target

**Pilot target: 25 concurrent live stations on one API process and one worker.** That is
one residency cohort sitting a mock oral exam at the same time. The deployment plan runs exactly
one API process (DEPLOYMENT.md §3.2), so a single process has to carry the whole pilot.

To leave headroom, the test runs at 1×, 2× and 4× the target, plus a longer run at 2×.

## Result (2026-11-15)

At up to 100 concurrent stations the API showed no errors, timeouts or dropped turns. Its own
share of a turn stayed under 25 ms at the 95th percentile in every run. One process used under
one CPU core and about 225 MB of memory at the highest level. The worker cleared every queued
assessment within 5 seconds of the last station ending.

This covers the application's own work only. It does not include speech recognition, speech
synthesis or model latency (see [What this does not measure](#what-this-does-not-measure)).

## Method

`apps/api/load/live-load.ts` runs the test:

1. It creates a fresh database (`sim_load`), runs the migrations and the development seed.
2. It starts a separate API process and worker process from source, as the end-to-end harness
   does.
3. It creates one learner account per simulated station, each with an active plan and minutes.

Each simulated learner arrives at a random point within the first 5 seconds and runs the real
protocol:

1. Create an exam session.
2. Pass preflight.
3. Get a WebSocket ticket and connect.
4. Start the station.
5. Acknowledge every image render and report speech playback, as the browser does.
6. Answer each examiner prompt after a randomized pause, with a dev-injected spoken turn that
   ends with a completion phrase.
7. Ask to end the station, unless the examiner has already closed it.

The examiner is the deterministic policy. The assessor is the labelled development baseline,
run by the worker. The cases are the fictional fixtures; the fixture exam form has two short
cases, so the examiner closes a station by itself after about nine turns.

Measured:

| Metric | From → to |
|---|---|
| First utterance | `start_station` sent → first examiner utterance received. Includes the first image load and its render acknowledgement. |
| Turn latency | Candidate's final transcript sent → next examiner utterance (or the station's end) received |
| Server decision | Policy decision time recorded by the server (`policy.decision.latencyMs`) |
| CPU and memory | The API's node process, sampled every 500 ms from `/proc`. CPU is a percentage of **one** core. |
| Assessment drain | Last station ended → no `queued` or `running` jobs left |

Machine: a 4-vCPU cloud container (Intel Xeon, 2.1 GHz), 16.9 GB RAM, Node 22.23,
PostgreSQL 16.15 on the same machine. The idle development stack was running alongside.

## Results

Latencies are in milliseconds: p50 / p95 / max. CPU is mean / max, as a percentage of one core.

| Stations (concurrent × back to back) | Completed | Errors | Turn timeouts | Turns | First utterance | Turn latency | Server decision (p50 / p95) | API CPU % | API RSS max (MB) | Assessment drain (s) | Wall time (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 25 × 1 | 25 | 0 | 0 | 100 | 21 / 35.2 / 38.1 | 12.1 / 24.6 / 53.7 | 1 / 2 | 19.4 / 53.9 | 162.9 | 4.5 | 11.5 |
| 50 × 1 | 50 | 0 | 0 | 200 | 16.1 / 26.3 / 29.7 | 10.3 / 17.8 / 35.7 | 1 / 1 | 23.2 / 40.1 | 182.8 | 4.5 | 11.7 |
| 100 × 1 | 100 | 0 | 0 | 400 | 21 / 53.8 / 104.3 | 11.8 / 23.6 / 71.8 | 1 / 2 | 41.9 / 84 | 224.8 | 5 | 12 |
| 50 × 3 (sustained) | 150 | 0 | 0 | 1350 | 17.8 / 32.7 / 87.2 | 10.7 / 18.5 / 56.9 | 1 / 1 | 13.9 / 59.8 | 206.9 | 1 | 107.5 |

- The first three rows are a burst: 4 turns per station with a 0.9–2.1 s pause before each
  turn. Raw data: [load-test-results.json](load-test-results.json).
- The last row is sustained: 50 learners each ran 3 stations back to back, with a 1.8–4.2 s
  pause before each turn. Every station ran until the examiner closed it. Raw data:
  [load-test-sustained.json](load-test-sustained.json).

## What this does not measure

- **Speech and model latency.** Real speech recognition (end-of-speech detection), a model
  examiner and speech synthesis will dominate what a learner feels in production. Each adds
  hundreds of milliseconds or more per turn, far above the 10–25 ms measured here. Measuring
  them needs provider credentials, and none were available. Before the pilot, also check each
  provider account's concurrency and rate limits against 25 simultaneous stations. They are
  likely to bind before the API does. (Expected, not measured.)
- **Real browsers and networks.** The simulated browsers ran on the same machine over loopback.
  Image decoding, the DICOM viewer, and the distance and jitter of real networks are not
  included.
- **Production hardware and topology.** One container ran the database, the API, the worker
  and the load generator. There was no TLS, reverse proxy or Next.js rewrite in the path.
- **More than one API process.** This is not supported yet (DEPLOYMENT.md §3.2).
- **Real model assessors.** With a model assessor, each assessment takes seconds to minutes. One
  worker runs one job at a time (DEPLOYMENT.md L5), so the queue drains far more slowly.
- **Long stations.** Fixture stations last under a minute. Session clocks, pauses and time
  expiry over a full-length station were not exercised under load.

## Findings and fixes from this test

1. **Rate limits were per network address.** Behind one hospital or university address (NAT
   or proxy), learners shared one counter. In the first run, 25 learners on one address
   exhausted the per-address WebSocket-ticket and session-creation limits, and the API answered
   `429`. Limits for signed-in requests are now counted per learner. Anonymous requests
   (sign-in, registration, public pages) are still counted per client address. Test: "counts
   rate limits per signed-in learner, so learners sharing one network address do not throttle
   each other" in `apps/api/test/live.test.ts`.
2. **The client address behind a proxy was spoofable.** By default the production API trusted
   every `X-Forwarded-For` hop, so a client could forge its address and get around the
   per-address limits. The default is now one trusted hop, set with `TRUST_PROXY`
   ([.env.example](../.env.example), DEPLOYMENT.md §3.2). Tests: `apps/api/test/proxy.test.ts`.
3. **The worker did not exit on SIGTERM** when its health endpoint was enabled. The open
   server kept the process alive. It now closes the endpoint on shutdown.

## How to run it

The test needs the local PostgreSQL (`pnpm db:start`). It drops and recreates the `sim_load`
database, and leaves the development database alone.

```bash
pnpm --filter @sim/api run load --levels 25,50,100 --turns 4
```

```bash
pnpm --filter @sim/api run load --levels 50 --turns 12 --stations 3 --think-ms 3000 --out docs/load-test-sustained.json
```

| Option | Meaning | Default |
|---|---|---|
| `--levels` | Comma-separated numbers of concurrent learners | `10,25,50` |
| `--turns` | Most candidate turns per station | `4` |
| `--stations` | Stations each learner runs back to back | `1` |
| `--think-ms` | Mean pause before each turn (randomized ±40%) | `1500` |
| `--out` | Results file, relative to the repository root | `docs/load-test-results.json` |
| `--port` | API port (0 picks a free one) | `0` |

Process logs go to `var/load-api.log` and `var/load-worker.log`.

Re-run the test after changing the live session controller, the examiner policy, the session
event tables or the rate limits. Before the pilot, run it on the target hardware.
