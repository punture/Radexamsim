# Exam profiles

An **exam profile** configures a practice station: duration, number of cases, prompting rules, viewer permissions, timing policy and how ratings are displayed. Profiles live in `packages/clinical-content/src/profiles.ts`. They are versioned (`<profileId>@<date>.<n>`) and stored in `exam_profiles`; every session and assessment records the exact profile version it used.

> **Status: all three profiles are provisional.** The settings come from search-engine snippets of official pages. The live official pages (theabr.org, royalcollege.ca) could not be fetched from the build environment, so nothing here has been directly verified. The owner must confirm each profile before any marketing claim relies on it (procedure in §4). Profiles are practice configurations. They are not affiliated with or endorsed by any board, and the product has no access to confidential examination material.

Full source registry with quotes, URLs, access dates, cohorts and verification codes: [sources/board_sources.md](sources/board_sources.md).

Verification codes used below:
- **S2**: the same verbatim snippet was returned by two or more independent searches.
- **S1**: returned by one search only.
- **P**: paraphrase; never show it to users as a quote.

## 1. ABR-oriented practice: DR oral, neuroradiology category

`abr-dr-neuro-oral@2026-11-15.1`

| Setting | Value | Basis |
|---|---|---|
| Station duration | 25 minutes, hard stop, warnings at 5 and 1 minute | ABR-7 "Seven 25-minute oral exams… one-on-one" (S2). Conflict: ABR-9 "20- to 25-minute" (S2) |
| Cases per station | 3–10; default 3 | ABR-26 "three to 10 cases" applies to ABR orals generally (S1). Not published for DR specifically |
| Case rating display | 68–72 practice estimate: unsafe→68 "absolutely unsatisfactory", below expected→69 "marginally unsatisfactory", meets expected→70 "satisfactory", strong→71 "good", exceptional→72 "outstanding" | ABR-21, ABR-23, ABR-24 (S2) |
| Category rule shown in explanations | Average of case scores ≥ 70 passes the category | ABR-22 (S2). The product never predicts a pass |
| Skills | Observation, synthesis, management | ABR-16, ABR-17 (S2) |
| Images | Single images, cine and scrollable stacks; MRI sequences labelled; the candidate may manipulate images | ABR-11 (S2), ABR-12 (S1), ABR-13 (S2) |
| Prompting (exam mode) | No requested hints, teaching, retries or pause; at most 1 targeted probe per element; no rescue; live transcript hidden by default | Product rules for realism, not ABR rules |
| Prompting (practice mode) | Hints, teaching, retries and pause allowed; up to 2 probes; rescue allowed; transcript shown | Product rules |
| Technical pauses | Pause-and-resume; reconnect grace 20 s; maximum pause 10 min, then the station is invalidated and usage released | Product policy |
| Cohort note | The new DR oral exam starts in calendar year 2028 (pilot September 2027) and first applies to residents completing training in June 2027 | ABR-1 (S1/P), ABR-2 (S2) |

**Not simulated:** examiner panel review (ABR-29), outlier score-raising, conditional-pass outcomes and the dangerous-answer category-fail rule (ABR-27). The product applies its own *case-level* critical-unsafe cap instead, which is defined in each approved rubric. The 68–72 display is a practice estimate for one practice case, never a percentage or an ABR score.

**Unresolved conflicts** (also stored in the profile's `verification.unresolvedConflicts`):
1. Session duration: 25 minutes (certification page) versus "20- to 25-minute" (BEAM, June 2026). 25 minutes is configured.
2. Cases per category session are not published for DR.
3. Outlier and conditional-pass wording may describe historical formats.

## 2. RCPSC-oriented practice: DR applied exam, neuroradiology content

`rcpsc-dr-neuro-practice@2026-11-15.1`

| Setting | Value | Basis |
|---|---|---|
| Station duration | 14 minutes, hard stop, warnings at 2 minutes and 30 seconds | RC-1 table row "Length of stations (minutes) · 14" (S1). The row's attribution to DR could not be confirmed against the 2027 format document, which was unreadable |
| Cases per station | 1–4 | Product choice; not published |
| Rating display | Qualitative only, with no numeric totals. Four product domains: detection, integration, management, consultancy. Levels: major concern, below expected, meets expected, above expected, exemplary | RC-7 says a global rating scale is used and domains vary (S1). The domain names are the owner's starting set and are marked `sourceStatus: unverified` |
| Format notes | Structured oral; written and applied components decoupled for CBD cohorts | RC-2 (S1), RC-3 (S2) |

**Unresolved:** the 2027 DR exam-format document; the current replacement for the global-rating-domains PDF, whose historical link returned 404; whether neuroradiology content appears as dedicated stations. Domain descriptors are product-defined, not Royal College descriptors.

## 3. Advanced neuroradiology practice track

`advanced-neuro-practice@2026-11-15.1`: a 20-minute soft-stop station, 1–6 cases, qualitative levels from "major concern" to "expert". It makes no board-format or examination-equivalence claim and is kept separate from examination-oriented profiles.

## 4. Updating a profile (owner procedure)

1. Re-check the official pages listed in [sources/board_sources.md](sources/board_sources.md) (sourceRegistry). To fetch them from a cloud session, the environment's network allowlist needs `www.theabr.org` and `www.royalcollege.ca`.
2. In the owner console, open **Configuration → Exam profiles → Record verification**. Enter what you checked (sources and dates), choose `verified` or `provisional`, and list any remaining conflicts.
3. The API creates a **new profile version** (`POST /api/owner/profiles/:versionId/verification`) and deactivates the old one. Attempts and assessments keep the version they used, so history is never rewritten.
4. If a numeric setting changes (duration, case range, prompting), edit `profiles.ts` with a new `versionId`, add a migration or seed step for the new version, update the public ABR and RCPSC pages, and run the test suite and `pnpm evals`.
5. Public copy must keep its independence disclaimer, and must describe facts as "publicly described" until verified.

## 5. Where profiles are used

- Station creation, form assembly and the clock: `apps/api/src/services/sessions.ts`, `packages/exam-engine`.
- Examiner prompting limits: `packages/exam-engine/src/stage-graph.ts`, `examiner.ts`.
- Rating display: `displayRating` and `displayDomain` in `profiles.ts`, used by the feedback composer and the results pages.
- Public pages: `apps/web/app/abr`, `apps/web/app/rcpsc`, `components/public/ProfileCards.tsx`.
