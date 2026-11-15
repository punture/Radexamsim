import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { zodIssues } from "@sim/contracts";
import type { AuthContext } from "./auth/context";

/**
 * Typed route helper: zod validation for params/query/body, an explicit authorization
 * level on every route, and a registry used to generate the OpenAPI document.
 */

export type AuthLevel = "public" | "user" | "owner";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly issues?: unknown) {
    super(message);
  }
}

export const notFound = (what = "resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "forbidden") => new HttpError(403, "forbidden", msg);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);
export const badRequest = (code: string, msg: string) => new HttpError(400, code, msg);

type RouteDef<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType, R extends z.ZodType> = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  summary: string;
  tags: string[];
  auth: AuthLevel;
  params?: P;
  query?: Q;
  body?: B;
  response?: R;
  rateLimit?: { max: number; timeWindow: string };
  handler: (ctx: {
    req: FastifyRequest;
    reply: FastifyReply;
    params: z.infer<P>;
    query: z.infer<Q>;
    body: z.infer<B>;
    auth: AuthContext | null;
  }) => Promise<z.infer<R> | void>;
};

export type RegisteredRoute = { method: string; url: string; summary: string; tags: string[]; auth: AuthLevel; params?: z.ZodType; query?: z.ZodType; body?: z.ZodType; response?: z.ZodType };
export const ROUTE_REGISTRY: RegisteredRoute[] = [];

export function route<P extends z.ZodType = z.ZodAny, Q extends z.ZodType = z.ZodAny, B extends z.ZodType = z.ZodAny, R extends z.ZodType = z.ZodAny>(
  app: FastifyInstance,
  def: RouteDef<P, Q, B, R>,
): void {
  if (!ROUTE_REGISTRY.some((r) => r.method === def.method && r.url === def.url)) {
    ROUTE_REGISTRY.push({ method: def.method, url: def.url, summary: def.summary, tags: def.tags, auth: def.auth, params: def.params, query: def.query, body: def.body, response: def.response });
  }
  app.route({
    method: def.method,
    url: def.url,
    ...(def.rateLimit ? { config: { rateLimit: def.rateLimit } } : {}),
    handler: async (req, reply) => {
      const auth = req.auth ?? null;
      if (def.auth !== "public") {
        if (!auth) throw new HttpError(401, "unauthenticated", "sign in required");
        if (def.auth === "owner") {
          if (auth.role !== "owner") throw forbidden("owner access required");
          if (auth.ownerMfaRequired && !auth.mfa) throw new HttpError(403, "mfa_required", "owner routes require a verified second factor");
        }
        // CSRF: cookie-authenticated state changes must carry the custom header (not
        // sendable cross-site without a CORS preflight, which we never grant).
        if (def.method !== "GET" && auth.via === "cookie" && req.headers["x-sim-csrf"] !== "1") {
          throw new HttpError(403, "csrf", "missing CSRF header");
        }
      }
      const parse = <T extends z.ZodType>(schema: T | undefined, value: unknown, where: string): z.infer<T> => {
        if (!schema) return value as z.infer<T>;
        const r = schema.safeParse(value);
        if (!r.success) throw new HttpError(400, "invalid_request", `invalid ${where}`, zodIssues(r.error));
        return r.data;
      };
      const params = parse(def.params, req.params, "path parameters");
      const query = parse(def.query, req.query, "query");
      const body = parse(def.body, req.body, "body");
      const out = await def.handler({ req, reply, params, query, body, auth });
      if (reply.sent) return;
      if (out === undefined) return reply.code(204).send();
      return reply.send(out);
    },
  });
}

export const IdParam = z.object({ id: z.uuid() });
