import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";

export default function Home() {
  return (
    <PublicShell>
      <section className="hero">
        <div className="container stack">
          <span className="badge badge-info">Neuroradiology oral examination practice</span>
          <h1>Take a case the way you will at the oral exam.</h1>
          <p className="lead">See the images, speak your answer, respond to an examiner's follow-up questions, and get a specific, evidence-linked debrief with a practical plan to improve.</p>
          <div className="row">
            <Link className="btn btn-primary btn-lg" href="/sign-up">Try the free demonstration case</Link>
            <Link className="btn btn-lg" href="/how-it-works">How it works</Link>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
