# Board-exam source verification: ABR DR Oral Exam and RCPSC Diagnostic Radiology

Access date for every entry: **2026-11-15**. Prepared for a neuroradiology oral-exam practice simulator.

## READ FIRST: how this was verified, and the limits

- **No official page was read directly.** WebFetch failed for both official hosts with `getaddrinfo ENOTFOUND www.theabr.org` / `ENOTFOUND www.royalcollege.ca`. The session's network allowlist refuses them. The environment is "Default", network type "limited", `allowed_hosts: []`. Following the tool's guidance, no other hosts (for example archive mirrors) were tried.
- **Everything below comes from WebSearch results restricted to `theabr.org` / `royalcollege.ca`.** The search tool returns a model-written summary of search-engine snippets. Some of the text in those summaries is quoted verbatim from snippets, and some is paraphrase.
- **What the quote column means:** a "quote" is a string that the search tool returned as verbatim text from that URL. It was **not** checked against the live page. The snippet may also come from an older crawl than today's version of the page. Verification codes:
  - **S2**: the same verbatim string came back in 2 or more independent searches.
  - **S1**: the verbatim string came back in only one search.
  - **P**: paraphrase only, with no verbatim text available. These rows are **not quotes** and must not be shown to users as quotes.
  - **URL?**: the search summary did not say clearly which ABR page carries the text.
- **To upgrade these rows to directly verified:** add `www.theabr.org` and `www.royalcollege.ca` to the session's allowed network hosts (possibly also `theabr.org`, `royalcollege.ca` and `news.royalcollege.ca`). Then re-run WebFetch on the URLs in the sourceRegistry.

---

## Verified facts (snippet-level, official domains only)

### ABR: Diagnostic Radiology (DR) Oral Exam

Cohort applicability, unless the row says otherwise: the new DR Oral Exam starts in calendar year 2028 (optional pilot in Sept 2027). It first applies to DR residents completing training in June 2027. From 2028 on, every DR candidate must pass it, whenever they finished residency.

