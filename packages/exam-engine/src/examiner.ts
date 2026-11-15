import type {
  CaseVersion,
  ExamMode,
  ExaminerContext,
  ExaminerProposal,
  PromptingAllowance,
  StageState,
} from "@sim/contracts";
import { NEUTRAL_PHRASES, type NeutralPhraseId } from "./phrases";
import {
  behaviourMode,
  currentStage,
  cumulativeHistory,
  disclosedAssetIds,
  eligibleFactReplies,
  eligibleQuestions,
  examinerRevealOptions,
  pendingRequiredReveals,
} from "./stage-graph";

/**
 * The examiner proposes; validated application code executes (spec §7). This module builds
 * the per-turn action menu (with per-call aliases so the model can only pick what it was
 * shown), projects the examiner DTO, validates proposals, and implements the deterministic
 * fallback policy used when the model is unavailable, slow, or returns an invalid action.
 */

export type ExaminerCommand =
  | { kind: "wait" }
  | { kind: "deliver_question"; questionId: string }
  | { kind: "deliver_fact_reply"; replyId: string }
  | { kind: "say_neutral"; phraseId: NeutralPhraseId }
  | { kind: "request_stage_reveal"; stageId: string }
  | { kind: "set_viewport"; presetId: string }
  | { kind: "select_series"; assetId: string }
  | { kind: "advance_case"; skippedQuestionIds: string[] };

type MenuEntry =
  | { kind: "question"; questionId: string }
  | { kind: "fact_reply"; replyId: string }
  | { kind: "neutral"; phraseId: NeutralPhraseId }
  | { kind: "reveal"; stageId: string }
  | { kind: "viewport"; presetId: string }
  | { kind: "series"; assetId: string };

export type ConversationTurn = { speaker: "examiner" | "candidate"; text: string; atMs: number };

export type MenuInput = {
  cv: CaseVersion;
  state: StageState;
  mode: ExamMode;
  prompting: PromptingAllowance;
  trigger: ExaminerContext["trigger"];
  timing: {
    stationElapsedMs: number;
    stationRemainingMs: number;
    caseElapsedMs: number;
    caseTimeGuidanceMs: number | null;
    isLastCase: boolean;
  };
  /** Current case only. Examiner turns contain only the text actually heard. */
  conversation: ConversationTurn[];
  secondsSinceCandidateSpoke: number | null;
  hasCandidateSpokenInCase: boolean;
  /** Set when the candidate pressed "end turn" / push-to-talk release. */
  explicitEndTurn: boolean;
};

export type ExaminerMenu = {
  entries: Map<string, MenuEntry>;
  canAdvanceCase: boolean;
  /** Remaining standard questions that may be skipped as already addressed. */
  skippableRemaining: string[];
  /** Remaining standard questions that must be asked before closing (unless time-limited). */
  mandatoryRemaining: string[];
  timeLimited: boolean;
  context: ExaminerContext;
};

const MAX_CONVERSATION_TURNS = 24;
const MAX_CONVERSATION_CHARS = 6000;

function trimConversation(turns: ConversationTurn[]): ConversationTurn[] {
  const out: ConversationTurn[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0 && out.length < MAX_CONVERSATION_TURNS; i--) {
    const t = turns[i]!;
    chars += t.text.length;
    if (chars > MAX_CONVERSATION_CHARS && out.length > 0) break;
    out.unshift(t);
  }
  return out;
}

