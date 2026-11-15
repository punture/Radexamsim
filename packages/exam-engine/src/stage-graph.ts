import type {
  ApprovedQuestion,
  CaseStage,
  CaseVersion,
  ExamMode,
  FactReply,
  PromptingAllowance,
  StageState,
  StageTransition,
} from "@sim/contracts";

/**
 * Per-case authored stage graph (spec §7). Pure functions over (CaseVersion, StageState).
 * Each case is its own small graph, so engine behaviour is testable per case.
 */

export function initialStageState(cv: CaseVersion): StageState {
  return {
    currentStageId: cv.openingStageId,
    revealedStageIds: [cv.openingStageId],
    deliveredQuestionIds: [],
    deliveredFactReplyIds: [],
    probesPerElement: {},
    renderedAssets: {},
    failedAssets: {},
  };
}

export function getStage(cv: CaseVersion, stageId: string): CaseStage {
  const s = cv.stages.find((x) => x.id === stageId);
  if (!s) throw new Error(`stage ${stageId} not found in case ${cv.caseId}`);
  return s;
}

export function currentStage(cv: CaseVersion, state: StageState): CaseStage {
  return getStage(cv, state.currentStageId);
}

export function getQuestion(cv: CaseVersion, questionId: string): ApprovedQuestion {
  const q = cv.questions.find((x) => x.id === questionId);
  if (!q) throw new Error(`question ${questionId} not found in case ${cv.caseId}`);
  return q;
}

/** Revealed stages in reveal order. */
export function revealedStages(cv: CaseVersion, state: StageState): CaseStage[] {
  return state.revealedStageIds.map((id) => getStage(cv, id));
}

/** Assets disclosed so far, in disclosure order (opening stage first). */
export function disclosedAssetIds(cv: CaseVersion, state: StageState): string[] {
  const out: string[] = [];
  for (const s of revealedStages(cv, state)) for (const a of s.assetIds) if (!out.includes(a)) out.push(a);
  return out;
}

export function cumulativeHistory(cv: CaseVersion, state: StageState): string[] {
  return revealedStages(cv, state)
    .map((s) => s.candidateHistory.trim())
    .filter((h) => h.length > 0);
}

export function findFactReply(cv: CaseVersion, replyId: string): { reply: FactReply; stage: CaseStage } | null {
  for (const stage of cv.stages) {
    const reply = stage.approvedFactReplies.find((r) => r.id === replyId);
    if (reply) return { reply, stage };
  }
  return null;
}

export type TransitionCheck = { ok: true; transition: StageTransition } | { ok: false; reason: string };

/**
 * Whether the graph permits revealing `toStageId` now. Transitions only leave the current
 * stage; a stage can be revealed once.
 */
export function checkReveal(
  cv: CaseVersion,
  state: StageState,
  toStageId: string,
  caseElapsedMs: number,
  via: { kind: "examiner" } | { kind: "fact_reply"; replyId: string },
): TransitionCheck {
  if (state.revealedStageIds.includes(toStageId)) return { ok: false, reason: "stage_already_revealed" };
  if (!cv.stages.some((s) => s.id === toStageId)) return { ok: false, reason: "unknown_stage" };
  const stage = currentStage(cv, state);
  const candidates = stage.transitions.filter((t) => t.toStageId === toStageId);
  if (candidates.length === 0) return { ok: false, reason: "no_transition_from_current_stage" };
  for (const t of candidates) {
    if (t.minCaseElapsedSeconds !== null && caseElapsedMs < t.minCaseElapsedSeconds * 1000) continue;
    if (via.kind === "fact_reply") {
      if (t.trigger === "candidate_request" && t.viaFactReplyId === via.replyId) return { ok: true, transition: t };
      continue;
    }
    if (t.trigger === "examiner_decision") return { ok: true, transition: t };
    if (t.trigger === "after_question" && t.afterQuestionIds.every((q) => state.deliveredQuestionIds.includes(q))) {
      return { ok: true, transition: t };
    }
  }
  return { ok: false, reason: "transition_conditions_not_met" };
}

export function applyReveal(cv: CaseVersion, state: StageState, toStageId: string): StageState {
  getStage(cv, toStageId);
  if (state.revealedStageIds.includes(toStageId)) return state;
  return { ...state, currentStageId: toStageId, revealedStageIds: [...state.revealedStageIds, toStageId] };
}

