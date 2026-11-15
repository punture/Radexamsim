import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "../src/testing";
import {
  appendEvent,
  caseAttempts,
  caseVersions,
  cases,
  claimJob,
  completeJob,
  createDb,
  enqueue,
  eq,
  examForms,
  examProfiles,
  failJob,
  jobs,
  ownerReviewItems,
  redactError,
  sessionEvents,
  sql,
  stationSessions,
  transcriptSegments,
  usageLedger,
  users,
  type Db,
} from "../src";
import { ABR_NEURO_PROFILE } from "@sim/clinical-content";
import { pgErrorOf } from "../src";

async function rejectsWithDb(p: Promise<unknown>, re: RegExp): Promise<void> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, "expected the database to reject the statement").not.toBeNull();
  expect(pgErrorOf(err)?.message ?? String(err)).toMatch(re);
}

let db: Db;
let drop: () => Promise<void>;
let sessionId: string;
let userId: string;

beforeAll(async () => {
  const t = await createTestDatabase();
  drop = t.drop;
  db = createDb(t.url);
  const [u] = await db.insert(users).values({ email: "learner@example.test", authProvider: "local" }).returning();
  userId = u!.id;
  await db.insert(examProfiles).values({ versionId: ABR_NEURO_PROFILE.versionId, profileId: ABR_NEURO_PROFILE.profileId, payload: ABR_NEURO_PROFILE });
  const [f] = await db.insert(examForms).values({ profileVersionId: ABR_NEURO_PROFILE.versionId, mode: "exam", caseVersionIds: [], seed: "s" }).returning();
  const [s] = await db
    .insert(stationSessions)
    .values({
      userId,
      profileVersionId: ABR_NEURO_PROFILE.versionId,
      mode: "exam",
      formId: f!.id,
      status: "ready",
      clock: { durationMs: 1_500_000, accumulatedActiveMs: 0, runningSinceMs: null, pauses: [] },
      caseCount: 1,
      inputMode: "voice",
      speechConfig: { asr: "browser", tts: "browser" },
      containsFixtures: true,
    })
    .returning();
  sessionId = s!.id;
});

afterAll(async () => {
  await db.$client.end();
  await drop();
});

const cv = { profileVersionId: ABR_NEURO_PROFILE.versionId, caseVersionId: null, rubricVersionId: null };

describe("session events", () => {
  it("assigns gap-free, unique sequence numbers under concurrency", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        db.transaction((tx) => appendEvent(tx, { sessionId, caseAttemptId: null, type: "connection.opened", sessionClockMs: i, payload: { i }, contentVersions: cv })),
      ),
    );
    const rows = await db.select({ seq: sessionEvents.seq }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId));
    const seqs = rows.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
  it("are append-only", async () => {
    await rejectsWithDb(db.update(sessionEvents).set({ type: "tampered" }).where(eq(sessionEvents.sessionId, sessionId)), /append-only/);
  });
  it("roll back with the transaction that failed", async () => {
    const before = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId));
    await expect(
      db.transaction(async (tx) => {
        await appendEvent(tx, { sessionId, caseAttemptId: null, type: "session.started", sessionClockMs: 0, payload: {}, contentVersions: cv });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const after = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId));
    expect(after.length).toBe(before.length);
  });
});

