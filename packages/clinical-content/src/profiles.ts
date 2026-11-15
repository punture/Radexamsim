import { ExamProfileVersion, type RatingLevel } from "@sim/contracts";

/**
 * Exam profile versions (spec §2). See docs/EXAM_PROFILES.md for the evidence behind each
 * setting. IMPORTANT: during the 2026-11-15 build, official board pages could not be
 * fetched directly from the build environment (network allowlist); facts were taken from
 * search-engine snippets of official-domain pages. Every profile is therefore marked
 * "provisional" until the owner confirms the settings against the live documents.
 */

const ACCESS = "2026-11-15";

const EXAM_PROMPTING = {
  allowRequestedHints: false,
  allowTeaching: false,
  allowRetries: false,
  allowPause: false,
  maxTargetedProbesPerElement: 1,
  allowRescue: false,
  showLiveTranscriptByDefault: false,
} as const;

const PRACTICE_PROMPTING = {
  allowRequestedHints: true,
  allowTeaching: true,
  allowRetries: true,
  allowPause: true,
  maxTargetedProbesPerElement: 2,
  allowRescue: true,
  showLiveTranscriptByDefault: true,
} as const;

export const ABR_NEURO_PROFILE: ExamProfileVersion = ExamProfileVersion.parse({
  profileId: "abr-dr-neuro-oral",
  versionId: "abr-dr-neuro-oral@2026-11-15.1",
  displayName: "ABR-oriented practice — DR oral, neuroradiology category",
  board: "ABR",
  discipline: "diagnostic_radiology",
  category: "neuroradiology",
  track: "board_oriented",
  cohort:
    "Returning ABR DR oral exam beginning calendar year 2028 (first applying to DR residents completing training in June 2027); neuroradiology category only.",
  sources: [
    { registryId: "abr-get-certified-dr", url: "https://www.theabr.org/get-certified/diagnostic-radiology/", title: "ABR — Diagnostic Radiology certification", accessDate: ACCESS, supportedClaims: ["seven 25-minute one-on-one category exams", "neuroradiology is a category", "first applies to June 2027 completers"] },
    { registryId: "abr-news-new-dr-oral", url: "https://www.theabr.org/news/new-diagnostic-radiology-oral-exam/", title: "ABR — New Diagnostic Radiology Oral Exam", accessDate: ACCESS, supportedClaims: ["remote videoconference", "candidate can modify images in real time", "MRI sequences labelled"] },
    { registryId: "abr-dr-oral-study-guide-pdf", url: "https://www.theabr.org/wp-content/uploads/2026/08/DR-Oral-Exam-Study-Guide.pdf", title: "ABR — DR Oral Exam Study Guide (Aug 2026)", accessDate: ACCESS, supportedClaims: ["single images, cine clips, or scrollable stacks", "observation, synthesis, management"] },
    { registryId: "abr-ed-june-2026", url: "https://www.theabr.org/beam/from-the-executive-director-june-2026/", title: "ABR BEAM — From the Executive Director, June 2026", accessDate: ACCESS, supportedClaims: ["case scored 68–72", "category passes if average >= 70", "rare dangerous-answer category fail", "independent examiner scoring", "panel review for 1–2 failed categories", "three to 10 cases per exam period (all disciplines)"] },
    { registryId: "abr-bot-dec-2025", url: "https://www.theabr.org/beam/from-the-board-of-trustees-december-2025/", title: "ABR BEAM — From the Board of Trustees, December 2025", accessDate: ACCESS, supportedClaims: ["68 absolutely unsatisfactory … 72 outstanding"] },
    { registryId: "abr-focus-dr-june-2026", url: "https://www.theabr.org/beam/focus-on-dr-june-2026/", title: "ABR BEAM — Focus on DR, June 2026", accessDate: ACCESS, supportedClaims: ["examiners give no feedback, positive or negative", "20- to 25-minute sessions (conflicting duration wording)"] },
  ],
  verification: {
    status: "provisional",
    verifiedOn: ACCESS,
    method: "automated_source_review",
    notes:
      "Settings derived from search-engine snippets of official theabr.org pages; live pages were not fetchable from the build environment. Owner confirmation required before any marketing claim relies on them.",
    unresolvedConflicts: [
      "Session duration: '25-minute' (certification page) vs '20- to 25-minute' (BEAM June 2026). Configured 25 minutes.",
      "Cases per category session are not published for DR; 'three to 10 cases' is stated for ABR oral exams generally. Default 5, configurable 3–10.",
      "Outlier score-raising and conditional-pass wording may describe historical formats; not simulated.",
    ],
  },
  station: {
    durationSeconds: 25 * 60,
    minCases: 3,
    maxCases: 10,
    caseTimeGuidanceSeconds: null,
    hardStop: true,
    timeWarningsAtSecondsRemaining: [300, 60],
  },
  timing: { technicalPausePolicy: "pause_and_resume", reconnectGraceSeconds: 20, maxTechnicalPauseSeconds: 600, silencePausesClock: false },
  viewer: {
    allowScroll: true,
    allowZoomPan: true,
    windowing: "display_brightness_contrast",
    allowCine: true,
    allowComparison: true,
    examinerDrivenPresentationDefault: false,
  },
  turnTaking: { endOfTurnSilenceMs: 2200, extendedSilenceMs: 9000, allowBargeIn: true },
  prompting: { exam: EXAM_PROMPTING, practice: PRACTICE_PROMPTING },
  scoring: {
    kind: "abr_68_72_practice",
    anchors: [
      { score: 68, label: "Absolutely unsatisfactory", description: "Poor or potentially unsafe performance on the case." },
      { score: 69, label: "Marginally unsatisfactory", description: "Weak performance, below the satisfactory standard." },
      { score: 70, label: "Satisfactory", description: "Acceptable performance." },
      { score: 71, label: "Good", description: "Strong performance: a reasonable, well-presented analysis with few knowledge gaps." },
      { score: 72, label: "Outstanding", description: "Exceptionally strong performance." },
    ],
    anchorSourceRegistryIds: ["abr-bot-dec-2025", "abr-ed-june-2026"],
    categoryThresholdAverage: 70,
    disclaimer:
      "Practice estimate on the publicly described 68–72 case scale. This is not an ABR score, not a percentage, and does not simulate examiner panel review or predict a category or exam outcome.",
  },
  feedbackRelease: { exam: "after_station", practice: "after_each_case" },
  modes: ["exam", "practice"],
  publicDescription:
    "Practice for the neuroradiology category of the ABR Diagnostic Radiology oral exam format returning in 2028. Independent practice tool; not affiliated with or endorsed by the ABR.",
});

