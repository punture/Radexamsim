"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type PlanRow = { id: string; displayName: string; priceDisplay: string; includedMinutesPerPeriod: number; purchasable: boolean };
type PlansResponse = { plans: PlanRow[]; testMode: boolean };

const STATIC_PLANS: PlanRow[] = [
  { id: "individual_monthly", displayName: "Individual — monthly", priceDisplay: "Price to be confirmed", includedMinutesPerPeriod: -1, purchasable: false },
  { id: "individual_annual", displayName: "Individual — annual", priceDisplay: "Price to be confirmed", includedMinutesPerPeriod: -1, purchasable: false },
];

function isPlansResponse(v: unknown): v is PlansResponse {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<PlansResponse>;
  return Array.isArray(r.plans) && r.plans.every((p) => p && typeof p.id === "string" && typeof p.displayName === "string" && typeof p.priceDisplay === "string" && typeof p.includedMinutesPerPeriod === "number");
}

/** Plan catalogue for the public pricing page (GET /api/billing/plans works without signing in). */
export function PricingPlans() {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let alive = true;
    api<unknown>("/api/billing/plans")
      .then((r) => {
        if (!alive) return;
        if (isPlansResponse(r)) {
          setData(r);
          setState("ready");
        } else setState("failed");
      })
      .catch(() => {
        if (alive) setState("failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  const plans = data?.plans.length ? data.plans : STATIC_PLANS;
  const anyPurchasable = plans.some((p) => p.purchasable);
  return (
    <div className="stack">
      {state === "loading" && <p className="muted text-sm" role="status" style={{ margin: 0 }}>Loading current plan details…</p>}
      {state === "failed" && (
        <div className="alert alert-warning" role="status">
          Current plan details could not be loaded right now. The summary below shows the plan structure; check back later for allowance details.
        </div>
      )}
      {data?.testMode && anyPurchasable && (
        <p className="muted text-sm" style={{ margin: 0 }}>
          <span className="badge badge-info">Test mode</span> Payments in this environment run in Stripe test mode; no real charges are made.
        </p>
      )}
      <div className="grid-auto">
        <article className="card stack" aria-labelledby="plan-demo">
          <h3 id="plan-demo" style={{ margin: 0 }}>Free demonstration</h3>
          <p className="price">Free</p>
          <ul className="dots text-sm">
            <li>One complete spoken practice case</li>
            <li>Examiner follow-up questions and a full debrief</li>
            <li>Does not use examination minutes</li>
          </ul>
          <Link className="btn btn-primary self-start" href="/sign-up">Create a free account</Link>
        </article>
        {plans.map((p) => (
          <article key={p.id} className="card stack" aria-labelledby={`plan-${p.id}`}>
            <h3 id={`plan-${p.id}`} style={{ margin: 0 }}>{p.displayName}</h3>
            <p className="price">{p.priceDisplay}</p>
            <ul className="dots text-sm">
              {p.includedMinutesPerPeriod >= 0 ? (
                <li>
                  {p.includedMinutesPerPeriod} examination minutes included per {p.id === "individual_monthly" ? "monthly billing period" : "allowance period"}
                </li>
              ) : (
                <li>Included examination minutes to be confirmed</li>
              )}
              {p.id === "individual_annual" && <li>How the annual allowance is scheduled will be confirmed with pricing</li>}
              <li>Examination and deliberate-practice modes</li>
              <li>Unused minutes expire at the end of each period</li>
            </ul>
            {p.purchasable ? (
              <Link className="btn self-start" href="/app/billing">Subscribe from your account</Link>
            ) : (
              <span className="badge self-start">Not yet available to purchase</span>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
