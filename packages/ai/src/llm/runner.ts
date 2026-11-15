import type { z } from "zod";
import type { Effort, LlmErrorKind, LlmProvider, LlmUsage, PromptRole, StructuredResult } from "./types";

/**
 * Structured-call runner (spec §15): timeouts, bounded retries, bounded schema repair,
 * per-session spend caps, kill switches and telemetry. Malformed output leads to a
 * controlled retry or an explicit unavailable result — never silent acceptance.
 */

export type PromptDefinition<I, O> = {
  id: string;
  version: string;
  role: PromptRole;
  inputSchema: z.ZodType<I>;
  buildOutputSchema: (input: I) => z.ZodType<O>;
  schemaName: string;
  defaults: { effort: Effort; maxTokens: number; timeoutMs: number; maxAttempts: number; maxSchemaRepairs: number };
  render: (input: I) => { system: string; user: string };
};

export type RoleRouting = { provider: LlmProvider | null; model: string; effort?: Effort; timeoutMs?: number };

export type CallTelemetry = {
  role: PromptRole;
  provider: string;
  model: string;
  promptId: string;
  promptVersion: string;
  status: "ok" | "invalid_output" | "timeout" | "provider_error" | "refused" | "budget_exceeded" | "disabled";
  errorClass: string | null;
  latencyMs: number;
  usage: LlmUsage;
  estimatedCostUsd: number;
  attempt: number;
  simulated: boolean;
};

/** USD per million tokens. Configurable; defaults from the Claude API reference (2026-11). */
export type PriceTable = Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
export const DEFAULT_PRICES: PriceTable = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function estimateCostUsd(model: string, u: LlmUsage, prices: PriceTable = DEFAULT_PRICES): number {
  const p = prices[model];
  if (!p) return 0;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
}

export class SpendTracker {
  private spent = 0;
  constructor(readonly capUsd: number) {}
  get totalUsd(): number {
    return this.spent;
  }
  canSpend(): boolean {
    return this.spent < this.capUsd;
  }
  add(usd: number): void {
    this.spent += usd;
  }
}

export type RunContext = {
  routing: RoleRouting;
  spend?: SpendTracker;
  disabled?: boolean;
  prices?: PriceTable;
  onTelemetry?: (t: CallTelemetry) => void | Promise<void>;
  signal?: AbortSignal;
};

export type RunResult<O> =
  | { ok: true; data: O; provenance: { provider: string; model: string; promptId: string; promptVersion: string; simulated: boolean }; latencyMs: number; attempts: number }
  | { ok: false; reason: LlmErrorKind; message: string; provenance: { provider: string; model: string; promptId: string; promptVersion: string; simulated: boolean } | null; attempts: number };

export async function runPrompt<I, O>(def: PromptDefinition<I, O>, rawInput: I, ctx: RunContext): Promise<RunResult<O>> {
  const input = def.inputSchema.parse(rawInput);
  const provider = ctx.routing.provider;
  const prov = provider
    ? { provider: provider.name, model: ctx.routing.model, promptId: def.id, promptVersion: def.version, simulated: provider.simulated }
    : null;
  if (!provider) return { ok: false, reason: "not_configured", message: `no provider configured for ${def.role}`, provenance: null, attempts: 0 };
  const emit = async (t: Omit<CallTelemetry, "role" | "provider" | "promptId" | "promptVersion" | "simulated">) => {
    if (ctx.onTelemetry) await ctx.onTelemetry({ ...t, role: def.role, provider: provider.name, promptId: def.id, promptVersion: def.version, simulated: provider.simulated });
  };
  if (ctx.disabled) {
    await emit({ model: ctx.routing.model, status: "disabled", errorClass: "kill_switch", latencyMs: 0, usage: zero(), estimatedCostUsd: 0, attempt: 0 });
    return { ok: false, reason: "disabled", message: `${def.role} is disabled by kill switch`, provenance: prov, attempts: 0 };
  }
  const schema = def.buildOutputSchema(input);
  const { system, user } = def.render(input);
  let repairNote = "";
  let attempts = 0;
  let schemaRepairs = 0;
  let lastError: { kind: LlmErrorKind; message: string } = { kind: "provider_error", message: "not attempted" };
  while (attempts < def.defaults.maxAttempts) {
    if (ctx.spend && !ctx.spend.canSpend()) {
      await emit({ model: ctx.routing.model, status: "budget_exceeded", errorClass: "spend_cap", latencyMs: 0, usage: zero(), estimatedCostUsd: 0, attempt: attempts });
      return { ok: false, reason: "budget_exceeded", message: "per-session spend cap reached", provenance: prov, attempts };
    }
    attempts++;
    const res: StructuredResult<O> = await provider.generateStructured({
      role: def.role,
      model: ctx.routing.model,
      system,
      userText: repairNote ? `${user}\n\n${repairNote}` : user,
      schema,
      schemaName: def.schemaName,
      maxTokens: def.defaults.maxTokens,
      effort: ctx.routing.effort ?? def.defaults.effort,
      timeoutMs: ctx.routing.timeoutMs ?? def.defaults.timeoutMs,
      signal: ctx.signal,
    });
    const usage = res.usage ?? zero();
    const servedModel = res.servedModel ?? ctx.routing.model;
    const cost = estimateCostUsd(servedModel, usage, ctx.prices);
    ctx.spend?.add(cost);
    if (res.ok) {
      await emit({ model: servedModel, status: "ok", errorClass: null, latencyMs: res.latencyMs, usage, estimatedCostUsd: cost, attempt: attempts });
      return { ok: true, data: res.data, provenance: { ...prov!, model: servedModel }, latencyMs: res.latencyMs, attempts };
    }
    lastError = res.error;
    await emit({
      model: servedModel,
      status: res.error.kind === "not_configured" ? "provider_error" : (res.error.kind as CallTelemetry["status"]),
      errorClass: res.error.kind,
      latencyMs: res.latencyMs,
      usage,
      estimatedCostUsd: cost,
      attempt: attempts,
    });
    if (res.error.kind === "refused" || res.error.kind === "not_configured" || res.error.kind === "disabled") break;
    if (res.error.kind === "invalid_output") {
      if (schemaRepairs >= def.defaults.maxSchemaRepairs) break;
      schemaRepairs++;
      repairNote = `Your previous response was rejected by validation (${res.error.message}). Return a response that matches the required schema exactly. Do not add fields.`;
    }
  }
  return { ok: false, reason: lastError.kind, message: lastError.message, provenance: prov, attempts };
}

function zero(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
