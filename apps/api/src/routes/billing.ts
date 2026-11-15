import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UsageSummary } from "@sim/contracts";
import { loadPlans, recordStripeEvent, stripeClient, usageSummary, verifyWebhook } from "@sim/billing";
import { eq, users } from "@sim/db";
import type { Deps } from "../deps";
import { HttpError, route } from "../http";
import { audit } from "../services/audit";

/**
 * Billing (spec §16). Card handling stays in Stripe-hosted flows. A successful return from
 * Checkout is NOT proof of entitlement: entitlements change only when verified webhook
 * events are processed by the worker.
 */
export function billingRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;
  const notConfigured = () => new HttpError(503, "billing_not_configured", "Payments are not configured in this environment (Stripe test-mode keys required).");

  route(app, {
    method: "GET",
    url: "/api/billing/usage",
    summary: "Allowance, reserved, consumed and adjusted minutes; demo allowance",
    tags: ["billing"],
    auth: "user",
    response: UsageSummary,
    handler: async ({ auth }) => usageSummary(db, auth!.userId),
  });

  route(app, {
    method: "GET",
    url: "/api/billing/plans",
    summary: "Plan catalogue (display only; Stripe holds authoritative prices)",
    tags: ["billing"],
    auth: "public",
    handler: async () => ({
      plans: loadPlans().filter((p) => p.id !== "demo").map((p) => ({ id: p.id, displayName: p.displayName, priceDisplay: p.priceDisplay, includedMinutesPerPeriod: p.includedMinutesPerPeriod, purchasable: !!(config.STRIPE_SECRET_KEY && p.stripePriceEnvKey && process.env[p.stripePriceEnvKey]) })),
      testMode: !config.STRIPE_SECRET_KEY || config.STRIPE_SECRET_KEY.startsWith("sk_test_"),
    }),
  });

  route(app, {
    method: "POST",
    url: "/api/billing/checkout",
    summary: "Create a Stripe Checkout session (subscription mode)",
    tags: ["billing"],
    auth: "user",
    body: z.object({ plan: z.enum(["individual_monthly", "individual_annual"]) }),
    handler: async ({ auth, body }) => {
      if (!config.STRIPE_SECRET_KEY) throw notConfigured();
      if (config.NODE_ENV !== "production" && !config.STRIPE_SECRET_KEY.startsWith("sk_test_")) throw new HttpError(409, "live_key_outside_production", "live Stripe keys are only allowed in production");
      const plan = loadPlans().find((p) => p.id === body.plan)!;
      const price = plan.stripePriceEnvKey ? process.env[plan.stripePriceEnvKey] : undefined;
      if (!price) throw notConfigured();
      const stripe = stripeClient(config.STRIPE_SECRET_KEY);
      const [u] = await db.select().from(users).where(eq(users.id, auth!.userId));
      let customer = u!.stripeCustomerId;
      if (!customer) {
        const c = await stripe.customers.create({ email: u!.email, metadata: { user_id: u!.id } });
        customer = c.id;
        await db.update(users).set({ stripeCustomerId: customer }).where(eq(users.id, u!.id));
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: u!.id,
        line_items: [{ price, quantity: 1 }],
        subscription_data: { metadata: { user_id: u!.id } },
        success_url: `${config.PUBLIC_WEB_ORIGIN}/app/billing?checkout=returned`,
        cancel_url: `${config.PUBLIC_WEB_ORIGIN}/app/billing?checkout=cancelled`,
      });
      await audit(db, u!.id, "billing.checkout_created", "user", u!.id, { plan: body.plan });
      return { url: session.url };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/billing/portal",
    summary: "Open the Stripe customer portal",
    tags: ["billing"],
    auth: "user",
    handler: async ({ auth }) => {
      if (!config.STRIPE_SECRET_KEY) throw notConfigured();
      const [u] = await db.select().from(users).where(eq(users.id, auth!.userId));
      if (!u?.stripeCustomerId) throw new HttpError(409, "no_customer", "no billing account yet");
      const s = await stripeClient(config.STRIPE_SECRET_KEY).billingPortal.sessions.create({ customer: u.stripeCustomerId, return_url: `${config.PUBLIC_WEB_ORIGIN}/app/billing` });
      return { url: s.url };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/stripe/webhook",
    summary: "Stripe webhook (signature-verified on the raw body; durable and deduplicated)",
    tags: ["billing"],
    auth: "public",
    rateLimit: { max: 600, timeWindow: "1 minute" },
    handler: async ({ req }) => {
      if (!config.STRIPE_WEBHOOK_SECRET) throw notConfigured();
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (!raw) throw new HttpError(400, "no_body", "missing body");
      let event;
      try {
        event = verifyWebhook(raw, req.headers["stripe-signature"] as string | undefined, config.STRIPE_WEBHOOK_SECRET);
      } catch {
        throw new HttpError(400, "invalid_signature", "signature verification failed");
      }
      const r = await recordStripeEvent(db, event);
      return { received: true, duplicate: r.duplicate };
    },
  });
}