| # | Claim | Exact quote (short) | URL | Access date | Applicable cohort | Verif. |
|---|---|---|---|---|---|---|
| ABR-1 | Start year and first cohort | "Beginning in calendar year 2028 and first applying to DR residents completing training in June 2027" | https://www.theabr.org/get-certified/diagnostic-radiology/ (URL? may be the news page) | 2026-11-15 | June-2027 completers onward | S1 (paraphrase consistent across 4 searches; another summary adds "entering their R1 year in July 2023") |
| ABR-2 | Pilot Sept 2027; most 2027 grads sit Feb 2028 | "A small pilot exam is planned for September 2027 but most 2027 DR residency graduates will take the new DR Oral Exam in February 2028." | https://www.theabr.org/beam/from-the-board-of-governors-october-2026/ | 2026-11-15 | 2027 completers | S2 |
| ABR-3 | Pilot dates | "The pilot exam is scheduled for September 24 and 25, 2027." | https://www.theabr.org/beam/focus-on-dr-october-2026/ and/or news-page FAQ (URL?) | 2026-11-15 | Pilot volunteers: passed Core before June 2027 and on track to finish training by June 30, 2027 | S1 (second search: "two one-day administrations on September 24 and 25, 2027") |
| ABR-4 | Pilot size and selection | P: about 220 candidates. S1 quote: "Pilot participants will be randomly selected from the pool of candidates who respond yes to the survey" | https://www.theabr.org/beam/focus-on-dr-october-2026/ | 2026-11-15 | Pilot only | S1/P |
| ABR-5 | Pilot outcomes | "three potential outcomes: 1) a complete pass... 2) a conditional pass... or 3) a non-event" (truncated in snippet); conditional: "may return in the fall of 2028 to take up to two categories to satisfy the "condition"" | https://www.theabr.org/beam/focus-on-dr-october-2026/ | 2026-11-15 | Pilot only | S1 |
| ABR-6 | Main 2028 administrations | P: late Jan to early Feb 2028, then June and November 2028. Quote: "Dates displayed here are approximate." | https://www.theabr.org/exam-dates-and-information/dr-exam-dates/ | 2026-11-15 | 2028 sittings | P/S1 |
| ABR-7 | Format: 7 categories, 25 min each, one-on-one | "Seven 25-minute oral exams covering the seven clinical categories are conducted one-on-one each with a different examiner." | https://www.theabr.org/get-certified/diagnostic-radiology/ (also reported on the DR exam-dates page) | 2026-11-15 | 2028 onward | S2 |
| ABR-8 | Neuroradiology is its own category | Category list as returned: breast, cardiothoracic, "abdominal (includes gastrointestinal, genitourinary, and ultrasound)", musculoskeletal, nuclear radiology, pediatrics, neuroradiology | https://www.theabr.org/get-certified/diagnostic-radiology/ | 2026-11-15 | 2028 onward | S2 (list); S1 (abdominal parenthetical) |
| ABR-9 | Conflicting duration | "separate 20- to 25-minute video conference sessions" | https://www.theabr.org/beam/focus-on-dr-june-2026/ (one summary also linked it to the study guide; URL?) | 2026-11-15 | 2028 onward | S2 |
| ABR-10 | Remote delivery | "The exam will be administered as an interactive virtual videoconference in a location of the candidate's choice (subject to technical and privacy requirements)." | https://www.theabr.org/beam/from-the-board-of-governors-october-2026/ and https://www.theabr.org/news/new-diagnostic-radiology-oral-exam/ | 2026-11-15 | 2028 onward | S2 |
| ABR-11 | Image presentation | "Images may be presented as single images, cine clips, or scrollable stacks." | https://www.theabr.org/wp-content/uploads/2026/08/DR-Oral-Exam-Study-Guide.pdf ("Last updated August 2026") | 2026-11-15 | 2028 onward | S2 |
| ABR-12 | Candidate can manipulate images | "The exam software allows a candidate to modify an exam image in real time during the exam." | https://www.theabr.org/news/new-diagnostic-radiology-oral-exam/ (FAQ) | 2026-11-15 | 2028 onward | S1 |
| ABR-13 | MRI sequences are labelled | "MRI studies will be labeled for sequence type (e.g., T1 with contrast, T2, DWI)." | https://www.theabr.org/news/new-diagnostic-radiology-oral-exam/ (also /announcements/new-diagnostic-radiology-oral-exam); https://www.theabr.org/beam/focus-on-dr-june-2025/ | 2026-11-15 | 2028 onward | S2 |
| ABR-14 | Exception to labelling | "The rare exception might be a case where recognizing the specific sequence is the concept being tested" (examples given: abdominal in-/out-of-phase; breast "silicone-only") | same as ABR-13 | 2026-11-15 | 2028 onward | S2 (quote); P (examples) |
| ABR-15 | Why sequences are labelled | "The ABR Image Quality Committee and the Board of Trustees think that having candidates spend exam time identifying sequences would not add value to the exam experience." | https://www.theabr.org/beam/focus-on-dr-june-2025/ | 2026-11-15 | 2028 onward | S1 |
| ABR-16 | Skills assessed | "the DR Oral Exam will focus on higher level skills in observation, synthesis, and management" | https://www.theabr.org/wp-content/uploads/2026/08/DR-Oral-Exam-Study-Guide.pdf | 2026-11-15 | 2028 onward | S2 |
| ABR-17 | What candidates are expected to do | "discuss the major findings and pertinent negatives ("observation"); provide analysis ("synthesis"), which might include a differential diagnosis and a most likely consideration; and suggest a next step ("management"), which might include further imaging, biopsy, urgent referral, etc." | An ABR June 2026 Beam article (URL?: focus-on-dr-june-2026 or from-the-executive-director-june-2026) | 2026-11-15 | 2028 onward | S1 |
| ABR-18 | Neuro scope | "Brain, neck, and spine topics from the following categories: Cysts and tumor-like lesions" (the snippet stops here, so the rest of the list is unknown) | https://www.theabr.org/wp-content/uploads/2026/08/DR-Oral-Exam-Study-Guide.pdf | 2026-11-15 | 2028 onward | S1 |
| ABR-19 | Study guide is not exhaustive | "It does not include an exhaustive list of potential subject matter, as this has historically been found not to be useful for candidates." | same PDF | 2026-11-15 | 2028 onward | S1 |
| ABR-20 | US, procedures and non-interpretive content | P: ultrasound appears where it would in practice, "rarely in neuroradiology". Procedures and safety/professionalism topics (e.g., contrast reactions, reporting errors) are embedded within cases. | https://www.theabr.org/beam/focus-on-dr-june-2025/ | 2026-11-15 | 2028 onward | P |
| ABR-21 | Per-case scale | "Performance on an individual case is scored as 68, 69, 70, 71, or 72." | https://www.theabr.org/beam/from-the-executive-director-june-2026/ | 2026-11-15 | All ABR oral exams, incl. new DR | S2 |
| ABR-22 | Pass rule (category average ≥ 70) | "Although a candidate does not need to pass every case to pass the category, the average of the case scores must equal or exceed 70 to pass the category." Also: "The exam software averages the scores for a particular category; if the average is 70 or above, the category is considered to have been passed." | https://www.theabr.org/beam/from-the-executive-director-june-2026/ | 2026-11-15 | All ABR orals | S2 |
| ABR-23 | Scale anchors 68–72 | "68 corresponds to a performance that is "absolutely unsatisfactory," 69 is "marginally unsatisfactory," 70 is "satisfactory," 71 is "good," and 72 is "outstanding."" (the sentence opens "Across all four disciplines (including diagnostic radiology, with the upcoming return to the DR oral exam in 2028)") | https://www.theabr.org/beam/from-the-board-of-trustees-december-2025/ | 2026-11-15 | All 4 ABR disciplines incl. DR 2028 | S2 |
| ABR-24 | Anchor descriptors (ED article) | "A 72 represents exceptionally strong performance ("outstanding")"; "A 71 represents a strong performance ("good"). This would characterize a pattern of responses to a case that is better than acceptable and represents a reasonable and well-presented analysis with few knowledge gaps."; "A 70 represents acceptable performance"; "a 69 represents weak performance ("marginally unsatisfactory")"; "A 68 represents poor performance that is potentially unsafe ("absolutely unsatisfactory")" | https://www.theabr.org/beam/from-the-executive-director-june-2026/ | 2026-11-15 | All ABR orals | S1 each. P additions (not quotes): 68 "usually reflecting significant knowledge gaps or poor judgment"; 69 involves "gaps in concepts needed for safe and independent practice" |
| ABR-25 | Worked example | "a candidate who is shown five cases and receives scores of 69, 70, 70, 70, and 71 would pass" | https://www.theabr.org/beam/from-the-executive-director-june-2026/ | 2026-11-15 | Illustrative only | S1 |
| ABR-26 | Cases per exam period (all disciplines, not DR-specific) | "three to 10 cases, depending on the overall complexity of the content" | https://www.theabr.org/beam/from-the-executive-director-june-2026/ | 2026-11-15 | All ABR orals | S1 (the verb before it differed between searches: "assessed on" vs "tested on") |
| ABR-27 | Dangerous-answer provision (critical error) | "very rarely, markedly poor performance in a particular case (for example, insisting on a diagnosis or course of action that is potentially dangerous) is of sufficient concern that the category score is a fail regardless of performance on the other cases" | https://www.theabr.org/beam/from-the-executive-director-june-2026/ | 2026-11-15 | All ABR orals | S1 |
| ABR-28 | Independent scoring | "Examiners document their scoring determination without knowledge of the scores assigned by other examiners who met with the same candidate." | https://www.theabr.org/beam/from-the-executive-director-june-2026/ | 2026-11-15 | All ABR orals | S1 |
| ABR-29 | Panel review | "Candidates who fail one or two categories (depending on their specialty) will be discussed in a panel meeting among the group of examiners who met with that candidate." | https://www.theabr.org/beam/from-the-executive-director-june-2026/ | 2026-11-15 | All ABR orals | S2 |
| ABR-30 | Outlier score raising | "scores for individual sections may be raised if low performance in a particular subject area is considered an outlier" | Attributed to "the DR exam page" (URL? It may describe the pre-2014 DR oral) | 2026-11-15 | Unclear | S2 (text) / URL? |
| ABR-31 | DR conditional pass and retake | "if you fail one or two categories, you'll receive a conditional pass and you'll only need to retake the portions you did not pass. If you fail three or more categories, you'll need to retake the entire exam." | ABR DR page/FAQ (URL?: get-certified/diagnostic-radiology or legacy .../certifying-exam-faqs) | 2026-11-15 | DR oral (current vs new not explicit; consistent with ABR-5 and ABR-32) | S1 |
| ABR-32 | Re-examination of conditioned categories | "Two examiners will re-evaluate you in each conditioned category. If both pass you, the condition will be removed." Also: "a candidate who fails to meet the passing standard in one or two categories (out of seven) will be permitted to return to repeat the specific categories instead of the entire exam." | ABR DR pages (URL?) | 2026-11-15 | DR oral | S1 |
| ABR-33 | Examiner behaviour | "Examiners are coached to be patient and respectful but are instructed not to give feedback, positive or negative, during the exam." | https://www.theabr.org/beam/focus-on-dr-june-2026/ | 2026-11-15 | All ABR orals | S2 |
| ABR-34 | Examiner may change image set or case | "Sometimes an examiner wants to help the candidate by moving from a set of images with which the candidate is struggling, to a different image set or a different case." | Probably https://www.theabr.org/beam/focus-on-dr-june-2026/ (URL?) | 2026-11-15 | All ABR orals | S1 |
| ABR-35 | Standardized case sets and order | P/S1: "Cases will be given in the same order for each session, and each category will have an identical case set for a given oral exam date." (tense differed between two searches); "Individual examiners do not show their own cases." | news-page FAQ or ED June 2026 (URL?) | 2026-11-15 | 2028 onward | S1 |
| ABR-36 | Rubrics and predefined performance elements | "The use of defined rubrics for each case will enhance standardization of objective scoring of the discussions."; "The IT platform will allow standardized scoring based on specific predefined performance elements, as assessed by the examiners." | https://www.theabr.org/beam/focus-on-dr-october-2024/ | 2026-11-15 | 2028 onward | S1 |
| ABR-37 | Historical DR oral pass rate (context only) | "complete" pass rate historically "86% to 92% of first-time candidates" | https://www.theabr.org/beam/focus-on-dr-june-2026/ | 2026-11-15 | Historical (pre-2014 DR oral) | S2 |
| ABR-38 | Candidate guide exists and is evolving | "First Edition of Candidate Guide Posted (July 23, 2026)"; guide "subject to change as final details get worked out over the next 18 months" | https://www.theabr.org/news/new-diagnostic-radiology-oral-exam/ ; https://www.theabr.org/beam/focus-on-dr-august-2026/ | 2026-11-15 | 2028 onward | S1 |
| ABR-39 | Steady-state timing for later cohorts | "In a steady state, DR residents will have their first opportunity to take the Qualifying (Core) Exam in the fall of their PGY-5/R4 year and their first opportunity to take the Oral Certifying Exam in June of their PGY-5/R4 year." | https://www.theabr.org/news/dr-exam-changes-timing-impacts-for-dr-and-ir-dr-residents/ (URL?: or /beam/from-the-board-of-governors-december-2025/) | 2026-11-15 | Graduates 2029+ ("Residents graduating in 2029 and later will be eligible to take the Qualifying (Core) Exam in the fall of their R4 year rather than in June of their R3 year.") | S1 |
| ABR-40 | Eligibility policy wording | "Beginning in 2028, candidates in a residency or alternate pathway will be eligible for their first opportunity to take the DR portion of their certifying oral exam in June of their PGY-5/R4 year." | https://www.theabr.org/wp-content/uploads/2026/04/2026-04-24-Exam-Eligibility-Policy.pdf | 2026-11-15 | Steady state (see conflict U-A3) | S1 |
| ABR-41 | IR/DR candidates must pass the DR oral | "Beginning with IR residents graduating in 2029, all candidates seeking IR/DR certification will be required to pass the new Diagnostic Radiology (DR) Oral Exam, in addition to the Qualifying (Core) Exam and the IR oral component." | https://www.theabr.org/news/dr-exam-changes-timing-impacts-for-dr-and-ir-dr-residents/ (URL?) ; see also https://www.theabr.org/beam/focus-on-ir-dr-october-2026/ | 2026-11-15 | IR grads 2029+ | S1 |