export const RCPSC_NEURO_PROFILE: ExamProfileVersion = ExamProfileVersion.parse({
  profileId: "rcpsc-dr-neuro-practice",
  versionId: "rcpsc-dr-neuro-practice@2026-11-15.1",
  displayName: "RCPSC-oriented practice — DR applied exam, neuroradiology content",
  board: "RCPSC",
  discipline: "diagnostic_radiology",
  category: "neuroradiology",
  track: "board_oriented",
  cohort: "Royal College Diagnostic Radiology applied (oral) examination, CBD cohorts 2026–2027 (written and applied decoupled).",
  sources: [
    { registryId: "rc-applied-exams", url: "https://www.royalcollege.ca/en/eligibility-and-exams/exam-preparation/applied-exams.html", title: "Royal College — Applied exams", accessDate: ACCESS, supportedClaims: ["DR row: 8 content stations, 14 minutes each, 0 minutes reading time, 3 minutes between stations (table extraction uncertain)"] },
    { registryId: "rc-dr-examformat-2027", url: "https://www.royalcollege.ca/content/dam/documents/ibd/diagnostic-radiology/diagnostic-radiology-examformat-2027-e.html", title: "Royal College — Diagnostic Radiology exam format 2027", accessDate: ACCESS, supportedClaims: [] },
    { registryId: "rc-2027-exam-dates", url: "https://www.royalcollege.ca/en/eligibility-and-exams/exam-preparation/dates-deadlines-locations/2027-exam-dates.html", title: "Royal College — 2027 exam dates", accessDate: ACCESS, supportedClaims: ["written before oral (decoupled)"] },
  ],
  verification: {
    status: "provisional",
    verifiedOn: ACCESS,
    method: "automated_source_review",
    notes:
      "Provisional practice configuration. The 2027 DR exam-format document could not be read; the 14-minute station length comes from a search snippet of the applied-exams table whose row attribution could not be confirmed. Domain names are the owner's starting set and are not yet confirmed for DR.",
    unresolvedConflicts: [
      "Station length (14 minutes) and number of cases per station are unconfirmed for Diagnostic Radiology.",
      "Current global-rating-scale domain names and descriptors for DR were not found; the 2025 GRS domains PDF link returns 404.",
    ],
  },
  station: {
    durationSeconds: 14 * 60,
    minCases: 1,
    maxCases: 4,
    caseTimeGuidanceSeconds: null,
    hardStop: true,
    timeWarningsAtSecondsRemaining: [120, 30],
  },
  timing: { technicalPausePolicy: "pause_and_resume", reconnectGraceSeconds: 20, maxTechnicalPauseSeconds: 600, silencePausesClock: false },
  viewer: {
    allowScroll: true,
    allowZoomPan: true,
    windowing: "display_brightness_contrast",
    allowCine: true,
    allowComparison: true,
    examinerDrivenPresentationDefault: false,
  },
  turnTaking: { endOfTurnSilenceMs: 2200, extendedSilenceMs: 9000, allowBargeIn: true },
  prompting: { exam: EXAM_PROMPTING, practice: PRACTICE_PROMPTING },
  scoring: {
    kind: "rcpsc_domains_qualitative",
    domains: [
      { id: "detection", label: "Detection", description: "Identifies and describes the relevant imaging findings.", sourceStatus: "unverified" },
      { id: "integration", label: "Integration", description: "Integrates findings and history into a prioritized interpretation and differential.", sourceStatus: "unverified" },
      { id: "management", label: "Management", description: "Recommends appropriate next steps, further imaging and urgency.", sourceStatus: "unverified" },
      { id: "consultancy", label: "Consultancy", description: "Communicates results clearly, including urgent communication.", sourceStatus: "unverified" },
    ],
    ratingLevels: [
      { id: "major-concern", label: "Major concern", description: "Unsafe or seriously deficient performance in this domain." },
      { id: "below-expected", label: "Below expected", description: "Important gaps for a candidate at this stage." },
      { id: "meets-expected", label: "Meets expected", description: "Performance consistent with readiness for independent practice." },
      { id: "above-expected", label: "Above expected", description: "Consistently strong, well-organized performance." },
      { id: "exemplary", label: "Exemplary", description: "Exceptional, comprehensive and efficient performance." },
    ],
    levelForCanonical: {
      unsafe: "major-concern",
      below_expected: "below-expected",
      meets_expected: "meets-expected",
      strong: "above-expected",
      exceptional: "exemplary",
    },
    canonicalDomainMap: { observation: "detection", interpretation: "integration", management: "management", communication: "consultancy" },
    numericTotalsEnabled: false,
    disclaimer:
      "Qualitative practice ratings with evidence. These are product-defined levels, not Royal College descriptors, scores or percentages.",
  },
  feedbackRelease: { exam: "after_station", practice: "after_each_case" },
  modes: ["exam", "practice"],
  publicDescription:
    "Oral-examination practice with neuroradiology content for Royal College Diagnostic Radiology candidates (provisional timing). Independent practice tool; not affiliated with or endorsed by the Royal College.",
});

