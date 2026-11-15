import { z } from "zod";

const bool = (d: boolean) => z.enum(["true", "false", "1", "0"]).default(d ? "true" : "false").transform((v) => v === "true" || v === "1");

/** Worker configuration. Model ids are configuration; nothing hard-codes a model. */
export const WorkerConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgres://sim:sim_dev_password@127.0.0.1:5432/sim_dev"),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  LLM_PROVIDER: z.enum(["anthropic", "none"]).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_SERVER_SIDE_FALLBACKS: bool(true),
  MODEL_DEFAULT: z.string().default("claude-opus-5-5"),
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
  STORAGE_LOCAL_ROOT: z.string().default("./var/storage"),
  ALLOW_FIXTURES: bool(true),
  RECORDING_RETENTION_DAYS: z.coerce.number().int().default(30),
  EXPORT_RETENTION_DAYS: z.coerce.number().int().default(7),
});
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function loadWorkerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const c = WorkerConfigSchema.parse(env);
  if (c.NODE_ENV === "production" && c.ALLOW_DEV_BASELINE_ASSESSOR) throw new Error("ALLOW_DEV_BASELINE_ASSESSOR must be false in production");
  if (c.LLM_PROVIDER === "anthropic" && !c.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for LLM_PROVIDER=anthropic");
  return c;
}
