import { eq, sql } from "drizzle-orm";
import type { EventType } from "@sim/contracts";
import type { DbOrTx } from "./client";
import { sessionEvents, stationSessions } from "./schema";

/**
 * Append a durable session event with the next per-session sequence number. Must run
 * inside the transaction that performs the corresponding state change; the UPDATE on the
 * session row serializes concurrent appends for the same session.
 */
export async function appendEvent(
  tx: DbOrTx,
  e: {
    sessionId: string;
    caseAttemptId: string | null;
    type: EventType;
    sessionClockMs: number;
    payload: Record<string, unknown>;
    contentVersions: { profileVersionId: string; caseVersionId: string | null; rubricVersionId: string | null };
  },
): Promise<{ id: string; seq: number }> {
  const [row] = await tx
    .update(stationSessions)
    .set({ eventSeq: sql`${stationSessions.eventSeq} + 1` })
    .where(eq(stationSessions.id, e.sessionId))
    .returning({ seq: stationSessions.eventSeq });
  if (!row) throw new Error(`session ${e.sessionId} not found`);
  const [ev] = await tx
    .insert(sessionEvents)
    .values({
      sessionId: e.sessionId,
      caseAttemptId: e.caseAttemptId,
      seq: row.seq,
      type: e.type,
      sessionClockMs: Math.max(0, Math.round(e.sessionClockMs)),
      payload: e.payload,
      contentVersions: e.contentVersions,
    })
    .returning({ id: sessionEvents.id });
  return { id: ev!.id, seq: row.seq };
}
