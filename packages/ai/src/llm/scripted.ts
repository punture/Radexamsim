import type { LlmProvider, PromptRole, StructuredRequest, StructuredResult } from "./types";
import { ZERO_USAGE } from "./types";

/**
 * Deterministic scripted provider for automated tests and offline development. Each role
 * maps to a handler receiving the parsed request. Handlers can return data, or simulate
 * malformed output, timeouts and refusals. Results are labelled `simulated`.
 */
export type ScriptedHandler = (req: StructuredRequest<unknown>, callIndex: number) =>
  | { kind: "data"; data: unknown }
  | { kind: "malformed" }
  | { kind: "timeout" }
  | { kind: "refusal" }
  | { kind: "error"; message: string };

export class ScriptedLlmProvider implements LlmProvider {
  readonly name = "scripted";
  readonly simulated = true;
  readonly calls: { role: PromptRole; userText: string }[] = [];
  private readonly counts = new Map<PromptRole, number>();

  constructor(private readonly handlers: Partial<Record<PromptRole, ScriptedHandler>>, private readonly latencyMs = 1) {}

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ role: req.role, userText: req.userText });
    const n = this.counts.get(req.role) ?? 0;
    this.counts.set(req.role, n + 1);
    const handler = this.handlers[req.role];
    if (!handler) return { ok: false, error: { kind: "not_configured", message: `no scripted handler for ${req.role}` }, usage: null, latencyMs: 0, servedModel: null };
    await new Promise((r) => setTimeout(r, this.latencyMs));
    const out = handler(req as StructuredRequest<unknown>, n);
    switch (out.kind) {
      case "timeout":
        return { ok: false, error: { kind: "timeout", message: "simulated timeout" }, usage: null, latencyMs: req.timeoutMs, servedModel: null };
      case "refusal":
        return { ok: false, error: { kind: "refused", message: "simulated refusal" }, usage: ZERO_USAGE, latencyMs: this.latencyMs, servedModel: "scripted" };
      case "error":
        return { ok: false, error: { kind: "provider_error", message: out.message }, usage: null, latencyMs: this.latencyMs, servedModel: null };
      case "malformed":
        return { ok: false, error: { kind: "invalid_output", message: "simulated malformed JSON" }, usage: ZERO_USAGE, latencyMs: this.latencyMs, servedModel: "scripted" };
      case "data": {
        const parsed = req.schema.safeParse(out.data);
        if (!parsed.success) {
          return { ok: false, error: { kind: "invalid_output", message: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, usage: ZERO_USAGE, latencyMs: this.latencyMs, servedModel: "scripted" };
        }
        return { ok: true, data: parsed.data, usage: ZERO_USAGE, latencyMs: this.latencyMs, servedModel: "scripted", stopReason: "end_turn" };
      }
    }
  }
}