### RCPSC: Diagnostic Radiology

| # | Claim | Exact quote (short) | URL | Access date | Applicable cohort | Verif. |
|---|---|---|---|---|---|---|
| RC-1 | Applied (oral) station format for DR | "Diagnostic Radiology Number of content stations · 8 Length of stations (minutes) · 14 Additional reading time not included in assessment time (minutes) · 0 Time between stations (minutes) · 3" | https://www.royalcollege.ca/en/eligibility-and-exams/exam-preparation/applied-exams.html (also /content/rcpsc-site-v2/ca/en/... variant) | 2026-11-15 | Page not year-labelled in the snippets | S2 for the string. **Row-to-discipline mapping is uncertain**: several summaries said the extracted table is jumbled, and other rows show 8 × 15 min or 2 min of reading time |
| RC-2 | Applied exams are structured orals | "All applied exams listed below follow a structured oral format."; "The number of stations and examiners, as well as the time you have to complete each station, vary according to the discipline." | same as RC-1 | 2026-11-15 | All RCPSC applied exams | S1 |
| RC-3 | Written and applied components are decoupled | "Exam Format: Written Before Oral (Decoupled)" | https://www.royalcollege.ca/en/eligibility-and-exams/exam-preparation/dates-deadlines-locations/2026-exam-dates.html ; .../2027-exam-dates.html | 2026-11-15 | CBD cohorts, 2026–2027 | S2 |
| RC-4 | Legacy cohort format | "Comprehensive Objective Oral" (listed for the traditional cohort that started training in 2021) | .../2026-exam-dates.html | 2026-11-15 | Traditional (2021-start) cohort, 2026 | S1/P |
| RC-5 | CBD timing for DR | "Diagnostic Radiology W Fall 2026 A Spring 2027" | https://www.royalcollege.ca/content/dam/document/standards-and-accreditation/cbd-rollout-schedule-e.html | 2026-11-15 | First DR CBD exam cohort | S1 |
| RC-6 | A written component exists (sample papers) | Titles "Sample Written Exam" (MCQ sample; 2025 short-answer sample with model answers, e.g., most likely diagnosis, BI-RADS category) | https://www.royalcollege.ca/content/dam/documents/ibd/diagnostic-radiology/diagnostic_radiology_mcq_sample_exam_e.pdf ; https://www.royalcollege.ca/content/dam/documents/ibd/diagnostic-radiology/2025-diagnostic-radiology-sample-written-saq-exam-e.pdf | 2026-11-15 | 2025 onward | S2 (exist) / P (content) |
| RC-7 | GRS approach (general, not DR-specific) | "A global rating scale (GRS) will be used to assess candidates' competence in relevant aspects of care demonstrated during the station. The domains measured in the stations may vary, but most commonly include a selection from the following:" | https://www.royalcollege.ca/en/eligibility-and-exams/exam-formats/general-surgery-exam-format-2027.html | 2026-11-15 | General Surgery Fall 2026/Spring 2027 (**not DR**) | S1 |
| RC-8 | Generic anchors live in a "GRS template" | "the behavioural anchors for your specialty may vary somewhat from these" | Several specialty format pages, e.g., https://www.royalcollege.ca/en/eligibility-and-exams/exam-formats/opthalmology-exam-format.html | 2026-11-15 | Multiple specialties (**not DR**) | S2 |
| RC-9 | Generic anchor levels (OB/GYN document) | Document title: "Behavioral anchors Objectives (all possible) Extremely deficient Acceptable"; third level reported as "Exemplary"; "the behavioral anchors shown are generic and will be modified based on the specialty" | https://www.royalcollege.ca/content/dam/documents/ibd/obstetrics-and-gynecology/obgyn-grs-behavioral-anchors-e.pdf | 2026-11-15 | OB/GYN (generic; **not DR**) | S2 ("Extremely deficient", "Acceptable"); S1 ("Exemplary" and the sentence) |
| RC-10 | Example domain list (another specialty) | "most commonly include a selection from the following: Data Acquisition, Data Interpretation, Clinical Reasoning/Judgement, Diagnosis, Differential Diagnosis" (summaries list further Ophthalmology items: Clinical Management, Surgical Maturity, Patient Safety, Organization and Flow, Communication) | https://www.royalcollege.ca/en/eligibility-and-exams/exam-formats/opthalmology-exam-format.html | 2026-11-15 | Ophthalmology (**not DR**) | S1 / P |

