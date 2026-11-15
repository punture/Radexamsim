"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert } from "@sim/ui";
import { OwnerShell } from "@/components/owner/OwnerShell";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ versionId?: string; issues?: { path: string; message: string; severity: string }[]; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    const res = await fetch("/api/owner/cases/import", { method: "POST", headers: { "content-type": "application/zip", "x-sim-csrf": "1" }, body: file });
    const json = await res.json().catch(() => ({}));
    setResult(res.ok ? json : { error: json.message ?? "Import failed", issues: json.issues });
    setBusy(false);
  };
  return (
    <OwnerShell>
      <div className="stack-lg" style={{ maxWidth: 860 }}>
        <h1>Import a case package</h1>
        <Alert kind="info" title="Privacy workflow">
          Build packages locally with <code>tools/ingestion</code>: quarantine the untouched source, run the automated identifier checks, review the findings yourself, then package. Packages with unresolved high-severity privacy findings are rejected. Imported cases start as drafts with placeholders you (or the LLM author) complete; nothing is published without your approval.
        </Alert>
        <div className="field">
          <label htmlFor="pkg">Package (.zip containing case-import.json and frames)</label>
          <input id="pkg" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div><button className="btn btn-primary" type="button" disabled={!file || busy} onClick={upload}>{busy ? "Importing…" : "Import as draft"}</button></div>
        {result?.error && <Alert kind="danger" title={result.error}>{result.issues && <ul>{result.issues.map((i) => <li key={i.path}><code>{i.path}</code>: {i.message}</li>)}</ul>}</Alert>}
        {result?.versionId && (
          <Alert kind="success" title="Imported as a draft">
            <p><Link href={`/owner/cases/${encodeURIComponent(result.versionId)}`}>Open {result.versionId}</Link> to complete it. {result.issues?.length ?? 0} issue(s) to resolve before review.</p>
          </Alert>
        )}
      </div>
    </OwnerShell>
  );
}
