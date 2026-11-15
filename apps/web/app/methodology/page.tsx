import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { PageIntro } from "@/components/public/PageIntro";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Methodology and limitations",
  description: "Who and what produces the cases, the examiner and the feedback, how results are assessed, and the limits on how much weight practice estimates can bear.",
};

const ROLES: { task: string; how: string; check: string }[] = [
  {
    task: "Case authoring",
    how: "Language models draft cases, examiner questions, approved replies and rubrics from de-identified teaching material.",
    check: "Our clinical owner reviews and approves every case before learners see it.",
  },
  {
    task: "Examining",
    how: "A language model runs the conversation, choosing only from owner-approved questions, replies and image reveals.",
    check: "It cannot invent findings, results or images.",
  },
  {
    task: "Assessment",
    how: "Language models extract your statements with exact quotes and judge each owner-approved rubric element.",
    check: "Quotes are checked against the transcript. During the pilot, unresolved disagreements between two independent assessments go to the clinical owner.",
  },
  {
    task: "Critique",
    how: "Language models review drafts and outputs to catch errors and inconsistencies.",
    check: "A model check, not a substitute for human review.",
  },
  {
    task: "Clinical review",
    how: "One person: our clinical owner, a practising neuroradiologist.",
    check: "There is no external faculty panel.",
  },
];

export default function Page() {
  return (
    <PublicShell>
      <PageIntro
        eyebrow="Methodology"
        title="Methodology and limitations"
        lead={`How ${BRAND} produces its cases, examiner and feedback — and the limits on how much weight you should put on the results. We would rather you calibrate your trust than over-rely on it.`}
      />

      <div className="container page">
        <div className="prose">
          <nav className="toc card card-tight" aria-label="On this page">
            <strong>On this page</strong>
            <ul>
              <li><a href="#who">Who does what</a></li>
              <li><a href="#assessment">How a result is produced</a></li>
              <li><a href="#limitations">Limitations</a></li>
              <li><a href="#safeguards">Safeguards</a></li>
              <li><a href="#changes">Changes</a></li>
            </ul>
          </nav>

          <h2 id="who">Who does what</h2>
          <p>Language models do the authoring, examining, assessment and critique. Our clinical owner, a practising neuroradiologist, is the only human clinical reviewer.</p>
        </div>
        <div className="card" style={{ maxWidth: 980 }}>
          <table className="table table-stack">
            <caption className="visually-hidden">Who performs each task and what human or automated check applies</caption>
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">How it is done</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.task}>
                  <th scope="row">{r.task}</th>
                  <td data-label="How it is done">{r.how}</td>
                  <td data-label="Check">{r.check}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prose">
          <h2 id="assessment">How a result is produced</h2>
          <p>Assessment is a separate step that runs after the station ends.</p>
          <ol>
            <li><strong>Transcript.</strong> Your speech is transcribed. The examiner prompts you heard are recorded exactly as they were played to you.</li>
            <li><strong>Statements with exact quotes.</strong> What you said is broken into statements, each linked to the exact words in your transcript. Quotes that cannot be found in the transcript are rejected.</li>
            <li><strong>Element-by-element judgments.</strong> Each owner-approved rubric element is judged with evidence — or explicitly marked “not assessable” or “uncertain”. An omission only counts when you had a real opportunity — for example, the relevant images had loaded and any question about them had been played to you.</li>
            <li><strong>Independent comparison.</strong> During the pilot, two independent model assessments are compared. Disagreements that cannot be resolved are withheld from your result and sent to the clinical owner.</li>
            <li><strong>Technical limitations.</strong> A missing or failed image, or a question you could not hear, is a technical limitation — never your error.</li>
            <li><strong>Debrief and practice estimate.</strong> Feedback is composed from supported judgments only. A profile-specific practice estimate is shown where there is enough assessable evidence, and withheld where there is not.</li>
          </ol>

          <h2 id="limitations">Limitations</h2>
          <p>Please read these before relying on any result.</p>
          <ul>
            <li><strong>Models do the work.</strong> Language models author draft cases, run the examiner, assess your answers and critique outputs. They can be wrong in ways that are hard to spot.</li>
            <li><strong>One human reference.</strong> Our clinical owner is the only human clinical reviewer and approves every case. Our claims are limited by that single human reference: another expert might weigh some elements differently.</li>
            <li><strong>Agreement is not correctness.</strong> When two model assessments agree, that is not proof they are right — both can be wrong in the same way.</li>
            <li><strong>No external validation.</strong> There has been no external faculty panel review and no psychometric validation. We have not shown that practice estimates correspond to exam performance.</li>
            <li><strong>Practice estimates are not board scores.</strong> They are not issued by, or equivalent to scores from, any examining board, and we never calculate a pass probability.</li>
            <li><strong>Transcription errors happen.</strong> Speech recognition can mishear terms, accents or quiet speech. You can dispute a transcript or a grading decision through Appeals in the app; the original result is preserved.</li>
            <li><strong>Provisional exam profiles.</strong> The <Link href="/abr">ABR-oriented</Link> and <Link href="/rcpsc">RCPSC-oriented</Link> profiles are practice configurations built from public descriptions. Check the current official pages.</li>
            <li><strong>Neuroradiology only.</strong> Neuro-only practice does not simulate a whole general radiology oral exam.</li>
            <li><strong>Development content.</strong> The current demonstration uses a fictional development case with placeholder images, labelled as such.</li>
            <li><strong>Not a medical device.</strong> This is an educational tool. It is not for diagnosis, clinical decision support or patient care.</li>
          </ul>

          <h2 id="safeguards">Safeguards</h2>
          <ul>
            <li>Every judgment is tied to quoted evidence, or explicitly marked “not assessable” or “uncertain”.</li>
            <li>Technical failures are never counted against you.</li>
            <li>Unresolved disagreements are withheld and reviewed by the clinical owner.</li>
            <li>Disputes never overwrite history: corrections and reassessments are added as new versions alongside the original.</li>
            <li>Progress shows counts and how many different case families they come from, and keeps examination and practice, first and repeat exposure, separate.</li>
            <li>Assisted answers in deliberate practice never count as unassisted ones.</li>
          </ul>

          <h2 id="changes">Changes to this page</h2>
          <p>We will update this page when the method changes or when any validation work is done. Last updated 15 November 2026.</p>
        </div>
      </div>
    </PublicShell>
  );
}
