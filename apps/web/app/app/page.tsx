"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SessionSummary, UsageSummary } from "@sim/contracts";
import { AppShell } from "@/components/learner/AppShell";
import { api } from "@/lib/api";

const MODE: Record<string, string> = { exam: "Examination", practice: "Practice", owner_preview: "Owner preview" };

function statusText(s: SessionSummary): string {
  if (s.status === "complete") return "Results available";
  if (s.status === "finalizing") return "Assessing…";
  if (s.status === "preflight" || s.status === "ready") return "Not started";
  if (s.status === "active") return "In progress";
  if (s.status === "technically_interrupted") return "Interrupted";
  return s.status.replace(/_/g, " ");
}

function action(s: SessionSummary): { href: string; label: string } | null {
  if (s.status === "complete" || s.status === "finalizing") return { href: `/app/session/${s.sessionId}/results`, label: "Results" };
  if (s.status === "preflight" || s.status === "ready") return { href: `/app/session/${s.sessionId}/preflight`, label: "Continue" };
  if (s.status === "active" || s.status === "technically_interrupted") return { href: `/app/session/${s.sessionId}/exam`, label: "Rejoin" };
  return null;
}

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
        <div className="page-head">
          <div>
            <h1>Dashboard</h1>
            <p>
              {usage
                ? `${usage.availableMinutes} examination minutes available${usage.periodEndsAt ? `, renewing ${new Date(usage.periodEndsAt).toLocaleDateString()}` : ""}.`
                : "Start a station whenever you are ready."}
            </p>
          </div>
          <Link className="btn btn-primary btn-lg" href="/app/setup">Start a station</Link>
        </div>

        {usage?.blockingReason && <div className="alert alert-warning">{usage.blockingReason}</div>}

        {usage && usage.demoCasesRemaining > 0 && (
          <div className="card row-between">
            <div>
              <strong>Try the free demonstration</strong>
              <p className="muted" style={{ margin: 0 }}>One practice case with spoken examiner questions and feedback. It does not use your minutes.</p>
            </div>
            <Link className="btn" href="/app/setup?demo=1">Start demonstration</Link>
          </div>
        )}

        <section className="stack" aria-labelledby="recent-title">
          <div className="row-between">
            <h2 id="recent-title" style={{ margin: 0 }}>Recent stations</h2>
            <Link href="/app/plan">Your learning plan</Link>
          </div>
          {!sessions ? (
            <p role="status">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="empty">No stations yet.</p>
          ) : (
            <ul className="list">
              {sessions.map((s) => {
                const a = action(s);
                return (
                  <li key={s.sessionId}>
                    <div>
                      <strong>{s.profileDisplayName}</strong>
                      <div className="list-meta">
                        {MODE[s.mode] ?? s.mode} · {new Date(s.createdAt).toLocaleString()} · {statusText(s)}
                      </div>
                    </div>
                    {a && <Link className="btn btn-sm" href={a.href}>{a.label}</Link>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
