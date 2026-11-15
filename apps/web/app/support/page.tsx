import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { PageIntro } from "@/components/public/PageIntro";

export const metadata: Metadata = {
  title: "Support",
  description: "How to get help, what happens when the platform fails during a station, and how to dispute a transcript or grading decision.",
};

export default function Page() {
  return (
    <PublicShell>
      <PageIntro eyebrow="Support" title="Support" lead="How to get help, what happens when something fails on our side, and how to dispute a result." />

      <div className="container page" style={{ paddingTop: 0 }}>
        <div className="grid-auto-wide" style={{ alignItems: "start" }}>
          <section className="card stack" aria-labelledby="help-title">
            <h2 id="help-title" style={{ margin: 0 }}>Getting help</h2>
            <p style={{ margin: 0 }}>Support contact details will be published here before launch.</p>
            <p className="muted" style={{ margin: 0 }}>In the meantime, these pages answer the most common questions:</p>
            <ul className="dots">
              <li><Link href="/faq">FAQ</Link></li>
              <li><Link href="/demo">What you need to take a station</Link></li>
              <li><Link href="/pricing">How examination minutes work</Link></li>
              <li><Link href="/methodology">Methodology and limitations</Link></li>
            </ul>
          </section>

          <section className="card stack" aria-labelledby="before-title">
            <h2 id="before-title" style={{ margin: 0 }}>Before a station</h2>
            <ul className="dots">
              <li>Use a current desktop version of Google Chrome or Microsoft Edge.</li>
              <li>Allow microphone access when your browser asks.</li>
              <li>Use headphones so the examiner’s voice is not picked up by your microphone.</li>
              <li>Complete the preflight check: it tests your microphone, audio playback, image display and connection before any time is used.</li>
            </ul>
          </section>
        </div>

        <section className="section" aria-labelledby="failure-title" style={{ paddingBottom: 0 }}>
          <div className="prose">
            <h2 id="failure-title">Technical-failure policy</h2>
            <ul>
              <li><strong>Never your error.</strong> If an image fails to load, or the examiner’s question is not delivered or cannot be heard, this is recorded as a technical limitation. Anything you did not have a fair chance to address is marked “not assessable” rather than counted against you.</li>
              <li><strong>Technical pauses do not use minutes.</strong> Examination minutes count active station time only.</li>
              <li><strong>Credits for platform failures.</strong> Minutes lost to verified platform failures are credited back to your balance.</li>
              <li><strong>Interrupted stations.</strong> If your connection drops, return to your dashboard and choose <strong>Rejoin</strong> on the station.</li>
            </ul>

            <h2>Disputing a result</h2>
            <ol>
              <li>Open the station’s results from your dashboard.</li>
              <li>On the case you want to dispute, choose <strong>Dispute transcription or grading</strong>.</li>
              <li>Explain what you think is wrong. For a transcript, you can propose corrections to individual lines; for grading, you can pick the elements you disagree with.</li>
            </ol>
            <p>
              Your original result is preserved: any correction or reassessment is added as a new version. Our clinical owner, a practising neuroradiologist, reviews significant disputes. You can follow your disputes under <Link href="/app/appeals">Appeals</Link> in the app.
            </p>

            <h2>Account, data and billing</h2>
            <ul>
              <li><strong>Data export and deletion:</strong> available in <Link href="/app/account">Account</Link> in the app.</li>
              <li><strong>Subscription and payment method:</strong> manage them from <Link href="/app/billing">Billing</Link> in the app, through Stripe’s customer portal.</li>
            </ul>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
