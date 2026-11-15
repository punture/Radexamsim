"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, Spinner } from "@sim/ui";
import { api } from "@/lib/api";
import { errorText, formatDate } from "./learnerFormat";

type Appeal = { id: string; kind: "transcript" | "grading"; status: string; resolution: string | null; createdAt: string; caseAttemptId: string; sessionId?: string; caseNumber?: number };

/** Learner-facing appeal statuses. The owner's written resolution explains the outcome. */
const APPEAL_STATUS: Record<string, { label: string; kind?: "info" | "warning" | "success" }> = {
  submitted: { label: "Submitted", kind: "info" },
  under_review: { label: "Under review", kind: "warning" },
  // "upheld" means the ORIGINAL RESULT was upheld after review (see docs/ASSESSMENT.md).
  upheld: { label: "Reviewed: original result confirmed" },
  revised: { label: "Reviewed: result revised", kind: "success" },
  rejected: { label: "Not accepted for review" },
};

export function AppealsList() {
  const [appeals, setAppeals] = useState<Appeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<Appeal[]>("/api/appeals")
      .then((r) => alive && setAppeals(Array.isArray(r) ? r : []))
      .catch((e) => alive && setError(errorText(e, "Your appeals could not be loaded.")));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="stack-lg" style={{ maxWidth: 980 }}>
      <h1 style={{ margin: 0 }}>Appeals</h1>
      <p style={{ margin: 0 }}>
        Dispute a transcription or a grading decision. Your original result is always preserved: any correction or reassessment is added as a new version. Our clinical owner, a practising neuroradiologist, reviews significant disputes.
      </p>
      <div className="alert alert-info" role="note">
        <strong>To start a new appeal</strong>
        Open the station’s results from your <Link href="/app">dashboard</Link> and choose “Dispute transcription or grading” on the case you want to dispute.
      </div>

      {error && <Alert kind="danger" title="Appeals unavailable">{error}</Alert>}
      {!appeals && !error && <Spinner label="Loading your appeals" />}
      {appeals && appeals.length === 0 && (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>You have not submitted any appeals.</p>
        </section>
      )}
      {appeals && appeals.length > 0 && (
        <section className="card" aria-labelledby="appeals-title">
          <h2 id="appeals-title" className="visually-hidden">Your appeals</h2>
          <table className="table table-stack">
            <caption className="visually-hidden">Your appeals, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Submitted</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Resolution</th>
                <th scope="col">Case reference</th>
              </tr>
            </thead>
            <tbody>
              {appeals.map((a) => {
                const st = APPEAL_STATUS[a.status] ?? { label: a.status };
                return (
                  <tr key={a.id}>
                    <th scope="row">{formatDate(a.createdAt)}</th>
                    <td data-label="Type">{a.kind === "transcript" ? "Transcript" : "Grading"}</td>
                    <td data-label="Status"><Badge kind={st.kind}>{st.label}</Badge></td>
                    <td data-label="Resolution">{a.resolution ?? <span className="muted">Not yet resolved</span>}</td>
                    <td data-label="Case reference">{a.sessionId ? <Link href={`/app/session/${a.sessionId}/results`}>Case {a.caseNumber ?? ""} results</Link> : <span className="mono">{a.caseAttemptId.slice(0, 8)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
