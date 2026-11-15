import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaseVersion } from "@sim/contracts";
import { caseAssessments, caseAttempts, desc, eq, transcriptSegments } from "@sim/db";
import { fixtureMediaFile, loadFixtureCase } from "@sim/fixtures";
import { Http, PREFLIGHT_OK, TestClient, startTestEnv, type TestEnv } from "@sim/api/test-harness";
import { loadWorkerConfig } from "../src/config";
import { buildWorkerDeps } from "../src/deps";
import { drainQueue } from "../src/runner";
import { totpCode } from "../../api/src/auth/crypto";

let env: TestEnv;
let owner: Http;
let worker: ReturnType<typeof buildWorkerDeps>;

beforeAll(async () => {
  env = await startTestEnv();
  owner = new Http(env.base);
  await owner.login("owner@example.test", "owner-dev-password-123");
  worker = buildWorkerDeps(loadWorkerConfig({ NODE_ENV: "test", ALLOW_DEV_BASELINE_ASSESSOR: "true", DATABASE_URL: "unused", STORAGE_LOCAL_ROOT: "./var/test-storage" }), { db: env.db, providerFor: () => null, storage: env.deps.storage });
});
afterAll(async () => {
  await env?.close();
});

async function mfa(http: Http) {
  const r = await http.req("POST", "/api/auth/mfa/verify", { code: totpCode(env.owner.totp) });
  expect(r.status).toBe(200);
}

describe("owner console security", () => {
  it("requires the owner role and a verified second factor", async () => {
    expect((await owner.req("GET", "/api/owner/overview")).json.code).toBe("mfa_required");
    const learner = new Http(env.base);
    await learner.login("learner@example.test", "learner-dev-password-123");
    expect((await learner.req("GET", "/api/owner/overview")).status).toBe(403);
    await mfa(owner);
    expect((await owner.req("GET", "/api/owner/overview")).status).toBe(200);
  });
});

