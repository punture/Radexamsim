import type {
  ApprovedAsset,
  CandidateAsset,
  CaseVersion,
  ExamProfileVersion,
  StageState,
  ViewerPermissions,
} from "@sim/contracts";
import { currentStage, disclosedAssetIds, getStage } from "./stage-graph";

/**
 * Candidate projections built by EXPLICIT ALLOWLIST (spec §6). Each output field is copied
 * deliberately; nothing is produced by deleting fields from a richer object. Clinical truth,
 * rubric, authored slugs, storage keys, annotations, filenames and tags never appear here.
 */

export function viewerPermissionsFor(profile: ExamProfileVersion, cv: CaseVersion, state: StageState): ViewerPermissions {
  const allowed = new Set(currentStage(cv, state).allowedActions);
  const v = profile.viewer;
  const windowing =
    v.windowing === "dicom_window_level" && allowed.has("viewer.window_level")
      ? "dicom_window_level"
      : v.windowing !== "none" && (allowed.has("viewer.brightness_contrast") || allowed.has("viewer.window_level"))
        ? "display_brightness_contrast"
        : "none";
  return {
    scroll: v.allowScroll && allowed.has("viewer.scroll"),
    zoomPan: v.allowZoomPan && allowed.has("viewer.zoom_pan"),
    windowing,
    cine: v.allowCine && allowed.has("viewer.cine"),
    comparison: v.allowComparison && allowed.has("viewer.compare"),
  };
}

export function projectCandidateAsset(asset: ApprovedAsset, handle: string, disclosedAtStage: number): CandidateAsset {
  const first = asset.frames[0]!;
  return {
    handle,
    label: asset.neutralLabel,
    kind: asset.kind,
    modality: asset.modality,
    sequence: asset.sequence,
    plane: asset.plane,
    frameCount: asset.frames.length,
    mimeType: first.mimeType,
    initialFrameIndex: Math.min(asset.display.initialFrameIndex, asset.frames.length - 1),
    initialZoom: asset.display.initialZoom,
    frameRateFps: asset.display.frameRateFps,
    disclosedAtStage,
    isPlaceholder: asset.isPlaceholder,
  };
}

/** Disclosed assets as candidate DTOs. `handles` maps authored asset id -> opaque handle. */
export function projectCandidateAssets(
  cv: CaseVersion,
  state: StageState,
  handles: Readonly<Record<string, string>>,
): CandidateAsset[] {
  const out: CandidateAsset[] = [];
  state.revealedStageIds.forEach((stageId, i) => {
    for (const assetId of getStage(cv, stageId).assetIds) {
      if (out.some((a) => a.handle === handles[assetId])) continue;
      const asset = cv.assets.find((a) => a.id === assetId);
      const handle = handles[assetId];
      if (!asset || !handle) continue; // never expose an asset without a server-issued handle
      out.push(projectCandidateAsset(asset, handle, i + 1));
    }
  });
  return out;
}

export function isAssetDisclosed(cv: CaseVersion, state: StageState, assetId: string): boolean {
  return disclosedAssetIds(cv, state).includes(assetId);
}
