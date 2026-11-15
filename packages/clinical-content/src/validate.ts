import { CaseVersion, zodIssues, type ContractIssue } from "@sim/contracts";

/**
 * Runtime validation of case packages (spec §6). Schema validation is followed by
 * cross-reference integrity checks, graph checks, and leak/hint checks. Errors block the
 * `automated_checks` stage; warnings are surfaced in the owner review package.
 */

export type CaseIssue = ContractIssue & { severity: "error" | "warning" };

/** Marker the importer uses for content the owner (or the LLM author) must supply. */
export const DRAFT_PLACEHOLDER = "[DRAFT PLACEHOLDER]";

export type CaseValidationResult =
  | { ok: true; value: CaseVersion; warnings: CaseIssue[] }
  | { ok: false; issues: CaseIssue[] };

const STOPWORDS = new Set([
  "acute", "chronic", "with", "without", "left", "right", "bilateral", "lesion", "disease", "syndrome", "the", "and",
  "of", "in", "or", "a", "an", "type", "grade", "likely", "probable", "possible", "versus", "related", "process",
  "brain", "spine", "spinal", "cord", "neck", "head", "artery", "arterial", "vein", "venous", "mass", "small", "large",
  "early", "late", "subacute", "focal", "diffuse", "primary", "secondary", "benign", "malignant", "posterior",
  "anterior", "middle", "cerebral", "territory", "infection", "tumor", "tumour", "normal", "abnormal",
  "fictional", "established", "displayed", "images", "image", "differential", "includes", "include", "including",
  "thoracic", "cervical", "lumbar", "sacral", "lobe", "frontal", "temporal", "parietal", "occipital", "segment",
  "causing", "caused", "vessel", "vessels", "level", "multiple", "solitary", "single", "known",
]);

/** Significant diagnosis tokens (>= 5 letters, not generic anatomy/modifier words). */
export function diagnosisTokens(cv: Pick<CaseVersion, "clinicalTruth">): string[] {
  const phrases = [cv.clinicalTruth.finalDiagnosis, ...cv.clinicalTruth.acceptableDiagnoses];
  const tokens = new Set<string>();
  for (const p of phrases) {
    // Parenthetical qualifiers such as "(fictional)" are not diagnosis content.
    const core = p.replace(/\([^)]*\)/g, " ");
    for (const raw of core.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= 5 && !STOPWORDS.has(raw)) tokens.add(raw);
    }
  }
  return [...tokens];
}

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

