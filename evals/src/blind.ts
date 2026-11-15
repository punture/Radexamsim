import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CaseVersion, RatingLevel } from "@sim/contracts";
import { getQuestion, findFactReply, getStage } from "@sim/exam-engine";
import { EVALS_DIR, splitForFamily } from "./suites";
import { mulberry32 } from "./stats";
import type { ResponsePattern } from "./types";
import type { OwnerReference } from "./metrics";

/**
 * Blind owner rating (spec §18): the owner rates a locked sample WITHOUT seeing any AI
 * result or intended label; selected items reappear later under new labels to measure the
 * owner's own consistency. The packet is a self-contained offline HTML form; the answer key
 * is stored separately and only joined on import.
 */
const PACKETS = path.join(EVALS_DIR, "owner-ratings", "packets");
const RATINGS = path.join(EVALS_DIR, "owner-ratings", "ratings");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function transcript(p: ResponsePattern, cv: CaseVersion): { who: string; text: string }[] {
  return p.turns.flatMap((t) => {
    switch (t.kind) {
      case "candidate":
        return [{ who: "Candidate", text: t.text + (t.confidence !== undefined && t.confidence < 0.6 ? "  [low recognition confidence]" : "") }];
      case "question": {
        const q = getQuestion(cv, t.questionId);
        return [{ who: "Examiner", text: t.interruptedAtChar !== undefined ? `${q.text.slice(0, t.interruptedAtChar)}— [interrupted]` : q.text }];
      }
      case "fact_reply":
        return [{ who: "Examiner", text: findFactReply(cv, t.replyId)?.reply.replyText ?? "" }];
      case "reveal":
        return [{ who: "Examiner", text: getStage(cv, t.stageId).revealAnnouncement ?? "[new images shown]" }];
      case "neutral":
        return [{ who: "Examiner", text: t.text }];
      default:
        return [];
    }
  });
}

