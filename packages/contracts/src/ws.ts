import { z } from "zod";
import { CandidateSessionState } from "./dto";
import { ViewerAck, ViewerCommand, ViewerViewSample } from "./viewer";
import { SessionOutcome } from "./session";

/**
 * WebSocket contract between the browser and the live session controller (spec §14).
 * JSON text frames carry these messages. Binary frames carry audio:
 *   [u8 frameType][u16be headerLength][header JSON utf8][payload bytes]
 *   frameType 1 = candidate microphone PCM16LE mono (header: {seq})
 *   frameType 2 = examiner TTS audio chunk (header: {utteranceId, chunkIndex, mime, alignment?})
 */

export const CommandId = z.string().min(8).max(64);

export const ClientMessage = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello"), sessionId: z.string(), lastServerSeq: z.number().int().min(0) }),
  z.strictObject({ type: z.literal("start_station"), commandId: CommandId }),
  z.strictObject({
    type: z.literal("candidate_transcript"),
    commandId: CommandId,
    source: z.enum(["client_asr", "typed", "dev_injected"]),
    text: z.string().min(1).max(4000),
    clientStartMs: z.number().int().min(0),
    clientEndMs: z.number().int().min(0),
    confidence: z.number().min(0).max(1).nullable(),
    provider: z.strictObject({ name: z.string().max(60), model: z.string().max(60).nullable() }),
  }),
  z.strictObject({ type: z.literal("speech_activity"), state: z.enum(["started", "stopped"]), clientMs: z.number().int() }),
  z.strictObject({ type: z.literal("end_turn"), commandId: CommandId }),
  z.strictObject({
    type: z.literal("tts_playback"),
    utteranceId: z.string(),
    event: z.enum(["started", "progress", "completed", "interrupted", "failed"]),
    playedChars: z.number().int().min(0),
    error: z.string().max(300).nullable(),
  }),
  z.strictObject({ type: z.literal("viewer_ack"), ack: ViewerAck }),
  z.strictObject({ type: z.literal("viewer_view"), samples: z.array(ViewerViewSample).max(50) }),
  z.strictObject({ type: z.literal("viewer_interaction"), active: z.boolean() }),
  z.strictObject({ type: z.literal("request_end_case"), commandId: CommandId }),
  z.strictObject({ type: z.literal("request_end_station"), commandId: CommandId }),
  z.strictObject({ type: z.literal("practice_request_hint"), commandId: CommandId }),
  z.strictObject({ type: z.literal("practice_pause"), commandId: CommandId }),
  z.strictObject({ type: z.literal("practice_resume"), commandId: CommandId }),
  z.strictObject({
    type: z.literal("audio_start"),
    encoding: z.literal("linear16"),
    sampleRate: z.union([z.literal(16000), z.literal(24000), z.literal(48000)]),
  }),
  z.strictObject({ type: z.literal("audio_stop") }),
  z.strictObject({ type: z.literal("ping"), clientMs: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("state"), seq: z.number().int(), state: CandidateSessionState }),
  z.strictObject({
    type: z.literal("examiner_utterance"),
    seq: z.number().int(),
    utteranceId: z.string(),
    kind: z.string(),
    text: z.string(),
    tts: z.strictObject({ mode: z.enum(["browser", "server_stream", "none"]), voice: z.string().nullable() }),
  }),
  z.strictObject({ type: z.literal("examiner_cancel"), seq: z.number().int(), utteranceId: z.string(), reason: z.string() }),
  z.strictObject({ type: z.literal("viewer_command"), seq: z.number().int(), command: ViewerCommand }),
  z.strictObject({
    type: z.literal("clock"),
    remainingMs: z.number().int(),
    running: z.boolean(),
    serverNowMs: z.number().int(),
  }),
  z.strictObject({
    type: z.literal("transcript_echo"),
    seq: z.number().int(),
    segmentId: z.string(),
    text: z.string(),
    interim: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("notice"),
    seq: z.number().int(),
    level: z.enum(["info", "warning", "error"]),
    code: z.string(),
    message: z.string(),
  }),
  z.strictObject({
    type: z.literal("command_result"),
    commandId: z.string(),
    ok: z.boolean(),
    error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
  }),
  z.strictObject({ type: z.literal("station_ended"), seq: z.number().int(), outcome: SessionOutcome }),
  z.strictObject({ type: z.literal("pong"), clientMs: z.number(), serverNowMs: z.number().int() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export const BINARY_FRAME_MIC = 1;
export const BINARY_FRAME_TTS = 2;

export function encodeBinaryFrame(frameType: number, header: unknown, payload: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  if (headerBytes.length > 0xffff) throw new Error("binary frame header too large");
  const out = new Uint8Array(3 + headerBytes.length + payload.length);
  out[0] = frameType;
  out[1] = (headerBytes.length >> 8) & 0xff;
  out[2] = headerBytes.length & 0xff;
  out.set(headerBytes, 3);
  out.set(payload, 3 + headerBytes.length);
  return out;
}

export function decodeBinaryFrame(data: Uint8Array): { frameType: number; header: unknown; payload: Uint8Array } {
  if (data.length < 3) throw new Error("binary frame too short");
  const frameType = data[0]!;
  const headerLength = (data[1]! << 8) | data[2]!;
  if (3 + headerLength > data.length) throw new Error("binary frame header length exceeds frame");
  const header = JSON.parse(new TextDecoder().decode(data.subarray(3, 3 + headerLength))) as unknown;
  return { frameType, header, payload: data.subarray(3 + headerLength) };
}
