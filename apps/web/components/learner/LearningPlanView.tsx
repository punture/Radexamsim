"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LearningPlan } from "@sim/contracts";
import { SKILL_LABELS } from "@sim/contracts";
import { Alert, Badge, ProvisionalProfileNote, Spinner } from "@sim/ui";
import { api, ApiError } from "@/lib/api";
import { errorText, formatDate, plural, type PublicProfile } from "./learnerFormat";

type PlanItem = LearningPlan["items"][number];

const KIND_LABEL: Record<PlanItem["kind"], string> = {
  worked_example: "Worked example",
  focused_verbal_exercise: "Focused verbal exercise",
  unseen_case: "Unseen case",
  mixed_timed_reassessment: "Mixed timed reassessment",
  revision_practice: "Revision practice",
};

const STATUS: Record<PlanItem["status"], { label: string; kind?: "info" | "success" }> = {
  suggested: { label: "Suggested" },
  started: { label: "Started", kind: "info" },
  completed: { label: "Completed", kind: "success" },
  skipped: { label: "Skipped" },
};

const skillLabel = (s: string) => (SKILL_LABELS as Record<string, string>)[s] ?? s;

function suggestedWhen(plan: LearningPlan, item: PlanItem): string {
  if (item.suggestedAfterDays <= 0) return "Suggested now";
  const d = new Date(plan.createdAt);
  if (Number.isNaN(d.getTime())) return `Suggested after ${plural(item.suggestedAfterDays, "day", "days")}`;
  d.setDate(d.getDate() + item.suggestedAfterDays);
  return `Suggested from ${formatDate(d.toISOString())} (after ${plural(item.suggestedAfterDays, "day", "days")})`;
}

/** Non-start actions for plan items that have no assignment to start directly. */
function ItemLink({ item }: { item: PlanItem }) {
  switch (item.kind) {
    case "worked_example":
      return <Link className="btn btn-sm" href="/app">Open your recent results</Link>;
    case "mixed_timed_reassessment":
      return <Link className="btn btn-sm" href="/app/setup">Set up a timed station</Link>;
    case "revision_practice":
      return <Link className="btn btn-sm" href="/app/setup">Set up a practice station</Link>;
    case "unseen_case":
      return <span className="muted text-sm">No unseen case is available for this item yet.</span>;
    case "focused_verbal_exercise":
      return <span className="muted text-sm">Self-directed: practise saying it aloud, ideally against a timer.</span>;
  }
}