describe("case workflow", () => {
  it("imports a package as a draft that cannot be approved until placeholders are completed", async () => {
    const png = readFileSync(fixtureMediaFile("fixtures/fx-ring-lesion/mr-t1c-ax/4.png"));
    const sha = createHash("sha256").update(png).digest("hex");
    const manifest = {
      format: "sim-case-import@1",
      caseId: "imported-case-1",
      caseFamilyId: "imported-family-1",
      internalTitle: "Imported test case",
      sourceDiagnosis: null,
      diagnosticBasis: null,
      truthStatus: null,
      sourceReferences: [{ id: "src-1", kind: "image_file", sourceFileId: "abc123", locator: null, description: "test" }],
      assets: [{ id: "a1", kind: "still", modality: "MR", neutralLabel: "MRI brain, axial T1 post-contrast", sequence: "T1 post-contrast", plane: "axial", contrast: "intravenous", frames: [{ index: 0, file: "frames/a1/0.png", mimeType: "image/png", width: 512, height: 512, sha256: sha, byteSize: png.length }], derivation: { sourceReferenceId: "src-1", method: "original_embedded", notes: "", preservesDiagnosticContent: true, burnedInAnnotationsPresent: false }, dicom: null }],
      teachingText: null,
      privacyFindings: [],
      privacyStatus: "checked",
      notes: "",
    };
    const zip = zipSync({ "pkg/case-import.json": new TextEncoder().encode(JSON.stringify(manifest)), "pkg/frames/a1/0.png": new Uint8Array(png) });
    const res = await fetch(`${env.base}/api/owner/cases/import`, { method: "POST", headers: { "content-type": "application/zip", cookie: owner.cookie, "x-sim-csrf": "1" }, body: zip });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.versionId).toBe("imported-case-1@v1");
    expect(json.issues.some((i: { code: string }) => i.code === "draft_placeholder")).toBe(true);
    // The stored image streams back byte for byte through the owner preview (from S3 under pnpm test:s3).
    const preview = await fetch(`${env.base}/api/owner/case-versions/imported-case-1@v1/assets/a1/0`, { headers: { cookie: owner.cookie } });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-length")).toBe(String(png.length));
    expect(Buffer.compare(Buffer.from(await preview.arrayBuffer()), png)).toBe(0);
    // Tampered frame bytes are rejected.
    const bad = zipSync({ "pkg/case-import.json": new TextEncoder().encode(JSON.stringify({ ...manifest, caseId: "imported-case-2" })), "pkg/frames/a1/0.png": new Uint8Array([1, 2, 3]) });
    const r2 = await fetch(`${env.base}/api/owner/cases/import`, { method: "POST", headers: { "content-type": "application/zip", cookie: owner.cookie, "x-sim-csrf": "1" }, body: bad });
    expect((await r2.json()).code).toBe("digest_mismatch");
    // Submitting returns it to draft with issues (automated checks fail on placeholders).
    expect((await owner.req("POST", "/api/owner/case-versions/imported-case-1@v1/submit")).status).toBe(200);
    await drainQueue(worker);
    const d = (await owner.req("GET", "/api/owner/case-versions/imported-case-1@v1")).json;
    expect(d.status).toBe("draft");
    expect(d.reviews[0].reviewer).toBe("automated_checks");
  });

  it("binds approval to the reviewed content hash, enforces separate clearances, and versions changes", async () => {
    // The ring fixture was seeded as ready_for_owner.
    let d = (await owner.req("GET", "/api/owner/case-versions/fx-ring-lesion@v1")).json;
    expect(d.status).toBe("ready_for_owner");
    const stale = await owner.req("POST", "/api/owner/case-versions/fx-ring-lesion@v1/approve", { attestation: "I approve this clinical content.", notes: "", expectedClinicalContentHash: "0".repeat(64) });
    expect(stale.json.code).toBe("content_changed");
    const ok = await owner.req("POST", "/api/owner/case-versions/fx-ring-lesion@v1/approve", { attestation: "I approve this clinical content.", notes: "", expectedClinicalContentHash: d.hashes.clinicalContentHash });
    expect(ok.status).toBe(200);
    // Fixtures are publishable only where fixtures are allowed (dev/test); clinical cases need clearances.
    expect((await owner.req("POST", "/api/owner/case-versions/fx-ring-lesion@v1/publish")).status).toBe(200);
    d = (await owner.req("GET", "/api/owner/case-versions/fx-ring-lesion@v1")).json;
    expect(d.case.publishedVersionId).toBe("fx-ring-lesion@v1");
    // A revision is a new draft version; the published one is untouched.
    const nv = await owner.req("POST", "/api/owner/case-versions/fx-ring-lesion@v1/new-version");
    expect(nv.json.versionId).toBe("fx-ring-lesion@v2");
    const v2 = (await owner.req("GET", "/api/owner/case-versions/fx-ring-lesion@v2")).json;
    const edited = CaseVersion.parse({ ...v2.payload, questions: v2.payload.questions.map((q: { id: string; text: string }) => (q.id === "q-ddx" ? { ...q, text: "What is your differential diagnosis, in order of likelihood?" } : q)) });
    const save = await owner.req("PUT", "/api/owner/case-versions/fx-ring-lesion@v2", { rowVersion: v2.rowVersion, payload: edited });
    expect(save.status, JSON.stringify(save.json)).toBe(200);
    // Optimistic concurrency: a stale rowVersion is rejected.
    expect((await owner.req("PUT", "/api/owner/case-versions/fx-ring-lesion@v2", { rowVersion: v2.rowVersion, payload: edited })).json.code).toBe("stale_version");
    const v2b = (await owner.req("GET", "/api/owner/case-versions/fx-ring-lesion@v2")).json;
    expect(v2b.changeFromPrevious.kind).toBe("clinical");
    // Published versions cannot be edited in place.
    expect((await owner.req("PUT", "/api/owner/case-versions/fx-ring-lesion@v1", { rowVersion: 1, payload: edited })).json.code).toBe("not_draft");
  });

  it("clinical (non-fixture) cases cannot publish without rights and privacy clearance", async () => {
    const base = loadFixtureCase("fx-stroke-lmca");
    const clinical = { ...base, caseId: "clinical-gate-test", caseFamilyId: "clinical-gate-family", isDevelopmentFixture: false, clinicalTruth: { ...base.clinicalTruth, leakCanary: null }, assets: base.assets.map((a) => ({ ...a, isPlaceholder: false, derivation: { ...a.derivation, method: "original_embedded", preservesDiagnosticContent: true } })), clearances: { rights: null, privacy: null, externalAiProcessingAllowed: false }, source: { ...base.source, commercialRightsStatus: "unresolved", privacyStatus: "checked" } };
    const c = await owner.req("POST", "/api/owner/cases", { payload: clinical });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    await owner.req("POST", `/api/owner/case-versions/${c.json.versionId}/submit`);
    await drainQueue(worker);
    const d = (await owner.req("GET", `/api/owner/case-versions/${c.json.versionId}`)).json;
    expect(d.status).toBe("ready_for_owner");
    await owner.req("POST", `/api/owner/case-versions/${c.json.versionId}/approve`, { attestation: "I approve this clinical content.", notes: "", expectedClinicalContentHash: d.hashes.clinicalContentHash });
    expect((await owner.req("POST", `/api/owner/case-versions/${c.json.versionId}/publish`)).json.code).toBe("privacy_not_cleared");
    await owner.req("POST", `/api/owner/case-versions/${c.json.versionId}/clearances`, { privacy: { status: "cleared", basis: "checked by owner", restrictions: "" } });
    expect((await owner.req("POST", `/api/owner/case-versions/${c.json.versionId}/publish`)).json.code).toBe("rights_not_cleared");
    await owner.req("POST", `/api/owner/case-versions/${c.json.versionId}/clearances`, { rights: { status: "cleared", basis: "owner's own teaching material", restrictions: "" } });
    // Clearances do not invalidate the clinical approval.
    expect((await owner.req("POST", `/api/owner/case-versions/${c.json.versionId}/publish`)).status).toBe(200);
  });
});

