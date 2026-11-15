import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, assetHandles, caseAttempts, eq, isNull, stationSessions } from "@sim/db";
import { StorageNotFound } from "@sim/storage";
import type { Deps } from "../deps";
import { HttpError, notFound, route } from "../http";
import { getCaseVersion, isCaseWithdrawn } from "../services/content";

/**
 * Authorized media delivery (spec §6, §17). Every request is authorized against the
 * per-attempt opaque handle, the requesting user, the live case and content withdrawal.
 * Objects are streamed by the API (no public bucket, no long-lived URLs) with
 * `Cache-Control: private, no-store` so no shared cache can serve them to anyone else.
 */
export function mediaRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, storage } = deps;
  route(app, {
    method: "GET",
    url: "/api/media/:handle/:frame",
    summary: "Stream one frame of a disclosed asset (authorized per request)",
    tags: ["media"],
    auth: "user",
    params: z.object({ handle: z.string().regex(/^h_[a-f0-9]{32}$/), frame: z.coerce.number().int().min(0).max(5000) }),
    rateLimit: { max: 1200, timeWindow: "1 minute" },
    handler: async ({ auth, params, reply }) => {
      const [h] = await db.select().from(assetHandles).where(and(eq(assetHandles.handle, params.handle), isNull(assetHandles.revokedAt)));
      // Same response for "missing" and "not yours": do not reveal existence.
      if (!h || (h.userId !== auth!.userId && auth!.role !== "owner")) throw notFound("media");
      const [s] = await db.select().from(stationSessions).where(eq(stationSessions.id, h.sessionId));
      const [attempt] = await db.select().from(caseAttempts).where(eq(caseAttempts.id, h.caseAttemptId));
      if (!s || !attempt) throw notFound("media");
      // During a live station only the current case's disclosed images are available.
      if ((s.status === "active" || s.status === "technically_interrupted") && attempt.status !== "active") throw new HttpError(403, "not_current_case", "images from other cases are not available during the station");
      const cv = await getCaseVersion(db, h.caseVersionId);
      if (await isCaseWithdrawn(db, cv.caseId)) throw new HttpError(410, "withdrawn", "this content has been withdrawn");
      const asset = cv.assets.find((a) => a.id === h.assetId);
      const frame = asset?.frames[params.frame];
      if (!asset || !frame) throw notFound("media");
      try {
        const { stream, size } = await storage.stream("derivatives", frame.storageKey);
        reply
          .header("content-type", frame.mimeType)
          .header("content-length", String(size))
          .header("cache-control", "private, no-store, max-age=0")
          .header("vary", "Cookie, Authorization")
          .header("x-content-type-options", "nosniff")
          .header("content-disposition", "inline")
          .header("cross-origin-resource-policy", "same-site");
        return reply.send(stream);
      } catch (e) {
        if (e instanceof StorageNotFound) throw new HttpError(502, "media_unavailable", "the image could not be loaded");
        throw e;
      }
    },
  });
}
