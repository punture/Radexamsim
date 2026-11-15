import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { DraftNotice } from "@/components/public/DraftNotice";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Privacy (draft)",
  description: "Draft privacy policy, pending owner and legal review and not yet in effect: what data is collected, how audio is handled, which vendors may receive data, and your export and deletion options.",
};

export default function Page() {
  return (
    <PublicShell>
      <div className="container page">
        <div className="prose stack-lg">
          <DraftNotice document="Privacy policy" />
          <header>
            <h1>Privacy policy</h1>
            <p className="muted" style={{ margin: 0 }}>Draft version draft-2026-11-15 · {BRAND} (working name)</p>
          </header>
          <nav className="toc card card-tight" aria-label="On this page">
            <strong>On this page</strong>
            <ul>
              <li><a href="#data">Data we collect</a></li>
              <li><a href="#audio">Audio</a></li>
              <li><a href="#use">How we use data</a></li>
              <li><a href="#vendors">Vendors</a></li>
              <li><a href="#images">Case images</a></li>
              <li><a href="#choices">Your choices</a></li>
              <li><a href="#retention">Retention</a></li>
              <li><a href="#contact">Contact</a></li>
            </ul>
          </nav>
        </div>

        <div className="prose">
          <h2 id="data">Data we collect</h2>
          <ul>
            <li><strong>Account:</strong> your email address, display name and sign-in information.</li>
            <li><strong>Consents:</strong> which consents you have given or withdrawn, when, and under which policy version.</li>
            <li><strong>Transcripts:</strong> the text of your spoken (or typed) answers during stations.</li>
            <li><strong>Examiner prompts heard:</strong> exactly what the examiner said to you, including where playback was interrupted.</li>
            <li><strong>Assessments and debriefs:</strong> element-by-element judgments, quoted evidence, practice estimates, debriefs, learning plans and progress summaries, and any appeals you submit.</li>
            <li><strong>Usage and billing:</strong> your examination-minute ledger, plan and subscription status. Card details are entered on Stripe’s hosted pages and are not stored by us.</li>
            <li><strong>Technical logs:</strong> preflight results (for example microphone and image-display checks), connection events and error logs used to keep the service working and to verify platform failures.</li>
          </ul>

          <h2 id="audio">Audio</h2>
          <ul>
            <li>Your microphone audio is processed transiently to produce a transcript.</li>
            <li>Raw audio is <strong>not retained</strong> unless you opt in to recording retention in Account.</li>
            <li>The proposed retention period for opted-in recordings is 30 days, subject to the final policy. The current build does not capture recordings.</li>
          </ul>

          <h2 id="use">How we use data</h2>
          <ul>
            <li>To run stations: transcription, the examiner’s responses and timing.</li>
            <li>To assess your answers and produce debriefs, learning plans and progress summaries.</li>
            <li>To handle appeals, which may involve review by our clinical owner, a practising neuroradiologist.</li>
            <li>To manage subscriptions, examination minutes and credits for platform failures.</li>
            <li>To keep the service secure and working.</li>
            <li>To evaluate the assessment system using de-identified attempts — only if you consent (you can change this in Account).</li>
          </ul>

          <h2 id="vendors">Vendors that may receive data</h2>
          <p>The vendor list will be finalized before launch. It is currently expected to include:</p>
          <ul>
            <li><strong>Hosting provider:</strong> to be determined.</li>
            <li><strong>Anthropic:</strong> text processing of transcripts by language models (examiner, assessment and feedback).</li>
            <li><strong>A speech-recognition and speech-synthesis vendor,</strong> when enabled.</li>
            <li><strong>Your browser’s own speech service</strong> in development builds, which processes audio under the browser vendor’s terms (for example, Google for Chrome).</li>
            <li><strong>Stripe:</strong> payments.</li>
          </ul>
          <p>
            Vendor settings do not by themselves guarantee zero data retention or Canadian data residency. The final policy will say where data is stored and what each vendor retains.
          </p>

          <h2 id="images">Case images</h2>
          <p>
            Case images are de-identified teaching material reviewed by our clinical owner. The current demonstration case is fictional and uses placeholder images.
          </p>

          <h2 id="choices">Your choices</h2>
          <ul>
            <li><strong>Consents:</strong> view and change your consents at any time in Account.</li>
            <li><strong>Export:</strong> request an export of your data from Account and download it when it is ready. The private case bank is not included.</li>
            <li>
              <strong>Deletion:</strong> delete your account from Account. This deletes your transcripts, assessments, debriefs, learning plans and any recordings. A pseudonymous usage ledger (needed for accounting) and audit records without transcript text are retained.
            </li>
            <li><strong>Disputes:</strong> if a transcript or grading decision is wrong, dispute it through Appeals in the app; the original is preserved.</li>
          </ul>

          <h2 id="retention">Retention</h2>
          <p>Retention periods for each category of data will be set in the final policy. Until then, data is kept while your account is active and removed when you delete your account, except as described above.</p>

          <h2 id="contact">Contact and changes</h2>
          <p>
            Privacy contact details will be published before launch. The final policy will replace this draft, and your consent records note the policy version that applied when you gave them. For anything else, see <Link href="/support">Support</Link>.
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
