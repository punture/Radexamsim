"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { EntitlementStatus, UsageSummary } from "@sim/contracts";
import { Alert, Badge, Spinner } from "@sim/ui";
import { api, ApiError } from "@/lib/api";
import { errorText, formatDate } from "./learnerFormat";

type PlanRow = { id: string; displayName: string; priceDisplay: string; includedMinutesPerPeriod: number; purchasable: boolean };
type PlansResponse = { plans: PlanRow[]; testMode: boolean };
type PaidPlan = "individual_monthly" | "individual_annual";
type Notice = { kind: "danger" | "warning" | "info"; title: string; body: string };

const STATUS_LABEL: Record<EntitlementStatus, string> = {
  none: "No subscription",
  demo: "Free demonstration",
  trialing: "Trial",
  active: "Active",
  past_due: "Payment past due",
  canceled_pending_period_end: "Cancelled — access continues until the period ends",
  canceled: "Cancelled",
  suspended: "Suspended",
};
const STATUS_KIND: Partial<Record<EntitlementStatus, "success" | "warning" | "danger" | "info">> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  canceled_pending_period_end: "warning",
  suspended: "danger",
};
const PLAN_NAME: Record<string, string> = { demo: "Free demonstration", individual_monthly: "Individual — monthly", individual_annual: "Individual — annual" };
const FALLBACK_PLANS: PlanRow[] = [
  { id: "individual_monthly", displayName: "Individual — monthly", priceDisplay: "Price to be confirmed", includedMinutesPerPeriod: -1, purchasable: true },
  { id: "individual_annual", displayName: "Individual — annual", priceDisplay: "Price to be confirmed", includedMinutesPerPeriod: -1, purchasable: true },
];
/** Statuses with a live subscription: offer the billing portal instead of a second checkout. */
const HAS_SUBSCRIPTION: EntitlementStatus[] = ["active", "trialing", "past_due", "canceled_pending_period_end", "suspended"];
const CONFIRMED: EntitlementStatus[] = ["active", "trialing"];

const NOT_CONFIGURED: Notice = {
  kind: "warning",
  title: "Payments are not configured in this environment",
  body: "Subscriptions cannot be purchased here. The free demonstration case is still available.",
};

