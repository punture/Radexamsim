import Stripe from "stripe";
import type { EntitlementStatus, PlanId } from "@sim/contracts";
import {
  enqueue,
  entitlements,
  eq,
  ownerReviewItems,
  stripeEvents,
  subscriptions,
  users,
  type Db,
  type DbOrTx,
} from "@sim/db";
import { allotPeriod } from "./ledger";
import { includedMinutes, planForPrice } from "./plans";

/**
 * Stripe webhook handling (spec §16):
 *  1. The HTTP route verifies the signature on the RAW body (constructEvent) — never trust
 *     an unsigned payload or the checkout success redirect.
 *  2. The verified event is stored durably (event id is the primary key → dedupe) and a
 *     processing job is enqueued in the same transaction. The route returns 2xx quickly.
 *  3. The worker applies events asynchronously and idempotently. Out-of-order delivery is
 *     handled by comparing the event's `created` time with the newest applied event per
 *     subscription; stale state updates are ignored.
 */

export const STRIPE_API_VERSION = "2026-10-28.endive" as const;

export function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20_000 });
}

/** Signature verification only; needs the webhook secret, not an API key. */
export function verifyWebhook(rawBody: string | Uint8Array, signature: string | undefined, secret: string): Stripe.Event {
  if (!signature) throw new Error("missing Stripe-Signature header");
  const verifier = new Stripe("sk_test_signature_verification_only", { apiVersion: STRIPE_API_VERSION });
  return verifier.webhooks.constructEvent(typeof rawBody === "string" ? rawBody : Buffer.from(rawBody), signature, secret);
}

export async function recordStripeEvent(db: Db, event: Stripe.Event): Promise<{ duplicate: boolean }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(stripeEvents)
      .values({
        id: event.id,
        type: event.type,
        apiVersion: event.api_version ?? null,
        created: event.created,
        livemode: event.livemode,
        payload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: stripeEvents.id })
      .returning({ id: stripeEvents.id });
    if (inserted.length === 0) return { duplicate: true };
    await enqueue(tx, { kind: "process_stripe_event", payload: { eventId: event.id }, dedupeKey: `stripe:${event.id}`, maxAttempts: 8 });
    return { duplicate: false };
  });
}

/** Map Stripe subscription status to the product entitlement status. */
export function entitlementFromSubscription(status: string, cancelAtPeriodEnd: boolean): EntitlementStatus {
  switch (status) {
    case "active":
      return cancelAtPeriodEnd ? "canceled_pending_period_end" : "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "paused":
      return "suspended";
    case "unpaid":
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    default:
      return "none";
  }
}

type Obj = Record<string, unknown>;
const str = (o: Obj, k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
const num = (o: Obj, k: string): number | null => (typeof o[k] === "number" ? (o[k] as number) : null);
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as Obj).id === "string" ? ((v as Obj).id as string) : null);

/** Period bounds moved from the subscription to its items in newer API versions. */
export function subscriptionPeriod(sub: Obj): { start: number | null; end: number | null; priceId: string | null } {
  const items = ((sub.items as Obj | undefined)?.data as Obj[] | undefined) ?? [];
  const first = items[0] ?? {};
  const price = (first.price as Obj | undefined) ?? {};
  return {
    start: num(sub, "current_period_start") ?? num(first, "current_period_start"),
    end: num(sub, "current_period_end") ?? num(first, "current_period_end"),
    priceId: str(price, "id"),
  };
}

async function userForCustomer(tx: DbOrTx, customerId: string | null, fallbackUserId?: string | null): Promise<string | null> {
  if (customerId) {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customerId));
    if (u) return u.id;
  }
  if (fallbackUserId) {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, fallbackUserId));
    if (u) {
      if (customerId) await tx.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, u.id));
      return u.id;
    }
  }
  return null;
}

