import { z } from "zod";
import type { Effort, LlmErrorKind, LlmProvider, LlmUsage, StructuredRequest, StructuredResult } from "./types";

/**
 * Google Gemini adapter, written for Gemini 4 Hydrogen (`gemini-4-hydrogen`), using the
 * Interactions API (`POST /v1/interactions`).
 *
 * STATUS: written from Google's documentation read on 2026-11-16 (Interactions API v1
 * reference, structured-output and thinking guides). It has NOT been called against the live
 * API (no key in the build environment); the tests run it against a local mock server.
 *
 * - Structured output: `response_format` carries a JSON schema built from the caller's Zod
 *   schema and reduced to the keywords Google documents (`toGeminiSchema`). The reply is then
 *   checked with the full Zod schema, which enforces what the API ignores (string lengths,
 *   patterns, boolean literals).
 * - Thinking: the role's effort maps to `thinking_level`. `thinking_summaries` is "none" and
 *   thought steps are never read, so no reasoning text is returned or stored.
 * - Privacy: `store: false`, because the API otherwise keeps each interaction for later
 *   retrieval. The key travels in the `x-goog-api-key` header, never in the URL.
 * - Images: refused. No caller sends any, and silently dropping them would let a model answer
 *   without the images it was meant to see.
 * - Retries are owned by the runner. Model ids are configuration.
 */
export type GeminiProviderOptions = { apiKey: string; baseUrl?: string };

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1";

