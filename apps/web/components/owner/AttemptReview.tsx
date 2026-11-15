"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { CaseVersion, FinalCaseAssessment, ElementResult } from "@sim/contracts";
import { Alert, Badge } from "@sim/ui";
import { api, ApiError } from "@/lib/api";
import { useOwnerData } from "./OwnerShell";

type Segment = { id: string; source: string; text: string; startMs: number; endMs: number; confidence: number | null; revision: number; status: "final" | "superseded"; supersedesSegmentId: string | null; revisionReason: string | null; provider: { name: string; model: string | null } };
type Utterance = { id: string; kind: string; refId: string | null; promptClass: string; text: string; plannedAtMs: number; playbackStartedAtMs: number | null; playedChars: number; playedPortionMethod: string; deliveryStatus: string; ttsProvider: string; targetElementIds: string[]; suppliesElementIds: string[] };
type Pass = { id: string; stage: string; run: number; assessorKind: string; status: string; latencyMs: number | null; provenance: Record<string, unknown>; validationIssues: unknown[]; output: Record<string, unknown> | null; createdAt: string };
type AssessmentRow = { id: string; assessmentVersion: number; payload: FinalCaseAssessment; provisional: boolean; withheld: boolean; assessorKind: string; createdAt: string };
type View = {
  attempt: { id: string; ordinal: number; status: string; closeReason: string | null; startedAtMs: number | null; endedAtMs: number | null };
  session: { id: string; mode: string; status: string; outcome: string | null; profileVersionId: string; technicalNotes: unknown } | null;
  caseVersion: CaseVersion | null;
  segments: Segment[];
  utterances: Utterance[];
  passes: Pass[];
  assessments: AssessmentRow[];
  events: { seq: number; type: string; ms: number; payload: unknown }[];
  reviewItems: { id: string; kind: string; title: string; status: string; detail: string }[];
  appeals: { id: string; kind: string; status: string; statement: string }[];
};

