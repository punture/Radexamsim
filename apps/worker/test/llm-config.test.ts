import { describe, expect, it } from "vitest";
import { buildWorkerDeps } from "../src/deps";
import { loadWorkerConfig } from "../src/config";

describe("worker model-provider settings", () => {
  it("routes every role to Gemini 4 Hydrogen when LLM_PROVIDER=gemini", () => {
    const config = loadWorkerConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://unused@127.0.0.1:1/unused", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
    const deps = buildWorkerDeps(config, { db: {} as never, storage: {} as never });
    expect(deps.providerFor("assessor_a")?.name).toBe("gemini");
    expect(deps.modelFor("assessor_b")).toBe("gemini-4-hydrogen");
    expect(deps.modelFor("case_author")).toBe("gemini-4-hydrogen");
  });

  it("refuses a missing key or a Claude override", () => {
    expect(() => loadWorkerConfig({ NODE_ENV: "test", LLM_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY is required/);
    expect(() => loadWorkerConfig({ NODE_ENV: "test", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k", MODEL_ASSESSOR_B: "claude-opus-5-5" })).toThrow(/cannot serve claude-opus-5-5/);
  });
});
