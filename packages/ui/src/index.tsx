"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Small set of shared accessible components (class names match apps/web globals.css). */

export function Alert({ kind = "info", title, children }: { kind?: "info" | "warning" | "danger" | "success"; title?: string; children?: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "danger" ? "alert" : "status"}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

export function Badge({ kind, children }: { kind?: "info" | "warning" | "success" | "danger"; children: ReactNode }) {
  return <span className={`badge${kind ? ` badge-${kind}` : ""}`}>{children}</span>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="muted">
      {label}…
    </span>
  );
}

/** Native <dialog> confirmation with focus management. */
export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={onCancel} aria-labelledby="confirm-title" style={{ borderRadius: 12, border: "1px solid var(--border)", padding: 20, maxWidth: 460, background: "var(--surface)", color: "var(--text)" }}>
      <h2 id="confirm-title" style={{ fontSize: "1.2rem" }}>{title}</h2>
      <div style={{ marginBottom: 16 }}>{body}</div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function FixtureBanner() {
  return <div className="fixture-banner">Development fixture — fictional case with placeholder images. Not a patient and not scored clinically.</div>;
}

export function ProvisionalProfileNote({ status }: { status: string }) {
  if (status === "verified") return null;
  return (
    <Badge kind="warning">
      {status === "provisional" ? "Provisional practice configuration" : "Unverified configuration"}
    </Badge>
  );
}
