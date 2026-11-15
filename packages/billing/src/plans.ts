import type { PlanConfig, PlanId } from "@sim/contracts";

/**
 * Plans are configuration, not code constants for prices. Earlier CAD 59/99 figures were
 * hypotheses; the owner sets real prices in Stripe and the included minutes here (or via
 * environment). Unlimited voice usage is deliberately not offered before costs are measured.
 */
export function loadPlans(env: Record<string, string | undefined> = process.env): PlanConfig[] {
  const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
  return [
    {
      id: "demo",
      displayName: "Free demonstration",
      priceDisplay: "Free",
      stripePriceEnvKey: null,
      includedMinutesPerPeriod: 0,
      maxConcurrentStations: 1,
    },
    {
      id: "individual_monthly",
      displayName: "Individual — monthly",
      priceDisplay: env.PLAN_MONTHLY_PRICE_DISPLAY ?? "Price to be confirmed",
      stripePriceEnvKey: "STRIPE_PRICE_MONTHLY",
      includedMinutesPerPeriod: int(env.PLAN_MONTHLY_MINUTES, 300),
      maxConcurrentStations: 1,
    },
    {
      id: "individual_annual",
      displayName: "Individual — annual",
      priceDisplay: env.PLAN_ANNUAL_PRICE_DISPLAY ?? "Price to be confirmed",
      stripePriceEnvKey: "STRIPE_PRICE_ANNUAL",
      includedMinutesPerPeriod: int(env.PLAN_ANNUAL_MINUTES_PER_MONTH, 300),
      maxConcurrentStations: 1,
    },
  ];
}

export function planForPrice(priceId: string | null | undefined, env: Record<string, string | undefined> = process.env): PlanId | null {
  if (!priceId) return null;
  for (const p of loadPlans(env)) if (p.stripePriceEnvKey && env[p.stripePriceEnvKey] === priceId) return p.id;
  return null;
}

export function includedMinutes(plan: PlanId, env: Record<string, string | undefined> = process.env): number {
  return loadPlans(env).find((p) => p.id === plan)?.includedMinutesPerPeriod ?? 0;
}