export function LearningPlanView() {
  const router = useRouter();
  const [plan, setPlan] = useState<LearningPlan | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [asrMode, setAsrMode] = useState<string | null>(null);
  const [micConsent, setMicConsent] = useState(false);
  const [vendorConsent, setVendorConsent] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<{ itemId: string; message: string; billing: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ plan: LearningPlan | null }>("/api/learning/plan")
      .then((r) => alive && setPlan(r.plan ?? null))
      .catch((e) => {
        if (!alive) return;
        setLoadError(errorText(e, "Your learning plan could not be loaded."));
        setPlan(null);
      });
    api<PublicProfile[]>("/api/profiles")
      .then((p) => {
        if (!alive || !Array.isArray(p)) return;
        const practice = p.filter((x) => Array.isArray(x.modes) && x.modes.includes("practice"));
        setProfiles(practice);
        setProfileId((cur) => cur || practice[0]?.versionId || "");
      })
      .catch(() => undefined);
    api<{ providers: { asr: string } }>("/api/health")
      .then((h) => alive && setAsrMode(h.providers.asr))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const needsVendorConsent = asrMode === "browser";
  const selectedProfile = profiles.find((p) => p.versionId === profileId);
  const startable = (plan?.items ?? []).some((i) => i.assignmentToken && i.status !== "completed");
  const canStart = !!profileId && micConsent && (!needsVendorConsent || vendorConsent) && starting === null;

  const start = async (item: PlanItem) => {
    if (!item.assignmentToken) return;
    setStarting(item.id);
    setStartError(null);
    try {
      await api("/api/account/consents", { body: { kind: "microphone_processing", granted: true } });
      if (needsVendorConsent) await api("/api/account/consents", { body: { kind: "browser_speech_vendor", granted: true } });
      const r = await api<{ sessionId: string }>("/api/learning/plan/start", { body: { assignmentToken: item.assignmentToken, profileVersionId: profileId } });
      router.push(`/app/session/${r.sessionId}/preflight`);
    } catch (e) {
      setStartError({ itemId: item.id, message: errorText(e, "This practice case could not be started."), billing: e instanceof ApiError && e.status === 402 });
      setStarting(null);
    }
  };

  if (plan === undefined) return <Spinner label="Loading your learning plan" />;

  return (
    <div className="stack-lg">
      <div className="row-between">
        <h1 style={{ margin: 0 }}>Learning plan</h1>
        <Link className="btn" href="/app/progress">View progress</Link>
      </div>

      {loadError && <Alert kind="danger" title="Plan unavailable">{loadError}</Alert>}

      {!loadError && plan === null && (
        <section className="card stack" aria-labelledby="empty-title">
          <h2 id="empty-title" style={{ margin: 0 }}>No learning plan yet</h2>
          <p style={{ margin: 0 }}>Your plan is built from your assessed results. Complete a station and a plan will appear here once your debrief is ready.</p>
          <div className="row">
            <Link className="btn btn-primary" href="/app/setup">Set up a station</Link>
            <Link className="btn" href="/app/setup?demo=1">Try the demonstration</Link>
          </div>
        </section>
      )}

      {plan && (
        <>
          <section className="card stack" aria-labelledby="basis-title">
            <h2 id="basis-title" style={{ margin: 0 }}>Why this plan</h2>
            <p style={{ margin: 0 }}>{plan.basis}</p>
            {plan.focusSkills.length > 0 ? (
              <div className="row">
                <span className="muted text-sm">Focus:</span>
                {plan.focusSkills.map((s) => <Badge key={s} kind="info">{skillLabel(s)}</Badge>)}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>No focus skill yet — the plan keeps you on mixed, timed, unseen cases until a repeated gap appears.</p>
            )}
            <p className="muted text-sm" style={{ margin: 0 }}>
              The plan targets repeated, consequential gaps and uses new cases when they are available. One attempt is a signal, not a stable trait. Updated {formatDate(plan.createdAt)} · {plan.generatedBy === "deterministic" ? "built by fixed rules from your assessed results" : "built by fixed rules from your assessed results; the explanation is written by a language model"}.
            </p>
          </section>

          {startable && (
            <section className="card stack" aria-labelledby="start-settings-title">
              <h2 id="start-settings-title" style={{ margin: 0 }}>Settings for plan practice cases</h2>
              <p className="muted" style={{ margin: 0 }}>
                Plan cases run as one-case deliberate-practice stations, answered by speaking. Practice stations use examination minutes for their active time.
              </p>
              {profiles.length > 0 ? (
                <div className="field" style={{ maxWidth: 560 }}>
                  <label htmlFor="plan-profile">Practice profile</label>
                  <select id="plan-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                    {profiles.map((p) => <option key={p.versionId} value={p.versionId}>{p.displayName}</option>)}
                  </select>
                  {selectedProfile && selectedProfile.verification.status !== "verified" && (
                    <span className="self-start">
                      <ProvisionalProfileNote status={selectedProfile.verification.status} />
                    </span>
                  )}
                </div>
              ) : (
                <Alert kind="warning">No practice profile is available right now, so plan cases cannot be started.</Alert>
              )}
              <fieldset className="stack">
                <legend>Consent</legend>
                <label className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <input type="checkbox" checked={micConsent} onChange={(e) => setMicConsent(e.target.checked)} style={{ marginTop: 5 }} />
                  <span>I consent to my microphone audio being processed to produce a transcript for this station. Audio is not retained as a recording unless I separately opt in.</span>
                </label>
                {needsVendorConsent && (
                  <label className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                    <input type="checkbox" checked={vendorConsent} onChange={(e) => setVendorConsent(e.target.checked)} style={{ marginTop: 5 }} />
                    <span>This environment uses <strong>browser speech recognition</strong>: my browser’s vendor (for example Google, for Chrome) processes the audio under its own terms.</span>
                  </label>
                )}
              </fieldset>
            </section>
          )}

          <section className="stack" aria-labelledby="steps-title">
            <h2 id="steps-title" style={{ margin: 0 }}>Your next steps</h2>
            <ol className="stack" role="list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {[...plan.items].sort((a, b) => a.order - b.order).map((item) => {
                const st = STATUS[item.status];
                const canStartThis = !!item.assignmentToken && item.status !== "completed";
                return (
                  <li key={item.id} className="card stack">
                    <div className="row-between">
                      <div className="row">
                        <span className="badge">Step {item.order}</span>
                        <Badge>{KIND_LABEL[item.kind]}</Badge>
                        <Badge kind={st.kind}>{st.label}</Badge>
                      </div>
                      <span className="muted text-sm">{suggestedWhen(plan, item)}</span>
                    </div>
                    <h3 style={{ margin: 0 }}>{item.title}</h3>
                    <p style={{ margin: 0 }}>{item.description}</p>
                    {item.targetSkills.length > 0 && (
                      <p className="muted text-sm" style={{ margin: 0 }}>Targets: {item.targetSkills.map(skillLabel).join(", ")}</p>
                    )}
                    <div className="row">
                      {canStartThis ? (
                        <button type="button" className="btn btn-primary btn-sm" disabled={!canStart} aria-describedby={!canStart && starting === null ? "start-hint" : undefined} onClick={() => start(item)}>
                          {starting === item.id ? "Starting…" : "Start this practice case"}
                        </button>
                      ) : (
                        <ItemLink item={item} />
                      )}
                    </div>
                    {startError?.itemId === item.id && (
                      <Alert kind="danger" title="Could not start">
                        {startError.message}
                        {startError.billing && <> <Link href="/app/billing">Check your plan and minutes</Link>.</>}
                      </Alert>
                    )}
                  </li>
                );
              })}
            </ol>
            {startable && !canStart && starting === null && (
              <p id="start-hint" className="muted text-sm" style={{ margin: 0 }}>
                To start a plan case, choose a practice profile and give consent in the settings above.
              </p>
            )}
          </section>

          {plan.skillSummaries.length > 0 && (
            <section className="card stack" aria-labelledby="skills-title">
              <h2 id="skills-title" style={{ margin: 0 }}>What the plan is based on</h2>
              <p className="muted text-sm" style={{ margin: 0 }}>Counts of assessed observations per skill. Elements that were uncertain or not assessable are not included.</p>
              <table className="table table-stack">
                <caption className="visually-hidden">Assessed observations per skill</caption>
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">Observations</th>
                    <th scope="col">Case families</th>
                    <th scope="col">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.skillSummaries.map((s) => (
                    <tr key={s.skill}>
                      <th scope="row">{skillLabel(s.skill)}</th>
                      <td data-label="Observations">{s.observations}</td>
                      <td data-label="Case families">{s.distinctCaseFamilies}</td>
                      <td data-label="Summary">{s.statement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
