import type { TtsAlignment, TtsProvider, TtsResult } from "./types";

/**
 * Server-side TTS adapters.
 *
 * STATUS: both are implemented from vendor documentation summarized on 2026-11-15 and have
 * NOT been exercised against the live services (no API keys in the build environment).
 *
 * - ElevenLabs "with-timestamps" returns character-level alignment, so the played portion
 *   of an interrupted utterance can be computed exactly (preferred for barge-in).
 * - Deepgram Aura returns audio without timestamps; the played portion is a conservative
 *   proportional estimate and is labelled as such in the record.
 */

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = "elevenlabs";
  readonly simulated = false;
  readonly playedPortionMethod = "provider_alignment" as const;
  constructor(private readonly opts: { apiKey: string; voiceId: string; modelId?: string; outputFormat?: string; baseUrl?: string }) {}

  async synthesize(text: string, signal?: AbortSignal): Promise<TtsResult> {
    const fmt = this.opts.outputFormat ?? "mp3_44100_128";
    const url = `${this.opts.baseUrl ?? "https://api.elevenlabs.io"}/v1/text-to-speech/${encodeURIComponent(this.opts.voiceId)}/with-timestamps?output_format=${fmt}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": this.opts.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ text, model_id: this.opts.modelId ?? "eleven_flash_v2_5" }),
      signal,
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const audioB64 = (body.audio_base64 ?? body.audioBase64) as string | undefined;
    if (!audioB64) throw new Error("ElevenLabs TTS response missing audio");
    const alignment = parseElevenLabsAlignment(body.alignment ?? body.normalized_alignment ?? null);
    return {
      audio: Buffer.from(audioB64, "base64"),
      mimeType: "audio/mpeg",
      durationMs: alignment && alignment.endMs.length ? alignment.endMs[alignment.endMs.length - 1]! : null,
      alignment,
    };
  }
}

/** Accept both snake_case seconds and camelCase milliseconds variants seen in the docs. */
export function parseElevenLabsAlignment(raw: unknown): TtsAlignment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const chars = (r.characters ?? r.chars) as string[] | undefined;
  if (!Array.isArray(chars)) return null;
  const startS = r.character_start_times_seconds as number[] | undefined;
  const endS = r.character_end_times_seconds as number[] | undefined;
  if (Array.isArray(startS) && Array.isArray(endS)) {
    return { chars, startMs: startS.map((s) => Math.round(s * 1000)), endMs: endS.map((s) => Math.round(s * 1000)) };
  }
  const startMs = (r.charStartTimesMs ?? r.char_start_times_ms) as number[] | undefined;
  const durMs = (r.charDurationsMs ?? r.charsDurationsMs ?? r.char_durations_ms) as number[] | undefined;
  if (Array.isArray(startMs) && Array.isArray(durMs)) {
    return { chars, startMs, endMs: startMs.map((s, i) => s + (durMs[i] ?? 0)) };
  }
  return null;
}

export class DeepgramTtsProvider implements TtsProvider {
  readonly name = "deepgram-aura";
  readonly simulated = false;
  readonly playedPortionMethod = "proportional_estimate" as const;
  constructor(private readonly opts: { apiKey: string; model?: string; baseUrl?: string }) {}

  async synthesize(text: string, signal?: AbortSignal): Promise<TtsResult> {
    const params = new URLSearchParams({ model: this.opts.model ?? "aura-2-thalia-en", encoding: "mp3", mip_opt_out: "true" });
    const res = await fetch(`${this.opts.baseUrl ?? "https://api.deepgram.com"}/v1/speak?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${this.opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) throw new Error(`Deepgram TTS failed: HTTP ${res.status}`);
    return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg", durationMs: null, alignment: null };
  }
}
