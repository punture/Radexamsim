import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuthorOutput,
  CritiqueOutput,
  DEFAULT_PRICES,
  ExaminerProposalLlm,
  FeedbackWriterOutput,
  GeminiProvider,
  LearningPlanExplainerOutput,
  adjudicatorOutputSchema,
  assessorOutputSchema,
  createLlmProvider,
  estimateCostUsd,
  extractorOutputSchema,
  llmSettingsProblems,
  priceFor,
  thinkingLevel,
  toGeminiSchema,
  type StructuredRequest,
} from "../src";

/**
 * The Gemini adapter against a local mock of the Interactions API. These tests check the
 * request we send and how replies are mapped; they say nothing about the live service.
 */
type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };
let server: Server;
let baseUrl: string;
let seen: Seen[] = [];
let reply: (res: ServerResponse) => void = () => {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") });
      reply(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  seen = [];
});

const json = (status: number, body: unknown) => (res: ServerResponse) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const Out = z.object({ action: z.enum(["wait", "ask"]), note: z.string().max(20) });
type Out = z.infer<typeof Out>;
const request = (over: Partial<StructuredRequest<Out>> = {}): StructuredRequest<Out> => ({
  role: "live_examiner",
  model: "gemini-4-hydrogen",
  system: "SYSTEM TEXT",
  userText: '{"turn":1}',
  schema: Out,
  schemaName: "examiner_action",
  maxTokens: 2000,
  effort: "low",
  timeoutMs: 2000,
  ...over,
});
const provider = () => new GeminiProvider({ apiKey: "test-key", baseUrl });
const interaction = (text: string, extra: Record<string, unknown> = {}) => ({
  id: "int-1",
  model: "gemini-4-hydrogen",
  status: "completed",
  steps: [
    { type: "thought", signature: "sig", summary: [{ type: "text", text: "PRIVATE THOUGHT" }] },
    { type: "model_output", content: [{ type: "text", text }] },
  ],
  usage: { total_input_tokens: 1000, total_cached_tokens: 200, total_output_tokens: 50, total_thought_tokens: 150, total_tokens: 1200 },
  ...extra,
});

