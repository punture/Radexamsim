"use client";
import { useState } from "react";
import { Alert } from "@sim/ui";
import { OwnerShell, useOwnerData } from "@/components/owner/OwnerShell";

type Metrics = {
  days: number;
  models: { role: string; calls: number; okRate: number; p50LatencyMs: number | null; p95LatencyMs: number | null; inputTokens: number; outputTokens: number; estimatedCostUsd: number }[];
  cost: { totalEstimatedUsd: number; completedStations: number; perCompletedStationUsd: number | null; note: string };
  live: { examinerDecisionP50Ms: number | null; examinerDecisionP95Ms: number | null; imageAckP50Ms: number | null; imageAckP95Ms: number | null; interruptions: number; technicalPauses: number; note: string };
  assessments: { total: number; provisionalRate: number | null; withheldRate: number | null; disputedElements: number; byAssessorKind: Record<string, number> };
  ownerExceptionsOpened: number;
  sessions: { total: number; completed: number; invalidated: number };
  clientSamples: number;
};
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const ms = (x: number | null) => (x == null ? "—" : `${x} ms`);
const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="card card-tight">
    <div className="muted" style={{ fontSize: "0.85rem" }}>{label}</div>
    <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{value}</div>
  </div>
);

export default function MetricsPage() {
  const [days, setDays] = useState(30);
  const { data: m, error } = useOwnerData<Metrics>(`/api/owner/metrics?days=${days}`);
  return (
    <OwnerShell>
      <div className="stack-lg">
        <div className="row-between">
          <h1>Metrics</h1>
          <label className="row" style={{ gap: 6 }}>
            Window
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 7, 30, 90, 365].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}
            </select>
          </label>
        </div>
        {error && <Alert kind="danger">{error}</Alert>}
        {m && (
          <>
            <div className="row">
              <Stat label="Sessions (completed)" value={`${m.sessions.total} (${m.sessions.completed})`} />
              <Stat label="Invalidated (technical)" value={m.sessions.invalidated} />
              <Stat label="Estimated model cost" value={`$${m.cost.totalEstimatedUsd.toFixed(2)}`} />
              <Stat label="Per completed station" value={m.cost.perCompletedStationUsd == null ? "—" : `$${m.cost.perCompletedStationUsd.toFixed(2)}`} />
              <Stat label="Owner exceptions opened" value={m.ownerExceptionsOpened} />
            </div>
            <p className="muted" style={{ margin: 0 }}>{m.cost.note}</p>
            <section className="card">
              <h2>Live examination</h2>
              <div className="row">
                <Stat label="Examiner decision p50 / p95" value={`${ms(m.live.examinerDecisionP50Ms)} / ${ms(m.live.examinerDecisionP95Ms)}`} />
                <Stat label="Image render ack p50 / p95" value={`${ms(m.live.imageAckP50Ms)} / ${ms(m.live.imageAckP95Ms)}`} />
                <Stat label="Barge-in interruptions" value={m.live.interruptions} />
                <Stat label="Technical pauses" value={m.live.technicalPauses} />
              </div>
              <p className="muted">{m.live.note}</p>
            </section>
            <section className="card">
              <h2>Assessment quality signals</h2>
              <div className="row">
                <Stat label="Assessments" value={m.assessments.total} />
                <Stat label="Provisional" value={pct(m.assessments.provisionalRate)} />
                <Stat label="Withheld" value={pct(m.assessments.withheldRate)} />
                <Stat label="Disputed elements" value={m.assessments.disputedElements} />
              </div>
              <p className="muted">
                By assessor: {Object.entries(m.assessments.byAssessorKind).map(([k, n]) => `${k} ${n}`).join(" · ") || "—"}. Model agreement is a consistency signal, not proof of correctness.
              </p>
            </section>
            <section className="card">
              <h2>Model calls by role</h2>
              <table className="table">
                <thead><tr><th>Role</th><th>Calls</th><th>OK</th><th>p50</th><th>p95</th><th>Input tokens</th><th>Output tokens</th><th>Est. cost</th></tr></thead>
                <tbody>
                  {m.models.length ? (
                    m.models.map((r) => (
                      <tr key={r.role}><td>{r.role}</td><td>{r.calls}</td><td>{pct(r.okRate)}</td><td>{ms(r.p50LatencyMs)}</td><td>{ms(r.p95LatencyMs)}</td><td>{r.inputTokens.toLocaleString()}</td><td>{r.outputTokens.toLocaleString()}</td><td>${r.estimatedCostUsd.toFixed(2)}</td></tr>
                    ))
                  ) : (
                    <tr><td colSpan={8} className="muted">No external model calls in this window (deterministic fallbacks or no provider configured).</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </OwnerShell>
  );
}
