"use client";

/**
 * Browser speech helpers.
 *
 * Browser TTS (speechSynthesis) runs locally for most OS voices; `boundary` events give
 * the character index of the word being spoken, which is how we know what the learner
 * could have heard before an interruption. Network voices may not emit boundary events;
 * then the played portion is estimated conservatively (whole words only).
 *
 * Browser speech recognition (Web Speech API) in Chrome sends audio to the browser
 * vendor's service. It is a labelled development/fallback path that requires explicit
 * consent; production should use the server ASR adapter.
 */

export type SpeakHandle = { cancel: () => number };

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return en.find((v) => v.localService) ?? en[0] ?? voices[0] ?? null;
}

export function browserTtsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function speakBrowser(text: string, h: { onStart: () => void; onProgress: (chars: number) => void; onEnd: () => void; onError: (e: string) => void }): SpeakHandle {
  let lastBoundary = 0;
  let started = 0;
  let finished = false;
  let gotBoundary = false;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 0.98;
  u.onstart = () => {
    started = performance.now();
    h.onStart();
  };
  u.onboundary = (e) => {
    gotBoundary = true;
    lastBoundary = e.charIndex;
    h.onProgress(lastBoundary);
  };
  u.onend = () => {
    if (finished) return;
    finished = true;
    h.onEnd();
  };
  u.onerror = (e) => {
    if (finished) return;
    finished = true;
    if (e.error === "interrupted" || e.error === "canceled") return;
    h.onError(e.error);
  };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return {
    cancel: () => {
      finished = true;
      speechSynthesis.cancel();
      if (gotBoundary) return lastBoundary;
      // No boundary events: conservative estimate (~70 ms per character), whole words only.
      const raw = started ? Math.floor((performance.now() - started) / 70) : 0;
      const cut = text.lastIndexOf(" ", Math.min(raw, text.length));
      return cut > 0 ? cut : 0;
    },
  };
}

type RecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> }) => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export function browserAsrAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export type BrowserAsr = { start: () => void; stop: () => void; readonly running: boolean };

export function createBrowserAsr(h: {
  onFinal: (text: string, confidence: number | null, startedAt: number) => void;
  onInterim?: (text: string) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onError?: (code: string) => void;
}): BrowserAsr {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) throw new Error("speech recognition unavailable");
  let wanted = false;
  let rec: RecognitionLike | null = null;
  let utteranceStart = 0;
  const make = () => {
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const alt = res[0];
        if (!utteranceStart) utteranceStart = performance.now();
        if (res.isFinal) {
          const text = alt.transcript.trim();
          if (text) h.onFinal(text, alt.confidence > 0 ? alt.confidence : null, utteranceStart);
          utteranceStart = 0;
        } else h.onInterim?.(alt.transcript);
      }
    };
    r.onspeechstart = () => h.onSpeechStart?.();
    r.onspeechend = () => h.onSpeechEnd?.();
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      h.onError?.(e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") wanted = false;
    };
    r.onend = () => {
      // Chrome ends recognition after silence; restart while the station needs it.
      if (wanted) setTimeout(() => wanted && safeStart(), 150);
    };
    return r;
  };
  const safeStart = () => {
    try {
      rec = make();
      rec.start();
    } catch {
      /* already started */
    }
  };
  return {
    start() {
      if (wanted) return;
      wanted = true;
      safeStart();
    },
    stop() {
      wanted = false;
      try {
        rec?.stop();
      } catch {
        /* ignore */
      }
    },
    get running() {
      return wanted;
    },
  };
}

/** Microphone with level metering (echo cancellation and noise suppression requested). */
export async function openMicrophone(): Promise<{ stream: MediaStream; level: () => number; close: () => void; context: AudioContext }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const context = new AudioContext();
  const src = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    stream,
    context,
    level: () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    },
    close: () => {
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
    },
  };
}

/** Stream 16 kHz PCM16 frames to the server ASR adapter via an AudioWorklet. */
export async function startPcmCapture(mic: { stream: MediaStream; context: AudioContext }, onChunk: (pcm: Uint8Array) => void): Promise<() => void> {
  await mic.context.audioWorklet.addModule("/pcm-worklet.js");
  const src = mic.context.createMediaStreamSource(mic.stream);
  const node = new AudioWorkletNode(mic.context, "pcm16-downsampler", { processorOptions: { targetRate: 16000 } });
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(new Uint8Array(e.data));
  src.connect(node);
  return () => {
    src.disconnect();
    node.disconnect();
  };
}

/** Play server-synthesized audio; returns a canceller that reports the played portion (ms). */
export async function playServerAudio(ctx: AudioContext, bytes: Uint8Array, onStart: () => void, onEnd: () => void): Promise<{ cancel: () => number }> {
  const buf = await ctx.decodeAudioData(bytes.slice().buffer);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  let startedAt = 0;
  let done = false;
  src.onended = () => {
    if (!done) {
      done = true;
      onEnd();
    }
  };
  startedAt = ctx.currentTime;
  src.start();
  onStart();
  return {
    cancel: () => {
      done = true;
      try {
        src.stop();
      } catch {
        /* ignore */
      }
      return Math.round((ctx.currentTime - startedAt) * 1000);
    },
  };
}
