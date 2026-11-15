import type {
  CaseVersion,
  DomainRating,
  ElementResult,
  ElementStatus,
  EvidenceSpan,
  OpportunityRecord,
  PromptingLevel,
  RatingLevel,
  RubricElement,
  UnsafeFlag,
  ValidationIssue,
} from "@sim/contracts";
import { classifyPrompting, morePrompted, type CaseTimeline } from "@sim/exam-engine";
import type { AssessorLlmOutput } from "../prompts/assessment";
import { spanTimeMs, validateSpan, type CandidateSegment } from "./evidence";

/**
 * Deterministic checks applied to every assessor pass (spec §10 step 6). The model's
 * judgment is accepted only where it is supported by valid evidence and consistent with
 * the opportunity record; otherwise it is downgraded to "uncertain" or "not_assessable"
 * with a recorded reason. Nothing here invents evidence.
 */

export type ValidatedJudgment = Omit<ElementResult, "agreement" | "severity"> & { severity: RubricElement["severity"] };

export type ValidatedPass = {
  judgments: Map<string, ValidatedJudgment>;
  unsafeFlags: UnsafeFlag[];
  domainRatings: DomainRating[];
  globalRating: { level: RatingLevel | null; rationale: string };
  issues: ValidationIssue[];
  repaired: boolean;
  abstained: boolean;
};

const POSITIVE: ElementStatus[] = ["demonstrated", "partially_demonstrated", "incorrect"];

