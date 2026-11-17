"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CandidateSessionState } from "@sim/contracts";
import { Alert } from "@sim/ui";
import { api, ApiError } from "@/lib/api";
import { browserAsrAvailable, browserTtsAvailable, openMicrophone, speakBrowser } from "@/lib/exam/speech";

type Check = "pending" | "ok" | "warn" | "fail";

export function Preflight({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<CandidateSessionState | null>(null);
  const [mic, setMic] = useState<Check>("pending");
  const [micLevel, setMicLevel] = useState(0);
  const [audio, setAudio] = useState<Check>("pending");
  const [asr, setAsr] = useState<Check>("pending");
  const [image, setImage] = useState<Check>("pending");
  const [rtt, setRtt] = useState<number | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const voice = state?.inputMode === "voice";
  const asrMode = state?.speech.asr;

  useEffect(() => {
    api<CandidateSessionState>(`/api/sessions/${sessionId}`).then(setState).catch((e) => setError(e instanceof ApiError ? e.message : "Session unavailable"));
    const t0 = performance.now();
    api("/api/health").then(() => setRtt(Math.round(performance.now() - t0))).catch(() => setRtt(null));
    const img = new Image();
    img.src = "/preflight-test-pattern.png";
    img.decode().then(() => setImage("ok")).catch(() => setImage("fail"));
  }, [sessionId]);

  useEffect(() => {
    if (!state) return;
    if (!voice || asrMode === "dev_injection_only") {
      setMic("ok");
      setAsr("ok");
      return;
    }
    setAsr(asrMode === "browser" ? (browserAsrAvailable() ? "ok" : "fail") : "ok");
  }, [state, voice, asrMode]);

  const testMic = async () => {
    try {
      const m = await openMicrophone();
      setMic("ok");
      const until = performance.now() + 4000;
      const tick = () => {
        setMicLevel(m.level());
        if (performance.now() < until) requestAnimationFrame(tick);
        else m.close();
      };
      tick();
    } catch {
      setMic("fail");
    }
  };
  const testAudio = () => {
    if (!browserTtsAvailable()) return setAudio(state?.speech.tts === "browser" ? "fail" : "warn");
    speakBrowser("Sound check. If you can hear this clearly, you are ready.", { onStart: () => undefined, onProgress: () => undefined, onEnd: () => setAudio("ok"), onError: () => setAudio("fail") });
  };

  const submit = async () => {
    setError(null);
    try {
      const r = await api<{ ready: boolean; problems: string[] }>(`/api/sessions/${sessionId}/preflight`, {
        body: {
          microphone: !voice || asrMode === "dev_injection_only" ? "not_required" : mic === "ok" ? "granted" : mic === "fail" ? "denied" : "unavailable",
          audioPlayback: audio === "ok" ? "ok" : audio === "fail" ? "failed" : "skipped",
          imageRender: image === "ok" ? "ok" : "failed",
          connectionRttMs: rtt,
          speechRecognition: !voice || asrMode !== "browser" ? "not_required" : asr === "ok" ? "available" : "unavailable",
          browser: { userAgentFamily: navigator.userAgent.includes("Chrome") ? "chromium" : navigator.userAgent.includes("Firefox") ? "firefox" : "other", webAudio: typeof AudioContext !== "undefined", webSocket: typeof WebSocket !== "undefined", screenWidth: window.screen.width, screenHeight: window.screen.height },
        },
      });
      setProblems(r.problems);
      if (r.ready) router.push(`/app/session/${sessionId}/exam`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Preflight failed");
    }
  };

  const dot = (c: Check) => <span className={`status-dot ${c === "ok" ? "ok" : c === "fail" ? "bad" : c === "warn" ? "warn" : ""}`} aria-hidden />;
  const small = typeof window !== "undefined" && (window.innerWidth < 1280 || window.innerHeight < 700);
  return (
    <div className="stack-lg narrow">
      <div className="page-head">
        <div>
          <h1>Preflight checks</h1>
          <p>A quick check before you start. Technical problems are recorded as limitations, never as clinical errors.</p>
        </div>
      </div>
      <ul className="checklist card" style={{ gap: 14 }}>
        {voice && asrMode !== "dev_injection_only" && (
          <li>{dot(mic)}<div className="stack" style={{ gap: 6, flex: 1 }}>
            <strong>Microphone</strong>
            <span className="muted">Allow microphone access and speak a few words; the meter should move.</span>
            <div className="meter" aria-hidden><span style={{ width: `${Math.round(micLevel * 100)}%` }} /></div>
            <div><button className="btn btn-sm" type="button" onClick={testMic}>Test microphone</button></div>
            {mic === "fail" && <Alert kind="danger">Microphone access was denied or unavailable. Allow it in your browser's site settings and retry, or go back and choose typed practice.</Alert>}
          </div></li>
        )}
        <li>{dot(audio)}<div className="stack" style={{ gap: 6 }}>
          <strong>Examiner audio</strong>
          <span className="muted">Headphones are recommended so your microphone does not pick up the examiner.</span>
          <div><button className="btn btn-sm" type="button" onClick={testAudio}>Play sound check</button></div>
        </div></li>
        {voice && asrMode === "browser" && <li>{dot(asr)}<div><strong>Speech recognition</strong><br /><span className="muted">{asr === "ok" ? "Available in this browser." : "Not available — use current desktop Chrome or Edge, or choose typed practice."}</span></div></li>}
        <li>{dot(image)}<div><strong>Image display</strong><br /><span className="muted">{image === "ok" ? "Test image decoded and displayed." : image === "fail" ? "Images could not be displayed." : "Checking…"}</span><br /><img src="/preflight-test-pattern.png" alt="Grey checkerboard test pattern" width={64} height={64} /></div></li>
        <li>{dot(rtt === null ? "pending" : rtt < 600 ? "ok" : "warn")}<div><strong>Connection</strong><br /><span className="muted">{rtt === null ? "Measuring…" : `Round trip ${rtt} ms${rtt >= 600 ? " — slow connection; the examiner may respond late." : ""}`}</span></div></li>
        <li>{dot(small ? "warn" : "ok")}<div><strong>Display</strong><br /><span className="muted">Best on a desktop browser at 1280×720 or larger. Not a diagnostic display.</span></div></li>
      </ul>
      {problems.length > 0 && <Alert kind="warning" title="Not ready yet">{problems.map((p) => <p key={p} style={{ margin: "4px 0" }}>{p}</p>)}</Alert>}
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="row">
        <button className="btn btn-primary btn-lg" type="button" onClick={submit} data-testid="preflight-continue">Continue to the examination room</button>
      </div>
    </div>
  );
}
