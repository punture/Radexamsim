"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CandidateAsset, CandidateSessionState, ClientMessage, ServerMessage, ViewerCommand } from "@sim/contracts";
import { decodeBinaryFrame, encodeBinaryFrame, BINARY_FRAME_MIC, BINARY_FRAME_TTS } from "@sim/contracts";
import { api } from "../api";
import { playServerAudio, speakBrowser, type SpeakHandle } from "./speech";

/**
 * Live session client. The server is authoritative for clock, stage, prompts and images;
 * this hook renders what it is told, reports what actually happened (rendering, playback,
 * interruptions) and reconnects with a fresh single-use ticket after network loss.
 */

export type Connection = "connecting" | "open" | "reconnecting" | "closed";
export type TranscriptEntry = { id: string; who: "examiner" | "candidate"; text: string; interim?: boolean; interrupted?: boolean };
export type Notice = { id: number; level: "info" | "warning" | "error"; code: string; message: string };

type Speaking = { utteranceId: string; text: string; handle: SpeakHandle | null; serverAlignment: { chars: string[]; endMs: number[] } | null };

export function useLiveSession(sessionId: string, opts: { mediaUrl: (h: string, f: number) => string }) {
  const [state, setState] = useState<CandidateSessionState | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [examinerSpeaking, setExaminerSpeaking] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [commandSeq, setCommandSeq] = useState(0);
  const [ended, setEnded] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [pendingNewImages, setPendingNewImages] = useState<ViewerCommand | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const speaking = useRef<Speaking | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const pendingTtsAudio = useRef(new Map<string, { bytes: Uint8Array; alignment: Speaking["serverAlignment"] }>());
  const lastInteraction = useRef(0);
  const retry = useRef(0);
  const stopped = useRef(false);
  const noticeId = useRef(0);
  const clockAnchor = useRef<{ remainingMs: number; at: number; running: boolean } | null>(null);
  const speechMode = useRef<"browser" | "server_stream" | "none">("browser");
  const onExaminerDone = useRef<(() => void) | null>(null);
  const mediaUrlRef = useRef(opts.mediaUrl);
  mediaUrlRef.current = opts.mediaUrl;

  const send = useCallback((m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);
  const sendBinary = useCallback((pcm: Uint8Array) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(encodeBinaryFrame(BINARY_FRAME_MIC, {}, pcm) as Uint8Array<ArrayBuffer>);
  }, []);
  const notify = useCallback((level: Notice["level"], code: string, message: string) => {
    const id = ++noticeId.current;
    setNotices((n) => [...n.slice(-4), { id, level, code, message }]);
    if (level !== "error") setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 8000);
  }, []);
  const newId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // ------------------------------------------------------------------ viewer acknowledgements
  const ackCommand = useCallback(
    async (cmd: ViewerCommand) => {
      // Acknowledge only after each new image's initial frame is actually decoded.
      const results = await Promise.all(
        cmd.newAssets.map(async (a: CandidateAsset) => {
          const started = performance.now();
          try {
            const img = new Image();
            img.src = mediaUrlRef.current(a.handle, a.initialFrameIndex);
            await img.decode();
            return { handle: a.handle, status: "rendered" as const, error: null, renderMs: Math.round(performance.now() - started) };
          } catch {
            return { handle: a.handle, status: "failed" as const, error: "decode failed", renderMs: null };
          }
        }),
      );
      setCommandSeq(cmd.seq);
      send({ type: "viewer_ack", ack: { commandId: cmd.commandId, status: results.some((r) => r.status === "failed") ? "failed" : "rendered", panes: results } });
    },
    [send],
  );

  const applyViewerCommand = useCallback(
    (cmd: ViewerCommand) => {
      setState((s) => {
        if (!s?.currentCase || s.currentCase.caseAttemptId !== cmd.caseAttemptId) return s;
        if (cmd.seq <= s.currentCase.viewer.lastCommandSeq && cmd.newAssets.length === 0) return s; // stale
        const known = new Set(s.currentCase.assets.map((a) => a.handle));
        return {
          ...s,
          currentCase: {
            ...s.currentCase,
            assets: [...s.currentCase.assets, ...cmd.newAssets.filter((a) => !known.has(a.handle))],
            viewer: { ...s.currentCase.viewer, layout: cmd.layout, panes: cmd.panes, lastCommandSeq: cmd.seq },
          },
        };
      });
      if (cmd.awaitAck) void ackCommand(cmd);
      else setCommandSeq(cmd.seq);
    },
    [ackCommand],
  );

  // ------------------------------------------------------------------ examiner speech
  const finishSpeaking = useCallback(
    (event: "completed" | "interrupted" | "failed", playedChars: number, error: string | null = null) => {
      const sp = speaking.current;
      if (!sp) return;
      speaking.current = null;
      setExaminerSpeaking(false);
      send({ type: "tts_playback", utteranceId: sp.utteranceId, event, playedChars, error });
      if (event !== "completed") setTranscript((t) => t.map((e) => (e.id === sp.utteranceId ? { ...e, text: sp.text.slice(0, playedChars) + (playedChars < sp.text.length ? " —" : ""), interrupted: true } : e)));
      onExaminerDone.current?.();
    },
    [send],
  );

  /** Stop examiner speech now (barge-in or time). Returns after reporting the played portion. */
  const interruptExaminer = useCallback(() => {
    const sp = speaking.current;
    if (!sp?.handle) return;
    let played = sp.handle.cancel();
    if (sp.serverAlignment) {
      const ms = played;
      played = 0;
      for (let i = 0; i < sp.serverAlignment.chars.length; i++) if ((sp.serverAlignment.endMs[i] ?? Infinity) <= ms) played = i + 1;
    }
    finishSpeaking("interrupted", played);
  }, [finishSpeaking]);

  const speak = useCallback(
    (utteranceId: string, text: string, mode: "browser" | "server_stream" | "none") => {
      setTranscript((t) => [...t, { id: utteranceId, who: "examiner", text }]);
      setCaption(text);
      if (mode === "none") return; // server already marked it delivered as text
      if (mode === "server_stream") {
        speaking.current = { utteranceId, text, handle: null, serverAlignment: null };
        const audio = pendingTtsAudio.current.get(utteranceId);
        if (audio) void playServer(utteranceId, audio.bytes, audio.alignment);
        else {
          // Audio may still be in flight; if it never arrives, the server's safety timeout applies.
          setTimeout(() => {
            if (speaking.current?.utteranceId === utteranceId && !speaking.current.handle) finishSpeaking("failed", text.length, "audio not received; shown as text");
          }, 12_000);
        }
        return;
      }
      speaking.current = { utteranceId, text, handle: null, serverAlignment: null };
      setExaminerSpeaking(true);
      const handle = speakBrowser(text, {
        onStart: () => send({ type: "tts_playback", utteranceId, event: "started", playedChars: 0, error: null }),
        onProgress: (c) => send({ type: "tts_playback", utteranceId, event: "progress", playedChars: c, error: null }),
        onEnd: () => finishSpeaking("completed", text.length),
        // The text is shown on screen as a caption when audio fails, so it counts as delivered.
        onError: (e) => finishSpeaking("failed", text.length, `speech synthesis error: ${e}; shown as text`),
      });
      speaking.current.handle = handle;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finishSpeaking, send],
  );

  const playServer = useCallback(
    async (utteranceId: string, bytes: Uint8Array, alignment: Speaking["serverAlignment"]) => {
      const sp = speaking.current;
      if (!sp || sp.utteranceId !== utteranceId) return;
      try {
        audioCtx.current ??= new AudioContext();
        sp.serverAlignment = alignment;
        setExaminerSpeaking(true);
        const p = await playServerAudio(
          audioCtx.current,
          bytes,
          () => send({ type: "tts_playback", utteranceId, event: "started", playedChars: 0, error: null }),
          () => finishSpeaking("completed", sp.text.length),
        );
        sp.handle = { cancel: () => p.cancel() };
      } catch {
        finishSpeaking("failed", sp.text.length, "audio playback failed; shown as text");
      }
    },
    [finishSpeaking, send],
  );

  // ------------------------------------------------------------------ connection
  const handleMessage = useCallback(
    (m: ServerMessage) => {
      switch (m.type) {
        case "state":
          setState(m.state);
          speechMode.current = m.state.speech.tts;
          clockAnchor.current = { remainingMs: m.state.clock.remainingMs, at: performance.now(), running: m.state.clock.running };
          setRemainingMs(m.state.clock.remainingMs);
          if (m.state.status === "complete" || m.state.status === "finalizing") setEnded((e) => e ?? m.state.outcome ?? "ended");
          break;
        case "clock":
          clockAnchor.current = { remainingMs: m.remainingMs, at: performance.now(), running: m.running };
          setRemainingMs(m.remainingMs);
          break;
        case "viewer_command": {
          const recentlyInteracting = performance.now() - lastInteraction.current < 1500;
          if (m.command.deferWhileInteracting && recentlyInteracting && m.command.newAssets.length === 0) {
            setPendingNewImages(m.command);
            break;
          }
          applyViewerCommand(m.command);
          break;
        }
        case "examiner_utterance":
          speak(m.utteranceId, m.text, m.tts.mode);
          break;
        case "examiner_cancel":
          if (speaking.current?.utteranceId === m.utteranceId) interruptExaminer();
          break;
        case "transcript_echo":
          setTranscript((t) => {
            const withoutInterim = t.filter((e) => !e.interim);
            return m.interim ? [...withoutInterim, { id: "interim", who: "candidate", text: m.text, interim: true }] : [...withoutInterim, { id: m.segmentId, who: "candidate", text: m.text }];
          });
          break;
        case "notice":
          notify(m.level, m.code, m.message);
          break;
        case "command_result":
          if (!m.ok && m.error) notify("error", m.error.code, m.error.message);
          break;
        case "station_ended":
          setEnded(m.outcome);
          speaking.current?.handle?.cancel();
          break;
        case "pong":
          break;
      }
    },
    [applyViewerCommand, interruptExaminer, notify, speak],
  );

  // The connection must not depend on render-time callbacks (that would reconnect on every
  // state update); handlers are read through refs instead.
  const handleRef = useRef(handleMessage);
  handleRef.current = handleMessage;
  const playRef = useRef(playServer);
  playRef.current = playServer;

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      if (stopped.current) return;
      try {
        const t = await api<{ ticket: string; url: string }>(`/api/sessions/${sessionId}/ws-ticket`, { method: "POST" });
        const sock = new WebSocket(`${t.url}?ticket=${encodeURIComponent(t.ticket)}`);
        sock.binaryType = "arraybuffer";
        ws.current = sock;
        sock.onopen = () => {
          retry.current = 0;
          setConnection("open");
          sock.send(JSON.stringify({ type: "hello", sessionId, lastServerSeq: 0 }));
        };
        sock.onmessage = (ev) => {
          if (typeof ev.data === "string") handleRef.current(JSON.parse(ev.data) as ServerMessage);
          else {
            const f = decodeBinaryFrame(new Uint8Array(ev.data as ArrayBuffer));
            if (f.frameType === BINARY_FRAME_TTS) {
              const hdr = f.header as { utteranceId: string; alignment: { chars: string[]; endMs: number[] } | null };
              pendingTtsAudio.current.set(hdr.utteranceId, { bytes: f.payload, alignment: hdr.alignment });
              if (speaking.current?.utteranceId === hdr.utteranceId && !speaking.current.handle) void playRef.current(hdr.utteranceId, f.payload, hdr.alignment);
            }
          }
        };
        sock.onclose = (ev) => {
          ws.current = null;
          if (stopped.current || ev.code === 4401 || ev.code === 4403 || ev.code === 4001) {
            setConnection("closed");
            return;
          }
          setConnection("reconnecting");
          const delay = Math.min(10_000, 500 * 2 ** retry.current++);
          timer = setTimeout(connect, delay);
        };
      } catch {
        setConnection("reconnecting");
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry.current++));
      }
    };
    void connect();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
      ws.current?.close();
      speaking.current?.handle?.cancel();
    };
  }, [sessionId]);

  // Smooth local countdown between server clock messages (the server stays authoritative).
  useEffect(() => {
    const t = setInterval(() => {
      const a = clockAnchor.current;
      if (a) setRemainingMs(a.running ? Math.max(0, a.remainingMs - (performance.now() - a.at)) : a.remainingMs);
    }, 250);
    return () => clearInterval(t);
  }, []);

  return {
    state,
    connection,
    examinerSpeaking,
    caption,
    transcript,
    notices,
    commandSeq,
    ended,
    remainingMs,
    pendingNewImages,
    send,
    sendBinary,
    newId,
    interruptExaminer,
    isExaminerSpeaking: () => speaking.current !== null,
    onExaminerDone: (fn: (() => void) | null) => (onExaminerDone.current = fn),
    markInteraction: () => {
      lastInteraction.current = performance.now();
      send({ type: "viewer_interaction", active: true });
    },
    showPendingImages: () => {
      if (pendingNewImages) applyViewerCommand(pendingNewImages);
      setPendingNewImages(null);
    },
    dismissNotice: (id: number) => setNotices((n) => n.filter((x) => x.id !== id)),
  };
}
