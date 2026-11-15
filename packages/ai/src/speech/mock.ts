import type { AsrEvents, AsrOpenOptions, AsrProvider, AsrStream, TtsProvider, TtsResult } from "./types";

/**
 * Deterministic speech stand-ins for automated tests. Labelled `simulated`; never reported
 * as a working live integration.
 */

/** Mock ASR: emits scripted final segments when audio arrives or on `finalize()`. */
export class MockAsrProvider implements AsrProvider {
  readonly name = "mock-asr";
  readonly model = "mock";
  readonly simulated = true;
  constructor(private readonly script: { text: string; confidence: number | null }[] = []) {}
  async open(_o: AsrOpenOptions, ev: AsrEvents): Promise<AsrStream> {
    let i = 0;
    let t = 0;
    const emitNext = () => {
      const next = this.script[i++];
      if (!next) return;
      const words = next.text.split(/\s+/).map((w, k) => ({ text: w, startMs: t + k * 300, endMs: t + k * 300 + 250, confidence: next.confidence }));
      const endMs = t + words.length * 300;
      ev.onFinal({ text: next.text, startMs: t, endMs, words, confidence: next.confidence, requestId: `mock-${i}` });
      ev.onUtteranceEnd?.();
      t = endMs + 500;
    };
    return { sendAudio: () => undefined, finalize: emitNext, close: () => ev.onClose?.() };
  }
}

/** Mock TTS: silent payload with linear character alignment (60 ms per character). */
export class MockTtsProvider implements TtsProvider {
  readonly name = "mock-tts";
  readonly simulated = true;
  readonly playedPortionMethod = "provider_alignment" as const;
  constructor(private readonly msPerChar = 60, private readonly fail = false) {}
  async synthesize(text: string): Promise<TtsResult> {
    if (this.fail) throw new Error("simulated TTS failure");
    const chars = [...text];
    return {
      audio: new Uint8Array(16),
      mimeType: "audio/wav",
      durationMs: chars.length * this.msPerChar,
      alignment: { chars, startMs: chars.map((_, i) => i * this.msPerChar), endMs: chars.map((_, i) => (i + 1) * this.msPerChar) },
    };
  }
}
