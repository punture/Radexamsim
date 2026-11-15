"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/useMe";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/brand";

const NAV = [
  ["/app", "Dashboard"],
  ["/app/setup", "New station"],
  ["/app/plan", "Learning plan"],
  ["/app/progress", "Progress"],
  ["/app/billing", "Billing"],
  ["/app/account", "Account"],
] as const;

/** Authenticated learner shell. Authorization is enforced by the API; this only routes. */
export function AppShell({ children, bare = false }: { children: React.ReactNode; bare?: boolean }) {
  const { me } = useMe();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (me && !me.authenticated) router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
  }, [me, router, path]);
  if (!me || !me.authenticated) return <div className="container page" role="status">Loading…</div>;
  if (bare) return <>{children}</>;
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/app" className="brand"><span className="brand-mark" aria-hidden>N</span>{BRAND}</Link>
          <nav className="nav" aria-label="Learner">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>
            ))}
            {me.user.role === "owner" && <Link href="/owner">Owner console</Link>}
          </nav>
          <div className="row">
            <span className="muted" style={{ fontSize: "0.88rem" }}>{me.user.email}</span>
            <button className="btn btn-sm" type="button" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.push("/"); }}>Sign out</button>
          </div>
        </div>
      </header>
      <main id="main" className="container page">{children}</main>
    </>
  );
}
