import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, examProfiles, sql } from "@sim/db";
import { ExamProfileVersion } from "@sim/contracts";
import type { Deps } from "../deps";
import { ROUTE_REGISTRY, route } from "../http";
import type { LiveRegistry } from "../live/registry";
import type { TicketStore } from "../live/tickets";

export function miscRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, {
    method: "GET",
    url: "/api/health",
    summary: "Liveness and dependency status (no secrets)",
    tags: ["ops"],
    auth: "public",
    handler: async () => {
      let db = false;
      try {
        await deps.db.execute(sql`select 1`);
        db = true;
      } catch {
        db = false;
      }
      return {
        ok: db,
        db,
        providers: {
          llm: deps.llm ? { name: deps.llm.name, simulated: deps.llm.simulated } : null,
          asr: deps.speech.asr,
          tts: deps.speech.tts,
        },
        fixturesAllowed: deps.config.ALLOW_FIXTURES,
        devInjection: deps.config.ALLOW_DEV_INJECTION,
      };
    },
  });

  route(app, {
    method: "GET",
    url: "/api/profiles",
    summary: "Available examination profiles (with verification status and unresolved conflicts)",
    tags: ["profiles"],
    auth: "public",
    handler: async () => {
      const rows = await deps.db.select().from(examProfiles).where(eq(examProfiles.active, true));
      return rows.map((r) => {
        const p = ExamProfileVersion.parse(r.payload);
        return {
          versionId: p.versionId,
          profileId: p.profileId,
          displayName: p.displayName,
          board: p.board,
          track: p.track,
          cohort: p.cohort,
          modes: p.modes,
          stationDurationSeconds: p.station.durationSeconds,
          minCases: p.station.minCases,
          maxCases: p.station.maxCases,
          verification: p.verification,
          scoringKind: p.scoring.kind,
          scoringDisclaimer: p.scoring.disclaimer,
          publicDescription: p.publicDescription,
          sources: p.sources.map((s) => ({ title: s.title, url: s.url, accessDate: s.accessDate })),
        };
      });
    },
  });

  route(app, {
    method: "GET",
    url: "/api/openapi.json",
    summary: "OpenAPI 3.1 description of the HTTP API",
    tags: ["ops"],
    auth: "public",
    handler: async () => buildOpenApi(),
  });
}

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const schema = (s: z.ZodType | undefined) => {
    if (!s) return undefined;
    try {
      return z.toJSONSchema(s, { target: "draft-2020-12", unrepresentable: "any", io: "input" });
    } catch {
      return { description: "schema not representable" };
    }
  };
  for (const r of ROUTE_REGISTRY) {
    const p = r.url.replace(/:([A-Za-z]+)/g, "{$1}");
    const params = [...r.url.matchAll(/:([A-Za-z]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    paths[p] = paths[p] ?? {};
    paths[p]![r.method.toLowerCase()] = {
      summary: r.summary,
      tags: r.tags,
      "x-auth": r.auth,
      security: r.auth === "public" ? [] : [{ cookieSession: [] }, { bearerSupabase: [] }],
      parameters: params,
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: schema(r.body) } } } } : {}),
      responses: {
        "200": { description: "OK", ...(r.response ? { content: { "application/json": { schema: schema(r.response) } } } : {}) },
        "400": { description: "Invalid request ({code, message, issues[]})" },
        "401": { description: "Not signed in" },
        "403": { description: "Forbidden (role, MFA or CSRF)" },
        "404": { description: "Not found (also returned for resources owned by another user)" },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Neuroradiology Oral Exam Simulator API", version: "0.1.0", description: "HTTP API. The live examination uses the WebSocket protocol documented in docs/EVENT_CONTRACTS.md." },
    components: {
      securitySchemes: {
        cookieSession: { type: "apiKey", in: "cookie", name: "sim_session", description: "Local development auth. State-changing requests also require header x-sim-csrf: 1." },
        bearerSupabase: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Supabase access token verified against the project JWKS." },
      },
    },
    paths,
  };
}

export function wsRoute(app: FastifyInstance, deps: Deps, live: LiveRegistry, tickets: TicketStore): void {
  app.get("/ws", { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (origin && deps.config.NODE_ENV === "production" && origin !== deps.config.PUBLIC_WEB_ORIGIN) {
      socket.close(4403, "origin not allowed");
      return;
    }
    const ticket = new URL(req.url, "http://localhost").searchParams.get("ticket") ?? "";
    const t = tickets.redeem(ticket);
    if (!t) {
      socket.close(4401, "invalid or expired ticket");
      return;
    }
    const pendingMessages: { data: Buffer; isBinary: boolean }[] = [];
    let session: Awaited<ReturnType<LiveRegistry["get"]>> | null = null;
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (!session) pendingMessages.push({ data, isBinary });
      else if (isBinary) session.handleBinary(new Uint8Array(data));
      else session.handleText(data.toString("utf8"));
    });
    socket.on("close", () => session?.detach(socket));
    live
      .get(t.sessionId)
      .then((s) => {
        if (s.userId !== t.userId) {
          socket.close(4403, "forbidden");
          return;
        }
        session = s;
        s.attach(socket);
        for (const m of pendingMessages.splice(0)) m.isBinary ? s.handleBinary(new Uint8Array(m.data)) : s.handleText(m.data.toString("utf8"));
      })
      .catch(() => socket.close(1011, "session unavailable"));
  });
}
