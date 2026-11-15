export type AuthContext = {
  userId: string;
  email: string;
  role: "learner" | "owner";
  /** Second factor verified for this session (Supabase aal2 or local TOTP). */
  mfa: boolean;
  ownerMfaRequired: boolean;
  via: "cookie" | "bearer";
  /** Local auth session id (null for bearer tokens). */
  authSessionId: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export const SESSION_COOKIE = "sim_session";
