import Link from "next/link";
import type { ReactNode } from "react";

type CtaLink = { href: string; label: string };

/** Closing call to action used at the bottom of public pages. Render at most once per page (fixed heading id). */
export function CtaBand({
  title = "Try one case free",
  children,
  primary = { href: "/sign-up", label: "Start the free demonstration" },
  secondary = { href: "/demo", label: "What the demonstration includes" },
}: {
  title?: string;
  children?: ReactNode;
  primary?: CtaLink;
  secondary?: CtaLink | null;
}) {
  return (
    <section className="section" aria-labelledby="cta-title">
      <div className="container">
        <div className="card stack" style={{ alignItems: "flex-start" }}>
          <h2 id="cta-title" style={{ marginBottom: 0 }}>{title}</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
            {children ?? "One complete spoken practice case with examiner follow-up questions and an evidence-linked debrief. No payment needed for the demonstration."}
          </p>
          <div className="row">
            <Link className="btn btn-primary btn-lg" href={primary.href}>{primary.label}</Link>
            {secondary && <Link className="btn btn-lg" href={secondary.href}>{secondary.label}</Link>}
          </div>
        </div>
      </div>
    </section>
  );
}
