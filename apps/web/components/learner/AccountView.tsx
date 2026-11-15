"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, ConfirmDialog, Spinner } from "@sim/ui";
import { api, ApiError, type Me } from "@/lib/api";
import { errorText, formatDate, formatDateTime } from "./learnerFormat";

type ConsentKind = "microphone_processing" | "audio_retention" | "evaluation_use" | "browser_speech_vendor";
type ConsentRecord = { kind: string; granted: boolean; policyVersion: string; at: string };
type ConsentsResponse = { policyVersion: string; consents: ConsentRecord[] };
type DataRequest = { id: string; kind: "export" | "deletion"; status: string; createdAt: string; completedAt: string | null; downloadable: boolean; expiresAt?: string | null };

const CONSENTS: { kind: ConsentKind; title: string; description: string }[] = [
  {
    kind: "microphone_processing",
    title: "Process my microphone audio into transcripts",
    description: "Needed for spoken stations; you are also asked when you set up each station. Audio is processed transiently and is not kept as a recording unless you opt in below.",
  },
  {
    kind: "audio_retention",
    title: "Keep recordings of my audio (opt-in)",
    description: "Optional and off unless you turn it on. Recordings are not currently captured by this build. The proposed retention period is 30 days, subject to the final privacy policy.",
  },
  {
    kind: "evaluation_use",
    title: "Use my de-identified attempts to evaluate the assessment system",
    description: "Optional. Helps us check how well the assessment system works. Your attempts are de-identified first.",
  },
  {
    kind: "browser_speech_vendor",
    title: "Allow my browser’s speech service to process my audio",
    description: "Only relevant where this environment uses the browser’s built-in speech recognition (development builds). The browser vendor (for example Google, for Chrome) processes the audio under its own terms.",
  },
];

const REQUEST_STATUS: Record<string, { label: string; kind?: "info" | "success" | "danger" }> = {
  requested: { label: "Requested", kind: "info" },
  processing: { label: "Processing", kind: "info" },
  complete: { label: "Complete", kind: "success" },
  failed: { label: "Failed", kind: "danger" },
};

