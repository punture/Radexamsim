"use client";
import { useMemo, useState } from "react";
import type { CandidateAsset, ViewerPane, ViewerPermissions } from "@sim/contracts";
import { Pane } from "./Pane";

/**
 * Multi-pane viewer with a neutral series list. The examination engine drives layout and
 * disclosure through ViewerCommands; the candidate keeps manual scrolling, zooming,
 * panning and display controls permitted by the profile.
 */
export type ViewerProps = {
  assets: CandidateAsset[];
  layout: "single" | "side_by_side" | "grid_2x2";
  panes: ViewerPane[];
  permissions: ViewerPermissions;
  mediaUrl: (handle: string, frame: number) => string;
  onRendered?: (handle: string, status: "rendered" | "failed", error: string | null, renderMs: number) => void;
  onViewSample?: (handle: string, frameIndex: number, viewedMs: number) => void;
  onInteraction?: () => void;
  /** Bumped when the examiner issues a new command, so panes re-mount at their presets. */
  commandSeq?: number;
};

export function Viewer({ assets, layout, panes, permissions, mediaUrl, onRendered, onViewSample, onInteraction, commandSeq = 0 }: ViewerProps) {
  const [override, setOverride] = useState<{ seq: number; handles: string[]; layout: ViewerProps["layout"] } | null>(null);
  const active = override && override.seq === commandSeq ? override : null;
  const effectiveLayout = active?.layout ?? layout;
  const handles = useMemo(() => {
    if (active) return active.handles;
    const fromPanes = panes.map((p) => p.handle).filter((h) => assets.some((a) => a.handle === h));
    return fromPanes.length ? fromPanes : assets.slice(0, 1).map((a) => a.handle);
  }, [active, panes, assets]);
  const maxPanes = effectiveLayout === "single" ? 1 : effectiveLayout === "side_by_side" ? 2 : 4;

  const choose = (handle: string, compare: boolean) => {
    onInteraction?.();
    if (compare && permissions.comparison) {
      const next = [...handles.filter((h) => h !== handle), handle].slice(-2);
      setOverride({ seq: commandSeq, handles: next, layout: next.length > 1 ? "side_by_side" : "single" });
    } else setOverride({ seq: commandSeq, handles: [handle], layout: "single" });
  };

  return (
    <div className="viewer">
      <nav className="viewer-series" aria-label="Image series">
        {assets.map((a) => (
          <div key={a.handle} className="viewer-series-item">
            <button type="button" aria-pressed={handles.includes(a.handle)} onClick={() => choose(a.handle, false)}>
              {a.label}
              {a.frameCount > 1 ? ` (${a.frameCount})` : ""}
            </button>
            {permissions.comparison && assets.length > 1 && (
              <button type="button" className="viewer-compare" onClick={() => choose(a.handle, true)} aria-label={`Compare ${a.label} side by side`}>
                ⇆
              </button>
            )}
          </div>
        ))}
      </nav>
      <div className={`viewer-grid viewer-${effectiveLayout}`}>
        {handles.slice(0, maxPanes).map((h, i) => {
          const asset = assets.find((a) => a.handle === h);
          if (!asset) return null;
          const preset = panes.find((p) => p.handle === h);
          return (
            <Pane
              key={`${h}-${commandSeq}-${i}`}
              asset={asset}
              initialFrame={preset?.frameIndex ?? null}
              permissions={permissions}
              mediaUrl={mediaUrl}
              onRendered={onRendered}
              onViewSample={onViewSample}
              onInteraction={onInteraction}
            />
          );
        })}
      </div>
    </div>
  );
}