---

## Unresolved / conflicting

### ABR

- **U-A1 Session duration conflict.** Three different figures came back:
  - "Seven 25-minute oral exams" (get-certified DR page; DR exam-dates page; S2).
  - "separate 20- to 25-minute video conference sessions" (Focus on DR June 2026; S2).
  - "(20 to 30 minutes in duration)": one search attributed this to the Board of Trustees Dec 2025 article, but a targeted search **could not reconfirm** it. It may be a cross-discipline description.
  - Simulator default suggestion: 25 min. Show it as "about 20–25 min per ABR sources".
- **U-A2 Cases per category: not stated for DR.** The only figure found is cross-discipline: "three to 10 cases, depending on the overall complexity of the content" (ED June 2026). The five-case worked example is illustrative, not a specification.
- **U-A3 Date of the first administration for 2027 completers:**
  - "February 2028" (BoG Oct 2026).
  - Late Jan to early Feb 2028, with "Dates displayed here are approximate." (exam-dates page).
  - The Apr-2026 eligibility policy PDF reportedly lists Q1 2028 in one place and Q2 2028 in another.
  - BoG Dec 2025 (P) says the timing for 2027 completers was not changed: "first half of the calendar year following residency completion (2028)".
- **U-A4 Return date after a pilot conditional pass:** "fall of 2028" (Focus on DR Oct 2026, S1) versus the November 2028 administration (FAQ, P only).
- **U-A5 Rounding and the treatment of 69.**
  - New materials (ED June 2026): the category passes if the average is ≥ 70. Rounding is not mentioned.
  - The **older IR/DR Examiner Guide v3.0 (2025, IR/DR only, not the new DR oral)** says:
    - the summary score is the mean of case scores "always rounded down to the next whole number" (P);
    - 71 is "above average" (P);
    - a single 69 "can be raised to a passing grade by the examiner who gave the 69" (S1);
    - a candidate entering panel with 69s in two or more categories, or with a single 68, cannot have scores raised (P);
    - examiners must write notes explaining any 68 or 69 (S1).
  - Do **not** apply the IR/DR rules to the DR simulator without confirmation.
