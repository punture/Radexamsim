import type { CaseVersion, OpportunityRecord, RubricElement } from "@sim/contracts";
import type { AssessorLlmOutput } from "../prompts/assessment";
import type { CandidateSegment } from "./evidence";

/**
 * DEVELOPMENT BASELINE ASSESSOR — NOT A CLINICAL ASSESSMENT.
 *
 * A deterministic lexical matcher used only when no assessment model is configured, so the
 * full pipeline (evidence spans, opportunities, feedback, plans) can run in local
 * development and automated tests. It handles negation polarity, laterality and simple
 * self-correction, but it is NOT semantic understanding and must never be used for
 * learner-facing results in production (the API refuses this configuration).
 */

const NEGATION = /\b(no|not|without|absent|absence of|negative for|never|none|nor|isn't|aren't|doesn't|don't|cannot|can't|unremarkable)\b/i;
const HEDGE = /\b(maybe|perhaps|possibly|possible|might|could be|consider|query|questionable|uncertain|not sure|i think)\b|\?/i;
const STOP = new Set(["the", "and", "with", "for", "this", "that", "from", "into", "onto", "are", "was", "were", "has", "have", "states", "state", "describes", "places", "gives", "case", "candidate", "there", "their", "which", "would", "should"]);
const SIDES = ["left", "right"] as const;

type Sentence = { segmentId: string; start: number; end: number; text: string; lower: string; timeMs: number };

function sentencesOf(segments: CandidateSegment[]): Sentence[] {
  const out: Sentence[] = [];
  for (const seg of segments) {
    const re = /[^.!?;\n]+[.!?;]?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg.text))) {
      const raw = m[0];
      const lead = raw.length - raw.trimStart().length;
      const text = raw.trim();
      if (!text) continue;
      const start = m.index + lead;
      const frac = seg.text.length ? start / seg.text.length : 0;
      out.push({ segmentId: seg.id, start, end: start + text.length, text, lower: text.toLowerCase(), timeMs: Math.round(seg.startMs + frac * (seg.endMs - seg.startMs)) });
    }
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

function stem(w: string): string {
  return w.length > 6 ? w.slice(0, 6) : w;
}

function tokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => (t.length >= 3 || /\d/.test(t)) && !STOP.has(t) && !NEGATION.test(t) && !SIDES.includes(t as "left"))
    .map(stem);
}

function sentenceTokens(s: Sentence): Set<string> {
  return new Set(s.lower.replace(/[^a-z0-9 -]/g, " ").split(/[\s-]+/).filter(Boolean).map(stem));
}

function phraseMatch(phrase: string, s: Sentence): boolean {
  const pt = tokens(phrase);
  if (pt.length === 0) return false;
  const st = sentenceTokens(s);
  const hits = pt.filter((t) => st.has(t) || [...st].some((x) => x.startsWith(t) || t.startsWith(x) && x.length >= 4)).length;
  return hits / pt.length >= (pt.length <= 2 ? 1 : 0.6);
}

function sideOf(text: string): "left" | "right" | null {
  const l = /\bleft\b/i.test(text);
  const r = /\bright\b/i.test(text);
  return l && !r ? "left" : r && !l ? "right" : null;
}

function requiredSide(el: RubricElement): "left" | "right" | null {
  const sides = [el.construct, ...el.acceptedConcepts].map(sideOf).filter(Boolean);
  return sides.length ? (sides[0] as "left" | "right") : null;
}

export function baselineAssess(cv: CaseVersion, segments: CandidateSegment[], opportunities: OpportunityRecord[], caseStartedAtMs: number): AssessorLlmOutput {
  const sentences = sentencesOf(segments);
  const judgments: AssessorLlmOutput["elementJudgments"] = [];
  const unsafeFlags: AssessorLlmOutput["unsafeFlags"] = [];

  for (const el of cv.rubric.elements) {
    const opp = opportunities.find((o) => o.elementId === el.id)!;
    const side = requiredSide(el);
    const openAt = opp.assetsRenderedAtMs === null ? null : caseStartedAtMs + opp.assetsRenderedAtMs;
    const eligible = sentences.filter((s) => openAt === null || s.timeMs >= openAt - 500);
    let positive: Sentence | null = null;
    let wrong: { s: Sentence; criterion: string | null } | null = null;
    for (const s of eligible) {
      const conceptHit = [...el.acceptedConcepts, ...el.acceptableAlternatives].find((c) => phraseMatch(c, s));
      if (conceptHit) {
        const conceptNegated = NEGATION.test(conceptHit);
        const sentenceNegated = NEGATION.test(s.lower);
        const sSide = sideOf(s.text);
        if (conceptNegated !== sentenceNegated) {
          wrong = { s, criterion: null };
        } else if (side && sSide && sSide !== side) {
          wrong = { s, criterion: el.incorrectOrUnsafeClaims.find((c) => /side|hemisphere|left|right/i.test(c)) ?? null };
        } else {
          positive = s; // later correct statements override earlier errors (self-correction)
        }
      }
      const claim = el.incorrectOrUnsafeClaims.find((c) => phraseMatch(c, s) && !(conceptHit && !wrong));
      if (claim && !conceptHit) wrong = { s, criterion: claim };
    }
    const span = (s: Sentence) => ({ segmentId: s.segmentId, charStart: s.start, charEnd: s.end, quote: s.text });
    if (positive && (!wrong || wrong.s.timeMs < positive.timeMs)) {
      judgments.push({
        elementId: el.id,
        status: "demonstrated",
        promptingLevel: null,
        evidence: [span(positive)],
        opportunityId: opp.id,
        selfCorrection: wrong ? { initial: span(wrong.s), correction: span(positive) } : null,
        rationale: wrong ? "Initial statement was corrected; the corrected statement matches an accepted concept (lexical baseline)." : "Statement matches an accepted concept (lexical baseline).",
        uncertaintyReason: null,
      });
    } else if (wrong) {
      const hedged = HEDGE.test(wrong.s.lower);
      judgments.push({ elementId: el.id, status: hedged ? "uncertain" : "incorrect", promptingLevel: null, evidence: [span(wrong.s)], opportunityId: opp.id, selfCorrection: null, rationale: hedged ? "Tentative statement conflicts with the expected concept (lexical baseline)." : "Statement conflicts with the expected concept (negation or laterality) — lexical baseline.", uncertaintyReason: hedged ? "tentative wording" : null });
      if (wrong.criterion && !hedged) {
        unsafeFlags.push({ elementId: el.id, criterion: wrong.criterion, evidence: [span(wrong.s)], context: "Detected by lexical baseline.", consequence: "May lead to inappropriate management.", committed: true, correctedLater: false });
      }
    } else {
      judgments.push({
        elementId: el.id,
        status: opp.assessable ? "not_demonstrated" : "not_assessable",
        promptingLevel: null,
        evidence: [],
        opportunityId: opp.id,
        selfCorrection: null,
        rationale: opp.assessable ? "No statement matching an accepted concept was found after the opportunity opened (lexical baseline)." : opp.description,
        uncertaintyReason: null,
      });
    }
  }
  return {
    elementJudgments: judgments,
    unsafeFlags,
    domainRatings: [],
    globalRating: { level: null, rationale: "Development baseline: rating derived deterministically from element results." },
    abstained: false,
    abstentionReason: null,
  };
}
