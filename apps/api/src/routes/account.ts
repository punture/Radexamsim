import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, appeals, caseAssessments, caseAttempts, consents, dataRequests, desc, enqueue, eq, ownerReviewItems, recordings, users } from "@sim/db";
import type { Deps } from "../deps";
import { HttpError, IdParam, badRequest, notFound, route } from "../http";
import { audit } from "../services/audit";

import { POLICY_VERSION } from "../policy";
export { POLICY_VERSION };
const ConsentKind = z.enum(["microphone_processing", "audio_retention", "browser_speech_vendor", "evaluation_use", "terms", "privacy"]);

/** Account, consent, data export/deletion and appeals (spec §11, §17). */
export function accountRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps;

  route(app, {
    method: "GET",
    url: "/api/account/consents",
    summary: "Current consent state (latest record per kind)",
    tags: ["account"],
    auth: "user",
    handler: async ({ auth }) => {
      const rows = await db.select().from(consents).where(eq(consents.userId, auth!.userId)).orderBy(desc(consents.createdAt));
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (!latest.has(r.kind)) latest.set(r.kind, r);
      return { policyVersion: POLICY_VERSION, consents: [...latest.values()].map((r) => ({ kind: r.kind, granted: r.granted, policyVersion: r.policyVersion, at: r.createdAt.toISOString() })) };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/account/consents",
    summary: "Grant or withdraw a consent (append-only record)",
    tags: ["account"],
    auth: "user",
    body: z.object({ kind: ConsentKind, granted: z.boolean() }),
    handler: async ({ auth, body }) => {
      await db.insert(consents).values({ userId: auth!.userId, kind: body.kind, granted: body.granted, policyVersion: POLICY_VERSION });
      return { ok: true };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/account/export",
    summary: "Request an export of my own data (the private case bank is excluded)",
    tags: ["account"],
    auth: "user",
    rateLimit: { max: 3, timeWindow: "1 hour" },
    handler: async ({ auth }) => {
      const id = await db.transaction(async (tx) => {
        const [r] = await tx.insert(dataRequests).values({ userId: auth!.userId, kind: "export" }).returning();
        await enqueue(tx, { kind: "data_export", payload: { requestId: r!.id, userId: auth!.userId }, dedupeKey: `export:${r!.id}` });
        return r!.id;
      });
      return { requestId: id };
    },
  });

  route(app, {
    method: "GET",
    url: "/api/account/data-requests",
    summary: "My export/deletion requests",
    tags: ["account"],
    auth: "user",
    handler: async ({ auth }) =>
      (await db.select().from(dataRequests).where(eq(dataRequests.userId, auth!.userId)).orderBy(desc(dataRequests.createdAt))).map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        downloadable: r.kind === "export" && r.status === "complete" && !!r.resultStorageKey,
      })),
  });

  route(app, {
    method: "GET",
    url: "/api/account/exports/:id/download",
    summary: "Download a completed export",
    tags: ["account"],
    auth: "user",
    params: IdParam,
    handler: async ({ auth, params, reply }) => {
      const [r] = await db.select().from(dataRequests).where(and(eq(dataRequests.id, params.id), eq(dataRequests.userId, auth!.userId)));
      if (!r || r.kind !== "export" || !r.resultStorageKey) throw notFound("export");
      const bytes = await deps.storage.get("exports", r.resultStorageKey);
      reply.header("content-type", "application/json").header("content-disposition", `attachment; filename="my-data-export.json"`).header("cache-control", "private, no-store");
      return reply.send(Buffer.from(bytes));
    },
  });

  route(app, {
    method: "POST",
    url: "/api/account/delete",
    summary: "Delete my account and personal data (confirmation required)",
    tags: ["account"],
    auth: "user",
    rateLimit: { max: 3, timeWindow: "1 hour" },
    body: z.object({ confirmEmail: z.email() }),
    handler: async ({ auth, body }) => {
      const [u] = await db.select().from(users).where(eq(users.id, auth!.userId));
      if (!u || u.email.toLowerCase() !== body.confirmEmail.toLowerCase()) throw badRequest("confirmation_mismatch", "type your account email to confirm");
      if (u.role === "owner") throw new HttpError(409, "owner_account", "the owner account cannot be deleted from the learner interface");
      const id = await db.transaction(async (tx) => {
        const [r] = await tx.insert(dataRequests).values({ userId: u.id, kind: "deletion" }).returning();
        await enqueue(tx, { kind: "data_deletion", payload: { requestId: r!.id, userId: u.id }, dedupeKey: `deletion:${u.id}` });
        return r!.id;
      });
      await audit(db, u.id, "account.deletion_requested", "user", u.id);
      return { requestId: id };
    },
  });

  route(app, {
    method: "GET",
    url: "/api/account/recordings",
    summary: "Retained audio recordings (only with opt-in consent)",
    tags: ["account"],
    auth: "user",
    handler: async ({ auth }) =>
      (await db.select().from(recordings).where(eq(recordings.userId, auth!.userId))).filter((r) => !r.deletedAt).map((r) => ({ id: r.id, sessionId: r.sessionId, retainedUntil: r.retainedUntil.toISOString(), bytes: r.bytes })),
  });

  // ---------------------------------------------------------------- appeals
  route(app, {
    method: "POST",
    url: "/api/appeals",
    summary: "Dispute a transcription or a grading decision (original result is preserved)",
    tags: ["appeals"],
    auth: "user",
    rateLimit: { max: 10, timeWindow: "1 hour" },
    body: z.object({
      caseAttemptId: z.uuid(),
      assessmentId: z.uuid(),
      kind: z.enum(["transcript", "grading"]),
      statement: z.string().min(10).max(4000),
      disputedElementIds: z.array(z.string().max(80)).max(20).default([]),
      transcriptCorrections: z.array(z.object({ segmentId: z.uuid(), proposedText: z.string().min(1).max(4000) })).max(20).default([]),
    }),
    handler: async ({ auth, body }) => {
      const [at] = await db.select().from(caseAttempts).where(eq(caseAttempts.id, body.caseAttemptId));
      const [as] = await db.select().from(caseAssessments).where(eq(caseAssessments.id, body.assessmentId));
      if (!at || at.userId !== auth!.userId || !as || as.caseAttemptId !== at.id) throw notFound("assessment");
      const id = await db.transaction(async (tx) => {
        const [a] = await tx.insert(appeals).values({ userId: auth!.userId, caseAttemptId: at.id, assessmentId: as.id, kind: body.kind, statement: body.statement, disputedElementIds: body.disputedElementIds, transcriptCorrections: body.transcriptCorrections }).returning();
        await tx.insert(ownerReviewItems).values({
          kind: "learner_appeal",
          priority: "normal",
          title: `Learner appeal (${body.kind})`,
          detail: body.statement.slice(0, 1500),
          refs: { appealId: a!.id, caseAttemptId: at.id, assessmentId: as.id },
          dedupeKey: `appeal:${a!.id}`,
        });
        return a!.id;
      });
      return { appealId: id };
    },
  });

  route(app, {
    method: "GET",
    url: "/api/appeals",
    summary: "My appeals and their outcomes",
    tags: ["appeals"],
    auth: "user",
    handler: async ({ auth }) =>
      (
        await db
          .select({ a: appeals, sessionId: caseAttempts.sessionId, ordinal: caseAttempts.ordinal })
          .from(appeals)
          .innerJoin(caseAttempts, eq(caseAttempts.id, appeals.caseAttemptId))
          .where(eq(appeals.userId, auth!.userId))
          .orderBy(desc(appeals.createdAt))
      ).map(({ a, sessionId, ordinal }) => ({ id: a.id, kind: a.kind, status: a.status, resolution: a.resolution, createdAt: a.createdAt.toISOString(), caseAttemptId: a.caseAttemptId, sessionId, caseNumber: ordinal + 1 })),
  });
}
