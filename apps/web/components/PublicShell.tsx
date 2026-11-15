import Link from "next/link";
import { BRAND, BRAND_NOTE } from "@/lib/brand";

const NAV = [
  ["/how-it-works", "How it works"],
  ["/rcpsc", "RCPSC-oriented"],
  ["/abr", "ABR-oriented"],
  ["/demo", "Demo"],
  ["/pricing", "Pricing"],
  ["/methodology", "Methodology"],
  ["/faq", "FAQ"],
] as const;

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand"><span className="brand-mark" aria-hidden>N</span>{BRAND}</Link>
          <nav className="nav" aria-label="Main">
            {NAV.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>
          <div className="row">
            <Link className="btn btn-sm" href="/sign-in">Sign in</Link>
            <Link className="btn btn-sm btn-primary" href="/sign-up">Start free demo</Link>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="container">
          <nav aria-label="Footer">
            <Link href="/methodology">Methodology &amp; limitations</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/support">Support</Link>
          </nav>
          <p style={{ margin: 0 }}>{BRAND_NOTE} Not a medical device and not for clinical diagnosis.</p>
        </div>
      </footer>
    </>
  );
}
