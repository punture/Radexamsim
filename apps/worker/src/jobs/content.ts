import type { CaseVersion } from "@sim/contracts";
import { CaseVersion as CaseVersionSchema } from "@sim/contracts";
import { approvalMatches, computeContentHashes, externalAiAllowed, modelUseAllowed, validateCaseVersion } from "@sim/clinical-content";
import { caseAuthorPrompt, clinicalCriticPrompt, rubricCriticPrompt, runPrompt, type AuthorOutput } from "@sim/ai";
import { caseReviews, caseVersions, enqueue, eq, ownerReviewItems, sql } from "@sim/db";
import type { WorkerDeps } from "../deps";

/**
 * Case-content jobs (spec §3, §5). LLM faculty draft and critique; only the owner approves.
 * External model calls on case material are gated by the case's clearance flags.
 */
export async function runContentJob(
  deps: WorkerDeps,
  kind: "case_automated_checks" | "case_llm_critique" | "case_llm_author",
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const versionId = String(p.versionId);
  const [row] = await deps.db.select().from(caseVersions).where(eq(caseVersions.versionId, versionId));
  if (!row) return { skipped: "version not found" };
  const cv = CaseVersionSchema.parse(row.payload);
  if (kind === "case_automated_checks") return automatedChecks(deps, row.versionId, cv);
  if (kind === "case_llm_critique") return critique(deps, cv, p.focus === "rubric" ? "rubric" : "clinical");
  return author(deps, cv, p);
}

async function automatedChecks(deps: WorkerDeps, versionId: string, cv: CaseVersion) {
  const v = validateCaseVersion(cv);
  const issues = v.ok ? v.warnings : v.issues;
  const errors = issues.filter((i) => i.severity === "error");
  const next = errors.length ? "draft" : "ready_for_owner";
  const hashes = computeContentHashes(cv);
  // An approval recorded against different content is void.
  const payload: CaseVersion = { ...cv, publicationStatus: next, ownerApproval: cv.ownerApproval && approvalMatches(cv) ? cv.ownerApproval : null };
  await deps.db.transaction(async (tx) => {
    await tx
      .update(caseVersions)
      .set({ payload, publicationStatus: next, validationIssues: issues, ...hashes, updatedAt: new Date(), rowVersion: sql`${caseVersions.rowVersion} + 1` })
      .where(eq(caseVersions.versionId, versionId));
    await tx.insert(caseReviews).values({ caseVersionId: versionId, reviewer: "automated_checks", status: "complete", issues, summary: errors.length ? `${errors.length} blocking issue(s); returned to draft.` : `Passed with ${issues.length} warning(s).` });
    if (!errors.length) {
      await tx
        .insert(ownerReviewItems)
        .values({ kind: "case_ready_for_approval", priority: "normal", title: `Ready for your review: ${cv.internalTitle}`, detail: `${issues.length} warning(s) from automated checks. LLM critiques are attached when available.`, refs: { versionId }, dedupeKey: `ready:${versionId}:${hashes.clinicalContentHash.slice(0, 12)}` })
        .onConflictDoNothing();
      if (deps.providerFor("clinical_critic")) {
        await enqueue(tx, { kind: "case_llm_critique", payload: { versionId, focus: "clinical" }, dedupeKey: `critique:clinical:${versionId}:${hashes.clinicalContentHash.slice(0, 12)}` });
        await enqueue(tx, { kind: "case_llm_critique", payload: { versionId, focus: "rubric" }, dedupeKey: `critique:rubric:${versionId}:${hashes.clinicalContentHash.slice(0, 12)}` });
      }
    }
  });
  return { next, errors: errors.length, warnings: issues.length - errors.length };
}

/** Case JSON for critics with storage locations removed. */
function critiqueJson(cv: CaseVersion): string {
  const { ownerApproval: _a, changeLog: _c, clearances: _cl, ...rest } = cv;
  return JSON.stringify({ ...rest, assets: cv.assets.map(({ frames, ...a }) => ({ ...a, frameCount: frames.length })) });
}

