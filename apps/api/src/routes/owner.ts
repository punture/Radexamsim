import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CaseVersion, ExamProfileVersion, RatingLevel } from "@sim/contracts";
import { ownerAdjust } from "@sim/billing";
import {
  and,
  appeals,
  caseAssessments,
  caseAttempts,
  caseVersions,
  cases,
  contentRequests,
  count,
  desc,
  eq,
  examProfiles,
  gte,
  jobs,
  metricSamples,
  modelCalls,
  ownerReviewItems,
  requeueDead,
  sessionEvents,
  sql,
  stationSessions,
  systemConfig,
  users,
} from "@sim/db";
import type { Deps } from "../deps";
import { HttpError, IdParam, badRequest, notFound, route } from "../http";
import { audit } from "../services/audit";
import { getSwitches } from "../services/content";
import { approve, importPackage, loadVersionRow, newVersion, publish, requestChanges, retire, saveDraft, submitForChecks, updateClearances, versionDetail, withdraw } from "../services/owner-cases";
import { ownerAttemptView, resolveAppeal, resolveElement } from "../services/owner-assessments";
import { createStationSession } from "../services/sessions";

const VersionParam = z.object({ versionId: z.string().min(3).max(100) });
const Clearance = z.object({ status: z.enum(["unresolved", "cleared", "restricted", "withdrawn"]), basis: z.string().max(1000), restrictions: z.string().max(1000) });

/**
 * Owner console API (spec §3, §16). Every route requires the owner role AND a verified
 * second factor (enforced in the route helper). The owner sees a prioritized exception
 * queue; routine items are batched into a digest.
 */
