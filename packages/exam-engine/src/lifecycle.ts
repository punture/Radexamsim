import type { SessionOutcome, SessionStatus } from "@sim/contracts";

/**
 * Session lifecycle (spec §7). Pure: callers persist the result transactionally with
 * optimistic concurrency (version column) so two requests cannot race a transition.
 */
const ALLOWED: Record<SessionStatus, readonly SessionStatus[]> = {
  preflight: ["ready", "aborted"],
  ready: ["active", "aborted", "preflight"],
  active: ["technically_interrupted", "finalizing", "aborted"],
  technically_interrupted: ["active", "finalizing", "aborted"],
  finalizing: ["complete"],
  complete: [],
  aborted: [],
};

export type LifecycleResult =
  | { ok: true; status: SessionStatus; changed: boolean }
  | { ok: false; code: "invalid_transition"; message: string };

export function transitionSession(from: SessionStatus, to: SessionStatus): LifecycleResult {
  if (from === to) return { ok: true, status: to, changed: false }; // idempotent
  if (!ALLOWED[from].includes(to)) {
    return { ok: false, code: "invalid_transition", message: `cannot move session from ${from} to ${to}` };
  }
  return { ok: true, status: to, changed: true };
}

export function isTerminal(status: SessionStatus): boolean {
  return status === "complete" || status === "aborted";
}

export function isLive(status: SessionStatus): boolean {
  return status === "active" || status === "technically_interrupted";
}

/** Platform failures are distinguished from user-aborted sessions for usage adjustment. */
export function outcomeIsPlatformFailure(outcome: SessionOutcome | null): boolean {
  return outcome === "invalidated_technical";
}

export const END_STATION_REASONS = ["time_expired", "candidate_ended", "all_cases_complete", "technical_invalidation", "user_aborted"] as const;
export type EndStationReason = (typeof END_STATION_REASONS)[number];

export function outcomeForEndReason(reason: EndStationReason): SessionOutcome {
  switch (reason) {
    case "time_expired":
      return "time_expired";
    case "candidate_ended":
      return "candidate_ended";
    case "all_cases_complete":
      return "completed";
    case "technical_invalidation":
      return "invalidated_technical";
    case "user_aborted":
      return "user_aborted";
  }
}
