import type {
  CaseDebrief,
  CaseVersion,
  ElementResult,
  ExamProfileVersion,
  FinalCaseAssessment,
  PromptingLevel,
  RubricElement,
} from "@sim/contracts";
import type { CandidateSegment } from "../assessment/evidence";

/**
 * Deterministic debrief composer (spec §11). Structure per issue:
 *   what you said or omitted -> why it mattered -> what a stronger response would do -> how to practise.
 * Quotes come only from validated evidence spans; teaching text comes only from the
 * owner-approved rubric feedback guidance and reference responses. Nothing is emitted for
 * an element the learner did not actually have an opportunity to demonstrate.
 */

const VERB: Record<string, string> = {
  identifies: "identified",
  localizes: "localized",
  gives: "gave",
  recommends: "recommended",
  recognizes: "recognized",
  communicates: "communicated",
  describes: "described",
  states: "stated",
  expresses: "expressed",
  names: "named",
  integrates: "integrated",
  suggests: "suggested",
  mentions: "mentioned",
  provides: "provided",
};
const BASE: Record<string, string> = {
  identifies: "identify",
  localizes: "localize",
  gives: "give",
  recommends: "recommend",
  recognizes: "recognize",
  communicates: "communicate",
  describes: "describe",
  states: "state",
  expresses: "express",
  names: "name",
  integrates: "integrate",
  suggests: "suggest",
  mentions: "mention",
  provides: "provide",
};

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
function stripPeriod(s: string): string {
  return s.replace(/\.\s*$/, "");
}

/** "Identifies the X." -> "You identified the X" */
export function pastTense(construct: string): string {
  const [first, ...rest] = stripPeriod(construct).split(" ");
  const v = VERB[(first ?? "").toLowerCase()];
  return v ? `You ${v} ${rest.join(" ")}` : `You demonstrated: ${lowerFirst(stripPeriod(construct))}`;
}
/** "Identifies the X." -> "identify the X" */
export function baseForm(construct: string): string {
  const [first, ...rest] = stripPeriod(construct).split(" ");
  const v = BASE[(first ?? "").toLowerCase()];
  return v ? `${v} ${rest.join(" ")}` : lowerFirst(stripPeriod(construct));
}

const PROMPT_PHRASE: Record<PromptingLevel, string> = {
  spontaneous: "without prompting",
  standard_question: "in response to a standard question",
  targeted_probe: "after a targeted prompt",
  rescue: "only after a rescue prompt",
  examiner_supplied: "after the examiner supplied it",
};

const SEVERITY_RANK = { critical: 0, important: 1, minor: 2 } as const;
const STATUS_RANK: Record<string, number> = { incorrect: 0, not_demonstrated: 1, partially_demonstrated: 2, demonstrated: 3 };

export type ComposeInput = {
  assessmentId: string;
  assessment: Omit<FinalCaseAssessment, "id" | "assessmentVersion" | "supersedesAssessmentId" | "supersedeReason"> | FinalCaseAssessment;
  caseVersion: CaseVersion;
  profile: ExamProfileVersion;
  caseLabel: string;
  segments: CandidateSegment[];
  caseStartedAtMs: number;
  /** Optional model-written overall summary that already passed validation. */
  validatedSummary?: string | null;
};

