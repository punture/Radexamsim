import type { CaseVersion, ExamProfileVersion, ExaminerUtterance, OpportunityRecord } from "@sim/contracts";
import { playedFraction } from "@sim/contracts";
import { computeOpportunities, type CaseTimeline } from "@sim/exam-engine";
import type { AssessorInput, ExtractorInput } from "../prompts/assessment";
import type { CandidateSegment } from "./evidence";

/**
 * Everything the assessment pipeline knows about one case attempt. Assembled by the worker
 * from durable records; frozen versions are carried explicitly.
 */
export type AttemptData = {
  caseAttemptId: string;
  sessionId: string;
  mode: "exam" | "practice" | "owner_preview";
  profile: ExamProfileVersion;
  caseVersion: CaseVersion;
  caseStartedAtMs: number;
  caseEndedAtMs: number;
  closeReason: string;
  endedByTechnicalFailure: boolean;
  stageReveals: { stageId: string; atMs: number }[];
  renders: { assetId: string; status: "rendered" | "failed"; atMs: number }[];
  /** Candidate segments for this case: final, current revision. */
  segments: CandidateSegment[];
  transcriptRevision: number;
  utterances: ExaminerUtterance[];
  technicalNotes: string[];
  typedInput: boolean;
};

export function timelineOf(a: AttemptData): CaseTimeline {
  return {
    caseStartedAtMs: a.caseStartedAtMs,
    caseEndedAtMs: a.caseEndedAtMs,
    endedByTechnicalFailure: a.endedByTechnicalFailure,
    stageReveals: a.stageReveals,
    renders: a.renders,
    utterances: a.utterances,
    candidateSegments: a.segments.map((s) => ({ id: s.id, startMs: s.startMs, endMs: s.endMs, text: s.text })),
    closeReason: a.closeReason,
  };
}

const secs = (ms: number, base: number) => Math.max(0, Math.round((ms - base) / 100) / 10);

export function examinerPromptsFor(a: AttemptData) {
  return a.utterances
    .filter((u) => u.playbackStartedAtMs !== null)
    .map((u) => ({
      atSeconds: secs(u.playbackStartedAtMs!, a.caseStartedAtMs),
      kind: u.kind,
      promptClass: u.promptClass,
      heardText: u.text.slice(0, u.deliveryStatus === "completed" ? u.text.length : u.playedChars),
      interrupted: u.deliveryStatus === "interrupted" || (u.deliveryStatus !== "completed" && playedFraction(u) < 1),
      targetElementIds: u.targetElementIds,
      suppliesElementIds: u.suppliesElementIds,
    }));
}

export function transcriptFor(a: AttemptData) {
  return a.segments.map((s) => ({ segmentId: s.id, atSeconds: secs(s.startMs, a.caseStartedAtMs), text: s.text, source: s.source, providerConfidence: s.confidence }));
}

export function extractorInput(a: AttemptData): ExtractorInput {
  return { transcript: transcriptFor(a), examinerPrompts: examinerPromptsFor(a) };
}

/**
 * Assessor DTO built by explicit allowlist (spec §6): full approved rubric and truth, the
 * final transcript, prompt history, image availability/render events and session
 * conditions. Excludes learner identity, history, plan, examiner policy notes.
 */
export function assessorInput(a: AttemptData, opportunities: OpportunityRecord[], statements: AssessorInput["extractedStatements"]): AssessorInput {
  const cv = a.caseVersion;
  const rendered = new Set(a.renders.filter((r) => r.status === "rendered").map((r) => r.assetId));
  const assetLabel = new Map(cv.assets.map((x) => [x.id, x.neutralLabel]));
  return {
    scoringContext: {
      profile: a.profile.displayName,
      mode: a.mode,
      scoringKind: a.profile.scoring.kind,
      disclaimer: a.profile.scoring.disclaimer,
    },
    clinicalTruth: {
      finalDiagnosis: cv.clinicalTruth.finalDiagnosis,
      displayedMaterialSupports: cv.clinicalTruth.displayedMaterialSupports,
      keyFindings: cv.clinicalTruth.keyFindings.map((f) => ({
        id: f.id,
        description: f.description,
        location: f.location,
        laterality: f.laterality,
        conspicuity: f.conspicuity,
        imagesDisclosedAndRendered: f.assetIds.some((x) => rendered.has(x)),
      })),
      acceptableDiagnoses: cv.clinicalTruth.acceptableDiagnoses,
      differential: cv.clinicalTruth.differential,
      managementExpectations: cv.clinicalTruth.managementExpectations,
      urgency: cv.clinicalTruth.urgency,
      criticalCommunication: cv.clinicalTruth.criticalCommunication,
      uncertaintyNotes: cv.clinicalTruth.uncertaintyNotes,
    },
    rubric: {
      elements: cv.rubric.elements.map((e) => ({
        id: e.id,
        domain: e.domain,
        construct: e.construct,
        acceptedConcepts: e.acceptedConcepts,
        acceptableAlternatives: e.acceptableAlternatives,
        incorrectOrUnsafeClaims: e.incorrectOrUnsafeClaims,
        severity: e.severity,
        dependencyElementIds: e.dependencyElementIds,
        spontaneousExpected: e.promptingPolicy.spontaneousExpected,
        creditByPrompting: { ...e.promptingPolicy.credit },
        opportunity: opportunities.find((o) => o.elementId === e.id)!,
      })),
      domains: cv.rubric.domains.map((d) => ({ id: d.id, description: d.description, anchors: d.anchors })),
      globalAnchors: cv.rubric.globalRules.anchors,
    },
    transcript: transcriptFor(a),
    examinerPrompts: examinerPromptsFor(a),
    imageEvents: a.renders.map((r) => ({ atSeconds: secs(r.atMs, a.caseStartedAtMs), image: assetLabel.get(r.assetId) ?? "image", event: r.status })),
    sessionConditions: {
      typedInput: a.typedInput,
      technicalLimitations: a.technicalNotes,
      caseEndReason: a.closeReason,
    },
    extractedStatements: statements,
  };
}

export function opportunitiesFor(a: AttemptData): OpportunityRecord[] {
  return computeOpportunities(a.caseVersion, timelineOf(a));
}
