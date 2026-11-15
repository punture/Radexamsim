"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, ConfirmDialog } from "@sim/ui";
import { OwnerShell, useOwnerData } from "@/components/owner/OwnerShell";
import { api, ApiError } from "@/lib/api";

type Switches = { examinerLlmDisabled: boolean; assessmentLlmDisabled: boolean; serverTtsDisabled: boolean; serverAsrDisabled: boolean; disabledCaseIds: string[] };
type Policy = { secondPass: "always" | "risk_based"; randomSampleRate: number; shareExtractionWithB: boolean };
type Config = {
  switches: Switches;
  assessmentPolicy: Policy;
  demoCaseIds: string[];
  profiles: { versionId: string; active: boolean; displayName: string; verification: { status: string; verifiedOn: string | null; method: string; notes: string; unresolvedConflicts: string[] } }[];
  providers: { llm: string | null; examinerModel: string | null; asr: string; tts: string };
};
type DeadJob = { id: string; kind: string; attempts: number; lastError: string | null; updatedAt: string };

const SWITCH_LABELS: [keyof Omit<Switches, "disabledCaseIds">, string, string][] = [
  ["examinerLlmDisabled", "Disable LLM examiner", "Live examiners use the deterministic approved-question policy instead."],
  ["assessmentLlmDisabled", "Disable LLM assessment", "New assessments become unavailable (or dev baseline outside production) and are queued for you."],
  ["serverTtsDisabled", "Disable server text-to-speech", "Examiner speech falls back to the browser voice or text."],
  ["serverAsrDisabled", "Disable server speech recognition", "Candidates use the labelled browser fallback or typed answers."],
];

