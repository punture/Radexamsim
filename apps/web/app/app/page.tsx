"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SessionSummary, UsageSummary } from "@sim/contracts";
import { AppShell } from "@/components/learner/AppShell";
import { api } from "@/lib/api";

export default function Dashboard() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    api<SessionSummary[]>("/api/sessions").then(setSessions).catch(() => setSessions([]));
    api<UsageSummary>("/api/billing/usage").then(setUsage).catch(() => setUsage(null));
  }, []);
  return (
    <AppShell>
      <div className="stack-lg">
        <div className="row-between">
          <h1>Dashboard</h1>
          <Link className="btn btn-primary btn-lg" href="/app/setup">Start a station</Link>
        </div>
        <div className="grid-3">
          <div className="card">
            <h2 style={{ fontSize: "1.05rem" }}>Examination minutes</h2>
            {usage ? (
              <>
                <p style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0 }}>{usage.availableMinutes}</p>
                <p className="muted">available{usage.periodEndsAt ? ` · renews ${new Date(usage.periodEndsAt).toLocaleDateString()}` : ""}</p>
                {usage.blockingReason && <p className="muted">{usage.blockingReason}</p>}
                <p className="muted" style={{ margin: 0 }}>Free demonstration cases left: {usage.demoCasesRemaining}</p>
              </>
            ) : (
              <p className="muted">Usage information unavailable.</p>
            )}
          </div>
          <div className="card">
            <h2 style={{ fontSize: "1.05rem" }}>Try the demonstration</h2>
            <p className="muted">One complete practice case with spoken examiner questions and a debrief.</p>
            <Link className="btn" href="/app/setup?demo=1">Start demonstration</Link>
          </div>
          <div className="card">
            <h2 style={{ fontSize: "1.05rem" }}>Next practice</h2>
            <p className="muted">Your learning plan targets repeated, consequential gaps using new cases when available.</p>
            <Link className="btn" href="/app/plan">View learning plan</Link>
          </div>
        </div>
        <section className="card">
          <h2>Recent stations</h2>
          {!sessions ? (
            <p role="status">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="muted">No stations yet.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Profile</th><th>Mode</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.sessionId}>
                    <td>{new Date(s.createdAt).toLocaleString()}</td>
                    <td>{s.profileDisplayName}</td>
                    <td>{s.mode}</td>
                    <td>{s.status === "complete" ? "Results available" : s.status === "finalizing" ? "Assessing…" : s.status}</td>
                    <td>
                      {s.status === "complete" || s.status === "finalizing" ? (
                        <Link href={`/app/session/${s.sessionId}/results`}>Results</Link>
                      ) : s.status === "preflight" || s.status === "ready" ? (
                        <Link href={`/app/session/${s.sessionId}/preflight`}>Continue</Link>
                      ) : s.status === "active" || s.status === "technically_interrupted" ? (
                        <Link href={`/app/session/${s.sessionId}/exam`}>Rejoin</Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}
