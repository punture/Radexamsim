import type {
  CaseVersion,
  ExaminerUtterance,
  OpportunityRecord,
  PromptingLevel,
  RubricElement,
} from "@sim/contracts";
import { playedFraction } from "@sim/contracts";

/**
 * Deterministic assessment-opportunity and prompt-dependence rules (spec §8, §10).
 *
 * All times are SESSION-clock milliseconds. A missing or failed-to-render image is a
 * technical limitation, never a candidate error; an omission can only be counted when the
 * opportunity was genuinely open for long enough.
 */

/** Played fraction at/above which a question counts as delivered (opens an opportunity). */
export const DELIVERED_FRACTION = 0.9;
/** Played fraction at/above which an utterance counts as heard assistance. */
export const ASSISTANCE_FRACTION = 0.3;

export type CaseTimeline = {
  caseStartedAtMs: number;
  caseEndedAtMs: number;
  endedByTechnicalFailure: boolean;
  stageReveals: { stageId: string; atMs: number }[];
  renders: { assetId: string; status: "rendered" | "failed"; atMs: number }[];
  utterances: ExaminerUtterance[];
  candidateSegments: { id: string; startMs: number; endMs: number; text: string }[];
};

function firstRender(timeline: CaseTimeline, assetId: string): number | null {
  const r = timeline.renders.filter((x) => x.assetId === assetId && x.status === "rendered").sort((a, b) => a.atMs - b.atMs)[0];
  return r ? r.atMs : null;
}

function assetDisclosed(cv: CaseVersion, timeline: CaseTimeline, assetId: string): boolean {
  return timeline.stageReveals.some((r) => cv.stages.find((s) => s.id === r.stageId)?.assetIds.includes(assetId));
}

/** End time of the heard portion of an utterance (approximate by played fraction). */
function heardAt(u: ExaminerUtterance): number | null {
  if (u.playbackStartedAtMs === null) return null;
  return u.playbackEndedAtMs ?? u.playbackStartedAtMs;
}

function requiredAssets(cv: CaseVersion, el: RubricElement): string[] {
  if (el.requiredAssetIds.length > 0) return el.requiredAssetIds;
  return cv.stages.find((s) => s.id === el.opportunityRule.stageId)?.assetIds ?? [];
}

/** Total candidate speaking time (ms) after `fromMs` within the case. */
function candidateExposureAfter(timeline: CaseTimeline, fromMs: number): number {
  // Exposure is the time the candidate had available after the opportunity opened: case
  // time remaining after opening, not merely time spent talking.
  return Math.max(0, timeline.caseEndedAtMs - fromMs);
}

export function computeOpportunities(cv: CaseVersion, timeline: CaseTimeline): OpportunityRecord[] {
  return cv.rubric.elements.map((el) => computeOpportunity(cv, timeline, el));
}