export default function ConfigPage() {
  const { data: c, error, reload } = useOwnerData<Config>("/api/owner/config");
  const { data: dead, reload: reloadDead } = useOwnerData<DeadJob[]>("/api/owner/jobs/dead");
  const [sw, setSw] = useState<Switches | null>(null);
  const [disabledCases, setDisabledCases] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [ack, setAck] = useState(false);
  const [confirmPolicy, setConfirmPolicy] = useState(false);
  const [demo, setDemo] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "danger"; text: string } | null>(null);
  const [verify, setVerify] = useState<{ versionId: string; status: "verified" | "provisional"; notes: string; conflicts: string } | null>(null);
  useEffect(() => {
    if (!c) return;
    setSw(c.switches);
    setDisabledCases(c.switches.disabledCaseIds.join("\n"));
    setPolicy(c.assessmentPolicy);
    setDemo(c.demoCaseIds.join("\n"));
  }, [c]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "success", text: ok });
      reload();
      reloadDead();
    } catch (e) {
      setMsg({ kind: "danger", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };
  const lines = (s: string) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const savePolicy = () => run(() => api("/api/owner/config/assessment-policy", { method: "PUT", body: { ...policy, acknowledgeReducedCoverage: ack } }), "Assessment policy saved.");
  return (
    <OwnerShell>
      <div className="stack-lg">
        <h1>Configuration</h1>
        {error && <Alert kind="danger">{error}</Alert>}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {c && sw && policy && (
          <>
            <section className="card stack">
              <h2>Providers in this deployment</h2>
              <dl className="kv">
                <dt>Language model</dt><dd>{c.providers.llm ?? <Badge kind="warning">none configured — deterministic examiner; assessment unavailable in production</Badge>}</dd>
                <dt>Examiner model</dt><dd className="mono">{c.providers.examinerModel ?? "—"}</dd>
                <dt>Speech recognition</dt><dd>{c.providers.asr}</dd>
                <dt>Speech synthesis</dt><dd>{c.providers.tts}</dd>
              </dl>
            </section>

            <section className="card stack">
              <h2>Kill switches</h2>
              {SWITCH_LABELS.map(([k, label, help]) => (
                <label key={k} className="row" style={{ alignItems: "flex-start" }}>
                  <input type="checkbox" checked={sw[k]} onChange={(e) => setSw({ ...sw, [k]: e.target.checked })} />
                  <span><strong>{label}</strong><br /><span className="muted">{help}</span></span>
                </label>
              ))}
              <div className="field"><label htmlFor="disabled-cases">Disabled case IDs (one per line; no new selection)</label><textarea id="disabled-cases" value={disabledCases} onChange={(e) => setDisabledCases(e.target.value)} /></div>
              <div><button className="btn btn-primary" type="button" onClick={() => run(() => api("/api/owner/config/switches", { method: "PUT", body: { ...sw, disabledCaseIds: lines(disabledCases) } }), "Switches saved; they apply to new decisions immediately.")}>Save switches</button></div>
            </section>

            <section className="card stack">
              <h2>Assessment second pass</h2>
              <p className="muted" style={{ margin: 0 }}>Default: every case attempt gets two independent assessor passes. Reducing coverage requires your explicit acknowledgement after reviewing measured performance in the evaluation report.</p>
              <label className="row"><input type="radio" name="sp" checked={policy.secondPass === "always"} onChange={() => setPolicy({ ...policy, secondPass: "always" })} /> Always run pass B</label>
              <label className="row"><input type="radio" name="sp" checked={policy.secondPass === "risk_based"} onChange={() => setPolicy({ ...policy, secondPass: "risk_based" })} /> Risk-based: run pass B for consequential/uncertain attempts plus a random sample</label>
              {policy.secondPass === "risk_based" && (
                <label className="field" style={{ maxWidth: 260 }}>Random sample rate<input type="number" min={0} max={1} step={0.05} value={policy.randomSampleRate} onChange={(e) => setPolicy({ ...policy, randomSampleRate: Number(e.target.value) })} /></label>
              )}
              <label className="row"><input type="checkbox" checked={policy.shareExtractionWithB} onChange={(e) => setPolicy({ ...policy, shareExtractionWithB: e.target.checked })} /> Let pass B see the shared statement extraction (less independent; cheaper)</label>
              <div>
                <button className="btn btn-primary" type="button" onClick={() => (policy.secondPass === "risk_based" && c.assessmentPolicy.secondPass !== "risk_based" ? setConfirmPolicy(true) : savePolicy())}>Save policy</button>
              </div>
            </section>

            <section className="card stack">
              <h2>Public demonstration cases</h2>
              <p className="muted" style={{ margin: 0 }}>Up to five published case IDs (one per line) for the free demonstration. Demonstrations never use paid content you have not chosen.</p>
              <textarea aria-label="Demo case IDs" value={demo} onChange={(e) => setDemo(e.target.value)} />
              <div><button className="btn" type="button" onClick={() => run(() => api("/api/owner/config/demo-cases", { method: "PUT", body: { caseIds: lines(demo) } }), "Demonstration cases saved.")}>Save demonstration cases</button></div>
            </section>

            <section className="card stack">
              <h2>Exam profiles</h2>
              <p className="muted" style={{ margin: 0 }}>Profiles stay provisional until you verify them against current official sources. Verification creates a new profile version; past attempts keep the version they used.</p>
              <table className="table">
                <thead><tr><th>Profile</th><th>Verification</th><th>Unresolved conflicts</th><th /></tr></thead>
                <tbody>
                  {c.profiles.map((p) => (
                    <tr key={p.versionId}>
                      <td>{p.displayName}<br /><span className="mono muted" style={{ fontSize: "0.78rem" }}>{p.versionId}</span> {p.active ? <Badge kind="success">active</Badge> : <Badge>inactive</Badge>}</td>
                      <td><Badge kind={p.verification.status === "verified" ? "success" : "warning"}>{p.verification.status}</Badge> {p.verification.verifiedOn ?? ""}<br /><span className="muted">{p.verification.notes}</span></td>
                      <td>{p.verification.unresolvedConflicts.length ? <ul style={{ margin: 0 }}>{p.verification.unresolvedConflicts.map((x, i) => <li key={i}>{x}</li>)}</ul> : "—"}</td>
                      <td>{p.active && <button className="btn btn-sm" type="button" onClick={() => setVerify({ versionId: p.versionId, status: "verified", notes: "", conflicts: p.verification.unresolvedConflicts.join("\n") })}>Record verification…</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {verify && (
                <div className="card card-tight stack">
                  <h3>Verify {verify.versionId}</h3>
                  <label className="field">Status<select value={verify.status} onChange={(e) => setVerify({ ...verify, status: e.target.value as "verified" | "provisional" })}><option value="verified">verified</option><option value="provisional">provisional</option></select></label>
                  <label className="field">What you checked (sources, dates)<textarea value={verify.notes} onChange={(e) => setVerify({ ...verify, notes: e.target.value })} /></label>
                  <label className="field">Remaining conflicts (one per line)<textarea value={verify.conflicts} onChange={(e) => setVerify({ ...verify, conflicts: e.target.value })} /></label>
                  <div className="row">
                    <button className="btn btn-primary" type="button" disabled={verify.notes.trim().length < 5} onClick={() => { const v = verify; setVerify(null); void run(() => api(`/api/owner/profiles/${encodeURIComponent(v.versionId)}/verification`, { body: { status: v.status, notes: v.notes, unresolvedConflicts: v.conflicts.split("\n").map((x) => x.trim()).filter(Boolean) } }), "New profile version recorded."); }}>Save as new profile version</button>
                    <button className="btn" type="button" onClick={() => setVerify(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </section>

            <section className="card stack">
              <h2>Failed background jobs</h2>
              {!dead?.length ? <p className="muted">None.</p> : (
                <>
                  <table className="table"><thead><tr><th>Kind</th><th>Attempts</th><th>Last error</th><th>Updated</th></tr></thead>
                    <tbody>{dead.map((j) => <tr key={j.id}><td className="mono">{j.kind}</td><td>{j.attempts}</td><td style={{ maxWidth: 420, wordBreak: "break-word" }}>{j.lastError ?? "—"}</td><td>{new Date(j.updatedAt).toLocaleString()}</td></tr>)}</tbody>
                  </table>
                  <div><button className="btn" type="button" onClick={() => run(() => api("/api/owner/jobs/requeue-dead", { body: { ids: dead.map((j) => j.id).slice(0, 100) } }), "Requeued.")}>Requeue all after fixing the cause</button></div>
                </>
              )}
            </section>
          </>
        )}
        <ConfirmDialog
          open={confirmPolicy}
          title="Reduce second-pass coverage?"
          body={
            <div className="stack">
              <p>Risk-based selection means some attempts are scored by a single assessor pass. Disagreements in unsampled attempts will not be detected.</p>
              <label className="row" style={{ alignItems: "flex-start" }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> <span>I have reviewed the measured assessment performance and accept reduced second-pass coverage.</span></label>
            </div>
          }
          confirmLabel="Save reduced coverage"
          danger
          onCancel={() => setConfirmPolicy(false)}
          onConfirm={() => { setConfirmPolicy(false); void savePolicy(); }}
        />
      </div>
    </OwnerShell>
  );
}
