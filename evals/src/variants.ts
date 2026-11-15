import type { Turn, Variant } from "./types";

/**
 * Deterministic, meaning-preserving transformations of candidate speech, used to measure
 * stability under harmless rephrasing, irrelevant verbosity and ASR-style formatting noise.
 * They never change polarity, laterality, certainty or clinical content.
 */
const REPHRASE: [RegExp, string][] = [
  [/\bThere is\b/g, "I can see"],
  [/\bthere is\b/g, "I can see"],
  [/\bThere's\b/g, "I can see"],
  [/\bthere's\b/g, "I can see"],
  [/\bI would\b/g, "I'd"],
  [/\bThis is\b/g, "It's"],
  [/\bI think\b/g, "I believe"],
  [/\bshows\b/g, "demonstrates"],
];

const VERBOSE_PREFIX =
  "Thank you. I will go through this systematically, starting with the image quality and technique, then the parenchyma, the extra-axial spaces, the ventricles, the bones and the soft tissues, before giving my impression. ";
const VERBOSE_SUFFIX = " That is everything I wanted to say on this point, and I am happy to expand on any part of it.";

function asrNoise(text: string): string {
  const words = text
    .replace(/[-–]/g, " ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 2) words.splice(1, 0, "um");
  return words.join(" ");
}

export function applyVariant(turns: Turn[], variant: Variant): Turn[] {
  if (variant === "base") return turns;
  const candidateIdx = turns.map((t, i) => (t.kind === "candidate" ? i : -1)).filter((i) => i >= 0);
  const first = candidateIdx[0];
  const last = candidateIdx.at(-1);
  return turns.map((t, i) => {
    if (t.kind !== "candidate") return t;
    let text = t.text;
    if (variant === "rephrased") for (const [re, s] of REPHRASE) text = text.replace(re, s);
    if (variant === "verbose") {
      if (i === first) text = VERBOSE_PREFIX + text;
      if (i === last) text = text + VERBOSE_SUFFIX;
    }
    if (variant === "asr_noisy") return { ...t, text: asrNoise(text), confidence: Math.min(t.confidence ?? 0.95, 0.82) };
    return { ...t, text };
  });
}
