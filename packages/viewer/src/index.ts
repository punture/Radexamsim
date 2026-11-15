export { Viewer, type ViewerProps } from "./Viewer";
export { Pane, type PaneProps } from "./Pane";
export { VIEWER_CSS } from "./styles";

/**
 * Viewer adapter contract (spec §8). Every adapter accepts the same props as `Pane`:
 * a candidate-safe asset (opaque handle), permitted controls, an authorized media URL
 * builder, and callbacks for render acknowledgement and viewing telemetry.
 * Implemented: still/stack/cine images (`Pane`).
 * Planned: Cornerstone3D StackViewport for validated de-identified DICOM stacks (only
 * once real DICOM source data exists; see docs/ARCHITECTURE.md).
 */
export type ViewerAdapterKind = "still_stack" | "cornerstone_dicom";
