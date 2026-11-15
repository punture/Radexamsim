import type { ClockState } from "@sim/contracts";

/**
 * Server-owned station clock (spec §14). Time is accumulated active milliseconds plus the
 * currently running segment. All functions take `nowWallMs` explicitly so the clock is
 * deterministic in tests and survives process restarts (state is persisted).
 *
 * Candidate silence and ordinary navigation never pause the clock. Only declared technical
 * interruptions (and explicit practice-mode pauses) do.
 */

export function newClock(durationMs: number): ClockState {
  return { durationMs, accumulatedActiveMs: 0, runningSinceMs: null, pauses: [] };
}

export function elapsedActiveMs(clock: ClockState, nowWallMs: number): number {
  const running = clock.runningSinceMs === null ? 0 : Math.max(0, nowWallMs - clock.runningSinceMs);
  return clock.accumulatedActiveMs + running;
}

export function remainingMs(clock: ClockState, nowWallMs: number): number {
  return Math.max(0, clock.durationMs - elapsedActiveMs(clock, nowWallMs));
}

export function isExpired(clock: ClockState, nowWallMs: number): boolean {
  return remainingMs(clock, nowWallMs) <= 0;
}

export function isRunning(clock: ClockState): boolean {
  return clock.runningSinceMs !== null;
}

export function startClock(clock: ClockState, nowWallMs: number): ClockState {
  if (clock.runningSinceMs !== null) return clock; // idempotent
  const openPause = clock.pauses.find((p) => p.endedAtWallMs === null);
  return {
    ...clock,
    runningSinceMs: nowWallMs,
    pauses: openPause
      ? clock.pauses.map((p) => (p === openPause ? { ...p, endedAtWallMs: nowWallMs } : p))
      : clock.pauses,
  };
}

export type PauseReason = ClockState["pauses"][number]["reason"];

/**
 * Pause the clock. `effectiveAtWallMs` allows backdating a pause (e.g. to the end of the
 * reconnect grace window) but never earlier than the running segment start.
 */
export function pauseClock(
  clock: ClockState,
  nowWallMs: number,
  reason: PauseReason,
  effectiveAtWallMs: number = nowWallMs,
): ClockState {
  if (clock.runningSinceMs === null) return clock; // idempotent
  const effective = Math.min(nowWallMs, Math.max(clock.runningSinceMs, effectiveAtWallMs));
  const accumulated = Math.min(clock.durationMs, clock.accumulatedActiveMs + (effective - clock.runningSinceMs));
  return {
    ...clock,
    accumulatedActiveMs: accumulated,
    runningSinceMs: null,
    pauses: [...clock.pauses, { startedAtActiveMs: accumulated, reason, startedAtWallMs: effective, endedAtWallMs: null }],
  };
}

/** Freeze the clock at its final value (station end). */
export function stopClock(clock: ClockState, nowWallMs: number): ClockState {
  if (clock.runningSinceMs === null) return clock;
  return {
    ...clock,
    accumulatedActiveMs: Math.min(clock.durationMs, elapsedActiveMs(clock, nowWallMs)),
    runningSinceMs: null,
  };
}

export function totalPausedMs(clock: ClockState, nowWallMs: number): number {
  return clock.pauses.reduce((sum, p) => sum + ((p.endedAtWallMs ?? nowWallMs) - p.startedAtWallMs), 0);
}

/** Minutes consumed for usage accounting: active time rounded up per station. */
export function consumedMinutes(clock: ClockState, nowWallMs: number): number {
  const ms = elapsedActiveMs(clock, nowWallMs);
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

/** Time warnings that became due between two elapsed values. */
export function dueWarnings(
  durationMs: number,
  warningsAtSecondsRemaining: readonly number[],
  prevElapsedMs: number,
  nowElapsedMs: number,
): number[] {
  return warningsAtSecondsRemaining.filter((s) => {
    const at = durationMs - s * 1000;
    return prevElapsedMs < at && nowElapsedMs >= at;
  });
}
