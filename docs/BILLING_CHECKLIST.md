# Billing checklist

> **Status, 2026-11-15.**
>
> - **Live Stripe has never been exercised.** Stripe test mode has not been exercised against Stripe either: no test-mode keys exist in the build environment.
> - Every billing test uses locally signed payloads and a local PostgreSQL database.
> - **No charges can be made without the owner's separate authorization.** Stripe stays in test mode (`sk_test_` keys, test price ids) until the owner authorizes otherwise.
> - Prices and allowances in the code are placeholders.

Related: [runbooks/DEPLOYMENT.md](runbooks/DEPLOYMENT.md) · [runbooks/INCIDENT.md](runbooks/INCIDENT.md) §4.5 · [runbooks/MONITORING.md](runbooks/MONITORING.md) §3.8, §5 · [runbooks/DATA_RETENTION.md](runbooks/DATA_RETENTION.md) §5 · [`.env.example`](../.env.example)

## 1. The examination minute

Definition, quoted from `packages/contracts/src/billing.ts`:

> one minute of ACTIVE station clock time in exam or practice mode, measured by the server from station start to station end, excluding technical pauses. Each station's consumption is rounded up to the next whole minute. Preflight, finalization, debrief review, replay and owner preview never consume minutes.

How the code applies it:

- **Counting.** `consumedMinutes(clock, now)` in `packages/exam-engine/src/clock.ts` returns `ceil(active ms / 60,000)`, or 0 when there was no active time.
- **What stops the clock.** Only declared technical interruptions (connection loss beyond the grace period, platform failure) and explicit practice-mode pauses. Candidate silence does not.
- **Reservation at start.** `reserveForSession` reserves the full station duration, `ceil(durationSeconds / 60)`. At the time of writing that is 25 minutes for the ABR profile, 14 for the RCPSC profile and 20 for the advanced profile (`packages/clinical-content/src/profiles.ts`). A station cannot start unless that many minutes are available.
- **Reconciliation at the end.** `reconcileSession` releases the whole reservation and records the consumption, capped at the reservation. When a station is invalidated after a **platform** pause, an automatic `adjust` entry credits back the consumed minutes.
- **Stations that use no minutes:**
  - demonstration sessions use the free demonstration allowance instead (one case per account);
  - owner previews reserve and consume nothing;
  - with `BILLING_ENFORCED=false`, no station reserves or records usage.

## 2. What is implemented, and what is tested

### 2.1 Components

| Component | Code | Tested by (test names in `packages/billing/test/billing.test.ts` unless noted) |
|---|---|---|
| Webhook signature check on the raw body | `verifyWebhook` in `packages/billing/src/stripe-events.ts`; raw-body parser in `apps/api/src/server.ts` | "webhook signature verification" › **"accepts a correctly signed payload and rejects tampering"**. The HTTP route itself is not tested end to end. |
| Durable storage and deduplication of events, with the processing job enqueued in the same transaction | `recordStripeEvent` | Within **"provisions from subscription events (not the success redirect), deduplicates, and ignores stale events"** |
| Stripe subscription status → entitlement | `entitlementFromSubscription` | "subscription lifecycle → entitlement" › **"maps statuses conservatively"** |
| Event processing in the worker: linking, provisioning, stale-event guard, renewal, cancellation, deletion | `processStripeEvent`, `applySubscription` | **"provisions from subscription events (not the success redirect), deduplicates, and ignores stale events"** |
| Expired trials; disputes (suspension and an urgent review item) | `processStripeEvent` | **"handles expired trials and disputes"** |
| Immutable usage ledger: reserve, release, consume, adjust, allot, expire, with idempotency keys | `packages/billing/src/ledger.ts` | "usage ledger" › **"reserves transactionally, reconciles exactly once, and never double-charges"**; `packages/db/test/db.test.ts` › **"forbids updating or deleting usage ledger entries"** |
| Entitlement gate and demonstration allowance | `reserveForSession`, `consumeDemoCase` | **"refuses to start without entitlement and limits the demo allowance"** |
| Period allotment with expiry of leftovers, once per period | `allotPeriod` | The renewal step of "provisions from subscription events…" (expects 120 available, 240 allotted over two periods) |
| Usage summary: lifetime totals, plus `currentPeriod` totals since the latest allotment (shown on the learner Billing page) | `usageSummary` | The `currentPeriod` assertions in "provisions from subscription events…" |
| Rounding of station minutes | `packages/exam-engine/src/clock.ts` | `packages/exam-engine/test/engine.test.ts` › **"rounds consumed minutes up per station"**, **"accumulates active time, pauses for technical interruptions, and never runs past duration"** |
| Reservation and consumption in a real station; demonstration sessions use no minutes | `apps/api/src/live/session.ts` | `apps/api/test/live.test.ts` (the demo flow checks for no ledger entries; the exam-mode flow checks a 25-minute reservation and the consumption record) |
| Plan catalogue (display only; `testMode` flag) | `GET /api/billing/plans`, `packages/billing/src/plans.ts` | Not tested |
| Checkout session (subscription mode) and customer creation | `POST /api/billing/checkout` | **Not tested** (no keys) |
| Customer portal session | `POST /api/billing/portal` | **Not tested** (no keys) |
| Owner minute adjustment | `POST /api/owner/users/:id/adjust-minutes` | Not tested |

