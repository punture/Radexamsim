import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { registerAuth } from "./auth/plugin";
import type { Deps } from "./deps";
import { HttpError } from "./http";
import { LiveRegistry } from "./live/registry";
import { TicketStore } from "./live/tickets";
import { authRoutes } from "./routes/auth";
import { mediaRoutes } from "./routes/media";
import { miscRoutes, wsRoute } from "./routes/misc";
import { sessionRoutes } from "./routes/sessions";
import { extraRoutes } from "./routes/extra";
import { ownerRoutes } from "./routes/owner";

export type BuiltServer = { app: FastifyInstance; live: LiveRegistry; tickets: TicketStore };

export async function buildServer(deps: Deps): Promise<BuiltServer> {
  const app = Fastify({
    logger:
      deps.config.NODE_ENV === "test"
        ? false
        : {
            level: deps.config.NODE_ENV === "production" ? "info" : "debug",
            // Never log credentials or request bodies (which may contain clinical text).
            redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
          },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: trustProxySetting(deps.config.TRUST_PROXY, deps.config.NODE_ENV),
  });

  await app.register(cookie);
  // Limits run after authentication, so signed-in requests are counted per learner, not
  // per IP: many residents share one hospital network address. Anonymous requests (sign-in,
  // registration, public pages) are counted per client IP.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: (req) => (req.auth?.userId ? `user:${req.auth.userId}` : `ip:${req.ip}`),
  });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  registerAuth(app, deps.db, deps.config);

  // Stripe needs the raw body for signature verification.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch {
      done(new HttpError(400, "invalid_json", "request body is not valid JSON"), undefined);
    }
  });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    if (req.url.startsWith("/api/") && !reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) return reply.code(429).send({ code: "rate_limited", message: "too many requests" });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ code: e.code ?? "bad_request", message: e.message ?? "bad request" });
    req.log.error({ err: { name: (err as Error).name, message: (err as Error).message } }, "unhandled error");
    return reply.code(500).send({ code: "internal_error", message: "internal error" });
  });

  const live = new LiveRegistry(deps);
  const tickets = new TicketStore();
  miscRoutes(app, deps);
  authRoutes(app, deps);
  sessionRoutes(app, deps, live, tickets);
  mediaRoutes(app, deps);
  extraRoutes(app, deps);
  ownerRoutes(app, deps);
  wsRoute(app, deps, live, tickets);
  return { app, live, tickets };
}

/**
 * Which proxies may set the client address (X-Forwarded-For) used for rate limits and logs.
 * TRUST_PROXY: "false", "true" (trust every hop; spoofable), a hop count ("1"), or
 * comma-separated proxy addresses or CIDRs ("127.0.0.1,10.0.0.0/8").
 * Default: one hop in production (one reverse proxy in front; the Next.js rewrite passes the
 * header through unchanged, so it adds no hop), nothing elsewhere.
 */
export function trustProxySetting(raw: string | undefined, nodeEnv: string): boolean | string[] | ((address: string, hop: number) => boolean) {
  const value = raw?.trim() || (nodeEnv === "production" ? "1" : "false");
  if (value === "true" || value === "false") return value === "true";
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return (_address: string, hop: number) => hop < hops; // trust only the nearest `hops` proxies
  }
  return value.split(",").map((x) => x.trim()).filter(Boolean);
}
