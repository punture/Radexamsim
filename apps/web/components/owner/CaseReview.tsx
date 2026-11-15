"use client";
import type { CaseVersion } from "@sim/contracts";
import { Badge } from "@sim/ui";
import { useState } from "react";

/**
 * Human-readable review package (spec §3: the owner can understand and approve a case
 * without reading raw JSON). Everything clinically material is shown, grouped the way the
 * case will run.
 */

export function AssetPreview({ versionId, asset }: { versionId: string; asset: CaseVersion["assets"][number] }) {
  const [frame, setFrame] = useState(asset.display.initialFrameIndex);
  const [showAnn, setShowAnn] = useState(true);
  const ann = asset.annotations.filter((a) => a.frameIndex === frame);
  return (
    <figure style={{ margin: 0, background: "#000", borderRadius: 8, padding: 6, maxWidth: 420 }}>
      <div style={{ position: "relative" }}>
        <img src={`/api/owner/case-versions/${encodeURIComponent(versionId)}/assets/${asset.id}/${frame}`} alt={`${asset.neutralLabel} frame ${frame + 1}`} style={{ width: "100%", display: "block" }} />
        {showAnn && ann.length > 0 && (
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
            {ann.map((a, i) => (a.points.length >= 2 ? <rect key={i} x={Math.min(a.points[0]![0], a.points[1]![0])} y={Math.min(a.points[0]![1], a.points[1]![1])} width={Math.abs(a.points[1]![0] - a.points[0]![0])} height={Math.abs(a.points[1]![1] - a.points[0]![1])} fill="none" stroke="#f59e0b" strokeWidth={0.006} /> : null))}
          </svg>
        )}
      </div>
      <figcaption style={{ color: "#d8dee6", fontSize: "0.84rem", padding: "4px 2px" }} className="stack">
        <span>
          <strong>{asset.neutralLabel}</strong> <span className="mono">({asset.id})</span> · {asset.kind} · {asset.frames.length} frame(s){asset.isPlaceholder && <> · <Badge kind="warning">placeholder</Badge></>}
        </span>
        {asset.frames.length > 1 && <input type="range" min={0} max={asset.frames.length - 1} value={frame} onChange={(e) => setFrame(Number(e.target.value))} aria-label={`Frame of ${asset.neutralLabel}`} />}
        <span>
          Frame {frame + 1}/{asset.frames.length} · initial frame {asset.display.initialFrameIndex + 1} · zoom {String(asset.display.initialZoom)} · derivation {asset.derivation.method}
          {asset.derivation.burnedInAnnotationsPresent && " · burned-in annotations"}
        </span>
        {asset.annotations.length > 0 && (
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showAnn} onChange={(e) => setShowAnn(e.target.checked)} /> Owner annotations (debrief only; hidden during the exam)</label>
        )}
      </figcaption>
    </figure>
  );
}

const list = (xs: string[]) => (xs.length ? <ul style={{ margin: 0 }}>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="muted">—</span>);

