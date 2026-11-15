import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { CtaBand } from "@/components/public/CtaBand";
import { IllustrativeFeedback } from "@/components/public/IllustrativeFeedback";
import { ProfileCards } from "@/components/public/ProfileCards";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: { absolute: `${BRAND} — spoken neuroradiology oral-exam practice` },
  description:
    "Practise neuroradiology oral-exam cases out loud with an AI examiner and get feedback linked to your own words. Independent practice tool; not affiliated with any examining board.",
};

export default function Home() {
  return (
    <PublicShell>
      <section className="hero">
        <div className="container stack">
          <span className="badge badge-info self-start">Neuroradiology oral-exam practice</span>
          <h1>Practise neuroradiology oral-exam cases out loud.</h1>
          <p className="lead">
            Review a brief history and images, speak your answer, and respond to an AI examiner’s follow-up questions. Afterwards, your debrief quotes your own words, explains what mattered and gives you a short, practical plan for what to practise next.
          </p>
          <div className="row">
            <Link className="btn btn-primary btn-lg" href="/sign-up">Start the free demonstration</Link>
            <Link className="btn btn-lg" href="/how-it-works">How it works</Link>
          </div>
          <p className="muted text-sm" style={{ margin: 0 }}>
            Independent practice tool — not affiliated with or endorsed by the ABR or the Royal College, and no access to confidential exam material. Not a medical device.
          </p>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="journey-title">
        <div className="container">
          <div className="section-head">
            <h2 id="journey-title">How a station works</h2>
            <p>Three steps, the same every time.</p>
          </div>
          <ol className="steps">
            <li>
              <h3>See the case</h3>
              <p className="muted">Read a brief history and review the images. Further images are revealed by the examiner when the case calls for them.</p>
            </li>
            <li>
              <h3>Speak your answer</h3>
              <p className="muted">Describe your findings, differential and management out loud. The examiner asks one question at a time, using only questions and replies approved by our clinical owner, and gives you time to think.</p>
            </li>
            <li>
              <h3>Review the evidence</h3>
              <p className="muted">After the station, a separate assessment step links each judgment to your exact words. Your debrief covers strengths, ranked issues, a reference approach and up to three next actions.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="modes-title">
        <div className="container">
          <div className="section-head">
            <h2 id="modes-title">Two ways to practise</h2>
            <p>Examination-mode results and assisted practice are tracked separately, and assisted answers are never counted as unassisted ones.</p>
          </div>
          <div className="grid-auto-wide">
            <article className="card stack" aria-labelledby="mode-exam">
              <h3 id="mode-exam" style={{ margin: 0 }}>Examination mode</h3>
              <ul className="dots">
                <li>Fixed timer and preassembled cases</li>
                <li>A neutral examiner: no hints, praise or teaching</li>
                <li>Feedback after the whole station</li>
                <li>Results tracked separately from practice</li>
              </ul>
            </article>
            <article className="card stack" aria-labelledby="mode-practice">
              <h3 id="mode-practice" style={{ margin: 0 }}>Deliberate practice mode</h3>
              <ul className="dots">
                <li>Hints, pauses and teaching when you want them</li>
                <li>Every bit of assistance is recorded</li>
                <li>Assisted results are kept out of examination trends</li>
                <li>Useful for working on a gap identified in your learning plan</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="feedback-title">
        <div className="container grid-auto-wide" style={{ alignItems: "start" }}>
          <div className="stack">
            <h2 id="feedback-title">Feedback tied to what you actually said</h2>
            <p className="muted" style={{ margin: 0 }}>
              Every judgment in your debrief points to evidence: an exact quote from your transcript, or an explicit statement that an element was not assessable or uncertain. A missing image or a question you could not hear is recorded as a technical limitation, never as your error.
            </p>
            <ul className="dots">
              <li>An overall assessment, with any uncertainty stated</li>
              <li>Two or three strengths, with quotes</li>
              <li>Ranked issues: what you said or omitted, why it mattered, a stronger response and how to practise</li>
              <li>The reference approach approved by our clinical owner</li>
              <li>No more than three next actions</li>
              <li>A replay of the transcript and images</li>
            </ul>
            <p style={{ margin: 0 }}>
              Think a transcript or grading decision is wrong? You can dispute it, and the original result is preserved.
            </p>
          </div>
          <IllustrativeFeedback />
        </div>
      </section>

      <section className="section" aria-labelledby="profiles-title">
        <div className="container">
          <div className="section-head">
            <h2 id="profiles-title">Practice profiles</h2>
            <p>
              Exam-oriented profiles are provisional practice configurations based on public descriptions of each exam. Check the current official pages before relying on any detail. Neuroradiology only: this does not simulate a whole general radiology oral exam.
            </p>
          </div>
          <ProfileCards />
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="limits-title">
        <div className="container" style={{ maxWidth: 900 }}>
          <h2 id="limits-title">What it is — and what it is not</h2>
          <ul className="dots">
            <li>Language models write draft cases, run the examiner, assess answers and critique outputs. Our clinical owner, a practising neuroradiologist, is the only human clinical reviewer and approves every case.</li>
            <li>There is no external faculty panel and no psychometric validation yet. Agreement between models is not proof that an assessment is correct.</li>
            <li>Ratings are practice estimates, not board scores. We do not predict whether you will pass.</li>
            <li>Speech transcription can make mistakes. You can dispute a transcript or a grading decision.</li>
            <li>It is an educational tool — not a medical device, and not for diagnosis or patient care.</li>
          </ul>
          <p style={{ margin: "16px 0 0" }}>
            <Link href="/methodology">Read the full methodology and limitations</Link>
          </p>
        </div>
      </section>

      <CtaBand />
    </PublicShell>
  );
}
