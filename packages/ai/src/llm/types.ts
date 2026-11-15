import type { z } from "zod";

/**
 * Text/vision model provider interface (spec §9, §15). Providers return validated,
 * structured outputs only. They never execute model-emitted code and never receive tools
 * with side effects: the application validates every proposed action itself.
 */

export type PromptRole =
  | "case_author"
  | "clinical_critic"
  | "rubric_critic"
  | "live_examiner"
  | "evidence_extractor"
  | "assessor_a"
  | "assessor_b"
  | "adjudicator"
  | "feedback_writer"
  | "learning_plan";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type LlmImage = { mediaType: "image/png" | "image/jpeg" | "image/webp"; base64: string; label: string };

export type StructuredRequest<T> = {
  role: PromptRole;
  model: string;
  system: string;
  /** User content as text (JSON-serialized DTO) plus optional images. */
  userText: string;
  images?: LlmImage[];
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
  effort: Effort;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type LlmErrorKind = "timeout" | "provider_error" | "refused" | "invalid_output" | "disabled" | "budget_exceeded" | "not_configured";

export type LlmUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type StructuredResult<T> =
  | { ok: true; data: T; usage: LlmUsage; latencyMs: number; servedModel: string; stopReason: string }
  | { ok: false; error: { kind: LlmErrorKind; message: string }; usage: LlmUsage | null; latencyMs: number; servedModel: string | null };

export interface LlmProvider {
  readonly name: string;
  /** True when this provider is a deterministic/mock stand-in (never a live model). */
  readonly simulated: boolean;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