export function composeCaseDebrief(input: ComposeInput): CaseDebrief {
  const { assessment: a, caseVersion: cv, profile } = input;
  const segMap = new Map(input.segments.map((s) => [s.id, s]));
  const el = (id: string) => cv.rubric.elements.find((e) => e.id === id)!;
  const quoteRef = (e: { segmentId: string; quote: string }) => ({
    segmentId: e.segmentId,
    quote: e.quote,
    atMs: Math.max(0, (segMap.get(e.segmentId)?.startMs ?? input.caseStartedAtMs) - input.caseStartedAtMs),
  });

  // Strengths: credited elements, most important and least prompted first.
  const strengths = a.elementResults
    .filter((r) => r.status === "demonstrated" && r.credit !== "none" && r.evidence.length > 0)
    .sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || promptRank(x.promptingLevel) - promptRank(y.promptingLevel))
    .slice(0, 3)
    .map((r) => ({
      elementId: r.elementId,
      summary: `${pastTense(el(r.elementId).construct)}${r.promptingLevel && r.promptingLevel !== "spontaneous" ? ` ${PROMPT_PHRASE[r.promptingLevel]}` : ""}.`,
      promptingLevel: r.promptingLevel,
      evidence: r.evidence.slice(0, 2).map(quoteRef),
    }));

  // Issues: incorrect, missed, partial, or demonstrated only with heavy assistance.
  const issueResults = a.elementResults.filter(
    (r) =>
      r.status === "incorrect" ||
      r.status === "not_demonstrated" ||
      r.status === "partially_demonstrated" ||
      (r.status === "demonstrated" && (r.promptingLevel === "examiner_supplied" || r.promptingLevel === "rescue")),
  );
  const roots = issueResults.filter((r) => r.blockedByElementIds.length === 0);
  const dependents = issueResults.filter((r) => r.blockedByElementIds.length > 0);
  const flagged = new Set(a.unsafeFlags.filter((f) => f.committed && !f.correctedLater).map((f) => f.elementId));
  const sorted = [...roots].sort(
    (x, y) =>
      Number(!flagged.has(x.elementId)) - Number(!flagged.has(y.elementId)) ||
      SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
      (STATUS_RANK[x.status] ?? 9) - (STATUS_RANK[y.status] ?? 9),
  );
  const issues = sorted.map((r, i) => {
    const e = el(r.elementId);
    const related = dependents.filter((d) => d.blockedByElementIds.includes(r.elementId)).map((d) => d.elementId);
    return {
      elementId: r.elementId,
      rank: i + 1,
      severity: r.severity,
      status: r.status,
      whatHappened: describeWhatHappened(r, e),
      evidence: r.evidence.slice(0, 2).map(quoteRef),
      opportunityDescription: r.status === "not_demonstrated" ? r.opportunity.description : null,
      whyItMatters: e.feedbackGuidance.whyItMatters,
      strongerResponse: e.feedbackGuidance.strongerResponse,
      howToPractise: e.feedbackGuidance.practiceAction,
      promptingLevel: r.promptingLevel,
      relatedElementIds: related,
    };
  });

  const promptingTable = a.elementResults.map((r) => ({
    elementId: r.elementId,
    construct: el(r.elementId).construct,
    status: r.status,
    promptingLevel: r.promptingLevel,
    corrected: r.selfCorrection !== null,
  }));

  const ref = cv.referenceResponses.find((r) => r.kind === "concise_reference");
  const improvementActions = [...new Set(issues.map((i) => i.howToPractise))].slice(0, 3);
  const uncertaintyStatement = a.provisional || a.globalRating.withheldReason || a.uncertaintyReasons.length
    ? [
        a.assessorKind === "dev_baseline" ? "This is a development baseline result, not a clinical assessment." : null,
        a.globalRating.withheldReason,
        a.disputedElementIds.length ? `${a.disputedElementIds.length} element(s) are awaiting owner review because independent assessments disagreed.` : null,
        a.elementResults.some((r) => r.status === "uncertain") && !a.disputedElementIds.length ? "Some elements could not be judged confidently; they are marked uncertain." : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  return {
    caseAttemptId: a.caseAttemptId,
    caseLabel: input.caseLabel,
    assessmentId: input.assessmentId,
    assessorKind: a.assessorKind,
    overall: {
      summary: input.validatedSummary ?? deterministicSummary(a, strengths, issues, cv),
      ratingDisplay: a.globalRating.display,
      ratingDisclaimer: profile.scoring.disclaimer,
      withheldReason: a.globalRating.withheldReason,
      provisional: a.provisional,
      uncertaintyStatement: uncertaintyStatement || null,
    },
    strengths,
    issues,
    promptingTable,
    referenceApproach: { text: ref?.text ?? "", alternatives: cv.referenceResponses.filter((r) => r.kind === "acceptable_alternative").map((r) => r.text) },
    technicalLimitations: a.technicalLimitations,
    improvementActions,
    isDevelopmentFixture: cv.isDevelopmentFixture,
    createdAt: a.createdAt,
  };
}

function promptRank(p: PromptingLevel | null): number {
  return p === null ? 0 : ["spontaneous", "standard_question", "targeted_probe", "rescue", "examiner_supplied"].indexOf(p);
}

function describeWhatHappened(r: ElementResult, e: RubricElement): string {
  const q = r.evidence[0]?.quote;
  switch (r.status) {
    case "incorrect":
      return q ? `You said "${q}", which conflicts with what the images show for this point: ${lowerFirst(stripPeriod(e.construct))}.` : `Your answer was judged incorrect for: ${lowerFirst(stripPeriod(e.construct))}.`;
    case "not_demonstrated":
      return `You did not ${baseForm(e.construct)}${r.opportunity.openedAtMs !== null ? ` although the opportunity was available from ${Math.round(r.opportunity.openedAtMs / 1000)}s into the case` : ""}.`;
    case "partially_demonstrated":
      return q ? `You said "${q}", which only partly established: ${lowerFirst(stripPeriod(e.construct))}.` : `You partly established: ${lowerFirst(stripPeriod(e.construct))}.`;
    case "demonstrated":
      return r.promptingLevel === "examiner_supplied"
        ? "The examiner supplied this information before you stated it, so it was not counted as independent detection."
        : "You reached this point only after a rescue prompt, so it was not counted as independent performance.";
    default:
      return "";
  }
}

function deterministicSummary(
  a: ComposeInput["assessment"],
  strengths: { summary: string }[],
  issues: { whatHappened: string; severity: string }[],
  cv: CaseVersion,
): string {
  const parts: string[] = [];
  if (a.globalRating.display) parts.push(`Overall: ${a.globalRating.display}.`);
  else if (a.globalRating.withheldReason) parts.push(`An overall rating has been withheld. ${a.globalRating.withheldReason}`);
  if (strengths[0]) parts.push(strengths[0].summary);
  if (issues[0]) parts.push(`Most consequential issue (${issues[0].severity}): ${issues[0].whatHappened}`);
  if (!strengths[0] && !issues[0]) parts.push("No element could be assessed for this case.");
  if (a.provisional && !a.globalRating.withheldReason) parts.push("This result is provisional.");
  if (cv.isDevelopmentFixture) parts.push("(Development fixture — not a clinical case.)");
  return parts.join(" ");
}
