import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { DraftNotice } from "@/components/public/DraftNotice";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Terms (draft)",
  description: "Draft terms of use, pending owner and legal review and not yet in effect: educational use only, no guarantee of exam outcomes, acceptable use, subscriptions and minutes, termination and disputes.",
};

export default function Page() {
  return (
    <PublicShell>
      <div className="container page">
        <div className="prose stack-lg">
          <DraftNotice document="Terms of use" />
          <header>
            <h1>Terms of use</h1>
            <p className="muted" style={{ margin: 0 }}>Draft version draft-2026-11-15 · {BRAND} (working name)</p>
          </header>
          <nav className="toc card card-tight" aria-label="On this page">
            <strong>On this page</strong>
            <ul>
              <li><a href="#educational">Educational use only</a></li>
              <li><a href="#outcomes">No guarantee of outcomes</a></li>
              <li><a href="#account">Your account</a></li>
              <li><a href="#acceptable-use">Acceptable use</a></li>
              <li><a href="#subscriptions">Subscriptions and minutes</a></li>
              <li><a href="#termination">Termination</a></li>
              <li><a href="#disputes">Disputes</a></li>
              <li><a href="#other">Other terms</a></li>
            </ul>
          </nav>
        </div>

        <div className="prose">
          <h2 id="educational">1. Educational use only</h2>
          <p>
            {BRAND} is a practice tool for oral-examination preparation in neuroradiology. It is not medical advice, not clinical decision support and not a medical device. Do not use it for diagnosis or to make decisions about patient care.
          </p>

          <h2 id="outcomes">2. No affiliation and no guarantee of exam outcomes</h2>
          <p>
            {BRAND} is independent and is not affiliated with or endorsed by any examining board. Ratings are practice estimates, not board scores. We do not guarantee any exam result, and nothing in the service predicts whether you will pass.
          </p>

          <h2 id="account">3. Your account</h2>
          <ul>
            <li>Give accurate information and keep your sign-in details secure.</li>
            <li>An individual subscription is for one person. Do not share your account.</li>
          </ul>

          <h2 id="acceptable-use">4. Acceptable use</h2>
          <ul>
            <li>Do not record, copy or redistribute case images, cases, examiner questions or reference approaches.</li>
            <li>Screenshots cannot be technically prevented, but they are prohibited.</li>
            <li>Do not try to extract the case bank, interfere with the service, or get around usage limits or security controls.</li>
            <li>Do not include identifiable information about real patients in your answers or appeals.</li>
          </ul>

          <h2 id="subscriptions">5. Subscriptions and examination minutes</h2>
          <ul>
            <li>A free demonstration case is available without a subscription and does not use examination minutes.</li>
            <li>Subscriptions are billed through Stripe and include an allowance of examination minutes. Prices are to be confirmed.</li>
            <li>One examination minute is one minute of active station time, excluding technical pauses, rounded up per station.</li>
            <li>A station reserves its full duration when it starts; unused minutes are returned when it ends.</li>
            <li>Minutes lost to verified platform failures are credited.</li>
            <li>Unused minutes expire at the end of each period. There is no unlimited plan.</li>
            <li>You can manage or cancel your subscription from Billing in the app. Refund terms will be set out in the final terms.</li>
          </ul>
          <p>See <Link href="/pricing">Pricing</Link> for current plan details.</p>

          <h2 id="termination">6. Account termination</h2>
          <ul>
            <li>You can delete your account at any time from Account in the app.</li>
            <li>We may suspend or terminate an account that breaches these terms — for example, by redistributing case images — with notice where appropriate.</li>
          </ul>

          <h2 id="disputes">7. Disputes about results</h2>
          <p>
            If you think a transcript or a grading decision is wrong, dispute it through Appeals in the app. The original result is preserved, and our clinical owner, a practising neuroradiologist, reviews significant disputes. For other disputes, contact details will be published before launch.
          </p>

          <h2 id="other">8. Other terms</h2>
          <p>
            Terms on liability, intellectual property, governing law and changes to these terms will be completed after legal review. Until the final terms are published, this draft is not in effect.
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
