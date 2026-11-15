"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CaseVersion } from "@sim/contracts";
import { Alert, Badge, ConfirmDialog } from "@sim/ui";
import { api, ApiError } from "@/lib/api";
import { useOwnerData } from "./OwnerShell";
import { CaseReview } from "./CaseReview";
import { CaseEditor } from "./CaseEditor";

type Issue = { path: string; message: string; severity: "error" | "warning"; code: string };
type Detail = {
  versionId: string;
  rowVersion: number;
  status: CaseVersion["publicationStatus"];
  payload: CaseVersion;
  hashes: { clinicalContentHash: string; rubricHash: string; assetsHash: string };
  approvalValid: boolean | null;
  validationIssues: Issue[];
  reviews: { id: string; reviewer: string; status: string; summary: string | null; issues: { severity?: string; area?: string; path?: string | null; problem?: string; message?: string; suggestedRevision?: string | null; requiresOwnerDecision?: boolean }[]; createdAt: string }[];
  publicationGate: { ok: true } | { ok: false; code: string; message: string };
  case: { caseId: string; publishedVersionId: string | null; withdrawnAt: string | null; withdrawalReason: string | null };
  versions: { versionId: string; versionNumber: number; status: string }[];
  changeFromPrevious: { kind: string; changed: string[] } | null;
};

function diffPaths(a: unknown, b: unknown, path = "", out: { path: string; before: string; after: string }[] = []): typeof out {
  if (out.length > 200) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) === !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k, out);
    return out;
  }
  out.push({ path, before: JSON.stringify(a)?.slice(0, 200) ?? "—", after: JSON.stringify(b)?.slice(0, 200) ?? "—" });
  return out;
}

