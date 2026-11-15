"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@sim/ui";
import { OwnerShell, useOwnerData } from "@/components/owner/OwnerShell";
import { api } from "@/lib/api";

type Item = { id: string; kind: string; priority: "urgent" | "normal" | "digest"; title: string; detail: string; refs: Record<string, string>; createdAt: string };
const KIND_LABEL: Record<string, string> = {
  assessment_disagreement: "Assessment disagreement",
  uncertain_finding: "Uncertain finding",
  consequential_grading_risk: "Consequential grading risk",
  rights_privacy_concern: "Rights / privacy",
  learner_appeal: "Learner appeal",
  changed_clinical_content: "Changed clinical content",
  case_ready_for_approval: "Case ready for approval",
  technical_failure_adjustment: "Technical failure",
};

function link(i: Item): string | null {
  if (i.refs.versionId) return `/owner/cases/${encodeURIComponent(i.refs.versionId)}`;
  if (i.refs.caseAttemptId) return `/owner/attempts/${i.refs.caseAttemptId}`;
  if (i.refs.appealId) return "/owner/appeals";
  return null;
}

export default function OwnerQueue() {
  const { data: items, reload } = useOwnerData<Item[]>("/api/owner/review-items?status=open");
  const { data: overview } = useOwnerData<{ deadJobs: number; pipeline: { status: string; fixture: boolean; n: number }[] }>("/api/owner/overview");
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const groups = { urgent: items?.filter((i) => i.priority === "urgent") ?? [], normal: items?.filter((i) => i.priority === "normal") ?? [], digest: items?.filter((i) => i.priority === "digest") ?? [] };
  const resolve = async (id: string, status: "resolved" | "dismissed") => {
    await api(`/api/owner/review-items/${id}/resolve`, { body: { status, resolution: note || status } });
    setResolving(null);
    setNote("");
    reload();
  };
  const render = (list: Item[]) =>
    list.map((i) => (
      <div key={i.id} className="card card-tight stack" style={{ gap: 6 }}>
        <div className="row-between">
          <div className="row"><Badge kind={i.priority === "urgent" ? "danger" : i.priority === "normal" ? "warning" : undefined}>{i.priority}</Badge><strong>{i.title}</strong></div>
          <span className="muted" style={{ fontSize: "0.82rem" }}>{KIND_LABEL[i.kind] ?? i.kind} · {new Date(i.createdAt).toLocaleString()}</span>
        </div>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{i.detail}</p>
        <div className="row">
          {link(i) && <Link className="btn btn-sm" href={link(i)!}>Open</Link>}
          {resolving === i.id ? (
            <>
              <input type="text" aria-label="Resolution note" placeholder="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} style={{ maxWidth: 360 }} />
              <button className="btn btn-sm btn-primary" type="button" onClick={() => resolve(i.id, "resolved")}>Resolve</button>
              <button className="btn btn-sm" type="button" onClick={() => resolve(i.id, "dismissed")}>Dismiss</button>
            </>
          ) : (
            <button className="btn btn-sm" type="button" onClick={() => setResolving(i.id)}>Resolve…</button>
          )}
        </div>
      </div>
    ));
  return (
    <OwnerShell>
      <div className="stack-lg">
        <div className="row-between">
          <h1>Review queue</h1>
          {overview && overview.deadJobs > 0 && <Badge kind="danger">{overview.deadJobs} failed background job(s)</Badge>}
        </div>
        <p className="muted">You are the only human clinical reviewer. Items needing your judgment are listed first; routine items are batched in the digest.</p>
        <section className="stack"><h2>Urgent ({groups.urgent.length})</h2>{groups.urgent.length ? render(groups.urgent) : <p className="muted">Nothing urgent.</p>}</section>
        <section className="stack"><h2>Needs review ({groups.normal.length})</h2>{groups.normal.length ? render(groups.normal) : <p className="muted">No open items.</p>}</section>
        <details className="card"><summary><strong>Digest ({groups.digest.length})</strong> — routine items for periodic review</summary><div className="stack" style={{ marginTop: 10 }}>{render(groups.digest)}</div></details>
        {overview && (
          <section className="card"><h2>Case pipeline</h2>
            <table className="table"><thead><tr><th>Status</th><th>Clinical</th><th>Fixtures</th></tr></thead><tbody>
              {["draft", "automated_checks", "ready_for_owner", "owner_approved", "published", "retired"].map((s) => (
                <tr key={s}><td>{s}</td><td>{overview.pipeline.find((p) => p.status === s && !p.fixture)?.n ?? 0}</td><td>{overview.pipeline.find((p) => p.status === s && p.fixture)?.n ?? 0}</td></tr>
              ))}
            </tbody></table>
          </section>
        )}
      </div>
    </OwnerShell>
  );
}
