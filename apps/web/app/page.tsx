import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { CtaBand } from "@/components/public/CtaBand";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: { absolute: `${BRAND} — spoken neuroradiology oral-exam practice` },
  description:
    "Practise neuroradiology oral-exam cases out loud with an AI examiner and get feedback linked to your own words. Independent practice tool; not affiliated with any examining board.",
};

export default function Home() {
  return (
    <PublicShell>
      <section className="hero-simple">
        <div className="container stack">
          <h1>Practise neuroradiology oral-exam cases out loud.</h1>
          <p className="lead">See a case, answer an AI examiner by speaking, then get feedback that quotes your own words.</p>
          <div className="row" style={{ marginTop: 8 }}>
            <Link className="btn btn-primary btn-lg" href="/app">Start practising</Link>
            <Link className="btn btn-lg" href="/how-it-works">How it works</Link>
          </div>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="journey-title">
        <div className="container">
          <h2 id="journey-title" style={{ marginBottom: 20 }}>How a station works</h2>
          <ol className="steps">
            <li>
              <h3>See the case</h3>
              <p className="muted">A brief history and the images. The examiner shows more images when the case calls for them.</p>
            </li>
            <li>
              <h3>Speak your answer</h3>
              <p className="muted">Give your findings, differential and management. The examiner asks one approved question at a time.</p>
            </li>
            <li>
              <h3>Review your feedback</h3>
              <p className="muted">Strengths, issues and next steps, each linked to what you actually said.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="modes-title">
        <div className="container">
          <h2 id="modes-title" style={{ marginBottom: 20 }}>Two ways to practise</h2>
          <div className="grid-auto-wide">
            <div className="feature">
              <h3>Examination mode</h3>
              <p>Timed, with a neutral examiner and no hints. Feedback comes at the end.</p>
            </div>
            <div className="feature">
              <h3>Practice mode</h3>
              <p>Hints and teaching when you want them, tracked separately from examination results.</p>
            </div>
          </div>
          <p className="muted" style={{ margin: "20px 0 0" }}>
            Practice profiles: <Link href="/abr">ABR-oriented</Link>, <Link href="/rcpsc">RCPSC-oriented</Link>, and an advanced neuroradiology track.
          </p>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="limits-title">
        <div className="container narrow">
          <h2 id="limits-title">Good to know</h2>
          <ul className="dots">
            <li>Every case is approved by our clinical owner, a practising neuroradiologist.</li>
            <li>Ratings are practice estimates, not board scores or pass predictions.</li>
            <li>An independent practice tool: not affiliated with or endorsed by the ABR or the Royal College, and not a medical device.</li>
          </ul>
          <p style={{ margin: "16px 0 0" }}>
            <Link href="/methodology">Methodology and limitations</Link>
          </p>
        </div>
      </section>

      <CtaBand />
    </PublicShell>
  );
}