export function BillingView({ checkout }: { checkout: string | null }) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadUsage = useCallback(async (): Promise<UsageSummary | null> => {
    try {
      const u = await api<UsageSummary>("/api/billing/usage");
      setUsage(u);
      setUsageError(null);
      return u;
    } catch (e) {
      setUsageError(errorText(e, "Usage information is unavailable right now."));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadUsage();
    api<PlansResponse>("/api/billing/plans")
      .then((r) => setPlans(r && Array.isArray(r.plans) ? r : null))
      .catch(() => setPlans(null));
  }, [loadUsage]);

  // After returning from Stripe Checkout, entitlement changes only when the verified webhook is
  // processed. Poll briefly so the status updates without a manual refresh.
  useEffect(() => {
    if (checkout !== "returned") return;
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      tries += 1;
      const u = await loadUsage();
      if (!alive) return;
      if (u && CONFIRMED.includes(u.entitlementStatus)) return;
      if (tries < 18) timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 5000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [checkout, loadUsage]);

  const refresh = async () => {
    setRefreshing(true);
    await loadUsage();
    setRefreshing(false);
  };

  const startCheckout = async (plan: PaidPlan) => {
    setBusy(plan);
    setNotice(null);
    try {
      const r = await api<{ url: string | null }>("/api/billing/checkout", { body: { plan } });
      if (r?.url) {
        window.location.assign(r.url);
        return;
      }
      setNotice({ kind: "danger", title: "Checkout could not be started", body: "Please try again in a moment." });
    } catch (e) {
      if (e instanceof ApiError && e.code === "billing_not_configured") setNotice(NOT_CONFIGURED);
      else setNotice({ kind: "danger", title: "Checkout could not be started", body: errorText(e, "Please try again in a moment.") });
    }
    setBusy(null);
  };

  const openPortal = async () => {
    setBusy("portal");
    setNotice(null);
    try {
      const r = await api<{ url: string | null }>("/api/billing/portal", { method: "POST" });
      if (r?.url) {
        window.location.assign(r.url);
        return;
      }
      setNotice({ kind: "danger", title: "The billing portal could not be opened", body: "Please try again in a moment." });
    } catch (e) {
      if (e instanceof ApiError && e.code === "billing_not_configured") setNotice(NOT_CONFIGURED);
      else if (e instanceof ApiError && e.code === "no_customer") setNotice({ kind: "info", title: "No billing account yet", body: "You have not subscribed yet, so there is nothing to manage. Choose a plan to subscribe." });
      else setNotice({ kind: "danger", title: "The billing portal could not be opened", body: errorText(e, "Please try again in a moment.") });
    }
    setBusy(null);
  };

  if (!usage && !usageError) return <Spinner label="Loading billing" />;

  const status = usage?.entitlementStatus ?? "none";
  const hasSubscription = HAS_SUBSCRIPTION.includes(status);
  const awaitingConfirmation = checkout === "returned" && !hasSubscription;
  const confirmed = checkout === "returned" && CONFIRMED.includes(status);
  const planRows = (plans?.plans.length ? plans.plans : FALLBACK_PLANS).filter((p): p is PlanRow & { id: PaidPlan } => p.id === "individual_monthly" || p.id === "individual_annual");
  const nothingPurchasable = !!plans && planRows.every((p) => !p.purchasable);

  return (
    <div className="stack-lg">
      <h1 style={{ margin: 0 }}>Billing and examination minutes</h1>

      {checkout === "returned" &&
        (confirmed ? (
          <Alert kind="success" title="Payment confirmed">Stripe has confirmed your payment. Your plan details below are up to date.</Alert>
        ) : (
          <Alert kind="info" title="Waiting for payment confirmation">
            Access updates once Stripe confirms the payment, usually within a minute. This page checks automatically; you can also refresh it.{" "}
            <button type="button" className="btn btn-sm" onClick={refresh} disabled={refreshing}>{refreshing ? "Checking…" : "Check now"}</button>
          </Alert>
        ))}
      {checkout === "cancelled" && <Alert kind="info" title="Checkout cancelled">No subscription was started.</Alert>}
      {usageError && <Alert kind="danger" title="Usage unavailable">{usageError}</Alert>}
      {notice && <Alert kind={notice.kind} title={notice.title}>{notice.body}</Alert>}

      {usage && (
        <div className="grid-auto">
          <section className="card stack" aria-labelledby="plan-title">
            <h2 id="plan-title" style={{ margin: 0, fontSize: "1.1rem" }}>Your plan</h2>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1.15rem" }}>{usage.plan ? (plans?.plans.find((p) => p.id === usage.plan)?.displayName ?? PLAN_NAME[usage.plan] ?? usage.plan) : "No paid plan"}</p>
            <div className="row">
              <Badge kind={STATUS_KIND[status]}>{STATUS_LABEL[status]}</Badge>
            </div>
            {usage.periodEndsAt && (
              <p className="muted" style={{ margin: 0 }}>
                {status === "canceled_pending_period_end" ? "Access ends" : "Current period ends"} {formatDate(usage.periodEndsAt)}
              </p>
            )}
            {usage.blockingReason && <Alert kind="warning">{usage.blockingReason}</Alert>}
            {hasSubscription || status === "canceled" ? (
              <button type="button" className="btn self-start" onClick={openPortal} disabled={busy !== null}>
                {busy === "portal" ? "Opening…" : "Manage subscription and payment method"}
              </button>
            ) : null}
          </section>

          <section className="card stack" aria-labelledby="minutes-title">
            <h2 id="minutes-title" style={{ margin: 0, fontSize: "1.1rem" }}>Examination minutes</h2>
            <div>
              <p className="stat">{usage.availableMinutes}</p>
              <p className="muted" style={{ margin: 0 }}>available now</p>
            </div>
            <dl className="kv">
              <dt>Reserved now</dt>
              <dd>{usage.reservedMinutes}</dd>
              {usage.currentPeriod && (
                <>
                  <dt>This period (since {formatDate(usage.currentPeriod.startedAt)})</dt>
                  <dd>{usage.currentPeriod.consumedMinutes} used of {usage.currentPeriod.allottedMinutes + usage.currentPeriod.adjustedMinutes}</dd>
                </>
              )}
              <dt>Allotted to date</dt>
              <dd>{usage.allottedMinutes}</dd>
              <dt>Used to date</dt>
              <dd>{usage.consumedMinutes}</dd>
              <dt>Credits/adjustments</dt>
              <dd>{usage.adjustedMinutes > 0 ? `+${usage.adjustedMinutes}` : usage.adjustedMinutes}</dd>
              <dt>Demo cases left</dt>
              <dd>{usage.demoCasesRemaining}</dd>
            </dl>
            <p className="muted text-sm" style={{ margin: 0 }}>“Reserved now” is held by a station in progress and returns to your balance, less the time used, when it ends.</p>
          </section>
        </div>
      )}

      {usage && !hasSubscription && (
        <section className="stack" aria-labelledby="choose-title">
          <h2 id="choose-title" style={{ margin: 0 }}>Choose a plan</h2>
          {nothingPurchasable && <Alert kind="warning" title={NOT_CONFIGURED.title}>{NOT_CONFIGURED.body}</Alert>}
          {awaitingConfirmation && (
            <p className="muted" style={{ margin: 0 }}>
              Subscribing is paused while we wait for Stripe to confirm your recent checkout, so you are not charged twice. If you did not complete a checkout, <Link href="/app/billing">reload this page</Link>.
            </p>
          )}
          {plans?.testMode && !nothingPurchasable && (
            <p className="muted text-sm" style={{ margin: 0 }}>
              <Badge kind="info">Test mode</Badge> Payments in this environment run in Stripe test mode; no real charges are made.
            </p>
          )}
          <div className="grid-auto">
            {planRows.map((p) => (
              <article key={p.id} className="card stack" aria-labelledby={`buy-${p.id}`}>
                <h3 id={`buy-${p.id}`} style={{ margin: 0 }}>{p.displayName}</h3>
                <p className="price">{p.priceDisplay}</p>
                {p.includedMinutesPerPeriod >= 0 && (
                  <p className="muted" style={{ margin: 0 }}>
                    {p.includedMinutesPerPeriod} examination minutes per {p.id === "individual_monthly" ? "monthly billing period" : "allowance period"}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-primary self-start"
                  onClick={() => startCheckout(p.id)}
                  disabled={busy !== null || awaitingConfirmation || (!!plans && !p.purchasable)}
                >
                  {busy === p.id ? "Opening checkout…" : "Subscribe"}
                </button>
              </article>
            ))}
          </div>
          <p className="muted text-sm" style={{ margin: 0 }}>You will be taken to Stripe to pay. Your access changes only after Stripe confirms the payment.</p>
        </section>
      )}

      <section className="card stack" aria-labelledby="how-title">
        <h2 id="how-title" style={{ margin: 0, fontSize: "1.1rem" }}>How minutes are counted</h2>
        <ul className="dots">
          <li>One examination minute is one minute of active station time in examination or practice mode, excluding technical pauses. Each station is rounded up to the next whole minute.</li>
          <li>A station reserves its full duration when it starts; unused minutes are returned when it ends.</li>
          <li>Minutes lost to verified platform failures are credited back.</li>
          <li>Unused minutes expire at the end of each period. There is no unlimited plan yet.</li>
          <li>Preflight checks, assessment, reading your debrief, replay and the free demonstration never use minutes.</li>
        </ul>
      </section>
    </div>
  );
}
