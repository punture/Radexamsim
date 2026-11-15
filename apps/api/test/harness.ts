import WebSocket from "ws";
import type { ServerMessage } from "@sim/contracts";
import { createDb, type Db } from "@sim/db";
import { createTestDatabase } from "@sim/db/testing";
import type { LlmProvider } from "@sim/ai";
import { loadConfig } from "../src/config";
import { buildDeps, type Deps } from "../src/deps";
import { buildServer, type BuiltServer } from "../src/server";
import { DEFAULT_SEED, seedDev } from "../src/services/seed";

export type TestEnv = {
  base: string;
  deps: Deps;
  server: BuiltServer;
  db: Db;
  owner: { id: string; totp: string };
  learnerId: string;
  /** Simulates a process restart (deploy or crash recovery) on the same database. Returns recovered session count. */
  restart: () => Promise<number>;
  close: () => Promise<void>;
};

export async function startTestEnv(over: { llm?: LlmProvider | null; env?: Record<string, string>; now?: () => number } = {}): Promise<TestEnv> {
  const t = await createTestDatabase();
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: t.url,
    ALLOW_DEV_INJECTION: "true",
    ALLOW_FIXTURES: "true",
    OWNER_MFA_REQUIRED: "true",
    STORAGE_LOCAL_ROOT: "./var/test-storage",
    ...over.env,
  });
  const db = createDb(t.url);
  const deps = buildDeps(config, { db, llm: over.llm ?? null, asr: null, tts: null, speech: { asr: "dev_injection_only", tts: "browser" }, ...(over.now ? { now: over.now } : {}) });
  const seeded = await seedDev(db, { ...DEFAULT_SEED, encryptionKey: config.AUTH_ENCRYPTION_KEY });
  const listen = async (s: BuiltServer) => {
    await s.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = s.app.server.address();
    return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  };
  const server = await buildServer(deps);
  const env: TestEnv = {
    base: await listen(server),
    deps,
    server,
    db,
    owner: { id: seeded.ownerId, totp: seeded.ownerTotpSecret },
    learnerId: seeded.learnerId,
    restart: async () => {
      await env.server.live.shutdown();
      await env.server.app.close();
      const next = await buildServer(deps);
      const recovered = await next.live.recoverOrphans();
      env.server = next;
      env.base = await listen(next);
      return recovered;
    },
    close: async () => {
      await env.server.live.shutdown();
      await env.server.app.close();
      await db.$client.end();
      await t.drop();
    },
  };
  return env;
}

/** Minimal cookie-aware HTTP client. */
export class Http {
  cookie = "";
  constructor(private readonly base: string) {}
  async req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; headers: Headers; bytes: Uint8Array }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), "x-sim-csrf": "1" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let json: any = null;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      json = null;
    }
    return { status: res.status, json, headers: res.headers, bytes };
  }
  async login(email: string, password: string): Promise<void> {
    const r = await this.req("POST", "/api/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.json)}`);
  }
}

export type ClientBehaviour = {
  /** Return "failed" to simulate an image that does not render. */
  renderResult?: (handle: string) => "rendered" | "failed";
  /** Return a number of characters to interrupt playback at; null plays fully. */
  interruptAt?: (text: string) => number | null;
};

/** Scripted browser stand-in: acknowledges viewer commands and reports speech playback. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  private ws!: WebSocket;
  private cmd = 0;
  constructor(private readonly behaviour: ClientBehaviour = {}) {}

  async connect(url: string, ticket: string): Promise<void> {
    this.ws = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(String(data)) as ServerMessage;
      this.messages.push(m);
      this.react(m);
    });
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  private react(m: ServerMessage): void {
    if (m.type === "viewer_command" && m.command.awaitAck) {
      const panes = m.command.newAssets.map((a) => {
        const st = this.behaviour.renderResult?.(a.handle) ?? "rendered";
        return { handle: a.handle, status: st, error: st === "failed" ? "decode error" : null, renderMs: 30 };
      });
      const failed = panes.some((p) => p.status === "failed");
      setTimeout(() => this.send({ type: "viewer_ack", ack: { commandId: m.command.commandId, status: failed ? "failed" : "rendered", panes } }), 5);
    }
    if (m.type === "examiner_utterance") {
      const cut = this.behaviour.interruptAt?.(m.text) ?? null;
      setTimeout(() => {
        this.send({ type: "tts_playback", utteranceId: m.utteranceId, event: "started", playedChars: 0, error: null });
        if (cut !== null) this.send({ type: "tts_playback", utteranceId: m.utteranceId, event: "interrupted", playedChars: cut, error: null });
        else this.send({ type: "tts_playback", utteranceId: m.utteranceId, event: "completed", playedChars: m.text.length, error: null });
      }, 5);
    }
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  nextId(): string {
    return `cmd-${Date.now().toString(36)}-${++this.cmd}`;
  }
  say(text: string, endTurn = true): string {
    const commandId = this.nextId();
    this.send({ type: "candidate_transcript", commandId, source: "dev_injected", text, clientStartMs: 0, clientEndMs: Math.max(1000, text.length * 60), confidence: null, provider: { name: "dev", model: null } });
    if (endTurn) this.send({ type: "end_turn", commandId: this.nextId() });
    return commandId;
  }

  async waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs?: number, from?: number): Promise<T>;
  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs?: number, from?: number): Promise<ServerMessage>;
  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 8000, from = 0): Promise<ServerMessage> {
    const started = Date.now();
    for (;;) {
      const found = this.messages.slice(from).find(pred);
      if (found) return found;
      if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting; last messages: ${JSON.stringify(this.messages.slice(-5)).slice(0, 1500)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  utterances(): Extract<ServerMessage, { type: "examiner_utterance" }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: "examiner_utterance" }> => m.type === "examiner_utterance");
  }
  close(): void {
    this.ws.close();
  }
}

export const PREFLIGHT_OK = {
  microphone: "granted",
  audioPlayback: "ok",
  imageRender: "ok",
  connectionRttMs: 20,
  speechRecognition: "available",
  browser: { userAgentFamily: "test", webAudio: true, webSocket: true, screenWidth: 1920, screenHeight: 1080 },
};
