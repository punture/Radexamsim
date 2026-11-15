import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CandidateSessionState, SessionDebrief, SessionSummary, TranscriptLine } from "@sim/contracts";
import { and, asc, assetHandles, caseAttempts, desc, eq, examProfiles, stationSessions } from "@sim/db";
import type { Deps } from "../deps";
import { HttpError, IdParam, badRequest, route } from "../http";
import type { LiveRegistry } from "../live/registry";
import type { TicketStore } from "../live/tickets";
import { getCaseVersion } from "../services/content";
import { accessibleSession, createStationSession } from "../services/sessions";
import { buildSessionDebrief, caseReleased, sessionTranscript } from "../services/results";

export const CreateSessionBody = z.object({
  profileVersionId: z.string().min(3),
  mode: z.enum(["exam", "practice", "owner_preview"]),
  caseCount: z.number().int().min(1).max(10).optional(),
  inputMode: z.enum(["voice", "typed_practice"]).default("voice"),
  demo: z.boolean().optional(),
  previewCaseVersionIds: z.array(z.string()).max(10).optional(),
});

export const PreflightBody = z.object({
  microphone: z.enum(["granted", "denied", "unavailable", "not_required"]),
  audioPlayback: z.enum(["ok", "failed", "skipped"]),
  imageRender: z.enum(["ok", "failed"]),
  connectionRttMs: z.number().int().min(0).max(60_000).nullable(),
  speechRecognition: z.enum(["available", "unavailable", "not_required"]),
  browser: z.object({ userAgentFamily: z.string().max(60), webAudio: z.boolean(), webSocket: z.boolean(), screenWidth: z.number().int(), screenHeight: z.number().int() }),
});

