import { z } from "zod";
import { IsoDateTime, OpaqueId } from "./common";

/**
 * Durable session events (spec §14). Each event has an id, attempt/case identifier,
 * server sequence number, server timestamp, type, payload schema version and the
 * relevant content versions. Events are append-only; sequence numbers are unique per
 * session and assigned inside the same transaction that changes session state.
 */
export const EventType = z.enum([
  "session.created",
  "session.preflight_recorded",
  "session.started",
  "session.technical_pause",
  "session.resumed",
  "session.time_warning",
  "session.ended",
  "session.finalized",
  "connection.opened",
  "connection.closed",
  "case.started",
  "case.closed",
  "stage.revealed",
  "viewer.command_sent",
  "viewer.rendered",
  "viewer.render_failed",
  "viewer.superseded",
  "viewer.viewed",
  "transcript.segment_finalized",
  "transcript.segment_revised",
  "examiner.utterance_planned",
  "examiner.audio_started",
  "examiner.audio_completed",
  "examiner.audio_interrupted",
  "examiner.audio_failed",
  "prompt.recorded",
  "policy.decision",
  "practice.hint_requested",
  "usage.reserved",
  "usage.consumed",
  "usage.released",
  "usage.adjusted",
]);
export type EventType = z.infer<typeof EventType>;

export const ContentVersions = z.strictObject({
  profileVersionId: z.string(),
  caseVersionId: z.string().nullable(),
  rubricVersionId: z.string().nullable(),
});
export type ContentVersions = z.infer<typeof ContentVersions>;

export const SessionEvent = z.strictObject({
  id: OpaqueId,
  sessionId: OpaqueId,
  caseAttemptId: OpaqueId.nullable(),
  seq: z.number().int().min(1),
  serverTime: IsoDateTime,
  /** Station clock (active ms) at the time of the event. */
  sessionClockMs: z.number().int().min(0),
  type: EventType,
  payloadSchemaVersion: z.number().int().min(1),
  payload: z.record(z.string(), z.unknown()),
  contentVersions: ContentVersions,
});
export type SessionEvent = z.infer<typeof SessionEvent>;

/**
 * Examiner policy decision record. Stores the proposed action, validation outcome and a
 * short operational note — never hidden model reasoning.
 */
export const PolicyDecisionPayload = z.strictObject({
  proposer: z.enum(["llm", "deterministic_fallback"]),
  proposed: z.record(z.string(), z.unknown()),
  accepted: z.boolean(),
  rejectionReason: z.string().nullable(),
  executed: z.record(z.string(), z.unknown()).nullable(),
  latencyMs: z.number().int().min(0),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
});
export type PolicyDecisionPayload = z.infer<typeof PolicyDecisionPayload>;
