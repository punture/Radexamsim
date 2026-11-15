import type { LearningPlan, SkillId } from "@sim/contracts";
import { SKILL_LABELS } from "@sim/contracts";

/**
 * Deterministic learning-plan engine (spec §12). Eligibility and exposure constraints are
 * applied BEFORE any optional model explanation; the model can only explain an allowed
 * plan. One weak attempt is a signal, not a stable trait; trends report their evidence.
 */

export type SkillObservation = {
  skill: SkillId;
  status: string;
  severity: "minor" | "important" | "critical";
  mode: string;
  caseFamilyId: string;
  firstExposure: boolean;
  assisted: boolean;
  isFixture: boolean;
  createdAt: Date;
  practiceAction: string | null;
};

export type CaseOption = { caseId: string; caseFamilyId: string; skills: SkillId[]; track: "core" | "advanced" };

export type PlanInput = {
  userId: string;
  observations: SkillObservation[];
  availableCases: CaseOption[];
  seenFamilyIds: ReadonlySet<string>;
  now: Date;
  /** Maps a case id to an opaque assignment token (never a diagnosis-bearing title). */
  tokenFor: (caseId: string) => string;
  planId: string;
};

const ASSESSABLE = new Set(["demonstrated", "partially_demonstrated", "incorrect", "not_demonstrated"]);
const WEIGHT = { critical: 3, important: 2, minor: 1 } as const;

export function summarizeSkills(observations: SkillObservation[]) {
  const by = new Map<SkillId, SkillObservation[]>();
  for (const o of observations) {
    if (!ASSESSABLE.has(o.status)) continue;
    by.set(o.skill, [...(by.get(o.skill) ?? []), o]);
  }
  return [...by.entries()].map(([skill, obs]) => {
    const families = new Set(obs.map((o) => o.caseFamilyId)).size;
    const credited = obs.filter((o) => o.status === "demonstrated" && !o.assisted).length;
    const rate = obs.length ? credited / obs.length : null;
    const unseenObs = obs.filter((o) => o.firstExposure);
    const label = SKILL_LABELS[skill];
    let statement: string;
    if (obs.length < 2) statement = `${label}: one observation so far — not enough to identify a pattern.`;
    else if (rate !== null && rate < 0.6) statement = `${label}: possible gap (credited in ${credited} of ${obs.length} observations across ${families} case ${families === 1 ? "family" : "families"}).`;
    else statement = `${label}: credited in ${credited} of ${obs.length} observations across ${families} case ${families === 1 ? "family" : "families"}${unseenObs.length < obs.length ? "; includes repeat exposures" : ""}.`;
    const weakness = obs.length >= 2 && rate !== null && rate < 0.6 ? obs.filter((o) => o.status !== "demonstrated").reduce((s, o) => s + WEIGHT[o.severity], 0) : 0;
    return { skill, observations: obs.length, distinctCaseFamilies: families, demonstratedRate: rate, statement, weakness };
  });
}

export function buildLearningPlan(input: PlanInput): LearningPlan {
  const relevant = input.observations.filter((o) => !o.isFixture || input.observations.every((x) => x.isFixture));
  const summaries = summarizeSkills(relevant);
  const focus = summaries
    .filter((s) => s.weakness > 0)
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, 2)
    .map((s) => s.skill);
  const items: LearningPlan["items"] = [];
  let order = 1;
  if (focus.length === 0) {
    items.push({
      id: `${input.planId}-1`,
      order: order++,
      kind: "mixed_timed_reassessment",
      title: "Mixed timed station",
      description: summaries.length === 0 ? "Complete a timed station so the plan can be based on your own performance." : "No repeated weakness is established yet. Continue with mixed, timed, unseen cases.",
      targetSkills: [],
      assignmentToken: null,
      suggestedAfterDays: 0,
      status: "suggested",
    });
  } else {
    const practiceActions = [...new Set(relevant.filter((o) => focus.includes(o.skill) && o.status !== "demonstrated" && o.practiceAction).map((o) => o.practiceAction!))];
    items.push({
      id: `${input.planId}-${order}`,
      order: order++,
      kind: "worked_example",
      title: `Review the reference approach (${focus.map((f) => SKILL_LABELS[f]).join(", ")})`,
      description: "Re-read the reference approach and your transcript for the cases where this came up, then say the stronger response aloud once.",
      targetSkills: focus,
      assignmentToken: null,
      suggestedAfterDays: 0,
      status: "suggested",
    });
    items.push({
      id: `${input.planId}-${order}`,
      order: order++,
      kind: "focused_verbal_exercise",
      title: "Focused verbal exercise",
      description: practiceActions.slice(0, 2).join(" ") || "Practise stating this element explicitly in a timed, spoken answer.",
      targetSkills: focus,
      assignmentToken: null,
      suggestedAfterDays: 1,
      status: "suggested",
    });
    const unseen = input.availableCases.filter((c) => !input.seenFamilyIds.has(c.caseFamilyId) && c.skills.some((s) => focus.includes(s)));
    if (unseen[0]) {
      items.push({
        id: `${input.planId}-${order}`,
        order: order++,
        kind: "unseen_case",
        title: "Related unseen case",
        description: "A new case that exercises the same skill. Take it under timed conditions without reviewing notes first.",
        targetSkills: focus,
        assignmentToken: input.tokenFor(unseen[0].caseId),
        suggestedAfterDays: 3,
        status: "suggested",
      });
    } else {
      items.push({
        id: `${input.planId}-${order}`,
        order: order++,
        kind: "revision_practice",
        title: "Revision practice (no suitable unseen case available)",
        description: "No unseen case targeting this skill is available yet. Repeat a previously seen case as labelled revision practice; repeated exposure is not evidence of transfer to new cases.",
        targetSkills: focus,
        assignmentToken: null,
        suggestedAfterDays: 3,
        status: "suggested",
      });
    }
    items.push({
      id: `${input.planId}-${order}`,
      order: order++,
      kind: "mixed_timed_reassessment",
      title: "Mixed timed reassessment",
      description: "A mixed exam-mode station, tracked separately from practice.",
      targetSkills: [],
      assignmentToken: null,
      suggestedAfterDays: 7,
      status: "suggested",
    });
  }
  return {
    id: input.planId,
    userId: input.userId,
    createdAt: input.now.toISOString(),
    basis: focus.length
      ? `Based on ${relevant.length} element observations; focus chosen from repeated, consequential gaps.`
      : "No repeated consequential gap identified yet.",
    focusSkills: focus,
    items,
    skillSummaries: summaries.map(({ weakness: _w, ...s }) => s),
    generatedBy: "deterministic",
  };
}
