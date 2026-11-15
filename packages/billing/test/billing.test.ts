import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@sim/db/testing";
import { createDb, entitlements, eq, ownerReviewItems, stripeEvents, users, type Db } from "@sim/db";
import {
  STRIPE_API_VERSION,
  allotPeriod,
  consumeDemoCase,
  entitlementFromSubscription,
  processStripeEvent,
  recordStripeEvent,
  reconcileSession,
  reserveForSession,
  usageSummary,
  verifyWebhook,
} from "../src";

let db: Db;
let drop: () => Promise<void>;
const env = { STRIPE_PRICE_MONTHLY: "price_monthly_test", PLAN_MONTHLY_MINUTES: "120" };

async function newUser(email: string, customer?: string): Promise<string> {
  const [u] = await db.insert(users).values({ email, authProvider: "local", stripeCustomerId: customer ?? null }).returning();
  return u!.id;
}

function subEvent(id: string, type: string, created: number, sub: Record<string, unknown>): Stripe.Event {
  return { id, object: "event", type, created, livemode: false, api_version: STRIPE_API_VERSION, data: { object: sub }, pending_webhooks: 0, request: null } as unknown as Stripe.Event;
}

function subscription(id: string, customer: string, status: string, start: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    object: "subscription",
    customer,
    status,
    cancel_at_period_end: false,
    items: { data: [{ current_period_start: start, current_period_end: start + 30 * 86400, price: { id: "price_monthly_test" } }] },
    ...extra,
  };
}

async function deliver(e: Stripe.Event): Promise<string> {
  const r = await recordStripeEvent(db, e);
  if (r.duplicate) return "duplicate";
  return processStripeEvent(db, e.id, env);
}

beforeAll(async () => {
  const t = await createTestDatabase();
  drop = t.drop;
  db = createDb(t.url);
});
afterAll(async () => {
  await db.$client.end();
  await drop();
});

describe("webhook signature verification", () => {
  it("accepts a correctly signed payload and rejects tampering", () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({ id: "evt_sig", object: "event", type: "invoice.paid", data: { object: {} } });
    const header = new Stripe("sk_test_x", { apiVersion: STRIPE_API_VERSION }).webhooks.generateTestHeaderString({ payload, secret });
    expect(verifyWebhook(payload, header, secret).id).toBe("evt_sig");
    expect(() => verifyWebhook(payload.replace("invoice.paid", "invoice.voided"), header, secret)).toThrow();
    expect(() => verifyWebhook(payload, undefined, secret)).toThrow(/missing/);
    expect(() => verifyWebhook(payload, header, "whsec_wrong")).toThrow();
  });
});