export function creditFor(el: RubricElement, status: ElementStatus, level: PromptingLevel | null): ElementResult["credit"] {
  if (status === "not_assessable" || status === "uncertain") return "not_applicable";
  if (status !== "demonstrated" && status !== "partially_demonstrated") return "none";
  const byLevel = el.promptingPolicy.credit[level ?? "spontaneous"];
  if (status === "partially_demonstrated") return byLevel === "none" ? "none" : "partial";
  return byLevel;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function matchesCriterion(criterion: string, claims: string[]): string | null {
  const c = normalizeText(criterion);
  for (const claim of claims) {
    const n = normalizeText(claim);
    if (n === c || n.includes(c) || c.includes(n)) return claim;
  }
  return null;
}

/** Provider confidence below which recognized words cannot support a confident mark. */
export const LOW_ASR_CONFIDENCE = 0.6;
const isLowConfidence = (s: CandidateSegment | undefined) => !!s && s.confidence !== null && s.confidence < LOW_ASR_CONFIDENCE;

export function postprocessPass(
  raw: AssessorLlmOutput,
  cv: CaseVersion,
  opportunities: OpportunityRecord[],
  segments: CandidateSegment[],
  timeline: CaseTimeline,
): ValidatedPass {
  const segMap = new Map(segments.map((s) => [s.id, s]));
  const issues: ValidationIssue[] = [];
  let repaired = false;
  const issue = (code: string, elementId: string | null, message: string, severity: "error" | "warning" = "warning") =>
    issues.push({ code, severity, elementId, message });

  const checkSpans = (spans: EvidenceSpan[], elementId: string | null): EvidenceSpan[] => {
    const out: EvidenceSpan[] = [];
    for (const sp of spans) {
      const r = validateSpan(sp, segMap);
      if (r.ok) {
        out.push(r.span);
        if (r.repaired) {
          repaired = true;
          issue("evidence_repaired", elementId, `evidence span repaired (${r.repairNote})`);
        }
      } else issue("evidence_rejected", elementId, `evidence rejected: ${r.reason}`, "error");
    }
    return out;
  };

  const judgments = new Map<string, ValidatedJudgment>();
  for (const el of cv.rubric.elements) {
    const opp = opportunities.find((o) => o.elementId === el.id)!;
    const candidates = raw.elementJudgments.filter((j) => j.elementId === el.id);
    if (candidates.length > 1) issue("duplicate_judgment", el.id, "multiple judgments for one element; first used");
    const j = candidates[0];
    const base = { elementId: el.id, severity: el.severity, opportunity: opp, blockedByElementIds: [] as string[] };
    if (!j) {
      issue("missing_judgment", el.id, "assessor omitted this element", "error");
      judgments.set(el.id, { ...base, status: "uncertain", promptingLevel: null, credit: "not_applicable", evidence: [], selfCorrection: null, rationale: "No judgment was returned for this element.", uncertaintyReason: "assessor omitted element" });
      continue;
    }
    let status: ElementStatus = j.status;
    let uncertaintyReason = j.uncertaintyReason;
    let evidence = checkSpans(j.evidence, el.id);

    // Positive claims need real candidate evidence.
    if (POSITIVE.includes(status) && evidence.length === 0) {
      issue("unsupported_positive", el.id, `status ${status} without verifiable evidence; downgraded to uncertain`, "error");
      status = "uncertain";
      uncertaintyReason = "cited evidence could not be verified against the transcript";
    }
    // Speech-recognition uncertainty: no confident mark may rest only on low-confidence words.
    if (POSITIVE.includes(status) && evidence.length > 0 && evidence.every((e) => isLowConfidence(segMap.get(e.segmentId)))) {
      issue("low_confidence_evidence", el.id, `status ${status} rests only on low-confidence transcription; marked uncertain for transcript review`);
      status = "uncertain";
      uncertaintyReason = "the only supporting words came from low-confidence speech recognition; the transcript needs review";
    }
    // Evidence must come after the material it depends on was actually displayed.
    if ((status === "demonstrated" || status === "partially_demonstrated") && el.requiredAssetIds.length > 0) {
      if (opp.assetsRenderedAtMs === null) {
        status = "not_assessable";
        uncertaintyReason = null;
        issue("material_not_available", el.id, "required images were never displayed; positive judgment converted to not_assessable");
        evidence = [];
      } else {
        const renderedAt = timeline.caseStartedAtMs + opp.assetsRenderedAtMs;
        const after = evidence.filter((e) => spanTimeMs(e, segMap) >= renderedAt - 500);
        if (after.length === 0) {
          status = "uncertain";
          uncertaintyReason = "statement preceded display of the required images";
          issue("evidence_before_material", el.id, "evidence predates image availability", "error");
        } else evidence = after;
      }
    }
    // Omissions require a genuine opportunity.
    if (status === "not_demonstrated" && !opp.assessable) {
      status = "not_assessable";
      issue("omission_without_opportunity", el.id, `omission converted to not_assessable (${opp.notAssessableReasons.join(", ")})`);
    }
    // An omission cannot be confirmed if what the candidate said in that window was poorly recognized.
    if (status === "not_demonstrated" && opp.openedAtMs !== null) {
      const openedAt = timeline.caseStartedAtMs + opp.openedAtMs;
      if (segments.some((sg) => sg.endMs > openedAt && isLowConfidence(sg))) {
        status = "uncertain";
        uncertaintyReason = "speech recognition confidence was low during this opportunity, so an omission cannot be confirmed";
        issue("low_confidence_omission", el.id, "omission converted to uncertain: low-confidence transcription during the opportunity");
      }
    }
    if (status === "not_demonstrated" && j.opportunityId !== opp.id) {
      issue("omission_opportunity_mismatch", el.id, "omission did not cite the element's opportunity record; corrected");
    }
    if (status === "not_assessable" && opp.assessable && evidence.length === 0) {
      status = "uncertain";
      uncertaintyReason = uncertaintyReason ?? "assessor considered the element not assessable although the opportunity was available";
      issue("not_assessable_conflict", el.id, "assessor said not assessable but opportunity record says assessable");
    }
    if (status === "uncertain" && !uncertaintyReason) uncertaintyReason = "assessor could not make a defensible judgment";

    // Prompting: the deterministic classification from what was actually heard is a floor.
    let promptingLevel: PromptingLevel | null = null;
    if (status === "demonstrated" || status === "partially_demonstrated") {
      const firstAt = Math.min(...evidence.map((e) => spanTimeMs(e, segMap)));
      const computed = classifyPrompting(timeline, el.id, firstAt);
      promptingLevel = j.promptingLevel ? morePrompted(j.promptingLevel, computed) : computed;
      if (j.promptingLevel && promptingLevel !== j.promptingLevel) {
        issue("prompting_adjusted", el.id, `prompting raised from ${j.promptingLevel} to ${promptingLevel} based on heard examiner prompts`);
      }
    }

    let selfCorrection = null;
    if (j.selfCorrection) {
      const a = validateSpan(j.selfCorrection.initial, segMap);
      const b = validateSpan(j.selfCorrection.correction, segMap);
      if (a.ok && b.ok) {
        selfCorrection = { initial: a.span, correction: b.span, latencyMs: Math.max(0, Math.round(spanTimeMs(b.span, segMap) - spanTimeMs(a.span, segMap))) };
      } else issue("self_correction_rejected", el.id, "self-correction spans could not be verified");
    }

    judgments.set(el.id, {
      ...base,
      status,
      promptingLevel,
      credit: creditFor(el, status, promptingLevel),
      evidence,
      selfCorrection,
      rationale: j.rationale.slice(0, 600) || "No rationale provided.",
      uncertaintyReason: status === "uncertain" ? uncertaintyReason : null,
    });
  }

  // Dependency blocking: record upstream failures to avoid double deduction in feedback.
  for (const el of cv.rubric.elements) {
    const jj = judgments.get(el.id)!;
    if (jj.status === "not_demonstrated" || jj.status === "incorrect" || jj.status === "partially_demonstrated") {
      jj.blockedByElementIds = el.dependencyElementIds.filter((d) => {
        const dj = judgments.get(d);
        return dj && (dj.status === "not_demonstrated" || dj.status === "incorrect");
      });
    }
  }

  // Unsafe flags: must name an approved criterion and quote real words.
  const unsafeFlags: UnsafeFlag[] = [];
  for (const f of raw.unsafeFlags) {
    const claims = f.elementId ? cv.rubric.elements.find((e) => e.id === f.elementId)?.incorrectOrUnsafeClaims ?? [] : cv.rubric.elements.flatMap((e) => e.incorrectOrUnsafeClaims);
    const criterion = matchesCriterion(f.criterion, claims);
    if (!criterion) {
      issue("unsafe_flag_unknown_criterion", f.elementId, `unsafe flag does not match an approved criterion: "${f.criterion.slice(0, 80)}"`, "error");
      continue;
    }
    const ev = checkSpans(f.evidence, f.elementId);
    if (ev.length === 0) {
      issue("unsafe_flag_unsupported", f.elementId, "unsafe flag without verifiable words; dropped", "error");
      continue;
    }
    // A flag resting only on low-confidence words stays visible but cannot cap the rating.
    const lowConf = ev.every((e) => isLowConfidence(segMap.get(e.segmentId)));
    if (lowConf) issue("unsafe_flag_low_confidence", f.elementId, "unsafe flag rests only on low-confidence transcription; recorded as not committed pending transcript review");
    unsafeFlags.push({ elementId: f.elementId, criterion, evidence: ev, context: `${lowConf ? "[low-confidence transcription] " : ""}${f.context}`.slice(0, 400), consequence: f.consequence.slice(0, 400) || "Potential patient harm.", committed: f.committed && !lowConf, correctedLater: f.correctedLater });
  }

  const domainRatings: DomainRating[] = raw.domainRatings.map((d) => ({
    domain: d.domain,
    level: d.level,
    rationale: d.rationale.slice(0, 600),
    supportingElementIds: d.supportingElementIds.filter((id) => judgments.has(id)),
  }));

  return { judgments, unsafeFlags, domainRatings, globalRating: { level: raw.globalRating.level, rationale: raw.globalRating.rationale.slice(0, 800) }, issues, repaired, abstained: raw.abstained };
}