async function applySubscription(tx: DbOrTx, sub: Obj, eventCreated: number, env: Record<string, string | undefined>): Promise<string> {
  const subId = str(sub, "id")!;
  const customerId = idOf(sub.customer);
  const metadataUser = ((sub.metadata as Obj | undefined) ?? {}).user_id;
  const userId = await userForCustomer(tx, customerId, typeof metadataUser === "string" ? metadataUser : null);
  if (!userId) return "ignored: unknown customer";
  const [existing] = await tx.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId));
  if (existing && existing.lastEventCreated > eventCreated) return "ignored: stale (out-of-order) event";

  const status = str(sub, "status") ?? "incomplete";
  const cancelAtPeriodEnd = sub.cancel_at_period_end === true;
  const { start, end, priceId } = subscriptionPeriod(sub);
  const plan: PlanId = planForPrice(priceId, env) ?? "individual_monthly";
  const values = {
    userId,
    stripeSubscriptionId: subId,
    stripeCustomerId: customerId ?? "",
    planId: plan,
    status,
    currentPeriodStart: start ? new Date(start * 1000) : null,
    currentPeriodEnd: end ? new Date(end * 1000) : null,
    cancelAtPeriodEnd,
    trialEnd: num(sub, "trial_end") ? new Date(num(sub, "trial_end")! * 1000) : null,
    lastEventCreated: eventCreated,
    updatedAt: new Date(),
  };
  if (existing) await tx.update(subscriptions).set(values).where(eq(subscriptions.id, existing.id));
  else await tx.insert(subscriptions).values(values);

  const ent = entitlementFromSubscription(status, cancelAtPeriodEnd);
  await tx.insert(entitlements).values({ userId }).onConflictDoNothing();
  await tx
    .update(entitlements)
    .set({ status: ent, planId: plan, periodEnd: values.currentPeriodEnd, periodKey: start ? `${subId}:${start}` : null, updatedAt: new Date() })
    .where(eq(entitlements.userId, userId));

  // Allot minutes for a paid/trialing period exactly once per period.
  if ((ent === "active" || ent === "trialing" || ent === "canceled_pending_period_end") && start) {
    await allotPeriod(tx, userId, `${subId}:${start}`, includedMinutes(plan, env), "stripe");
  }
  return `applied: ${status}`;
}

export async function processStripeEvent(db: Db, eventId: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(stripeEvents).where(eq(stripeEvents.id, eventId));
    if (!row) throw new Error(`stripe event ${eventId} not found`);
    if (row.status === "processed" || row.status === "ignored") return `already ${row.status}`;
    const event = row.payload as unknown as { type: string; created: number; data: { object: Obj } };
    const obj = event.data.object;
    let outcome = "ignored: unhandled type";

    switch (event.type) {
      case "checkout.session.completed": {
        // Link the Stripe customer to the user. Entitlement comes from subscription events.
        const userId = str(obj, "client_reference_id");
        const customerId = idOf(obj.customer);
        if (userId && customerId) {
          await userForCustomer(tx, customerId, userId);
          outcome = "linked customer";
        } else outcome = "ignored: no client_reference_id";
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        outcome = await applySubscription(tx, obj, event.created, env);
        break;
      case "customer.subscription.trial_will_end":
        outcome = "noted: trial ending (in-product notice only; no email without opt-in)";
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.payment_action_required":
        // Subscription status changes arrive via customer.subscription.updated; invoice
        // events are recorded for audit and to surface payment problems in-product.
        outcome = `noted: ${event.type}`;
        break;
      case "charge.refunded":
      case "charge.dispute.created": {
        const customerId = idOf(obj.customer);
        const userId = await userForCustomer(tx, customerId);
        if (userId && event.type === "charge.dispute.created") {
          await tx.insert(entitlements).values({ userId }).onConflictDoNothing();
          await tx.update(entitlements).set({ status: "suspended", updatedAt: new Date() }).where(eq(entitlements.userId, userId));
        }
        await tx
          .insert(ownerReviewItems)
          .values({
            kind: "technical_failure_adjustment",
            priority: event.type === "charge.dispute.created" ? "urgent" : "normal",
            title: event.type === "charge.dispute.created" ? "Payment dispute opened" : "Charge refunded",
            detail: `Stripe ${event.type} for customer ${customerId ?? "unknown"}. ${event.type === "charge.dispute.created" ? "New stations are suspended pending your review." : "Review whether any usage adjustment is needed."}`,
            refs: { stripeEventId: eventId, ...(userId ? { userId } : {}) },
            dedupeKey: `stripe-review:${eventId}`,
          })
          .onConflictDoNothing();
        outcome = `owner review: ${event.type}`;
        break;
      }
    }
    await tx
      .update(stripeEvents)
      .set({ status: outcome.startsWith("ignored") ? "ignored" : "processed", processedAt: new Date(), attempts: row.attempts + 1, lastError: null })
      .where(eq(stripeEvents.id, eventId));
    return outcome;
  });
}