- **U-A6 "Outlier" raise rule (ABR-30).** The text is consistent, but the URL is unclear and may describe the pre-2014 DR oral.
- **U-A7 Dangerous-answer auto-fail (ABR-27).** Only one search returned it (S1). It is described as applying "very rarely". The procedure (who decides, and whether the panel reviews it) is not specified.
- **U-A8 Image technology is not specified.**
  - Confirmed: single images, cine clips, scrollable stacks, and candidate real-time image modification.
  - **DICOM vs rendered images, the viewer product, and window/level presets were not found.**
  - Tool lists (zoom, contrast/brightness, inversion, pencil, eraser, reset; examiner and candidate cannot scroll at the same time) come from the **IR/DR examiner guide for the current IR/DR platform**. They are context only.
- **U-A9 Full neuro topic list.** The study guide snippet is cut off after "Cysts and tumor-like lesions". The rest of the neuro category list (and whether head and neck is labelled "neck") was not retrievable.
- **U-A10 "criterion-referenced scoring method".** One search summary tied this phrase to the DR page. It may refer to the current computer-based Certifying Exam rather than the oral, so it is unresolved.
- **U-A11 Scope of the conditional-pass wording (ABR-31/32).** These rows came from an ABR DR page or FAQ whose URL and era were not pinned down. The ED June 2026 article says conditional pass rules depend on the discipline, and IR has no conditional pass. The pilot article (ABR-5) does confirm "up to two categories" for the new exam.
- **U-A12 Remote proctoring details.** "Continuously monitored" (IR/DR remote guide v3.0) and continuous webcam recording (2026 DR **computer-based** Certifying remote guide v36) are not confirmed for the DR oral. The DR Remote Oral Exam Guide for Candidates (first edition July 23, 2026) was not retrievable.

### RCPSC

- **U-R1 The DR 2027 exam-format document could not be read and is not search-indexed** (`.../diagnostic-radiology/diagnostic-radiology-examformat-2027-e.html`). As a result these are **unknown**: cases per station, timing per case, viewing conditions (workstation vs printed vs projected images), and DR-specific GRS domains. Any timing in that document that conflicts with RC-1 cannot be checked from here.
- **U-R2 Station table mapping (RC-1).** "8 stations × 14 min, 0 min reading, 3 min between" came back twice next to the label "Diagnostic Radiology". However, several summaries warned that the extracted table is jumbled and that other rows show 8 × 15 min, 2 min of reading time, or lengths of 14, 15 or 20 min. Treat it as probable but unconfirmed.
- **U-R3 Exam dates conflict across snippets** (the dates pages are tables that extracted badly):
  - 2026 traditional-cohort applied: "Monday, June 01, 2026" (Ottawa) vs "Tuesday, April 21, 2026" (Touchstone Institute, Toronto).
  - 2026 CBD written: Sept 22–23, 2026.
  - 2027 applied: April 27, 2027, May 7, 2027, or June 7–8, 2027 (RCPSC, 160 Elgin, Ottawa).
  - Another 2027 row: written Sept 14–15, 2027, with applied in Spring 2028.
  - 2027 written: Mar 31–Apr 1, 2027.
  - None of these could be reliably tied to the DR row.
- **U-R4 GRS domains for DR were not found.** The names in the brief ("detection/data gathering, integration/interpretation, management, consultancy/communication") are **not confirmed** for DR. The closest match is the Internal Medicine format page (P): "data collection and interpretation", "detection and integration of clinical findings (clinical reasoning and data synthesis)", patient management, "consultancy skills". That is IM, not DR. Other specialties use domains such as Data Acquisition, Data Interpretation, Clinical Reasoning/Judgement, Diagnosis, Differential Diagnosis, Clinical/Patient Management, Patient Safety and Communication.
- **U-R5 GRS document.** The old 2025 domains PDF (`.../ibd/shared/2025-global-rating-scale-domains-e.pdf`) returned 404 according to the brief. No 2026 or 2027 replacement appeared in search. The only anchor document found is the OB/GYN generic anchors PDF, with levels "Extremely deficient" / "Acceptable" / "Exemplary". The wording of its anchor cells was garbled in extraction, so no cell text is quoted.
- **U-R6 Pass score and station weighting for DR were not found.** "Pass score is 70%" (Ophthalmology/IR pages) and "each station is weighted equally" (Dermatology/Radiation Oncology/Nuclear Medicine) belong to **other disciplines**.

---

## Could not access

| URL | Tool | Failure |
|---|---|---|
| https://www.theabr.org/get-certified/diagnostic-radiology/ | WebFetch | `getaddrinfo ENOTFOUND www.theabr.org` (session network allowlist) |
| https://www.theabr.org/news/new-diagnostic-radiology-oral-exam/ | WebFetch | same |
| https://www.theabr.org/dr-oral-exam-study-guide | WebFetch | same (this URL also never appeared in search results; the guide surfaced as the PDF at /wp-content/uploads/2026/08/DR-Oral-Exam-Study-Guide.pdf) |
| https://www.theabr.org/beam/from-the-executive-director-june-2026/ | WebFetch | same |
| https://www.royalcollege.ca/content/dam/documents/ibd/diagnostic-radiology/diagnostic-radiology-examformat-2027-e.html | WebFetch | `getaddrinfo ENOTFOUND www.royalcollege.ca`; also **not found in any search index query** |
| https://www.royalcollege.ca/en/eligibility-and-exams/exam-preparation/applied-exams.html | not fetched | Same blocked host. Snippets only, via WebSearch |
| https://www.royalcollege.ca/content/dam/documents/ibd/shared/2025-global-rating-scale-domains-e.pdf | not fetched | Same host blocked. 404 per the brief; no replacement found in search |
| All other theabr.org / royalcollege.ca URLs in the registry | not fetched | Same hosts blocked. Snippets only |

