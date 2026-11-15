"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Badge } from "@sim/ui";
import { OwnerShell, useOwnerData } from "@/components/owner/OwnerShell";
import { api, ApiError } from "@/lib/api";

type Appeal = { id: string; userId: string; caseAttemptId: string; assessmentId: string; kind: "transcript" | "grading"; statement: string; disputedElementIds: string[]; transcriptCorrections: { segmentId: string; proposedText: string }[]; status: string; resolution: string | null; createdAt: string; resolvedAt: string | null };

function AppealCard({ a, onDone }: { a: Appeal; onDone: () => void }) {
  const [decision, setDecision] = useState<"upheld" | "revised" | "rejected">("revised");
  const [resolution, setResolution] = useState("");
  const [corr, setCorr] = useState(a.transcriptCorrections.map((c) => ({ ...c, accept: true, text: c.proposedText })));
  const [reassess, setReassess] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const open = a.status === "submitted" || a.status === "under_review";
  return (
    <article className="card stack">
      <div className="row-between">
        <div className="row"><Badge kind={open ? "warning" : undefined}>{a.status.replaceAll("_", " ")}</Badge><strong>{a.kind === "transcript" ? "Transcript correction" : "Grading appeal"}</strong></div>
        <span className="muted" style={{ fontSize: "0.85rem" }}>{new Date(a.createdAt).toLocaleString()} · <Link href={`/owner/attempts/${a.caseAttemptId}`}>open attempt</Link></span>
      </div>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{a.statement}</p>
      {a.disputedElementIds.length > 0 && <p className="muted" style={{ margin: 0 }}>Disputed elements: {a.disputedElementIds.join(", ")}</p>}
      {!open && a.resolution && <p style={{ margin: 0 }}><strong>Resolution:</strong> {a.resolution}</p>}
      {open && (
        <div className="stack">
          {corr.length > 0 && (
            <fieldset className="stack"><legend>Proposed transcript corrections (accepted ones create new transcript revisions; originals are preserved)</legend>
              {corr.map((c, i) => (
                <div key={c.segmentId} className="row" style={{ alignItems: "flex-start" }}>
                  <input type="checkbox" aria-label={`Accept correction ${i + 1}`} checked={c.accept} onChange={(e) => setCorr(corr.map((x, k) => (k === i ? { ...x, accept: e.target.checked } : x)))} />
                  <textarea aria-label={`Corrected text ${i + 1}`} value={c.text} onChange={(e) => setCorr(corr.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} style={{ flex: 1, minHeight: 60 }} />
                  <span className="mono muted" style={{ fontSize: "0.72rem" }}>{c.segmentId.slice(0, 8)}</span>
                </div>
              ))}
            </fieldset>
          )}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field">Decision<select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}><option value="upheld">original result confirmed after review</option><option value="revised">result revised</option><option value="rejected">not accepted for review (no basis / out of scope)</option></select></label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={reassess} onChange={(e) => setReassess(e.target.checked)} /> Reassess (new version, forced second pass)</label>
          </div>
          <div className="field"><label htmlFor={`res-${a.id}`}>Resolution shown to the learner</label><textarea id={`res-${a.id}`} value={resolution} onChange={(e) => setResolution(e.target.value)} /></div>
          {err && <Alert kind="danger">{err}</Alert>}
          <div><button className="btn btn-primary" type="button" disabled={resolution.trim().length < 5} onClick={async () => {
            setErr(null);
            try {
              await api(`/api/owner/appeals/${a.id}/resolve`, { body: { decision, resolution, reassess, transcriptCorrections: corr.filter((c) => c.accept).map((c) => ({ segmentId: c.segmentId, correctedText: c.text })) } });
              onDone();
            } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed"); }
          }}>Resolve appeal</button></div>
        </div>
      )}
    </article>
  );
}

export default function Appeals() {
  const { data, error, reload } = useOwnerData<Appeal[]>("/api/owner/appeals");
  const open = data?.filter((a) => a.status === "submitted" || a.status === "under_review") ?? [];
  const closed = data?.filter((a) => !open.includes(a)) ?? [];
  return (
    <OwnerShell>
      <div className="stack-lg">
        <h1>Appeals</h1>
        <p className="muted">Resolutions never delete history: corrections create new transcript revisions and reassessment creates a new assessment version linked to the appeal.</p>
        {error && <Alert kind="danger">{error}</Alert>}
        <section className="stack"><h2>Open ({open.length})</h2>{open.length ? open.map((a) => <AppealCard key={a.id} a={a} onDone={reload} />) : <p className="muted">No open appeals.</p>}</section>
        <details><summary><strong>Resolved ({closed.length})</strong></summary><div className="stack" style={{ marginTop: 10 }}>{closed.map((a) => <AppealCard key={a.id} a={a} onDone={reload} />)}</div></details>
      </div>
    </OwnerShell>
  );
}
