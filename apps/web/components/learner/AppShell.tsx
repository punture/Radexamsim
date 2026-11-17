"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { SiteHeader, TestModePill, type NavItem } from "@/components/SiteHeader";
import { useMe } from "@/lib/useMe";
import { api } from "@/lib/api";

const LINKS: readonly NavItem[] = [
  ["/app", "Dashboard"],
  ["/app/setup", "New station"],
  ["/app/progress", "Progress"],
  ["/app/plan", "Learning plan"],
];

/** Learner shell. Authorization is enforced by the API; this only routes. */
export function AppShell({ children, bare = false }: { children: React.ReactNode; bare?: boolean }) {
  const path = usePathname();
  // Testing mode: station pages keep whoever started the station (owner previews run there).
  const { me } = useMe("learner", !path.startsWith("/app/session/"));
  const router = useRouter();
  useEffect(() => {
    if (me && !me.authenticated) router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
  }, [me, router, path]);
  if (!me || !me.authenticated) return <div className="container page" role="status">Loading…</div>;
  if (bare) return <>{children}</>;
  const testing = me.devAutoLogin === true;
  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/");
  };
  return (
    <>
      <SiteHeader
        home="/app"
        label="Learner"
        links={LINKS}
        actions={
          <>
            {testing && <TestModePill />}
            <details className="menu">
              <summary>Account</summary>
              <div className="menu-panel">
                <p className="menu-note">{me.user.email}</p>
                <Link href="/app/account">Account and consent</Link>
                <Link href="/app/billing">Billing</Link>
                <Link href="/app/appeals">Appeals</Link>
                {(me.user.role === "owner" || testing) && <Link href="/owner">Owner console</Link>}
                <hr />
                <button type="button" onClick={signOut}>Sign out</button>
              </div>
            </details>
          </>
        }
      />
      <main id="main" className="container page">{children}</main>
    </>
  );
}
