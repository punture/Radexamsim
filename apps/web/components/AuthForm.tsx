"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { devLogin, useMe, type TestRole } from "@/lib/useMe";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [code, setCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Only same-site relative paths are honoured (no open redirect).
  const rawNext = params.get("next") ?? "/app";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/app";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needMfa) {
        await api("/api/auth/mfa/verify", { body: { code } });
        router.push(next.startsWith("/owner") ? next : "/owner");
        return;
      }
      if (mode === "sign-up") {
        await api("/api/auth/register", { body: { email, password, acceptTerms: accept } });
        router.push(next.startsWith("/owner") ? "/app" : next);
        return;
      }
      const r = await api<{ role: string; mfaRequired: boolean; mfaEnrolled: boolean }>("/api/auth/login", { body: { email, password } });
      if (r.role === "owner" && r.mfaRequired && r.mfaEnrolled) setNeedMfa(true);
      else router.push(r.role === "owner" && !next.startsWith("/app") ? "/owner" : next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (me?.devAutoLogin) {
    const go = async (as: TestRole) => {
      setBusy(true);
      setError(null);
      try {
        await devLogin(as);
        router.push(as === "owner" ? (next.startsWith("/owner") ? next : "/owner") : next.startsWith("/owner") ? "/app" : next);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
        setBusy(false);
      }
    };
    return (
      <div className="card stack" style={{ maxWidth: 440, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.6rem" }}>Testing mode</h1>
        <p className="muted" style={{ margin: 0 }}>Sign-in is switched off on this development build. Choose a test account.</p>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <div className="row">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => go("learner")}>Continue as learner</button>
          <button className="btn" type="button" disabled={busy} onClick={() => go("owner")}>Continue as owner</button>
        </div>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={submit} style={{ maxWidth: 440, margin: "0 auto" }} aria-describedby={error ? "auth-error" : undefined}>
      <h1 style={{ fontSize: "1.6rem" }}>{needMfa ? "Verification code" : mode === "sign-in" ? "Sign in" : "Create an account"}</h1>
      {needMfa ? (
        <div className="field">
          <label htmlFor="code">6-digit code from your authenticator app</label>
          <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required pattern="\d{6}" />
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
            {mode === "sign-up" && <span className="hint">At least 10 characters.</span>}
          </div>
          {mode === "sign-up" && (
            <label className="row" style={{ alignItems: "flex-start" }}>
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} required />
              <span>I accept the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy notice</Link> (drafts pending owner and legal review).</span>
            </label>
          )}
        </>
      )}
      {error && <div id="auth-error" className="alert alert-danger" role="alert">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Please wait…" : needMfa ? "Verify" : mode === "sign-in" ? "Sign in" : "Create account"}</button>
      {!needMfa && (mode === "sign-in" ? <p className="muted">No account? <Link href="/sign-up">Create one</Link>.</p> : <p className="muted">Already registered? <Link href="/sign-in">Sign in</Link>.</p>)}
      <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>Development builds use local accounts. Production uses managed authentication.</p>
    </form>
  );
}
