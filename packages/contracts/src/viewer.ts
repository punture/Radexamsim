import { z } from "zod";

/**
 * Common viewer protocol (spec §8). The examination engine talks to every viewer adapter
 * (still image, image stack, DICOM stack) through these commands and acknowledgements,
 * so it never depends on the image format.
 */

export const ViewerPermissions = z.strictObject({
  scroll: z.boolean(),
  zoomPan: z.boolean(),
  windowing: z.enum(["none", "display_brightness_contrast", "dicom_window_level"]),
  cine: z.boolean(),
  comparison: z.boolean(),
});
export type ViewerPermissions = z.infer<typeof ViewerPermissions>;

/** Candidate-safe description of one disclosed asset. `handle` is opaque and per-attempt. */
export const CandidateAsset = z.strictObject({
  handle: z.string().min(16).max(64),
  label: z.string(),
  kind: z.enum(["still", "stack", "cine", "dicom_stack"]),
  modality: z.string(),
  sequence: z.string().nullable(),
  plane: z.string().nullable(),
  frameCount: z.number().int().positive(),
  mimeType: z.string(),
  initialFrameIndex: z.number().int().min(0),
  initialZoom: z.union([z.literal("fit"), z.number()]),
  frameRateFps: z.number().nullable(),
  /** Stage ordinal at which the asset was disclosed (1-based), for neutral grouping. */
  disclosedAtStage: z.number().int().min(1),
  /** Development placeholder media: visibly labelled in the viewer. */
  isPlaceholder: z.boolean(),
});
export type CandidateAsset = z.infer<typeof CandidateAsset>;

export const ViewerPane = z.strictObject({
  paneId: z.string(),
  handle: z.string(),
  frameIndex: z.number().int().min(0).nullable(),
  zoom: z.union([z.literal("fit"), z.number()]),
});
export type ViewerPane = z.infer<typeof ViewerPane>;

export const ViewerCommand = z.strictObject({
  commandId: z.string().min(8),
  /** Monotonic per session. Clients ignore commands with seq <= last applied seq. */
  seq: z.number().int().min(1),
  caseAttemptId: z.string(),
  kind: z.enum(["load_assets", "set_layout", "select_series", "clear"]),
  layout: z.enum(["single", "side_by_side", "grid_2x2"]),
  panes: z.array(ViewerPane).max(4),
  /** Newly disclosed assets included with this command. */
  newAssets: z.array(CandidateAsset),
  /**
   * When true the client may defer applying the command while the candidate is actively
   * interacting, showing a non-disruptive notice instead (spec §4.7).
   */
  deferWhileInteracting: z.boolean(),
  /** The examiner will not speak about these images until a "rendered" ack arrives. */
  awaitAck: z.boolean(),
});
export type ViewerCommand = z.infer<typeof ViewerCommand>;

export const ViewerAck = z.strictObject({
  commandId: z.string(),
  status: z.enum(["rendered", "failed", "superseded", "deferred"]),
  panes: z.array(
    z.strictObject({
      handle: z.string(),
      status: z.enum(["rendered", "failed"]),
      error: z.string().max(300).nullable(),
      renderMs: z.number().int().min(0).nullable(),
    }),
  ),
});
export type ViewerAck = z.infer<typeof ViewerAck>;

/** Aggregated viewing telemetry: availability is recorded separately from actual viewing. */
export const ViewerViewSample = z.strictObject({
  handle: z.string(),
  frameIndex: z.number().int().min(0),
  viewedMs: z.number().int().min(0).max(60_000),
});
