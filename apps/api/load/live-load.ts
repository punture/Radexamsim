/**
 * Live-session load test (spec M3: "realistic browser and load tests for a stated small
 * concurrency target").
 *
 * Starts a separate API process and a worker process on a fresh database, creates N learner
 * accounts, and runs N concurrent spoken exam stations over WebSockets. Each simulated
 * browser acknowledges image renders, reports speech playback, and speaks dev-injected turns
 * that end with a completion phrase. Measures what learners feel:
 *   - start -> first examiner question (images rendered and acknowledged first);
 *   - end of a candidate turn -> next examiner utterance;
 *   - errors and timeouts;
 * plus server CPU and memory, server-side policy decision time, and worker drain time for
 * the queued assessments (labelled development baseline assessor).
 *
 * Not measured: real speech recognition and synthesis, model examiner and assessor latency,
 * and network distance. Those dominate production latency and need provider credentials.
 *
 *   pnpm --filter @sim/api run load --levels 25,50,100 --turns 4
 *   pnpm --filter @sim/api run load --levels 50 --turns 12 --stations 3 --think-ms 3000 --out docs/load-test-sustained.json
 *
 * See docs/LOAD_TEST.md for the stated target and the last results.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process"; // execFileSync: pgrep
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { ServerMessage } from "@sim/contracts";
import { allotPeriod } from "@sim/billing";
import { createDb, entitlements, jobs, runMigrations, sessionEvents, sql, users, inArray, type Db } from "@sim/db";
import { createLocalSession } from "../src/auth/plugin";
import { loadConfig } from "../src/config";
import { DEFAULT_SEED, seedDev } from "../src/services/seed";
import { PREFLIGHT_OK } from "../test/harness";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
const LEVELS = opt("levels", "10,25,50").split(",").map(Number);
const TURNS = Number(opt("turns", "4"));
const THINK_MS = Number(opt("think-ms", "1500"));
/** Stations each simulated learner runs back to back (a longer, sustained load). */
const STATIONS = Number(opt("stations", "1"));
let API_PORT = Number(opt("port", "0")); // 0 = pick a free port
const ADMIN_URL = process.env.LOAD_ADMIN_URL ?? "postgres://sim:sim_dev_password@127.0.0.1:5432/postgres";
const DB_NAME = "sim_load";
const DB_URL = `postgres://sim:sim_dev_password@127.0.0.1:5432/${DB_NAME}`;
let BASE = "";
const PROFILE = "abr-dr-neuro-oral@2026-11-15.1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : NaN);
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : NaN);

