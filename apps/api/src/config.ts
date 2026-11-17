import { z } from "zod";
import { DEFAULT_MODEL, LLM_PROVIDERS, llmSettingsProblems } from "@sim/ai";
import { StorageEnvSchema, checkStorageEnv } from "@sim/storage";

/**
 * Environment configuration (see .env.example). Secrets are read only on the server and
 * never logged. Unsafe combinations are rejected at startup.
 */
const bool = (d: boolean) => z.enum(["true", "false", "1", "0"]).default(d ? "true" : "false").transform((v) => v === "true" || v === "1");

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  PUBLIC_WEB_ORIGIN: z.string().default("http://localhost:3000"),
  /** Public WebSocket base URL the browser uses (defaults to the API origin). */
  PUBLIC_API_WS_URL: z.string().default("ws://localhost:4000"),
  DATABASE_URL: z.string().default("postgres://sim:sim_dev_password@127.0.0.1:5432/sim_dev"),

  AUTH_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  SUPABASE_URL: z.string().optional(),
  AUTH_ENCRYPTION_KEY: z.string().min(32).default("dev-only-encryption-key-change-me-0000000000"),
  OWNER_EMAILS: z.string().default("owner@example.test"),
  OWNER_MFA_REQUIRED: bool(true),
  SESSION_TTL_HOURS: z.coerce.number().int().default(12),
  /**
   * Development only: sign in automatically as the seeded test learner or test owner (whose
   * second factor counts as verified), so testing needs no password or code. Refused in production.
   */
  DEV_AUTO_LOGIN: bool(false),

  /** STORAGE_DRIVER, STORAGE_LOCAL_ROOT and S3_*: shared with the worker (packages/storage). */
  ...StorageEnvSchema.shape,

  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  /** When unset, loadConfig uses the provider's default (DEFAULT_MODEL in @sim/ai). */
  MODEL_DEFAULT: z.string().default(DEFAULT_MODEL.anthropic),
  MODEL_LIVE_EXAMINER: z.string().optional(),
  EXAMINER_LLM_TIMEOUT_MS: z.coerce.number().int().default(2500),
  SESSION_SPEND_CAP_USD: z.coerce.number().default(3),
  LLM_SERVER_SIDE_FALLBACKS: bool(true),
  /** Only development fixtures reach the model (for a key whose provider may reuse content). Refused in production. */
  LLM_FIXTURES_ONLY: bool(false),

  /** browser: Web Speech API in the learner's browser (labelled; vendor-processed audio). */
  ASR_PROVIDER: z.enum(["browser", "deepgram", "dev_injection_only"]).default("browser"),
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_ASR_MODEL: z.string().default("nova-3-medical"),
  TTS_PROVIDER: z.enum(["browser", "elevenlabs", "deepgram", "none"]).default("browser"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().default("eleven_flash_v2_5"),
  DEEPGRAM_TTS_MODEL: z.string().default("aura-2-thalia-en"),

  /** Development fixtures may be published/assigned only when true (never in production). */
  ALLOW_FIXTURES: bool(true),
  /** Test-only transcript injection channel. Refused in production. */
  ALLOW_DEV_INJECTION: bool(false),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ANNUAL: z.string().optional(),
  BILLING_ENFORCED: bool(true),
  /** Proxy trust for client IPs: "true" | "false" | hop count | comma-separated addresses/CIDRs. */
  TRUST_PROXY: z.string().optional(),
  /** Days a completed data export stays downloadable; must match the worker's setting. */
  EXPORT_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = ConfigSchema.parse(env);
  if (c.LLM_PROVIDER !== "none" && !env.MODEL_DEFAULT) c.MODEL_DEFAULT = DEFAULT_MODEL[c.LLM_PROVIDER];
  if (c.NODE_ENV === "production") {
    const problems: string[] = [];
    if (c.ALLOW_DEV_INJECTION) problems.push("ALLOW_DEV_INJECTION must be false in production");
    if (c.ALLOW_FIXTURES) problems.push("ALLOW_FIXTURES must be false in production");
    if (c.AUTH_PROVIDER === "local") problems.push("AUTH_PROVIDER=local is for development only; use managed auth (supabase)");
    if (c.AUTH_ENCRYPTION_KEY.startsWith("dev-only")) problems.push("AUTH_ENCRYPTION_KEY must be set");
    if (!c.OWNER_MFA_REQUIRED) problems.push("OWNER_MFA_REQUIRED must be true in production");
    if (c.DEV_AUTO_LOGIN) problems.push("DEV_AUTO_LOGIN must be false in production");
    if (c.LLM_PROVIDER === "none") problems.push("an assessment model is required in production (the development baseline is not permitted)");
    if (c.LLM_FIXTURES_ONLY) problems.push("LLM_FIXTURES_ONLY is for development keys; production needs a provider tier that does not reuse submitted content");
    if (problems.length) throw new Error(`Unsafe production configuration:\n - ${problems.join("\n - ")}`);
  }
  if (c.AUTH_PROVIDER === "supabase" && !c.SUPABASE_URL) throw new Error("SUPABASE_URL is required for AUTH_PROVIDER=supabase");
  if (c.DEV_AUTO_LOGIN && c.AUTH_PROVIDER !== "local") throw new Error("DEV_AUTO_LOGIN requires AUTH_PROVIDER=local");
  const llmProblems = llmSettingsProblems(c, [c.MODEL_DEFAULT, c.MODEL_LIVE_EXAMINER]);
  if (llmProblems.length) throw new Error(llmProblems.join("; "));
  checkStorageEnv(c, c.NODE_ENV);
  return c;
}

export function ownerEmails(c: Config): Set<string> {
  return new Set(c.OWNER_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}
