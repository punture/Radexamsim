import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { CtaBand } from "@/components/public/CtaBand";
import { PageIntro } from "@/components/public/PageIntro";

export const metadata: Metadata = {
  title: "RCPSC-oriented practice",
  description:
    "A provisional practice configuration with neuroradiology content for Royal College Diagnostic Radiology candidates: a 14-minute station and qualitative ratings in four product domains. Not affiliated with or endorsed by the Royal College.",
};

const DOMAINS: [string, string][] = [
  ["Detection", "Identifies and describes the relevant imaging findings."],
  ["Integration", "Integrates the findings and the history into a prioritized interpretation and differential."],
  ["Management", "Recommends appropriate next steps, further imaging and urgency."],
  ["Consultancy", "Communicates results clearly, including urgent communication."],
];

export default function Page() {
  return (
    <PublicShell>
      <PageIntro
        eyebrow="RCPSC-oriented practice"
        title="RCPSC-oriented neuroradiology practice"
        lead="A provisional practice configuration for Royal College Diagnostic Radiology candidates who want spoken oral-exam practice with neuroradiology content. Independent practice; not affiliated with or endorsed by the Royal College of Physicians and Surgeons of Canada."
      >
        <div className="alert alert-warning" role="note" style={{ maxWidth: 820 }}>
          <strong>Provisional practice configuration</strong>
          The station length and the rating domains below are our current practice settings. They have not been confirmed against current official documents for Diagnostic Radiology — always check the Royal College’s current official pages.
        </div>
      </PageIntro>

      <section className="section section-alt" aria-labelledby="config-title">
        <div className="container" style={{ maxWidth: 900 }}>
          <h2 id="config-title">Our provisional configuration</h2>
          <ul className="dots">
            <li><strong>A 14-minute station.</strong> The station length is unconfirmed for Diagnostic Radiology, and so is the number of cases per station.</li>
            <li><strong>Qualitative ratings in four product domains.</strong> Detection, integration, management and consultancy. These are our starting set — not confirmed Royal College descriptors.</li>
            <li><strong>No numbers.</strong> We report a qualitative rating per domain with the evidence behind it. There are no numeric totals and no percentages.</li>
            <li><strong>Neuroradiology content only.</strong> This does not simulate the full applied exam or its other content areas.</li>
            <li><strong>Not real exam questions.</strong> Cases are written for this product and approved by our clinical owner, a practising neuroradiologist. We have no access to confidential exam material.</li>
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="domains-title">
        <div className="container">
          <div className="section-head">
            <h2 id="domains-title">The four product domains</h2>
            <p>Our own working definitions, chosen as a starting point. They may change once official descriptors for Diagnostic Radiology are confirmed.</p>
          </div>
          <div className="grid-auto">
            {DOMAINS.map(([name, text]) => (
              <article key={name} className="card stack" aria-labelledby={`domain-${name.toLowerCase()}`}>
                <h3 id={`domain-${name.toLowerCase()}`} style={{ margin: 0 }}>{name}</h3>
                <p className="muted" style={{ margin: 0 }}>{text}</p>
              </article>
            ))}
          </div>
          <p className="muted" style={{ margin: "16px 0 0" }}>
            A domain rating is withheld when there is not enough assessable evidence. See how ratings are produced, and their limits, on the{" "}
            <Link href="/methodology">methodology and limitations</Link> page.
          </p>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="official-title">
        <div className="container" style={{ maxWidth: 900 }}>
          <h2 id="official-title">Check the official source</h2>
          <p style={{ margin: 0 }}>
            For eligibility, dates, exam format and how candidates are rated, the Royal College’s own website is the authority:{" "}
            <a href="https://www.royalcollege.ca/" rel="noopener noreferrer">royalcollege.ca</a>. If anything there differs from this page, the official information applies.
          </p>
        </div>
      </section>

      <CtaBand />
    </PublicShell>
  );
}