/** Minimal browser stand-in that timestamps every message. */
class LoadClient {
  readonly log: { m: ServerMessage; at: number }[] = [];
  private ws!: WebSocket;
  private n = 0;
  private closed = false;
  /** The station ended (the examiner finished every case, time ran out, or we asked), or the socket closed. */
  ended(): boolean {
    return this.closed || this.log.some((e) => e.m.type === "station_ended");
  }
  async connect(url: string): Promise<void> {
    this.ws = new WebSocket(url);
    this.ws.on("close", () => {
      this.closed = true;
    });
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(String(data)) as ServerMessage;
      this.log.push({ m, at: performance.now() });
      if (m.type === "viewer_command" && m.command.awaitAck) {
        const panes = m.command.newAssets.map((a) => ({ handle: a.handle, status: "rendered", error: null, renderMs: 30 }));
        this.send({ type: "viewer_ack", ack: { commandId: m.command.commandId, status: "rendered", panes } });
      }
      if (m.type === "examiner_utterance") {
        this.send({ type: "tts_playback", utteranceId: m.utteranceId, event: "started", playedChars: 0, error: null });
        this.send({ type: "tts_playback", utteranceId: m.utteranceId, event: "completed", playedChars: m.text.length, error: null });
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }
  send(m: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  id(): string {
    return `ld-${Date.now().toString(36)}-${++this.n}`;
  }
  say(text: string): void {
    this.send({ type: "candidate_transcript", commandId: this.id(), source: "dev_injected", text, clientStartMs: 0, clientEndMs: 4000, confidence: 0.95, provider: { name: "load", model: null } });
    this.send({ type: "end_turn", commandId: this.id() });
  }
  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs: number, from = 0): Promise<{ m: ServerMessage; at: number }> {
    const started = performance.now();
    for (;;) {
      const hit = this.log.slice(from).find((e) => pred(e.m));
      if (hit) return hit;
      if (performance.now() - started > timeoutMs) throw new Error("timeout");
      await sleep(5);
    }
  }
  close(): void {
    this.ws.close();
  }
}

type LearnerResult = {
  error: string | null;
  firstUtteranceMs: number[];
  turnMs: number[];
  turnTimeouts: number;
  stationsCompleted: number;
  /** Stations the examiner closed itself after the last case (the fixture form has two short cases). */
  endedByExaminer: number;
};

async function learner(cookie: string): Promise<LearnerResult> {
  const res: LearnerResult = { error: null, firstUtteranceMs: [], turnMs: [], turnTimeouts: 0, stationsCompleted: 0, endedByExaminer: 0 };
  const http = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(`${BASE}${p}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), cookie, "x-sim-csrf": "1" }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  for (let station = 0; station < STATIONS; station++) {
    const client = new LoadClient();
    try {
      if (station > 0) await sleep(THINK_MS); // a short break between stations
      const created = await http("POST", "/api/sessions", { profileVersionId: PROFILE, mode: "exam", inputMode: "voice" });
      if (created.status !== 200) throw new Error(`create ${created.status} ${created.json?.code ?? ""}`);
      const sid = created.json.sessionId as string;
      const pf = await http("POST", `/api/sessions/${sid}/preflight`, PREFLIGHT_OK);
      if (pf.status !== 200) throw new Error(`preflight ${pf.status}`);
      const t = await http("POST", `/api/sessions/${sid}/ws-ticket`);
      await client.connect(`${BASE.replace("http", "ws")}/ws?ticket=${encodeURIComponent(t.json.ticket)}`);
      await client.waitFor((m) => m.type === "state", 10_000);
      const start = performance.now();
      client.send({ type: "start_station", commandId: client.id() });
      const first = await client.waitFor((m) => m.type === "examiner_utterance", 20_000);
      res.firstUtteranceMs.push(first.at - start);
      for (let k = 0; k < TURNS && !client.ended(); k++) {
        await sleep(THINK_MS * (0.6 + Math.random() * 0.8));
        if (client.ended()) break;
        const from = client.log.length;
        const sent = performance.now();
        client.say("There is a focal abnormality on these images with surrounding change. My leading diagnosis is as discussed, with an appropriate differential. I would recommend further imaging and discuss it with the team. That's all.");
        try {
          const u = await client.waitFor((m) => m.type === "examiner_utterance" || m.type === "station_ended", 15_000, from);
          res.turnMs.push(u.at - sent); // the closing utterance or the end both answer the turn
        } catch {
          res.turnTimeouts++;
        }
      }
      if (client.ended()) {
        res.endedByExaminer++;
      } else {
        client.send({ type: "request_end_station", commandId: client.id() });
        await client.waitFor((m) => m.type === "station_ended", 15_000);
      }
      res.stationsCompleted++;
    } catch (e) {
      res.error = (e as Error).message.slice(0, 120);
      break;
    } finally {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
  }
  return res;
}

function startProcess(name: string, cmd: string[], cwd: string, env: Record<string, string>): ChildProcess {
  // Own process group, so stopping it never signals this driver.
  const logFile = path.join(root, "var", `load-${name}.log`);
  mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = openSync(logFile, "w");
  const p = spawn(cmd[0]!, cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd], detached: true });
  p.on("exit", (code) => code && code !== 0 && console.error(`${name} exited with ${code} (see var/load-${name}.log)`));
  return p;
}

async function waitHttp(url: string, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not yet */
    }
    await sleep(300);
  }
  throw new Error(`not ready: ${url}`);
}

/** CPU % of one core over the last interval (from /proc utime+stime deltas) and resident memory. */
const TICKS = 100; // Linux USER_HZ
let lastCpu: { ticks: number; at: number } | null = null;
function sampleProc(pid: number): { cpu: number; rssMb: number } | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[11]) + Number(fields[12]); // utime + stime
    const rssPages = Number(fields[21]);
    const now = performance.now();
    const prev = lastCpu;
    lastCpu = { ticks, at: now };
    if (!prev) return null;
    const cpu = ((ticks - prev.ticks) / TICKS / ((now - prev.at) / 1000)) * 100;
    return { cpu, rssMb: (rssPages * 4096) / 1e6 };
  } catch {
    return null;
  }
}

/** The API runs under tsx; the measured process is its node child (largest RSS among descendants). */
function serverPid(root: number): number {
  try {
    const kids = execFileSync("pgrep", ["-P", String(root)], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(Number);
    if (!kids.length) return root;
    return kids.map((k) => serverPid(k)).at(-1)!;
  } catch {
    return root;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

async function main(): Promise<void> {
  if (!API_PORT) API_PORT = await freePort();
  BASE = `http://127.0.0.1:${API_PORT}`;
  const workerHealthPort = await freePort();
  const admin = createDb(ADMIN_URL);
  await admin.$client.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.$client.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.$client.end();
  await runMigrations(DB_URL);
  const db: Db = createDb(DB_URL);
  const config = loadConfig({ DATABASE_URL: DB_URL });
  await seedDev(db, { ...DEFAULT_SEED, encryptionKey: config.AUTH_ENCRYPTION_KEY });

  const storage = path.join(root, "var", "load-storage");
  mkdirSync(storage, { recursive: true });
  const env = { NODE_ENV: "test", DATABASE_URL: DB_URL, STORAGE_LOCAL_ROOT: storage, ALLOW_FIXTURES: "true" };
  const api = startProcess("api", ["pnpm", "exec", "tsx", "src/main.ts"], path.join(root, "apps/api"), { ...env, API_PORT: String(API_PORT), ALLOW_DEV_INJECTION: "true", ASR_PROVIDER: "dev_injection_only", TTS_PROVIDER: "none", LOG_LEVEL: "warn" });
  const worker = startProcess("worker", ["pnpm", "exec", "tsx", "src/main.ts"], path.join(root, "apps/worker"), { ...env, ALLOW_DEV_BASELINE_ASSESSOR: "true", WORKER_HEALTH_PORT: String(workerHealthPort) });
  const results: Record<string, unknown>[] = [];
  try {
    await waitHttp(`${BASE}/api/health`, 60_000);
    await waitHttp(`http://127.0.0.1:${workerHealthPort}/health`, 60_000);
    const apiPid = serverPid(api.pid!);
    for (const n of LEVELS) {
      // Learner accounts with an active entitlement and minutes; sessions created directly
      // (account setup is not what is being measured, and login is rate-limited per IP).
      const cookies: string[] = [];
      for (let i = 0; i < n; i++) {
        const [u] = await db.insert(users).values({ email: `load-${n}-${i}-${Date.now()}@example.test`, authProvider: "local", role: "learner" }).returning();
        await db.insert(entitlements).values({ userId: u!.id, status: "active", planId: "monthly", periodKey: `load:${u!.id}` });
        await db.transaction((tx) => allotPeriod(tx, u!.id, `load:${u!.id}`, 300, "load-test"));
        const s = await createLocalSession(db, u!.id, 2);
        cookies.push(`sim_session=${s.token}`);
      }
      const samples: { cpu: number; rssMb: number }[] = [];
      lastCpu = null;
      sampleProc(apiPid);
      const sampler = setInterval(() => {
        const s = sampleProc(apiPid);
        if (s) samples.push(s);
      }, 500);
      const levelStart = new Date();
      const t0 = performance.now();
      const out = await Promise.all(cookies.map(async (c) => {
        await sleep(Math.random() * 5000); // stagger arrivals over 5 s
        return learner(c);
      }));
      const wall = performance.now() - t0;
      clearInterval(sampler);
      // Worker: wait for queued assessments from this level to drain.
      const drainStart = performance.now();
      let pending = Infinity;
      while (performance.now() - drainStart < 180_000) {
        const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(inArray(jobs.status, ["queued", "running"]));
        pending = row?.n ?? 0;
        if (pending === 0) break;
        await sleep(500);
      }
      const drainMs = performance.now() - drainStart;
      const decisions = await db
        .select({ ms: sql<number>`(payload->>'latencyMs')::int` })
        .from(sessionEvents)
        .where(sql`${sessionEvents.type} = 'policy.decision' and ${sessionEvents.serverTime} >= ${levelStart.toISOString()}`);
      const turn = out.flatMap((o) => o.turnMs);
      const first = out.flatMap((o) => o.firstUtteranceMs);
      const level = {
        concurrentStations: n,
        stationsPerLearner: STATIONS,
        stationsCompleted: out.reduce((a, o) => a + o.stationsCompleted, 0),
        stationsEndedByExaminer: out.reduce((a, o) => a + o.endedByExaminer, 0),
        errors: out.filter((o) => o.error).length,
        errorKinds: [...new Set(out.map((o) => o.error).filter(Boolean))].slice(0, 5),
        turnTimeouts: out.reduce((a, o) => a + o.turnTimeouts, 0),
        turns: turn.length,
        firstUtteranceMs: { p50: r1(pct(first, 0.5)), p95: r1(pct(first, 0.95)), max: r1(Math.max(...first)) },
        turnLatencyMs: { p50: r1(pct(turn, 0.5)), p95: r1(pct(turn, 0.95)), max: r1(Math.max(...turn)) },
        serverDecisionMs: { p50: r1(pct(decisions.map((d) => d.ms), 0.5)), p95: r1(pct(decisions.map((d) => d.ms), 0.95)), n: decisions.length },
        apiCpuPercent: { mean: r1(samples.reduce((a, s) => a + s.cpu, 0) / Math.max(1, samples.length)), max: r1(Math.max(...samples.map((s) => s.cpu))) },
        apiRssMbMax: r1(Math.max(...samples.map((s) => s.rssMb))),
        wallSeconds: r1(wall / 1000),
        assessmentDrainSeconds: r1(drainMs / 1000),
        jobsLeftAfterDrain: pending,
      };
      results.push(level);
      console.log(JSON.stringify(level));
      await sleep(2000);
    }
  } finally {
    for (const p of [api, worker]) {
      try {
        process.kill(-p.pid!, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await db.$client.end();
  }

  const cpu = os.cpus();
  const report = {
    generatedAt: new Date().toISOString(),
    machine: { cpus: cpu.length, model: cpu[0]?.model ?? "unknown", memoryGb: r1(os.totalmem() / 1e9), node: process.version },
    config: { turnsPerStation: TURNS, stationsPerLearner: STATIONS, thinkMs: THINK_MS, examiner: "deterministic policy", speech: "dev-injected transcripts; no TTS/ASR provider", assessor: "development baseline (worker)", apiInstances: 1 },
    results,
  };
  const out = path.resolve(root, opt("out", "docs/load-test-results.json"));
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${path.relative(root, out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
