import type { TtsAlignment } from "./types";

/**
 * What the learner could have heard (spec §9): credit and assistance depend on the played
 * portion of an examiner utterance, not the full intended sentence.
 */

/** Characters fully played by `playedMs`, from provider alignment. */
export function playedCharsFromAlignment(alignment: TtsAlignment, playedMs: number): number {
  let n = 0;
  for (let i = 0; i < alignment.chars.length; i++) {
    if ((alignment.endMs[i] ?? Number.POSITIVE_INFINITY) <= playedMs) n = i + 1;
    else break;
  }
  return n;
}

/**
 * Conservative estimate when no alignment exists: proportional to audio played, rounded
 * DOWN to the last complete word so partially played words are not counted.
 */
export function playedCharsProportional(text: string, playedMs: number, durationMs: number | null): number {
  if (!durationMs || durationMs <= 0) return 0;
  if (playedMs >= durationMs) return text.length;
  const raw = Math.floor((text.length * Math.max(0, playedMs)) / durationMs);
  const lastSpace = text.lastIndexOf(" ", raw);
  return lastSpace <= 0 ? 0 : lastSpace;
}

/** Browser speechSynthesis boundary events report the char index of the word being spoken. */
export function playedCharsFromBoundary(text: string, boundaryCharIndex: number, completed: boolean): number {
  if (completed) return text.length;
  // The word at boundaryCharIndex has started but may not have finished: count up to it.
  return Math.max(0, Math.min(text.length, boundaryCharIndex));
}
