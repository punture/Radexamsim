import type { ElementStatus, PromptingLevel, RatingLevel } from "@sim/contracts";

/**
 * Evaluation fixtures (spec §18).
 *
 * A response pattern is a scripted, timed case attempt: what the examiner said (by approved
 * id) and what the candidate said, plus the intended judgment. Intended judgments are the
 * human reference ONLY once the owner has approved them; until then every report labels them
 * "developer-authored, pending owner approval". Development fixture cases are fictional.
 */

export type PatternLevel = "strong" | "satisfactory" | "borderline" | "poor" | "consequential_error" | "uncertainty" | "edge_case";

export type Turn =
  | { kind: "candidate"; text: string; confidence?: number; source?: "server_asr" | "client_asr" | "typed" | "dev_injected" }
  /** Approved question by id. `interruptedAtChar` simulates barge-in: only that much was played. */
  | { kind: "question"; questionId: string; interruptedAtChar?: number }
  /** Approved fact reply by id; a reveal-kind reply also reveals its stage. */
  | { kind: "fact_reply"; replyId: string }
  /** Examiner-initiated reveal through an authored transition. */
  | { kind: "reveal"; stageId: string }
  | { kind: "neutral"; phraseId: string; text: string }
  | { kind: "silence"; ms: number };

export type ElementExpectation = {
  /** Acceptable statuses; the first is the reference label used for agreement statistics. */
  status: ElementStatus[];
  /** Expected prompting level for credited elements (optional). */
  prompting?: PromptingLevel;
  /** Expected credit (e.g. "none" when the examiner supplied the content). */
  credit?: "full" | "partial" | "none" | "not_applicable";
};

export type ResponsePattern = {
  id: string;
  caseId: string;
  level: PatternLevel;
  description: string;
  /** Regression/behaviour tags, e.g. negation, laterality, self_correction, accepted_alternative. */
  tags: string[];
  turns: Turn[];
  renderFailures?: string[];
  endedByTechnicalFailure?: boolean;
  /**
   * Examiner turns (by index into `turns`) that supply rubric content, simulating an
   * approved targeted hint or rescue. Only used for prompt-dependence regression patterns.
   */
  supplied?: { turnIndex: number; elementIds: string[] }[];
  expected: {
    elements: Record<string, ElementExpectation>;
    /** Acceptable global levels (null = withheld acceptable); the first is the reference label. */
    global: (RatingLevel | null)[];
    /** Approved unsafe criteria that must be flagged. */
    unsafeCriteria: string[];
    /** True when a rating at meets_expected or better would be false reassurance. */
    mustNotPass: boolean;
  };
};

export type ApprovalRecord = {
  patternId: string;
  status: "pending_owner_approval" | "owner_approved" | "owner_rejected";
  contentHash: string;
  approvedOn: string | null;
  notes: string | null;
};

export type Variant = "base" | "rephrased" | "verbose" | "asr_noisy";

export type Split = "tuning" | "final";
