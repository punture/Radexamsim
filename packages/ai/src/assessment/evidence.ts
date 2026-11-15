import type { EvidenceSpan } from "@sim/contracts";

/**
 * Programmatic validation of evidence spans (spec §10): every quote must be a real
 * substring of a candidate transcript segment. Small offset errors are repaired (and
 * recorded); quotes that cannot be found are rejected — never accepted on trust.
 */

export type CandidateSegment = {
  id: string;
  text: string;
  /** Session-clock milliseconds. */
  startMs: number;
  endMs: number;
  source: string;
  confidence: number | null;
  words: { text: string; startMs: number; endMs: number; confidence: number | null }[] | null;
};

export type SpanCheck =
  | { ok: true; span: EvidenceSpan; repaired: boolean; repairNote: string | null }
  | { ok: false; reason: "unknown_segment" | "empty_quote" | "quote_not_found" | "ambiguous_quote" };

function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        norm += " ";
        map.push(i);
        lastSpace = true;
      }
      continue;
    }
    norm += ch.toLowerCase();
    map.push(i);
    lastSpace = false;
  }
  return { norm, map };
}

function trimQuote(q: string): string {
  return q.trim().replace(/^["'“”‘’.,;:]+|["'“”‘’.,;:]+$/g, "").trim();
}

function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

function findInSegment(seg: CandidateSegment, quote: string, preferredStart: number): { start: number; end: number; note: string } | null {
  const exact = occurrences(seg.text, quote);
  if (exact.length > 0) {
    const start = exact.reduce((best, s) => (Math.abs(s - preferredStart) < Math.abs(best - preferredStart) ? s : best));
    return { start, end: start + quote.length, note: "offsets corrected" };
  }
  const q = trimQuote(quote);
  if (q.length === 0) return null;
  const { norm, map } = normalizeWithMap(seg.text);
  const nq = normalizeWithMap(q).norm;
  const hits = occurrences(norm, nq);
  if (hits.length === 0) return null;
  const startN = hits.reduce((best, s) => (Math.abs(map[s]! - preferredStart) < Math.abs(map[best]! - preferredStart) ? s : best));
  const start = map[startN]!;
  const end = map[startN + nq.length - 1]! + 1;
  return { start, end, note: "whitespace/case normalized" };
}

export function validateSpan(span: { segmentId: string; charStart: number; charEnd: number; quote: string }, segments: ReadonlyMap<string, CandidateSegment>): SpanCheck {
  if (!span.quote || span.quote.trim().length === 0) return { ok: false, reason: "empty_quote" };
  const seg = segments.get(span.segmentId);
  if (seg && span.charStart >= 0 && span.charEnd <= seg.text.length && span.charStart < span.charEnd && seg.text.slice(span.charStart, span.charEnd) === span.quote) {
    return { ok: true, span: { ...span }, repaired: false, repairNote: null };
  }
  if (seg) {
    const found = findInSegment(seg, span.quote, span.charStart);
    if (found) {
      return {
        ok: true,
        span: { segmentId: seg.id, charStart: found.start, charEnd: found.end, quote: seg.text.slice(found.start, found.end) },
        repaired: true,
        repairNote: found.note,
      };
    }
  }
  // The quote may have been attributed to the wrong segment: accept only a unique match.
  const matches: { seg: CandidateSegment; start: number; end: number }[] = [];
  for (const s of segments.values()) {
    const f = findInSegment(s, span.quote, 0);
    if (f) matches.push({ seg: s, start: f.start, end: f.end });
  }
  if (matches.length === 1) {
    const m = matches[0]!;
    return { ok: true, span: { segmentId: m.seg.id, charStart: m.start, charEnd: m.end, quote: m.seg.text.slice(m.start, m.end) }, repaired: true, repairNote: "segment reattributed (unique match)" };
  }
  if (matches.length > 1) return { ok: false, reason: "ambiguous_quote" };
  return { ok: false, reason: seg ? "quote_not_found" : "unknown_segment" };
}

/** Best estimate of when the quoted words were spoken (session-clock ms). */
export function spanTimeMs(span: EvidenceSpan, segments: ReadonlyMap<string, CandidateSegment>): number {
  const seg = segments.get(span.segmentId);
  if (!seg) return Number.POSITIVE_INFINITY;
  if (seg.words && seg.words.length > 0) {
    // Map the character offset to the word that contains it.
    let pos = 0;
    for (const w of seg.words) {
      const idx = seg.text.indexOf(w.text, pos);
      if (idx < 0) continue;
      if (idx + w.text.length > span.charStart) return w.startMs;
      pos = idx + w.text.length;
    }
  }
  const frac = seg.text.length > 0 ? span.charStart / seg.text.length : 0;
  return Math.round(seg.startMs + frac * Math.max(0, seg.endMs - seg.startMs));
}