describe("immutability", () => {
  it("forbids editing original transcript text (revisions are new rows)", async () => {
    const [seg] = await db
      .insert(transcriptSegments)
      .values({ sessionId, source: "dev_injected", text: "left MCA infarct", startMs: 0, endMs: 1000, provider: { name: "test", model: null, requestId: null } })
      .returning();
    await rejectsWithDb(db.update(transcriptSegments).set({ text: "right MCA infarct" }).where(eq(transcriptSegments.id, seg!.id)), /immutable/);
    await db.update(transcriptSegments).set({ status: "superseded" }).where(eq(transcriptSegments.id, seg!.id));
  });
  it("keeps a case attempt bound to its original case version when the owner revises the case", async () => {
    await db.insert(cases).values({ caseId: "case-binding", caseFamilyId: "family-binding" });
    const version = (n: number) => ({ versionId: `case-binding@v${n}`, caseId: "case-binding", versionNumber: n, payload: {} as never, publicationStatus: "published" as const, clinicalContentHash: `h${n}`, rubricHash: `r${n}`, assetsHash: `a${n}`, isFixture: true, createdBy: "test" });
    await db.insert(caseVersions).values([version(1), version(2)]);
    const [at] = await db.insert(caseAttempts).values({ sessionId, userId, caseVersionId: "case-binding@v1", caseFamilyId: "family-binding", ordinal: 0 }).returning();
    await rejectsWithDb(db.update(caseAttempts).set({ caseVersionId: "case-binding@v2" }).where(eq(caseAttempts.id, at!.id)), /binding is immutable/);
    // Progress fields remain writable.
    await db.update(caseAttempts).set({ status: "active", startedAtMs: 1000 }).where(eq(caseAttempts.id, at!.id));
    const [row] = await db.select().from(caseAttempts).where(eq(caseAttempts.id, at!.id));
    expect(row!.caseVersionId).toBe("case-binding@v1");
  });
  it("forbids updating or deleting usage ledger entries", async () => {
    const [row] = await db.insert(usageLedger).values({ userId, kind: "allot", minutes: 60, idempotencyKey: "allot:test", reason: "test", actor: "test" }).returning();
    await rejectsWithDb(db.update(usageLedger).set({ minutes: 600 }).where(eq(usageLedger.id, row!.id)), /immutable/);
    await rejectsWithDb(db.delete(usageLedger).where(eq(usageLedger.id, row!.id)), /immutable/);
    await rejectsWithDb(db.insert(usageLedger).values({ userId, kind: "allot", minutes: 60, idempotencyKey: "allot:test", reason: "dup", actor: "test" }), /duplicate key/);
  });
});

describe("durable job queue", () => {
  it("deduplicates enqueues and claims each job once", async () => {
    const a = await enqueue(db, { kind: "assess_case_attempt", payload: { caseAttemptId: "x" }, dedupeKey: "assess:x" });
    const b = await enqueue(db, { kind: "assess_case_attempt", payload: { caseAttemptId: "x" }, dedupeKey: "assess:x" });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const [j1, j2] = await Promise.all([claimJob(db, "w1", ["assess_case_attempt"]), claimJob(db, "w2", ["assess_case_attempt"])]);
    const claimed = [j1, j2].filter(Boolean);
    expect(claimed.length).toBe(1);
    await completeJob(db, claimed[0]!.id, { ok: true });
    expect(await claimJob(db, "w1", ["assess_case_attempt"])).toBeNull();
  });
  it("is transactional with the state change that enqueues it", async () => {
    await expect(
      db.transaction(async (tx) => {
        await enqueue(tx, { kind: "build_session_debrief", payload: {}, dedupeKey: "debrief:rolled-back" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const rows = await db.select().from(jobs).where(eq(jobs.dedupeKey, "debrief:rolled-back"));
    expect(rows.length).toBe(0);
  });
  it("retries with backoff and dead-letters after max attempts, raising an owner item", async () => {
    await enqueue(db, { kind: "data_export", payload: {}, dedupeKey: "export:1", maxAttempts: 2 });
    let job = await claimJob(db, "w1", ["data_export"]);
    expect(await failJob(db, job!, new Error("provider down sk-ant-abc123secret"))).toBe("retry");
    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, job!.id));
    job = await claimJob(db, "w1", ["data_export"]);
    expect(job!.attempts).toBe(2);
    expect(await failJob(db, job!, new Error("still down"))).toBe("dead");
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job!.id));
    expect(row!.status).toBe("dead");
    const items = await db.select().from(ownerReviewItems).where(eq(ownerReviewItems.dedupeKey, `dead-job:${job!.id}`));
    expect(items.length).toBe(1);
  });
  it("requeues jobs whose lease expired", async () => {
    await enqueue(db, { kind: "retention_sweep", payload: {}, dedupeKey: "sweep:1" });
    const job = await claimJob(db, "w-dead", ["retention_sweep"]);
    await db.execute(sql`UPDATE jobs SET locked_at = now() - interval '1 hour' WHERE id = ${job!.id}`);
    const again = await claimJob(db, "w-new", ["retention_sweep"], 60_000);
    expect(again!.id).toBe(job!.id);
    expect(again!.lockedBy).toBe("w-new");
  });
  it("redacts credentials from stored errors", () => {
    expect(redactError(new Error("bad key sk_live_abc and Bearer eyJhbGci.x.y"))).not.toMatch(/sk_live_abc|eyJhbGci/);
  });
});
