import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedLlmProvider } from "@sim/ai";
import { and, caseVersions, eq, sessionEvents, sql } from "@sim/db";
import { invalidateCaseCache } from "../src/services/content";
import { Http, PREFLIGHT_OK, TestClient, startTestEnv, type TestEnv } from "./harness";

/**
 * LLM_FIXTURES_ONLY (for a free-tier key whose provider may reuse content): the examiner model
 * sees fictional fixtures only. A real case falls back to the deterministic policy.
 */
let env: TestEnv;
const llm = new ScriptedLlmProvider({
  live_examiner: () => ({ kind: "data", data: { action: "wait", ref: null, reason: "candidate_still_thinking", note: "" } }),
});

beforeAll(async () => {
  env = await startTestEnv({ llm, env: { LLM_FIXTURES_ONLY: "true" } });
});
afterAll(async () => {
  await env?.close();
});

/** Runs one short exam session and returns the session id. */
async function speak(): Promise<string> {
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
  client.say("There is a hypodensity. That's all.");
  await new Promise((r) => setTimeout(r, 800));
  client.close();
  return sessionId;
}

async function decisions(sessionId: string) {
  const rows = await env.db.select().from(sessionEvents).where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.type, "policy.decision")));
  return rows.map((r) => r.payload as { proposer: string; model: string | null });
}

describe("LLM_FIXTURES_ONLY and the live examiner", () => {
  it("still sends fictional fixtures to the examiner model", async () => {
    const before = llm.calls.length;
    const sessionId = await speak();
    expect(llm.calls.length).toBeGreaterThan(before);
    expect((await decisions(sessionId)).some((d) => d.model !== null)).toBe(true);
  }, 30_000);

  it("never sends a real case to the examiner model", async () => {
    // Make every case look real (not a development fixture).
    await env.db.execute(sql`UPDATE case_versions SET payload = jsonb_set(payload, '{isDevelopmentFixture}', 'false'::jsonb)`);
    for (const row of await env.db.select({ versionId: caseVersions.versionId }).from(caseVersions)) invalidateCaseCache(row.versionId);

    const before = llm.calls.length;
    const sessionId = await speak();
    expect(llm.calls.length).toBe(before);
    const made = await decisions(sessionId);
    expect(made.length).toBeGreaterThan(0);
    for (const d of made) {
      expect(d.proposer).toBe("deterministic_fallback");
      expect(d.model).toBeNull();
    }
  }, 30_000);
});
