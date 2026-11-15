"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CaseDebrief, SessionDebrief } from "@sim/contracts";
import { Alert, Badge, FixtureBanner } from "@sim/ui";
import { api } from "@/lib/api";

const PROMPT_LABEL: Record<string, string> = {
  spontaneous: "Spontaneous",
  standard_question: "After a standard question",
  targeted_probe: "After a targeted prompt",
  rescue: "After a rescue prompt",
  examiner_supplied: "Examiner supplied",
};
const STATUS_LABEL: Record<string, string> = {
  demonstrated: "Demonstrated",
  partially_demonstrated: "Partly demonstrated",
  incorrect: "Incorrect",
  not_demonstrated: "Not demonstrated",
  not_assessable: "Not assessable",
  uncertain: "Uncertain",
};
const ts = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

function CaseView({ c, sessionId }: { c: CaseDebrief; sessionId: string }) {
  return (
    <article className="card stack-lg" aria-labelledby={`case-${c.caseAttemptId}`}>
      {c.isDevelopmentFixture && <FixtureBanner />}
      <header className="row-between">
        <h2 id={`case-${c.caseAttemptId}`}>{c.caseLabel}</h2>
        <div className="row">
          {c.assessorKind === "dev_baseline" && <Badge kind="warning">Development baseline — not a clinical assessment</Badge>}
          {c.overall.provisional && <Badge kind="warning">Provisional</Badge>}
        </div>
      </header>
      <section className="stack">
        <h3>Overall</h3>
        {c.overall.ratingDisplay && <p style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>{c.overall.ratingDisplay}</p>}
        <p style={{ margin: 0 }}>{c.overall.summary}</p>
        {c.overall.uncertaintyStatement && <Alert kind="warning">{c.overall.uncertaintyStatement}</Alert>}
        <p className="muted" style={{ fontSize: "0.86rem", margin: 0 }}>{c.overall.ratingDisclaimer}</p>
      </section>
      {c.strengths.length > 0 && (
        <section className="stack">
          <h3>Strengths</h3>
          {c.strengths.map((s) => (
            <div key={s.elementId}>
              <p style={{ margin: 0 }}>{s.summary}</p>
              {s.evidence.map((e) => (
                <blockquote key={e.segmentId + e.quote} className="evidence">“{e.quote}” <span className="muted">— {ts(e.atMs)}</span></blockquote>
              ))}
            </div>
          ))}
        </section>
      )}
      {c.issues.length > 0 && (
        <section className="stack">
          <h3>Most consequential issues</h3>
          {c.issues.map((i) => (
            <div key={i.elementId} className={`issue ${i.severity} stack`} style={{ gap: 6 }}>
              <div className="row"><strong>{i.rank}.</strong><Badge kind={i.severity === "critical" ? "danger" : i.severity === "important" ? "warning" : "info"}>{i.severity}</Badge><span className="muted">{STATUS_LABEL[i.status]}{i.promptingLevel ? ` · ${PROMPT_LABEL[i.promptingLevel]}` : ""}</span></div>
              <p style={{ margin: 0 }}><strong>What happened:</strong> {i.whatHappened}</p>
              {i.evidence.map((e) => <blockquote key={e.segmentId + e.quote} className="evidence">“{e.quote}” <span className="muted">— {ts(e.atMs)}</span></blockquote>)}
              <p style={{ margin: 0 }}><strong>Why it mattered:</strong> {i.whyItMatters}</p>
              <p style={{ margin: 0 }}><strong>A stronger response:</strong> {i.strongerResponse}</p>
              <p style={{ margin: 0 }}><strong>How to practise:</strong> {i.howToPractise}</p>
            </div>
          ))}
        </section>
      )}
      {c.improvementActions.length > 0 && (
        <section className="stack">
          <h3>Your next three actions</h3>
          <ol style={{ margin: 0 }}>{c.improvementActions.map((a) => <li key={a}>{a}</li>)}</ol>
        </section>
      )}
      <details>
        <summary><strong>Element-by-element detail</strong> (prompting and corrections)</summary>
        <table className="table" style={{ marginTop: 10 }}>
          <thead><tr><th>Element</th><th>Status</th><th>Prompting</th><th>Corrected</th></tr></thead>
          <tbody>
            {c.promptingTable.map((r) => (
              <tr key={r.elementId}><td>{r.construct}</td><td>{STATUS_LABEL[r.status]}</td><td>{r.promptingLevel ? PROMPT_LABEL[r.promptingLevel] : "—"}</td><td>{r.corrected ? "Yes (both statements kept)" : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
      <section className="stack">
        <h3>Reference approach (owner-approved)</h3>
        <p style={{ margin: 0 }}>{c.referenceApproach.text}</p>
        {c.referenceApproach.alternatives.map((a) => <p key={a} className="muted" style={{ margin: 0 }}>Also acceptable: {a}</p>)}
      </section>
      {c.technicalLimitations.length > 0 && (
        <Alert kind="info" title="Technical limitations (not counted against you)">
          <ul style={{ margin: "4px 0 0" }}>{c.technicalLimitations.map((t) => <li key={t}>{t}</li>)}</ul>
        </Alert>
      )}
      <div className="row">
        <Link className="btn btn-sm" href={`/app/session/${sessionId}/replay#${c.caseAttemptId}`}>Replay transcript and images</Link>
        <Link className="btn btn-sm" href={`/app/appeals/new?session=${sessionId}&case=${c.caseAttemptId}&assessment=${c.assessmentId}`}>Dispute transcription or grading</Link>
      </div>
    </article>
  );
}

export function Debrief({ sessionId }: { sessionId: string }) {
  const [d, setD] = useState<SessionDebrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await api<SessionDebrief>(`/api/sessions/${sessionId}/debrief`);
        if (!alive) return;
        setD(r);
        if (r.status === "pending" || r.status === "partial") timer = setTimeout(load, 3000);
      } catch {
        if (alive) setError("Results are unavailable right now.");
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sessionId]);
  if (error) return <Alert kind="danger">{error}</Alert>;
  if (!d) return <p role="status">Loading results…</p>;
  return (
    <div className="stack-lg">
      <div className="row-between">
        <h1>Debrief</h1>
        <span className="badge">{d.mode === "exam" ? "Examination mode" : d.mode === "practice" ? "Practice mode" : "Owner preview"}</span>
      </div>
      {d.status === "pending" && <Alert kind="info" title="Finalizing">{d.pendingReason ?? "Your answers are being assessed."} This page updates automatically.</Alert>}
      {d.status === "unavailable" && <Alert kind="danger" title="Assessment unavailable">{d.pendingReason}</Alert>}
      {d.status === "partial" && d.pendingReason && <Alert kind="warning">{d.pendingReason}</Alert>}
      {d.cases.map((c) => <CaseView key={c.caseAttemptId} c={c} sessionId={sessionId} />)}
      {d.nextActivity && (
        <section className="card">
          <h2>Next practice</h2>
          <p>{d.nextActivity.description}</p>
          <Link className="btn btn-primary" href="/app/plan">Open learning plan</Link>
        </section>
      )}
    </div>
  );
}
