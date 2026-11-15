/** Viewer stylesheet (dark, high-contrast, no image cropping). Injected by the host app. */
export const VIEWER_CSS = `
.viewer { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #05070a; color: #d8dee6; }
.viewer-series { display: flex; gap: 6px; padding: 8px; flex-wrap: wrap; background: #0b0f14; border-bottom: 1px solid #1d2632; }
.viewer-series-item { display: flex; }
.viewer-series button { background: #151c25; color: #d8dee6; border: 1px solid #2a3543; border-radius: 6px; padding: 5px 9px; font: inherit; font-size: 0.86rem; cursor: pointer; }
.viewer-series button[aria-pressed="true"] { border-color: #38a3bd; background: #11303a; }
.viewer-series .viewer-compare { margin-left: -1px; border-top-left-radius: 0; border-bottom-left-radius: 0; }
.viewer-grid { flex: 1; display: grid; gap: 4px; padding: 4px; min-height: 0; }
.viewer-single { grid-template-columns: 1fr; }
.viewer-side_by_side { grid-template-columns: 1fr 1fr; }
.viewer-grid_2x2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.viewer-pane { position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0; background: #000; border: 1px solid #1d2632; border-radius: 4px; }
.viewer-pane:focus-visible { outline: 3px solid #f59e0b; outline-offset: -3px; }
.viewer-pane-label { display: flex; gap: 8px; align-items: center; padding: 4px 8px; font-size: 0.82rem; background: #0b0f14; }
.viewer-frame { margin-left: auto; font-family: ui-monospace, monospace; }
.viewer-badge { background: #ffd54a; color: #2a1d00; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem; }
.viewer-canvas { position: relative; flex: 1; overflow: hidden; display: grid; place-items: center; min-height: 240px; touch-action: none; cursor: grab; }
.viewer-canvas img { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center center; user-select: none; image-rendering: auto; }
.viewer-status { position: absolute; inset: auto 0 50% 0; text-align: center; color: #9aa7b6; font-size: 0.9rem; }
.viewer-error { color: #ffb4b4; padding: 0 16px; }
.viewer-controls { display: flex; gap: 6px; align-items: center; padding: 6px 8px; flex-wrap: wrap; background: #0b0f14; font-size: 0.85rem; }
.viewer-controls button { background: #151c25; color: #d8dee6; border: 1px solid #2a3543; border-radius: 6px; min-width: 32px; min-height: 30px; cursor: pointer; font: inherit; }
.viewer-controls input[type=range] { width: 140px; accent-color: #38a3bd; }
.viewer-zoom { font-family: ui-monospace, monospace; min-width: 44px; text-align: center; }
.viewer-adjust { position: relative; }
.viewer-adjust summary { cursor: pointer; padding: 4px 8px; border: 1px solid #2a3543; border-radius: 6px; }
.viewer-adjust[open] > :not(summary) { display: block; }
.viewer-adjust label { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.viewer-adjust small { color: #9aa7b6; display: block; max-width: 240px; }
@media (max-width: 860px) { .viewer-side_by_side, .viewer-grid_2x2 { grid-template-columns: 1fr; } }
`;
