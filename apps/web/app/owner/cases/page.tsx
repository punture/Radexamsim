"use client";
import Link from "next/link";
import { Badge } from "@sim/ui";
import { OwnerShell, useOwnerData } from "@/components/owner/OwnerShell";

type V = { versionId: string; versionNumber: number; status: string; internalTitle: string; isFixture: boolean; errors: number; warnings: number; updatedAt: string; isPublished: boolean; withdrawn: boolean; anatomy: string[]; difficulty: string };
export default function Cases() {
  const { data } = useOwnerData<{ caseId: string; versions: V[] }[]>("/api/owner/cases");
  return (
    <OwnerShell>
      <div className="stack-lg">
        <div className="row-between"><h1>Cases</h1><Link className="btn btn-primary" href="/owner/import">Import a case package</Link></div>
        {!data ? <p role="status">Loading…</p> : (
          <table className="table">
            <thead><tr><th>Case</th><th>Latest version</th><th>Status</th><th>Checks</th><th>Anatomy</th><th>Published</th></tr></thead>
            <tbody>
              {data.map((c) => {
                const v = c.versions[0]!;
                const pub = c.versions.find((x) => x.isPublished);
                return (
                  <tr key={c.caseId}>
                    <td><Link href={`/owner/cases/${encodeURIComponent(v.versionId)}`}>{v.internalTitle}</Link><br /><span className="muted mono">{c.caseId}</span> {v.isFixture && <Badge kind="warning">fixture</Badge>} {v.withdrawn && <Badge kind="danger">withdrawn</Badge>}</td>
                    <td>v{v.versionNumber}</td>
                    <td><Badge kind={v.status === "published" ? "success" : v.status === "ready_for_owner" ? "info" : undefined}>{v.status.replaceAll("_", " ")}</Badge></td>
                    <td>{v.errors ? <Badge kind="danger">{v.errors} errors</Badge> : <Badge kind="success">no errors</Badge>} {v.warnings ? <span className="muted">{v.warnings} warnings</span> : null}</td>
                    <td>{v.anatomy.join(", ")} · {v.difficulty}</td>
                    <td>{pub ? `v${pub.versionNumber}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </OwnerShell>
  );
}