export function buildExaminerMenu(input: MenuInput): ExaminerMenu {
  const { cv, state, mode, prompting, timing } = input;
  const stage = currentStage(cv, state);
  const entries = new Map<string, MenuEntry>();
  const bm = behaviourMode(mode);

  const questions = eligibleQuestions(cv, state, mode, prompting);
  questions.forEach((q, i) => entries.set(`Q${i + 1}`, { kind: "question", questionId: q.id }));

  const replies = eligibleFactReplies(cv, state, timing.caseElapsedMs);
  replies.forEach((r, i) => entries.set(`F${i + 1}`, { kind: "fact_reply", replyId: r.id }));

  const phrases = NEUTRAL_PHRASES.filter((p) => p.selectableByModel && p.modes.includes(mode));
  phrases.forEach((p, i) => entries.set(`N${i + 1}`, { kind: "neutral", phraseId: p.id }));

  const reveals = examinerRevealOptions(cv, state, timing.caseElapsedMs);
  reveals.forEach((t, i) => entries.set(`R${i + 1}`, { kind: "reveal", stageId: t.toStageId }));

  const presets = stage.viewportPresetIds
    .map((id) => cv.viewportPresets.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    // Lesion-framing presets can act as hints; never offered in exam mode.
    .filter((p) => bm === "practice" || !p.containsLesionCue);
  if (stage.allowedActions.includes("examiner.set_viewport")) {
    presets.forEach((p, i) => entries.set(`V${i + 1}`, { kind: "viewport", presetId: p.id }));
  }

  const assets = disclosedAssetIds(cv, state).map((id) => cv.assets.find((a) => a.id === id)!);
  if (stage.allowedActions.includes("examiner.select_series")) {
    assets.forEach((a, i) => entries.set(`A${i + 1}`, { kind: "series", assetId: a.id }));
  }

  const standardRemaining = questions.filter((q) => q.purpose === "standard");
  const skippableRemaining = standardRemaining.filter((q) => q.skipIfAlreadyAddressed !== null).map((q) => q.id);
  const mandatoryRemaining = standardRemaining.filter((q) => q.skipIfAlreadyAddressed === null).map((q) => q.id);
  const guidanceExceeded = timing.caseTimeGuidanceMs !== null && timing.caseElapsedMs >= timing.caseTimeGuidanceMs;
  const timeLimited = guidanceExceeded || timing.stationRemainingMs <= 15_000;
  const pendingReveals = pendingRequiredReveals(cv, state, timing.caseElapsedMs);
  const canAdvanceCase =
    stage.allowedActions.includes("examiner.advance_case") &&
    input.hasCandidateSpokenInCase &&
    (timeLimited || (mandatoryRemaining.length === 0 && pendingReveals.length === 0));

  const context: ExaminerContext = {
    mode,
    trigger: input.trigger,
    timing: {
      stationElapsedSeconds: Math.floor(timing.stationElapsedMs / 1000),
      stationRemainingSeconds: Math.floor(timing.stationRemainingMs / 1000),
      caseElapsedSeconds: Math.floor(timing.caseElapsedMs / 1000),
      caseTimeGuidanceSeconds: timing.caseTimeGuidanceMs === null ? null : Math.floor(timing.caseTimeGuidanceMs / 1000),
      isLastCase: timing.isLastCase,
    },
    stage: {
      ordinal: state.revealedStageIds.length,
      candidateHistory: cumulativeHistory(cv, state).join("\n"),
      examinerNotes: stage.examinerNotes,
      visibleImages: assets.map((a, i) => ({ ref: `A${i + 1}`, description: a.neutralLabel })),
    },
    questions: questions.map((q, i) => ({
      ref: `Q${i + 1}`,
      text: q.text,
      purpose: q.purpose,
      skipIfAlreadyAddressed: q.skipIfAlreadyAddressed,
      alreadyAsked: false,
    })),
    factReplies: replies.map((r, i) => ({
      ref: `F${i + 1}`,
      answersRequest: r.triggerDescription,
      revealsNewImages: r.kind === "reveal",
    })),
    neutralPhrases: phrases.map((p, i) => ({ ref: `N${i + 1}`, purpose: p.purpose, text: p.text })),
    revealOptions: reveals.map((t, i) => ({ ref: `R${i + 1}`, description: t.description })),
    viewportOptions: stage.allowedActions.includes("examiner.set_viewport")
      ? presets.map((p, i) => ({ ref: `V${i + 1}`, description: `${p.layout} layout` }))
      : [],
    canAdvanceCase,
    conversation: trimConversation(input.conversation).map((t) => ({
      speaker: t.speaker,
      text: t.text,
      atSeconds: Math.floor(t.atMs / 1000),
    })),
    secondsSinceCandidateSpoke: input.secondsSinceCandidateSpoke,
  };

  return { entries, canAdvanceCase, skippableRemaining, mandatoryRemaining, timeLimited, context };
}

export type ProposalValidation = { ok: true; command: ExaminerCommand } | { ok: false; reason: string };

const ACTION_PREFIX: Record<string, MenuEntry["kind"]> = {
  deliver_question: "question",
  deliver_fact_reply: "fact_reply",
  say_neutral: "neutral",
  request_stage_reveal: "reveal",
  set_viewport: "viewport",
  select_series: "series",
};

/** Validate a model proposal against the menu it was shown. Never trusts model ids. */
export function validateProposal(menu: ExaminerMenu, proposal: ExaminerProposal): ProposalValidation {
  if (proposal.action === "wait") return { ok: true, command: { kind: "wait" } };
  if (proposal.action === "advance_case") {
    if (!menu.canAdvanceCase) {
      // Allow closing early only when every remaining question is authored as skippable.
      return { ok: false, reason: "advance_not_permitted_yet" };
    }
    return { ok: true, command: { kind: "advance_case", skippedQuestionIds: menu.skippableRemaining } };
  }
  const expected = ACTION_PREFIX[proposal.action];
  if (!expected) return { ok: false, reason: "unknown_action" };
  if (!proposal.ref) return { ok: false, reason: "missing_ref" };
  const entry = menu.entries.get(proposal.ref);
  if (!entry) return { ok: false, reason: "ref_not_in_menu" };
  if (entry.kind !== expected) return { ok: false, reason: "ref_type_mismatch" };
  switch (entry.kind) {
    case "question":
      return { ok: true, command: { kind: "deliver_question", questionId: entry.questionId } };
    case "fact_reply":
      return { ok: true, command: { kind: "deliver_fact_reply", replyId: entry.replyId } };
    case "neutral":
      return { ok: true, command: { kind: "say_neutral", phraseId: entry.phraseId } };
    case "reveal":
      return { ok: true, command: { kind: "request_stage_reveal", stageId: entry.stageId } };
    case "viewport":
      return { ok: true, command: { kind: "set_viewport", presetId: entry.presetId } };
    case "series":
      return { ok: true, command: { kind: "select_series", assetId: entry.assetId } };
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallback policy
// ---------------------------------------------------------------------------

const COMPLETION_CUES =
  /\b(that'?s (all|it|everything)|nothing (further|else|more)|i'?m (done|finished)|that is (all|it|my answer)|no further (comments?|findings|thoughts)|that completes|end of (my )?(report|answer|presentation)|i have nothing (further|else|more))\b/i;
const MID_THOUGHT_CUES = /\b(and|um+|uh+|er+|so|also|then|with|the|of|in|which|or)\s*[,.]?\s*$/i;
const REQUEST_CUES =
  /\b(can i|could i|may i|could we|can we|is there|are there|do we have|do you have|have we|i would like|i'?d like|i'?d want|please show|show me|any (prior|previous|old|comparison)|is a .* available|are .* available|what (is|was|are)|what'?s)\b/i;

export function isCompletionUtterance(text: string): boolean {
  return COMPLETION_CUES.test(text);
}

export function isMidThought(text: string): boolean {
  return MID_THOUGHT_CUES.test(text.trim());
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s'?-]/g, " ").replace(/\s+/g, " ").trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (p.length === 0) return false;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$|\\?)`).test(haystack);
}

/** Match a request for information to an approved fact reply (dialogue routing only). */
export function matchFactReply(cv: CaseVersion, menu: ExaminerMenu, utterance: string): string | null {
  const sentences = utterance.split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const isRequest = sentence.includes("?") || REQUEST_CUES.test(sentence);
    if (!isRequest) continue;
    const norm = normalize(sentence);
    // Prefer reveal replies, then information, then unavailable.
    const rank = { reveal: 0, information: 1, unavailable: 2 } as const;
    const matches: { ref: string; kind: keyof typeof rank }[] = [];
    for (const [ref, entry] of menu.entries) {
      if (entry.kind !== "fact_reply") continue;
      const found = cv.stages.flatMap((s) => s.approvedFactReplies).find((r) => r.id === entry.replyId);
      if (found && found.triggerPatterns.some((p) => containsPhrase(norm, p))) matches.push({ ref, kind: found.kind });
    }
    matches.sort((a, b) => rank[a.kind] - rank[b.kind]);
    if (matches[0]) return matches[0].ref;
  }
  return null;
}

function questionAddressed(cv: CaseVersion, questionId: string, candidateCaseText: string): boolean {
  const q = cv.questions.find((x) => x.id === questionId);
  if (!q || q.skipIfAlreadyAddressed === null) return false;
  const norm = normalize(candidateCaseText);
  return q.addressedPatterns.some((p) => containsPhrase(norm, p));
}

export type FallbackDecision = { proposal: ExaminerProposal; note: string };

/**
 * Deterministic examiner policy. Conservative: waits on ambiguous pauses, asks authored
 * questions in order, honours candidate requests through approved replies only.
 */
export function fallbackDecision(menu: ExaminerMenu, input: MenuInput): FallbackDecision {
  const turns = input.conversation;
  const lastCandidate = [...turns].reverse().find((t) => t.speaker === "candidate");
  const lastExaminerIdx = turns.map((t) => t.speaker).lastIndexOf("examiner");
  const candidateSinceExaminer = turns.slice(lastExaminerIdx + 1).filter((t) => t.speaker === "candidate");
  const saidSomethingSincePrompt = candidateSinceExaminer.some((t) => t.text.trim().split(/\s+/).length >= 3);
  const lastExaminer = lastExaminerIdx >= 0 ? turns[lastExaminerIdx] : undefined;
  const candidateCaseText = turns.filter((t) => t.speaker === "candidate").map((t) => t.text).join(" ");
  const wait = (note: string): FallbackDecision => ({ proposal: { action: "wait", ref: null, reason: "candidate_still_thinking", note }, note });

  // 1) Honour a request for information through an approved reply.
  if (lastCandidate && input.trigger === "candidate_turn_ended") {
    const ref = matchFactReply(input.cv, menu, lastCandidate.text);
    if (ref) return { proposal: { action: "deliver_fact_reply", ref, reason: "candidate_requested_information", note: "matched approved trigger" }, note: "fact reply" };
  }

  // 2) Time management.
  if (menu.timeLimited && menu.canAdvanceCase) {
    return { proposal: { action: "advance_case", ref: null, reason: "time_management", note: "case time guidance reached" }, note: "time" };
  }

  if (input.trigger === "time_check") return wait("time check only");

  const finished =
    input.explicitEndTurn || (lastCandidate !== undefined && isCompletionUtterance(lastCandidate.text));

  if (input.trigger === "candidate_turn_ended" && !finished) {
    return wait(lastCandidate && isMidThought(lastCandidate.text) ? "mid-thought pause" : "ordinary pause");
  }

  if (input.trigger === "extended_silence" && !finished && !saidSomethingSincePrompt) {
    // Offer one neutral "take your time" before moving on.
    const alreadyOffered = lastExaminer && /take your time/i.test(lastExaminer.text);
    if (!alreadyOffered) {
      const ref = [...menu.entries].find(([, e]) => e.kind === "neutral" && e.phraseId === "n_take_your_time")?.[0];
      if (ref) return { proposal: { action: "say_neutral", ref, reason: "candidate_still_thinking", note: "extended silence" }, note: "take your time" };
    }
  }

  // 3) Next authored question (skipping skippable ones already addressed).
  for (const [ref, entry] of menu.entries) {
    if (entry.kind !== "question") continue;
    const q = input.cv.questions.find((x) => x.id === entry.questionId)!;
    if (q.purpose !== "standard") continue;
    if (questionAddressed(input.cv, q.id, candidateCaseText)) continue;
    return { proposal: { action: "deliver_question", ref, reason: "progression", note: `next standard question ${q.order}` }, note: "standard question" };
  }

  // 4) Required examiner reveal.
  const reveal = [...menu.entries].find(([, e]) => e.kind === "reveal");
  if (reveal) return { proposal: { action: "request_stage_reveal", ref: reveal[0], reason: "progression", note: "authored reveal" }, note: "reveal" };

  // 5) Targeted probes for topics not yet addressed (within prompt policy limits).
  for (const [ref, entry] of menu.entries) {
    if (entry.kind !== "question") continue;
    const q = input.cv.questions.find((x) => x.id === entry.questionId)!;
    if (q.purpose !== "targeted_probe") continue;
    const norm = normalize(candidateCaseText);
    if (q.addressedPatterns.length > 0 && q.addressedPatterns.some((p) => containsPhrase(norm, p))) continue;
    return { proposal: { action: "deliver_question", ref, reason: "required_probe", note: "authored probe for unaddressed topic" }, note: "probe" };
  }

  // 6) Close the case.
  if (menu.canAdvanceCase) {
    return { proposal: { action: "advance_case", ref: null, reason: "candidate_finished_topic", note: "no remaining questions" }, note: "advance" };
  }
  return wait("nothing permitted");
}