The release gate "Payment/usage reconciliation passes" in `evals/reports/latest.md` rests on these tests only.

### 2.2 Event handling (`processStripeEvent`)

| Stripe event | Effect |
|---|---|
| `checkout.session.completed` | Links the Stripe customer to the user through `client_reference_id`. **Grants nothing.** Entitlement comes only from subscription events, never from the checkout success redirect. |
| `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed` | Updates or inserts the subscription. Sets the entitlement from the status. If the status is active, trialing or cancelling at period end, allots the plan's minutes once for that period (key `<subscription id>:<period start>`) and expires the leftovers of the previous period. |
| `customer.subscription.trial_will_end` | Recorded only. Notice in the product; no email. |
| `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required` | Recorded only. Status changes arrive through subscription events. |
| `charge.refunded` | Normal owner review item. No change to minutes or entitlement. |
| `charge.dispute.created` | Entitlement set to `suspended`; urgent owner review item. |
| Any other type | Stored and marked `ignored`. |

Status mapping:

| Stripe subscription status | Entitlement |
|---|---|
| `active` | `active`, or `canceled_pending_period_end` when `cancel_at_period_end` is set |
| `trialing` | `trialing` |
| `past_due` | `past_due` |
| `paused` | `suspended` |
| `unpaid`, `canceled`, `incomplete_expired` | `canceled` |
| `incomplete`, anything else | `none` |

New paid stations can start only in `active`, `trialing` and `canceled_pending_period_end`.

## 3. Limitations and ambiguities found in the code

1. **Annual allowance (confirmed in the code).**
   - `PLAN_ANNUAL_MINUTES_PER_MONTH` (default 300) becomes the annual plan's `includedMinutesPerPeriod`.
   - Minutes are allotted only by `applySubscription`, **once per Stripe billing period**. No job grants monthly allotments to annual subscribers. The only other caller of `allotPeriod` is the development seed.
   - For an annual subscription, the code therefore grants 300 minutes **per year**, despite the variable's name. The learner and public pages say "examination minutes per allowance period" for the annual plan.
   - The owner must choose: (a) an annual allowance granted once a year (then rename the variable and set the value), or (b) monthly allotments for annual subscribers, which needs engineering work.
2. **Unknown price ids fall back to the monthly plan.** `planForPrice(...) ?? "individual_monthly"`. A subscription to a price id the worker does not know gets the monthly plan's allowance. The **worker** reads `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` and the `PLAN_*` values from its own environment, so they must match the API's.
3. **No rollover.** At each new period, leftover minutes are expired ("unused minutes expire at period end (no rollover)").
   - Reservations still open at that moment are counted as leftover.
   - A station that runs across a renewal therefore consumes from the new allowance.
