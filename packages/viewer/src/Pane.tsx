"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CandidateAsset, ViewerPermissions } from "@sim/contracts";

/**
 * Still/stack/cine pane. One common interface for every image format the engine uses; a
 * DICOM adapter (Cornerstone3D) implements the same props for validated DICOM stacks.
 *
 * - Respects orientation and aspect ratio (object-fit: contain; no automatic cropping).
 * - Brightness/contrast here is a DISPLAY adjustment of a still image. It is never
 *   described as DICOM window/level.
 * - A frame counts as "rendered" only after the browser has decoded it and it is in the
 *   document; failures are reported, never hidden.
 */
export type PaneProps = {
  asset: CandidateAsset;
  initialFrame?: number | null;
  permissions: ViewerPermissions;
  mediaUrl: (handle: string, frame: number) => string;
  onRendered?: (handle: string, status: "rendered" | "failed", error: string | null, renderMs: number) => void;
  onViewSample?: (handle: string, frameIndex: number, viewedMs: number) => void;
  onInteraction?: () => void;
  active?: boolean;
  label?: string;
};

export function Pane({ asset, initialFrame, permissions, mediaUrl, onRendered, onViewSample, onInteraction, active = true, label }: PaneProps) {
  const [frame, setFrame] = useState(() => Math.min(asset.frameCount - 1, initialFrame ?? asset.initialFrameIndex));
  const [zoom, setZoom] = useState<number>(typeof asset.initialZoom === "number" ? asset.initialZoom : 1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadedFrames, setLoadedFrames] = useState<Set<number>>(new Set());
  const reported = useRef(false);
  const started = useRef(performance.now());
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const viewStart = useRef<{ frame: number; at: number } | null>(null);

  // Preload frames around the current one (stack scrolling must be immediate).
  useEffect(() => {
    const wanted = [frame, frame + 1, frame - 1, frame + 2, frame - 2].filter((f) => f >= 0 && f < asset.frameCount && !loadedFrames.has(f));
    for (const f of wanted) {
      const img = new Image();
      img.src = mediaUrl(asset.handle, f);
      img
        .decode()
        .then(() => setLoadedFrames((s) => new Set(s).add(f)))
        .catch(() => undefined);
    }
  }, [frame, asset.handle, asset.frameCount, mediaUrl, loadedFrames]);

  const flushView = useCallback(() => {
    if (viewStart.current && onViewSample) {
      const ms = Math.min(60_000, Math.round(performance.now() - viewStart.current.at));
      if (ms > 150) onViewSample(asset.handle, viewStart.current.frame, ms);
    }
    viewStart.current = active ? { frame, at: performance.now() } : null;
  }, [active, asset.handle, frame, onViewSample]);
  useEffect(() => {
    flushView();
    const t = setInterval(flushView, 2000);
    return () => clearInterval(t);
  }, [flushView]);

  useEffect(() => {
    if (!playing || !permissions.cine || asset.frameCount < 2) return;
    const fps = asset.frameRateFps ?? 8;
    const t = setInterval(() => setFrame((f) => (f + 1) % asset.frameCount), 1000 / fps);
    return () => clearInterval(t);
  }, [playing, permissions.cine, asset.frameCount, asset.frameRateFps]);

  const step = (d: number) => {
    if (!permissions.scroll) return;
    onInteraction?.();
    setFrame((f) => Math.max(0, Math.min(asset.frameCount - 1, f + d)));
  };
  const zoomBy = (factor: number) => {
    if (!permissions.zoomPan) return;
    onInteraction?.();
    setZoom((z) => Math.max(0.5, Math.min(8, Math.round(z * factor * 100) / 100)));
  };
  const reset = () => {
    setZoom(typeof asset.initialZoom === "number" ? asset.initialZoom : 1);
    setPan({ x: 0, y: 0 });
    setBrightness(100);
    setContrast(100);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else if (e.key === "0") reset();
    else if (e.key.toLowerCase() === "c" && permissions.cine) setPlaying((p) => !p);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      zoomBy(e.deltaY < 0 ? 1.1 : 0.9);
    } else if (asset.frameCount > 1) step(e.deltaY > 0 ? 1 : -1);
  };

  const onImgLoad = async (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    try {
      await img.decode();
    } catch {
      /* already decoded */
    }
    setStatus("ready");
    if (!reported.current) {
      reported.current = true;
      onRendered?.(asset.handle, "rendered", null, Math.round(performance.now() - started.current));
    }
  };
  const onImgError = () => {
    setStatus("error");
    if (!reported.current) {
      reported.current = true;
      onRendered?.(asset.handle, "failed", "image failed to load or decode", Math.round(performance.now() - started.current));
    }
  };

  const filter = permissions.windowing !== "none" ? `brightness(${brightness}%) contrast(${contrast}%)` : undefined;
  return (
    <div className="viewer-pane" onKeyDown={onKey} tabIndex={0} aria-label={`${label ?? asset.label}. ${asset.frameCount > 1 ? `Image ${frame + 1} of ${asset.frameCount}. Use arrow keys to scroll.` : ""}`} role="group">
      <div className="viewer-pane-label">
        <span>{asset.label}</span>
        {asset.isPlaceholder && <span className="viewer-badge">PLACEHOLDER — not a patient image</span>}
        {asset.frameCount > 1 && (
          <span className="viewer-frame" aria-live="off">
            {frame + 1}/{asset.frameCount}
          </span>
        )}
      </div>
      <div
        className="viewer-canvas"
        onWheel={onWheel}
        onPointerDown={(e) => {
          if (!permissions.zoomPan || zoom <= 1) return;
          onInteraction?.();
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {status === "loading" && <div className="viewer-status">Loading image…</div>}
        {status === "error" && (
          <div className="viewer-status viewer-error" role="alert">
            This image could not be displayed. This is a technical problem, not part of the case.
          </div>
        )}
        <img
          key={`${asset.handle}-${frame}`}
          src={mediaUrl(asset.handle, frame)}
          alt={`${asset.label}${asset.frameCount > 1 ? `, image ${frame + 1} of ${asset.frameCount}` : ""}`}
          draggable={false}
          onLoad={onImgLoad}
          onError={onImgError}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, filter, opacity: status === "error" ? 0 : 1 }}
        />
      </div>
      <div className="viewer-controls" role="toolbar" aria-label={`Controls for ${asset.label}`}>
        {asset.frameCount > 1 && permissions.scroll && (
          <>
            <button type="button" onClick={() => step(-1)} aria-label="Previous image">◀</button>
            <input type="range" min={0} max={asset.frameCount - 1} value={frame} onChange={(e) => { onInteraction?.(); setFrame(Number(e.target.value)); }} aria-label="Image position in stack" />
            <button type="button" onClick={() => step(1)} aria-label="Next image">▶</button>
          </>
        )}
        {asset.frameCount > 1 && permissions.cine && (
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? "Stop cine" : "Cine"}</button>
        )}
        {permissions.zoomPan && (
          <>
            <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
            <span className="viewer-zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
          </>
        )}
        {permissions.windowing !== "none" && (
          <details className="viewer-adjust">
            <summary>Display</summary>
            <label>
              Brightness <input type="range" min={40} max={200} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
            </label>
            <label>
              Contrast <input type="range" min={40} max={300} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} />
            </label>
            <small>Display adjustment of a still image — not DICOM window/level.</small>
          </details>
        )}
        <button type="button" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
