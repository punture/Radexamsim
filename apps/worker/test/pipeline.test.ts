import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedLlmProvider, type ScriptedHandler } from "@sim/ai";
import { caseAssessments, caseAttempts, eq, jobs, learningPlans, ownerReviewItems, stationSessions } from "@sim/db";
import { Http, PREFLIGHT_OK, TestClient, startTestEnv, type TestEnv } from "@sim/api/test-harness";
import { loadWorkerConfig } from "../src/config";
import { buildWorkerDeps } from "../src/deps";
import { drainQueue } from "../src/runner";

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => {
  await env?.close();
});

async function runExamSession(script: string[]): Promise<string> {
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
  for (const line of script) {
    const n = client.messages.length;
    client.say(line);
    await client.waitFor((m) => m.type === "examiner_utterance" || m.type === "station_ended", 8000, n).catch(() => undefined);
  }
  client.send({ type: "request_end_station", commandId: client.nextId() });
  await client.waitFor((m) => m.type === "station_ended");
  client.close();
  return sessionId;
}

describe("worker: assessment → debrief → learning plan", () => {
  it("assesses with the labelled dev baseline, releases exam feedback only after completion, and plans next practice", async () => {
    const sessionId = await runExamSession([
      "There is no intracranial hemorrhage. Early hypodensity in the left MCA territory. Posterior epidural mass with cord compression.",
      "That's all.",
    ]);
    const http = new Http(env.base);
    await http.login("learner@example.test", "learner-dev-password-123");
    // Before the worker runs, exam feedback is withheld.
    expect((await http.req("GET", `/api/sessions/${sessionId}/debrief`)).json.status).toBe("pending");

    const deps = buildWorkerDeps(loadWorkerConfig({ NODE_ENV: "test", ALLOW_DEV_BASELINE_ASSESSOR: "true", DATABASE_URL: "unused" }), { db: env.db, providerFor: () => null });
    await drainQueue(deps);

    const [s] = await env.db.select().from(stationSessions).where(eq(stationSessions.id, sessionId));
    expect(s!.status).toBe("complete");
    const attempts = await env.db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, sessionId));
    const started = attempts.filter((a) => a.startedAtMs !== null);
    for (const a of started) {
      const [assessment] = await env.db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, a.id));
      expect(assessment!.assessorKind).toBe("dev_baseline");
      expect(assessment!.provisional).toBe(true);
    }
    const debrief = (await http.req("GET", `/api/sessions/${sessionId}/debrief`)).json;
    expect(debrief.status).toBe("available");
    expect(debrief.cases.length).toBe(started.length);
    const c0 = debrief.cases[0];
    expect(c0.overall.uncertaintyStatement).toMatch(/development baseline/i);
    expect(c0.overall.ratingDisclaimer).toMatch(/not an ABR score/);
    for (const st of c0.strengths) for (const ev of st.evidence) expect(typeof ev.quote).toBe("string");
    const transcript = (await http.req("GET", `/api/sessions/${sessionId}/transcript`)).json;
    expect(transcript.some((l: { speaker: string }) => l.speaker === "candidate")).toBe(true);
    const [plan] = await env.db.select().from(learningPlans).where(eq(learningPlans.userId, env.learnerId));
    expect(plan).toBeTruthy();
    expect(JSON.stringify(plan!.payload)).not.toMatch(/fx-|infarct|metasta/i); // no case ids or diagnoses
  }, 60_000);

  it("retries on provider failure, never fabricates a result, and settles the debrief as unavailable", async () => {
    const sessionId = await runExamSession(["Early hypodensity in the left MCA territory. That's all."]);
    const failing: ScriptedHandler = () => ({ kind: "error", message: "503 overloaded" });
    const provider = new ScriptedLlmProvider({ assessor_a: failing, assessor_b: failing });
    const deps = buildWorkerDeps(loadWorkerConfig({ NODE_ENV: "test", DATABASE_URL: "unused" }), { db: env.db, providerFor: () => provider });
    await drainQueue(deps);
    const attempts = await env.db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, sessionId));
    const first = attempts.find((a) => a.startedAtMs !== null)!;
    expect((await env.db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, first.id))).length).toBe(0);
    const [job] = await env.db.select().from(jobs).where(eq(jobs.dedupeKey, `assess:${first.id}:v1`));
    expect(job!.status).toBe("queued"); // scheduled for retry with backoff
    expect(job!.attempts).toBe(1);
    // Exhaust retries quickly.
    for (let i = 0; i < 6; i++) {
      await env.db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, job!.id));
      await drainQueue(deps);
    }
    const [dead] = await env.db.select().from(jobs).where(eq(jobs.id, job!.id));
    expect(dead!.status).toBe("dead");
    const items = await env.db.select().from(ownerReviewItems).where(eq(ownerReviewItems.dedupeKey, `dead-job:${job!.id}`));
    expect(items.length).toBe(1);
    // Debrief completes the session but marks the case unavailable rather than estimating.
    for (let i = 0; i < 4; i++) {
      await env.db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.kind, "build_session_debrief"));
      await drainQueue(deps);
    }
    const [s] = await env.db.select().from(stationSessions).where(eq(stationSessions.id, sessionId));
    expect(s!.status).toBe("complete");
    const http = new Http(env.base);
    await http.login("learner@example.test", "learner-dev-password-123");
    const debrief = (await http.req("GET", `/api/sessions/${sessionId}/debrief`)).json;
    expect(["unavailable", "partial"]).toContain(debrief.status);
    expect(debrief.pendingReason).toMatch(/nothing was estimated/);
  }, 90_000);
});
