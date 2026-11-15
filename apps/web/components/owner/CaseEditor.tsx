"use client";
import type { CaseVersion } from "@sim/contracts";

/**
 * Structured editor for draft case versions: stages, questions, replies, rubric elements,
 * clinical truth and reference responses. The server re-validates every save and returns
 * issues with exact paths; ids and cross-references are edited as text.
 */

type Path = (string | number)[];
type Upd = (path: Path, value: unknown) => void;

function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [k, ...rest] = path;
  const copy: Record<string | number, unknown> | unknown[] = Array.isArray(obj) ? [...obj] : { ...(obj as Record<string, unknown>) };
  (copy as Record<string | number, unknown>)[k as string] = setIn((obj as Record<string | number, unknown>)[k as string], rest, value);
  return copy as T;
}

const lines = (xs: string[]) => xs.join("\n");
const unlines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const csv = (xs: string[]) => xs.join(", ");
const uncsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function T({ label, value, onChange, area, hint }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; hint?: string }) {
  const id = `f-${label.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {area ? <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} /> : <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
function S<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: readonly V[]; onChange: (v: V) => void }) {
  return (
    <div className="field">
      <label>{label}<select value={value} onChange={(e) => onChange(e.target.value as V)} style={{ marginTop: 6 }}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
    </div>
  );
}

export function CaseEditor({ cv, onChange }: { cv: CaseVersion; onChange: (cv: CaseVersion) => void }) {
  const up: Upd = (path, value) => onChange(setIn(cv, path, value));
  const removeAt = (path: Path, i: number) => {
    const arr = path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k as string], cv) as unknown[];
    up(path, arr.filter((_, j) => j !== i));
  };
  return (
    <div className="stack-lg">
      <fieldset className="stack"><legend>Overview</legend>
        <div className="grid-2">
          <T label="Internal title (owner only)" value={cv.internalTitle} onChange={(v) => up(["internalTitle"], v)} />
          <T label="Candidate title (neutral)" value={cv.candidateTitle} onChange={(v) => up(["candidateTitle"], v)} />
          <T label="Pathology tags (comma separated slugs)" value={csv(cv.tags.pathology)} onChange={(v) => up(["tags", "pathology"], uncsv(v))} />
          <T label="Anatomy (comma: brain, spine, head_and_neck, vascular, skull_base, pediatric_neuro)" value={csv(cv.tags.anatomy)} onChange={(v) => up(["tags", "anatomy"], uncsv(v))} />
          <S label="Difficulty" value={cv.difficulty} options={["core", "challenging", "advanced"] as const} onChange={(v) => up(["difficulty"], v)} />
          <S label="Track" value={cv.track} options={["core", "advanced"] as const} onChange={(v) => up(["track"], v)} />
          <T label="Eligible profiles (comma)" value={csv(cv.eligibleProfileVersions)} onChange={(v) => up(["eligibleProfileVersions"], uncsv(v))} />
          <T label="Diagnostic basis" value={cv.source.diagnosticBasis} onChange={(v) => up(["source", "diagnosticBasis"], v)} />
          <S label="Truth status" value={cv.source.truthStatus} options={["confirmed", "probable", "differential_only"] as const} onChange={(v) => up(["source", "truthStatus"], v)} />
        </div>
      </fieldset>

      <fieldset className="stack"><legend>Clinical truth</legend>
        <div className="grid-2">
          <T label="Final diagnosis" value={cv.clinicalTruth.finalDiagnosis} onChange={(v) => up(["clinicalTruth", "finalDiagnosis"], v)} />
          <S label="Displayed images support" value={cv.clinicalTruth.displayedMaterialSupports} options={["specific_diagnosis", "leading_with_differential", "differential_only"] as const} onChange={(v) => up(["clinicalTruth", "displayedMaterialSupports"], v)} />
          <S label="Urgency" value={cv.clinicalTruth.urgency} options={["routine", "urgent", "emergent"] as const} onChange={(v) => up(["clinicalTruth", "urgency"], v)} />
          <T label="Critical communication (blank = none)" value={cv.clinicalTruth.criticalCommunication ?? ""} onChange={(v) => up(["clinicalTruth", "criticalCommunication"], v || null)} />
          <T area label="Acceptable diagnoses (one per line)" value={lines(cv.clinicalTruth.acceptableDiagnoses)} onChange={(v) => up(["clinicalTruth", "acceptableDiagnoses"], unlines(v))} />
          <T area label="Management expectations (one per line)" value={lines(cv.clinicalTruth.managementExpectations)} onChange={(v) => up(["clinicalTruth", "managementExpectations"], unlines(v))} />
          <T area label="Uncertainty notes" value={cv.clinicalTruth.uncertaintyNotes} onChange={(v) => up(["clinicalTruth", "uncertaintyNotes"], v)} />
          <T area label="Teaching points (one per line)" value={lines(cv.clinicalTruth.teachingPoints)} onChange={(v) => up(["clinicalTruth", "teachingPoints"], unlines(v))} />
        </div>
        <h4>Key findings</h4>
        {cv.clinicalTruth.keyFindings.map((f, i) => (
          <div key={i} className="card card-tight grid-3">
            <T label="Id" value={f.id} onChange={(v) => up(["clinicalTruth", "keyFindings", i, "id"], v)} />
            <T label="Description" value={f.description} onChange={(v) => up(["clinicalTruth", "keyFindings", i, "description"], v)} />
            <T label="Location" value={f.location} onChange={(v) => up(["clinicalTruth", "keyFindings", i, "location"], v)} />
            <S label="Laterality" value={f.laterality} options={["left", "right", "bilateral", "midline", "not_applicable"] as const} onChange={(v) => up(["clinicalTruth", "keyFindings", i, "laterality"], v)} />
            <T label="Asset ids (comma)" value={csv(f.assetIds)} onChange={(v) => up(["clinicalTruth", "keyFindings", i, "assetIds"], uncsv(v))} />
            <S label="Conspicuity" value={f.conspicuity} options={["obvious", "moderate", "subtle"] as const} onChange={(v) => up(["clinicalTruth", "keyFindings", i, "conspicuity"], v)} />
          </div>
        ))}
        <div><button type="button" className="btn btn-sm" onClick={() => up(["clinicalTruth", "keyFindings"], [...cv.clinicalTruth.keyFindings, { id: `kf-${cv.clinicalTruth.keyFindings.length + 1}`, description: "", location: "", laterality: "not_applicable", assetIds: [cv.assets[0]!.id], conspicuity: "moderate" }])}>Add finding</button></div>
      </fieldset>

      <fieldset className="stack"><legend>Images (labels and display)</legend>
        {cv.assets.map((a, i) => (
          <div key={a.id} className="card card-tight grid-3">
            <T label={`Neutral label for ${a.id}`} value={a.neutralLabel} onChange={(v) => up(["assets", i, "neutralLabel"], v)} hint="Shown to candidates; never diagnosis-bearing." />
            <T label="Sequence" value={a.sequence ?? ""} onChange={(v) => up(["assets", i, "sequence"], v || null)} />
            <T label="Initial frame (0-based; can act as a hint)" value={String(a.display.initialFrameIndex)} onChange={(v) => up(["assets", i, "display", "initialFrameIndex"], Number(v) || 0)} />
          </div>
        ))}
      </fieldset>

      <fieldset className="stack"><legend>Stages</legend>
        {cv.stages.map((s, i) => (
          <div key={i} className="card stack">
            <div className="grid-3">
              <T label="Stage id" value={s.id} onChange={(v) => up(["stages", i, "id"], v)} />
              <T label="Label (owner only)" value={s.label} onChange={(v) => up(["stages", i, "label"], v)} />
              <T label="Asset ids disclosed (comma)" value={csv(s.assetIds)} onChange={(v) => up(["stages", i, "assetIds"], uncsv(v))} />
            </div>
            <T area label="Candidate history shown at this stage" value={s.candidateHistory} onChange={(v) => up(["stages", i, "candidateHistory"], v)} />
            <div className="grid-2">
              <T label="Allowed question ids (comma)" value={csv(s.allowedQuestionIds)} onChange={(v) => up(["stages", i, "allowedQuestionIds"], uncsv(v))} />
              <T label="Assessable rubric element ids (comma)" value={csv(s.assessableRubricElementIds)} onChange={(v) => up(["stages", i, "assessableRubricElementIds"], uncsv(v))} />
              <T area label="Examiner notes (no answers)" value={s.examinerNotes} onChange={(v) => up(["stages", i, "examinerNotes"], v)} />
              <T label="Reveal announcement (spoken after images render)" value={s.revealAnnouncement ?? ""} onChange={(v) => up(["stages", i, "revealAnnouncement"], v || null)} />
            </div>
            <h4>Approved replies</h4>
            {s.approvedFactReplies.map((r, j) => (
              <div key={j} className="grid-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <T label="Reply id" value={r.id} onChange={(v) => up(["stages", i, "approvedFactReplies", j, "id"], v)} />
                <T label="When the candidate…" value={r.triggerDescription} onChange={(v) => up(["stages", i, "approvedFactReplies", j, "triggerDescription"], v)} />
                <T label="Trigger patterns (comma, lowercase)" value={csv(r.triggerPatterns)} onChange={(v) => up(["stages", i, "approvedFactReplies", j, "triggerPatterns"], uncsv(v))} />
                <T label="Reply text (exact)" value={r.replyText} onChange={(v) => up(["stages", i, "approvedFactReplies", j, "replyText"], v)} />
                <S label="Kind" value={r.kind} options={["information", "unavailable", "reveal"] as const} onChange={(v) => up(["stages", i, "approvedFactReplies", j, "kind"], v)} />
                <T label="Reveals stage id (reveal only)" value={r.revealsStageId ?? ""} onChange={(v) => up(["stages", i, "approvedFactReplies", j, "revealsStageId"], v || null)} />
                <div><button type="button" className="btn btn-sm" onClick={() => removeAt(["stages", i, "approvedFactReplies"], j)}>Remove reply</button></div>
              </div>
            ))}
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => up(["stages", i, "approvedFactReplies"], [...s.approvedFactReplies, { id: `fr-${i}-${s.approvedFactReplies.length + 1}`, triggerDescription: "", triggerPatterns: [""], replyText: "", kind: "unavailable", revealsStageId: null, suppliesElementIds: [], promptClass: "neutral" }])}>Add reply</button>
              {cv.stages.length > 1 && <button type="button" className="btn btn-sm" onClick={() => removeAt(["stages"], i)}>Remove stage</button>}
            </div>
          </div>
        ))}
        <div><button type="button" className="btn btn-sm" onClick={() => up(["stages"], [...cv.stages, { ...cv.stages[0]!, id: `st-${cv.stages.length + 1}`, ordinal: cv.stages.length, label: "New stage", candidateHistory: "", assetIds: [], approvedFactReplies: [], transitions: [], revealAnnouncement: null }])}>Add stage</button></div>
      </fieldset>

      <fieldset className="stack"><legend>Questions (exact approved wording)</legend>
        {cv.questions.map((q, i) => (
          <div key={i} className="card card-tight grid-3">
            <T label="Id" value={q.id} onChange={(v) => up(["questions", i, "id"], v)} />
            <S label="Purpose" value={q.purpose} options={["opening", "standard", "targeted_probe", "clarification", "rescue", "closing"] as const} onChange={(v) => up(["questions", i, "purpose"], v)} />
            <S label="Prompt class" value={q.promptClass} options={["neutral", "standard_question", "targeted_probe", "rescue", "examiner_supplied"] as const} onChange={(v) => up(["questions", i, "promptClass"], v)} />
            <T area label="Text" value={q.text} onChange={(v) => up(["questions", i, "text"], v)} />
            <T label="Targets (element ids)" value={csv(q.targetElementIds)} onChange={(v) => up(["questions", i, "targetElementIds"], uncsv(v))} />
            <T label="Supplies content of (element ids)" value={csv(q.suppliesElementIds)} onChange={(v) => up(["questions", i, "suppliesElementIds"], uncsv(v))} />
            <T label="Skip if already addressed (no answers)" value={q.skipIfAlreadyAddressed ?? ""} onChange={(v) => up(["questions", i, "skipIfAlreadyAddressed"], v || null)} />
            <T label="Addressed patterns (comma)" value={csv(q.addressedPatterns)} onChange={(v) => up(["questions", i, "addressedPatterns"], uncsv(v))} />
            <div><button type="button" className="btn btn-sm" onClick={() => removeAt(["questions"], i)}>Remove</button></div>
          </div>
        ))}
        <div><button type="button" className="btn btn-sm" onClick={() => up(["questions"], [...cv.questions, { id: `q-${cv.questions.length + 1}`, text: "", purpose: "standard", promptClass: "standard_question", targetElementIds: [], suppliesElementIds: [], modes: ["exam", "practice"], order: cv.questions.length, skipIfAlreadyAddressed: null, addressedPatterns: [] }])}>Add question</button></div>
      </fieldset>

      <fieldset className="stack"><legend>Rubric elements</legend>
        {cv.rubric.elements.map((e, i) => (
          <div key={i} className="card stack">
            <div className="grid-3">
              <T label="Id" value={e.id} onChange={(v) => up(["rubric", "elements", i, "id"], v)} />
              <S label="Domain" value={e.domain} options={["observation", "interpretation", "management", "communication"] as const} onChange={(v) => up(["rubric", "elements", i, "domain"], v)} />
              <S label="Severity" value={e.severity} options={["minor", "important", "critical"] as const} onChange={(v) => up(["rubric", "elements", i, "severity"], v)} />
            </div>
            <T area label="Construct (what is assessed)" value={e.construct} onChange={(v) => up(["rubric", "elements", i, "construct"], v)} />
            <div className="grid-3">
              <T area label="Accepted concepts (one per line)" value={lines(e.acceptedConcepts)} onChange={(v) => up(["rubric", "elements", i, "acceptedConcepts"], unlines(v))} />
              <T area label="Acceptable alternatives (one per line)" value={lines(e.acceptableAlternatives)} onChange={(v) => up(["rubric", "elements", i, "acceptableAlternatives"], unlines(v))} />
              <T area label="Incorrect or unsafe claims (one per line)" value={lines(e.incorrectOrUnsafeClaims)} onChange={(v) => up(["rubric", "elements", i, "incorrectOrUnsafeClaims"], unlines(v))} />
              <T label="Required asset ids (comma)" value={csv(e.requiredAssetIds)} onChange={(v) => up(["rubric", "elements", i, "requiredAssetIds"], uncsv(v))} />
              <S label="Opportunity" value={e.opportunityRule.kind} options={["from_stage_assets", "after_question", "either"] as const} onChange={(v) => up(["rubric", "elements", i, "opportunityRule", "kind"], v)} />
              <T label="Opportunity stage id" value={e.opportunityRule.stageId} onChange={(v) => up(["rubric", "elements", i, "opportunityRule", "stageId"], v)} />
              <T label="Opportunity question ids (comma)" value={csv(e.opportunityRule.questionIds)} onChange={(v) => up(["rubric", "elements", i, "opportunityRule", "questionIds"], uncsv(v))} />
              <T label="Skills (comma)" value={csv(e.skills)} onChange={(v) => up(["rubric", "elements", i, "skills"], uncsv(v))} />
              <T label="Depends on (element ids)" value={csv(e.dependencyElementIds)} onChange={(v) => up(["rubric", "elements", i, "dependencyElementIds"], uncsv(v))} />
            </div>
            <div className="grid-3">
              <T area label="Feedback: why it matters" value={e.feedbackGuidance.whyItMatters} onChange={(v) => up(["rubric", "elements", i, "feedbackGuidance", "whyItMatters"], v)} />
              <T area label="Feedback: stronger response" value={e.feedbackGuidance.strongerResponse} onChange={(v) => up(["rubric", "elements", i, "feedbackGuidance", "strongerResponse"], v)} />
              <T area label="Feedback: how to practise" value={e.feedbackGuidance.practiceAction} onChange={(v) => up(["rubric", "elements", i, "feedbackGuidance", "practiceAction"], v)} />
            </div>
            {cv.rubric.elements.length > 1 && <div><button type="button" className="btn btn-sm" onClick={() => removeAt(["rubric", "elements"], i)}>Remove element</button></div>}
          </div>
        ))}
        <div><button type="button" className="btn btn-sm" onClick={() => up(["rubric", "elements"], [...cv.rubric.elements, { ...cv.rubric.elements[0]!, id: `e-${cv.rubric.elements.length + 1}`, construct: "", acceptedConcepts: [""], acceptableAlternatives: [], incorrectOrUnsafeClaims: [] }])}>Add element</button></div>
      </fieldset>

      <fieldset className="stack"><legend>Reference responses</legend>
        {cv.referenceResponses.map((r, i) => (
          <T key={r.id} area label={`${r.kind.replaceAll("_", " ")} (${r.id})`} value={r.text} onChange={(v) => up(["referenceResponses", i, "text"], v)} />
        ))}
      </fieldset>
    </div>
  );
}