export function CaseWorkspace({ versionId }: { versionId: string }) {
  const router = useRouter();
  const { data: d, error, reload } = useOwnerData<Detail>(`/api/owner/case-versions/${encodeURIComponent(versionId)}`);
  const [tab, setTab] = useState<"review" | "edit" | "checks" | "compare" | "json">("review");
  const [draft, setDraft] = useState<CaseVersion | null>(null);
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "danger" | "info"; text: string } | null>(null);
  const [attest, setAttest] = useState(false);
  const [notes, setNotes] = useState("");
  const [authorNotes, setAuthorNotes] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [prev, setPrev] = useState<CaseVersion | null>(null);
  useEffect(() => {
    if (d) {
      setDraft(d.payload);
      setJson(JSON.stringify(d.payload, null, 2));
    }
  }, [d]);
  useEffect(() => {
    const p = d?.payload.previousVersionId;
    if (p) api<Detail>(`/api/owner/case-versions/${encodeURIComponent(p)}`).then((x) => setPrev(x.payload)).catch(() => setPrev(null));
  }, [d?.payload.previousVersionId]);
  if (error) return <Alert kind="danger">{error}</Alert>;
  if (!d || !draft) return <p role="status">Loading…</p>;
  const cv = d.payload;
  const errors = d.validationIssues.filter((i) => i.severity === "error");
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ kind: "success", text: ok });
      reload();
      return r;
    } catch (e) {
      setMsg({ kind: "danger", text: e instanceof ApiError ? `${e.message}${e.issues ? `: ${e.issues.slice(0, 5).map((i) => `${i.path} ${i.message}`).join("; ")}` : ""}` : "Action failed" });
    }
  };
  const post = (path: string, body?: unknown) => api(`/api/owner/case-versions/${encodeURIComponent(versionId)}/${path}`, { method: "POST", body });
  const save = (payload: unknown) => run(() => api(`/api/owner/case-versions/${encodeURIComponent(versionId)}`, { method: "PUT", body: { rowVersion: d.rowVersion, payload } }), "Draft saved and re-validated.");

  return (
    <div className="stack-lg">
      {cv.isDevelopmentFixture && <div className="fixture-banner">Development fixture — fictional content with placeholder images.</div>}
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ marginBottom: 0 }}>{cv.internalTitle}</h1>
          <div className="row"><span className="mono muted">{versionId}</span><Badge kind={d.status === "published" ? "success" : d.status === "ready_for_owner" ? "info" : undefined}>{d.status.replaceAll("_", " ")}</Badge>{d.approvalValid === true && <Badge kind="success">approval matches content</Badge>}{d.approvalValid === false && <Badge kind="danger">approval no longer matches content</Badge>}{d.case.withdrawnAt && <Badge kind="danger">withdrawn</Badge>}</div>
        </div>
        <div className="row">
          <label className="row" style={{ gap: 6 }}>Version
            <select value={versionId} onChange={(e) => router.push(`/owner/cases/${encodeURIComponent(e.target.value)}`)}>{d.versions.map((v) => <option key={v.versionId} value={v.versionId}>v{v.versionNumber} — {v.status}</option>)}</select>
          </label>
        </div>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <section className="card stack">
        <h2>Actions</h2>
        <div className="row">
          {d.status === "draft" && <button className="btn btn-primary" type="button" onClick={() => run(() => post("submit"), "Submitted for automated checks; refresh in a moment.")}>Submit for automated checks</button>}
          {d.status !== "draft" && <button className="btn" type="button" onClick={async () => { const r = (await run(() => post("new-version"), "New draft version created.")) as { versionId?: string } | undefined; if (r?.versionId) router.push(`/owner/cases/${encodeURIComponent(r.versionId)}`); }}>Create new version (revise)</button>}
          <button className="btn" type="button" onClick={() => run(() => post("critique"), "LLM critics queued (they run only if external AI processing is permitted).")}>Run LLM critics</button>
          <button className="btn" type="button" onClick={async () => { const r = (await run(() => post("preview"), "Preview session created.")) as { sessionId?: string } | undefined; if (r?.sessionId) router.push(`/app/session/${r.sessionId}/preflight`); }}>Preview as candidate</button>
          {d.status === "owner_approved" && <button className="btn btn-primary" type="button" disabled={!d.publicationGate.ok} onClick={() => run(() => post("publish"), "Published.")}>Publish</button>}
          {d.status === "published" && <button className="btn" type="button" onClick={() => run(() => post("retire"), "Retired: no new selection.")}>Retire</button>}
          {!d.case.withdrawnAt && <button className="btn btn-danger" type="button" onClick={() => setWithdrawOpen(true)}>Withdraw case…</button>}
        </div>
        {!d.publicationGate.ok && d.status === "owner_approved" && <Alert kind="warning" title="Cannot publish yet">{d.publicationGate.message}</Alert>}
        {d.status === "ready_for_owner" && (
          <div className="card card-tight stack" style={{ borderColor: "var(--accent)" }}>
            <h3>Clinical approval</h3>
            <p className="muted" style={{ margin: 0 }}>Approval binds to content hash <span className="mono">{d.hashes.clinicalContentHash.slice(0, 16)}…</span>. Any later clinical change requires a new version and renewed approval. Rights and privacy clearance are recorded separately below.</p>
            {errors.length > 0 && <Alert kind="danger">This version has {errors.length} validation error(s); approval is blocked.</Alert>}
            <label className="row" style={{ alignItems: "flex-start" }}><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> <span>I have reviewed the clinical truth, images, stages, questions, rubric and reference response of this exact version and approve it for clinical use in examinations.</span></label>
            <div className="field"><label htmlFor="appr-notes">Notes (optional)</label><textarea id="appr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="row">
              <button className="btn btn-primary" type="button" disabled={!attest || errors.length > 0} onClick={() => run(() => post("approve", { attestation: "Reviewed clinical truth, images, stages, questions, rubric and reference response; approved for examination use.", notes, expectedClinicalContentHash: d.hashes.clinicalContentHash }), "Approved.")}>Approve this version</button>
              <button className="btn" type="button" onClick={() => run(() => post("request-changes", { notes: notes || "Changes requested" }), "Returned to draft.")}>Request changes</button>
            </div>
          </div>
        )}
        <Clearances d={d} onSave={(body) => run(() => post("clearances", body), "Clearances recorded.")} />
      </section>

      <div className="row" role="tablist" aria-label="Case views">
        {(["review", "edit", "checks", "compare", "json"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`btn btn-sm${tab === t ? " btn-primary" : ""}`} type="button" onClick={() => setTab(t)}>
            {t === "review" ? "Review package" : t === "edit" ? "Edit (draft)" : t === "checks" ? `Checks & critiques (${d.validationIssues.length})` : t === "compare" ? "Compare with previous" : "JSON"}
          </button>
        ))}
      </div>

      {tab === "review" && <CaseReview cv={cv} />}
      {tab === "edit" && (d.status === "draft" ? (
        <div className="stack">
          <div className="row"><button className="btn btn-primary" type="button" onClick={() => save(draft)}>Save draft</button><span className="muted">The server re-validates every save.</span></div>
          <div className="card card-tight stack">
            <h3>LLM case author</h3>
            <p className="muted" style={{ margin: 0 }}>Drafts stages, questions, rubric and reference response from your notes (only if external AI processing is permitted for this case). It cannot invent facts: unknowns come back as questions for you.</p>
            <textarea aria-label="Notes for the case author" value={authorNotes} onChange={(e) => setAuthorNotes(e.target.value)} placeholder="Your diagnosis, its basis, the key findings and what you expect a good answer to include…" />
            <div><button className="btn btn-sm" type="button" onClick={() => run(() => post("author", { ownerNotes: authorNotes, teachingText: "" }), "Authoring queued.")}>Draft with the LLM author</button></div>
          </div>
          <CaseEditor cv={draft} onChange={setDraft} />
          <div><button className="btn btn-primary" type="button" onClick={() => save(draft)}>Save draft</button></div>
        </div>
      ) : <Alert kind="info">Only drafts can be edited. Create a new version to revise approved or published content.</Alert>)}
      {tab === "checks" && (
        <div className="stack">
          <section className="card">
            <h2>Automated checks</h2>
            {d.validationIssues.length === 0 ? <p className="muted">No issues.</p> : <table className="table"><thead><tr><th>Severity</th><th>Path</th><th>Issue</th></tr></thead><tbody>{d.validationIssues.map((i, k) => <tr key={k}><td><Badge kind={i.severity === "error" ? "danger" : "warning"}>{i.severity}</Badge></td><td className="mono">{i.path}</td><td>{i.message}</td></tr>)}</tbody></table>}
          </section>
          {d.reviews.map((r) => (
            <section key={r.id} className="card stack">
              <div className="row-between"><h3>{r.reviewer.replaceAll("_", " ")}</h3><span className="muted">{r.status} · {new Date(r.createdAt).toLocaleString()}</span></div>
              {r.summary && <p>{r.summary}</p>}
              {r.issues.length > 0 && <ul>{r.issues.map((i, k) => <li key={k}>{i.severity && <Badge kind={i.severity === "blocker" ? "danger" : i.severity === "major" ? "warning" : undefined}>{i.severity}</Badge>} <span className="mono">{i.path ?? i.area ?? ""}</span> {i.problem ?? i.message}{i.suggestedRevision ? <> — <em>suggestion:</em> {i.suggestedRevision}</> : null}{i.requiresOwnerDecision ? <> <Badge kind="info">your decision</Badge></> : null}</li>)}</ul>}
              <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>Critic output is advisory and is never applied automatically.</p>
            </section>
          ))}
        </div>
      )}
      {tab === "compare" && (
        <section className="card stack">
          <h2>Changes from previous version</h2>
          {!prev ? <p className="muted">No previous version.</p> : (
            <>
              <p>Classification: <strong>{d.changeFromPrevious?.kind ?? "—"}</strong>{d.changeFromPrevious?.changed.length ? ` (${d.changeFromPrevious.changed.join(", ")})` : ""}. Display-only changes keep an approval valid; any clinical change requires renewed approval.</p>
              <table className="table"><thead><tr><th>Path</th><th>Before</th><th>After</th></tr></thead><tbody>{diffPaths(prev, cv).filter((x) => !/^(versionId|versionNumber|previousVersionId|publicationStatus|ownerApproval|changeLog|rubric\.versionId)/.test(x.path)).map((x) => <tr key={x.path}><td className="mono">{x.path}</td><td>{x.before}</td><td>{x.after}</td></tr>)}</tbody></table>
            </>
          )}
        </section>
      )}
      {tab === "json" && (
        <section className="stack">
          <textarea aria-label="Case JSON" value={json} onChange={(e) => setJson(e.target.value)} style={{ minHeight: 520, fontFamily: "var(--mono)", fontSize: "0.82rem" }} readOnly={d.status !== "draft"} />
          {d.status === "draft" && <div><button className="btn" type="button" onClick={() => { try { save(JSON.parse(json)); } catch { setMsg({ kind: "danger", text: "Invalid JSON" }); } }}>Save JSON</button></div>}
        </section>
      )}
      <ConfirmDialog
        open={withdrawOpen}
        title="Withdraw this case?"
        body={<div className="stack"><p>Withdrawal stops new selection and immediately revokes image access for every attempt, including learners' replays. Affected attempts are listed in your queue.</p><textarea aria-label="Reason" value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} placeholder="Reason (e.g. rights withdrawn, identifier found)" /></div>}
        confirmLabel="Withdraw"
        danger
        onCancel={() => setWithdrawOpen(false)}
        onConfirm={() => { setWithdrawOpen(false); void run(() => api(`/api/owner/cases/${encodeURIComponent(cv.caseId)}/withdraw`, { method: "POST", body: { reason: withdrawReason || "Withdrawn by owner" } }), "Case withdrawn; media access revoked."); }}
      />
      <p className="muted"><Link href="/owner/cases">← All cases</Link></p>
    </div>
  );
}

