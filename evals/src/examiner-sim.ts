import { performance } from "node:perf_hooks";
import type { CaseVersion, ExamProfileVersion, ExaminerProposal } from "@sim/contracts";
import { ExaminerProposal as ExaminerProposalSchema } from "@sim/contracts";
import {
  EXAM_MODE_FORBIDDEN_WORDS,
  NEUTRAL_PHRASES,
  applyReveal,
  buildExaminerMenu,
  fallbackDecision,
  findFactReply,
  getQuestion,
  getStage,
  initialStageState,
  isMidThought,
  markFactReplyDelivered,
  markQuestionDelivered,
  neutralPhrase,
  openingQuestion,
  recordRender,
  validateProposal,
  type ConversationTurn,
  type ExaminerCommand,
  type MenuInput,
} from "@sim/exam-engine";
import { examinerPrompt, runPrompt, type LlmProvider } from "@sim/ai";
import type { ResponsePattern } from "./types";

/**
 * Drives the live examiner policy (the same menu → proposal → validation → fallback path the
 * API uses) with each pattern's candidate speech, and checks every spoken output for
 * neutrality, approval, leakage, unavailable-information handling and stage control.
 */

export type ExaminerProposerConfig = { kind: "deterministic" } | { kind: "llm"; provider: LlmProvider; model: string };

export type ExaminerOutput = { text: string; kind: string; refId: string | null; trigger: string };