async function critique(deps: WorkerDeps, cv: CaseVersion, focus: "clinical" | "rubric") {
  const reviewer = focus === "clinical" ? "clinical_critic" : "rubric_critic";
  const provider = deps.providerFor(reviewer);
  if (!provider) return { skipped: "no model configured" };
  if (!modelUseAllowed(cv, deps.config.LLM_FIXTURES_ONLY)) {
    await deps.db.insert(caseReviews).values({ caseVersionId: cv.versionId, reviewer, status: "unavailable", issues: [], summary: "Not run: LLM_FIXTURES_ONLY is set, so only fictional development fixtures are sent to the model." });
    return { skipped: "LLM_FIXTURES_ONLY" };
  }
  if (!externalAiAllowed(cv)) {
    await deps.db.insert(caseReviews).values({ caseVersionId: cv.versionId, reviewer, status: "unavailable", issues: [], summary: "Not run: external AI processing is not permitted for this case (privacy/rights clearance)." });
    return { skipped: "external AI not permitted" };
  }
  const [row] = await deps.db.select().from(caseVersions).where(eq(caseVersions.versionId, cv.versionId));
  const r = await runPrompt(focus === "clinical" ? clinicalCriticPrompt : rubricCriticPrompt, { caseJson: critiqueJson(cv), focus, automatedIssues: ((row?.validationIssues ?? []) as { path: string; message: string; severity: string }[]).slice(0, 50) }, {
    routing: { provider, model: deps.modelFor(reviewer) },
    onTelemetry: (t) => deps.recordModelCall(t, { caseVersionId: cv.versionId }),
  });
  await deps.db.insert(caseReviews).values({
    caseVersionId: cv.versionId,
    reviewer,
    status: r.ok ? "complete" : "failed",
    issues: r.ok ? r.data.issues : [],
    summary: r.ok ? r.data.summary : `Critique unavailable (${r.reason}).`,
    provenance: r.provenance ?? undefined,
  });
  if (r.ok && r.data.issues.some((i) => i.severity === "blocker" || i.requiresOwnerDecision)) {
    await deps.db
      .insert(ownerReviewItems)
      .values({ kind: "uncertain_finding", priority: "normal", title: `${focus === "clinical" ? "Clinical" : "Rubric"} critic raised issues needing your decision`, detail: r.data.issues.filter((i) => i.severity === "blocker" || i.requiresOwnerDecision).map((i) => `${i.path ?? i.area}: ${i.problem}`).join(" | ").slice(0, 1500), refs: { versionId: cv.versionId }, dedupeKey: `critic:${focus}:${cv.versionId}:${Date.now()}` })
      .onConflictDoNothing();
  }
  return { ok: r.ok, issues: r.ok ? r.data.issues.length : 0 };
}

/**
 * LLM case author: drafts the stage graph, questions, rubric and reference response into
 * an existing DRAFT version (which already holds the owner's imported assets and source
 * references). The draft returns to automated checks; it is never published automatically.
 */
async function author(deps: WorkerDeps, cv: CaseVersion, p: Record<string, unknown>) {
  const provider = deps.providerFor("case_author");
  if (!provider) return { skipped: "no model configured" };
  if (cv.publicationStatus !== "draft") return { skipped: "only drafts can be authored" };
  if (!modelUseAllowed(cv, deps.config.LLM_FIXTURES_ONLY)) return { skipped: "LLM_FIXTURES_ONLY: only fictional development fixtures are sent to the model" };
  if (!externalAiAllowed(cv)) return { skipped: "external AI processing not permitted for this case" };
  const r = await runPrompt(
    caseAuthorPrompt,
    {
      ownerNotes: String(p.ownerNotes ?? ""),
      sourceDiagnosis: cv.clinicalTruth.finalDiagnosis,
      diagnosticBasis: cv.source.diagnosticBasis,
      truthStatus: cv.source.truthStatus,
      availableImages: cv.assets.map((a) => ({ assetId: a.id, label: a.neutralLabel, modality: a.modality, sequence: a.sequence, plane: a.plane, frameCount: a.frames.length })),
      teachingTextFromSource: String(p.teachingText ?? ""),
      targetProfiles: cv.eligibleProfileVersions,
      imagesAttached: false,
    },
    { routing: { provider, model: deps.modelFor("case_author") }, onTelemetry: (t) => deps.recordModelCall(t, { caseVersionId: cv.versionId }) },
  );
  if (!r.ok) {
    await deps.db.insert(caseReviews).values({ caseVersionId: cv.versionId, reviewer: "case_author", status: "failed", issues: [], summary: `Authoring unavailable (${r.reason}).` });
    return { ok: false };
  }
  const merged = mergeAuthorDraft(cv, r.data);
  const v = validateCaseVersion(merged);
  await deps.db.transaction(async (tx) => {
    await tx.update(caseVersions).set({ payload: merged, validationIssues: v.ok ? v.warnings : v.issues, updatedAt: new Date() }).where(eq(caseVersions.versionId, cv.versionId));
    await tx.insert(caseReviews).values({
      caseVersionId: cv.versionId,
      reviewer: "case_author",
      status: "complete",
      issues: [...r.data.unknowns.map((u) => ({ severity: "major", area: "unknown", path: null, problem: u, suggestedRevision: null, requiresOwnerDecision: true })), ...r.data.assumptionsNeedingOwnerConfirmation.map((u) => ({ severity: "major", area: "assumption", path: null, problem: u, suggestedRevision: null, requiresOwnerDecision: true }))],
      summary: `Draft generated. ${r.data.unknowns.length} unknown(s) and ${r.data.assumptionsNeedingOwnerConfirmation.length} assumption(s) need your input.${r.data.imageFindingsAreProvisional ? " Image findings are provisional." : ""}`,
      provenance: r.provenance ?? undefined,
    });
  });
  return { ok: true, valid: v.ok };
}

