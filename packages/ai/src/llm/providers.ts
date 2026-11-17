import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import type { LlmProvider } from "./types";

/** Language-model providers the API, the worker and the evals CLI can use (LLM_PROVIDER). */
export const LLM_PROVIDERS = ["anthropic", "gemini", "none"] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/** Model for every role without a MODEL_* override, when MODEL_DEFAULT is not set. */
export const DEFAULT_MODEL: Record<Exclude<LlmProviderName, "none">, string> = {
  anthropic: "claude-opus-5-5",
  gemini: "gemini-4-hydrogen",
};

export type LlmSettings = {
  LLM_PROVIDER: LlmProviderName;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  LLM_SERVER_SIDE_FALLBACKS?: boolean;
};

/** The configured adapter, or null when the provider is "none" or its key is missing. */
export function createLlmProvider(s: LlmSettings): LlmProvider | null {
  if (s.LLM_PROVIDER === "anthropic" && s.ANTHROPIC_API_KEY) {
    return new AnthropicProvider({ apiKey: s.ANTHROPIC_API_KEY, enableServerSideFallbacks: s.LLM_SERVER_SIDE_FALLBACKS ?? true });
  }
  if (s.LLM_PROVIDER === "gemini" && s.GEMINI_API_KEY) return new GeminiProvider({ apiKey: s.GEMINI_API_KEY });
  return null;
}

/**
 * Startup checks shared by the API, the worker and the evals CLI: the chosen provider's key is
 * set, and no configured model id belongs to the other provider, which would fail every call.
 */
export function llmSettingsProblems(s: LlmSettings, modelIds: readonly (string | undefined)[]): string[] {
  const problems: string[] = [];
  if (s.LLM_PROVIDER === "anthropic" && !s.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY is required for LLM_PROVIDER=anthropic");
  if (s.LLM_PROVIDER === "gemini" && !s.GEMINI_API_KEY) problems.push("GEMINI_API_KEY is required for LLM_PROVIDER=gemini");
  const foreign = s.LLM_PROVIDER === "anthropic" ? "gemini-" : s.LLM_PROVIDER === "gemini" ? "claude-" : null;
  const wrong = [...new Set(modelIds.filter((m): m is string => !!foreign && !!m && m.startsWith(foreign)))];
  if (wrong.length) problems.push(`LLM_PROVIDER=${s.LLM_PROVIDER} cannot serve ${wrong.join(", ")}: change MODEL_DEFAULT or the MODEL_* overrides`);
  return problems;
}
