import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PublicShell } from "@/components/PublicShell";
import { CtaBand } from "@/components/public/CtaBand";
import { PageIntro } from "@/components/public/PageIntro";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about endorsement, exam questions, practice estimates, technical problems, typed answers, case review, audio storage and billing.",
};

type Qa = { id: string; q: string; a: ReactNode };
type Group = { id: string; title: string; items: Qa[] };

const GROUPS: Group[] = [
  {
    id: "about",
    title: "About the product",
    items: [
      {
        id: "endorsed",
        q: "Is this endorsed by the ABR or the Royal College?",
        a: (
          <p>
            No. This is an independent practice tool. It is not affiliated with, endorsed by, or using confidential material from the American Board of Radiology or the Royal College of Physicians and Surgeons of Canada. “ABR-oriented” and “RCPSC-oriented” describe practice configurations we built from public descriptions of each exam.
          </p>
        ),
      },
      {
        id: "real-questions",
        q: "Are these real exam questions?",
        a: (
          <p>
            No. Cases are written for this product from de-identified teaching material and approved by our clinical owner. We have no access to confidential exam questions and we do not try to reproduce them.
          </p>
        ),
      },
      {
        id: "reviewers",
        q: "Who reviews the cases?",
        a: (
          <p>
            Our clinical owner, a practising neuroradiologist, reviews and approves every case before it is used. Language models draft cases and run the examiner and the assessment; the clinical owner is the only human clinical reviewer, and there is no external faculty panel. See <Link href="/methodology">methodology and limitations</Link>.
          </p>
        ),
      },
      {
        id: "scope",
        q: "Does it cover the whole radiology oral exam?",
        a: (
          <p>
            No. It covers neuroradiology only, so it does not simulate a whole general radiology oral exam or any other category.
          </p>
        ),
      },
      {
        id: "clinical-use",
        q: "Can I use it to help with real patients?",
        a: (
          <p>
            No. It is an educational practice tool — not a medical device, and not for diagnosis, clinical decision support or patient care.
          </p>
        ),
      },
    ],
  },
  {
    id: "results",
    title: "Ratings and results",
    items: [
      {
        id: "seventy",
        q: "Does a 70 mean I’ll pass?",
        a: (
          <p>
            No. In the ABR-oriented profile, a 70 is a practice estimate for one practice case on the publicly described 68–72 case scale. It is not an ABR score, it has not been validated against real exam results, and we do not predict exam or category outcomes.
          </p>
        ),
      },
      {
        id: "accuracy",
        q: "How reliable is the feedback?",
        a: (
          <p>
            Every judgment is linked to an exact quote from your transcript or is explicitly marked “not assessable” or “uncertain”. During the pilot, two independent model assessments are compared and unresolved disagreements are withheld and sent to our clinical owner. Even so, agreement between models is not proof of correctness, and there has been no psychometric validation — treat results as informed practice feedback.
          </p>
        ),
      },
      {
        id: "disagree",
        q: "What if I disagree with my result or my transcript is wrong?",
        a: (
          <p>
            Choose “Dispute transcription or grading” on the case in your debrief. Your original result is preserved; any correction or reassessment is added as a new version. Our clinical owner reviews significant disputes.
          </p>
        ),
      },
    ],
  },
  {
    id: "technical",
    title: "Technical",
    items: [
      {
        id: "image-fails",
        q: "What happens if an image fails to load?",
        a: (
          <p>
            It is recorded as a technical limitation, never as your error. Anything you did not have a fair chance to address is marked “not assessable” rather than counted against you, and minutes lost to verified platform failures are credited back. See <Link href="/support">Support</Link>.
          </p>
        ),
      },
      {
        id: "typing",
        q: "Can I type instead of speaking?",
        a: (
          <p>
            Yes, as a separate typed practice experience. Typed answers are not equivalent to spoken evidence, so they are not available in examination mode.
          </p>
        ),
      },
      {
        id: "requirements",
        q: "What do I need?",
        a: (
          <p>
            A current desktop version of Google Chrome or Microsoft Edge, a working microphone and a stable connection. Headphones are recommended so the examiner’s voice is not picked up by your microphone. See the <Link href="/demo">demonstration page</Link>.
          </p>
        ),
      },
    ],
  },
  {
    id: "privacy-billing",
    title: "Privacy and billing",
    items: [
      {
        id: "audio",
        q: "Is my audio stored?",
        a: (
          <p>
            Your audio is processed transiently to produce a transcript. Raw audio is not retained unless you opt in; the proposed retention for opted-in recordings is 30 days, subject to the final policy, and the current build does not capture recordings. Transcripts are kept in your account, and you can export or delete your data from Account. See the <Link href="/privacy">draft privacy policy</Link>.
          </p>
        ),
      },
      {
        id: "minutes",
        q: "How do examination minutes work?",
        a: (
          <p>
            One examination minute is one minute of active station time, excluding technical pauses, rounded up per station. A station reserves its full duration when it starts and returns unused minutes when it ends. Unused minutes expire at the end of each period. See <Link href="/pricing">Pricing</Link>.
          </p>
        ),
      },
      {
        id: "delete",
        q: "Can I delete my account and data?",
        a: (
          <p>
            Yes. Account in the app lets you export your data and delete your account. Deletion removes your transcripts, assessments, debriefs, learning plans and any recordings; a pseudonymous usage ledger (for accounting) and audit records without transcript text are retained.
          </p>
        ),
      },
    ],
  },
];

export default function Page() {
  return (
    <PublicShell>
      <PageIntro eyebrow="FAQ" title="Frequently asked questions" lead={<>Short, direct answers. If yours is not here, see <Link href="/support">Support</Link>.</>} />
      <div className="container page" style={{ paddingTop: 0 }}>
        <div className="prose">
          <nav className="toc card card-tight" aria-label="FAQ sections">
            <strong>Sections</strong>
            <ul>
              {GROUPS.map((g) => (
                <li key={g.id}><a href={`#${g.id}`}>{g.title}</a></li>
              ))}
            </ul>
          </nav>
          {GROUPS.map((g) => (
            <section key={g.id} aria-labelledby={g.id}>
              <h2 id={g.id}>{g.title}</h2>
              {g.items.map((item) => (
                <div key={item.id}>
                  <h3 id={item.id}>{item.q}</h3>
                  {item.a}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      <CtaBand />
    </PublicShell>
  );
}
