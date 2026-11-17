"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteHeader, TestModePill, type NavItem } from "@/components/SiteHeader";
import { api, ApiError } from "@/lib/api";
import { devLogin, useMe } from "@/lib/useMe";

const LINKS: readonly NavItem[] = [
  ["/owner", "Queue"],
  ["/owner/cases", "Cases"],
  ["/owner/sessions", "Attempts"],
  ["/owner/appeals", "Appeals"],
];
const MORE: readonly NavItem[] = [
  ["/owner/import", "Import cases"],
  ["/owner/coverage", "Coverage"],
  ["/owner/metrics", "Metrics"],
  ["/owner/config", "Configuration"],
];

/** Owner console shell: requires the owner role and a verified second factor (enforced by the API). */
export function OwnerShell({ children }: { children: React.ReactNode }) {
  const { me, reload } = useMe("owner");
  const router = useRouter();
  const path = usePathname();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (me && !me.authenticated) router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
  }, [me, router, path]);
  if (!me || !me.authenticated) return <div className="container page" role="status">Loading…</div>;
  if (me.user.role !== "owner") return <div className="container page"><div className="alert alert-danger">The owner console is restricted to the owner account.</div></div>;
  if (me.mfa.requiredForOwner && !me.mfa.verified) {
    return (
      <div className="container page">
        <form className="card stack" style={{ maxWidth: 420, margin: "0 auto" }} onSubmit={async (e) => { e.preventDefault(); try { await api("/api/auth/mfa/verify", { body: { code } }); reload(); } catch (x) { setErr(x instanceof ApiError ? x.message : "Verification failed"); } }}>
          <h1 style={{ fontSize: "1.4rem" }}>Owner verification</h1>
          <p className="muted">Enter the 6-digit code from your authenticator app.</p>
          <div className="field"><label htmlFor="otp">Code</label><input id="otp" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
          {err && <div className="alert alert-danger" role="alert">{err}</div>}
          <button className="btn btn-primary" type="submit">Verify</button>
        </form>
      </div>
    );
  }
  const testing = me.devAutoLogin === true;
  // In testing mode the learner view signs in as the test learner, who can start stations.
  const learnerView = async () => {
    if (testing) await devLogin("learner");
    router.push("/app");
  };
  return (
    <>
      <SiteHeader
        home="/owner"
        suffix="· Owner"
        label="Owner"
        links={LINKS}
        more={MORE}
        wide
        actions={
          <>
            {testing && <TestModePill />}
            <button className="btn btn-sm hide-sm" type="button" onClick={learnerView}>Learner view</button>
            <button className="btn btn-sm" type="button" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.push("/"); }}>Sign out</button>
          </>
        }
      />
      <main id="main" className="container-wide page">{children}</main>
    </>
  );
}

export function useOwnerData<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "Failed to load"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);
  return { data, error, reload: () => setN((x) => x + 1) };
}
