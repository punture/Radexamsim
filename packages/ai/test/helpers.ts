import type { ExaminerUtterance } from "@sim/contracts";
import { ABR_NEURO_PROFILE } from "@sim/clinical-content";
import { loadFixtureCase } from "@sim/fixtures";
import type { AttemptData } from "../src";

export const stroke = loadFixtureCase("fx-stroke-lmca");

let n = 0;
export function seg(text: string, startMs: number, confidence: number | null = 0.95) {
  n++;
  return { id: `seg-${String(n).padStart(4, "0")}-aaaaaaaa`, text, startMs, endMs: startMs + Math.max(1000, text.length * 60), source: "dev_injected", confidence, words: null };
}

export function utterance(p: Partial<ExaminerUtterance> & Pick<ExaminerUtterance, "text">): ExaminerUtterance {
  n++;
  return {
    id: `utt-${n}-bbbbbbbb`,
    sessionId: "session-00000001",
    caseAttemptId: "attempt-00000001",
    kind: "question",
    refId: null,
    promptClass: "standard_question",
    targetElementIds: [],
    suppliesElementIds: [],
    plannedAtMs: 0,
    playbackStartedAtMs: 0,
    playbackEndedAtMs: 2000,
    playedChars: p.text.length,
    deliveryStatus: "completed",
    ttsProvider: "mock",
    ...p,
  };
}

/** A stroke-fixture attempt: CT rendered at 1.5 s; optional CTA reveal. */
export function attempt(segments: ReturnType<typeof seg>[], over: Partial<AttemptData> = {}): AttemptData {
  return {
    caseAttemptId: "attempt-00000001",
    sessionId: "session-00000001",
    mode: "exam",
    profile: ABR_NEURO_PROFILE,
    caseVersion: stroke,
    caseStartedAtMs: 0,
    caseEndedAtMs: 300_000,
    closeReason: "examiner_completed",
    endedByTechnicalFailure: false,
    stageReveals: [{ stageId: "st-ct", atMs: 0 }],
    renders: [{ assetId: "ct-noncon", status: "rendered", atMs: 1500 }],
    segments,
    transcriptRevision: 0,
    utterances: [],
    technicalNotes: [],
    typedInput: false,
    ...over,
  };
}
