"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Viewer, VIEWER_CSS } from "@sim/viewer";
import { ConfirmDialog, FixtureBanner, ProvisionalProfileNote } from "@sim/ui";
import { useLiveSession } from "@/lib/exam/useLiveSession";
import { createBrowserAsr, openMicrophone, startPcmCapture, type BrowserAsr } from "@/lib/exam/speech";

const mediaUrl = (h: string, f: number) => `/api/media/${h}/${f}`;

function fmt(ms: number | null): string {
  if (ms === null) return "--:--";
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function ExamRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const live = useLiveSession(sessionId, { mediaUrl });
  const { state } = live;
  const [muted, setMuted] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [talking, setTalking] = useState(false);
  const [headphones, setHeadphones] = useState(false);
  const [showTranscript, setShowTranscript] = useState<boolean | null>(null);
  const [showCaptions, setShowCaptions] = useState(false);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [devText, setDevText] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const asr = useRef<BrowserAsr | null>(null);
  const mic = useRef<Awaited<ReturnType<typeof openMicrophone>> | null>(null);
  const stopPcm = useRef<(() => void) | null>(null);
  const viewSamples = useRef<{ handle: string; frameIndex: number; viewedMs: number }[]>([]);

  const active = state?.status === "active";
  const asrMode = state?.speech.asr;
  const transcriptVisible = showTranscript ?? state?.liveTranscriptDefault ?? false;

  useEffect(() => {
    if (live.ended) {
      asr.current?.stop();
      stopPcm.current?.();
      mic.current?.close();
      const t = setTimeout(() => router.push(`/app/session/${sessionId}/results`), 1500);
      return () => clearTimeout(t);
    }
  }, [live.ended, router, sessionId]);

  // Microphone level meter (and server ASR streaming when configured).
  useEffect(() => {
    if (!active || state?.inputMode !== "voice" || asrMode === "dev_injection_only") return;
    let raf = 0;
    let cancelled = false;
    openMicrophone()
      .then(async (m) => {
        if (cancelled) return m.close();
        mic.current = m;
        const tick = () => {
          setLevel(m.level());
          raf = requestAnimationFrame(tick);
        };
        tick();
        if (asrMode === "server_stream") {
          live.send({ type: "audio_start", encoding: "linear16", sampleRate: 16000 });
          stopPcm.current = await startPcmCapture(m, (pcm) => {
            if (!muted && (!pushToTalk || talking)) live.sendBinary(pcm);
          });
        }
      })
      .catch(() => setMicError("Microphone unavailable. Check browser permissions, or end this station and choose typed practice."));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopPcm.current?.();
      mic.current?.close();
      mic.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, asrMode, state?.inputMode]);

  // Browser speech recognition (labelled vendor-processed path).
  const allowBargeIn = (state?.speech.allowBargeIn ?? false) && headphones;
  const shouldListen = active && state?.inputMode === "voice" && asrMode === "browser" && !muted && (!pushToTalk || talking) && (allowBargeIn || !live.examinerSpeaking);
  useEffect(() => {
    if (asrMode !== "browser" || !active) return;
    if (!asr.current) {
      try {
        asr.current = createBrowserAsr({
          onFinal: (text, confidence, startedAt) =>
            live.send({ type: "candidate_transcript", commandId: live.newId(), source: "client_asr", text, clientStartMs: Math.round(startedAt), clientEndMs: Math.round(performance.now()), confidence, provider: { name: "browser-webspeech", model: null } }),
          onSpeechStart: () => {
            live.send({ type: "speech_activity", state: "started", clientMs: Math.round(performance.now()) });
            if (allowBargeIn && live.isExaminerSpeaking()) live.interruptExaminer();
          },
          onSpeechEnd: () => live.send({ type: "speech_activity", state: "stopped", clientMs: Math.round(performance.now()) }),
          onError: (code) => setMicError(code === "not-allowed" ? "Microphone permission was denied." : code === "network" ? "Speech recognition lost its connection." : `Speech recognition error (${code}).`),
        });
      } catch {
        setMicError("Speech recognition is not available in this browser.");
      }
    }
    if (shouldListen) asr.current?.start();
    else asr.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldListen, asrMode, active]);
  useEffect(() => () => asr.current?.stop(), []);

  // Batched viewing telemetry (availability is recorded separately by acknowledgements).
  useEffect(() => {
    const t = setInterval(() => {
      if (viewSamples.current.length) live.send({ type: "viewer_view", samples: viewSamples.current.splice(0, 50) });
    }, 4000);
    return () => clearInterval(t);
  }, [live]);

  const endTurn = useCallback(() => live.send({ type: "end_turn", commandId: live.newId() }), [live]);
  const start = () => live.send({ type: "start_station", commandId: live.newId() });

  // Keyboard: Enter (outside inputs) = finished speaking; hold "T" for push-to-talk.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (pushToTalk && e.key.toLowerCase() === "t" && !e.repeat) setTalking(true);
      if (e.key === "Enter" && active) endTurn();
    };
    const up = (e: KeyboardEvent) => {
      if (pushToTalk && e.key.toLowerCase() === "t") {
        setTalking(false);
        endTurn();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [pushToTalk, active, endTurn]);

  if (!state) return <div className="container page"><p role="status">Connecting to the examination…</p></div>;
  const cc = state.currentCase;
  const low = (live.remainingMs ?? 1e9) < 60_000;
  const minutes = Math.round(state.profile.stationDurationSeconds / 60);
  const modeLabel = state.mode === "exam" ? "Examination mode" : state.mode === "practice" ? "Practice mode" : "Owner preview";
  const sendTyped = () => {
    if (!typed.trim()) return;
    live.send({ type: "candidate_transcript", commandId: live.newId(), source: "typed", text: typed.trim(), clientStartMs: 0, clientEndMs: 0, confidence: null, provider: { name: "typed", model: null } });
    live.send({ type: "end_turn", commandId: live.newId() });
    setTyped("");
  };

  return (
    <>
      <style>{VIEWER_CSS}</style>
      {state.containsDevelopmentFixtures && <FixtureBanner />}
      <div className="exam-topbar">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <strong>{cc?.neutralLabel ?? (state.status === "ready" ? "Ready to begin" : "Station")}</strong>
          <span className="badge">{modeLabel}</span>
          {live.connection !== "open" && <span className="badge badge-warning" role="status">{live.connection === "reconnecting" ? "Reconnecting…" : live.connection}</span>}
        </div>
        <div className="row">
          <span className={`timer${low ? " low" : ""}`} aria-label={`Time remaining ${fmt(live.remainingMs)}`} role="timer">{fmt(live.remainingMs)}</span>
          {state.status === "active" && (
            <button type="button" className="btn btn-sm" onClick={() => setConfirmEnd(true)}>
              End station
            </button>
          )}
        </div>
      </div>
      <div className="exam-shell">
        <aside className="exam-side" aria-label="Case information and controls">
          {state.status === "ready" && (
            <section className="stack" style={{ gap: 8 }}>
              <h2 className="exam-card-title">Before you begin</h2>
              <ul className="dots text-sm">
                <li>The {minutes}-minute clock starts when you begin and keeps running during silence.</li>
                <li>Pauses to think are normal.</li>
                <li>{state.inputMode === "voice" ? "When you finish an answer, press Enter or the button." : "Type each answer and send it."}</li>
              </ul>
            </section>
          )}
          {cc && (
            <section aria-labelledby="history-h" className="exam-card">
              <h2 id="history-h" className="exam-card-title">History</h2>
              {cc.history.map((h, i) => (
                <p key={i} style={{ margin: "0 0 6px" }}>{h}</p>
              ))}
            </section>
          )}
          {active && (
            <div className="examiner-state" aria-live="polite">
              <span className={`pulse ${live.examinerSpeaking ? "speaking" : "listening"}`} aria-hidden />
              <span>{live.examinerSpeaking ? "Examiner speaking…" : state.inputMode === "voice" ? "Listening" : "Waiting for your answer"}</span>
            </div>
          )}
          {showCaptions && live.caption && <div className="caption" aria-live="polite">{live.caption}</div>}
          {micError && <div className="alert alert-danger" role="alert">{micError}</div>}

          {active && state.inputMode === "voice" && asrMode !== "dev_injection_only" && (
            <section className="stack" aria-label="Microphone">
              <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                <div className="meter" aria-hidden style={{ flex: 1 }}><span style={{ width: `${Math.round((muted ? 0 : level) * 100)}%` }} /></div>
                <button type="button" className="btn btn-sm" aria-pressed={muted} onClick={() => setMuted((m) => !m)}>{muted ? "Unmute" : "Mute"}</button>
              </div>
              {pushToTalk && (
                <button type="button" className="btn" onPointerDown={() => setTalking(true)} onPointerUp={() => { setTalking(false); endTurn(); }} aria-pressed={talking}>
                  {talking ? "Speaking… release to finish" : "Hold to speak (or hold T)"}
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={endTurn} data-testid="end-turn">
                I've finished my answer <kbd className="mono" style={{ fontSize: "0.75rem" }}>Enter</kbd>
              </button>
              <details className="text-sm">
                <summary className="muted" style={{ cursor: "pointer" }}>Microphone options</summary>
                <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                  <span className="muted">{asrMode === "browser" ? "Browser speech recognition" : "Server speech recognition"}</span>
                  <label className="row" style={{ gap: 6, flexWrap: "nowrap", alignItems: "flex-start" }}>
                    <input type="checkbox" checked={pushToTalk} onChange={(e) => setPushToTalk(e.target.checked)} /> Push-to-talk (hold T or the button to speak)
                  </label>
                  <label className="row" style={{ gap: 6, flexWrap: "nowrap", alignItems: "flex-start" }}>
                    <input type="checkbox" checked={headphones} onChange={(e) => setHeadphones(e.target.checked)} /> Using headphones (lets you interrupt the examiner)
                  </label>
                </div>
              </details>
            </section>
          )}

          {active && state.inputMode === "typed_practice" && (
            <form
              className="stack"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                sendTyped();
              }}
            >
              <label className="label" htmlFor="typed">Your answer</label>
              <textarea
                id="typed"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    sendTyped();
                  }
                }}
              />
              <div className="row-between">
                <span className="muted text-sm">Typed practice; not equivalent to a spoken answer. Ctrl+Enter sends.</span>
                <button className="btn btn-primary" type="submit">Send answer</button>
              </div>
            </form>
          )}

          {active && asrMode === "dev_injection_only" && (
            <form
              className="stack"
              data-testid="dev-speech-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!devText.trim()) return;
                live.send({ type: "candidate_transcript", commandId: live.newId(), source: "dev_injected", text: devText.trim(), clientStartMs: 0, clientEndMs: Math.max(1000, devText.length * 60), confidence: null, provider: { name: "dev", model: null } });
                live.send({ type: "end_turn", commandId: live.newId() });
                setDevText("");
              }}
            >
              <label className="label" htmlFor="devspeech">Simulated speech (development/test only)</label>
              <textarea id="devspeech" value={devText} onChange={(e) => setDevText(e.target.value)} data-testid="dev-speech" />
              <button className="btn btn-primary" type="submit" data-testid="dev-speech-send">Send as speech</button>
            </form>
          )}

          {state.practice && active && (
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => live.send({ type: "practice_request_hint", commandId: live.newId() })}>Request a hint</button>
              <button type="button" className="btn btn-sm" onClick={() => live.send({ type: state.practice!.paused ? "practice_resume" : "practice_pause", commandId: live.newId() })}>{state.practice.paused ? "Resume" : "Pause"}</button>
            </div>
          )}

          {live.notices.map((n) => (
            <div key={n.id} className={`alert alert-${n.level === "error" ? "danger" : n.level === "warning" ? "warning" : "info"}`} role={n.level === "error" ? "alert" : "status"}>
              {n.message}{" "}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => live.dismissNotice(n.id)} aria-label="Dismiss">✕</button>
            </div>
          ))}
          {live.ended && <div className="alert alert-info" role="status"><strong>Station ended.</strong> Preparing your results…</div>}

          <div className="row text-sm" style={{ gap: 16, marginTop: "auto", paddingTop: 4 }}>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={transcriptVisible} onChange={(e) => setShowTranscript(e.target.checked)} /> Live transcript</label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showCaptions} onChange={(e) => setShowCaptions(e.target.checked)} /> Examiner captions</label>
          </div>
          {transcriptVisible && (
            <div className="transcript" aria-live="polite" aria-label="Live transcript">
              {live.transcript.map((t) => (
                <div key={`${t.id}-${t.who}`}>
                  <span className="who">{t.who === "examiner" ? "Examiner" : "You"}</span> <span className={t.interim ? "muted" : undefined}>{t.text}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
        <main id="main" className="exam-main" onPointerDown={live.markInteraction} onWheel={live.markInteraction}>
          {live.pendingNewImages && (
            <div className="alert alert-info" style={{ margin: 8 }}>
              The examiner changed the image layout. <button type="button" className="btn btn-sm" onClick={live.showPendingImages}>Show now</button>
            </div>
          )}
          {cc ? (
            <Viewer
              assets={cc.assets}
              layout={cc.viewer.layout}
              panes={cc.viewer.panes}
              permissions={cc.viewer.permissions}
              mediaUrl={mediaUrl}
              commandSeq={live.commandSeq}
              onInteraction={live.markInteraction}
              onViewSample={(handle, frameIndex, viewedMs) => viewSamples.current.push({ handle, frameIndex, viewedMs })}
            />
          ) : state.status === "ready" ? (
            <div className="exam-ready">
              <div className="exam-ready-card stack">
                <h2 style={{ margin: 0, fontSize: "1.3rem" }}>{state.profile.displayName}</h2>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge">{modeLabel}</span>
                  <ProvisionalProfileNote status={state.profile.verificationStatus} />
                </div>
                <p className="muted" style={{ margin: 0 }}>{minutes}-minute station. Images appear when you begin.</p>
                <button type="button" className="btn btn-primary btn-lg" onClick={start} data-testid="begin-station">
                  Begin station
                </button>
              </div>
            </div>
          ) : (
            <div className="exam-empty">Waiting for the next case…</div>
          )}
        </main>
      </div>
      <ConfirmDialog
        open={confirmEnd}
        title="End the station now?"
        body={<p>Remaining cases will not be presented. Your answers so far will be assessed.</p>}
        confirmLabel="End station"
        danger
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          live.send({ type: "request_end_station", commandId: live.newId() });
        }}
      />
    </>
  );
}