4. **Ordering of events.** The stale-event guard compares Stripe's `created` time, in whole seconds, with the newest event already applied to that subscription. Events created in the same second apply in arrival order. The handler applies the state in the event payload; it does not fetch the current subscription from Stripe.
5. **Renewals depend on `customer.subscription.updated`** carrying the new period start (read from the subscription or its first item). This has been tested with synthetic events only. Verify it in test mode with a Stripe test clock (§5).
6. **Dispute suspension does not stick.** The next subscription event sets the entitlement from the subscription status again, lifting the suspension without owner action. No owner endpoint suspends or reinstates an entitlement.
7. **Refunds** change neither minutes nor entitlement. The owner decides, and uses a negative adjustment if appropriate.
8. **Held minutes.** Sessions left `technically_interrupted` across an API restart are not recovered, so their reservations stay open. This also reduces the balance after the next period starts. No endpoint releases a reservation. See `runbooks/DEPLOYMENT.md`, L1.
9. **Owner adjustments are not idempotent across requests.** Each request uses a new random key, so submitting twice adjusts twice.
10. **Live keys.**
    - Outside production, checkout refuses any key that does not begin `sk_test_`. That includes restricted test keys (`rk_test_`), which `GET /api/billing/plans` also reports as not test mode.
    - **In production a live key works as soon as it is set.** The code has no separate authorization flag.
    - The portal route has no live-key check.
    - Webhook events are accepted whenever the signature matches the configured secret. `stripe_events.livemode` is recorded but not enforced.
11. **Checkout options not configured:** taxes, tax-id collection, billing-address collection, promotion codes and trial periods are not set in the checkout session (`apps/api/src/routes/billing.ts`).
12. **No emails.** Trial-ending and payment-failure notices appear only in the product. While a subscription is past due, the learner sees "Payment failed. Update your payment method in the billing portal to start new stations."
13. **Demonstration allowance:** one case per account (`entitlements.demo_cases_remaining`, default 1). An account that is deleted and created again starts with a new allowance.
14. **Stored payloads.** `stripe_events` keeps every webhook payload, personal and payment details included, with no expiry (`runbooks/DATA_RETENTION.md` §2.3).
15. **`BILLING_ENFORCED=false`** lets every signed-in learner start stations without an entitlement and records no usage.

## 4. Remaining production settings and owner decisions

| # | Item | State in the code | Decision or action needed |
|---|---|---|---|
| 1 | **Prices** | No Stripe products or prices exist. `PLAN_MONTHLY_PRICE_DISPLAY` and `PLAN_ANNUAL_PRICE_DISPLAY` are display text only (default "Price to be confirmed"). A comment in `plans.ts` calls the earlier CAD 59/99 figures hypotheses. | Currency and amounts for monthly and annual. Create the prices in Stripe test mode first. Set `STRIPE_PRICE_*` in the API **and** the worker. |
| 2 | **Plan allowances** | `PLAN_MONTHLY_MINUTES=300`, `PLAN_ANNUAL_MINUTES_PER_MONTH=300` (defaults). A 25-minute ABR station reserves 25 minutes, so 300 minutes is 12 full ABR stations per period. | Minutes per plan, and the annual question in §3.1. "Unlimited voice usage is deliberately not offered before costs are measured" (`plans.ts`). Base allowances on the measured cost per completed station (`runbooks/MONITORING.md` §5). |
| 3 | **Taxes** | None configured | Accountant decision: tax registration and collection. Configure tax in Stripe, then change the checkout session code. |
| 4 | **Refunds** | Review item only | Refund policy (terms page is a draft), who issues refunds (in Stripe), and whether minutes are removed. |
| 5 | **Disputes** | Suspends until the next subscription event | Process for disputes. Whether suspension must stick (code change). |
| 6 | **Live-mode switch** | Setting a live key in production enables live charges | Only with the owner's written authorization: (1) live products and prices; (2) a live webhook endpoint and its secret; (3) live key and price ids in the production secrets; (4) restart; (5) a controlled live purchase and refund by the owner; (6) alert on live-mode events. Consider adding an explicit authorization flag to the code first. |
| 7 | **Webhook endpoint registration** | Route `POST /api/stripe/webhook`. Pinned API version `2026-10-28.endive` (`STRIPE_API_VERSION`). Rate limit 600 per minute. Answers 503 until `STRIPE_WEBHOOK_SECRET` is set. | Register one endpoint per environment: `https://<web origin>/api/stripe/webhook` through the rewrite, or the API's hostname. Use the pinned API version. Subscribe only to the handled events in §2.2, since every received event is stored. Set the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`. Confirm signatures survive the proxy chain: the check needs the unmodified raw body. |
| 8 | **Customer portal** | The code only opens a portal session (return URL `PUBLIC_WEB_ORIGIN/app/billing`) | Configure the portal in Stripe: payment-method updates, cancellation at period end, invoices, and whether switching plans is allowed. A plan switch changes the subscription and its period, so check the allotment behaviour in test mode. |
| 9 | **Dunning** | `past_due` blocks new stations. No emails. | Stripe's payment retry and reminder settings. Grace period before `past_due` takes effect. Whether learners get emails (Stripe's emails, or an email provider, which the code does not have). |
| 10 | **Trials** | Supported as a status; none configured at checkout | Whether to offer trials, and their length. |
| 11 | **Enforcement during a pilot** | `BILLING_ENFORCED=true` by default | Keep it on, or turn it off for a free pilot and accept the uncapped model and speech spend. |
| 12 | **Demonstration policy** | One case per account; case ids set by the owner (`PUT /api/owner/config/demo-cases`) | Which cases. Whether re-created accounts may repeat the demonstration. |
| 13 | **Record retention** | Ledger, subscriptions and events kept indefinitely; the ledger is immutable | Legal retention period. Redaction of event payloads (`runbooks/DATA_RETENTION.md` §5). |
| 14 | **Stripe account settings** | n/a | Business details, statement descriptor, support contact, payout account. **[owner authorization]** to create or activate the account. |
| 15 | **Terms** | Draft | Subscription, cancellation and refund terms reviewed by counsel, in step with `POLICY_VERSION`. |