export function computeOpportunity(cv: CaseVersion, timeline: CaseTimeline, el: RubricElement): OpportunityRecord {
  const rule = el.opportunityRule;
  const reasons: OpportunityRecord["notAssessableReasons"] = [];
  const assets = requiredAssets(cv, el);

  // Images
  let assetsRenderedAtMs: number | null = null;
  const renderTimes: number[] = [];
  for (const a of assets) {
    if (!assetDisclosed(cv, timeline, a)) {
      if (!reasons.includes("required_asset_not_disclosed")) reasons.push("required_asset_not_disclosed");
      continue;
    }
    const t = firstRender(timeline, a);
    if (t === null) {
      if (!reasons.includes("required_asset_render_failed")) reasons.push("required_asset_render_failed");
    } else renderTimes.push(t);
  }
  const imagesOk = rule.requireAllAssetsRendered ? reasons.length === 0 && renderTimes.length === assets.length : renderTimes.length > 0 || assets.length === 0;
  if (imagesOk) {
    assetsRenderedAtMs = assets.length === 0 ? timeline.caseStartedAtMs : rule.requireAllAssetsRendered ? Math.max(...renderTimes) : Math.min(...renderTimes);
    // Partial renders are acceptable when not all assets are required.
    if (!rule.requireAllAssetsRendered) {
      const idx = reasons.indexOf("required_asset_render_failed");
      if (idx >= 0) reasons.splice(idx, 1);
      const idx2 = reasons.indexOf("required_asset_not_disclosed");
      if (idx2 >= 0) reasons.splice(idx2, 1);
    }
  }

  // Questions
  let questionDeliveredAtMs: number | null = null;
  let interruptedQuestion = false;
  for (const u of timeline.utterances) {
    if (!u.refId || !rule.questionIds.includes(u.refId)) continue;
    const f = playedFraction(u);
    if (f >= DELIVERED_FRACTION) {
      const t = heardAt(u);
      if (t !== null && (questionDeliveredAtMs === null || t < questionDeliveredAtMs)) questionDeliveredAtMs = t;
    } else if (u.playbackStartedAtMs !== null) interruptedQuestion = true;
  }

  let openedAtMs: number | null = null;
  if (assetsRenderedAtMs !== null) {
    if (rule.kind === "from_stage_assets") openedAtMs = assetsRenderedAtMs;
    else if (rule.kind === "after_question") openedAtMs = questionDeliveredAtMs === null ? null : Math.max(assetsRenderedAtMs, questionDeliveredAtMs);
    else {
      // either: opens via the question, or via the images when spontaneous mention is expected.
      const viaQuestion = questionDeliveredAtMs === null ? null : Math.max(assetsRenderedAtMs, questionDeliveredAtMs);
      const viaImages = el.promptingPolicy.spontaneousExpected ? assetsRenderedAtMs : null;
      const options = [viaQuestion, viaImages].filter((x): x is number => x !== null);
      openedAtMs = options.length ? Math.min(...options) : null;
    }
  }
  if (openedAtMs === null && assetsRenderedAtMs !== null && rule.kind !== "from_stage_assets") {
    reasons.push(interruptedQuestion ? "question_interrupted_before_heard" : "question_not_delivered");
  }

  const exposureMs = openedAtMs === null ? 0 : candidateExposureAfter(timeline, openedAtMs);
  if (openedAtMs !== null && exposureMs < rule.minExposureSeconds * 1000) reasons.push("insufficient_time_after_opportunity");
  if (timeline.endedByTechnicalFailure && openedAtMs !== null && exposureMs < rule.minExposureSeconds * 1000 * 2) {
    reasons.push("case_ended_by_technical_failure");
  }

  const assessable = openedAtMs !== null && reasons.length === 0;
  return {
    id: `opp_${el.id}`,
    elementId: el.id,
    assessable,
    assetsRenderedAtMs: assetsRenderedAtMs === null ? null : assetsRenderedAtMs - timeline.caseStartedAtMs,
    questionDeliveredAtMs: questionDeliveredAtMs === null ? null : questionDeliveredAtMs - timeline.caseStartedAtMs,
    openedAtMs: openedAtMs === null ? null : openedAtMs - timeline.caseStartedAtMs,
    exposureMs,
    notAssessableReasons: reasons,
    description: describeOpportunity(el, assessable, reasons, openedAtMs === null ? null : openedAtMs - timeline.caseStartedAtMs),
  };
}

function describeOpportunity(el: RubricElement, assessable: boolean, reasons: string[], openedCaseMs: number | null): string {
  const when = openedCaseMs === null ? "" : ` from ${Math.round(openedCaseMs / 1000)}s into the case`;
  if (assessable) {
    return el.opportunityRule.kind === "after_question"
      ? `Assessable after the approved question was heard${when}.`
      : `Assessable once the relevant images were displayed${when}.`;
  }
  return `Not assessable: ${reasons.join(", ").replaceAll("_", " ")}.`;
}

/**
 * Most-assisted prompting level that applies to evidence first stated at `evidenceAtMs`.
 * Conservative: any heard examiner utterance that supplied the element's content before the
 * evidence makes it examiner-supplied (no independent credit).
 */
export function classifyPrompting(timeline: CaseTimeline, elementId: string, evidenceAtMs: number): PromptingLevel {
  let level: PromptingLevel = "spontaneous";
  const rank: Record<PromptingLevel, number> = { spontaneous: 0, standard_question: 1, targeted_probe: 2, rescue: 3, examiner_supplied: 4 };
  for (const u of timeline.utterances) {
    if (u.playbackStartedAtMs === null || u.playbackStartedAtMs >= evidenceAtMs) continue;
    if (playedFraction(u) < ASSISTANCE_FRACTION) continue;
    let l: PromptingLevel | null = null;
    if (u.suppliesElementIds.includes(elementId)) l = "examiner_supplied";
    else if (u.targetElementIds.includes(elementId)) {
      if (u.promptClass === "rescue") l = "rescue";
      else if (u.promptClass === "targeted_probe") l = "targeted_probe";
      else if (u.promptClass === "standard_question") l = "standard_question";
      else if (u.promptClass === "examiner_supplied") l = "examiner_supplied";
    }
    if (l && rank[l] > rank[level]) level = l;
  }
  return level;
}

export function morePrompted(a: PromptingLevel, b: PromptingLevel): PromptingLevel {
  const order: PromptingLevel[] = ["spontaneous", "standard_question", "targeted_probe", "rescue", "examiner_supplied"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