export function CaseReview({ cv }: { cv: CaseVersion }) {
  const q = (id: string) => cv.questions.find((x) => x.id === id);
  const assetLabel = (id: string) => cv.assets.find((a) => a.id === id)?.neutralLabel ?? id;
  return (
    <div className="stack-lg">
      <section className="card stack">
        <h2>Source and governance</h2>
        <dl className="kv">
          <dt>Diagnostic basis</dt><dd>{cv.source.diagnosticBasis}</dd>
          <dt>Truth status</dt><dd>{cv.source.truthStatus}</dd>
          <dt>Commercial rights</dt><dd>{cv.source.commercialRightsStatus}{cv.clearances.rights ? ` — ${cv.clearances.rights.status}: ${cv.clearances.rights.basis}` : ""}</dd>
          <dt>Privacy</dt><dd>{cv.source.privacyStatus}{cv.clearances.privacy ? ` — ${cv.clearances.privacy.status}: ${cv.clearances.privacy.basis}` : ""}</dd>
          <dt>External AI processing</dt><dd>{cv.clearances.externalAiProcessingAllowed ? "Allowed" : "Not allowed (critics/author will not run)"}</dd>
          <dt>References</dt><dd>{cv.source.references.map((r) => `${r.id}: ${r.kind}${r.locator ? ` (${r.locator})` : ""} — ${r.description}`).join("; ")}</dd>
          <dt>Eligible profiles</dt><dd>{cv.eligibleProfileVersions.join(", ")}</dd>
          <dt>Tags</dt><dd>{cv.tags.anatomy.join(", ")} · {cv.tags.pathology.join(", ") || "—"} · {cv.difficulty} · {cv.track} track</dd>
        </dl>
      </section>
      <section className="card stack">
        <h2>Clinical truth <span className="muted" style={{ fontSize: "0.9rem", fontWeight: 400 }}>(never shown to candidates or the live examiner)</span></h2>
        <dl className="kv">
          <dt>Final diagnosis</dt><dd><strong>{cv.clinicalTruth.finalDiagnosis}</strong></dd>
          <dt>Displayed images support</dt><dd>{cv.clinicalTruth.displayedMaterialSupports.replaceAll("_", " ")}</dd>
          <dt>Urgency</dt><dd>{cv.clinicalTruth.urgency}</dd>
          <dt>Critical communication</dt><dd>{cv.clinicalTruth.criticalCommunication ?? "—"}</dd>
          <dt>Acceptable diagnoses</dt><dd>{list(cv.clinicalTruth.acceptableDiagnoses)}</dd>
          <dt>Differential</dt><dd>{list(cv.clinicalTruth.differential.map((d) => `${d.rank}. ${d.diagnosis} — ${d.rationale}`))}</dd>
          <dt>Management</dt><dd>{list(cv.clinicalTruth.managementExpectations)}</dd>
          <dt>Uncertainty notes</dt><dd>{cv.clinicalTruth.uncertaintyNotes || "—"}</dd>
        </dl>
        <h3>Key findings</h3>
        <table className="table"><thead><tr><th>Finding</th><th>Location</th><th>Side</th><th>Images</th><th>Conspicuity</th></tr></thead><tbody>
          {cv.clinicalTruth.keyFindings.map((f) => <tr key={f.id}><td>{f.description}</td><td>{f.location}</td><td>{f.laterality}</td><td>{f.assetIds.map(assetLabel).join(", ")}</td><td>{f.conspicuity}</td></tr>)}
        </tbody></table>
      </section>
      <section className="stack">
        <h2>How the case runs</h2>
        {[...cv.stages].sort((a, b) => a.ordinal - b.ordinal).map((s) => (
          <article key={s.id} className="card stack">
            <div className="row-between"><h3>Stage {s.ordinal + 1}: {s.label} <span className="muted mono" style={{ fontSize: "0.8rem" }}>{s.id}</span></h3>{s.id === cv.openingStageId && <Badge kind="info">opening</Badge>}</div>
            {s.candidateHistory && <p><strong>History shown:</strong> {s.candidateHistory}</p>}
            {s.revealAnnouncement && <p><strong>Spoken when shown:</strong> “{s.revealAnnouncement}”</p>}
            <div className="row" style={{ alignItems: "flex-start" }}>{s.assetIds.map((id) => { const a = cv.assets.find((x) => x.id === id); return a ? <AssetPreview key={id} versionId={cv.versionId} asset={a} /> : null; })}</div>
            {s.examinerNotes && <p><strong>Examiner notes:</strong> {s.examinerNotes}</p>}
            <h4>Approved questions in this stage</h4>
            <ol>{s.allowedQuestionIds.map((id) => { const qq = q(id); return qq ? <li key={id}>“{qq.text}” <span className="muted">— {qq.purpose}, {qq.promptClass}{qq.targetElementIds.length ? `, targets ${qq.targetElementIds.join(", ")}` : ""}{qq.suppliesElementIds.length ? `, SUPPLIES ${qq.suppliesElementIds.join(", ")}` : ""}{qq.skipIfAlreadyAddressed ? `; skip if ${qq.skipIfAlreadyAddressed}` : ""}</span></li> : <li key={id}>{id} (missing)</li>; })}</ol>
            {s.approvedFactReplies.length > 0 && (<><h4>Approved replies to requests</h4><table className="table"><thead><tr><th>When the candidate…</th><th>Reply</th><th>Kind</th></tr></thead><tbody>{s.approvedFactReplies.map((r) => <tr key={r.id}><td>{r.triggerDescription}<br /><span className="muted">patterns: {r.triggerPatterns.join(", ")}</span></td><td>“{r.replyText}”</td><td>{r.kind}{r.revealsStageId ? ` → ${r.revealsStageId}` : ""}</td></tr>)}</tbody></table></>)}
            {s.transitions.length > 0 && <p><strong>Transitions:</strong> {s.transitions.map((t) => `${t.description} (${t.trigger} → ${t.toStageId})`).join("; ")}</p>}
          </article>
        ))}
      </section>
      <section className="card stack">
        <h2>Rubric <span className="muted mono" style={{ fontSize: "0.8rem" }}>{cv.rubric.versionId}</span></h2>
        <table className="table">
          <thead><tr><th>Element</th><th>Accepted / alternatives</th><th>Incorrect or unsafe</th><th>Opportunity &amp; prompting</th><th>Feedback</th></tr></thead>
          <tbody>
            {cv.rubric.elements.map((e) => (
              <tr key={e.id}>
                <td><Badge kind={e.severity === "critical" ? "danger" : e.severity === "important" ? "warning" : undefined}>{e.severity}</Badge> <span className="muted">{e.domain}</span><br />{e.construct}<br /><span className="muted mono" style={{ fontSize: "0.78rem" }}>{e.id} · skills: {e.skills.join(", ")}</span></td>
                <td>{list(e.acceptedConcepts)}{e.acceptableAlternatives.length > 0 && <><em>Also acceptable:</em>{list(e.acceptableAlternatives)}</>}</td>
                <td>{list(e.incorrectOrUnsafeClaims)}</td>
                <td>{e.opportunityRule.kind} at {e.opportunityRule.stageId}{e.opportunityRule.questionIds.length ? ` / ${e.opportunityRule.questionIds.join(", ")}` : ""}; images: {e.requiredAssetIds.map(assetLabel).join(", ") || "none"}; min exposure {e.opportunityRule.minExposureSeconds}s<br />credit: standard {e.promptingPolicy.credit.standard_question}, probe {e.promptingPolicy.credit.targeted_probe}</td>
                <td><strong>Why:</strong> {e.feedbackGuidance.whyItMatters}<br /><strong>Stronger:</strong> {e.feedbackGuidance.strongerResponse}<br /><strong>Practise:</strong> {e.feedbackGuidance.practiceAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details><summary>Domain and global anchors; caps</summary>
          <p>Critical unsafe statement caps the overall rating at <strong>{cv.rubric.globalRules.criticalUnsafeCap}</strong>; a missed critical element caps it at <strong>{cv.rubric.globalRules.criticalOmissionCap}</strong>; withheld if ≥{cv.rubric.globalRules.withholdIfUncertainCriticalOrImportant} important elements are uncertain.</p>
          {cv.rubric.domains.map((d) => <div key={d.id}><h4>{d.id}</h4>{list(d.anchors.map((a) => `${a.level}: ${a.descriptor}`))}</div>)}
          <h4>Global</h4>{list(cv.rubric.globalRules.anchors.map((a) => `${a.level}: ${a.descriptor}`))}
        </details>
      </section>
      <section className="card stack">
        <h2>Reference responses</h2>
        {cv.referenceResponses.map((r) => <p key={r.id}><Badge>{r.kind.replaceAll("_", " ")}</Badge> {r.text}</p>)}
        {cv.practice.hints.length > 0 && <><h3>Practice hints</h3>{list(cv.practice.hints.map((h) => `${h.level}: “${h.text}” (${h.elementIds.join(", ")})`))}</>}
      </section>
    </div>
  );
}