const DEFAULT_CREDIT = { spontaneous: "full", standard_question: "full", targeted_probe: "partial", rescue: "none", examiner_supplied: "none" } as const;

export function mergeAuthorDraft(cv: CaseVersion, d: AuthorOutput): CaseVersion {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
  const anchors = cv.rubric.domains;
  return {
    ...cv,
    clinicalTruth: {
      ...cv.clinicalTruth,
      keyFindings: d.keyFindings.length ? d.keyFindings.map((k) => ({ ...k, id: slug(k.id) })) : cv.clinicalTruth.keyFindings,
      acceptableDiagnoses: d.acceptableDiagnoses,
      differential: d.differential,
      managementExpectations: d.managementExpectations,
      urgency: d.urgency,
    },
    openingStageId: slug(d.stages[0]?.id ?? cv.openingStageId),
    stages: d.stages.map((s, i) => ({
      id: slug(s.id),
      ordinal: i,
      label: s.label,
      candidateHistory: s.candidateHistory || (i === 0 ? d.candidateHistory : ""),
      assetIds: s.assetIds,
      viewportPresetIds: [],
      defaultViewportPresetId: null,
      allowedActions: ["viewer.scroll", "viewer.zoom_pan", "viewer.brightness_contrast", "viewer.compare", "viewer.cine", "examiner.request_stage_reveal", "examiner.deliver_question", "examiner.deliver_fact_reply", "examiner.advance_case", "examiner.select_series"],
      allowedQuestionIds: s.questionIds.map(slug),
      approvedFactReplies: s.factReplies.map((f) => ({ ...f, id: slug(f.id), revealsStageId: f.revealsStageId ? slug(f.revealsStageId) : null, suppliesElementIds: [], promptClass: "neutral" as const })),
      transitions: s.transitions.map((t, ti) => ({ id: `t-${slug(s.id)}-${ti}`, toStageId: slug(t.toStageId), trigger: t.trigger, viaFactReplyId: t.viaFactReplyId ? slug(t.viaFactReplyId) : null, afterQuestionIds: t.afterQuestionIds.map(slug), minCaseElapsedSeconds: null, description: t.description })),
      assessableRubricElementIds: d.rubricElements.filter((e) => slug(e.stageId) === slug(s.id)).map((e) => slug(e.id)),
      examinerNotes: s.examinerNotes,
      revealAnnouncement: s.revealAnnouncement,
    })),
    questions: d.questions.map((q, i) => ({
      id: slug(q.id),
      text: q.text,
      purpose: q.purpose,
      promptClass: q.purpose === "opening" || q.purpose === "clarification" || q.purpose === "closing" ? "neutral" : q.purpose === "targeted_probe" ? "targeted_probe" : q.purpose === "rescue" ? "rescue" : "standard_question",
      targetElementIds: q.targetElementIds.map(slug),
      suppliesElementIds: [],
      modes: ["exam", "practice"],
      order: i,
      skipIfAlreadyAddressed: q.skipIfAlreadyAddressed,
      addressedPatterns: q.addressedPatterns,
    })),
    rubric: {
      ...cv.rubric,
      domains: anchors,
      elements: d.rubricElements.map((e) => ({
        id: slug(e.id),
        domain: e.domain,
        construct: e.construct,
        acceptedConcepts: e.acceptedConcepts,
        acceptableAlternatives: e.acceptableAlternatives,
        incorrectOrUnsafeClaims: e.incorrectOrUnsafeClaims,
        requiredAssetIds: e.requiredAssetIds,
        opportunityRule: { kind: e.opportunityKind, stageId: slug(e.stageId), questionIds: e.questionIds.map(slug), requireAllAssetsRendered: false, minExposureSeconds: 15 },
        promptingPolicy: { spontaneousExpected: e.opportunityKind !== "after_question", standardQuestionIds: [], targetedProbeIds: [], rescueIds: [], credit: DEFAULT_CREDIT },
        severity: e.severity,
        dependencyElementIds: [],
        referenceIds: [cv.source.references[0]!.id],
        skills: e.skills,
        feedbackGuidance: { whyItMatters: e.whyItMatters, strongerResponse: e.strongerResponse, practiceAction: e.practiceAction },
      })),
    },
    referenceResponses: [{ id: "ref-concise", kind: "concise_reference", text: d.referenceResponse, coversElementIds: d.rubricElements.map((e) => slug(e.id)) }],
    ownerApproval: null,
    publicationStatus: "draft",
  };
}
