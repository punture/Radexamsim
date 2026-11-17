import { z } from "zod";
import { DEFAULT_MODEL, LLM_PROVIDERS, llmSettingsProblems } from "@sim/ai";
import { StorageEnvSchema, checkStorageEnv } from "@sim/storage";

const bool = (d: boolean) => z.enum(["true", "false", "1", "0"]).default(d ? "true" : "false").transform((v) => v === "true" || v === "1");

/** Worker configuration. Model ids are configuration; nothing hard-codes a model. */
export const WorkerConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgres://sim:sim_dev_password@127.0.0.1:5432/sim_dev"),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  LLM_SERVER_SIDE_FALLBACKS: bool(true),
  /** Only development fixtures reach the model (for a key whose provider may reuse content). Refused in production. */
  LLM_FIXTURES_ONLY: bool(false),
  /** When unset, loadWorkerConfig uses the provider's default (DEFAULT_MODEL in @sim/ai). */
  MODEL_DEFAULT: z.string().default(DEFAULT_MODEL.anthropic),
  MODEL_EVIDENCE_EXTRACTOR: z.string().optional(),
  MODEL_ASSESSOR_A: z.string().optional(),
  /** May be a different model (or, with an additional adapter, a different family). */
  MODEL_ASSESSOR_B: z.string().optional(),
  MODEL_ADJUDICATOR: z.string().optional(),
  MODEL_FEEDBACK_WRITER: z.string().optional(),
  MODEL_LEARNING_PLAN: z.string().optional(),
  MODEL_CASE_AUTHOR: z.string().optional(),
  MODEL_CRITIC: z.string().optional(),
  /** Development only: allow the labelled lexical baseline when no model is configured. */
  ALLOW_DEV_BASELINE_ASSESSOR: bool(false),
  ASSESSMENT_SPEND_CAP_USD: z.coerce.number().default(5),
  USE_LLM_FEEDBACK_SUMMARY: bool(true),
  /** STORAGE_DRIVER, STORAGE_LOCAL_ROOT and S3_*: shared with the API (packages/storage). */
  ...StorageEnvSchema.shape,
  ALLOW_FIXTURES: bool(true),
  RECORDING_RETENTION_DAYS: z.coerce.number().int().default(30),
  EXPORT_RETENTION_DAYS: z.coerce.number().int().default(7),
});
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function loadWorkerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const c = WorkerConfigSchema.parse(env);
  if (c.LLM_PROVIDER !== "none" && !env.MODEL_DEFAULT) c.MODEL_DEFAULT = DEFAULT_MODEL[c.LLM_PROVIDER];
  if (c.NODE_ENV === "production" && c.ALLOW_DEV_BASELINE_ASSESSOR) throw new Error("ALLOW_DEV_BASELINE_ASSESSOR must be false in production");
  if (c.NODE_ENV === "production" && c.LLM_FIXTURES_ONLY) throw new Error("LLM_FIXTURES_ONLY must be false in production");
  const llmProblems = llmSettingsProblems(c, [
    c.MODEL_DEFAULT,
    c.MODEL_EVIDENCE_EXTRACTOR,
    c.MODEL_ASSESSOR_A,
    c.MODEL_ASSESSOR_B,
    c.MODEL_ADJUDICATOR,
    c.MODEL_FEEDBACK_WRITER,
    c.MODEL_LEARNING_PLAN,
    c.MODEL_CASE_AUTHOR,
    c.MODEL_CRITIC,
  ]);
  if (llmProblems.length) throw new Error(llmProblems.join("; "));
  checkStorageEnv(c, c.NODE_ENV);
  return c;
}
