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
    <div className="stack-lg" style={{ maxWidth: 860 }}>
      <h1>{demo ? "Free demonstration case" : "Set up a station"}</h1>
      {demo && <Alert kind="info" title="Demonstration">One practice case. It uses your free demonstration allowance, not examination minutes.</Alert>}
      <fieldset className="stack">
        <legend>Examination profile</legend>
        {profiles.map((p) => (
          <label key={p.versionId} className="choice">
            <input type="radio" name="profile" value={p.versionId} checked={profileId === p.versionId} onChange={() => setProfileId(p.versionId)} />
            <span className="stack" style={{ gap: 4 }}>
              <span className="row"><strong>{p.displayName}</strong><ProvisionalProfileNote status={p.verification.status} /></span>
              <span className="muted">{Math.round(p.stationDurationSeconds / 60)}-minute station · {p.cohort}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {profile && profile.verification.status !== "verified" && (
        <Alert kind="warning" title="Provisional configuration">
          {profile.verification.notes} {profile.verification.unresolvedConflicts.length > 0 && <>Unresolved: {profile.verification.unresolvedConflicts.join(" ")}</>}
        </Alert>
      )}
      {!demo && (
        <fieldset className="stack">
          <legend>Mode</legend>
          <label className="choice"><input type="radio" name="mode" checked={mode === "exam"} onChange={() => setMode("exam")} disabled={!profile?.modes.includes("exam")} /><span><strong>Examination</strong> — fixed timer, preassembled cases, neutral examiner, no hints. Feedback after the whole station. Tracked separately.</span></label>
          <label className="choice"><input type="radio" name="mode" checked={mode === "practice"} onChange={() => setMode("practice")} /><span><strong>Deliberate practice</strong> — hints, pauses and teaching available; all assistance is recorded and kept out of exam-mode trends.</span></label>
        </fieldset>
      )}
      {!demo && profile && (
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="cases">Number of cases</label>
          <input id="cases" type="number" min={profile.minCases} max={profile.maxCases} value={caseCount} onChange={(e) => setCaseCount(Number(e.target.value))} />
          <span className="hint">{profile.minCases}–{profile.maxCases} cases share one {minutes}-minute station.</span>
        </div>
      )}
      <fieldset className="stack">
        <legend>Answer by</legend>
        <label className="choice"><input type="radio" name="input" checked={inputMode === "voice"} onChange={() => setInputMode("voice")} /><span><strong>Speaking</strong> (recommended; required for examination mode)</span></label>
        <label className="choice"><input type="radio" name="input" checked={inputMode === "typed_practice"} onChange={() => { setInputMode("typed_practice"); setMode("practice"); }} /><span><strong>Typing</strong> — a separate practice experience, not equivalent to spoken examination evidence.</span></label>
      </fieldset>
      {inputMode === "voice" && (
        <fieldset className="stack">
          <legend>Consent</legend>
          <label className="row" style={{ alignItems: "flex-start" }}>
            <input type="checkbox" checked={micConsent} onChange={(e) => setMicConsent(e.target.checked)} />
            <span>I consent to my microphone audio being processed to produce a transcript for this station. Audio is not retained as a recording unless I separately opt in.</span>
          </label>
          {needsVendorConsent && (
            <label className="row" style={{ alignItems: "flex-start" }}>
              <input type="checkbox" checked={vendorConsent} onChange={(e) => setVendorConsent(e.target.checked)} />
              <span>This environment uses <strong>browser speech recognition</strong>: my browser's vendor (for example Google, for Chrome) processes the audio under its own terms. I understand this is a development/fallback configuration.</span>
            </label>
          )}
        </fieldset>
      )}
      {usage && !demo && (
        <p className="muted">
          This station reserves {minutes} minutes; unused time is returned when it ends. Available: {usage.availableMinutes} minutes{usage.periodEndsAt ? ` (renews ${new Date(usage.periodEndsAt).toLocaleDateString()})` : ""}.
        </p>
      )}
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="row">
        <button type="button" className="btn btn-primary btn-lg" disabled={!canStart || busy} onClick={create} data-testid="create-session">
          {busy ? "Preparing…" : "Continue to preflight checks"}
        </button>
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
