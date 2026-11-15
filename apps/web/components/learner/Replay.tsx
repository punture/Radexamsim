"use client";
import { useEffect, useState } from "react";
import type { TranscriptLine } from "@sim/contracts";
import { Badge } from "@sim/ui";
import { api } from "@/lib/api";

type ReplayCase = { caseAttemptId: string; caseLabel: string; caseStartedAtMs: number; isDevelopmentFixture: boolean; assets: { handle: string; label: string; frameCount: number; isPlaceholder: boolean; annotations: { frameIndex: number; kind: string; points: [number, number][]; label: string }[] }[] };

function AnnotatedFrame({ handle, frame, annotations, label }: { handle: string; frame: number; annotations: ReplayCase["assets"][number]["annotations"]; label: string }) {
  const [show, setShow] = useState(true);
  return (
    <figure style={{ margin: 0, background: "#000", borderRadius: 8, padding: 6 }}>
      <div style={{ position: "relative" }}>
        <img src={`/api/media/${handle}/${frame}`} alt={`${label}, image ${frame + 1}`} style={{ width: "100%", display: "block" }} />
        {show && (
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
            {annotations.filter((a) => a.frameIndex === frame).map((a, i) =>
              a.kind === "ellipse" && a.points.length === 2 ? (
                <ellipse key={i} cx={(a.points[0]![0] + a.points[1]![0]) / 2} cy={(a.points[0]![1] + a.points[1]![1]) / 2} rx={Math.abs(a.points[1]![0] - a.points[0]![0]) / 2} ry={Math.abs(a.points[1]![1] - a.points[0]![1]) / 2} fill="none" stroke="#f59e0b" strokeWidth={0.006} />
              ) : a.points.length >= 2 ? (
                <line key={i} x1={a.points[0]![0]} y1={a.points[0]![1]} x2={a.points[1]![0]} y2={a.points[1]![1]} stroke="#f59e0b" strokeWidth={0.006} />
              ) : null,
            )}
          </svg>
        )}
      </div>
      <figcaption style={{ color: "#d8dee6", fontSize: "0.85rem", padding: "4px 2px" }}>
        {label} — image {frame + 1}. {annotations.filter((a) => a.frameIndex === frame).map((a) => a.label).join("; ")}{" "}
        <button type="button" className="btn btn-sm" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"} annotations</button>
      </figcaption>
    </figure>
  );
}

export function Replay({ sessionId }: { sessionId: string }) {
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [cases, setCases] = useState<ReplayCase[]>([]);
  useEffect(() => {
    api<TranscriptLine[]>(`/api/sessions/${sessionId}/transcript`).then(setLines).catch(() => setLines([]));
    api<{ cases: ReplayCase[] }>(`/api/sessions/${sessionId}/replay`).then((r) => setCases(r.cases)).catch(() => setCases([]));
  }, [sessionId]);
  return (
    <div className="stack-lg">
      <h1>Replay</h1>
      <p className="muted">Transcript of what was said. Examiner lines show only what was actually played; interrupted lines end with “—”. Audio replay is available only when you opted in to recording retention.</p>
      {cases.map((c) => (
        <section key={c.caseAttemptId} id={c.caseAttemptId} className="card stack">
          <div className="row-between"><h2>{c.caseLabel}</h2>{c.isDevelopmentFixture && <Badge kind="warning">Development fixture</Badge>}</div>
          <div className="grid-2">
            <div className="transcript" style={{ maxHeight: 520 }}>
              {(lines ?? []).filter((l) => l.caseAttemptId === c.caseAttemptId).map((l) => (
                <div key={l.id}>
                  <span className="who">{l.speaker === "examiner" ? "Examiner" : "You"} · {Math.max(0, Math.round((l.atMs - c.caseStartedAtMs) / 1000))}s</span>{" "}
                  {l.text}{l.interrupted ? " —" : ""}
                  {l.speaker === "candidate" && l.source === "typed" && <Badge>typed</Badge>}
                </div>
              ))}
            </div>
            <div className="stack">
              {c.assets.map((a) => {
                const keyFrames = [...new Set(a.annotations.map((x) => x.frameIndex))];
                const frames = keyFrames.length ? keyFrames : [0];
                return frames.map((f) => <AnnotatedFrame key={`${a.handle}-${f}`} handle={a.handle} frame={f} annotations={a.annotations} label={a.label} />);
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