describe("GeminiProvider", () => {
  it("sends a stateless, schema-constrained request and returns validated data", async () => {
    reply = json(200, interaction('{"action":"wait","note":"still thinking"}'));
    const r = await provider().generateStructured(request());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ action: "wait", note: "still thinking" });
    expect(r.servedModel).toBe("gemini-4-hydrogen");
    expect(r.usage).toEqual({ inputTokens: 800, cacheReadTokens: 200, outputTokens: 200, cacheWriteTokens: 0 });
    expect(JSON.stringify(r)).not.toContain("PRIVATE THOUGHT");

    expect(seen).toHaveLength(1);
    const s = seen[0]!;
    expect(s.method).toBe("POST");
    expect(s.url).toBe("/v1/interactions");
    expect(s.headers["x-goog-api-key"]).toBe("test-key");
    expect(s.body).toMatchObject({
      model: "gemini-4-hydrogen",
      system_instruction: "SYSTEM TEXT",
      input: '{"turn":1}',
      store: false,
      generation_config: { thinking_level: "low", thinking_summaries: "none", max_output_tokens: 2000 },
      response_format: { type: "text", mime_type: "application/json" },
    });
    const schema = (s.body.response_format as { schema: Record<string, unknown> }).schema;
    expect(schema).toMatchObject({ type: "object", required: ["action", "note"], properties: { action: { type: "string", enum: ["wait", "ask"] }, note: { type: "string" } } });
    expect(JSON.stringify(schema)).not.toMatch(/maxLength|\$schema/);
  });

  it("enforces the full Zod schema, including limits Google ignores", async () => {
    reply = json(200, interaction('{"action":"wait","note":"a note that is far longer than twenty characters"}'));
    const r = await provider().generateStructured(request());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("invalid_output");
    expect(r.error.message).toContain("note");
    expect(r.usage).not.toBeNull();
  });

  it("rejects text that is not JSON and accepts JSON inside a code fence", async () => {
    reply = json(200, interaction("I would wait."));
    const bad = await provider().generateStructured(request());
    expect(!bad.ok && bad.error.kind).toBe("invalid_output");
    reply = json(200, interaction('```json\n{"action":"ask","note":""}\n```'));
    const fenced = await provider().generateStructured(request());
    expect(fenced.ok && fenced.data).toEqual({ action: "ask", note: "" });
  });

  it("maps interaction statuses", async () => {
    reply = json(200, interaction("", { status: "incomplete" }));
    const incomplete = await provider().generateStructured(request());
    expect(!incomplete.ok && incomplete.error.kind).toBe("invalid_output");

    reply = json(200, interaction("", { status: "failed", errors: [{ code: "https://errors.example/safety", message: "Response blocked for safety" }] }));
    const blocked = await provider().generateStructured(request());
    expect(!blocked.ok && blocked.error.kind).toBe("refused");

    reply = json(200, interaction("", { status: "failed", errors: [{ message: "internal" }] }));
    const failed = await provider().generateStructured(request());
    expect(!failed.ok && failed.error.kind).toBe("provider_error");

    reply = json(200, interaction("", { status: "requires_action" }));
    const odd = await provider().generateStructured(request());
    expect(!odd.ok && odd.error.kind).toBe("provider_error");
  });

  it("maps HTTP errors", async () => {
    const kindFor = async (status: number, body: unknown = {}) => {
      reply = json(status, body);
      const r = await provider().generateStructured(request());
      return r.ok ? "ok" : `${r.error.kind}: ${r.error.message}`;
    };
    expect(await kindFor(401)).toMatch(/^not_configured/);
    expect(await kindFor(403)).toMatch(/^not_configured/);
    expect(await kindFor(404, { error: { message: "model not found" } })).toMatch(/^not_configured: .*model not found/);
    expect(await kindFor(429)).toBe("provider_error: rate limited");
    expect(await kindFor(400, { error: { message: "schema too complex" } })).toBe("provider_error: bad request: schema too complex");
    expect(await kindFor(503)).toBe("provider_error: api error 503");
  });

  it("times out", async () => {
    reply = (res) => setTimeout(() => json(200, interaction('{"action":"wait","note":""}'))(res), 1000);
    const r = await provider().generateStructured(request({ timeoutMs: 50 }));
    expect(!r.ok && r.error.kind).toBe("timeout");
  });

  it("refuses images without calling the API", async () => {
    const r = await provider().generateStructured(request({ images: [{ mediaType: "image/png", base64: "AAAA", label: "axial" }] }));
    expect(!r.ok && r.error.kind).toBe("not_configured");
    expect(seen).toHaveLength(0);
  });

  it("maps effort to Gemini thinking levels", () => {
    expect(thinkingLevel("gemini-4-hydrogen", "low")).toBe("low");
    expect(thinkingLevel("gemini-4-hydrogen", "medium")).toBe("medium");
    expect(thinkingLevel("gemini-4-hydrogen", "high")).toBe("high");
    expect(thinkingLevel("gemini-4-hydrogen", "xhigh")).toBe("xhigh");
    expect(thinkingLevel("gemini-4-hydrogen", "max")).toBe("xhigh");
    expect(thinkingLevel("gemini-3.8-flash", "max")).toBe("high");
  });
});