export function sessionRoutes(app: FastifyInstance, deps: Deps, live: LiveRegistry, tickets: TicketStore): void {
  const { db, config } = deps;

  route(app, {
    method: "POST",
    url: "/api/sessions",
    summary: "Create a station session (assembles an exam form; checks entitlement)",
    tags: ["sessions"],
    auth: "user",
    rateLimit: { max: 20, timeWindow: "1 minute" },
    body: CreateSessionBody,
    handler: async ({ auth, body }) => createStationSession(deps, auth!, body),
  });

  route(app, {
    method: "GET",
    url: "/api/sessions",
    summary: "List my sessions",
    tags: ["sessions"],
    auth: "user",
    response: z.array(SessionSummary),
    handler: async ({ auth }) => {
      const rows = await db
        .select({ s: stationSessions, p: examProfiles })
        .from(stationSessions)
        .innerJoin(examProfiles, eq(examProfiles.versionId, stationSessions.profileVersionId))
        .where(eq(stationSessions.userId, auth!.userId))
        .orderBy(desc(stationSessions.createdAt))
        .limit(100);
      return rows.map(({ s, p }) => ({
        sessionId: s.id,
        mode: s.mode,
        status: s.status,
        outcome: s.outcome ?? null,
        profileDisplayName: p.payload.displayName,
        createdAt: s.createdAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        caseCount: s.caseCount,
        resultStatus: (s.status === "complete" ? "available" : s.status === "finalizing" ? "pending" : s.status === "aborted" ? "unavailable" : "not_started") as SessionSummary["resultStatus"],
      }));
    },
  });

  route(app, {
    method: "GET",
    url: "/api/sessions/:id",
    summary: "Session state (candidate-safe DTO)",
    tags: ["sessions"],
    auth: "user",
    params: IdParam,
    response: CandidateSessionState,
    handler: async ({ auth, params }) => {
      await accessibleSession(db, auth!, params.id);
      const s = await live.get(params.id);
      return s.candidateState();
    },
  });

  route(app, {
    method: "POST",
    url: "/api/sessions/:id/preflight",
    summary: "Record preflight checks (microphone, audio, rendering, connection, browser)",
    tags: ["sessions"],
    auth: "user",
    params: IdParam,
    body: PreflightBody,
    handler: async ({ auth, params, body }) => {
      const s = await accessibleSession(db, auth!, params.id);
      if (s.userId !== auth!.userId) throw new HttpError(403, "forbidden", "only the learner can run preflight");
      if (s.status !== "preflight" && s.status !== "ready") throw new HttpError(409, "not_in_preflight", "preflight is complete");
      const problems: string[] = [];
      if (s.inputMode === "voice" && body.microphone !== "granted" && deps.speech.asr !== "dev_injection_only") problems.push("Microphone access is required for a spoken station. You can allow it in your browser settings, or start a typed practice session instead.");
      if (body.imageRender !== "ok") problems.push("Images could not be displayed in this browser.");
      if (!body.browser.webSocket) problems.push("This browser does not support the live connection required.");
      if (s.inputMode === "voice" && deps.speech.asr === "browser" && body.speechRecognition !== "available") problems.push("Speech recognition is not available in this browser. Use a current desktop Chrome or Edge, or start a typed practice session.");
      const ready = problems.length === 0;
      await db.update(stationSessions).set({ preflight: body, status: ready ? "ready" : "preflight" }).where(eq(stationSessions.id, s.id));
      if (ready) (await live.get(s.id)).setReady();
      return { ready, problems };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/sessions/:id/ws-ticket",
    summary: "Issue a single-use WebSocket ticket for the live session",
    tags: ["sessions"],
    auth: "user",
    params: IdParam,
    rateLimit: { max: 30, timeWindow: "1 minute" },
    handler: async ({ auth, params }) => {
      const s = await accessibleSession(db, auth!, params.id);
      if (s.userId !== auth!.userId) throw new HttpError(403, "forbidden", "only the learner can join the live session");
      if (s.status === "complete" || s.status === "aborted") throw new HttpError(409, "session_over", "this session has ended");
      return { ticket: tickets.issue(auth!.userId, s.id), url: `${config.PUBLIC_API_WS_URL.replace(/\/$/, "")}/ws` };
    },
  });

  route(app, {
    method: "GET",
    url: "/api/sessions/:id/debrief",
    summary: "Debrief (released according to the profile's feedback-release policy)",
    tags: ["results"],
    auth: "user",
    params: IdParam,
    response: SessionDebrief,
    handler: async ({ auth, params }) => buildSessionDebrief(db, await accessibleSession(db, auth!, params.id)),
  });

  route(app, {
    method: "GET",
    url: "/api/sessions/:id/transcript",
    summary: "Transcript of released cases (examiner lines show only what was played)",
    tags: ["results"],
    auth: "user",
    params: IdParam,
    response: z.array(TranscriptLine),
    handler: async ({ auth, params }) => sessionTranscript(db, await accessibleSession(db, auth!, params.id)),
  });

  route(app, {
    method: "GET",
    url: "/api/sessions/:id/replay",
    summary: "Replay material for released cases: images (opaque handles) and owner-approved key annotations",
    tags: ["results"],
    auth: "user",
    params: IdParam,
    handler: async ({ auth, params }) => {
      const s = await accessibleSession(db, auth!, params.id);
      const attempts = await db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, s.id)).orderBy(asc(caseAttempts.ordinal));
      const out = [];
      for (const at of attempts) {
        if (!caseReleased(s, at) || at.startedAtMs === null) continue;
        const cv = await getCaseVersion(db, at.caseVersionId);
        const handles = await db.select().from(assetHandles).where(and(eq(assetHandles.caseAttemptId, at.id)));
        out.push({
          caseAttemptId: at.id,
          caseLabel: `Case ${at.ordinal + 1} of ${attempts.length}`,
          caseStartedAtMs: at.startedAtMs,
          isDevelopmentFixture: cv.isDevelopmentFixture,
          assets: handles.map((h) => {
            const a = cv.assets.find((x) => x.id === h.assetId)!;
            return {
              handle: h.handle,
              label: a.neutralLabel,
              frameCount: a.frames.length,
              isPlaceholder: a.isPlaceholder,
              // Annotations are hidden during detection assessment but shown in the debrief.
              annotations: a.annotations.map((an) => ({ frameIndex: an.frameIndex, kind: an.kind, points: an.points, label: an.label })),
            };
          }),
        });
      }
      return { sessionId: s.id, cases: out };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/sessions/:id/abort",
    summary: "Abandon a session that has not started",
    tags: ["sessions"],
    auth: "user",
    params: IdParam,
    handler: async ({ auth, params }) => {
      const s = await accessibleSession(db, auth!, params.id);
      if (s.status !== "preflight" && s.status !== "ready") throw badRequest("already_started", "use the in-session end control");
      await db.update(stationSessions).set({ status: "aborted", outcome: "user_aborted", endedAt: new Date() }).where(eq(stationSessions.id, s.id));
      return { ok: true };
    },
  });
}