export const ADVANCED_NEURO_PROFILE: ExamProfileVersion = ExamProfileVersion.parse({
  profileId: "advanced-neuro-practice",
  versionId: "advanced-neuro-practice@2026-11-15.1",
  displayName: "Advanced neuroradiology practice track",
  board: "NONE",
  discipline: "diagnostic_radiology",
  category: "neuroradiology",
  track: "advanced_practice",
  cohort: "Fellows and graduates seeking advanced neuroradiology case practice. No examination equivalence is claimed.",
  sources: [],
  verification: {
    status: "provisional",
    verifiedOn: ACCESS,
    method: "not_verified",
    notes: "Practice-only track. Makes no board-format claims.",
    unresolvedConflicts: [],
  },
  station: { durationSeconds: 20 * 60, minCases: 1, maxCases: 6, caseTimeGuidanceSeconds: null, hardStop: false, timeWarningsAtSecondsRemaining: [120] },
  timing: { technicalPausePolicy: "pause_and_resume", reconnectGraceSeconds: 30, maxTechnicalPauseSeconds: 1800, silencePausesClock: false },
  viewer: { allowScroll: true, allowZoomPan: true, windowing: "display_brightness_contrast", allowCine: true, allowComparison: true, examinerDrivenPresentationDefault: false },
  turnTaking: { endOfTurnSilenceMs: 2200, extendedSilenceMs: 10000, allowBargeIn: true },
  prompting: { exam: EXAM_PROMPTING, practice: PRACTICE_PROMPTING },
  scoring: {
    kind: "qualitative_practice",
    ratingLevels: [
      { id: "major-concern", label: "Major concern", description: "Unsafe or seriously deficient." },
      { id: "developing", label: "Developing", description: "Important gaps remain." },
      { id: "solid", label: "Solid", description: "Sound, safe performance." },
      { id: "strong", label: "Strong", description: "Well organized with few gaps." },
      { id: "expert", label: "Expert", description: "Comprehensive and efficient." },
    ],
    levelForCanonical: { unsafe: "major-concern", below_expected: "developing", meets_expected: "solid", strong: "strong", exceptional: "expert" },
    disclaimer: "Qualitative practice feedback only. No examination equivalence is claimed.",
  },
  feedbackRelease: { exam: "after_station", practice: "after_each_case" },
  modes: ["practice"],
  publicDescription: "An optional advanced neuroradiology practice track, separate from examination-oriented practice.",
});