- Environment: "Default", network "limited", `allowed_hosts: []`. Fix: allow `www.theabr.org` and `www.royalcollege.ca`, then re-fetch.
- Per the tool's guidance, no other hosts were tried (for example archive mirrors).
- Third-party sources appeared in search results but were **not read and are unverified**: AuntMinnie, Radiology Business, Applied Radiology ("ABR Will Transition to New Diagnostic Radiology Oral Exam in 2028"), RSNA News (Oct 2025 "abr core exam changes"), ACR Bulletin 2026 ("The return of oral boards"), and RadioGraphics doi:10.1148/rg.240016. Nothing in this report depends on them.

---

## sourceRegistry

Notes on the JSON below:
- `accessDate` is the date of the search. No entry was directly read: every entry's content comes from search snippets because WebFetch was DNS-blocked.
- Claim IDs refer to the tables above.

```json
{
  "sourceRegistry": [
    {
      "id": "abr-get-certified-dr",
      "url": "https://www.theabr.org/get-certified/diagnostic-radiology/",
      "title": "Get Certified in Diagnostic Radiology (DR) - American Board of Radiology",
      "accessDate": "2026-11-15",
      "cohort": "DR residents completing training June 2027 onward; DR Oral Exam from calendar year 2028",
      "supportedClaims": ["ABR-1", "ABR-7", "ABR-8"],
      "unresolved": ["Not directly read (WebFetch ENOTFOUND); snippet-derived only", "ABR-1 URL attribution may be the news page instead", "Possible source of ABR-30/ABR-31 wording, unconfirmed", "'criterion-referenced scoring method' phrase may refer to computer-based Certifying Exam (U-A10)"]
    },
    {
      "id": "abr-news-new-dr-oral",
      "url": "https://www.theabr.org/news/new-diagnostic-radiology-oral-exam/",
      "title": "New Diagnostic Radiology Oral Exam - American Board of Radiology (alias: /announcements/new-diagnostic-radiology-oral-exam)",
      "accessDate": "2026-11-15",
      "cohort": "2027 completers onward; pilot Sept 2027",
      "supportedClaims": ["ABR-10", "ABR-12", "ABR-13", "ABR-14", "ABR-35", "ABR-38"],
      "unresolved": ["Not directly read; snippet-derived only", "Pilot conditional-pass return: FAQ reportedly says November 2028 vs 'fall of 2028' elsewhere (U-A4)"]
    },
    {
      "id": "abr-dr-oral-study-guide-pdf",
      "url": "https://www.theabr.org/wp-content/uploads/2026/08/DR-Oral-Exam-Study-Guide.pdf",
      "title": "Diagnostic Radiology Oral Exam: Study Guide Last updated August 2026",
      "accessDate": "2026-11-15",
      "cohort": "DR Oral Exam 2028 onward",
      "supportedClaims": ["ABR-11", "ABR-16", "ABR-18", "ABR-19"],
      "unresolved": ["Not directly read; snippet-derived only", "Neuro topic list truncated after 'Cysts and tumor-like lesions' (U-A9)", "The HTML URL https://www.theabr.org/dr-oral-exam-study-guide was never seen in search results"]
    },
    {
      "id": "abr-ed-june-2026",
      "url": "https://www.theabr.org/beam/from-the-executive-director-june-2026/",
      "title": "From the Executive Director: An Explanation of ABR Oral Exam Scoring",
      "accessDate": "2026-11-15",
      "cohort": "All ABR oral exams (RO, MP, IR, DR incl. 2028 DR oral)",
      "supportedClaims": ["ABR-21", "ABR-22", "ABR-24", "ABR-25", "ABR-26", "ABR-27", "ABR-28", "ABR-29"],
      "unresolved": ["Not directly read; snippet-derived only", "Rounding of category average not mentioned (U-A5)", "Cases per DR category not specified; 'three to 10' is cross-discipline (U-A2)", "May be the source of ABR-17 definitions (URL uncertain)"]
    },
    {
      "id": "abr-bot-dec-2025",
      "url": "https://www.theabr.org/beam/from-the-board-of-trustees-december-2025/",
      "title": "From the Board of Trustees: ABR Oral Exam Scoring Processes Reduce Subjectivity",
      "accessDate": "2026-11-15",
      "cohort": "All four ABR disciplines incl. DR oral returning 2028",
      "supportedClaims": ["ABR-23"],
      "unresolved": ["Not directly read; snippet-derived only", "'(20 to 30 minutes in duration)' attributed once, not reconfirmed (U-A1)"]
    },
    {
      "id": "abr-focus-dr-june-2026",
      "url": "https://www.theabr.org/beam/focus-on-dr-june-2026/",
      "title": "Focus on DR: Debunking the Myths About ABR Oral Exams",
      "accessDate": "2026-11-15",
      "cohort": "DR oral 2028 onward (historical pass-rate context)",
      "supportedClaims": ["ABR-9", "ABR-33", "ABR-34", "ABR-37"],
      "unresolved": ["Not directly read; snippet-derived only", "20-25 min conflicts with 25 min on DR page (U-A1)", "ABR-34 URL attribution uncertain", "May be the source of ABR-17 definitions (URL uncertain)"]
    },
    {
      "id": "abr-focus-dr-aug-2026",
      "url": "https://www.theabr.org/beam/focus-on-dr-august-2026/",
      "title": "Focus on DR: ABR Adds Resources for First DR Oral Exam Cohort",
      "accessDate": "2026-11-15",
      "cohort": "First DR Oral cohort (2028)",
      "supportedClaims": ["ABR-38"],
      "unresolved": ["Not directly read; snippet-derived only", "DR Remote Oral Exam Guide for Candidates itself not retrievable (U-A12)"]
    },
    {
      "id": "abr-focus-dr-oct-2026",
      "url": "https://www.theabr.org/beam/focus-on-dr-october-2026/",
      "title": "Focus on DR: DR Oral Exam Pilot Announced for September 2027: Benefits for Candidates and ABR",
      "accessDate": "2026-11-15",
      "cohort": "Pilot volunteers (2027 completers who passed Core before June 2027)",
      "supportedClaims": ["ABR-3", "ABR-4", "ABR-5"],
      "unresolved": ["Not directly read; snippet-derived only", "Return timing fall 2028 vs November 2028 (U-A4)"]
    },
    {
      "id": "abr-bog-oct-2026",
      "url": "https://www.theabr.org/beam/from-the-board-of-governors-october-2026/",
      "title": "From the Board of Governors: New DR Oral Exam Will Improve Assessment of Candidate Knowledge and Skills",
      "accessDate": "2026-11-15",
      "cohort": "2027 DR completers (pilot Sept 2027; main Feb 2028)",
      "supportedClaims": ["ABR-2", "ABR-10"],
      "unresolved": ["Not directly read; snippet-derived only", "Conflicts with Q1/Q2 2028 wording in eligibility policy PDF (U-A3)"]
    },
    {
      "id": "abr-focus-dr-june-2025",
      "url": "https://www.theabr.org/beam/focus-on-dr-june-2025/",
      "title": "Focus on DR: \"That's a Good Question!\": Recent Inquiries About the New DR Oral Exam",
      "accessDate": "2026-11-15",
      "cohort": "DR oral 2028 onward",
      "supportedClaims": ["ABR-13", "ABR-14", "ABR-15", "ABR-20"],
      "unresolved": ["Not directly read; snippet-derived only", "ABR-20 is paraphrase only"]
    },
    {
      "id": "abr-focus-dr-oct-2024",
      "url": "https://www.theabr.org/beam/focus-on-dr-october-2024/",
      "title": "Focus on DR: New DR Oral Exam Builds on Previous Model with Scoring Rubrics",
      "accessDate": "2026-11-15",
      "cohort": "DR oral 2028 onward",
      "supportedClaims": ["ABR-36"],
      "unresolved": ["Not directly read; snippet-derived only", "Rubric contents (performance elements per case) not published in retrieved snippets"]
    },
    {
      "id": "abr-dr-exam-dates",
      "url": "https://www.theabr.org/exam-dates-and-information/dr-exam-dates/",
      "title": "Diagnostic Radiology (DR) Exam Dates - American Board of Radiology",
      "accessDate": "2026-11-15",
      "cohort": "2028 administrations",
      "supportedClaims": ["ABR-6", "ABR-7"],
      "unresolved": ["Not directly read; snippet-derived only", "Dates 'approximate'; exact 2028 dates not captured verbatim"]
    },
    {
      "id": "abr-news-timing-impacts",
      "url": "https://www.theabr.org/news/dr-exam-changes-timing-impacts-for-dr-and-ir-dr-residents/",
      "title": "DR Exam Changes: Timing Impacts for DR and IR/DR Residents",
      "accessDate": "2026-11-15",
      "cohort": "DR graduates 2029+ (steady state); IR graduates 2029+",
      "supportedClaims": ["ABR-39", "ABR-41"],
      "unresolved": ["Not directly read; snippet-derived only", "Quote attribution may instead be BoG Dec 2025 (https://www.theabr.org/beam/from-the-board-of-governors-december-2025/)"]
    },
    {
      "id": "abr-eligibility-policy-2026-04",
      "url": "https://www.theabr.org/wp-content/uploads/2026/04/2026-04-24-Exam-Eligibility-Policy.pdf",
      "title": "Exam Eligibility Policy Diagnostic Radiology and Interventional Radiology (2026-04-24)",
      "accessDate": "2026-11-15",
      "cohort": "DR/IR candidates from 2028",
      "supportedClaims": ["ABR-40"],
      "unresolved": ["Not directly read; snippet-derived only", "Reportedly lists Q1 2028 and Q2 2028 in different places (U-A3)"]
    },
    {
      "id": "abr-irdr-examiner-guide-v30",
      "url": "https://www.theabr.org/wp-content/uploads/2025/07/ABR_IRDR_OralCert_ExaminerGuide_v30.pdf",
      "title": "Oral Certifying Examiner Guide Interventional Radiology/Diagnostic Radiology (v3.0)",
      "accessDate": "2026-11-15",
      "cohort": "IR/DR oral (current) - NOT the new DR oral",
      "supportedClaims": [],
      "unresolved": ["Context only: rounding-down, single-69 raise, 68/69 notes, panel rules, viewer tools apply to IR/DR (U-A5, U-A8)", "Not directly read; snippet-derived only"]
    },
    {
      "id": "abr-dr-sample-cases-pdf",
      "url": "https://www.theabr.org/wp-content/uploads/2025/07/DR-Oral-Certifying-Exam-Sample-Cases-and-Discussion.pdf",
      "title": "DR Oral Certifying Exam Sample Cases and Discussion",
      "accessDate": "2026-11-15",
      "cohort": "DR oral 2028 onward (illustrative; 'not actual cases')",
      "supportedClaims": [],
      "unresolved": ["Content (incl. any neuro case) not retrievable; snippets only say cases show observation/synthesis/management discussion"]
    },
    {
      "id": "rc-applied-exams",
      "url": "https://www.royalcollege.ca/en/eligibility-and-exams/exam-preparation/applied-exams.html",
      "title": "Applied exams / What to know about taking an applied exam - Royal College",
      "accessDate": "2026-11-15",
      "cohort": "Not year-labelled in snippets (current applied exams)",
      "supportedClaims": ["RC-1", "RC-2"],
      "unresolved": ["Not directly read; snippet-derived only", "DR row mapping (8 x 14 min, 0 reading, 3 between) uncertain because table extraction was jumbled (U-R2)"]
    },
    {
      "id": "rc-dr-examformat-2027",
      "url": "https://www.royalcollege.ca/content/dam/documents/ibd/diagnostic-radiology/diagnostic-radiology-examformat-2027-e.html",
      "title": "Diagnostic Radiology exam format 2027 (title unverified)",
      "accessDate": "2026-11-15",
      "cohort": "2027 DR cohort",
      "supportedClaims": [],
      "unresolved": ["Not accessible (WebFetch ENOTFOUND) and not found in search index", "Cases per station, time per case, viewing conditions, DR GRS domains all unknown (U-R1)"]
    },
    {
      "id": "rc-2026-exam-dates",
      "url": "https://www.royalcollege.ca/en/eligibility-and-exams/exam-preparation/dates-deadlines-locations/2026-exam-dates.html",
      "title": "2026 Exam dates - Royal College",
      "accessDate": "2026-11-15",
      "cohort": "2026 sittings (traditional 2021-start cohort and CBD cohort)",
      "supportedClaims": ["RC-3", "RC-4"],
      "unresolved": ["Not directly read; snippet-derived only", "Specific DR dates/venues conflict across snippets (U-R3)"]
    },
    {
      "id": "rc-2027-exam-dates",
      "url": "https://www.royalcollege.ca/en/eligibility-and-exams/exam-preparation/dates-deadlines-locations/2027-exam-dates.html",
      "title": "2027 Exam dates - Royal College",
      "accessDate": "2026-11-15",
      "cohort": "2027 sittings (CBD cohorts)",
      "supportedClaims": ["RC-3"],
      "unresolved": ["Not directly read; snippet-derived only", "Applied dates reported as Apr 27, May 7, or Jun 7-8 2027 in different summaries (U-R3)"]
    },
    {
      "id": "rc-cbd-rollout",
      "url": "https://www.royalcollege.ca/content/dam/document/standards-and-accreditation/cbd-rollout-schedule-e.html",
      "title": "CBD start, launch and exam schedule - Royal College",
      "accessDate": "2026-11-15",
      "cohort": "First DR CBD exam cohort (written Fall 2026, applied Spring 2027)",
      "supportedClaims": ["RC-5"],
      "unresolved": ["Not directly read; snippet-derived only"]
    },
    {
      "id": "rc-dr-sample-written",
      "url": "https://www.royalcollege.ca/content/dam/documents/ibd/diagnostic-radiology/2025-diagnostic-radiology-sample-written-saq-exam-e.pdf",
      "title": "Sample Written Exam (Diagnostic Radiology, 2025 SAQ) - also MCQ sample at .../diagnostic_radiology_mcq_sample_exam_e.pdf",
      "accessDate": "2026-11-15",
      "cohort": "2025 onward written component",
      "supportedClaims": ["RC-6"],
      "unresolved": ["Not directly read; written paper length/item count not found"]
    },
    {
      "id": "rc-gs-format-2027",
      "url": "https://www.royalcollege.ca/en/eligibility-and-exams/exam-formats/general-surgery-exam-format-2027.html",
      "title": "Examination format - General Surgery (Fall 2026/Spring 2027)",
      "accessDate": "2026-11-15",
      "cohort": "General Surgery 2026-2027 (not DR)",
      "supportedClaims": ["RC-7"],
      "unresolved": ["Generic GRS wording only; DR-specific GRS not found (U-R4)"]
    },
    {
      "id": "rc-ophtho-format",
      "url": "https://www.royalcollege.ca/en/eligibility-and-exams/exam-formats/opthalmology-exam-format.html",
      "title": "Examination format - Ophthalmology",
      "accessDate": "2026-11-15",
      "cohort": "Ophthalmology (not DR)",
      "supportedClaims": ["RC-8", "RC-10"],
      "unresolved": ["Other-specialty domains; not transferable to DR without confirmation"]
    },
    {
      "id": "rc-obgyn-grs-anchors",
      "url": "https://www.royalcollege.ca/content/dam/documents/ibd/obstetrics-and-gynecology/obgyn-grs-behavioral-anchors-e.pdf",
      "title": "Behavioral anchors (OB/GYN GRS; generic anchors)",
      "accessDate": "2026-11-15",
      "cohort": "OB/GYN (generic anchors; not DR)",
      "supportedClaims": ["RC-9"],
      "unresolved": ["Anchor cell text garbled in extraction - not quoted", "Not confirmed to be the replacement for the 2025 GRS domains PDF (U-R5)"]
    },
    {
      "id": "rc-grs-domains-2025",
      "url": "https://www.royalcollege.ca/content/dam/documents/ibd/shared/2025-global-rating-scale-domains-e.pdf",
      "title": "2025 Global Rating Scale Domains (404 per brief)",
      "accessDate": "2026-11-15",
      "cohort": "2025 applied exams",
      "supportedClaims": [],
      "unresolved": ["404 per brief; host blocked here; no 2026/2027 replacement found in search (U-R5)"]
    }
  ]
}
```
