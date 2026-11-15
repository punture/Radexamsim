import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { LlmProvider, LlmUsage, StructuredRequest, StructuredResult } from "./types";

/**
 * Claude adapter using the official Anthropic SDK (structured outputs via
 * `client.beta.messages.parse` + `output_config.format`).
 *
 * - Thinking: adaptive (Claude Opus 5.5 cannot disable thinking; depth is set with
 *   `output_config.effort`). Thinking display stays at the API default ("omitted"), so no
 *   chain-of-thought text is returned or stored.
 * - Refusals: server-side fallbacks are enabled (`fallbacks: "default"`); the model that
 *   actually served the response is recorded from `response.model`. A final
 *   `stop_reason: "refusal"` is surfaced as an explicit unavailable result.
 * - Retries are owned by the runner (bounded), so the SDK's own retries are disabled.
 * - Model ids are configuration; nothing here hard-codes a model.
 */
export type AnthropicProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  enableServerSideFallbacks?: boolean;
};

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly simulated = false;
  private readonly client: Anthropic;
  private readonly fallbacks: boolean;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0 });
    this.fallbacks = opts.enableServerSideFallbacks ?? true;
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = performance.now();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const img of req.images ?? []) {
      content.push({ type: "text", text: `Image: ${img.label}` });
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
    content.push({ type: "text", text: req.userText });
    try {
      const response = await this.client.beta.messages.parse(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content }],
          thinking: { type: "adaptive" },
          output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
          ...(this.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { timeout: req.timeoutMs, maxRetries: 0, signal: req.signal },
      );
      const usage: LlmUsage = {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      const latencyMs = Math.round(performance.now() - started);
      if (response.stop_reason === "refusal") {
        return { ok: false, error: { kind: "refused", message: `model declined (${response.stop_details?.category ?? "unspecified"})` }, usage, latencyMs, servedModel: response.model };
      }
      if (response.stop_reason === "max_tokens") {
        return { ok: false, error: { kind: "invalid_output", message: "output truncated at max_tokens" }, usage, latencyMs, servedModel: response.model };
      }
      const parsed = response.parsed_output;
      if (parsed === null || parsed === undefined) {
        return { ok: false, error: { kind: "invalid_output", message: "structured output could not be parsed" }, usage, latencyMs, servedModel: response.model };
      }
      // Validate again with the caller's schema (defence in depth).
      const check = req.schema.safeParse(parsed);
      if (!check.success) {
        return { ok: false, error: { kind: "invalid_output", message: check.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, usage, latencyMs, servedModel: response.model };
      }
      return { ok: true, data: check.data, usage, latencyMs, servedModel: response.model, stopReason: response.stop_reason ?? "end_turn" };
    } catch (e) {
      const latencyMs = Math.round(performance.now() - started);
      if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, error: { kind: "timeout", message: "request timed out" }, usage: null, latencyMs, servedModel: null };
      if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: { kind: "not_configured", message: "authentication failed" }, usage: null, latencyMs, servedModel: null };
      if (e instanceof Anthropic.RateLimitError) return { ok: false, error: { kind: "provider_error", message: "rate limited" }, usage: null, latencyMs, servedModel: null };
      if (e instanceof Anthropic.BadRequestError) return { ok: false, error: { kind: "provider_error", message: `bad request: ${e.message.slice(0, 200)}` }, usage: null, latencyMs, servedModel: null };
      if (e instanceof Anthropic.APIError) return { ok: false, error: { kind: "provider_error", message: `api error ${e.status ?? ""}` }, usage: null, latencyMs, servedModel: null };
      if (e instanceof Error && e.name === "AbortError") return { ok: false, error: { kind: "timeout", message: "aborted" }, usage: null, latencyMs, servedModel: null };
      return { ok: false, error: { kind: "provider_error", message: e instanceof Error ? e.message.slice(0, 200) : "unknown error" }, usage: null, latencyMs, servedModel: null };
    }
  }
}