describe("toGeminiSchema", () => {
  const ALLOWED = new Set(["type", "title", "description", "properties", "required", "additionalProperties", "enum", "format", "minimum", "maximum", "items", "prefixItems", "minItems", "maxItems", "anyOf", "$ref", "$defs"]);
  const unsupported = (node: unknown, at = "$"): string[] => {
    if (Array.isArray(node)) return node.flatMap((n, i) => unsupported(n, `${at}[${i}]`));
    if (!node || typeof node !== "object") return [];
    const found: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (!ALLOWED.has(key)) found.push(`${at}.${key}`);
      if (key === "format" && !["date-time", "date", "time"].includes(String(value))) found.push(`${at}.format=${String(value)}`);
      if (key === "properties" || key === "$defs") for (const [name, s] of Object.entries(value as object)) found.push(...unsupported(s, `${at}.${key}.${name}`));
      else if (key === "items" || key === "additionalProperties" || key === "anyOf" || key === "prefixItems") found.push(...unsupported(value, `${at}.${key}`));
    }
    return found;
  };
  const toJson = (s: z.ZodType) => z.toJSONSchema(s, { target: "draft-2020-12", unrepresentable: "any", io: "input" });

  it("leaves only documented keywords in every prompt's output schema", () => {
    const schemas: Record<string, z.ZodType> = {
      examiner: ExaminerProposalLlm,
      author: AuthorOutput,
      critic: CritiqueOutput,
      feedback: FeedbackWriterOutput,
      plan: LearningPlanExplainerOutput,
      extractor: extractorOutputSchema(["seg-1", "seg-2"]),
      assessor: assessorOutputSchema(["el-1", "el-2"], ["seg-1"], ["opp-1", "opp-2"]),
      adjudicator: adjudicatorOutputSchema(["el-1"], ["seg-1"]),
    };
    for (const [name, s] of Object.entries(schemas)) {
      const g = toGeminiSchema(toJson(s)) as Record<string, unknown>;
      expect(unsupported(g), name).toEqual([]);
      expect(g.type, name).toBe("object");
      expect(Array.isArray(g.required) && g.required.length > 0, name).toBe(true);
    }
  });

  it("converts const and oneOf and drops what Google does not document", () => {
    const input = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        a: { type: "string", const: "A" },
        b: { oneOf: [{ type: "string", pattern: "^x" }, { type: "null" }] },
        c: { type: "string", format: "uuid", minLength: 1 },
        d: { type: "string", format: "date-time" },
        e: { type: "boolean", const: true },
        f: { type: "array", items: { type: "integer", exclusiveMinimum: 0, maximum: 9 }, minItems: 1, uniqueItems: true },
      },
      required: ["a"],
      additionalProperties: false,
    };
    expect(toGeminiSchema(input)).toEqual({
      type: "object",
      properties: {
        a: { type: "string", enum: ["A"] },
        b: { anyOf: [{ type: "string" }, { type: "null" }] },
        c: { type: "string" },
        d: { type: "string", format: "date-time" },
        e: { type: "boolean" },
        f: { type: "array", items: { type: "integer", maximum: 9 }, minItems: 1 },
      },
      required: ["a"],
      additionalProperties: false,
    });
  });
});

describe("provider selection and pricing", () => {
  it("builds the configured adapter only when its key is set", () => {
    expect(createLlmProvider({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" })?.name).toBe("gemini");
    expect(createLlmProvider({ LLM_PROVIDER: "gemini" })).toBeNull();
    expect(createLlmProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })?.name).toBe("anthropic");
    expect(createLlmProvider({ LLM_PROVIDER: "none", GEMINI_API_KEY: "k", ANTHROPIC_API_KEY: "k" })).toBeNull();
  });

  it("reports a missing key and model ids from the other provider", () => {
    expect(llmSettingsProblems({ LLM_PROVIDER: "gemini" }, ["gemini-4-hydrogen"])).toEqual(["GEMINI_API_KEY is required for LLM_PROVIDER=gemini"]);
    expect(llmSettingsProblems({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" }, ["gemini-4-hydrogen", "claude-opus-5-5", undefined])[0]).toMatch(/cannot serve claude-opus-5-5/);
    expect(llmSettingsProblems({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }, ["gemini-4-hydrogen"])[0]).toMatch(/cannot serve gemini-4-hydrogen/);
    expect(llmSettingsProblems({ LLM_PROVIDER: "none" }, ["claude-opus-5-5", "gemini-4-hydrogen"])).toEqual([]);
  });

  it("prices Gemini 4 Hydrogen, including versioned served ids", () => {
    const million = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(estimateCostUsd("gemini-4-hydrogen", million)).toBeCloseTo(9);
    expect(priceFor("gemini-4-hydrogen-001")).toEqual(DEFAULT_PRICES["gemini-4-hydrogen"]);
    expect(priceFor("claude-opus-5-5")).toEqual(DEFAULT_PRICES["claude-opus-5-5"]);
    expect(priceFor("gemini-4-hydrogenx")).toBeUndefined();
    expect(estimateCostUsd("unknown-model", million)).toBe(0);
  });
});