export const ALL_PROFILES: readonly ExamProfileVersion[] = [ABR_NEURO_PROFILE, RCPSC_NEURO_PROFILE, ADVANCED_NEURO_PROFILE];

export function findProfile(versionId: string): ExamProfileVersion | undefined {
  return ALL_PROFILES.find((p) => p.versionId === versionId);
}

/** Profile-specific display of a canonical rating level. */
export function displayRating(profile: ExamProfileVersion, level: RatingLevel): string {
  const s = profile.scoring;
  if (s.kind === "abr_68_72_practice") {
    const score = ({ unsafe: 68, below_expected: 69, meets_expected: 70, strong: 71, exceptional: 72 } as const)[level];
    const anchor = s.anchors.find((a) => a.score === score)!;
    return `${score} — ${anchor.label} (practice estimate)`;
  }
  const id = s.levelForCanonical[level];
  return s.ratingLevels.find((r) => r.id === id)?.label ?? level;
}

export function displayDomain(profile: ExamProfileVersion, domain: "observation" | "interpretation" | "management" | "communication"): string {
  const s = profile.scoring;
  if (s.kind === "rcpsc_domains_qualitative") {
    const id = s.canonicalDomainMap[domain];
    return s.domains.find((d) => d.id === id)?.label ?? domain;
  }
  return ({ observation: "Observation", interpretation: "Synthesis", management: "Management", communication: "Communication" } as const)[domain];
}

/** Dynamic per-case pacing guidance when the profile does not fix one. */
export function caseTimeGuidanceMs(profile: ExamProfileVersion, caseCount: number): number {
  if (profile.station.caseTimeGuidanceSeconds !== null) return profile.station.caseTimeGuidanceSeconds * 1000;
  return Math.floor((profile.station.durationSeconds * 1000) / Math.max(1, caseCount));
}
