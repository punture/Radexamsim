import WebSocket from "ws";
import type { AsrEvents, AsrOpenOptions, AsrProvider, AsrStream } from "./types";

/**
 * Deepgram streaming ASR adapter (raw WebSocket).
 *
 * STATUS: implemented against Deepgram's documented live-streaming API (endpoint, query
 * parameters, Results/UtteranceEnd/SpeechStarted messages, KeepAlive/Finalize/CloseStream
 * control messages) as summarized from official-domain search results on 2026-11-15. It has
 * NOT been exercised against the live service (no API key available in the build
 * environment). Verify with `pnpm --filter @sim/api run check:providers` once a key exists.
 *
 * Privacy: `mip_opt_out=true` is set so audio is not retained for model improvement; confirm
 * the account's data-processing terms before production use. Audio goes to Deepgram only
 * after the learner consents to microphone processing.
 */
export type DeepgramOptions = {
  apiKey: string;
  model?: string; // default "nova-3-medical"
  endpointingMs?: number;
  utteranceEndMs?: number;
  url?: string;
};

type DgWord = { word: string; punctuated_word?: string; start: number; end: number; confidence?: number };
type DgResults = {
  type: "Results";
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
  channel?: { alternatives?: { transcript?: string; confidence?: number; words?: DgWord[] }[] };
  metadata?: { request_id?: string };
};

export class DeepgramAsrProvider implements AsrProvider {
  readonly name = "deepgram";
  readonly simulated = false;
  readonly model: string;
  constructor(private readonly opts: DeepgramOptions) {
    this.model = opts.model ?? "nova-3-medical";
  }

  async open(o: AsrOpenOptions, ev: AsrEvents): Promise<AsrStream> {
    const params = new URLSearchParams({
      model: this.model,
      language: "en",
      encoding: "linear16",
      sample_rate: String(o.sampleRate),
      channels: "1",
      interim_results: "true",
      punctuate: "true",
      smart_format: "true",
      endpointing: String(this.opts.endpointingMs ?? 300),
      utterance_end_ms: String(this.opts.utteranceEndMs ?? 1000),
      vad_events: "true",
      mip_opt_out: "true",
    });
    // Keyterms: repeated parameter per term (a comma-separated list is not supported).
    for (const term of o.vocabulary.slice(0, 100)) params.append("keyterm", term);
    const url = `${this.opts.url ?? "wss://api.deepgram.com/v1/listen"}?${params.toString()}`;
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${this.opts.apiKey}` } });
    let lastAudioAt = Date.now();
    const keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && Date.now() - lastAudioAt > 4000) ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 3000);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Deepgram connection timeout")), 8000);
      ws.once("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.once("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    ws.on("message", (data) => {
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === "Results") {
        const r = msg as unknown as DgResults;
        const alt = r.channel?.alternatives?.[0];
        const text = alt?.transcript?.trim() ?? "";
        if (!text) {
          if (r.speech_final) ev.onUtteranceEnd?.();
          return;
        }
        if (!r.is_final) {
          ev.onInterim?.(text);
          return;
        }
        const words = (alt?.words ?? []).map((w) => ({
          text: w.punctuated_word ?? w.word,
          startMs: Math.round(w.start * 1000),
          endMs: Math.round(w.end * 1000),
          confidence: typeof w.confidence === "number" ? w.confidence : null,
        }));
        ev.onFinal({
          text,
          startMs: Math.round((r.start ?? 0) * 1000),
          endMs: Math.round(((r.start ?? 0) + (r.duration ?? 0)) * 1000),
          words: words.length ? words : null,
          confidence: typeof alt?.confidence === "number" ? alt.confidence : null,
          requestId: r.metadata?.request_id ?? null,
        });
        if (r.speech_final) ev.onUtteranceEnd?.();
      } else if (msg.type === "UtteranceEnd") ev.onUtteranceEnd?.();
      else if (msg.type === "SpeechStarted") ev.onSpeechStarted?.();
    });
    ws.on("error", (e) => ev.onError(e instanceof Error ? e : new Error(String(e))));
    ws.on("close", () => {
      clearInterval(keepAlive);
      ev.onClose?.();
    });

    return {
      sendAudio(pcm) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pcm);
          lastAudioAt = Date.now();
        }
      },
      finalize() {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Finalize" }));
      },
      close() {
        clearInterval(keepAlive);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        setTimeout(() => ws.terminate(), 1500).unref();
      },
    };
  }
}
