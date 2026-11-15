import type { FastifyInstance, FastifyRequest } from "fastify";
import "@fastify/cookie";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { and, authSessions, eq, gt, isNull, users, type Db } from "@sim/db";
import { ownerEmails, type Config } from "../config";
import { SESSION_COOKIE, type AuthContext } from "./context";
import { randomToken, sha256 } from "./crypto";

/**
 * Authentication boundary (spec §16). Every protected operation is authorized on the
 * server from a verified credential; roles come from OUR database, never from a client
 * flag or an unverified claim.
 *  - local (development/test only): opaque random session token in an HttpOnly cookie,
 *    stored hashed; TOTP second factor for the owner.
 *  - supabase (production default): Supabase access token verified against the project's
 *    JWKS (issuer + audience checked); `aal2` indicates MFA. Implemented but not verified
 *    against a live Supabase project in this build environment.
 */

export async function createLocalSession(db: Db, userId: string, ttlHours: number): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  const [row] = await db.insert(authSessions).values({ userId, tokenHash: sha256(token), expiresAt }).returning({ id: authSessions.id });
  return { token, id: row!.id, expiresAt };
}

export async function revokeLocalSession(db: Db, id: string): Promise<void> {
  await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, id));
}

export function registerAuth(app: FastifyInstance, db: Db, config: Config): void {
  const owners = ownerEmails(config);
  let jwks: JWTVerifyGetKey | null = null;
  if (config.AUTH_PROVIDER === "supabase" && config.SUPABASE_URL) {
    jwks = createRemoteJWKSet(new URL(`${config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`));
  }

  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (req) => {
    req.auth = await resolveAuth(req);
  });

  async function resolveAuth(req: FastifyRequest): Promise<AuthContext | null> {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ") && jwks && config.SUPABASE_URL) {
      try {
        const { payload } = await jwtVerify(header.slice(7), jwks, {
          issuer: `${config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`,
          audience: "authenticated",
          algorithms: ["ES256", "RS256"],
        });
        const sub = String(payload.sub ?? "");
        const email = String((payload as Record<string, unknown>).email ?? "").toLowerCase();
        if (!sub || !email) return null;
        let [u] = await db.select().from(users).where(and(eq(users.authProvider, "supabase"), eq(users.externalAuthId, sub)));
        if (!u) {
          [u] = await db
            .insert(users)
            .values({ email, authProvider: "supabase", externalAuthId: sub, role: owners.has(email) ? "owner" : "learner" })
            .onConflictDoNothing()
            .returning();
          if (!u) return null;
        }
        if (u.deletedAt) return null;
        return { userId: u.id, email: u.email, role: u.role, mfa: (payload as Record<string, unknown>).aal === "aal2", ownerMfaRequired: config.OWNER_MFA_REQUIRED, via: "bearer", authSessionId: null };
      } catch {
        return null;
      }
    }
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || config.AUTH_PROVIDER !== "local") return null;
    const rows = await db
      .select({ s: authSessions, u: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(eq(authSessions.tokenHash, sha256(token)), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())));
    const row = rows[0];
    if (!row || row.u.deletedAt) return null;
    return {
      userId: row.u.id,
      email: row.u.email,
      role: row.u.role,
      mfa: row.s.mfaVerifiedAt !== null,
      ownerMfaRequired: config.OWNER_MFA_REQUIRED,
      via: "cookie",
      authSessionId: row.s.id,
    };
  }
}