export function buildBlindPacket(patterns: readonly ResponsePattern[], cases: Map<string, CaseVersion>, opts: { sample: number; duplicates: number; seed: number }): { packetId: string; htmlPath: string; keyPath: string; items: number } {
  const rnd = mulberry32(opts.seed);
  const finalFirst = [...patterns].sort((a, b) => Number(splitForFamily(cases.get(b.caseId)!.caseFamilyId) === "final") - Number(splitForFamily(cases.get(a.caseId)!.caseFamilyId) === "final") || a.id.localeCompare(b.id));
  const shuffled = [...finalFirst].sort(() => rnd() - 0.5);
  const chosen = shuffled.slice(0, Math.min(opts.sample, shuffled.length));
  const dups = chosen.slice(0, Math.min(opts.duplicates, chosen.length));
  const firstHalf = [...chosen].sort(() => rnd() - 0.5);
  const items = [...firstHalf, ...dups.sort(() => rnd() - 0.5)].map((p, i) => ({ itemId: `item-${String(i + 1).padStart(2, "0")}-${Math.floor(rnd() * 1e6).toString(36)}`, pattern: p, duplicate: i >= firstHalf.length }));
  const packetId = `packet-${new Date().toISOString().slice(0, 10)}-${opts.seed}`;
  mkdirSync(PACKETS, { recursive: true });
  const key = { packetId, createdAt: new Date().toISOString(), items: items.map((x) => ({ itemId: x.itemId, patternId: x.pattern.id, duplicate: x.duplicate })) };
  const keyPath = path.join(PACKETS, `${packetId}.key.json`);
  writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
  const statuses = ["demonstrated", "partially_demonstrated", "incorrect", "not_demonstrated", "not_assessable", "uncertain"];
  const levels = ["unsafe", "below_expected", "meets_expected", "strong", "exceptional", "withhold"];
  const body = items
    .map((x, n) => {
      const cv = cases.get(x.pattern.caseId)!;
      const lines = transcript(x.pattern, cv).map((l) => `<p><b>${l.who}:</b> ${esc(l.text)}</p>`).join("");
      const els = cv.rubric.elements
        .map((e) => `<tr><td><b>${esc(e.severity)}</b> ${esc(e.construct)}<br><small>Accepted: ${esc(e.acceptedConcepts.join("; "))}${e.acceptableAlternatives.length ? ` · also: ${esc(e.acceptableAlternatives.join("; "))}` : ""}${e.incorrectOrUnsafeClaims.length ? ` · unsafe: ${esc(e.incorrectOrUnsafeClaims.join("; "))}` : ""}</small></td><td><select data-item="${x.itemId}" data-el="${e.id}"><option value="">—</option>${statuses.map((s) => `<option>${s}</option>`).join("")}</select></td></tr>`)
        .join("");
      const failures = x.pattern.renderFailures?.length ? `<p class="warn">Technical note: these images failed to display for the candidate: ${esc(x.pattern.renderFailures.join(", "))}</p>` : "";
      return `<section><h2>Item ${n + 1} of ${items.length} <small>${esc(x.itemId)}</small></h2><p class="muted">Case: ${esc(cv.internalTitle)} — truth: ${esc(cv.clinicalTruth.finalDiagnosis)}</p>${failures}<div class="tx">${lines}</div><table>${els}</table><p>Overall: <select data-item="${x.itemId}" data-el="__global">${levels.map((l) => `<option>${l}</option>`).join("")}</select> Notes: <input data-item="${x.itemId}" data-el="__notes" size="60"></p></section>`;
    })
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Blind rating ${esc(packetId)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#111}section{border:1px solid #ccc;border-radius:8px;padding:12px 16px;margin:16px 0}.tx{background:#f6f7f9;padding:8px 12px;border-radius:6px}table{width:100%;border-collapse:collapse}td{border-top:1px solid #eee;padding:6px;vertical-align:top}.muted{color:#555}.warn{color:#8a4b00}small{color:#555}button{font-size:16px;padding:8px 14px}</style></head><body><h1>Blind rating packet</h1><p>Rate each response from the transcript and the approved rubric only. No AI result or intended label is shown. Some items may appear more than once under a different label; rate each as you find it. Development fixtures are fictional.</p>${body}<p><button id="dl">Download my ratings (JSON)</button></p><script>document.getElementById("dl").onclick=function(){var out={packetId:${JSON.stringify(packetId)},ratedAt:new Date().toISOString(),items:{}};document.querySelectorAll("[data-item]").forEach(function(el){var i=el.getAttribute("data-item"),k=el.getAttribute("data-el");out.items[i]=out.items[i]||{elements:{}};if(k==="__global")out.items[i].global=el.value;else if(k==="__notes")out.items[i].notes=el.value;else if(el.value)out.items[i].elements[k]=el.value;});var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:"application/json"}));a.download=${JSON.stringify(packetId)}+"-ratings.json";a.click();};</script></body></html>`;
  const htmlPath = path.join(PACKETS, `${packetId}.html`);
  writeFileSync(htmlPath, html);
  return { packetId, htmlPath, keyPath, items: items.length };
}

type RatingsFile = { packetId: string; ratedAt: string; items: Record<string, { global?: string; notes?: string; elements: Record<string, string> }> };

/** Joins owner ratings with the packet key; stores normalized owner reference ratings. */
export function importRatings(file: string): { packetId: string; rated: number; duplicatePairs: { patternId: string; sameGlobal: boolean; elementAgreement: number }[]; stored: string } {
  const r = JSON.parse(readFileSync(file, "utf8")) as RatingsFile;
  const key = JSON.parse(readFileSync(path.join(PACKETS, `${r.packetId}.key.json`), "utf8")) as { items: { itemId: string; patternId: string; duplicate: boolean }[] };
  const rows = key.items
    .map((k) => ({ ...k, rating: r.items[k.itemId] }))
    .filter((x) => x.rating && x.rating.global)
    .map((x) => ({ patternId: x.patternId, duplicate: x.duplicate, global: x.rating!.global === "withhold" ? null : (x.rating!.global as RatingLevel), elements: x.rating!.elements, notes: x.rating!.notes ?? "" }));
  const duplicatePairs = rows
    .filter((x) => x.duplicate)
    .map((d) => {
      const first = rows.find((x) => !x.duplicate && x.patternId === d.patternId);
      if (!first) return null;
      const ids = Object.keys(first.elements);
      const same = ids.filter((id) => first.elements[id] === d.elements[id]).length;
      return { patternId: d.patternId, sameGlobal: first.global === d.global, elementAgreement: ids.length ? same / ids.length : 0 };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  mkdirSync(RATINGS, { recursive: true });
  const stored = path.join(RATINGS, `${r.packetId}.json`);
  writeFileSync(stored, `${JSON.stringify({ packetId: r.packetId, ratedAt: r.ratedAt, ratings: rows.filter((x) => !x.duplicate), duplicates: rows.filter((x) => x.duplicate), duplicatePairs }, null, 2)}\n`);
  return { packetId: r.packetId, rated: rows.length, duplicatePairs, stored };
}

/** Owner reference ratings from all imported packets (first rating of each pattern wins). */
export function loadOwnerReference(): { reference: OwnerReference; consistency: { pairs: number; sameGlobal: number; elementAgreement: number | null } } {
  const reference: OwnerReference = new Map();
  let pairs = 0;
  let sameGlobal = 0;
  let agreeSum = 0;
  if (existsSync(RATINGS)) {
    for (const f of readdirSync(RATINGS).filter((x) => x.endsWith(".json")).sort()) {
      const d = JSON.parse(readFileSync(path.join(RATINGS, f), "utf8")) as { ratings: { patternId: string; global: RatingLevel | null; elements: Record<string, string> }[]; duplicatePairs: { sameGlobal: boolean; elementAgreement: number }[] };
      for (const x of d.ratings) if (!reference.has(x.patternId)) reference.set(x.patternId, { global: x.global, elements: x.elements });
      for (const p of d.duplicatePairs) {
        pairs++;
        if (p.sameGlobal) sameGlobal++;
        agreeSum += p.elementAgreement;
      }
    }
  }
  return { reference, consistency: { pairs, sameGlobal, elementAgreement: pairs ? agreeSum / pairs : null } };
}
