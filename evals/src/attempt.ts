import type { CaseVersion, ExamProfileVersion, ExaminerUtterance } from "@sim/contracts";
import type { AttemptData, CandidateSegment } from "@sim/ai";
import { findFactReply, getQuestion, getStage } from "@sim/exam-engine";
import type { ResponsePattern, Turn } from "./types";

/**
 * Builds a deterministic, timed AttemptData from a scripted pattern, exactly as the worker
 * assembles one from durable records. Timing model: examiner speech ~55 ms/char, candidate
 * speech ~380 ms/word, short gaps between turns; images render 1.2–1.5 s after a reveal.
 */
export function buildAttempt(p: ResponsePattern, turns: Turn[], cv: CaseVersion, profile: ExamProfileVersion, idPrefix: string): AttemptData {
  const sessionId = `eval-session-${idPrefix}`;
  const caseAttemptId = `eval-attempt-${idPrefix}`;
  const failures = new Set(p.renderFailures ?? []);
  const stageReveals: AttemptData["stageReveals"] = [];
  const renders: AttemptData["renders"] = [];
  const segments: CandidateSegment[] = [];
  const utterances: ExaminerUtterance[] = [];
  let t = 0;
  let n = 0;

  const reveal = (stageId: string, at: number) => {
    stageReveals.push({ stageId, atMs: at });
    for (const assetId of getStage(cv, stageId).assetIds) renders.push({ assetId, status: failures.has(assetId) ? "failed" : "rendered", atMs: at + 1200 });
  };
  reveal(cv.openingStageId, 0);
  t = 2000;

  const speak = (u: Pick<ExaminerUtterance, "kind" | "refId" | "promptClass" | "text" | "targetElementIds" | "suppliesElementIds">, interruptedAtChar?: number) => {
    const played = interruptedAtChar === undefined ? u.text.length : Math.max(0, Math.min(u.text.length, interruptedAtChar));
    const dur = 400 + Math.round(played * 55);
    utterances.push({
      id: `${idPrefix}-utt-${String(++n).padStart(3, "0")}`,
      sessionId,
      caseAttemptId,
      ...u,
      plannedAtMs: t,
      playbackStartedAtMs: t,
      playbackEndedAtMs: t + dur,
      playedChars: played,
      deliveryStatus: interruptedAtChar === undefined ? "completed" : "interrupted",
      ttsProvider: "eval",
    });
    t += dur + 600;
  };

  const supplied = new Map((p.supplied ?? []).map((x) => [x.turnIndex, x.elementIds]));
  for (const [idx, turn] of turns.entries()) {
    switch (turn.kind) {
      case "candidate": {
        const words = turn.text.trim().split(/\s+/).length;
        const dur = Math.max(1200, words * 380);
        segments.push({ id: `${idPrefix}-seg-${String(++n).padStart(3, "0")}`, text: turn.text, startMs: t, endMs: t + dur, source: turn.source ?? "dev_injected", confidence: turn.confidence ?? 0.95, words: null });
        t += dur + 900;
        break;
      }
      case "question": {
        const q = getQuestion(cv, turn.questionId);
        speak({ kind: q.purpose === "opening" ? "opening" : "question", refId: q.id, promptClass: q.promptClass, text: q.text, targetElementIds: q.targetElementIds, suppliesElementIds: q.suppliesElementIds }, turn.interruptedAtChar);
        break;
      }
      case "fact_reply": {
        const found = findFactReply(cv, turn.replyId);
        if (!found) throw new Error(`${p.id}: unknown fact reply ${turn.replyId}`);
        speak({ kind: "fact_reply", refId: found.reply.id, promptClass: found.reply.promptClass, text: found.reply.replyText, targetElementIds: [], suppliesElementIds: found.reply.suppliesElementIds });
        if (found.reply.revealsStageId) reveal(found.reply.revealsStageId, t);
        break;
      }
      case "reveal": {
        const st = getStage(cv, turn.stageId);
        if (st.revealAnnouncement) speak({ kind: "reveal_announcement", refId: st.id, promptClass: "neutral", text: st.revealAnnouncement, targetElementIds: [], suppliesElementIds: [] });
        reveal(turn.stageId, t);
        break;
      }
      case "neutral": {
        const sup = supplied.get(idx);
        speak(sup ? { kind: "practice_hint", refId: turn.phraseId, promptClass: "examiner_supplied", text: turn.text, targetElementIds: sup, suppliesElementIds: sup } : { kind: "neutral", refId: turn.phraseId, promptClass: "neutral", text: turn.text, targetElementIds: [], suppliesElementIds: [] });
        break;
      }
      case "silence":
        t += turn.ms;
        break;
    }
  }
  return {
    caseAttemptId,
    sessionId,
    mode: "exam",
    profile,
    caseVersion: cv,
    caseStartedAtMs: 0,
    caseEndedAtMs: t + 1000,
    closeReason: p.endedByTechnicalFailure ? "technical_failure" : "examiner_completed",
    endedByTechnicalFailure: !!p.endedByTechnicalFailure,
    stageReveals,
    renders,
    segments,
    transcriptRevision: 0,
    utterances,
    technicalNotes: failures.size ? [`render failed: ${[...failures].join(", ")}`] : [],
    typedInput: false,
  };
}
