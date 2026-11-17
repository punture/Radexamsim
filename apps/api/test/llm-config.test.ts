import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("API model-provider settings", () => {
  it("uses Gemini 4 Hydrogen by default when LLM_PROVIDER=gemini", () => {
    expect(loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" }).MODEL_DEFAULT).toBe("gemini-4-hydrogen");
    expect(loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k", MODEL_DEFAULT: "gemini-4-hydrogen-001" }).MODEL_DEFAULT).toBe("gemini-4-hydrogen-001");
  });

  it("keeps the Anthropic default for anthropic and none", () => {
    expect(loadConfig({ NODE_ENV: "test" }).MODEL_DEFAULT).toBe("claude-opus-5-5");
    expect(loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }).MODEL_DEFAULT).toBe("claude-opus-5-5");
  });

  it("refuses LLM_FIXTURES_ONLY in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k", LLM_FIXTURES_ONLY: "true" })).toThrow(/LLM_FIXTURES_ONLY is for development keys/);
  });

  it("refuses a missing key or a model id from the other provider", () => {
    expect(() => loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY is required/);
    expect(() => loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k", MODEL_LIVE_EXAMINER: "claude-haiku-5-5" })).toThrow(/cannot serve claude-haiku-5-5/);
    expect(() => loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", MODEL_DEFAULT: "gemini-4-hydrogen" })).toThrow(/cannot serve gemini-4-hydrogen/);
  });
});
