import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { Http, startTestEnv, type TestEnv } from "./harness";

/** DEV_AUTO_LOGIN: testing mode signs in the seeded test accounts without a password or code. */
describe("testing mode (DEV_AUTO_LOGIN)", () => {
  let on: TestEnv;
  let off: TestEnv;
  beforeAll(async () => {
    [on, off] = await Promise.all([startTestEnv({ env: { DEV_AUTO_LOGIN: "true" } }), startTestEnv()]);
  });
  afterAll(async () => {
    await Promise.all([on?.close(), off?.close()]);
  });

  it("signs in the test learner and the test owner, with the owner's second factor verified", async () => {
    const http = new Http(on.base);
    expect((await http.req("GET", "/api/auth/me")).json).toMatchObject({ authenticated: false, devAutoLogin: true });

    expect((await http.req("POST", "/api/auth/dev-login", { as: "learner" })).status).toBe(200);
    expect((await http.req("GET", "/api/auth/me")).json).toMatchObject({ authenticated: true, devAutoLogin: true, user: { email: "learner@example.test", role: "learner" } });
    expect((await http.req("GET", "/api/owner/overview")).status).toBe(403);

    expect((await http.req("POST", "/api/auth/dev-login", { as: "owner" })).status).toBe(200);
    expect((await http.req("GET", "/api/auth/me")).json).toMatchObject({ user: { email: "owner@example.test", role: "owner" }, mfa: { verified: true } });
    expect((await http.req("GET", "/api/owner/overview")).status).toBe(200);

    // Asking again for the account already signed in keeps that session (no new cookie).
    const cookie = http.cookie;
    expect((await http.req("POST", "/api/auth/dev-login", { as: "owner" })).status).toBe(200);
    expect(http.cookie).toBe(cookie);
    expect((await http.req("GET", "/api/owner/overview")).status).toBe(200);
  });

  it("is unavailable unless switched on", async () => {
    const http = new Http(off.base);
    expect((await http.req("GET", "/api/auth/me")).json).toMatchObject({ authenticated: false, devAutoLogin: false });
    const r = await http.req("POST", "/api/auth/dev-login", { as: "owner" });
    expect(r.status).toBe(404);
    expect((await http.req("GET", "/api/auth/me")).json.authenticated).toBe(false);
  });

  it("is refused in production and with managed auth", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DEV_AUTO_LOGIN: "true" })).toThrow(/DEV_AUTO_LOGIN must be false in production/);
    expect(() => loadConfig({ NODE_ENV: "test", DEV_AUTO_LOGIN: "true", AUTH_PROVIDER: "supabase", SUPABASE_URL: "https://example.invalid" })).toThrow(/DEV_AUTO_LOGIN requires AUTH_PROVIDER=local/);
  });
});