## 5. Test-mode checks before live mode is even considered

Run these in staging with Stripe **test** keys, test price ids and a test-mode webhook endpoint. Creating a Stripe account needs **[owner authorization]**. Record each result.

| # | Scenario | Expected result |
|---|---|---|
| 1 | Webhook with a wrong secret, then the right one | 400 `invalid_signature`, then 200 `{ received: true, duplicate: false }` |
| 2 | Monthly checkout with a test card | `checkout.session.completed` links the customer. `customer.subscription.created` makes the entitlement `active` and allots `PLAN_MONTHLY_MINUTES`. Plans endpoint shows `testMode: true`. |
| 3 | Resend the same event from the dashboard | `duplicate: true`; no second allotment |
| 4 | Renewal with a test clock | One `expire` entry for the leftover, then one new allotment; the `currentPeriod` totals reset |
| 5 | Annual checkout | Record how many minutes are allotted and when. Compare with the decision in §3.1. |
| 6 | Failed renewal payment (test card that declines) | `past_due`; new stations refused with the payment message. Recovery returns `active`. |
| 7 | Cancel at period end in the portal | `canceled_pending_period_end`, access until the period ends, then `canceled` when the subscription is deleted |
| 8 | Pause and resume, if enabled | `suspended`, then `active` |
| 9 | Refund; test dispute | Normal review item; `suspended` and an urgent item. Then send a subscription update and observe the suspension being lifted (§3.6). |
| 10 | Exam-mode station | Full duration reserved at start; at the end the reservation is released and the rounded-up active minutes are consumed. Technical pauses are excluded. Not enough minutes means the station is refused. |
| 11 | Platform-failure invalidation (API restart without reconnecting within the maximum pause) | Consumed minutes credited automatically (`adjust`); digest review item |
| 12 | Replay an older subscription event | "ignored: stale (out-of-order) event" |
| 13 | Worker without price ids | Subscription gets the monthly allowance. Confirms the worker configuration must match the API's. |
| 14 | Reconcile | Stripe dashboard subscriptions match `subscriptions`, `entitlements` and the ledger allotments |

Only after these pass, the owner has decided §4 and the owner has given written authorization, can live mode be configured (§4, item 6).
