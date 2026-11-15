import { describe, expect, it } from "vitest";
import { loadFixtureCase, loadFixtureCases } from "@sim/fixtures";
import type { CaseVersion } from "@sim/contracts";
import {
  ALL_PROFILES,
  approvalMatches,
  canTransition,
  classifyChange,
  computeContentHashes,
  displayRating,
  publicationGate,
  validateCaseVersion,
} from "../src";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function approve(cv: CaseVersion): CaseVersion {
  const h = computeContentHashes(cv);
  return {
    ...cv,
    ownerApproval: {
      approvedBy: "owner-test-0001",
      approvedAt: "2026-11-15T00:00:00.000Z",
      ...h,
      attestation: "I approve this clinical content.",
      notes: "",
    },
  };
}

describe("case validation", () => {
  it("accepts every generated development fixture", () => {
    for (const cv of loadFixtureCases()) {
      const r = validateCaseVersion(cv);
      expect(r.ok, JSON.stringify(!r.ok && r.issues)).toBe(true);
    }
  });

  it("reports broken references with precise paths", () => {
    const cv = clone(loadFixtureCase("fx-stroke-lmca"));
    cv.stages[0]!.assetIds.push("does-not-exist");
    cv.stages[0]!.transitions[0]!.toStageId = "st-missing";
    cv.rubric.elements[2]!.opportunityRule.questionIds = ["q-missing"];
    const r = validateCaseVersion(cv);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.issues.map((i) => i.path);
    expect(paths).toContain("stages[0].assetIds[1]");
    expect(paths).toContain("stages[0].transitions[0].toStageId");
    expect(paths).toContain("rubric.elements[2].opportunityRule.questionIds[0]");
  });

  it("reports schema errors with paths (strict objects reject unknown keys)", () => {
    const cv = clone(loadFixtureCase("fx-stroke-lmca")) as unknown as Record<string, unknown>;
    (cv["stages"] as Record<string, unknown>[])[0]!["secretAnswer"] = "infarct";
    const r = validateCaseVersion(cv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === "stages[0]" && i.code === "unrecognized_keys")).toBe(true);
  });

  it("rejects placeholder media in a clinical (non-fixture) case", () => {
    const cv = clone(loadFixtureCase("fx-stroke-lmca"));
    cv.isDevelopmentFixture = false;
    cv.clinicalTruth.leakCanary = null;
    const r = validateCaseVersion(cv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.code === "placeholder_in_clinical_case")).toBe(true);
  });

  it("detects dependency cycles and unreachable stages", () => {
    const cv = clone(loadFixtureCase("fx-stroke-lmca"));
    cv.rubric.elements[0]!.dependencyElementIds = ["e-laterality"];
    cv.rubric.elements[1]!.dependencyElementIds = ["e-hypodensity"];
    cv.stages[0]!.transitions = [];
    cv.stages[0]!.approvedFactReplies = cv.stages[0]!.approvedFactReplies.filter((r) => r.kind !== "reveal");
    const r = validateCaseVersion(cv);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.code === "dependency_cycle")).toBe(true);
    expect(r.issues.some((i) => i.code === "unreachable_stage")).toBe(true);
  });

  it("warns when candidate-visible text contains a diagnosis term", () => {
    const cv = clone(loadFixtureCase("fx-stroke-lmca"));
    cv.assets[0]!.neutralLabel = "CT head showing infarct";
    const r = validateCaseVersion(cv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.code === "possible_answer_leak" && w.path === "assets[0].neutralLabel")).toBe(true);
  });

  it("requires examiner_supplied class for replies that supply rubric content", () => {
    const cv = clone(loadFixtureCase("fx-stroke-lmca"));
    cv.stages[0]!.approvedFactReplies[1]!.suppliesElementIds = ["e-dense-mca"];
    const r = validateCaseVersion(cv);
    expect(r.ok).toBe(false);
  });
});

