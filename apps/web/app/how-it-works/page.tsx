import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { CtaBand } from "@/components/public/CtaBand";
import { IllustrativeFeedback } from "@/components/public/IllustrativeFeedback";
import { PageIntro } from "@/components/public/PageIntro";

export const metadata: Metadata = {
  title: "How it works",
  description: "What happens before, during and after a spoken neuroradiology practice station: the AI examiner, the two modes, evidence-linked assessment, the debrief and your learning plan.",
};

export default function Page() {
  return (
    <PublicShell>
      <PageIntro
        eyebrow="How it works"
        title="How a practice station works"
        lead="You see a brief history and images, speak your answer, and respond to an examiner's questions. Assessment happens afterwards, as a separate step, and every judgment is linked to what you actually said."
      />

      <section className="section section-alt" aria-labelledby="before-title">
        <div className="container">
          <div className="section-head">
            <h2 id="before-title">Before you start</h2>
            <p>A few choices and a quick technical check.</p>
          </div>
          <ol className="steps">
            <li>
              <h3>Choose a profile</h3>
              <p className="muted">
                Pick an <Link href="/abr">ABR-oriented</Link> or <Link href="/rcpsc">RCPSC-oriented</Link> practice configuration, or the optional advanced neuroradiology practice track, which is separate from exam-oriented practice and makes no claim of exam equivalence. Exam-oriented profiles are provisional and based on public descriptions.
              </p>
            </li>
            <li>
              <h3>Choose a mode</h3>
              <p className="muted">Examination mode for timed, unassisted stations, or deliberate practice when you want hints, pauses and teaching. See the comparison below.</p>
            </li>
            <li>
              <h3>Run the preflight check</h3>
              <p className="muted">We check your microphone, audio playback, image display and connection, and ask for your consent to process your microphone audio into a transcript.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="during-title">
        <div className="container grid-auto-wide" style={{ alignItems: "start" }}>
          <div className="stack">
            <h2 id="during-title">During the station</h2>
            <p className="muted" style={{ margin: 0 }}>
              An AI examiner runs the case. It controls the pacing and decides when to reveal further images, but it can only use questions and replies approved by our clinical owner, a practising neuroradiologist.
            </p>
            <ul className="dots">
              <li>It asks one question at a time.</li>
              <li>It allows thinking pauses. After a long silence it may offer a neutral prompt to continue — never a hint in examination mode.</li>
              <li>It cannot invent findings, results or images. If you ask for information the case does not contain, it will not make it up.</li>
              <li>In examination mode it gives no hints, praise or teaching, and it does not tell you how you are doing.</li>
            </ul>
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>When something goes wrong technically</h3>
            <p style={{ margin: 0 }}>
              An image that fails to load, or a question you could not hear, is recorded as a technical limitation — never as your error. Anything you did not have a fair chance to address is marked “not assessable” rather than counted against you.
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Technical pauses do not count towards your examination minutes, and minutes lost to verified platform failures are credited back. See <Link href="/support">Support</Link>.
            </p>
          </div>
        </div>
      </section>

      <section id="modes" className="section section-alt" aria-labelledby="modes-title">
        <div className="container">
          <div className="section-head">
            <h2 id="modes-title">Two modes, tracked separately</h2>
            <p>Assisted practice never counts towards your examination-mode trends.</p>
          </div>
          <div className="card">
            <table className="table table-stack">
              <caption className="visually-hidden">Comparison of examination mode and deliberate practice mode</caption>
              <thead>
                <tr>
                  <th scope="col">Aspect</th>
                  <th scope="col">Examination mode</th>
                  <th scope="col">Deliberate practice</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Timing</th>
                  <td data-label="Examination mode">Fixed station timer</td>
                  <td data-label="Deliberate practice">Station timer, with pauses available</td>
                </tr>
                <tr>
                  <th scope="row">Cases</th>
                  <td data-label="Examination mode">Preassembled before the station starts</td>
                  <td data-label="Deliberate practice">Chosen for practice, including cases from your learning plan</td>
                </tr>
                <tr>
                  <th scope="row">Examiner</th>
                  <td data-label="Examination mode">Neutral: no hints, praise or teaching</td>
                  <td data-label="Deliberate practice">Hints and teaching on request</td>
                </tr>
                <tr>
                  <th scope="row">Feedback</th>
                  <td data-label="Examination mode">After the whole station</td>
                  <td data-label="Deliberate practice">Can be shown after each case</td>
                </tr>
                <tr>
                  <th scope="row">Tracking</th>
                  <td data-label="Examination mode">Tracked separately as examination results</td>
                  <td data-label="Deliberate practice">All assistance recorded and kept out of examination trends</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted text-sm" style={{ margin: "12px 0 0" }}>
            Typed answers are available as a separate practice experience. They are not equivalent to spoken evidence and are not available in examination mode.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="assessment-title">
        <div className="container" style={{ maxWidth: 900 }}>
          <h2 id="assessment-title">After the station: assessment</h2>
          <p className="muted">Assessment is a separate step that runs after the station ends, not while you are speaking.</p>
          <ol className="flow">
            <li><p><strong>Statements are extracted with exact quotes.</strong> What you said is broken into statements, each linked to the exact words in your transcript.</p></li>
            <li><p><strong>Each rubric element is judged with evidence.</strong> Every element in the owner-approved rubric is judged against those quotes — or explicitly marked “not assessable” or “uncertain” instead of guessed.</p></li>
            <li><p><strong>Two independent assessments are compared.</strong> During the pilot, two independent model assessments are compared. Disagreements that cannot be resolved are withheld from your result and sent to our clinical owner.</p></li>
            <li><p><strong>Technical limitations are excluded.</strong> A failed image or an unheard question is never treated as your omission.</p></li>
          </ol>
          <p className="muted text-sm" style={{ margin: "16px 0 0" }}>
            More detail, including the limits of this approach, is on the <Link href="/methodology">methodology and limitations</Link> page.
          </p>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="debrief-title">
        <div className="container grid-auto-wide" style={{ alignItems: "start" }}>
          <div className="stack">
            <h2 id="debrief-title">Your debrief</h2>
            <ul className="dots">
              <li>An overall assessment, with any uncertainty stated plainly</li>
              <li>Two or three strengths, each with a quote</li>
              <li>Ranked issues: what you said or omitted → why it mattered → a stronger response → how to practise</li>
              <li>The reference approach approved by our clinical owner</li>
              <li>No more than three next actions</li>
              <li>A replay of the transcript and the images</li>
            </ul>
            <p style={{ margin: 0 }}>
              <strong>Your learning plan</strong> targets repeated, consequential gaps rather than one-off slips, and uses new cases when they are available.
            </p>
            <p style={{ margin: 0 }}>
              <strong>If you disagree</strong>, you can dispute a transcription or a grading decision from your debrief. The original result is preserved, and our clinical owner reviews significant disputes.
            </p>
            <p className="muted text-sm" style={{ margin: 0 }}>Ratings are practice estimates, not board scores, and we never show a pass probability.</p>
          </div>
          <IllustrativeFeedback />
        </div>
      </section>

      <CtaBand />
    </PublicShell>
  );
}