export function validateCaseVersion(input: unknown): CaseValidationResult {
  const parsed = CaseVersion.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: zodIssues(parsed.error).map((i) => ({ ...i, severity: "error" as const })) };
  }
  const cv = parsed.data;
  const issues: CaseIssue[] = [];
  const err = (path: string, message: string, code = "integrity") => issues.push({ path, message, code, severity: "error" });
  const warn = (path: string, message: string, code = "review") => issues.push({ path, message, code, severity: "warning" });

  const assetIds = new Set(cv.assets.map((a) => a.id));
  const presetIds = new Set(cv.viewportPresets.map((p) => p.id));
  const stageIds = new Set(cv.stages.map((s) => s.id));
  const questionIds = new Set(cv.questions.map((q) => q.id));
  const elementIds = new Set(cv.rubric.elements.map((e) => e.id));
  const refIds = new Set(cv.source.references.map((r) => r.id));
  const findingIds = new Set(cv.clinicalTruth.keyFindings.map((f) => f.id));
  const allReplies = cv.stages.flatMap((s, si) => s.approvedFactReplies.map((r, ri) => ({ r, si, ri, stage: s })));
  const replyIds = new Set(allReplies.map((x) => x.r.id));

  // --- uniqueness -----------------------------------------------------------
  const uniq: [string, string[]][] = [
    ["assets", cv.assets.map((a) => a.id)],
    ["viewportPresets", cv.viewportPresets.map((p) => p.id)],
    ["stages", cv.stages.map((s) => s.id)],
    ["questions", cv.questions.map((q) => q.id)],
    ["stages[].approvedFactReplies", allReplies.map((x) => x.r.id)],
    ["rubric.elements", cv.rubric.elements.map((e) => e.id)],
    ["referenceResponses", cv.referenceResponses.map((r) => r.id)],
    ["source.references", cv.source.references.map((r) => r.id)],
    ["clinicalTruth.keyFindings", cv.clinicalTruth.keyFindings.map((f) => f.id)],
    ["practice.hints", cv.practice.hints.map((h) => h.id)],
    ["stages[].transitions", cv.stages.flatMap((s) => s.transitions.map((t) => t.id))],
  ];
  for (const [path, ids] of uniq) for (const d of dupes(ids)) err(path, `duplicate id "${d}"`, "duplicate_id");
  const ordinals = cv.stages.map((s) => s.ordinal);
  if (dupes(ordinals.map(String)).length) err("stages", "stage ordinals must be unique", "duplicate_ordinal");

  // --- governance / fixture rules ----------------------------------------------
  if (!cv.isDevelopmentFixture) {
    cv.assets.forEach((a, i) => {
      if (a.isPlaceholder || a.derivation.method === "placeholder") {
        err(`assets[${i}]`, "placeholder or synthetic media is not permitted in a clinical (non-fixture) case", "placeholder_in_clinical_case");
      }
    });
    if (cv.clinicalTruth.leakCanary !== null) err("clinicalTruth.leakCanary", "leak canaries are only allowed in development fixtures");
  }
  if (cv.source.truthStatus === "differential_only" && cv.clinicalTruth.displayedMaterialSupports === "specific_diagnosis") {
    err("clinicalTruth.displayedMaterialSupports", "truthStatus is differential_only but the displayed material is marked as supporting a specific diagnosis");
  }
  cv.eligibleProfileVersions.forEach((p, i) => {
    if (!/^[a-z0-9-]+@(\*|\d{4}-\d{2}-\d{2}\.\d+)$/.test(p)) err(`eligibleProfileVersions[${i}]`, `"${p}" must be a profile version id or "<profileId>@*"`);
  });

  // --- assets ------------------------------------------------------------------
  cv.assets.forEach((a, i) => {
    const p = `assets[${i}]`;
    a.frames.forEach((f, fi) => {
      if (f.index !== fi) err(`${p}.frames[${fi}].index`, `frame indices must be contiguous from 0 (expected ${fi}, got ${f.index})`);
    });
    if (a.display.initialFrameIndex >= a.frames.length) err(`${p}.display.initialFrameIndex`, "initial frame index is out of range");
    if (a.kind === "still" && a.frames.length !== 1) err(`${p}.frames`, "a still asset must have exactly one frame");
    if ((a.kind === "stack" || a.kind === "dicom_stack") && a.frames.length < 2) err(`${p}.frames`, "a stack must have at least two frames");
    if (a.kind === "dicom_stack") {
      if (!a.dicom) err(`${p}.dicom`, "dicom_stack assets require validated DICOM series metadata");
      if (a.frames.some((f) => f.mimeType !== "application/dicom")) err(`${p}.frames`, "dicom_stack frames must be application/dicom");
    } else if (a.frames.some((f) => f.mimeType === "application/dicom")) {
      err(`${p}.kind`, "DICOM frames require kind dicom_stack");
    }
    if (a.kind === "cine" && a.display.frameRateFps === null && !a.frames.some((f) => f.mimeType.startsWith("video/"))) {
      err(`${p}.display.frameRateFps`, "cine assets made of frames need a frame rate");
    }
    if (a.dicom && a.dicom.sortedBy === "image_position_patient" && !a.dicom.geometryValidated) {
      err(`${p}.dicom.geometryValidated`, "series sorted by geometry must have validated geometry");
    }
    if (!refIds.has(a.derivation.sourceReferenceId)) err(`${p}.derivation.sourceReferenceId`, `unknown source reference "${a.derivation.sourceReferenceId}"`);
    if (!a.derivation.preservesDiagnosticContent && !a.isPlaceholder) err(`${p}.derivation.preservesDiagnosticContent`, "derivative must preserve diagnostic content");
    if (a.derivation.burnedInAnnotationsPresent) warn(`${p}.derivation`, "burned-in annotations present: confirm they do not cue the answer, or exclude from detection assessment", "burned_in_annotation");
    if (/\.(png|jpe?g|dcm|tiff?)\b|img_\d|\bdscn?\d|\bslide\s*\d+/i.test(a.neutralLabel)) warn(`${p}.neutralLabel`, "label looks like a filename or slide reference", "filename_label");
    a.annotations.forEach((an, ai) => {
      if (an.assetId !== a.id) err(`${p}.annotations[${ai}].assetId`, "annotation must reference its own asset");
      if (an.frameIndex >= a.frames.length) err(`${p}.annotations[${ai}].frameIndex`, "annotation frame out of range");
      if (an.findingId && !findingIds.has(an.findingId)) err(`${p}.annotations[${ai}].findingId`, `unknown finding "${an.findingId}"`);
    });
  });
  cv.clinicalTruth.keyFindings.forEach((f, i) =>
    f.assetIds.forEach((a, ai) => {
      if (!assetIds.has(a)) err(`clinicalTruth.keyFindings[${i}].assetIds[${ai}]`, `unknown asset "${a}"`);
    }),
  );

  // --- presets -----------------------------------------------------------------
  cv.viewportPresets.forEach((vp, i) => {
    const expectedPanes = vp.layout === "single" ? 1 : vp.layout === "side_by_side" ? 2 : 4;
    if (vp.panes.length > expectedPanes) err(`viewportPresets[${i}].panes`, `layout ${vp.layout} allows at most ${expectedPanes} panes`);
    vp.panes.forEach((pane, pi) => {
      const a = cv.assets.find((x) => x.id === pane.assetId);
      if (!a) err(`viewportPresets[${i}].panes[${pi}].assetId`, `unknown asset "${pane.assetId}"`);
      else if (pane.frameIndex !== null && pane.frameIndex >= a.frames.length) err(`viewportPresets[${i}].panes[${pi}].frameIndex`, "frame out of range");
    });
  });

  // --- stages ------------------------------------------------------------------
  if (!stageIds.has(cv.openingStageId)) err("openingStageId", `unknown stage "${cv.openingStageId}"`);
  const assetFirstStage = new Map<string, number>();
  cv.stages.forEach((s, si) => {
    const p = `stages[${si}]`;
    s.assetIds.forEach((a, ai) => {
      if (!assetIds.has(a)) err(`${p}.assetIds[${ai}]`, `unknown asset "${a}"`);
      if (!assetFirstStage.has(a) || assetFirstStage.get(a)! > s.ordinal) assetFirstStage.set(a, s.ordinal);
    });
    s.viewportPresetIds.forEach((v, vi) => {
      if (!presetIds.has(v)) err(`${p}.viewportPresetIds[${vi}]`, `unknown viewport preset "${v}"`);
    });
    if (s.defaultViewportPresetId && !s.viewportPresetIds.includes(s.defaultViewportPresetId)) {
      err(`${p}.defaultViewportPresetId`, "default preset must be listed in viewportPresetIds");
    }
    s.allowedQuestionIds.forEach((q, qi) => {
      if (!questionIds.has(q)) err(`${p}.allowedQuestionIds[${qi}]`, `unknown question "${q}"`);
    });
    s.assessableRubricElementIds.forEach((e, ei) => {
      if (!elementIds.has(e)) err(`${p}.assessableRubricElementIds[${ei}]`, `unknown rubric element "${e}"`);
    });
    s.transitions.forEach((t, ti) => {
      const tp = `${p}.transitions[${ti}]`;
      if (!stageIds.has(t.toStageId)) err(`${tp}.toStageId`, `unknown stage "${t.toStageId}"`);
      if (t.toStageId === s.id) err(`${tp}.toStageId`, "a transition cannot target its own stage");
      if (t.trigger === "candidate_request") {
        if (!t.viaFactReplyId) err(`${tp}.viaFactReplyId`, "candidate_request transitions need viaFactReplyId");
        else if (!s.approvedFactReplies.some((r) => r.id === t.viaFactReplyId)) err(`${tp}.viaFactReplyId`, `fact reply "${t.viaFactReplyId}" is not defined in this stage`);
      }
      if (t.trigger === "after_question") {
        if (t.afterQuestionIds.length === 0) err(`${tp}.afterQuestionIds`, "after_question transitions need at least one question");
        t.afterQuestionIds.forEach((q, qi) => {
          if (!questionIds.has(q)) err(`${tp}.afterQuestionIds[${qi}]`, `unknown question "${q}"`);
        });
      }
    });
    s.approvedFactReplies.forEach((r, ri) => {
      const rp = `${p}.approvedFactReplies[${ri}]`;
      if (r.kind === "reveal") {
        if (!r.revealsStageId) err(`${rp}.revealsStageId`, "reveal replies must name the stage they reveal");
        else {
          if (!stageIds.has(r.revealsStageId)) err(`${rp}.revealsStageId`, `unknown stage "${r.revealsStageId}"`);
          const t = s.transitions.find((x) => x.trigger === "candidate_request" && x.viaFactReplyId === r.id);
          if (!t) err(`${rp}`, "reveal reply has no candidate_request transition in its stage");
          else if (t.toStageId !== r.revealsStageId) err(`${rp}.revealsStageId`, "reveal reply and its transition target different stages");
        }
      } else if (r.revealsStageId) err(`${rp}.revealsStageId`, "only reveal replies may reveal a stage");
      r.suppliesElementIds.forEach((e, ei) => {
        if (!elementIds.has(e)) err(`${rp}.suppliesElementIds[${ei}]`, `unknown rubric element "${e}"`);
      });
      if (r.suppliesElementIds.length > 0 && r.promptClass !== "examiner_supplied") {
        err(`${rp}.promptClass`, "replies that supply rubric content must be classed examiner_supplied");
      }
    });
    if (!s.allowedActions.includes("examiner.advance_case")) warn(`${p}.allowedActions`, "stage does not allow examiner.advance_case; the case can only end on time", "no_advance");
  });

  // Reachability from the opening stage.
  const reachable = new Set<string>([cv.openingStageId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of cv.stages) {
      if (!reachable.has(s.id)) continue;
      for (const t of s.transitions) {
        if (!reachable.has(t.toStageId) && stageIds.has(t.toStageId)) {
          reachable.add(t.toStageId);
          grew = true;
        }
      }
    }
  }
  cv.stages.forEach((s, si) => {
    if (!reachable.has(s.id)) err(`stages[${si}]`, `stage "${s.id}" is unreachable from the opening stage`, "unreachable_stage");
  });

  // --- questions ---------------------------------------------------------------
  cv.questions.forEach((q, qi) => {
    const p = `questions[${qi}]`;
    [...q.targetElementIds, ...q.suppliesElementIds].forEach((e) => {
      if (!elementIds.has(e)) err(`${p}`, `references unknown rubric element "${e}"`);
    });
    if (!cv.stages.some((s) => s.allowedQuestionIds.includes(q.id))) warn(p, `question "${q.id}" is not allowed in any stage`, "orphan_question");
    if (q.suppliesElementIds.length > 0 && q.promptClass !== "examiner_supplied" && q.promptClass !== "rescue") {
      err(`${p}.promptClass`, "a question that supplies rubric content must be classed examiner_supplied or rescue");
    }
    if (q.purpose === "targeted_probe" && q.promptClass !== "targeted_probe") err(`${p}.promptClass`, "targeted_probe questions must have promptClass targeted_probe");
    if (q.purpose === "rescue" && q.promptClass !== "rescue" && q.promptClass !== "examiner_supplied") err(`${p}.promptClass`, "rescue questions must be classed rescue or examiner_supplied");
    if (q.purpose === "opening" && q.promptClass !== "neutral") warn(`${p}.promptClass`, "opening invitations are normally neutral (otherwise everything after them counts as prompted)");
    if (q.skipIfAlreadyAddressed && q.addressedPatterns.length === 0) warn(`${p}.addressedPatterns`, "skippable question has no deterministic addressed patterns for the fallback examiner");
  });
  if (!cv.questions.some((q) => q.purpose === "opening")) warn("questions", "no opening question; the generic neutral invitation will be used", "no_opening");

  // --- rubric ------------------------------------------------------------------
  const domainIds = new Set(cv.rubric.domains.map((d) => d.id));
  cv.rubric.domains.forEach((d, di) => {
    const levels = new Set(d.anchors.map((a) => a.level));
    if (levels.size !== 5) err(`rubric.domains[${di}].anchors`, "domain anchors must cover all five rating levels exactly once");
  });
  if (new Set(cv.rubric.globalRules.anchors.map((a) => a.level)).size !== 5) err("rubric.globalRules.anchors", "global anchors must cover all five rating levels exactly once");
  const qById = new Map(cv.questions.map((q) => [q.id, q]));
  cv.rubric.elements.forEach((el, ei) => {
    const p = `rubric.elements[${ei}]`;
    if (!domainIds.has(el.domain)) err(`${p}.domain`, `domain "${el.domain}" has no anchors in rubric.domains`);
    el.requiredAssetIds.forEach((a, ai) => {
      if (!assetIds.has(a)) err(`${p}.requiredAssetIds[${ai}]`, `unknown asset "${a}"`);
    });
    const rule = el.opportunityRule;
    if (!stageIds.has(rule.stageId)) err(`${p}.opportunityRule.stageId`, `unknown stage "${rule.stageId}"`);
    else {
      const stage = cv.stages.find((s) => s.id === rule.stageId)!;
      for (const a of el.requiredAssetIds) {
        const first = assetFirstStage.get(a);
        if (first !== undefined && first > stage.ordinal) err(`${p}.requiredAssetIds`, `asset "${a}" is disclosed after the opportunity stage "${rule.stageId}"`);
      }
      if (!cv.stages.some((s) => s.assessableRubricElementIds.includes(el.id))) warn(p, `element "${el.id}" is not listed as assessable in any stage`, "not_assessable_anywhere");
    }
    if ((rule.kind === "after_question" || rule.kind === "either") && rule.questionIds.length === 0) err(`${p}.opportunityRule.questionIds`, `${rule.kind} opportunities need at least one question`);
    rule.questionIds.forEach((q, qi) => {
      if (!questionIds.has(q)) err(`${p}.opportunityRule.questionIds[${qi}]`, `unknown question "${q}"`);
    });
    const pp = el.promptingPolicy;
    const checkClass = (ids: string[], field: string, allowed: string[]) =>
      ids.forEach((q, qi) => {
        const qq = qById.get(q);
        if (!qq) err(`${p}.promptingPolicy.${field}[${qi}]`, `unknown question "${q}"`);
        else if (!allowed.includes(qq.promptClass)) err(`${p}.promptingPolicy.${field}[${qi}]`, `question "${q}" has promptClass ${qq.promptClass}; expected ${allowed.join(" or ")}`);
        else if (!qq.targetElementIds.includes(el.id) && !qq.suppliesElementIds.includes(el.id)) warn(`${p}.promptingPolicy.${field}[${qi}]`, `question "${q}" does not list this element as a target`);
      });
    checkClass(pp.standardQuestionIds, "standardQuestionIds", ["standard_question", "neutral"]);
    checkClass(pp.targetedProbeIds, "targetedProbeIds", ["targeted_probe"]);
    checkClass(pp.rescueIds, "rescueIds", ["rescue", "examiner_supplied"]);
    el.dependencyElementIds.forEach((d, di) => {
      if (!elementIds.has(d)) err(`${p}.dependencyElementIds[${di}]`, `unknown rubric element "${d}"`);
      if (d === el.id) err(`${p}.dependencyElementIds[${di}]`, "an element cannot depend on itself");
    });
    el.referenceIds.forEach((r, ri) => {
      if (!refIds.has(r)) err(`${p}.referenceIds[${ri}]`, `unknown source reference "${r}"`);
    });
    if (el.severity === "critical" && el.incorrectOrUnsafeClaims.length === 0 && el.domain === "management") {
      warn(`${p}.incorrectOrUnsafeClaims`, "critical management element has no listed unsafe claims", "critical_without_unsafe_claims");
    }
  });
  // Dependency cycles.
  const deps = new Map(cv.rubric.elements.map((e) => [e.id, e.dependencyElementIds]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      err("rubric.elements", `dependency cycle: ${[...trail, id].join(" -> ")}`, "dependency_cycle");
      return;
    }
    visiting.add(id);
    for (const d of deps.get(id) ?? []) visit(d, [...trail, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of deps.keys()) visit(id, []);

  // --- references, hints ---------------------------------------------------------
  if (!cv.referenceResponses.some((r) => r.kind === "concise_reference")) err("referenceResponses", "at least one concise_reference response is required");
  cv.referenceResponses.forEach((r, ri) =>
    r.coversElementIds.forEach((e, ei) => {
      if (!elementIds.has(e)) err(`referenceResponses[${ri}].coversElementIds[${ei}]`, `unknown rubric element "${e}"`);
    }),
  );
  cv.practice.hints.forEach((h, hi) =>
    h.elementIds.forEach((e, ei) => {
      if (!elementIds.has(e)) err(`practice.hints[${hi}].elementIds[${ei}]`, `unknown rubric element "${e}"`);
    }),
  );

  // --- leak / hint checks on candidate- and examiner-visible text ----------------
  const tokens = diagnosisTokens(cv);
  const scan = (path: string, text: string | null, audience: string) => {
    if (!text) return;
    const lower = text.toLowerCase();
    for (const t of tokens) {
      if (new RegExp(`\\b${t}`).test(lower)) warn(path, `${audience} text contains diagnosis term "${t}" — confirm it is not an answer leak`, "possible_answer_leak");
    }
  };
  scan("candidateTitle", cv.candidateTitle, "candidate-visible");
  cv.assets.forEach((a, i) => scan(`assets[${i}].neutralLabel`, a.neutralLabel, "candidate-visible"));
  cv.stages.forEach((s, si) => {
    scan(`stages[${si}].candidateHistory`, s.candidateHistory, "candidate-visible");
    scan(`stages[${si}].revealAnnouncement`, s.revealAnnouncement, "candidate-visible");
    scan(`stages[${si}].examinerNotes`, s.examinerNotes, "examiner-visible");
    s.approvedFactReplies.forEach((r, ri) => {
      if (r.suppliesElementIds.length === 0) scan(`stages[${si}].approvedFactReplies[${ri}].replyText`, r.replyText, "candidate-visible");
      scan(`stages[${si}].approvedFactReplies[${ri}].triggerDescription`, r.triggerDescription, "examiner-visible");
    });
  });
  cv.questions.forEach((q, qi) => {
    // Targeted probes and rescue questions are hints by design; their effect is handled by
    // prompt-dependence classification rather than flagged as leaks.
    const isHintByDesign = q.promptClass === "targeted_probe" || q.promptClass === "rescue" || q.promptClass === "examiner_supplied";
    if (q.suppliesElementIds.length === 0 && !isHintByDesign) scan(`questions[${qi}].text`, q.text, "candidate-visible");
    scan(`questions[${qi}].skipIfAlreadyAddressed`, q.skipIfAlreadyAddressed, "examiner-visible");
  });
  if (cv.clinicalTruth.leakCanary) {
    const canary = cv.clinicalTruth.leakCanary;
    const visible = JSON.stringify({
      t: cv.candidateTitle,
      a: cv.assets.map((a) => a.neutralLabel),
      s: cv.stages.map((s) => [s.candidateHistory, s.revealAnnouncement, s.examinerNotes]),
      q: cv.questions.map((q) => q.text),
    });
    if (visible.includes(canary)) err("clinicalTruth.leakCanary", "leak canary appears in candidate/examiner-visible text");
  }

  // Draft placeholders inserted by the importer must be replaced before review/approval.
  const placeholderPaths: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (v.includes(DRAFT_PLACEHOLDER)) placeholderPaths.push(path);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(cv, "");
  for (const p of placeholderPaths.slice(0, 50)) err(p, "draft placeholder must be completed before review", "draft_placeholder");

  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) return { ok: false, issues };
  return { ok: true, value: cv, warnings: issues };
}