function Clearances({ d, onSave }: { d: Detail; onSave: (body: unknown) => void }) {
  const c = d.payload.clearances;
  const [rights, setRights] = useState({ status: c.rights?.status ?? "unresolved", basis: c.rights?.basis ?? "", restrictions: c.rights?.restrictions ?? "" });
  const [privacy, setPrivacy] = useState({ status: c.privacy?.status ?? "unresolved", basis: c.privacy?.basis ?? "", restrictions: c.privacy?.restrictions ?? "" });
  const [ai, setAi] = useState(c.externalAiProcessingAllowed);
  const opts = ["unresolved", "cleared", "restricted", "withdrawn"] as const;
  return (
    <details className="card card-tight">
      <summary><strong>Rights, privacy and external AI processing</strong> — recorded separately from clinical approval</summary>
      <div className="grid-2" style={{ marginTop: 10 }}>
        <fieldset className="stack"><legend>Commercial-use rights</legend>
          <select aria-label="Rights status" value={rights.status} onChange={(e) => setRights({ ...rights, status: e.target.value as (typeof opts)[number] })}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
          <textarea aria-label="Rights basis" placeholder="Permission basis (lecture permission does not by itself settle commercial use)" value={rights.basis} onChange={(e) => setRights({ ...rights, basis: e.target.value })} />
          <input type="text" aria-label="Rights restrictions" placeholder="Restrictions" value={rights.restrictions} onChange={(e) => setRights({ ...rights, restrictions: e.target.value })} />
        </fieldset>
        <fieldset className="stack"><legend>Privacy / de-identification</legend>
          <select aria-label="Privacy status" value={privacy.status} onChange={(e) => setPrivacy({ ...privacy, status: e.target.value as (typeof opts)[number] })}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
          <textarea aria-label="Privacy basis" placeholder="What was checked (metadata, burned-in text, notes, facial features…)" value={privacy.basis} onChange={(e) => setPrivacy({ ...privacy, basis: e.target.value })} />
          <input type="text" aria-label="Privacy restrictions" placeholder="Restrictions" value={privacy.restrictions} onChange={(e) => setPrivacy({ ...privacy, restrictions: e.target.value })} />
        </fieldset>
      </div>
      <label className="row" style={{ marginTop: 8 }}><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> Allow sending approved derivatives and case text to external AI providers (critics, author, assessors)</label>
      <div style={{ marginTop: 8 }}><button className="btn btn-sm" type="button" onClick={() => onSave({ rights, privacy, externalAiProcessingAllowed: ai })}>Record clearances</button></div>
    </details>
  );
}
