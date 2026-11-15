"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Badge } from "@sim/ui";
import { OwnerShell, useOwnerData } from "@/components/owner/OwnerShell";
import { api, ApiError } from "@/lib/api";

type Row = { sessionId: string; userId: string; learner: string; mode: string; status: string; outcome: string | null; createdAt: string; attempts: { id: string; ordinal: number; caseVersionId: string; status: string }[] };

export default function SessionsPage() {
  const { data, error } = useOwnerData<Row[]>("/api/owner/sessions");
  const [adjust, setAdjust] = useState<{ userId: string; learner: string } | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "danger"; text: string } | null>(null);
  const submit = async () => {
    if (!adjust) return;
    try {
      await api(`/api/owner/users/${adjust.userId}/adjust-minutes`, { body: { minutes, reason } });
      setMsg({ kind: "success", text: "Adjustment recorded." });
      setAdjust(null);
      setMinutes(0);
      setReason("");
    } catch (e) {
      setMsg({ kind: "danger", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };
  return (
    <OwnerShell>
      <div className="stack-lg">
        <h1>Sessions and attempts</h1>
        {error && <Alert kind="danger">{error}</Alert>}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {adjust && (
          <div className="card stack">
            <h2>Adjust examination minutes for {adjust.learner}</h2>
            <p className="muted" style={{ margin: 0 }}>Use for verified platform failures. Adjustments are immutable ledger entries with your reason.</p>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field">Minutes (positive credits, negative debits)<input type="number" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
              <label className="field" style={{ flex: 1 }}>Reason<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <button className="btn btn-primary" type="button" disabled={!minutes || reason.trim().length < 5} onClick={submit}>Record adjustment</button>
              <button className="btn" type="button" onClick={() => setAdjust(null)}>Cancel</button>
            </div>
          </div>
        )}
        <table className="table">
          <thead><tr><th>Started</th><th>Learner</th><th>Mode</th><th>Status</th><th>Attempts</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.sessionId}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.learner}</td>
                <td>{r.mode.replaceAll("_", " ")}</td>
                <td><Badge kind={r.outcome === "invalidated_technical" ? "danger" : r.status === "complete" ? "success" : undefined}>{r.status}{r.outcome ? ` · ${r.outcome}` : ""}</Badge></td>
                <td>
                  {r.attempts.length ? (
                    [...r.attempts].sort((a, b) => a.ordinal - b.ordinal).map((a) => (
                      <div key={a.id}><Link href={`/owner/attempts/${a.id}`}>#{a.ordinal + 1} {a.caseVersionId}</Link> <span className="muted">({a.status})</span></div>
                    ))
                  ) : (
                    <span className="muted">none</span>
                  )}
                </td>
                <td><button className="btn btn-sm" type="button" onClick={() => setAdjust({ userId: r.userId, learner: r.learner })}>Adjust minutes…</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OwnerShell>
  );
}
