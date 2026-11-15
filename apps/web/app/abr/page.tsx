import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { CtaBand } from "@/components/public/CtaBand";
import { PageIntro } from "@/components/public/PageIntro";

export const metadata: Metadata = {
  title: "ABR-oriented practice",
  description:
    "A provisional practice configuration for the neuroradiology category of the ABR Diagnostic Radiology oral exam format, publicly described as returning in 2028. Practice estimates only; not affiliated with or endorsed by the ABR.",
};

const SCALE: [number, string][] = [
  [68, "Absolutely unsatisfactory"],
  [69, "Marginally unsatisfactory"],
  [70, "Satisfactory"],
  [71, "Good"],
  [72, "Outstanding"],
];

export default function Page() {
  return (
    <PublicShell>
      <PageIntro
        eyebrow="ABR-oriented practice"
        title="ABR-oriented neuroradiology practice"
        lead="A provisional practice configuration for the neuroradiology category of the ABR Diagnostic Radiology oral exam format, built from public descriptions. Independent practice; not affiliated with or endorsed by the American Board of Radiology."
      >
        <div className="alert alert-warning" role="note" style={{ maxWidth: 820 }}>
          <strong>Provisional practice configuration</strong>
          These settings come from public descriptions of the exam and have not been confirmed against current official documents. Exam formats change — always check the ABR’s current official pages before relying on any detail here.
        </div>
      </PageIntro>

      <section className="section section-alt" aria-labelledby="public-title">
        <div className="container grid-auto-wide" style={{ alignItems: "start" }}>
          <div className="stack">
            <h2 id="public-title">What public descriptions say</h2>
            <p className="muted" style={{ margin: 0 }}>Summarized from public descriptions as we understand them. This is not official guidance.</p>
            <ul className="dots">
              <li>The Diagnostic Radiology oral exam returns in calendar year 2028, first applying to DR residents completing training in June 2027.</li>
              <li>Public descriptions list seven one-on-one category sessions of about 25 minutes each. Neuroradiology is one of the categories.</li>
              <li>Each case is scored from 68 to 72.</li>
              <li>A category is ordinarily passed with an average of 70 or more.</li>
            </ul>
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>The publicly described case scale</h3>
            <table className="table">
              <caption className="visually-hidden">Case scores and their publicly described labels</caption>
              <thead>
                <tr>
                  <th scope="col">Score</th>
                  <th scope="col">Label</th>
                </tr>
              </thead>
              <tbody>
                {SCALE.map(([score, label]) => (
                  <tr key={score}>
                    <td><strong>{score}</strong></td>
                    <td>{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="ours-title">
        <div className="container" style={{ maxWidth: 900 }}>
          <h2 id="ours-title">How our ABR-oriented profile works</h2>
          <ul className="dots">
            <li><strong>One neuroradiology session.</strong> A single station of about 25 minutes, with several cases sharing one station clock.</li>
            <li><strong>Practice estimates, not ABR scores.</strong> After the station, each assessed case can receive a practice estimate on the publicly described 68–72 scale, shown with the evidence behind it — for example, “70 — Satisfactory (practice estimate)”. It is not a percentage and not an ABR score.</li>
            <li><strong>Withheld when evidence is thin.</strong> If there is not enough assessable evidence, the estimate is withheld rather than guessed. Judgments on which independent assessments disagree are withheld and sent to our clinical owner.</li>
            <li><strong>No outcome prediction.</strong> We do not simulate examiner panel review and we do not predict whether you would pass a category or the exam.</li>
            <li><strong>Neuroradiology only.</strong> The other categories, and the exam as a whole, are not simulated.</li>
            <li><strong>Not real exam questions.</strong> Cases are written for this product and approved by our clinical owner, a practising neuroradiologist. We have no access to confidential exam material.</li>
          </ul>
          <p className="muted" style={{ margin: "16px 0 0" }}>
            Read how estimates are produced, and their limits, on the <Link href="/methodology">methodology and limitations</Link> page.
          </p>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="official-title">
        <div className="container" style={{ maxWidth: 900 }}>
          <h2 id="official-title">Check the official source</h2>
          <p style={{ margin: 0 }}>
            For eligibility, dates, format and scoring, the American Board of Radiology’s own website is the authority:{" "}
            <a href="https://www.theabr.org/" rel="noopener noreferrer">theabr.org</a>. If anything there differs from this page, the official information applies.
          </p>
        </div>
      </section>

      <CtaBand />
    </PublicShell>
  );
}
