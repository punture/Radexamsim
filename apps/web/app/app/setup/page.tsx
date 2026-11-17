"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { UsageSummary } from "@sim/contracts";
import { Alert, ProvisionalProfileNote } from "@sim/ui";
import { AppShell } from "@/components/learner/AppShell";
import { api, ApiError } from "@/lib/api";

type Profile = {
  versionId: string;
  displayName: string;
  board: string;
  track: string;
  cohort: string;
  modes: ("exam" | "practice")[];
  stationDurationSeconds: number;
  minCases: number;
  maxCases: number;
  verification: { status: string; notes: string; unresolvedConflicts: string[] };
  scoringDisclaimer: string;
};

function Setup() {
  const router = useRouter();
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [profileId, setProfileId] = useState("");
  const [mode, setMode] = useState<"exam" | "practice">(demo ? "practice" : "exam");
  const [caseCount, setCaseCount] = useState(3);
  const [inputMode, setInputMode] = useState<"voice" | "typed_practice">("voice");
  const [micConsent, setMicConsent] = useState(false);
  const [vendorConsent, setVendorConsent] = useState(false);
  const [asrMode, setAsrMode] = useState<string>("browser");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Profile[]>("/api/profiles").then((p) => {
      setProfiles(p);
      setProfileId((cur) => cur || p[0]?.versionId || "");
    });
    api<UsageSummary>("/api/billing/usage").then(setUsage).catch(() => undefined);
    api<{ providers: { asr: string } }>("/api/health").then((h) => setAsrMode(h.providers.asr)).catch(() => undefined);
  }, []);
  const profile = profiles.find((p) => p.versionId === profileId);
  const minutes = profile ? Math.ceil(profile.stationDurationSeconds / 60) : 0;
  const needsVendorConsent = inputMode === "voice" && asrMode === "browser";

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (inputMode === "voice") {
        await api("/api/account/consents", { body: { kind: "microphone_processing", granted: micConsent } });
        if (needsVendorConsent) await api("/api/account/consents", { body: { kind: "browser_speech_vendor", granted: vendorConsent } });
      }
      const r = await api<{ sessionId: string }>("/api/sessions", { body: { profileVersionId: profileId, mode, caseCount: demo ? undefined : caseCount, inputMode, demo: demo || undefined } });
      router.push(`/app/session/${r.sessionId}/preflight`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the station.");
    } finally {
      setBusy(false);
    }
  };

  const canStart = !!profile && (inputMode === "typed_practice" || (micConsent && (!needsVendorConsent || vendorConsent)));
  return (
    <div className="stack-lg narrow">
      <div className="page-head">
        <div>
          <h1>{demo ? "Free demonstration case" : "Set up a station"}</h1>
          <p>{demo ? "One practice case. It does not use your examination minutes." : "Choose a profile, a mode and how you will answer."}</p>
        </div>
      </div>

      <fieldset className="form-section" style={{ border: 0, padding: 0 }}>
        <legend className="label" style={{ padding: 0, marginBottom: 8 }}>Profile</legend>
        <div className="option-cards">
          {profiles.map((p) => (
            <label key={p.versionId} className="choice">
              <input type="radio" name="profile" value={p.versionId} checked={profileId === p.versionId} onChange={() => setProfileId(p.versionId)} />
              <span className="stack" style={{ gap: 4 }}>
                <strong>{p.displayName}</strong>
                <span className="muted text-sm">{Math.round(p.stationDurationSeconds / 60)}-minute station</span>
                <span><ProvisionalProfileNote status={p.verification.status} /></span>
              </span>
            </label>
          ))}
        </div>
        {profile && profile.verification.status !== "verified" && (
          <details className="text-sm">
            <summary className="muted" style={{ cursor: "pointer" }}>Why this profile is provisional</summary>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              {profile.verification.notes} {profile.verification.unresolvedConflicts.length > 0 && <>Unresolved: {profile.verification.unresolvedConflicts.join(" ")}</>}
            </p>
          </details>
        )}
      </fieldset>

      {!demo && (
        <fieldset className="form-section" style={{ border: 0, padding: 0 }}>
          <legend className="label" style={{ padding: 0, marginBottom: 8 }}>Mode</legend>
          <div className="option-cards">
            <label className="choice">
              <input type="radio" name="mode" checked={mode === "exam"} onChange={() => setMode("exam")} disabled={!profile?.modes.includes("exam")} />
              <span className="stack" style={{ gap: 2 }}><strong>Examination</strong><span className="muted text-sm">Timed, neutral examiner, no hints. Feedback at the end.</span></span>
            </label>
            <label className="choice">
              <input type="radio" name="mode" checked={mode === "practice"} onChange={() => setMode("practice")} />
              <span className="stack" style={{ gap: 2 }}><strong>Practice</strong><span className="muted text-sm">Hints and teaching available. Kept out of exam results.</span></span>
            </label>
          </div>
          {profile && (
            <div className="row" style={{ gap: 10 }}>
              <label htmlFor="cases" className="label">Number of cases</label>
              <input id="cases" type="number" min={profile.minCases} max={profile.maxCases} value={caseCount} onChange={(e) => setCaseCount(Number(e.target.value))} style={{ width: 90 }} />
              <span className="muted text-sm">{profile.minCases}–{profile.maxCases} cases in one {minutes}-minute station</span>
            </div>
          )}
        </fieldset>
      )}

      <fieldset className="form-section" style={{ border: 0, padding: 0 }}>
        <legend className="label" style={{ padding: 0, marginBottom: 8 }}>Answer by</legend>
        <div className="option-cards">
          <label className="choice">
            <input type="radio" name="input" checked={inputMode === "voice"} onChange={() => setInputMode("voice")} />
            <span className="stack" style={{ gap: 2 }}><strong>Speaking</strong><span className="muted text-sm">Recommended. Required for examination mode.</span></span>
          </label>
          <label className="choice">
            <input type="radio" name="input" checked={inputMode === "typed_practice"} onChange={() => { setInputMode("typed_practice"); setMode("practice"); }} />
            <span className="stack" style={{ gap: 2 }}><strong>Typing</strong><span className="muted text-sm">Practice only; not equivalent to a spoken answer.</span></span>
          </label>
        </div>
      </fieldset>

      {inputMode === "voice" && (
        <div className="card stack" style={{ gap: 10 }}>
          <label className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
            <input type="checkbox" checked={micConsent} onChange={(e) => setMicConsent(e.target.checked)} style={{ marginTop: 5 }} />
            <span>I consent to my microphone audio being processed to produce a transcript for this station. Audio is not retained as a recording unless I separately opt in.</span>
          </label>
          {needsVendorConsent && (
            <label className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <input type="checkbox" checked={vendorConsent} onChange={(e) => setVendorConsent(e.target.checked)} style={{ marginTop: 5 }} />
              <span>This environment uses <strong>browser speech recognition</strong>: my browser&apos;s vendor (for example Google, for Chrome) processes the audio under its own terms. I understand this is a development/fallback configuration.</span>
            </label>
          )}
        </div>
      )}

      {error && <Alert kind="danger">{error}</Alert>}
      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <button type="button" className="btn btn-primary btn-lg" disabled={!canStart || busy} onClick={create} data-testid="create-session">
            {busy ? "Preparing…" : "Continue to preflight checks"}
          </button>
        </div>
        {usage && !demo && (
          <p className="muted text-sm" style={{ margin: 0 }}>
            Reserves {minutes} of your {usage.availableMinutes} available minutes; unused time is returned.
          </p>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <Setup />
      </Suspense>
    </AppShell>
  );
}