export function ownerRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps;
  const owner = { tags: ["owner"], auth: "owner" as const };

  // ------------------------------------------------------------------ queue
  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/overview",
    summary: "Owner overview: queue counts, case pipeline, content requests, dead jobs",
    handler: async () => {
      const queue = await db.select({ kind: ownerReviewItems.kind, priority: ownerReviewItems.priority, n: count() }).from(ownerReviewItems).where(eq(ownerReviewItems.status, "open")).groupBy(ownerReviewItems.kind, ownerReviewItems.priority);
      const pipeline = await db.select({ status: caseVersions.publicationStatus, fixture: caseVersions.isFixture, n: count() }).from(caseVersions).groupBy(caseVersions.publicationStatus, caseVersions.isFixture);
      const requests = await db.select({ status: contentRequests.status, n: count() }).from(contentRequests).groupBy(contentRequests.status);
      const dead = await db.select({ n: count() }).from(jobs).where(eq(jobs.status, "dead"));
      return { queue, pipeline, contentRequests: requests, deadJobs: dead[0]?.n ?? 0 };
    },
  });

  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/review-items",
    summary: "Exception queue (filter by status/priority/kind)",
    query: z.object({ status: z.enum(["open", "resolved", "dismissed"]).default("open"), priority: z.enum(["urgent", "normal", "digest"]).optional(), kind: z.string().optional() }),
    handler: async ({ query }) => {
      const rows = await db.select().from(ownerReviewItems).where(eq(ownerReviewItems.status, query.status)).orderBy(desc(ownerReviewItems.createdAt)).limit(500);
      const rank = { urgent: 0, normal: 1, digest: 2 } as const;
      return rows
        .filter((r) => (!query.priority || r.priority === query.priority) && (!query.kind || r.kind === query.kind))
        .sort((a, b) => rank[a.priority] - rank[b.priority])
        .map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null }));
    },
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/review-items/:id/resolve",
    summary: "Resolve or dismiss a queue item",
    params: IdParam,
    body: z.object({ status: z.enum(["resolved", "dismissed"]), resolution: z.string().min(1).max(2000) }),
    handler: async ({ auth, params, body }) => {
      const r = await db.update(ownerReviewItems).set({ status: body.status, resolution: body.resolution, resolvedAt: new Date(), resolvedBy: auth!.userId }).where(eq(ownerReviewItems.id, params.id)).returning({ id: ownerReviewItems.id });
      if (!r[0]) throw notFound("review item");
      await audit(db, auth!.userId, "review_item.resolved", "review_item", params.id, { status: body.status });
      return { ok: true };
    },
  });

  // ------------------------------------------------------------------ cases
  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/cases",
    summary: "Cases with their versions and status",
    handler: async () => {
      const rows = await db.select({ v: caseVersions, c: cases }).from(caseVersions).innerJoin(cases, eq(cases.caseId, caseVersions.caseId)).orderBy(caseVersions.caseId, desc(caseVersions.versionNumber));
      const byCase = new Map<string, unknown[]>();
      for (const { v, c } of rows) {
        const list = byCase.get(c.caseId) ?? [];
        const issues = (v.validationIssues as { severity: string }[]) ?? [];
        list.push({
          versionId: v.versionId,
          versionNumber: v.versionNumber,
          status: v.publicationStatus,
          internalTitle: v.payload.internalTitle,
          isFixture: v.isFixture,
          errors: issues.filter((i) => i.severity === "error").length,
          warnings: issues.filter((i) => i.severity === "warning").length,
          updatedAt: v.updatedAt.toISOString(),
          isPublished: c.publishedVersionId === v.versionId,
          withdrawn: !!c.withdrawnAt,
          anatomy: v.payload.tags.anatomy,
          difficulty: v.payload.difficulty,
        });
        byCase.set(c.caseId, list);
      }
      return [...byCase.entries()].map(([caseId, versions]) => ({ caseId, versions }));
    },
  });

  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/case-versions/:versionId",
    summary: "Full case version for review: content, hashes, validation, critiques, gate, diff",
    params: VersionParam,
    handler: async ({ params }) => versionDetail(deps, params.versionId),
  });

  route(app, {
    ...owner,
    method: "PUT",
    url: "/api/owner/case-versions/:versionId",
    summary: "Save a draft (optimistic concurrency via rowVersion)",
    params: VersionParam,
    body: z.object({ rowVersion: z.number().int(), payload: z.unknown() }),
    handler: async ({ auth, params, body }) => saveDraft(deps, auth!.userId, params.versionId, body.payload, body.rowVersion),
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/cases",
    summary: "Create a draft case from a full case JSON",
    body: z.object({ payload: z.unknown() }),
    handler: async ({ auth, body }) => {
      const parsed = CaseVersion.safeParse(body.payload);
      if (!parsed.success) throw new HttpError(400, "invalid_case", "the case does not match the schema", parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })));
      const cv: CaseVersion = { ...parsed.data, publicationStatus: "draft", ownerApproval: null, versionNumber: 1, versionId: `${parsed.data.caseId}@v1`, previousVersionId: null };
      const [exists] = await db.select().from(cases).where(eq(cases.caseId, cv.caseId));
      if (exists) throw new HttpError(409, "case_exists", "case id already exists");
      const { computeContentHashes, validateCaseVersion } = await import("@sim/clinical-content");
      const v = validateCaseVersion(cv);
      await db.transaction(async (tx) => {
        await tx.insert(cases).values({ caseId: cv.caseId, caseFamilyId: cv.caseFamilyId });
        await tx.insert(caseVersions).values({ versionId: cv.versionId, caseId: cv.caseId, versionNumber: 1, payload: cv, publicationStatus: "draft", ...computeContentHashes(cv), isFixture: cv.isDevelopmentFixture, validationIssues: v.ok ? v.warnings : v.issues, createdBy: auth!.userId });
      });
      return { versionId: cv.versionId };
    },
  });

  app.addContentTypeParser("application/zip", { parseAs: "buffer", bodyLimit: 200 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/cases/import",
    summary: "Import a sim-case-import@1 package (zip) produced by tools/ingestion as a DRAFT",
    rateLimit: { max: 20, timeWindow: "1 hour" },
    handler: async ({ auth, req }) => {
      if (!Buffer.isBuffer(req.body)) throw badRequest("zip_required", "send the package as application/zip");
      return importPackage(deps, auth!.userId, new Uint8Array(req.body));
    },
  });

  const action = (url: string, summary: string, fn: (ownerId: string, versionId: string, body: never) => Promise<unknown>, body?: z.ZodType) =>
    route(app, { ...owner, method: "POST", url, summary, params: VersionParam, ...(body ? { body } : {}), handler: async ({ auth, params, body: b }) => fn(auth!.userId, params.versionId, b as never) });
  action("/api/owner/case-versions/:versionId/new-version", "Create a new draft version (revision)", (o, v) => newVersion(deps, o, v));
  action("/api/owner/case-versions/:versionId/submit", "Submit a draft for automated checks", (o, v) => submitForChecks(deps, o, v));
  action("/api/owner/case-versions/:versionId/approve", "Owner clinical approval bound to the reviewed content hash", (o, v, b: { attestation: string; notes: string; expectedClinicalContentHash: string }) => approve(deps, o, v, b), z.object({ attestation: z.string().min(10).max(500), notes: z.string().max(2000).default(""), expectedClinicalContentHash: z.string().regex(/^[a-f0-9]{64}$/) }));
  action("/api/owner/case-versions/:versionId/request-changes", "Return a version to draft with notes", (o, v, b: { notes: string }) => requestChanges(deps, o, v, b.notes), z.object({ notes: z.string().min(1).max(2000) }));
  action("/api/owner/case-versions/:versionId/clearances", "Record rights/privacy clearance (separate from clinical approval)", (o, v, b: Parameters<typeof updateClearances>[3]) => updateClearances(deps, o, v, b), z.object({ rights: Clearance.optional(), privacy: Clearance.optional(), externalAiProcessingAllowed: z.boolean().optional() }));
  action("/api/owner/case-versions/:versionId/publish", "Publish an approved version (gates: approval hash, rights, privacy)", (o, v) => publish(deps, o, v));
  action("/api/owner/case-versions/:versionId/retire", "Retire a published version (no new selection)", (o, v) => retire(deps, o, v));
  action("/api/owner/case-versions/:versionId/critique", "Run LLM clinical and rubric critics (if permitted)", async (o, v) => {
    await db.insert(jobs).values([
      { kind: "case_llm_critique", payload: { versionId: v, focus: "clinical" }, dedupeKey: `critique:clinical:${v}:${Date.now()}` },
      { kind: "case_llm_critique", payload: { versionId: v, focus: "rubric" }, dedupeKey: `critique:rubric:${v}:${Date.now()}` },
    ]);
    await audit(db, o, "case.critique_requested", "case_version", v);
    return { queued: 2 };
  });
  action("/api/owner/case-versions/:versionId/author", "Ask the LLM case author to draft stages, questions and rubric (drafts only)", async (o, v, b: { ownerNotes: string; teachingText: string }) => {
    const row = await loadVersionRow(db, v);
    if (row.publicationStatus !== "draft") throw new HttpError(409, "not_draft", "only drafts can be authored");
    await db.insert(jobs).values({ kind: "case_llm_author", payload: { versionId: v, ownerNotes: b.ownerNotes, teachingText: b.teachingText }, dedupeKey: `author:${v}:${Date.now()}` });
    await audit(db, o, "case.author_requested", "case_version", v);
    return { queued: 1 };
  }, z.object({ ownerNotes: z.string().max(20_000), teachingText: z.string().max(50_000).default("") }));
  action("/api/owner/case-versions/:versionId/preview", "Start an owner preview session for this version (excluded from learner progress and billing)", async (o, v) => {
    const row = await loadVersionRow(db, v);
    const profile = row.payload.eligibleProfileVersions[0]!.replace("@*", "");
    const [p] = await db.select().from(examProfiles).where(sql`${examProfiles.profileId} = ${profile} OR ${examProfiles.versionId} = ${row.payload.eligibleProfileVersions[0]!}`).limit(1);
    if (!p) throw badRequest("no_profile", "no eligible profile found");
    const [ownerRow] = await db.select().from(users).where(eq(users.id, o));
    return createStationSession(deps, { userId: o, email: ownerRow!.email, role: "owner", mfa: true, ownerMfaRequired: false, via: "cookie", authSessionId: null }, { profileVersionId: p.versionId, mode: "owner_preview", inputMode: "voice", previewCaseVersionIds: [v] });
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/cases/:caseId/withdraw",
    summary: "Withdraw unsafe/unauthorized content: stop selection and revoke media access",
    params: z.object({ caseId: z.string().min(1).max(80) }),
    body: z.object({ reason: z.string().min(5).max(1000) }),
    handler: async ({ auth, params, body }) => withdraw(deps, auth!.userId, params.caseId, body.reason),
  });

  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/case-versions/:versionId/assets/:assetId/:frame",
    summary: "Owner preview of any version's images (drafts included)",
    params: z.object({ versionId: z.string(), assetId: z.string(), frame: z.coerce.number().int().min(0) }),
    handler: async ({ params, reply }) => {
      const row = await loadVersionRow(db, params.versionId);
      const a = row.payload.assets.find((x) => x.id === params.assetId);
      const f = a?.frames[params.frame];
      if (!a || !f) throw notFound("asset");
      const { stream, size } = await deps.storage.stream("derivatives", f.storageKey);
      reply.header("content-type", f.mimeType).header("content-length", String(size)).header("cache-control", "private, no-store").header("x-content-type-options", "nosniff");
      return reply.send(stream);
    },
  });

  // ------------------------------------------------------------------ attempts, disputes, appeals
  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/case-attempts/:id",
    summary: "Owner view of an attempt: transcript revisions, prompts, events, passes, versions",
    params: IdParam,
    handler: async ({ params }) => ownerAttemptView(deps, params.id),
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/case-attempts/:id/resolve-element",
    summary: "Owner decision on a disputed/uncertain element (new assessment version)",
    params: IdParam,
    body: z.object({ elementId: z.string(), status: z.enum(["demonstrated", "partially_demonstrated", "incorrect", "not_demonstrated", "not_assessable", "uncertain"]), rationale: z.string().min(5).max(2000), globalLevel: RatingLevel.nullable().optional() }),
    handler: async ({ auth, params, body }) => resolveElement(deps, auth!.userId, params.id, body),
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/case-attempts/:id/reassess",
    summary: "Queue a versioned reassessment (forced second pass)",
    params: IdParam,
    body: z.object({ reason: z.string().min(3).max(500) }),
    handler: async ({ auth, params, body }) => {
      await db.insert(jobs).values({ kind: "reassess_after_appeal", payload: { caseAttemptId: params.id, reason: body.reason }, dedupeKey: `reassess:owner:${params.id}:${Date.now()}` });
      await audit(db, auth!.userId, "assessment.reassess_requested", "case_attempt", params.id, { reason: body.reason });
      return { queued: true };
    },
  });

  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/appeals",
    summary: "Learner appeals",
    handler: async () => (await db.select().from(appeals).orderBy(desc(appeals.createdAt)).limit(200)).map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), resolvedAt: a.resolvedAt?.toISOString() ?? null })),
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/appeals/:id/resolve",
    summary: "Resolve an appeal (transcript revisions + versioned reassessment; history preserved)",
    params: IdParam,
    body: z.object({ decision: z.enum(["upheld", "revised", "rejected"]), resolution: z.string().min(5).max(2000), transcriptCorrections: z.array(z.object({ segmentId: z.uuid(), correctedText: z.string().min(1).max(4000) })).max(50).default([]), reassess: z.boolean().default(false) }),
    handler: async ({ auth, params, body }) => resolveAppeal(deps, auth!.userId, params.id, body),
  });

  // ------------------------------------------------------------------ content
  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/content-requests",
    summary: "Explicit content requests (missing cases are requests, never fabricated cases)",
    handler: async () => db.select().from(contentRequests).orderBy(contentRequests.slot),
  });
  route(app, {
    ...owner,
    method: "PATCH",
    url: "/api/owner/content-requests/:id",
    summary: "Update a content request",
    params: IdParam,
    body: z.object({ status: z.enum(["open", "in_progress", "fulfilled", "withdrawn"]), caseId: z.string().nullable().optional() }),
    handler: async ({ params, body }) => {
      await db.update(contentRequests).set({ status: body.status, caseId: body.caseId ?? null }).where(eq(contentRequests.id, params.id));
      return { ok: true };
    },
  });

  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/coverage",
    summary: "Published case coverage (fixtures excluded from production counts)",
    handler: async () => {
      const rows = await db.select({ v: caseVersions }).from(cases).innerJoin(caseVersions, eq(caseVersions.versionId, cases.publishedVersionId));
      const prod = rows.map((r) => r.v).filter((v) => !v.isFixture);
      const tally = (f: (v: (typeof prod)[number]) => string[]) => {
        const out: Record<string, number> = {};
        for (const v of prod) for (const k of f(v)) out[k] = (out[k] ?? 0) + 1;
        return out;
      };
      return {
        publishedClinicalCases: prod.length,
        publishedFixtures: rows.length - prod.length,
        byAnatomy: tally((v) => v.payload.tags.anatomy),
        byPathology: tally((v) => v.payload.tags.pathology),
        byDifficulty: tally((v) => [v.payload.difficulty]),
        byTrack: tally((v) => [v.payload.track]),
        urgent: prod.filter((v) => v.payload.clinicalTruth.urgency !== "routine").length,
        differentialOnly: prod.filter((v) => v.payload.source.truthStatus === "differential_only").length,
        stackBased: prod.filter((v) => v.payload.assets.some((a) => a.kind === "stack" || a.kind === "dicom_stack")).length,
      };
    },
  });

  // ------------------------------------------------------------------ metrics
  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/metrics",
    summary: "Cost, latency, quality and exception metrics (last N days)",
    query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
    handler: async ({ query }) => {
      const since = new Date(Date.now() - query.days * 86400_000);
      const calls = await db.select().from(modelCalls).where(gte(modelCalls.createdAt, since));
      const byRole = new Map<string, typeof calls>();
      for (const c of calls) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c]);
      const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : null);
      const models = [...byRole.entries()].map(([role, cs]) => ({
        role,
        calls: cs.length,
        okRate: cs.filter((c) => c.status === "ok").length / cs.length,
        p50LatencyMs: pct(cs.map((c) => c.latencyMs), 0.5),
        p95LatencyMs: pct(cs.map((c) => c.latencyMs), 0.95),
        inputTokens: cs.reduce((a, c) => a + c.inputTokens, 0),
        outputTokens: cs.reduce((a, c) => a + c.outputTokens, 0),
        estimatedCostUsd: Math.round(cs.reduce((a, c) => a + c.estimatedCostUsd, 0) * 100) / 100,
      }));
      const sessions = await db.select().from(stationSessions).where(gte(stationSessions.createdAt, since));
      const completed = sessions.filter((s) => s.status === "complete" && s.mode !== "owner_preview");
      const totalCost = calls.reduce((a, c) => a + c.estimatedCostUsd, 0);
      // Live latency from durable events: candidate turn end -> next examiner utterance planned; viewer command -> render ack.
      const evs = await db.select({ sessionId: sessionEvents.sessionId, type: sessionEvents.type, t: sessionEvents.serverTime, payload: sessionEvents.payload }).from(sessionEvents).where(and(gte(sessionEvents.serverTime, since), sql`${sessionEvents.type} in ('policy.decision','examiner.utterance_planned','viewer.command_sent','viewer.rendered','examiner.audio_interrupted','session.technical_pause')`));
      const decisionLatency = evs.filter((e) => e.type === "policy.decision").map((e) => Number((e.payload as { latencyMs?: number }).latencyMs ?? 0));
      const sent = new Map<string, number>();
      const ackLat: number[] = [];
      for (const e of evs) {
        const cid = (e.payload as { commandId?: string }).commandId;
        if (!cid) continue;
        if (e.type === "viewer.command_sent") sent.set(cid, e.t.getTime());
        else if (e.type === "viewer.rendered" && sent.has(cid)) ackLat.push(e.t.getTime() - sent.get(cid)!);
      }
      const assessmentsRows = await db.select({ provisional: caseAssessments.provisional, withheld: caseAssessments.withheld, kind: caseAssessments.assessorKind, payload: caseAssessments.payload }).from(caseAssessments).where(gte(caseAssessments.createdAt, since));
      const openItems = await db.select({ n: count() }).from(ownerReviewItems).where(and(eq(ownerReviewItems.status, "open"), gte(ownerReviewItems.createdAt, since)));
      const samples = await db.select().from(metricSamples).where(gte(metricSamples.createdAt, since));
      return {
        days: query.days,
        models,
        cost: { totalEstimatedUsd: Math.round(totalCost * 100) / 100, completedStations: completed.length, perCompletedStationUsd: completed.length ? Math.round((totalCost / completed.length) * 100) / 100 : null, note: "Estimates from token usage and configured prices; reconcile against provider invoices." },
        live: {
          examinerDecisionP50Ms: pct(decisionLatency, 0.5),
          examinerDecisionP95Ms: pct(decisionLatency, 0.95),
          imageAckP50Ms: pct(ackLat, 0.5),
          imageAckP95Ms: pct(ackLat, 0.95),
          interruptions: evs.filter((e) => e.type === "examiner.audio_interrupted").length,
          technicalPauses: evs.filter((e) => e.type === "session.technical_pause").length,
          note: "Decision latency excludes speech synthesis and network; end-of-turn-to-audible-response requires client timing samples.",
        },
        assessments: {
          total: assessmentsRows.length,
          provisionalRate: assessmentsRows.length ? assessmentsRows.filter((a) => a.provisional).length / assessmentsRows.length : null,
          withheldRate: assessmentsRows.length ? assessmentsRows.filter((a) => a.withheld).length / assessmentsRows.length : null,
          disputedElements: assessmentsRows.reduce((a, r) => a + r.payload.disputedElementIds.length, 0),
          byAssessorKind: assessmentsRows.reduce<Record<string, number>>((acc, r) => ((acc[r.kind] = (acc[r.kind] ?? 0) + 1), acc), {}),
        },
        ownerExceptionsOpened: openItems[0]?.n ?? 0,
        sessions: { total: sessions.length, completed: completed.length, invalidated: sessions.filter((s) => s.outcome === "invalidated_technical").length },
        clientSamples: samples.length,
      };
    },
  });

  // ------------------------------------------------------------------ configuration
  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/config",
    summary: "Kill switches, assessment policy, demo cases, profiles",
    handler: async () => {
      const rows = await db.select().from(systemConfig);
      const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
      const profiles = await db.select().from(examProfiles);
      return {
        switches: await getSwitches(db),
        assessmentPolicy: get("assessment_policy") ?? { secondPass: "always", randomSampleRate: 0.2, shareExtractionWithB: false },
        demoCaseIds: get("demo_case_ids") ?? [],
        profiles: profiles.map((p) => ({ versionId: p.versionId, active: p.active, displayName: p.payload.displayName, verification: p.payload.verification })),
        providers: { llm: deps.llm?.name ?? null, examinerModel: deps.examinerModel, asr: deps.speech.asr, tts: deps.speech.tts },
      };
    },
  });

  route(app, {
    ...owner,
    method: "PUT",
    url: "/api/owner/config/switches",
    summary: "Kill switches for model roles, voice providers and cases",
    body: z.object({ examinerLlmDisabled: z.boolean(), assessmentLlmDisabled: z.boolean(), serverTtsDisabled: z.boolean(), serverAsrDisabled: z.boolean(), disabledCaseIds: z.array(z.string()).max(500) }),
    handler: async ({ auth, body }) => {
      await db.insert(systemConfig).values({ key: "switches", value: body, updatedBy: auth!.userId }).onConflictDoUpdate({ target: systemConfig.key, set: { value: body, updatedBy: auth!.userId, updatedAt: new Date() } });
      await audit(db, auth!.userId, "config.switches", "config", "switches", body);
      return { ok: true };
    },
  });

  route(app, {
    ...owner,
    method: "PUT",
    url: "/api/owner/config/assessment-policy",
    summary: "Second-pass policy; reducing coverage requires explicit acknowledgement",
    body: z.object({ secondPass: z.enum(["always", "risk_based"]), randomSampleRate: z.number().min(0).max(1), shareExtractionWithB: z.boolean(), acknowledgeReducedCoverage: z.boolean().default(false) }),
    handler: async ({ auth, body }) => {
      if (body.secondPass === "risk_based" && !body.acknowledgeReducedCoverage) {
        throw new HttpError(409, "acknowledgement_required", "Reducing second-pass coverage requires explicit acknowledgement after reviewing measured performance.");
      }
      const value = { secondPass: body.secondPass, randomSampleRate: body.randomSampleRate, shareExtractionWithB: body.shareExtractionWithB };
      await db.insert(systemConfig).values({ key: "assessment_policy", value, updatedBy: auth!.userId }).onConflictDoUpdate({ target: systemConfig.key, set: { value, updatedBy: auth!.userId, updatedAt: new Date() } });
      await audit(db, auth!.userId, "config.assessment_policy", "config", "assessment_policy", value);
      return { ok: true };
    },
  });

  route(app, {
    ...owner,
    method: "PUT",
    url: "/api/owner/config/demo-cases",
    summary: "Cases used for the free public demonstration",
    body: z.object({ caseIds: z.array(z.string()).max(5) }),
    handler: async ({ auth, body }) => {
      await db.insert(systemConfig).values({ key: "demo_case_ids", value: body.caseIds, updatedBy: auth!.userId }).onConflictDoUpdate({ target: systemConfig.key, set: { value: body.caseIds, updatedBy: auth!.userId, updatedAt: new Date() } });
      return { ok: true };
    },
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/profiles/:versionId/verification",
    summary: "Record owner verification of a profile as a NEW profile version (attempts stay frozen)",
    params: VersionParam,
    body: z.object({ status: z.enum(["verified", "provisional"]), notes: z.string().min(5).max(2000), unresolvedConflicts: z.array(z.string()).default([]) }),
    handler: async ({ auth, params, body }) => {
      const [row] = await db.select().from(examProfiles).where(eq(examProfiles.versionId, params.versionId));
      if (!row) throw notFound("profile");
      const today = new Date().toISOString().slice(0, 10);
      const existing = await db.select({ v: examProfiles.versionId }).from(examProfiles).where(eq(examProfiles.profileId, row.profileId));
      const n = existing.filter((e) => e.v.startsWith(`${row.profileId}@${today}.`)).length + 1;
      const versionId = `${row.profileId}@${today}.${n}`;
      const next = ExamProfileVersion.parse({ ...row.payload, versionId, verification: { status: body.status, verifiedOn: today, method: "owner_confirmed", notes: body.notes, unresolvedConflicts: body.unresolvedConflicts } });
      await db.transaction(async (tx) => {
        await tx.insert(examProfiles).values({ versionId, profileId: row.profileId, payload: next });
        await tx.update(examProfiles).set({ active: false }).where(eq(examProfiles.versionId, params.versionId));
      });
      await audit(db, auth!.userId, "profile.verification", "profile", versionId, { status: body.status });
      return { versionId };
    },
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/users/:id/adjust-minutes",
    summary: "Owner usage adjustment (e.g. verified platform failure)",
    params: IdParam,
    body: z.object({ minutes: z.number().int().min(-1000).max(1000), reason: z.string().min(5).max(500) }),
    handler: async ({ auth, params, body }) => {
      await db.transaction((tx) => ownerAdjust(tx, params.id, body.minutes, body.reason, auth!.userId, crypto.randomUUID()));
      await audit(db, auth!.userId, "usage.adjusted", "user", params.id, body);
      return { ok: true };
    },
  });

  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/jobs/dead",
    summary: "Dead-lettered background jobs (payload ids only; no clinical content)",
    handler: async () =>
      (await db.select({ id: jobs.id, kind: jobs.kind, attempts: jobs.attempts, lastError: jobs.lastError, updatedAt: jobs.updatedAt }).from(jobs).where(eq(jobs.status, "dead")).orderBy(desc(jobs.updatedAt)).limit(200)).map((j) => ({ ...j, lastError: j.lastError?.slice(0, 500) ?? null, updatedAt: j.updatedAt.toISOString() })),
  });

  route(app, {
    ...owner,
    method: "POST",
    url: "/api/owner/jobs/requeue-dead",
    summary: "Requeue dead-lettered jobs after fixing the cause",
    body: z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
    handler: async ({ body }) => ({ requeued: await requeueDead(db, body.ids) }),
  });

  route(app, {
    ...owner,
    method: "GET",
    url: "/api/owner/sessions",
    summary: "Recent sessions with case attempts (for exception review)",
    handler: async () => {
      const rows = await db.select({ s: stationSessions, u: users.email }).from(stationSessions).innerJoin(users, eq(users.id, stationSessions.userId)).orderBy(desc(stationSessions.createdAt)).limit(100);
      const out = [];
      for (const r of rows) {
        const attempts = await db.select({ id: caseAttempts.id, ordinal: caseAttempts.ordinal, caseVersionId: caseAttempts.caseVersionId, status: caseAttempts.status }).from(caseAttempts).where(eq(caseAttempts.sessionId, r.s.id));
        out.push({ sessionId: r.s.id, userId: r.s.userId, learner: r.u, mode: r.s.mode, status: r.s.status, outcome: r.s.outcome, createdAt: r.s.createdAt.toISOString(), attempts });
      }
      return out;
    },
  });
}
