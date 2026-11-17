import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedLlmProvider } from "@sim/ai";
import { caseAssessments, caseAttempts, eq, sql } from "@sim/db";
import { Http, PREFLIGHT_OK, TestClient, startTestEnv, type TestEnv } from "@sim/api/test-harness";
import { loadWorkerConfig } from "../src/config";
import { buildWorkerDeps } from "../src/deps";
import { drainQueue } from "../src/runner";

/**
 * LLM_FIXTURES_ONLY (for a free-tier key whose provider may reuse content): a real case is never
 * sent to the assessment model; it is assessed as if no model were configured.
 */
let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => {
  await env?.close();
});

async function runExamSession(): Promise<string> {
  const http = new Http(env.base);
  await http.login("learner@example.test", "learner-dev-password-123");
  const created = await http.req("POST", "/api/sessions", { profileVersionId: "abr-dr-neuro-oral@2026-11-15.1", mode: "exam", caseCount: 2, inputMode: "voice" });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const sessionId = created.json.sessionId as string;
  await http.req("POST", `/api/sessions/${sessionId}/preflight`, PREFLIGHT_OK);
  const t = await http.req("POST", `/api/sessions/${sessionId}/ws-ticket`);
  const client = new TestClient();
  await client.connect(`${env.base.replace("http", "ws")}/ws`, t.json.ticket);
  client.send({ type: "start_station", commandId: client.nextId() });
  await client.waitFor((m) => m.type === "examiner_utterance");
  const n = client.messages.length;
  client.say("Early hypodensity in the left MCA territory. That's all.");
  await client.waitFor((m) => m.type === "examiner_utterance" || m.type === "station_ended", 8000, n).catch(() => undefined);
  client.send({ type: "request_end_station", commandId: client.nextId() });
  await client.waitFor((m) => m.type === "station_ended");
  client.close();
  return sessionId;
}

describe("LLM_FIXTURES_ONLY and assessment", () => {
  it("assesses a real case without calling the model", async () => {
    const sessionId = await runExamSession();
    // Make every case look real (not a development fixture) before the worker runs.
    await env.db.execute(sql`UPDATE case_versions SET payload = jsonb_set(payload, '{isDevelopmentFixture}', 'false'::jsonb)`);

    const provider = new ScriptedLlmProvider({});
    const config = loadWorkerConfig({ NODE_ENV: "test", DATABASE_URL: "unused", ALLOW_DEV_BASELINE_ASSESSOR: "true", LLM_FIXTURES_ONLY: "true" });
    await drainQueue(buildWorkerDeps(config, { db: env.db, providerFor: () => provider }));

    expect(provider.calls).toEqual([]);
    const started = (await env.db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, sessionId))).filter((a) => a.startedAtMs !== null);
    expect(started.length).toBeGreaterThan(0);
    for (const a of started) {
      const [assessment] = await env.db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, a.id));
      expect(assessment!.assessorKind).toBe("dev_baseline");
    }
  }, 60_000);

  it("is refused in production", () => {
    expect(() => loadWorkerConfig({ NODE_ENV: "production", DATABASE_URL: "unused", LLM_FIXTURES_ONLY: "true" })).toThrow(/LLM_FIXTURES_ONLY/);
  });
});