/** Examiner-decision reveals currently available (not candidate-request-only ones). */
export function examinerRevealOptions(cv: CaseVersion, state: StageState, caseElapsedMs: number): StageTransition[] {
  const stage = currentStage(cv, state);
  return stage.transitions.filter(
    (t) => t.trigger !== "candidate_request" && checkReveal(cv, state, t.toStageId, caseElapsedMs, { kind: "examiner" }).ok,
  );
}

export function behaviourMode(mode: ExamMode): "exam" | "practice" {
  return mode === "practice" ? "practice" : "exam";
}

/**
 * Questions the examiner may deliver now: current stage allowlist, not yet delivered,
 * permitted in this mode, and within the prompt policy (probe limits, rescue allowance).
 */
export function eligibleQuestions(
  cv: CaseVersion,
  state: StageState,
  mode: ExamMode,
  prompting: PromptingAllowance,
): ApprovedQuestion[] {
  const stage = currentStage(cv, state);
  const bm = behaviourMode(mode);
  return stage.allowedQuestionIds
    .map((id) => getQuestion(cv, id))
    .filter((q) => !state.deliveredQuestionIds.includes(q.id))
    .filter((q) => q.modes.includes(bm))
    .filter((q) => q.purpose !== "opening" && q.purpose !== "closing")
    .filter((q) => {
      if (q.purpose === "rescue" || q.promptClass === "rescue") return prompting.allowRescue;
      if (q.purpose === "targeted_probe" || q.promptClass === "targeted_probe") {
        return q.targetElementIds.every((e) => (state.probesPerElement[e] ?? 0) < prompting.maxTargetedProbesPerElement);
      }
      return true;
    })
    .sort((a, b) => a.order - b.order);
}

export function openingQuestion(cv: CaseVersion, state: StageState): ApprovedQuestion | null {
  const stage = currentStage(cv, state);
  const ids = stage.allowedQuestionIds;
  const q = cv.questions.filter((x) => ids.includes(x.id) && x.purpose === "opening").sort((a, b) => a.order - b.order)[0];
  return q && !state.deliveredQuestionIds.includes(q.id) ? q : null;
}

/** Fact replies available now: from revealed stages; reveal replies only if still revealable. */
export function eligibleFactReplies(cv: CaseVersion, state: StageState, caseElapsedMs: number): FactReply[] {
  const out: FactReply[] = [];
  for (const stage of revealedStages(cv, state)) {
    for (const r of stage.approvedFactReplies) {
      if (out.some((x) => x.id === r.id)) continue;
      if (r.kind === "reveal") {
        if (!r.revealsStageId) continue;
        if (!checkReveal(cv, state, r.revealsStageId, caseElapsedMs, { kind: "fact_reply", replyId: r.id }).ok) continue;
      }
      out.push(r);
    }
  }
  return out;
}

export function markQuestionDelivered(cv: CaseVersion, state: StageState, questionId: string): StageState {
  if (state.deliveredQuestionIds.includes(questionId)) return state;
  const q = getQuestion(cv, questionId);
  const probes = { ...state.probesPerElement };
  if (q.purpose === "targeted_probe" || q.promptClass === "targeted_probe") {
    for (const e of q.targetElementIds) probes[e] = (probes[e] ?? 0) + 1;
  }
  return { ...state, deliveredQuestionIds: [...state.deliveredQuestionIds, questionId], probesPerElement: probes };
}

export function markFactReplyDelivered(state: StageState, replyId: string): StageState {
  return { ...state, deliveredFactReplyIds: [...state.deliveredFactReplyIds, replyId] };
}

export function recordRender(state: StageState, assetId: string, status: "rendered" | "failed", caseMs: number, error?: string): StageState {
  if (status === "rendered") {
    if (state.renderedAssets[assetId] !== undefined) return state;
    const failed = { ...state.failedAssets };
    delete failed[assetId];
    return { ...state, renderedAssets: { ...state.renderedAssets, [assetId]: caseMs }, failedAssets: failed };
  }
  if (state.renderedAssets[assetId] !== undefined) return state; // a later failure does not erase a successful render
  return { ...state, failedAssets: { ...state.failedAssets, [assetId]: error ?? "render_failed" } };
}

/** Whether required "examiner_decision" reveals remain (case should not close early). */
export function pendingRequiredReveals(cv: CaseVersion, state: StageState, caseElapsedMs: number): StageTransition[] {
  return examinerRevealOptions(cv, state, caseElapsedMs).filter((t) => t.trigger === "examiner_decision" || t.trigger === "after_question");
}
