import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { CtaBand } from "@/components/public/CtaBand";
import { PageIntro } from "@/components/public/PageIntro";
import { PricingPlans } from "@/components/public/PricingPlans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "A free demonstration case, then subscription plans with an allowance of examination minutes. How examination minutes are counted, reserved, returned and credited.",
};

export default function Page() {
  return (
    <PublicShell>
      <PageIntro
        eyebrow="Pricing"
        title="Pricing"
        lead="Start with a free demonstration case. Subscriptions include an allowance of examination minutes for spoken stations. Prices and included minutes are still being set and may change before launch."
      />

      <section className="section section-alt" aria-labelledby="plans-title">
        <div className="container">
          <h2 id="plans-title">Plans</h2>
          <PricingPlans />
          <p className="muted text-sm" style={{ margin: "14px 0 0" }}>
            There is no unlimited plan yet: spoken examination has real per-minute costs, and we want to measure them before offering one. Payments are handled by Stripe: card details are entered on Stripe’s hosted pages and are not stored by us.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="minutes-title">
        <div className="container grid-auto-wide" style={{ alignItems: "start" }}>
          <div className="stack">
            <h2 id="minutes-title">How examination minutes work</h2>
            <ul className="dots">
              <li><strong>One examination minute</strong> is one minute of active station time in examination or practice mode. Technical pauses are excluded.</li>
              <li><strong>Rounded up per station.</strong> Each station’s active time is rounded up to the next whole minute.</li>
              <li><strong>Reserved, then returned.</strong> A station reserves its full duration when it starts. Unused minutes are returned to your balance when it ends.</li>
              <li><strong>Platform failures are credited.</strong> Minutes lost to verified platform failures are credited back.</li>
              <li><strong>No rollover.</strong> Unused minutes expire at the end of each period.</li>
            </ul>
          </div>
          <div className="stack">
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Example</h3>
              <p style={{ margin: 0 }}>
                A 14-minute RCPSC-oriented station reserves 14 minutes when it starts. If you finish after 9 minutes and 10 seconds of active time, 10 minutes are used and 4 are returned to your balance.
              </p>
            </div>
            <div className="card stack">
              <h3 style={{ margin: 0 }}>What never uses minutes</h3>
              <ul className="dots">
                <li>The free demonstration case</li>
                <li>Preflight checks</li>
                <li>Assessment after the station</li>
                <li>Reading your debrief and replaying a station</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="questions-title">
        <div className="container" style={{ maxWidth: 900 }}>
          <h2 id="questions-title">Questions</h2>
          <p style={{ margin: 0 }}>
            See the <Link href="/faq">FAQ</Link>, or read the <Link href="/terms">draft terms</Link> for how subscriptions, minutes and cancellations are proposed to work.
          </p>
        </div>
      </section>

      <CtaBand />
    </PublicShell>
  );
}
