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

const quote = (e: { segmentId: string; quote: string; atMs: number }) => (
  <blockquote key={e.segmentId + e.quote} className="evidence">“{e.quote}” <span className="muted">— {ts(e.atMs)}</span></blockquote>
);

function CaseView({ c, sessionId }: { c: CaseDebrief; sessionId: string }) {
  return (
    <article id={`case-${c.caseAttemptId}`} className="card stack-lg" aria-labelledby={`case-h-${c.caseAttemptId}`} style={{ scrollMarginTop: 80 }}>
      {c.isDevelopmentFixture && <FixtureBanner />}
      <header className="row-between">
        <h2 id={`case-h-${c.caseAttemptId}`} style={{ margin: 0 }}>{c.caseLabel}</h2>
        <div className="row">
          {c.assessorKind === "dev_baseline" && <Badge kind="warning">Development baseline — not a clinical assessment</Badge>}
          {c.overall.provisional && <Badge kind="warning">Provisional</Badge>}
        </div>
      </header>

      <section className="stack" style={{ gap: 8 }} aria-label="Overall">
        {c.overall.ratingDisplay && <p className="stat" style={{ fontSize: "1.4rem" }}>{c.overall.ratingDisplay}</p>}
        <p style={{ margin: 0 }}>{c.overall.summary}</p>
        {c.overall.uncertaintyStatement && <Alert kind="warning">{c.overall.uncertaintyStatement}</Alert>}
        <p className="muted text-sm" style={{ margin: 0 }}>{c.overall.ratingDisclaimer}</p>
      </section>

      {c.improvementActions.length > 0 && (
        <section className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>Your next actions</h3>
          <ol style={{ margin: 0, paddingLeft: "1.3em" }}>{c.improvementActions.map((a) => <li key={a}>{a}</li>)}</ol>
        </section>
      )}

      {c.strengths.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>Strengths</h3>
          {c.strengths.map((s) => (
            <div key={s.elementId}>
              <p style={{ margin: 0 }}>{s.summary}</p>
              {s.evidence.map(quote)}
            </div>
          ))}
        </section>
      )}

      {c.issues.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>Issues to work on</h3>
          {c.issues.map((i, n) => (
            <details key={i.elementId} className={`issue ${i.severity}`} open={n === 0}>
              <summary style={{ cursor: "pointer" }}>
                <strong>{i.rank}.</strong> <Badge kind={i.severity === "critical" ? "danger" : i.severity === "important" ? "warning" : "info"}>{i.severity}</Badge> {i.whatHappened}
              </summary>
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                <span className="muted text-sm">{STATUS_LABEL[i.status]}{i.promptingLevel ? ` · ${PROMPT_LABEL[i.promptingLevel]}` : ""}</span>
                {i.evidence.map(quote)}
                <p style={{ margin: 0 }}><strong>Why it mattered:</strong> {i.whyItMatters}</p>
                <p style={{ margin: 0 }}><strong>A stronger response:</strong> {i.strongerResponse}</p>
                <p style={{ margin: 0 }}><strong>How to practise:</strong> {i.howToPractise}</p>
              </div>
            </details>
          ))}
        </section>
      )}

      <section className="stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Reference approach (owner-approved)</h3>
        <p style={{ margin: 0 }}>{c.referenceApproach.text}</p>
        {c.referenceApproach.alternatives.map((a) => <p key={a} className="muted" style={{ margin: 0 }}>Also acceptable: {a}</p>)}
      </section>

      {c.technicalLimitations.length > 0 && (
        <Alert kind="info" title="Technical limitations (not counted against you)">
          <ul style={{ margin: "4px 0 0" }}>{c.technicalLimitations.map((t) => <li key={t}>{t}</li>)}</ul>
        </Alert>
      )}

      <details>
        <summary style={{ cursor: "pointer" }}><strong>Element-by-element detail</strong> <span className="muted">(prompting and corrections)</span></summary>
        <table className="table" style={{ marginTop: 10 }}>
          <thead><tr><th>Element</th><th>Status</th><th>Prompting</th><th>Corrected</th></tr></thead>
          <tbody>
            {c.promptingTable.map((r) => (
              <tr key={r.elementId}><td>{r.construct}</td><td>{STATUS_LABEL[r.status]}</td><td>{r.promptingLevel ? PROMPT_LABEL[r.promptingLevel] : "—"}</td><td>{r.corrected ? "Yes (both statements kept)" : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </details>

      <div className="row">
        <Link className="btn btn-sm" href={`/app/session/${sessionId}/replay#${c.caseAttemptId}`}>Replay transcript and images</Link>
        <Link className="btn btn-sm btn-ghost" href={`/app/appeals/new?session=${sessionId}&case=${c.caseAttemptId}&assessment=${c.assessmentId}`}>Dispute transcription or grading</Link>
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
  const modeLabel = d.mode === "exam" ? "Examination mode" : d.mode === "practice" ? "Practice mode" : "Owner preview";
  return (
    <div className="stack-lg narrow" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <div>
          <h1>Debrief</h1>
          <p>{modeLabel}{d.cases.length > 1 ? ` · ${d.cases.length} cases` : ""}</p>
        </div>
      </div>
      {d.status === "pending" && <Alert kind="info" title="Finalizing">{d.pendingReason ?? "Your answers are being assessed."} This page updates automatically.</Alert>}
      {d.status === "unavailable" && <Alert kind="danger" title="Assessment unavailable">{d.pendingReason}</Alert>}
      {d.status === "partial" && d.pendingReason && <Alert kind="warning">{d.pendingReason}</Alert>}
      {d.cases.length > 1 && (
        <nav aria-label="Cases in this station" className="row" style={{ gap: 8 }}>
          {d.cases.map((c) => (
            <a key={c.caseAttemptId} className="btn btn-sm" href={`#case-${c.caseAttemptId}`}>{c.caseLabel}</a>
          ))}
        </nav>
      )}
      {d.cases.map((c) => <CaseView key={c.caseAttemptId} c={c} sessionId={sessionId} />)}
      {d.nextActivity && (
        <section className="card row-between">
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Next practice</h2>
            <p className="muted" style={{ margin: 0 }}>{d.nextActivity.description}</p>
          </div>
          <Link className="btn btn-primary" href="/app/plan">Open learning plan</Link>
        </section>
      )}
    </div>
  );
}
