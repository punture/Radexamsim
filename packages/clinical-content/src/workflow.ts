import type { CaseVersion, PublicationStatus } from "@sim/contracts";
import { approvalMatches } from "./hash";

/**
 * Publication workflow (spec §3):
 *   draft -> automated_checks -> ready_for_owner -> owner_approved -> published -> retired
 * A failed automated check returns the case to draft with issues. Owner approval binds to
 * content hashes; a material change requires a new version and renewed approval.
 */

const NEXT: Record<PublicationStatus, readonly PublicationStatus[]> = {
  draft: ["automated_checks"],
  automated_checks: ["ready_for_owner", "draft"],
  ready_for_owner: ["owner_approved", "draft"],
  owner_approved: ["published", "draft"],
  published: ["retired"],
  retired: [],
};

export type WorkflowCheck = { ok: true } | { ok: false; code: string; message: string };

export function canTransition(from: PublicationStatus, to: PublicationStatus): WorkflowCheck {
  if (!NEXT[from].includes(to)) return { ok: false, code: "invalid_transition", message: `cannot move a case from ${from} to ${to}` };
  return { ok: true };
}

export type PublishGateOptions = {
  /** Development environments may publish fixtures for local testing only. */
  allowFixtures: boolean;
};

/**
 * Gates for publication. Clinical approval, rights clearance and privacy clearance are
 * separate requirements even though the owner may record all three.
 */
export function publicationGate(cv: CaseVersion, opts: PublishGateOptions): WorkflowCheck {
  if (!cv.ownerApproval) return { ok: false, code: "not_owner_approved", message: "the owner has not approved this version" };
  if (!approvalMatches(cv)) return { ok: false, code: "approval_hash_mismatch", message: "content changed after owner approval; a new approval is required" };
  if (cv.isDevelopmentFixture) {
    if (!opts.allowFixtures) return { ok: false, code: "fixture_not_publishable", message: "development fixtures cannot be published in this environment" };
    return { ok: true };
  }
  if (cv.source.privacyStatus !== "approved" || cv.clearances.privacy?.status !== "cleared") {
    return { ok: false, code: "privacy_not_cleared", message: "privacy/de-identification clearance is required before publication" };
  }
  if (cv.source.commercialRightsStatus !== "cleared" || cv.clearances.rights?.status !== "cleared") {
    return { ok: false, code: "rights_not_cleared", message: "commercial-use rights must be cleared before publication" };
  }
  return { ok: true };
}

/** May approved derivatives of this case be sent to an external AI provider? */
export function externalAiAllowed(cv: CaseVersion): boolean {
  return (
    cv.clearances.externalAiProcessingAllowed &&
    (cv.isDevelopmentFixture || (cv.source.privacyStatus === "approved" && cv.clearances.privacy?.status === "cleared"))
  );
}

/**
 * LLM_FIXTURES_ONLY is set when the model provider may keep or reuse what it receives (for
 * example a free-tier Gemini key). Then only fictional development fixtures may reach a model,
 * in every role: examiner, assessment, feedback, author and critics.
 */
export function modelUseAllowed(cv: Pick<CaseVersion, "isDevelopmentFixture">, fixturesOnly: boolean): boolean {
  return !fixturesOnly || cv.isDevelopmentFixture;
}
