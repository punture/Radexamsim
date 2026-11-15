import path from "node:path";
import { AnthropicProvider, DEFAULT_ASSESSMENT_POLICY, type AssessmentPolicy, type CallTelemetry, type LlmProvider, type PromptRole } from "@sim/ai";
import { createDb, eq, modelCalls, systemConfig, type Db } from "@sim/db";
import { FIXTURE_MEDIA_DIR } from "@sim/fixtures";
import { LocalFsStorage, type ObjectStorage } from "@sim/storage";
import type { WorkerConfig } from "./config";

export type WorkerDeps = {
  config: WorkerConfig;
  db: Db;
  storage: ObjectStorage;
  /** Provider per role (tests may route roles to different scripted providers). */
  providerFor: (role: PromptRole) => LlmProvider | null;
  modelFor: (role: PromptRole) => string;
  now: () => Date;
  recordModelCall: (t: CallTelemetry, ctx: { sessionId?: string | null; caseAttemptId?: string | null; caseVersionId?: string | null }) => Promise<void>;
};

export function buildWorkerDeps(config: WorkerConfig, over: Partial<WorkerDeps> = {}): WorkerDeps {
  const db = over.db ?? createDb(config.DATABASE_URL);
  const anthropic = config.LLM_PROVIDER === "anthropic" && config.ANTHROPIC_API_KEY ? new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, enableServerSideFallbacks: config.LLM_SERVER_SIDE_FALLBACKS }) : null;
  const model: Record<PromptRole, string | undefined> = {
    case_author: config.MODEL_CASE_AUTHOR,
    clinical_critic: config.MODEL_CRITIC,
    rubric_critic: config.MODEL_CRITIC,
    live_examiner: undefined,
    evidence_extractor: config.MODEL_EVIDENCE_EXTRACTOR,
    assessor_a: config.MODEL_ASSESSOR_A,
    assessor_b: config.MODEL_ASSESSOR_B,
    adjudicator: config.MODEL_ADJUDICATOR,
    feedback_writer: config.MODEL_FEEDBACK_WRITER,
    learning_plan: config.MODEL_LEARNING_PLAN,
  };
  return {
    config,
    db,
    storage: over.storage ?? new LocalFsStorage(path.resolve(config.STORAGE_LOCAL_ROOT), config.ALLOW_FIXTURES ? { derivatives: FIXTURE_MEDIA_DIR } : {}),
    providerFor: over.providerFor ?? (() => anthropic),
    modelFor: over.modelFor ?? ((role) => model[role] ?? config.MODEL_DEFAULT),
    now: over.now ?? (() => new Date()),
    recordModelCall:
      over.recordModelCall ??
      (async (t, ctx) => {
        await db.insert(modelCalls).values({
          role: t.role,
          provider: t.provider,
          model: t.model,
          promptId: t.promptId,
          promptVersion: t.promptVersion,
          sessionId: ctx.sessionId ?? null,
          caseAttemptId: ctx.caseAttemptId ?? null,
          caseVersionId: ctx.caseVersionId ?? null,
          status: t.status,
          errorClass: t.errorClass,
          latencyMs: t.latencyMs,
          inputTokens: t.usage.inputTokens,
          outputTokens: t.usage.outputTokens,
          cacheReadTokens: t.usage.cacheReadTokens,
          cacheWriteTokens: t.usage.cacheWriteTokens,
          estimatedCostUsd: t.estimatedCostUsd,
        });
      }),
    ...over,
  } as WorkerDeps;
}

/** Owner-approved assessment policy; the default during the pilot is two passes always. */
export async function assessmentPolicy(db: Db): Promise<AssessmentPolicy> {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, "assessment_policy"));
  return { ...DEFAULT_ASSESSMENT_POLICY, ...((row?.value as Partial<AssessmentPolicy> | undefined) ?? {}) };
}

export async function assessmentLlmDisabled(db: Db): Promise<boolean> {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, "switches"));
  return ((row?.value as { assessmentLlmDisabled?: boolean } | undefined)?.assessmentLlmDisabled ?? false) === true;
}
