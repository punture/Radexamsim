import Link from "next/link";
import { SiteHeader, type NavItem } from "@/components/SiteHeader";
import { BRAND_NOTE } from "@/lib/brand";

const LINKS: readonly NavItem[] = [
  ["/how-it-works", "How it works"],
  ["/pricing", "Pricing"],
  ["/faq", "FAQ"],
];

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader home="/" label="Main" links={LINKS} actions={<Link className="btn btn-sm btn-primary hide-sm" href="/app">Start practising</Link>} />
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="container">
          <nav aria-label="Footer">
            <Link href="/abr">ABR-oriented practice</Link>
            <Link href="/rcpsc">RCPSC-oriented practice</Link>
            <Link href="/demo">Free demonstration</Link>
            <Link href="/methodology">Methodology &amp; limitations</Link>
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/sign-in">Sign in</Link>
          </nav>
          <p style={{ margin: 0 }}>{BRAND_NOTE} Not a medical device and not for clinical diagnosis.</p>
        </div>
      </footer>
    </>
  );
}
