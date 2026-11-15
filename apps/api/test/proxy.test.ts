import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { trustProxySetting } from "../src/server";

/** The client address Fastify derives for one request, for a TRUST_PROXY value. */
async function clientIp(raw: string | undefined, nodeEnv: string, remoteAddress: string, xff?: string): Promise<string> {
  const app = Fastify({ trustProxy: trustProxySetting(raw, nodeEnv) });
  app.get("/ip", async (req) => ({ ip: req.ip }));
  const res = await app.inject({ method: "GET", url: "/ip", remoteAddress, headers: xff ? { "x-forwarded-for": xff } : {} });
  await app.close();
  return (res.json() as { ip: string }).ip;
}

describe("TRUST_PROXY decides which client address the rate limits see", () => {
  it("ignores X-Forwarded-For outside production by default", async () => {
    expect(await clientIp(undefined, "development", "127.0.0.1", "203.0.113.7")).toBe("127.0.0.1");
  });

  it("trusts exactly one proxy hop in production by default, so a client cannot spoof its address", async () => {
    // The reverse proxy appended the real client (198.51.100.20) to a forged header.
    expect(await clientIp(undefined, "production", "10.0.0.2", "203.0.113.7, 198.51.100.20")).toBe("198.51.100.20");
    // Through the Next.js rewrite the socket peer is the web server and the header is passed through unchanged.
    expect(await clientIp(undefined, "production", "127.0.0.1", "198.51.100.20")).toBe("198.51.100.20");
  });

  it("accepts a hop count, an address list, or an explicit true/false", async () => {
    expect(await clientIp("2", "production", "10.0.0.2", "203.0.113.7, 198.51.100.20, 10.0.0.9")).toBe("198.51.100.20");
    expect(await clientIp("127.0.0.1, 10.0.0.0/8", "production", "10.0.0.2", "203.0.113.7, 198.51.100.20")).toBe("198.51.100.20");
    expect(await clientIp("false", "production", "10.0.0.2", "198.51.100.20")).toBe("10.0.0.2");
    // "true" trusts every hop and takes the left-most entry, which a client can forge.
    expect(await clientIp("true", "production", "10.0.0.2", "203.0.113.7, 198.51.100.20")).toBe("203.0.113.7");
  });
});
