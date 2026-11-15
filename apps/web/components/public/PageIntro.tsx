import type { ReactNode } from "react";

/** Top-of-page introduction for public pages: optional eyebrow badge, the page's h1 and a lead paragraph. */
export function PageIntro({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="hero">
      <div className="container stack">
        {eyebrow && <span className="badge badge-info self-start">{eyebrow}</span>}
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}