export function AccountView() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState(false);
  const [consents, setConsents] = useState<ConsentsResponse | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [savingKind, setSavingKind] = useState<ConsentKind | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [requests, setRequests] = useState<DataRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<{ kind: "success" | "danger"; text: string } | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const loadConsents = useCallback(async () => {
    try {
      setConsents(await api<ConsentsResponse>("/api/account/consents"));
      setConsentError(null);
    } catch (e) {
      setConsentError(errorText(e, "Your consent settings could not be loaded."));
    }
  }, []);
  const loadRequests = useCallback(async () => {
    try {
      const r = await api<DataRequest[]>("/api/account/data-requests");
      setRequests(Array.isArray(r) ? r : []);
      setRequestsError(null);
    } catch (e) {
      setRequestsError(errorText(e, "Your data requests could not be loaded."));
    }
  }, []);

  useEffect(() => {
    api<Me>("/api/auth/me")
      .then(setMe)
      .catch(() => {
        setMeError(true);
        setMe({ authenticated: false, authProvider: "unknown" });
      });
    void loadConsents();
    void loadRequests();
  }, [loadConsents, loadRequests]);

  // While an export is being prepared, check periodically so the download link appears.
  const pending = (requests ?? []).some((r) => r.kind === "export" && (r.status === "requested" || r.status === "processing"));
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    const t = setInterval(() => {
      if (Date.now() - startedAt > 5 * 60_000) clearInterval(t);
      else void loadRequests();
    }, 5000);
    return () => clearInterval(t);
  }, [pending, loadRequests]);

  const setConsent = async (kind: ConsentKind, granted: boolean) => {
    // Ignore changes while another save is in flight (the checkbox stays focusable rather than disabled).
    if (savingKind !== null) return;
    setSavingKind(kind);
    setSavedMessage("");
    setConsentError(null);
    try {
      await api("/api/account/consents", { body: { kind, granted } });
      await loadConsents();
      const title = CONSENTS.find((c) => c.kind === kind)?.title ?? kind;
      setSavedMessage(`Saved: ${granted ? "granted" : "withdrawn"} — ${title}.`);
    } catch (e) {
      setConsentError(errorText(e, "That change could not be saved. Please try again."));
    } finally {
      setSavingKind(null);
    }
  };

  const requestExport = async () => {
    setExporting(true);
    setExportMessage(null);
    try {
      await api<{ requestId: string }>("/api/account/export", { method: "POST" });
      setExportMessage({ kind: "success", text: "Export requested. It will appear below with a download link when it is ready." });
      await loadRequests();
    } catch (e) {
      setExportMessage({ kind: "danger", text: errorText(e, "The export could not be requested.") });
    } finally {
      setExporting(false);
    }
  };

  const email = me && me.authenticated ? me.user.email : "";
  const emailMatches = !!email && confirmEmail.trim().toLowerCase() === email.toLowerCase();

  const deleteAccount = async () => {
    setDialogOpen(false);
    setDeleting(true);
    setDeleteError(null);
    try {
      await api("/api/account/delete", { body: { confirmEmail: confirmEmail.trim() } });
      setDeleted(true);
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch {
        // The session may already be gone; continue to the home page either way.
      }
      router.push("/");
    } catch (e) {
      if (e instanceof ApiError && e.code === "confirmation_mismatch") setDeleteError("The email you typed does not match your account email.");
      else if (e instanceof ApiError && e.code === "owner_account") setDeleteError("The owner account cannot be deleted from the learner interface.");
      else setDeleteError(errorText(e, "Your account could not be deleted. Please try again."));
      setDeleting(false);
    }
  };

  if (!me) return <Spinner label="Loading your account" />;
  const consentMap = new Map((consents?.consents ?? []).map((c) => [c.kind, c]));

  return (
    <div className="stack-lg" style={{ maxWidth: 900 }}>
      <h1 style={{ margin: 0 }}>Account</h1>
      {meError && <Alert kind="danger" title="Account details unavailable">Your account details could not be loaded. Reload the page to try again.</Alert>}

      {me.authenticated && (
        <section className="card stack" aria-labelledby="profile-title">
          <h2 id="profile-title" style={{ margin: 0 }}>Your details</h2>
          <dl className="kv">
            <dt>Email</dt>
            <dd className="break-anywhere">{me.user.email}</dd>
            <dt>Name</dt>
            <dd>{me.user.displayName ?? <span className="muted">Not set</span>}</dd>
            <dt>Role</dt>
            <dd>{me.user.role === "owner" ? "Owner" : "Learner"}</dd>
            {me.user.role === "owner" && (
              <>
                <dt>Two-factor</dt>
                <dd>{me.mfa.enrolled ? "Enrolled" : "Not enrolled"}</dd>
              </>
            )}
          </dl>
          <p className="muted text-sm" style={{ margin: 0 }}>
            Disputes about transcripts or grading are listed under <Link href="/app/appeals">Appeals</Link>. Subscriptions are managed in <Link href="/app/billing">Billing</Link>.
          </p>
        </section>
      )}

      <section className="card stack" aria-labelledby="consents-title">
        <h2 id="consents-title" style={{ margin: 0 }}>Consents</h2>
        <p className="muted" style={{ margin: 0 }}>
          Changes take effect immediately and are recorded with the date and policy version. The privacy policy is currently a <Link href="/privacy">draft</Link>
          {consents ? ` (version ${consents.policyVersion})` : ""}.
        </p>
        {consentError && <Alert kind="danger">{consentError}</Alert>}
        {!consents && !consentError ? (
          <Spinner label="Loading consents" />
        ) : consents ? (
          <div>
            {CONSENTS.map((c) => {
              const rec = consentMap.get(c.kind);
              const id = `consent-${c.kind}`;
              return (
                <div key={c.kind} className="consent-item">
                  <input
                    id={id}
                    type="checkbox"
                    checked={rec?.granted ?? false}
                    aria-describedby={`${id}-desc ${id}-meta`}
                    onChange={(e) => setConsent(c.kind, e.target.checked)}
                  />
                  <label htmlFor={id} style={{ fontWeight: 600 }}>{c.title}</label>
                  <p id={`${id}-desc`} className="muted text-sm consent-meta" style={{ margin: 0 }}>{c.description}</p>
                  <p id={`${id}-meta`} className="muted text-sm consent-meta" style={{ margin: 0 }}>
                    {savingKind === c.kind
                      ? "Saving…"
                      : rec
                        ? `${rec.granted ? "Granted" : "Withdrawn"} ${formatDateTime(rec.at)}${rec.policyVersion !== consents.policyVersion ? ` under an earlier policy version (${rec.policyVersion})` : ""}`
                        : "Not given"}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}
        <p role="status" aria-live="polite" className="muted text-sm" style={{ margin: 0, minHeight: "1.2em" }}>{savedMessage}</p>
      </section>

      <section className="card stack" aria-labelledby="export-title">
        <h2 id="export-title" style={{ margin: 0 }}>Export your data</h2>
        <p style={{ margin: 0 }}>
          Download a copy of your own data: transcripts, the examiner prompts you heard, debriefs, learning plans, appeals, consent history and your minutes ledger. The private case bank is not included. Export files are removed after a limited period, so download yours once it is ready.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={requestExport} disabled={exporting}>
            {exporting ? "Requesting…" : "Request a data export"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadRequests()}>Refresh list</button>
        </div>
        {exportMessage && <Alert kind={exportMessage.kind}>{exportMessage.text}</Alert>}
        {requestsError && <Alert kind="danger">{requestsError}</Alert>}
        {requests === null && !requestsError ? (
          <Spinner label="Loading requests" />
        ) : requests && requests.length > 0 ? (
          <table className="table table-stack">
            <caption className="visually-hidden">Your export and deletion requests</caption>
            <thead>
              <tr>
                <th scope="col">Requested</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Completed</th>
                <th scope="col"><span className="visually-hidden">Download</span></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const st = REQUEST_STATUS[r.status] ?? { label: r.status };
                return (
                  <tr key={r.id}>
                    <th scope="row">{formatDateTime(r.createdAt)}</th>
                    <td data-label="Type">{r.kind === "export" ? "Data export" : "Account deletion"}</td>
                    <td data-label="Status"><Badge kind={st.kind}>{st.label}</Badge></td>
                    <td data-label="Completed">{r.completedAt ? formatDate(r.completedAt) : "—"}</td>
                    <td>
                      {r.downloadable ? (
                        <>
                          <a href={`/api/account/exports/${encodeURIComponent(r.id)}/download`} download>
                            Download<span className="visually-hidden"> export requested {formatDateTime(r.createdAt)}</span>
                          </a>
                          {r.expiresAt && <span className="muted text-sm"> · available until {formatDate(r.expiresAt)}, then deleted</span>}
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No requests yet.</p>
        )}
      </section>

      <section className="card stack" aria-labelledby="delete-title" style={{ borderColor: "var(--danger)" }}>
        <h2 id="delete-title" style={{ margin: 0 }}>Delete your account</h2>
        <div className="grid-auto">
          <div>
            <h3 style={{ fontSize: "1rem" }}>Deleted</h3>
            <ul className="dots text-sm">
              <li>Transcripts</li>
              <li>Assessments and debriefs</li>
              <li>Learning plans, progress records and appeals</li>
              <li>Any audio recordings</li>
            </ul>
          </div>
          <div>
            <h3 style={{ fontSize: "1rem" }}>Retained</h3>
            <ul className="dots muted-dots text-sm">
              <li>A pseudonymous usage ledger, needed for accounting</li>
              <li>Audit records, without transcript text</li>
            </ul>
          </div>
        </div>
        <p className="muted text-sm" style={{ margin: 0 }}>
          Deletion cannot be undone. Cancel any active subscription in <Link href="/app/billing">Billing</Link> first. If you want a copy of your data, request an export and download it before deleting.
        </p>
        {deleted ? (
          <Alert kind="success" title="Deletion requested">Your account is being deleted. Signing you out…</Alert>
        ) : (
          <>
            <div className="field" style={{ maxWidth: 440 }}>
              <label htmlFor="confirm-email">Type your account email to confirm</label>
              <input
                id="confirm-email"
                type="email"
                autoComplete="off"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                aria-describedby="confirm-email-hint"
              />
              <span id="confirm-email-hint" className="hint">The delete button is enabled once this matches your account email.</span>
            </div>
            {deleteError && <Alert kind="danger">{deleteError}</Alert>}
            <button type="button" className="btn btn-danger self-start" disabled={!emailMatches || deleting} onClick={() => setDialogOpen(true)}>
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
          </>
        )}
      </section>

      <ConfirmDialog
        open={dialogOpen}
        title="Delete your account?"
        body={
          <p style={{ margin: 0 }}>
            This permanently deletes your transcripts, assessments, debriefs, learning plans and any recordings, and signs you out. A pseudonymous usage ledger and audit records without transcript text are retained.
          </p>
        }
        confirmLabel="Delete my account"
        danger
        onConfirm={deleteAccount}
        onCancel={() => setDialogOpen(false)}
      />
    </div>
  );
}