const STATUSES = ["demonstrated", "partially_demonstrated", "incorrect", "not_demonstrated", "not_assessable", "uncertain"] as const;
const LEVELS = ["unsafe", "below_expected", "meets_expected", "strong", "exceptional"] as const;
const fmt = (ms: number | null) => (ms == null ? "—" : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`);
const statusKind = (s: string) => (s === "demonstrated" ? "success" : s === "incorrect" ? "danger" : s === "uncertain" || s === "partially_demonstrated" ? "warning" : undefined);

export function AttemptReview({ id }: { id: string }) {
  const { data: v, error, reload } = useOwnerData<View>(`/api/owner/case-attempts/${encodeURIComponent(id)}`);
  const [ver, setVer] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "danger"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [showSuperseded, setShowSuperseded] = useState(false);
  const timeline = useMemo(() => {
    if (!v) return [];
    const segs = v.segments.filter((s) => showSuperseded || s.status === "final").map((s) => ({ t: s.startMs, kind: "candidate" as const, s }));
    const utts = v.utterances.map((u) => ({ t: u.playbackStartedAtMs ?? u.plannedAtMs, kind: "examiner" as const, u }));
    return [...segs, ...utts].sort((a, b) => a.t - b.t);
  }, [v, showSuperseded]);
  if (error) return <Alert kind="danger">{error}</Alert>;
  if (!v) return <p role="status">Loading…</p>;
  const cv = v.caseVersion;
  const current = v.assessments.find((a) => a.assessmentVersion === ver) ?? v.assessments.at(-1) ?? null;
  const el = (eid: string) => cv?.rubric.elements.find((e) => e.id === eid);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "success", text: ok });
      setVer(null);
      reload();
    } catch (e) {
      setMsg({ kind: "danger", text: e instanceof ApiError ? e.message : "Action failed" });
    }
  };
  return (
    <div className="stack-lg">
      {cv?.isDevelopmentFixture && <div className="fixture-banner">Development fixture attempt — excluded from clinical scores and readiness.</div>}
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ marginBottom: 0 }}>Case attempt {v.attempt.ordinal + 1}: {cv?.internalTitle ?? "(case unavailable)"}</h1>
          <div className="row muted" style={{ fontSize: "0.88rem" }}>
            <span className="mono">{v.attempt.id}</span>
            <Badge>{v.attempt.status}</Badge>
            {v.attempt.closeReason && <span>closed: {v.attempt.closeReason}</span>}
            {v.session && <span>session {v.session.mode} · {v.session.status}{v.session.outcome ? ` · ${v.session.outcome}` : ""} · profile {v.session.profileVersionId}</span>}
          </div>
        </div>
        {cv && <Link className="btn btn-sm" href={`/owner/cases/${encodeURIComponent(cv.versionId)}`}>Open case version</Link>}
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {v.reviewItems.filter((r) => r.status === "open").map((r) => <Alert key={r.id} kind="warning" title={r.title}>{r.detail}</Alert>)}

      <section className="card stack">
        <div className="row-between">
          <h2>Assessment</h2>
          {v.assessments.length > 1 && (
            <label className="row" style={{ gap: 6 }}>Version
              <select value={current?.assessmentVersion ?? ""} onChange={(e) => setVer(Number(e.target.value))}>{v.assessments.map((a) => <option key={a.id} value={a.assessmentVersion}>v{a.assessmentVersion} — {a.assessorKind}{a.payload.supersedeReason ? ` (${a.payload.supersedeReason.slice(0, 40)})` : ""}</option>)}</select>
            </label>
          )}
        </div>
        {!current ? <p className="muted">No assessment stored yet.</p> : (
          <>
            <div className="row">
              <strong>{current.payload.globalRating.display ?? "Rating withheld"}</strong>
              {current.provisional && <Badge kind="warning">provisional</Badge>}
              {current.withheld && <Badge kind="warning">withheld</Badge>}
              {current.assessorKind === "dev_baseline" && <Badge kind="warning">dev baseline assessor (not clinical)</Badge>}
              <span className="muted">frozen: case {current.payload.frozenVersions.caseVersionId} · rubric {current.payload.frozenVersions.rubricVersionId} · transcript rev {current.payload.frozenVersions.transcriptRevision}</span>
            </div>
            {current.payload.globalRating.withheldReason && <p>Withheld: {current.payload.globalRating.withheldReason}</p>}
            {current.payload.globalRating.capsApplied.length > 0 && <p>Caps applied: {current.payload.globalRating.capsApplied.join("; ")}</p>}
            {current.payload.criticalConcerns.length > 0 && <Alert kind="danger" title="Critical concerns"><ul style={{ margin: 0 }}>{current.payload.criticalConcerns.map((c, i) => <li key={i}>{c}</li>)}</ul></Alert>}
            {current.payload.uncertaintyReasons.length > 0 && <Alert kind="warning" title="Uncertainty"><ul style={{ margin: 0 }}>{current.payload.uncertaintyReasons.map((c, i) => <li key={i}>{c}</li>)}</ul></Alert>}
            {current.payload.technicalLimitations.length > 0 && <p className="muted">Technical limitations: {current.payload.technicalLimitations.join("; ")}</p>}
            <table className="table">
              <thead><tr><th>Element</th><th>Judgment</th><th>Evidence (verified quotes)</th><th>Rationale</th><th /></tr></thead>
              <tbody>
                {current.payload.elementResults.map((r) => (
                  <ElementRow key={r.elementId} r={r} construct={el(r.elementId)?.construct ?? r.elementId} disputed={current.payload.disputedElementIds.includes(r.elementId)} latest={current === v.assessments.at(-1)}
                    onDecide={(body) => run(() => api(`/api/owner/case-attempts/${encodeURIComponent(id)}/resolve-element`, { body: { elementId: r.elementId, ...body } }), "Decision recorded as a new assessment version; the debrief is being rebuilt.")} />
                ))}
              </tbody>
            </table>
            {current.payload.unsafeFlags.length > 0 && (
              <>
                <h3>Unsafe statements (matched to approved criteria)</h3>
                <ul>{current.payload.unsafeFlags.map((f, i) => <li key={i}><strong>{f.criterion}</strong> — “{f.evidence.map((e) => e.quote).join(" … ")}” · {f.committed ? "committed" : "tentative"}{f.correctedLater ? " · corrected later" : ""}<br /><span className="muted">{f.consequence}</span></li>)}</ul>
              </>
            )}
            <h3>Domain ratings</h3>
            <ul>{current.payload.domainRatings.map((d) => <li key={d.domain}><strong>{d.domain}</strong>: {d.level ?? "withheld"} — {d.rationale}</li>)}</ul>
          </>
        )}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label htmlFor="reassess-reason">Reassess with a forced second pass</label><input id="reassess-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. transcript corrected, rubric clarified)" /></div>
          <button className="btn" type="button" disabled={reason.trim().length < 3} onClick={() => run(() => api(`/api/owner/case-attempts/${encodeURIComponent(id)}/reassess`, { body: { reason } }), "Reassessment queued; earlier versions are preserved.")}>Queue reassessment</button>
        </div>
      </section>

      <section className="card stack">
        <div className="row-between"><h2>Transcript and examiner speech</h2><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} /> Show superseded revisions</label></div>
        <p className="muted" style={{ margin: 0 }}>Examiner text shows the portion actually played (solid) and the unplayed remainder (struck). Only played content counts as prompting.</p>
        <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {timeline.map((x) => x.kind === "candidate" ? (
            <li key={`s${x.s.id}`} style={{ opacity: x.s.status === "superseded" ? 0.55 : 1 }}>
              <span className="mono muted">{fmt(x.s.startMs)}</span> <strong>Candidate</strong> <span className="muted" style={{ fontSize: "0.8rem" }}>({x.s.source}, {x.s.provider.name}{x.s.confidence != null ? `, conf ${x.s.confidence.toFixed(2)}` : ""}{x.s.revision ? `, rev ${x.s.revision}${x.s.revisionReason ? `: ${x.s.revisionReason}` : ""}` : ""}{x.s.status === "superseded" ? ", superseded" : ""})</span>
              <div style={{ whiteSpace: "pre-wrap" }}>{x.s.text}</div>
              <span className="mono muted" style={{ fontSize: "0.72rem" }}>{x.s.id}</span>
            </li>
          ) : (
            <li key={`u${x.u.id}`} style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 8 }}>
              <span className="mono muted">{fmt(x.t)}</span> <strong>Examiner</strong> <span className="muted" style={{ fontSize: "0.8rem" }}>({x.u.kind}{x.u.refId ? ` ${x.u.refId}` : ""}, {x.u.promptClass}, {x.u.deliveryStatus}, {x.u.playedPortionMethod}, {x.u.ttsProvider}{x.u.suppliesElementIds.length ? `, supplies ${x.u.suppliesElementIds.join(", ")}` : ""})</span>
              <div><span>{x.u.text.slice(0, x.u.playedChars)}</span><s className="muted">{x.u.text.slice(x.u.playedChars)}</s></div>
            </li>
          ))}
        </ol>
      </section>

      <details className="card">
        <summary><strong>Assessment passes ({v.passes.length})</strong> — extraction, independent A/B, adjudication; provenance and validation</summary>
        <table className="table" style={{ marginTop: 10 }}>
          <thead><tr><th>Stage</th><th>Assessor</th><th>Status</th><th>Latency</th><th>Prompt / model</th><th>Validation</th><th>Output</th></tr></thead>
          <tbody>{v.passes.map((p) => (
            <tr key={p.id}>
              <td>{p.stage} #{p.run}</td><td>{p.assessorKind}</td><td><Badge kind={p.status === "valid" ? "success" : p.status === "invalid" || p.status === "unavailable" ? "danger" : "warning"}>{p.status}</Badge></td><td>{p.latencyMs ?? "—"} ms</td>
              <td className="mono" style={{ fontSize: "0.75rem" }}>{String(p.provenance.promptId ?? "")} {String(p.provenance.promptVersion ?? "")}<br />{String(p.provenance.servedModel ?? p.provenance.model ?? "")}</td>
              <td>{p.validationIssues.length ? <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.72rem", margin: 0 }}>{JSON.stringify(p.validationIssues, null, 1).slice(0, 1200)}</pre> : "—"}</td>
              <td>{p.output ? <details><summary>view</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: "0.72rem", maxHeight: 360, overflow: "auto" }}>{JSON.stringify(p.output, null, 1)}</pre></details> : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </details>

      <details className="card">
        <summary><strong>Session events ({v.events.length})</strong> — durable, ordered</summary>
        <table className="table" style={{ marginTop: 10 }}><thead><tr><th>#</th><th>Clock</th><th>Type</th><th>Payload</th></tr></thead>
          <tbody>{v.events.map((e) => <tr key={e.seq}><td>{e.seq}</td><td className="mono">{fmt(e.ms)}</td><td className="mono">{e.type}</td><td><code style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>{JSON.stringify(e.payload).slice(0, 300)}</code></td></tr>)}</tbody>
        </table>
      </details>

      {v.appeals.length > 0 && <section className="card"><h2>Appeals</h2><ul>{v.appeals.map((a) => <li key={a.id}><Badge>{a.status}</Badge> {a.kind}: {a.statement} — <Link href="/owner/appeals">open appeals</Link></li>)}</ul></section>}
    </div>
  );
}

function ElementRow({ r, construct, disputed, latest, onDecide }: { r: ElementResult; construct: string; disputed: boolean; latest: boolean; onDecide: (b: { status: string; rationale: string; globalLevel?: string | null }) => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>(r.status);
  const [rationale, setRationale] = useState("");
  const [level, setLevel] = useState<string>("");
  return (
    <>
      <tr style={disputed || r.status === "uncertain" ? { background: "var(--warning-bg, rgba(245,158,11,0.08))" } : undefined}>
        <td><Badge kind={r.severity === "critical" ? "danger" : r.severity === "important" ? "warning" : undefined}>{r.severity}</Badge><br />{construct}<br /><span className="mono muted" style={{ fontSize: "0.75rem" }}>{r.elementId}</span></td>
        <td><Badge kind={statusKind(r.status)}>{r.status.replaceAll("_", " ")}</Badge><br /><span className="muted" style={{ fontSize: "0.82rem" }}>{r.promptingLevel ?? "—"} · credit {r.credit} · {r.agreement}{disputed ? " · DISPUTED" : ""}</span></td>
        <td>{r.evidence.length ? r.evidence.map((e, i) => <div key={i}>“{e.quote}”</div>) : <span className="muted">{r.opportunity.assessable ? `opportunity: ${r.opportunity.description}` : `not assessable: ${r.opportunity.notAssessableReasons.join(", ")}`}</span>}{r.selfCorrection && <div className="muted">self-corrected: “{r.selfCorrection.initial.quote}” → “{r.selfCorrection.correction.quote}”</div>}</td>
        <td style={{ maxWidth: 320 }}>{r.rationale}{r.uncertaintyReason && <div className="muted">Uncertain: {r.uncertaintyReason}</div>}{r.blockedByElementIds.length > 0 && <div className="muted">Blocked by: {r.blockedByElementIds.join(", ")}</div>}</td>
        <td>{latest && <button className="btn btn-sm" type="button" onClick={() => setOpen((o) => !o)}>{disputed || r.status === "uncertain" ? "Decide…" : "Override…"}</button>}</td>
      </tr>
      {open && (
        <tr><td colSpan={5}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field">Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>
            <label className="field" style={{ flex: 1, minWidth: 260 }}>Rationale (recorded and shown in the audit trail)<input type="text" value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
            <label className="field">Global level (optional)<select value={level} onChange={(e) => setLevel(e.target.value)}><option value="">recompute</option>{LEVELS.map((l) => <option key={l} value={l}>{l.replaceAll("_", " ")}</option>)}</select></label>
            <button className="btn btn-primary btn-sm" type="button" disabled={rationale.trim().length < 5} onClick={() => { onDecide({ status, rationale, globalLevel: level || null }); setOpen(false); }}>Record decision</button>
          </div>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.82rem" }}>Credit for demonstrated/partial/incorrect still requires a verified candidate quote. A decision creates a new assessment version; earlier versions stay visible.</p>
        </td></tr>
      )}
    </>
  );
}
