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
  const count = (status: string) => overview?.pipeline.find((p) => p.status === status && !p.fixture)?.n ?? 0;
  const PIPELINE: [string, string][] = [["draft", "Draft"], ["ready_for_owner", "Ready for you"], ["owner_approved", "Approved"], ["published", "Published"]];
  return (
    <OwnerShell>
      <div className="stack-lg">
        <div className="page-head">
          <div>
            <h1>Review queue</h1>
            <p>Items that need your judgment as the clinical reviewer. Routine items wait in the digest.</p>
          </div>
          {overview && overview.deadJobs > 0 && <Badge kind="danger">{overview.deadJobs} failed background job(s)</Badge>}
        </div>

        {overview && (
          <p className="muted" style={{ margin: 0 }}>
            Clinical cases: {PIPELINE.map(([s, label], i) => <span key={s}>{i > 0 && " · "}{label} <strong style={{ color: "var(--text)" }}>{count(s)}</strong></span>)}
          </p>
        )}

        {items && groups.urgent.length === 0 && groups.normal.length === 0 ? (
          <p className="empty">Nothing needs your review right now.</p>
        ) : (
          <>
            {groups.urgent.length > 0 && <section className="stack"><h2 style={{ margin: 0 }}>Urgent ({groups.urgent.length})</h2>{render(groups.urgent)}</section>}
            {groups.normal.length > 0 && <section className="stack"><h2 style={{ margin: 0 }}>Needs review ({groups.normal.length})</h2>{render(groups.normal)}</section>}
          </>
        )}
        {groups.digest.length > 0 && (
          <details className="card"><summary><strong>Digest ({groups.digest.length})</strong> — routine items for periodic review</summary><div className="stack" style={{ marginTop: 10 }}>{render(groups.digest)}</div></details>
        )}
      </div>
    </OwnerShell>
  );
}
