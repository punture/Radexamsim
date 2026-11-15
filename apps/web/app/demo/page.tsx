import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { PageIntro } from "@/components/public/PageIntro";

export const metadata: Metadata = {
  title: "Free demonstration case",
  description: "Try one complete spoken neuroradiology practice case with examiner follow-up questions and an evidence-linked debrief. What to expect and what you need.",
};

export default function Page() {
  return (
    <PublicShell>
      <PageIntro
        eyebrow="Free demonstration"
        title="Try one case free"
        lead="The demonstration is one complete spoken practice case: a brief history and images, examiner follow-up questions, and a full debrief. No payment is needed, and it does not use examination minutes."
      >
        <div className="row">
          <Link className="btn btn-primary btn-lg" href="/sign-up">Create a free account</Link>
          <Link className="btn btn-lg" href="/app/setup?demo=1">I have an account — start the demonstration</Link>
        </div>
      </PageIntro>

      <section className="section section-alt" aria-label="About the current demonstration case">
        <div className="container" style={{ maxWidth: 900 }}>
          <div className="alert alert-info" role="note">
            <strong>About the current demonstration case</strong>
            The demonstration currently uses a fictional development case with placeholder images. It is clearly labelled as such and is not a real patient. The launch demonstration will use a case approved by our clinical owner, a practising neuroradiologist.
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="expect-title">
        <div className="container">
          <div className="section-head">
            <h2 id="expect-title">What to expect</h2>
            <p>From sign-up to debrief.</p>
          </div>
          <ol className="steps">
            <li>
              <h3>Create an account</h3>
              <p className="muted">Sign up with your email address. After you create your account, choose <strong>Start demonstration</strong> on your dashboard.</p>
            </li>
            <li>
              <h3>Preflight check</h3>
              <p className="muted">We check your microphone, audio playback, image display and connection, and ask for consent to process your microphone audio into a transcript.</p>
            </li>
            <li>
              <h3>Take the case</h3>
              <p className="muted">The demonstration runs in deliberate practice mode. Review the history and images, speak your answer, and respond to the examiner’s questions one at a time.</p>
            </li>
            <li>
              <h3>Read your debrief</h3>
              <p className="muted">An overall assessment with any uncertainty stated, strengths with quotes, ranked issues, the reference approach, up to three next actions, and a replay of the transcript and images.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="needs-title">
        <div className="container grid-auto-wide" style={{ alignItems: "start" }}>
          <div className="stack">
            <h2 id="needs-title">What you need</h2>
            <ul className="checklist">
              <li><span className="status-dot ok" aria-hidden />A current desktop version of Google Chrome or Microsoft Edge</li>
              <li><span className="status-dot ok" aria-hidden />A working microphone, and permission for this site to use it</li>
              <li><span className="status-dot ok" aria-hidden />Headphones (recommended), so the examiner’s voice is not picked up by your microphone</li>
              <li><span className="status-dot ok" aria-hidden />A stable internet connection and a quiet room</li>
            </ul>
            <p className="muted text-sm" style={{ margin: 0 }}>Other browsers, phones and tablets may not work for spoken stations.</p>
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Your audio and privacy</h3>
            <p style={{ margin: 0 }}>
              Your audio is processed to produce a transcript and is not kept as a recording unless you opt in. In development builds, speech recognition may be performed by your browser’s own speech service, which processes audio under the browser vendor’s terms.
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Details are in the <Link href="/privacy">draft privacy policy</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="start-title">
        <div className="container">
          <div className="card stack" style={{ alignItems: "flex-start" }}>
            <h2 id="start-title" style={{ marginBottom: 0 }}>Ready to try it?</h2>
            <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
              Create a free account, then choose <strong>Start demonstration</strong> on your dashboard. If you already have an account, you can go straight to the demonstration setup.
            </p>
            <div className="row">
              <Link className="btn btn-primary btn-lg" href="/sign-up">Create a free account</Link>
              <Link className="btn btn-lg" href="/app/setup?demo=1">Start the demonstration</Link>
            </div>
            <p className="muted text-sm" style={{ margin: 0 }}>
              Ratings in the debrief are practice estimates, not board scores. See <Link href="/methodology">methodology and limitations</Link>.
            </p>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
