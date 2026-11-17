import {
  createLlmProvider,
  DeepgramAsrProvider,
  DeepgramTtsProvider,
  ElevenLabsTtsProvider,
  type AsrProvider,
  type CallTelemetry,
  type LlmProvider,
  type TtsProvider,
} from "@sim/ai";
import { createDb, modelCalls, type Db } from "@sim/db";
import { FIXTURE_MEDIA_DIR } from "@sim/fixtures";
import { createStorage, type ObjectStorage } from "@sim/storage";
import type { Config } from "./config";

/**
 * Dependency container. Real provider adapters are constructed only when credentials are
 * configured; otherwise the documented local fallbacks apply (browser speech, deterministic
 * examiner policy). Tests inject scripted/mock providers.
 */
export type SpeechModes = {
  asr: "server_stream" | "browser" | "dev_injection_only";
  tts: "server_stream" | "browser" | "none";
};

export type Deps = {
  config: Config;
  db: Db;
  storage: ObjectStorage;
  llm: LlmProvider | null;
  examinerModel: string;
  asr: AsrProvider | null;
  tts: TtsProvider | null;
  speech: SpeechModes;
  now: () => number;
  recordModelCall: (t: CallTelemetry, ctx: { sessionId?: string | null; caseAttemptId?: string | null; caseVersionId?: string | null }) => Promise<void>;
};

export function buildDeps(config: Config, overrides: Partial<Deps> = {}): Deps {
  const db = overrides.db ?? createDb(config.DATABASE_URL);
  const storage = overrides.storage ?? createStorage(config, { readOnlyFallbacks: config.ALLOW_FIXTURES ? { derivatives: FIXTURE_MEDIA_DIR } : {} });
  const llm = overrides.llm !== undefined ? overrides.llm : createLlmProvider(config);
  const asr =
    overrides.asr !== undefined
      ? overrides.asr
      : config.ASR_PROVIDER === "deepgram" && config.DEEPGRAM_API_KEY
        ? new DeepgramAsrProvider({ apiKey: config.DEEPGRAM_API_KEY, model: config.DEEPGRAM_ASR_MODEL })
        : null;
  const tts =
    overrides.tts !== undefined
      ? overrides.tts
      : config.TTS_PROVIDER === "elevenlabs" && config.ELEVENLABS_API_KEY && config.ELEVENLABS_VOICE_ID
        ? new ElevenLabsTtsProvider({ apiKey: config.ELEVENLABS_API_KEY, voiceId: config.ELEVENLABS_VOICE_ID, modelId: config.ELEVENLABS_MODEL_ID })
        : config.TTS_PROVIDER === "deepgram" && config.DEEPGRAM_API_KEY
          ? new DeepgramTtsProvider({ apiKey: config.DEEPGRAM_API_KEY, model: config.DEEPGRAM_TTS_MODEL })
          : null;
  const speech: SpeechModes = overrides.speech ?? {
    asr: asr ? "server_stream" : config.ASR_PROVIDER === "dev_injection_only" ? "dev_injection_only" : "browser",
    tts: tts ? "server_stream" : config.TTS_PROVIDER === "none" ? "none" : "browser",
  };
  return {
    config,
    db,
    storage,
    llm,
    examinerModel: config.MODEL_LIVE_EXAMINER ?? config.MODEL_DEFAULT,
    asr,
    tts,
    speech,
    now: overrides.now ?? (() => Date.now()),
    recordModelCall:
      overrides.recordModelCall ??
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
    ...overrides,
  } as Deps;
}