describe("subscription lifecycle → entitlement", () => {
  it("maps statuses conservatively", () => {
    expect(entitlementFromSubscription("active", false)).toBe("active");
    expect(entitlementFromSubscription("active", true)).toBe("canceled_pending_period_end");
    expect(entitlementFromSubscription("past_due", false)).toBe("past_due");
    expect(entitlementFromSubscription("incomplete_expired", false)).toBe("canceled");
    expect(entitlementFromSubscription("incomplete", false)).toBe("none");
  });

  it("provisions from subscription events (not the success redirect), deduplicates, and ignores stale events", async () => {
    const userId = await newUser("sub@example.test");
    // Checkout completion links the customer to the user via client_reference_id.
    expect(await deliver(subEvent("evt_co", "checkout.session.completed", 100, { id: "cs_1", mode: "subscription", client_reference_id: userId, customer: "cus_A" }))).toBe("linked customer");
    expect((await usageSummary(db, userId)).canStartPaidStation).toBe(false);

    const t0 = 1_700_000_000;
    expect(await deliver(subEvent("evt_s1", "customer.subscription.created", 101, subscription("sub_A", "cus_A", "active", t0)))).toMatch(/applied/);
    expect(await deliver(subEvent("evt_s1", "customer.subscription.created", 101, subscription("sub_A", "cus_A", "active", t0)))).toBe("duplicate");
    let s = await usageSummary(db, userId);
    expect(s.entitlementStatus).toBe("active");
    expect(s.availableMinutes).toBe(120);

    // A delayed, older "incomplete" update must not overwrite the newer active state.
    expect(await deliver(subEvent("evt_old", "customer.subscription.updated", 50, subscription("sub_A", "cus_A", "incomplete", t0)))).toMatch(/stale/);
    expect((await usageSummary(db, userId)).entitlementStatus).toBe("active");

    // Failed payment → past_due blocks new stations.
    await deliver(subEvent("evt_pd", "customer.subscription.updated", 200, subscription("sub_A", "cus_A", "past_due", t0)));
    s = await usageSummary(db, userId);
    expect(s.canStartPaidStation).toBe(false);
    expect(s.blockingReason).toMatch(/Payment failed/);

    // Recovery and cancel-at-period-end keep access until the period ends.
    await deliver(subEvent("evt_ok", "customer.subscription.updated", 300, subscription("sub_A", "cus_A", "active", t0, { cancel_at_period_end: true })));
    expect((await usageSummary(db, userId)).entitlementStatus).toBe("canceled_pending_period_end");

    // Renewal: leftover minutes expire and the new allowance is allotted exactly once.
    const t1 = t0 + 30 * 86400;
    await deliver(subEvent("evt_renew", "customer.subscription.updated", 400, subscription("sub_A", "cus_A", "active", t1)));
    await deliver(subEvent("evt_renew_dup_content", "customer.subscription.updated", 401, subscription("sub_A", "cus_A", "active", t1)));
    s = await usageSummary(db, userId);
    expect(s.availableMinutes).toBe(120);
    // Per-period totals cover only the current allowance; lifetime totals include both.
    expect(s.currentPeriod).toMatchObject({ allottedMinutes: 120, consumedMinutes: 0 });
    expect(s.allottedMinutes).toBe(240);
    expect(s.allottedMinutes).toBe(240);

    // Deletion ends access.
    await deliver(subEvent("evt_del", "customer.subscription.deleted", 500, subscription("sub_A", "cus_A", "canceled", t1)));
    expect((await usageSummary(db, userId)).canStartPaidStation).toBe(false);
  });

  it("handles expired trials and disputes", async () => {
    const userId = await newUser("trial@example.test", "cus_T");
    const t0 = 1_700_100_000;
    await deliver(subEvent("evt_tr", "customer.subscription.created", 10, subscription("sub_T", "cus_T", "trialing", t0)));
    expect((await usageSummary(db, userId)).entitlementStatus).toBe("trialing");
    await deliver(subEvent("evt_tr_exp", "customer.subscription.updated", 20, subscription("sub_T", "cus_T", "incomplete_expired", t0)));
    expect((await usageSummary(db, userId)).canStartPaidStation).toBe(false);

    await deliver(subEvent("evt_dp", "charge.dispute.created", 30, { id: "dp_1", object: "dispute", customer: "cus_T" }));
    const [ent] = await db.select().from(entitlements).where(eq(entitlements.userId, userId));
    expect(ent!.status).toBe("suspended");
    const items = await db.select().from(ownerReviewItems).where(eq(ownerReviewItems.dedupeKey, "stripe-review:evt_dp"));
    expect(items[0]!.priority).toBe("urgent");
    const [row] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, "evt_dp"));
    expect(row!.status).toBe("processed");
  });
});

describe("usage ledger", () => {
  it("reserves transactionally, reconciles exactly once, and never double-charges", async () => {
    const userId = await newUser("ledger@example.test");
    await db.insert(entitlements).values({ userId, status: "active" });
    await db.transaction((tx) => allotPeriod(tx, userId, "manual:p1", 60, "test"));

    // Two concurrent starts of the same session reserve once.
    const results = await Promise.all([1, 2].map(() => db.transaction((tx) => reserveForSession(tx, userId, "11111111-1111-4111-8111-111111111111", 25))));
    expect(results.filter((r) => r.ok && !r.alreadyReserved).length).toBe(1);
    let s = await usageSummary(db, userId);
    expect(s.reservedMinutes).toBe(25);
    expect(s.availableMinutes).toBe(35);

    // Not enough minutes for a second 25-minute station plus another.
    expect((await db.transaction((tx) => reserveForSession(tx, userId, "22222222-2222-4222-8222-222222222222", 25))).ok).toBe(true);
    const third = await db.transaction((tx) => reserveForSession(tx, userId, "33333333-3333-4333-8333-333333333333", 25));
    expect(third).toMatchObject({ ok: false, code: "insufficient_minutes" });

    // Reconcile: 13 active minutes consumed; retries do not double-consume.
    await db.transaction((tx) => reconcileSession(tx, userId, "11111111-1111-4111-8111-111111111111", 13));
    await db.transaction((tx) => reconcileSession(tx, userId, "11111111-1111-4111-8111-111111111111", 13));
    s = await usageSummary(db, userId);
    expect(s.consumedMinutes).toBe(13);
    expect(s.reservedMinutes).toBe(25);
    expect(s.availableMinutes).toBe(60 - 13 - 25);

    // Verified platform failure restores consumed minutes automatically.
    await db.transaction((tx) => reconcileSession(tx, userId, "22222222-2222-4222-8222-222222222222", 7, { platformFailure: true }));
    s = await usageSummary(db, userId);
    expect(s.adjustedMinutes).toBe(7);
    expect(s.availableMinutes).toBe(60 - 13);
  });

  it("refuses to start without entitlement and limits the demo allowance", async () => {
    const userId = await newUser("demo@example.test");
    const r = await db.transaction((tx) => reserveForSession(tx, userId, "44444444-4444-4444-8444-444444444444", 5));
    expect(r).toMatchObject({ ok: false, code: "not_entitled" });
    expect(await db.transaction((tx) => consumeDemoCase(tx, userId))).toBe(true);
    expect(await db.transaction((tx) => consumeDemoCase(tx, userId))).toBe(false);
  });
});
