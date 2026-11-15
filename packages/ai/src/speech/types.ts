/**
 * Speech provider interfaces (spec §9). The reference pathway is streaming ASR -> text
 * examiner -> TTS. Providers are adapters; nothing in the session controller depends on a
 * specific vendor. Model ids and voices are configuration.
 */

export type AsrWord = { text: string; startMs: number; endMs: number; confidence: number | null };

export type AsrFinalSegment = {
  text: string;
  /** Milliseconds relative to the start of the ASR stream. */
  startMs: number;
  endMs: number;
  words: AsrWord[] | null;
  /** Provider-supplied confidence only. Never synthesized. */
  confidence: number | null;
  requestId: string | null;
};

export type AsrEvents = {
  onInterim?: (text: string) => void;
  onFinal: (seg: AsrFinalSegment) => void;
  /** Provider signals end of an utterance (e.g. speech_final / UtteranceEnd). */
  onUtteranceEnd?: () => void;
  onSpeechStarted?: () => void;
  onError: (err: Error) => void;
  onClose?: () => void;
};

export interface AsrStream {
  sendAudio(pcm16le: Uint8Array): void;
  /** Flush any buffered audio into a final result (e.g. on explicit end of turn). */
  finalize(): void;
  close(): void;
}

export type AsrOpenOptions = {
  sampleRate: 16000 | 24000 | 48000;
  /** Fixed, case-independent specialty vocabulary (never the current answer key). */
  vocabulary: readonly string[];
  vocabularyVersion: string;
};

export interface AsrProvider {
  readonly name: string;
  readonly model: string;
  readonly simulated: boolean;
  open(opts: AsrOpenOptions, events: AsrEvents): Promise<AsrStream>;
}

export type TtsAlignment = { chars: string[]; startMs: number[]; endMs: number[] };

export type TtsResult = {
  audio: Uint8Array;
  mimeType: string;
  durationMs: number | null;
  /** Character-level timings when the provider supplies them. */
  alignment: TtsAlignment | null;
};

export interface TtsProvider {
  readonly name: string;
  readonly simulated: boolean;
  /** How the played portion is determined for this provider. */
  readonly playedPortionMethod: "provider_alignment" | "proportional_estimate";
  synthesize(text: string, signal?: AbortSignal): Promise<TtsResult>;
}
