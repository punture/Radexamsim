import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authSessions, consents, eq, users } from "@sim/db";
import { ownerEmails } from "../config";
import { SESSION_COOKIE } from "../auth/context";
import { decryptSecret, encryptSecret, hashPassword, newTotpSecret, verifyPassword, verifyTotp } from "../auth/crypto";
import { createLocalSession, revokeLocalSession } from "../auth/plugin";
import type { Deps } from "../deps";
import { HttpError, badRequest, route } from "../http";
import { audit } from "../services/audit";

const Credentials = z.object({ email: z.email().max(200), password: z.string().min(10).max(200) });

export function authRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;
  const local = config.AUTH_PROVIDER === "local";
  const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: config.NODE_ENV === "production", path: "/" };

  route(app, {
    method: "POST",
    url: "/api/auth/register",
    summary: "Create a local development account (disabled when managed auth is configured)",
    tags: ["auth"],
    auth: "public",
    rateLimit: { max: 10, timeWindow: "1 minute" },
    body: Credentials.extend({ displayName: z.string().max(100).optional(), acceptTerms: z.literal(true) }),
    handler: async ({ body, reply }) => {
      if (!local) throw new HttpError(404, "not_available", "registration is handled by the identity provider");
      const email = body.email.toLowerCase();
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (existing.length) throw new HttpError(409, "email_taken", "an account with this email already exists");
      const role = ownerEmails(config).has(email) ? "owner" : "learner";
      const [u] = await db.insert(users).values({ email, displayName: body.displayName ?? null, role, authProvider: "local", passwordHash: await hashPassword(body.password) }).returning();
      await db.insert(consents).values([
        { userId: u!.id, kind: "terms", granted: true, policyVersion: "draft-2026-11-15" },
        { userId: u!.id, kind: "privacy", granted: true, policyVersion: "draft-2026-11-15" },
      ]);
      const s = await createLocalSession(db, u!.id, config.SESSION_TTL_HOURS);
      reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: s.expiresAt });
      return { userId: u!.id, role };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/auth/login",
    summary: "Sign in with a local development account",
    tags: ["auth"],
    auth: "public",
    rateLimit: { max: 10, timeWindow: "1 minute" },
    body: Credentials,
    handler: async ({ body, reply }) => {
      if (!local) throw new HttpError(404, "not_available", "sign-in is handled by the identity provider");
      const [u] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase()));
      // Constant-shape failure; never reveal whether the email exists.
      if (!u || !u.passwordHash || u.deletedAt || !(await verifyPassword(body.password, u.passwordHash))) {
        throw new HttpError(401, "invalid_credentials", "email or password is incorrect");
      }
      const s = await createLocalSession(db, u.id, config.SESSION_TTL_HOURS);
      reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: s.expiresAt });
      await audit(db, u.id, "auth.login", "user", u.id);
      return { userId: u.id, role: u.role, mfaRequired: u.role === "owner" && config.OWNER_MFA_REQUIRED, mfaEnrolled: u.totpEnabled };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/auth/logout",
    summary: "Sign out",
    tags: ["auth"],
    auth: "user",
    handler: async ({ auth, reply }) => {
      if (auth?.authSessionId) await revokeLocalSession(db, auth.authSessionId);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    },
  });

  route(app, {
    method: "GET",
    url: "/api/auth/me",
    summary: "Current user",
    tags: ["auth"],
    auth: "public",
    handler: async ({ auth }) => {
      if (!auth) return { authenticated: false as const, authProvider: config.AUTH_PROVIDER };
      const [u] = await db.select().from(users).where(eq(users.id, auth.userId));
      return {
        authenticated: true as const,
        authProvider: config.AUTH_PROVIDER,
        user: { id: auth.userId, email: auth.email, displayName: u?.displayName ?? null, role: auth.role },
        mfa: { verified: auth.mfa, enrolled: u?.totpEnabled ?? false, requiredForOwner: config.OWNER_MFA_REQUIRED },
      };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/auth/mfa/enroll",
    summary: "Begin TOTP enrolment (owner, local auth)",
    tags: ["auth"],
    auth: "user",
    handler: async ({ auth }) => {
      if (!local) throw new HttpError(404, "not_available", "MFA is managed by the identity provider");
      if (auth!.role !== "owner") throw new HttpError(403, "forbidden", "MFA enrolment is required for the owner account");
      const [u] = await db.select().from(users).where(eq(users.id, auth!.userId));
      if (u!.totpEnabled) throw new HttpError(409, "already_enrolled", "a second factor is already enrolled");
      const secret = newTotpSecret();
      await db.update(users).set({ totpSecret: encryptSecret(secret, config.AUTH_ENCRYPTION_KEY) }).where(eq(users.id, auth!.userId));
      return { secret, otpauthUri: `otpauth://totp/NeuroOralSim:${encodeURIComponent(auth!.email)}?secret=${secret}&issuer=NeuroOralSim&digits=6&period=30` };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/auth/mfa/verify",
    summary: "Verify a TOTP code for this sign-in session",
    tags: ["auth"],
    auth: "user",
    rateLimit: { max: 10, timeWindow: "1 minute" },
    body: z.object({ code: z.string().regex(/^\d{6}$/) }),
    handler: async ({ auth, body }) => {
      if (!local || !auth?.authSessionId) throw new HttpError(404, "not_available", "MFA is managed by the identity provider");
      const [u] = await db.select().from(users).where(eq(users.id, auth.userId));
      if (!u?.totpSecret) throw badRequest("not_enrolled", "enrol a second factor first");
      if (!verifyTotp(decryptSecret(u.totpSecret, config.AUTH_ENCRYPTION_KEY), body.code)) throw new HttpError(401, "invalid_code", "the code is incorrect or expired");
      if (!u.totpEnabled) await db.update(users).set({ totpEnabled: true }).where(eq(users.id, u.id));
      await db.update(authSessions).set({ mfaVerifiedAt: new Date() }).where(eq(authSessions.id, auth.authSessionId));
      await audit(db, u.id, "auth.mfa_verified", "user", u.id);
      return { ok: true };
    },
  });
}
