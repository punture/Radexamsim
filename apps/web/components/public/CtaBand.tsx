import Link from "next/link";
import type { ReactNode } from "react";

type CtaLink = { href: string; label: string };

/** Closing call to action used at the bottom of public pages. Render at most once per page (fixed heading id). */
export function CtaBand({
  title = "Try one case free",
  children,
  primary = { href: "/app/setup?demo=1", label: "Try a free case" },
  secondary = null,
}: {
  title?: string;
  children?: ReactNode;
  primary?: CtaLink;
  secondary?: CtaLink | null;
}) {
  return (
    <section className="section" aria-labelledby="cta-title">
      <div className="container">
        <div className="card row-between" style={{ padding: 24 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h2 id="cta-title" style={{ margin: 0 }}>{title}</h2>
            <p className="muted" style={{ margin: 0, maxWidth: 620 }}>
              {children ?? "One spoken case with examiner questions and feedback. No payment needed."}
            </p>
          </div>
          <div className="row">
            <Link className="btn btn-primary btn-lg" href={primary.href}>{primary.label}</Link>
            {secondary && <Link className="btn btn-lg" href={secondary.href}>{secondary.label}</Link>}
          </div>
        </div>
      </div>
    </section>
  );
}
