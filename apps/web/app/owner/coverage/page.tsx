"use client";
import { useState } from "react";
import { Badge } from "@sim/ui";
import { OwnerShell, useOwnerData } from "@/components/owner/OwnerShell";
import { api, ApiError } from "@/lib/api";

type Coverage = {
  publishedClinicalCases: number;
  publishedFixtures: number;
  byAnatomy: Record<string, number>;
  byPathology: Record<string, number>;
  byDifficulty: Record<string, number>;
  byTrack: Record<string, number>;
  urgent: number;
  differentialOnly: number;
  stackBased: number;
};
type RequestStatus = "open" | "in_progress" | "fulfilled" | "withdrawn";
type ContentRequest = { id: string; slot: string; title: string; description: string; categories: string[]; status: RequestStatus; caseId: string | null };

const STATUS_LABEL: Record<RequestStatus, string> = { open: "Open", in_progress: "In progress", fulfilled: "Fulfilled", withdrawn: "Withdrawn" };

function Tally({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="card card-tight stack" style={{ gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
      {entries.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>None yet.</p>
      ) : (
        <dl className="kv">
          {entries.map(([k, n]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k.replace(/_/g, " ")}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Published case coverage (fixtures excluded) and the explicit content requests for missing cases. */
export default function OwnerCoverage() {
  const { data: coverage, error } = useOwnerData<Coverage>("/api/owner/coverage");
  const { data: requests, reload } = useOwnerData<ContentRequest[]>("/api/owner/content-requests");
  const [saveError, setSaveError] = useState<string | null>(null);
  const setStatus = async (r: ContentRequest, status: RequestStatus) => {
    setSaveError(null);
    try {
      await api(`/api/owner/content-requests/${r.id}`, { method: "PATCH", body: { status, caseId: r.caseId } });
      reload();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not update the request.");
    }
  };
  return (
    <OwnerShell>
      <div className="stack-lg">
        <div className="page-head">
          <div>
            <h1>Coverage</h1>
            <p>Published clinical cases by category. Development fixtures are not counted.</p>
          </div>
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
        {coverage && (
          <>
            {coverage.publishedClinicalCases === 0 ? (
              <div className="alert alert-info">No clinical cases are published yet. Missing cases are tracked as content requests below.</div>
            ) : (
              <p style={{ margin: 0 }}>
                <strong>{coverage.publishedClinicalCases}</strong> published clinical case{coverage.publishedClinicalCases === 1 ? "" : "s"}: {coverage.urgent} urgent, {coverage.differentialOnly} differential-only, {coverage.stackBased} with image stacks.
              </p>
            )}
            {coverage.publishedClinicalCases > 0 && (
              <div className="grid-auto">
                <Tally title="Anatomy" counts={coverage.byAnatomy} />
                <Tally title="Pathology" counts={coverage.byPathology} />
                <Tally title="Difficulty" counts={coverage.byDifficulty} />
                <Tally title="Track" counts={coverage.byTrack} />
              </div>
            )}
          </>
        )}

        <section className="stack" aria-labelledby="requests-title">
          <h2 id="requests-title" style={{ margin: 0 }}>Content requests</h2>
          <p className="muted" style={{ margin: 0 }}>Cases the product still needs. A missing case stays a request; it is never generated.</p>
          {saveError && <div className="alert alert-danger" role="alert">{saveError}</div>}
          {!requests ? (
            <p role="status">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="empty">No content requests.</p>
          ) : (
            <ul className="list">
              {requests.map((r) => (
                <li key={r.id}>
                  <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{r.title}</strong>
                      <Badge kind={r.status === "fulfilled" ? "success" : r.status === "in_progress" ? "info" : undefined}>{STATUS_LABEL[r.status]}</Badge>
                    </div>
                    <div className="list-meta clamp" title={r.description}>{r.description}</div>
                  </div>
                  <label className="row text-sm" style={{ gap: 6 }}>
                    <span className="visually-hidden">Status of {r.title}</span>
                    <select value={r.status} onChange={(e) => setStatus(r, e.target.value as RequestStatus)} style={{ width: "auto", minHeight: 34 }}>
                      {(Object.keys(STATUS_LABEL) as RequestStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </OwnerShell>
  );
}