describe("content hashing and approval binding", () => {
  it("is stable and binds approval to content", () => {
    const cv = approve(loadFixtureCase("fx-stroke-lmca"));
    expect(computeContentHashes(cv)).toEqual(computeContentHashes(clone(cv)));
    expect(approvalMatches(cv)).toBe(true);
  });

  it("treats wording changes as clinical and title/tag changes as display-only", () => {
    const base = loadFixtureCase("fx-stroke-lmca");
    const wording = clone(base);
    wording.questions[1]!.text = "What is your diagnosis?";
    expect(classifyChange(base, wording).kind).toBe("clinical");
    expect(approvalMatches({ ...wording, ownerApproval: approve(base).ownerApproval })).toBe(false);

    const display = clone(base);
    display.internalTitle = "Renamed";
    display.tags.pathology.push("lvo");
    expect(classifyChange(base, display).kind).toBe("display_only");
    expect(approvalMatches({ ...display, ownerApproval: approve(base).ownerApproval })).toBe(true);
  });

  it("treats a changed image digest or initial frame (possible hint) as clinical", () => {
    const base = loadFixtureCase("fx-stroke-lmca");
    const px = clone(base);
    px.assets[0]!.frames[0]!.sha256 = "0".repeat(64);
    expect(classifyChange(base, px)).toEqual({ kind: "clinical", changed: ["assets"] });
    const frame = clone(base);
    frame.assets[0]!.display.initialFrameIndex = 6;
    expect(classifyChange(base, frame).kind).toBe("clinical");
    const moved = clone(base);
    moved.assets[0]!.frames[0]!.storageKey = "elsewhere/0.png";
    expect(classifyChange(base, moved).kind).toBe("identical");
  });
});

describe("publication workflow", () => {
  it("allows only the defined transitions", () => {
    expect(canTransition("draft", "automated_checks").ok).toBe(true);
    expect(canTransition("draft", "published").ok).toBe(false);
    expect(canTransition("automated_checks", "draft").ok).toBe(true);
    expect(canTransition("published", "draft").ok).toBe(false);
    expect(canTransition("retired", "published").ok).toBe(false);
  });

  it("gates publication on approval, hashes, and separate rights/privacy clearance", () => {
    const fixture = loadFixtureCase("fx-stroke-lmca");
    expect(publicationGate(fixture, { allowFixtures: true })).toMatchObject({ ok: false, code: "not_owner_approved" });
    const approved = approve(fixture);
    expect(publicationGate(approved, { allowFixtures: true }).ok).toBe(true);
    expect(publicationGate(approved, { allowFixtures: false })).toMatchObject({ ok: false, code: "fixture_not_publishable" });

    const clinical = approve({ ...clone(fixture), isDevelopmentFixture: false });
    const noRights = approve({ ...clinical, clearances: { ...clinical.clearances, rights: null } });
    expect(publicationGate(noRights, { allowFixtures: false })).toMatchObject({ ok: false, code: "rights_not_cleared" });
    const noPrivacy = approve({ ...clinical, source: { ...clinical.source, privacyStatus: "checked" } });
    expect(publicationGate(noPrivacy, { allowFixtures: false })).toMatchObject({ ok: false, code: "privacy_not_cleared" });
  });
});

describe("profiles", () => {
  it("are all marked provisional until owner confirmation", () => {
    for (const p of ALL_PROFILES) expect(p.verification.status).toBe("provisional");
  });
  it("display ABR practice estimates on the 68–72 scale, never as percentages", () => {
    const abr = ALL_PROFILES.find((p) => p.board === "ABR")!;
    expect(displayRating(abr, "meets_expected")).toBe("70 — Satisfactory (practice estimate)");
    expect(displayRating(abr, "unsafe")).toMatch(/^68/);
    const rc = ALL_PROFILES.find((p) => p.board === "RCPSC")!;
    expect(displayRating(rc, "meets_expected")).toBe("Meets expected");
    if (rc.scoring.kind === "rcpsc_domains_qualitative") expect(rc.scoring.numericTotalsEnabled).toBe(false);
  });
});