export type ExaminerSimResult = {
  patternId: string;
  caseId: string;
  tags: string[];
  outputs: ExaminerOutput[];
  decisions: number;
  llmAccepted: number;
  llmRejected: number;
  fallbacks: number;
  forgedTotal: number;
  forgedRejected: number;
  neutralityViolations: string[];
  unapprovedOutputs: string[];
  leaks: { text: string; concept: string; elementId: string }[];
  unavailable: { requested: string[]; delivered: string[] };
  speechAfterMidThought: number;
  revealsOutsideTransitions: number;
  decisionLatencyMs: number[];
  examinerPromptTokens: number[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const containsPhrase = (hay: string, needle: string) => ` ${norm(hay)} `.includes(` ${norm(needle)} `);

function approvedTexts(cv: CaseVersion): Set<string> {
  const s = new Set<string>();
  for (const q of cv.questions) s.add(q.text);
  for (const st of cv.stages) {
    for (const r of st.approvedFactReplies) s.add(r.replyText);
    if (st.revealAnnouncement) s.add(st.revealAnnouncement);
  }
  for (const p of NEUTRAL_PHRASES) s.add(p.text);
  return s;
}

const FORGED: ExaminerProposal[] = [
  { action: "request_stage_reveal", ref: "R9", reason: "progression", note: "forged: unknown alias" },
  { action: "deliver_question", ref: "st-cta", reason: "progression", note: "forged: raw stage id" },
  { action: "deliver_fact_reply", ref: "Q1", reason: "candidate_requested_information", note: "forged: wrong alias kind" },
  { action: "select_series", ref: "A99", reason: "progression", note: "forged: unknown asset alias" },
];

export async function simulateExaminer(p: ResponsePattern, cv: CaseVersion, profile: ExamProfileVersion, cfg: ExaminerProposerConfig): Promise<ExaminerSimResult> {
  const approved = approvedTexts(cv);
  const failures = new Set(p.renderFailures ?? []);
  const res: ExaminerSimResult = {
    patternId: p.id,
    caseId: p.caseId,
    tags: p.tags,
    outputs: [],
    decisions: 0,
    llmAccepted: 0,
    llmRejected: 0,
    fallbacks: 0,
    forgedTotal: 0,
    forgedRejected: 0,
    neutralityViolations: [],
    unapprovedOutputs: [],
    leaks: [],
    unavailable: { requested: p.turns.flatMap((t) => (t.kind === "fact_reply" ? [t.replyId] : [])).filter((id) => findFactReply(cv, id)?.reply.kind !== "reveal"), delivered: [] },
    speechAfterMidThought: 0,
    revealsOutsideTransitions: 0,
    decisionLatencyMs: [],
    examinerPromptTokens: [],
  };
  let state = initialStageState(cv);
  let t = 0;
  const conversation: ConversationTurn[] = [];
  let candidateText = "";
  let ended = false;

  const renderStage = (stageId: string) => {
    for (const a of getStage(cv, stageId).assetIds) state = recordRender(state, a, failures.has(a) ? "failed" : "rendered", t + 1200);
  };
  renderStage(cv.openingStageId);

  const say = (o: ExaminerOutput) => {
    res.outputs.push(o);
    conversation.push({ speaker: "examiner", text: o.text, atMs: t });
    t += 400 + o.text.length * 55 + 600;
    const lower = o.text.toLowerCase();
    for (const w of EXAM_MODE_FORBIDDEN_WORDS) if (new RegExp(`\\b${w}\\b`).test(lower)) res.neutralityViolations.push(`${w}: "${o.text}"`);
    if (!approved.has(o.text)) res.unapprovedOutputs.push(o.text);
    const declaredSupplies = o.kind === "question" && o.refId ? getQuestion(cv, o.refId).suppliesElementIds : [];
    for (const el of cv.rubric.elements) {
      if (declaredSupplies.includes(el.id)) continue;
      for (const concept of [...el.acceptedConcepts, ...el.acceptableAlternatives]) {
        if (concept.length >= 6 && containsPhrase(o.text, concept) && !containsPhrase(candidateText, concept)) res.leaks.push({ text: o.text, concept, elementId: el.id });
      }
    }
  };

  const opening = openingQuestion(cv, state);
  if (opening) {
    state = markQuestionDelivered(cv, state, opening.id);
    say({ text: opening.text, kind: "opening", refId: opening.id, trigger: "case_started" });
  }

  const execute = async (cmd: ExaminerCommand, trigger: string): Promise<boolean> => {
    switch (cmd.kind) {
      case "wait":
        return false;
      case "deliver_question": {
        const q = getQuestion(cv, cmd.questionId);
        state = markQuestionDelivered(cv, state, q.id);
        say({ text: q.text, kind: "question", refId: q.id, trigger });
        return true;
      }
      case "deliver_fact_reply": {
        const f = findFactReply(cv, cmd.replyId);
        if (!f) return false;
        state = markFactReplyDelivered(state, f.reply.id);
        say({ text: f.reply.replyText, kind: "fact_reply", refId: f.reply.id, trigger });
        if (f.reply.kind !== "reveal") res.unavailable.delivered.push(f.reply.id);
        if (f.reply.revealsStageId) {
          state = applyReveal(cv, state, f.reply.revealsStageId);
          renderStage(f.reply.revealsStageId);
          await decide("images_rendered");
        }
        return true;
      }
      case "say_neutral":
        say({ text: neutralPhrase(cmd.phraseId).text, kind: "neutral", refId: cmd.phraseId, trigger });
        return true;
      case "request_stage_reveal": {
        const st = getStage(cv, cmd.stageId);
        state = applyReveal(cv, state, cmd.stageId);
        if (st.revealAnnouncement) say({ text: st.revealAnnouncement, kind: "reveal_announcement", refId: st.id, trigger });
        renderStage(cmd.stageId);
        await decide("images_rendered");
        return true;
      }
      case "advance_case":
        ended = true;
        return true;
      default:
        return false;
    }
  };

  async function decide(trigger: MenuInput["trigger"], explicitEndTurn = false): Promise<boolean> {
    if (ended) return false;
    const lastCandidate = [...conversation].reverse().find((x) => x.speaker === "candidate");
    const input: MenuInput = {
      cv,
      state,
      mode: "exam",
      prompting: profile.prompting.exam,
      trigger,
      timing: { stationElapsedMs: t, stationRemainingMs: Math.max(0, profile.station.durationSeconds * 1000 - t), caseElapsedMs: t, caseTimeGuidanceMs: null, isLastCase: true },
      conversation,
      secondsSinceCandidateSpoke: lastCandidate ? Math.round((t - lastCandidate.atMs) / 1000) : null,
      hasCandidateSpokenInCase: !!lastCandidate,
      explicitEndTurn,
    };
    const menu = buildExaminerMenu(input);
    res.decisions++;
    for (const f of FORGED) {
      res.forgedTotal++;
      if (!validateProposal(menu, f).ok) res.forgedRejected++;
    }
    const started = performance.now();
    let command: ExaminerCommand | null = null;
    if (cfg.kind === "llm") {
      const rendered = examinerPrompt.render(examinerPrompt.inputSchema.parse(menu.context));
      res.examinerPromptTokens.push(Math.round((rendered.system.length + rendered.user.length) / 3.8));
      const r = await runPrompt(examinerPrompt, menu.context, { routing: { provider: cfg.provider, model: cfg.model, timeoutMs: 8000 } });
      if (r.ok) {
        const parsed = ExaminerProposalSchema.safeParse({ ...r.data, note: r.data.note.slice(0, 200) });
        const v = parsed.success ? validateProposal(menu, parsed.data) : null;
        if (v?.ok) {
          command = v.command;
          res.llmAccepted++;
        } else res.llmRejected++;
      } else res.llmRejected++;
    } else {
      const rendered = examinerPrompt.render(examinerPrompt.inputSchema.parse(menu.context));
      res.examinerPromptTokens.push(Math.round((rendered.system.length + rendered.user.length) / 3.8));
    }
    if (!command) {
      const fb = fallbackDecision(menu, input);
      const v = validateProposal(menu, fb.proposal);
      command = v.ok ? v.command : { kind: "wait" };
      res.fallbacks++;
    }
    res.decisionLatencyMs.push(Math.round((performance.now() - started) * 100) / 100);
    if (command.kind === "request_stage_reveal" && !menu.entries.size) res.revealsOutsideTransitions++;
    return execute(command, trigger);
  }

  const candidateTurns = p.turns.map((x, i) => ({ x, i })).filter(({ x }) => x.kind === "candidate");
  for (const [k, { x, i }] of candidateTurns.entries()) {
    if (ended || x.kind !== "candidate") break;
    conversation.push({ speaker: "candidate", text: x.text, atMs: t });
    candidateText += ` ${x.text}`;
    t += Math.max(1200, x.text.split(/\s+/).length * 380) + 900;
    const next = p.turns[i + 1];
    const endOfBlock = !next || next.kind !== "candidate" || k === candidateTurns.length - 1;
    const spoke = await decide("candidate_turn_ended", endOfBlock);
    if (spoke && !endOfBlock && isMidThought(x.text)) res.speechAfterMidThought++;
  }
  for (let n = 0; n < 4 && !ended; n++) await decide("extended_silence");
  return res;
}