type Interaction = {
  model?: unknown;
  status?: unknown;
  steps?: { type?: unknown; content?: { type?: unknown; text?: unknown }[] }[];
  usage?: Record<string, unknown>;
  errors?: { code?: unknown; message?: unknown }[];
};

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  readonly simulated = false;
  private readonly baseUrl: string;

  constructor(private readonly opts: GeminiProviderOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    if (req.images?.length) {
      return { ok: false, error: { kind: "not_configured", message: "the Gemini adapter does not send images" }, usage: null, latencyMs: 0, servedModel: null };
    }
    const body = {
      model: req.model,
      system_instruction: req.system,
      input: req.userText,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: toGeminiSchema(z.toJSONSchema(req.schema, { target: "draft-2020-12", unrepresentable: "any", io: "input" })),
      },
      generation_config: { thinking_level: thinkingLevel(req.model, req.effort), thinking_summaries: "none", max_output_tokens: req.maxTokens },
      store: false,
    };
    const timeout = AbortSignal.timeout(req.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/interactions`, {
        method: "POST",
        headers: { "x-goog-api-key": this.opts.apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal ? AbortSignal.any([timeout, req.signal]) : timeout,
      });
      if (!res.ok) return { ok: false, error: await httpError(res), usage: null, latencyMs: elapsed(), servedModel: null };
      const interaction = (await res.json()) as Interaction;
      const usage = usageOf(interaction.usage);
      const servedModel = typeof interaction.model === "string" && interaction.model ? interaction.model : req.model;
      const fail = (kind: LlmErrorKind, message: string): StructuredResult<T> => ({ ok: false, error: { kind, message }, usage, latencyMs: elapsed(), servedModel });
      if (interaction.status === "incomplete") return fail("invalid_output", "output truncated (status incomplete, usually max_output_tokens)");
      if (interaction.status === "failed") {
        const detail = describeErrors(interaction.errors);
        return fail(/safety|block|prohibit|recitation/i.test(detail) ? "refused" : "provider_error", `interaction failed: ${detail}`);
      }
      if (interaction.status !== "completed") return fail("provider_error", `unexpected interaction status: ${String(interaction.status).slice(0, 40)}`);
      const text = finalText(interaction.steps);
      if (!text) return fail("invalid_output", "the interaction returned no output text");
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripCodeFence(text));
      } catch {
        return fail("invalid_output", "structured output was not valid JSON");
      }
      const check = req.schema.safeParse(parsed);
      if (!check.success) return fail("invalid_output", check.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return { ok: true, data: check.data, usage, latencyMs: elapsed(), servedModel, stopReason: "completed" };
    } catch (e) {
      const name = typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
      if (name === "TimeoutError") return { ok: false, error: { kind: "timeout", message: "request timed out" }, usage: null, latencyMs: elapsed(), servedModel: null };
      if (name === "AbortError") return { ok: false, error: { kind: "timeout", message: "aborted" }, usage: null, latencyMs: elapsed(), servedModel: null };
      return { ok: false, error: { kind: "provider_error", message: e instanceof Error ? e.message.slice(0, 200) : "unknown error" }, usage: null, latencyMs: elapsed(), servedModel: null };
    }
  }
}

/** Gemini 4 Hydrogen accepts low, medium, high and xhigh; other current Gemini models stop at high. */
export function thinkingLevel(model: string, effort: Effort): "low" | "medium" | "high" | "xhigh" {
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  return model.startsWith("gemini-4-hydrogen") ? "xhigh" : "high";
}

const SCHEMA_KEYWORDS = new Set([
  "type",
  "title",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "enum",
  "format",
  "minimum",
  "maximum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "anyOf",
  "$ref",
  "$defs",
]);
const SCHEMA_FORMATS = new Set(["date-time", "date", "time"]);

/**
 * Reduces a JSON Schema (draft 2020-12, from `z.toJSONSchema`) to the keywords Google documents
 * for structured output. `oneOf` becomes `anyOf`, and a string or number `const` becomes a
 * one-value `enum`. Everything else is dropped; the Zod check still enforces it.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" || key === "$defs") {
      if (value && typeof value === "object") out[key] = Object.fromEntries(Object.entries(value).map(([name, s]) => [name, toGeminiSchema(s)]));
    } else if (key === "anyOf" || key === "oneOf" || key === "prefixItems") {
      if (Array.isArray(value)) out[key === "oneOf" ? "anyOf" : key] = value.map(toGeminiSchema);
    } else if (key === "items" || key === "additionalProperties") {
      out[key] = typeof value === "boolean" ? value : toGeminiSchema(value);
    } else if (key === "const") {
      if (typeof value === "string" || typeof value === "number") out.enum = [value];
    } else if (key === "format") {
      if (typeof value === "string" && SCHEMA_FORMATS.has(value)) out.format = value;
    } else if (SCHEMA_KEYWORDS.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

/** Text of the last model_output step. Thought steps (signatures, summaries) are never read. */
function finalText(steps: Interaction["steps"]): string {
  const outputs = (Array.isArray(steps) ? steps : []).filter((s) => s?.type === "model_output");
  const content = outputs[outputs.length - 1]?.content;
  return (Array.isArray(content) ? content : [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

/** Thinking tokens are billed as output. Cached tokens are taken to be part of total_input_tokens. */
function usageOf(u: Interaction["usage"]): LlmUsage {
  const n = (key: string) => {
    const v = u?.[key];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  };
  const input = n("total_input_tokens");
  const cached = Math.min(n("total_cached_tokens"), input);
  return { inputTokens: input - cached, outputTokens: n("total_output_tokens") + n("total_thought_tokens"), cacheReadTokens: cached, cacheWriteTokens: 0 };
}

async function httpError(res: Response): Promise<{ kind: LlmErrorKind; message: string }> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") detail = `: ${body.error.message.slice(0, 200)}`;
  } catch {
    // Not JSON: report the status only.
  }
  if (res.status === 401 || res.status === 403) return { kind: "not_configured", message: `authentication failed (HTTP ${res.status})` };
  if (res.status === 404) return { kind: "not_configured", message: `model or endpoint not found (HTTP 404)${detail}` };
  if (res.status === 429) return { kind: "provider_error", message: "rate limited" };
  if (res.status === 400) return { kind: "provider_error", message: `bad request${detail}` };
  return { kind: "provider_error", message: `api error ${res.status}` };
}

function describeErrors(errors: Interaction["errors"]): string {
  const text = (Array.isArray(errors) ? errors : [])
    .map((e) => [e?.code, e?.message].filter((x): x is string => typeof x === "string" && x.length > 0).join(" "))
    .filter(Boolean)
    .join("; ");
  return (text || "no error detail").slice(0, 200);
}

function stripCodeFence(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return m ? m[1]! : text;
}