describe("withdrawal, appeals and owner decisions", () => {
  it("withdrawal revokes media; appeals revise transcripts without overwriting history", async () => {
    const learner = new Http(env.base);
    await learner.login("learner@example.test", "learner-dev-password-123");
    const created = await learner.req("POST", "/api/sessions", { profileVersionId: "abr-dr-neuro-oral@2026-11-15.1", mode: "practice", demo: true });
    const sessionId = created.json.sessionId as string;
    await learner.req("POST", `/api/sessions/${sessionId}/preflight`, PREFLIGHT_OK);
    const t = await learner.req("POST", `/api/sessions/${sessionId}/ws-ticket`);
    const client = new TestClient();
    await client.connect(`${env.base.replace("http", "ws")}/ws`, t.json.ticket);
    client.send({ type: "start_station", commandId: client.nextId() });
    const vc = await client.waitFor((m) => m.type === "viewer_command");
    await client.waitFor((m) => m.type === "examiner_utterance");
    client.say("There is no intracranial hemorrhage. Early hypodensity in the right MCA territory. That's all.");
    await client.waitFor((m) => m.type === "examiner_utterance", 8000, client.messages.length);
    client.send({ type: "request_end_station", commandId: client.nextId() });
    await client.waitFor((m) => m.type === "station_ended");
    client.close();
    await drainQueue(worker);

    const [attempt] = await env.db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, sessionId));
    const [a1] = await env.db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, attempt!.id));
    expect(a1!.payload.elementResults.find((e) => e.elementId === "e-hypodensity")!.status).toBe("incorrect"); // "right" reversed
    const seg = (await env.db.select().from(transcriptSegments).where(eq(transcriptSegments.caseAttemptId, attempt!.id))).find((s) => s.text.includes("right MCA"))!;

    // Learner appeals the transcription ("right" was misheard).
    const ap = await learner.req("POST", "/api/appeals", { caseAttemptId: attempt!.id, assessmentId: a1!.id, kind: "transcript", statement: "I said left MCA territory, not right.", transcriptCorrections: [{ segmentId: seg.id, proposedText: seg.text.replace("right", "left") }] });
    expect(ap.status, JSON.stringify(ap.json)).toBe(200);
    const res = await owner.req("POST", `/api/owner/appeals/${ap.json.appealId}/resolve`, { decision: "revised", resolution: "Audio review supports 'left'.", transcriptCorrections: [{ segmentId: seg.id, correctedText: seg.text.replace("right", "left") }], reassess: true });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    await drainQueue(worker);
    const segs = await env.db.select().from(transcriptSegments).where(eq(transcriptSegments.caseAttemptId, attempt!.id));
    expect(segs.find((s) => s.id === seg.id)!.status).toBe("superseded");
    expect(segs.find((s) => s.supersedesSegmentId === seg.id)!.text).toContain("left MCA");
    const versions = await env.db.select().from(caseAssessments).where(eq(caseAssessments.caseAttemptId, attempt!.id)).orderBy(desc(caseAssessments.assessmentVersion));
    expect(versions.length).toBe(2);
    expect(versions[0]!.supersedesId).toBe(versions[1]!.id);
    expect(versions[0]!.payload.elementResults.find((e) => e.elementId === "e-hypodensity")!.status).toBe("demonstrated");
    expect(versions[1]!.payload.elementResults.find((e) => e.elementId === "e-hypodensity")!.status).toBe("incorrect"); // history kept

    // Owner decision on an element creates yet another version.
    const decision = await owner.req("POST", `/api/owner/case-attempts/${attempt!.id}/resolve-element`, { elementId: "e-dense-mca", status: "not_assessable", rationale: "Placeholder image does not show the vessel adequately." });
    expect(decision.status, JSON.stringify(decision.json)).toBe(200);
    expect(decision.json.version).toBe(3);

    // Withdrawal revokes media access immediately (including replay).
    const handle = vc.type === "viewer_command" ? vc.command.newAssets[0]!.handle : "";
    expect((await learner.req("GET", `/api/media/${handle}/0`)).status).toBe(200);
    const w = await owner.req("POST", "/api/owner/cases/fx-stroke-lmca/withdraw", { reason: "Test withdrawal of unsafe content" });
    expect(w.json.affectedAttempts).toBeGreaterThan(0);
    expect((await learner.req("GET", `/api/media/${handle}/0`)).status).toBe(404);

    // Withdrawn content is never selected for a new examination.
    for (let i = 0; i < 3; i++) {
      const next = await learner.req("POST", "/api/sessions", { profileVersionId: "abr-dr-neuro-oral@2026-11-15.1", mode: "exam", inputMode: "voice" });
      expect(next.status, JSON.stringify(next.json)).toBe(200);
      const bound = await env.db.select({ v: caseAttempts.caseVersionId }).from(caseAttempts).where(eq(caseAttempts.sessionId, next.json.sessionId as string));
      expect(bound.length).toBeGreaterThan(0);
      expect(bound.some((b) => b.v.startsWith("fx-stroke-lmca@"))).toBe(false);
    }
  }, 60_000);
});
