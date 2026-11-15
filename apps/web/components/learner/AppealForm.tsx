"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SessionDebrief, TranscriptLine } from "@sim/contracts";
import { Alert, Badge, FixtureBanner, Spinner } from "@sim/ui";
import { api } from "@/lib/api";
import { errorText, mmss } from "./learnerFormat";

const STATUS_LABEL: Record<string, string> = {
  demonstrated: "Demonstrated",
  partially_demonstrated: "Partly demonstrated",
  incorrect: "Incorrect",
  not_demonstrated: "Not demonstrated",
  not_assessable: "Not assessable",
  uncertain: "Uncertain",
};
const MAX_ELEMENTS = 20;
const MAX_CORRECTIONS = 20;
const MAX_TEXT = 4000;

export function AppealForm({ sessionId, caseAttemptId, assessmentId }: { sessionId: string | null; caseAttemptId: string | null; assessmentId: string | null }) {
  const missing = !sessionId || !caseAttemptId;
  const [debrief, setDebrief] = useState<SessionDebrief | null>(null);
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [transcriptError, setTranscriptError] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<"transcript" | "grading">("grading");
  const [statement, setStatement] = useState("");
  const [statementTouched, setStatementTouched] = useState(false);
  const [disputed, setDisputed] = useState<string[]>([]);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [appealId, setAppealId] = useState<string | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const statementRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!sessionId || !caseAttemptId) return;
    let alive = true;
    const sid = encodeURIComponent(sessionId);
    api<SessionDebrief>(`/api/sessions/${sid}/debrief`)
      .then((d) => alive && setDebrief(d))
      .catch((e) => alive && setLoadError(errorText(e, "This result could not be loaded.")));
    api<TranscriptLine[]>(`/api/sessions/${sid}/transcript`)
      .then((t) => alive && setLines(Array.isArray(t) ? t : []))
      .catch(() => {
        if (!alive) return;
        setLines([]);
        setTranscriptError(true);
      });
    return () => {
      alive = false;
    };
  }, [sessionId, caseAttemptId]);

  useEffect(() => {
    if (appealId) doneRef.current?.focus();
  }, [appealId]);

  const backToResults = sessionId ? `/app/session/${encodeURIComponent(sessionId)}/results` : "/app";

  if (missing) {
    return (
      <div className="stack-lg" style={{ maxWidth: 860 }}>
        <h1 style={{ margin: 0 }}>Dispute a result</h1>
        <Alert kind="info" title="Start from a debrief">
          Open the station’s results and choose “Dispute transcription or grading” on the case you want to dispute. That link tells us which case and result you mean.
        </Alert>
        <div className="row">
          <Link className="btn btn-primary" href="/app">Go to your dashboard</Link>
          <Link className="btn" href="/app/appeals">View your appeals</Link>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="stack-lg" style={{ maxWidth: 860 }}>
        <h1 style={{ margin: 0 }}>Dispute a result</h1>
        <Alert kind="danger" title="Result unavailable">{loadError}</Alert>
        <Link className="btn self-start" href="/app">Go to your dashboard</Link>
      </div>
    );
  }
  if (!debrief || lines === null) return <Spinner label="Loading the result" />;

  const c = debrief.cases.find((x) => x.caseAttemptId === caseAttemptId);
  const assessment = assessmentId ?? c?.assessmentId ?? null;
  if (!c || !assessment) {
    return (
      <div className="stack-lg" style={{ maxWidth: 860 }}>
        <h1 style={{ margin: 0 }}>Dispute a result</h1>
        <Alert kind="warning" title="Case not available">
          {debrief.status === "pending" ? "Results for this station are still being prepared. You can dispute a case once its debrief is available." : "This case was not found in the station’s released results."}
        </Alert>
        <Link className="btn self-start" href={backToResults}>Back to results</Link>
      </div>
    );
  }

  if (appealId) {
    return (
      <div className="stack-lg" style={{ maxWidth: 860 }}>
        <h1 ref={doneRef} tabIndex={-1} style={{ margin: 0 }}>Appeal submitted</h1>
        <Alert kind="success" title="We have received your appeal">
          Your original result is preserved and stays visible. If a transcript correction or reassessment is made, it is added as a new version alongside the original. Our clinical owner, a practising neuroradiologist, reviews significant disputes.
        </Alert>
        <p style={{ margin: 0 }}>You can follow its status on your appeals page.</p>
        <div className="row">
          <Link className="btn btn-primary" href="/app/appeals">View your appeals</Link>
          <Link className="btn" href={backToResults}>Back to results</Link>
        </div>
      </div>
    );
  }

  const myLines = lines.filter((l) => l.speaker === "candidate" && l.caseAttemptId === caseAttemptId).sort((a, b) => a.atMs - b.atMs);
  const filled = Object.entries(corrections)
    .map(([segmentId, text]) => ({ segmentId, proposedText: text.trim() }))
    .filter((x) => x.proposedText.length > 0 && myLines.some((l) => l.id === x.segmentId));
  const statementOk = statement.trim().length >= 10;
  const tooManyCorrections = kind === "transcript" && filled.length > MAX_CORRECTIONS;
  const tooManyElements = kind === "grading" && disputed.length > MAX_ELEMENTS;
  const canSubmit = statementOk && !tooManyCorrections && !tooManyElements && !submitting;
  const showStatementError = statementTouched && !statementOk;

  const toggleElement = (id: string, on: boolean) => setDisputed((cur) => (on ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatementTouched(true);
    if (!statementOk) {
      statementRef.current?.focus();
      return;
    }
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api<{ appealId: string }>("/api/appeals", {
        body: {
          caseAttemptId: c.caseAttemptId,
          assessmentId: assessment,
          kind,
          statement: statement.trim(),
          disputedElementIds: kind === "grading" ? disputed : [],
          transcriptCorrections: kind === "transcript" ? filled : [],
        },
      });
      setAppealId(r.appealId);
    } catch (err) {
      setSubmitError(errorText(err, "Your appeal could not be submitted. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 860 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ margin: 0 }}>Dispute a result</h1>
        <p className="muted" style={{ margin: 0 }}>
          Your original result is always preserved. Our clinical owner, a practising neuroradiologist, reviews significant disputes.
        </p>
      </div>

      <section className="card stack" aria-labelledby="case-title">
        {c.isDevelopmentFixture && <FixtureBanner />}
        <div className="row-between">
          <h2 id="case-title" style={{ margin: 0 }}>{c.caseLabel}</h2>
          {c.overall.provisional && <Badge kind="warning">Provisional</Badge>}
        </div>
        {c.overall.ratingDisplay && <p style={{ margin: 0, fontWeight: 700 }}>{c.overall.ratingDisplay}</p>}
        <p style={{ margin: 0 }}>{c.overall.summary}</p>
        <Link className="self-start" href={backToResults}>Back to the full debrief</Link>
      </section>

      <form className="stack-lg" onSubmit={submit} noValidate aria-describedby={submitError ? "appeal-error" : undefined}>
        <fieldset className="stack">
          <legend>What are you disputing?</legend>
          <label className="choice">
            <input type="radio" name="appeal-kind" value="grading" checked={kind === "grading"} onChange={() => setKind("grading")} />
            <span><strong>Grading</strong> — how my answer was judged.</span>
          </label>
          <label className="choice">
            <input type="radio" name="appeal-kind" value="transcript" checked={kind === "transcript"} onChange={() => setKind("transcript")} />
            <span><strong>Transcript</strong> — what I said was transcribed incorrectly.</span>
          </label>
        </fieldset>

        <div className="field">
          <label htmlFor="appeal-statement">Explain what you think is wrong</label>
          <textarea
            ref={statementRef}
            id="appeal-statement"
            value={statement}
            maxLength={MAX_TEXT}
            required
            aria-invalid={showStatementError || undefined}
            aria-describedby="appeal-statement-hint"
            onChange={(e) => setStatement(e.target.value)}
            onBlur={() => setStatementTouched(true)}
            rows={5}
          />
          <span id="appeal-statement-hint" className="hint" style={showStatementError ? { color: "var(--danger)" } : undefined}>
            {showStatementError ? "Please write at least 10 characters. " : "At least 10 characters. "}
            Be specific: what you said, and what you think should change. {statement.length}/{MAX_TEXT}
          </span>
        </div>

        {kind === "grading" && (
          <fieldset className="stack">
            <legend>Which elements do you dispute? (optional)</legend>
            {c.promptingTable.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No element-level detail is available for this case. Describe your concern above.</p>
            ) : (
              <>
                <p className="muted text-sm" style={{ margin: 0 }}>Shown with the status in your current result.</p>
                {c.promptingTable.map((r) => {
                  const id = `el-${r.elementId}`;
                  return (
                    <label key={r.elementId} className="choice" htmlFor={id}>
                      <input id={id} type="checkbox" checked={disputed.includes(r.elementId)} onChange={(e) => toggleElement(r.elementId, e.target.checked)} />
                      <span>
                        {r.construct} <span className="muted">— {STATUS_LABEL[r.status] ?? r.status}</span>
                      </span>
                    </label>
                  );
                })}
                {tooManyElements && <Alert kind="warning">Please choose no more than {MAX_ELEMENTS} elements.</Alert>}
              </>
            )}
          </fieldset>
        )}

        {kind === "transcript" && (
          <fieldset className="stack">
            <legend>Your transcribed lines (optional corrections)</legend>
            {transcriptError && <Alert kind="warning">The transcript could not be loaded. You can still describe the problem above.</Alert>}
            {myLines.length === 0 ? (
              !transcriptError && <p className="muted" style={{ margin: 0 }}>No transcribed lines from you were recorded for this case. Describe what you said above.</p>
            ) : (
              <>
                <p className="muted text-sm" style={{ margin: 0 }}>For any line that is wrong, type what you actually said. Leave the others blank.</p>
                {myLines.map((l) => {
                  const id = `fix-${l.id}`;
                  return (
                    <div key={l.id} className="correction stack" style={{ gap: 8 }}>
                      <div className="row">
                        <span className="muted text-sm">You · {mmss(l.atMs)}</span>
                        {l.source === "typed" && <Badge>typed</Badge>}
                      </div>
                      <blockquote className="evidence" style={{ margin: 0 }}>{l.text}</blockquote>
                      <div className="field">
                        <label htmlFor={id}>Proposed correction for the line at {mmss(l.atMs)} (optional)</label>
                        <textarea
                          id={id}
                          rows={2}
                          maxLength={MAX_TEXT}
                          value={corrections[l.id] ?? ""}
                          onChange={(e) => setCorrections((cur) => ({ ...cur, [l.id]: e.target.value }))}
                        />
                      </div>
                    </div>
                  );
                })}
                {tooManyCorrections && <Alert kind="warning">Please propose corrections for no more than {MAX_CORRECTIONS} lines in one appeal.</Alert>}
              </>
            )}
          </fieldset>
        )}

        {submitError && (
          <div id="appeal-error">
            <Alert kind="danger" title="Not submitted">{submitError}</Alert>
          </div>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting} aria-disabled={!canSubmit || undefined}>
            {submitting ? "Submitting…" : "Submit appeal"}
          </button>
          <Link className="btn btn-lg" href={backToResults}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}
