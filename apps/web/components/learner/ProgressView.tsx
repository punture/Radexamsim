"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Spinner } from "@sim/ui";
import { api } from "@/lib/api";
import { errorText, plural } from "./learnerFormat";

type Bucket = { observations: number; credited: number; uncertainOrNotAssessable: number; caseFamilies: number };
type SkillProgress = {
  skill: string;
  label: string;
  exam: Bucket;
  practice: Bucket;
  firstExposure: Bucket;
  repeatExposure: Bucket;
  developmentFixtures: Bucket;
};
type Progress = { note: string; perSkill: SkillProgress[]; anatomyCoverage: Record<string, number>; fixtureAnatomyCoverage?: Record<string, number> };

const REGIONS: Record<string, string> = {
  brain: "Brain",
  spine: "Spine",
  head_and_neck: "Head and neck",
  vascular: "Vascular",
  skull_base: "Skull base",
  pediatric_neuro: "Pediatric neuroradiology",
};

const COLUMNS: { key: "exam" | "practice" | "firstExposure" | "repeatExposure"; label: string }[] = [
  { key: "exam", label: "Examination mode" },
  { key: "practice", label: "Deliberate practice" },
  { key: "firstExposure", label: "First exposure" },
  { key: "repeatExposure", label: "Repeat exposure" },
];

const touched = (b: Bucket) => b.observations + b.uncertainOrNotAssessable > 0;

/** "credited X of N (from F case families)" plus any uncertain/not-assessable count. Never a percentage. */
function BucketCell({ b }: { b: Bucket }) {
  if (!touched(b)) return <span className="muted">No observations</span>;
  return (
    <>
      {b.observations > 0 ? (
        <span>
          credited {b.credited} of {b.observations}{" "}
          <span className="muted">(from {plural(b.caseFamilies, "case family", "case families")})</span>
        </span>
      ) : (
        <span className="muted">No assessable observations</span>
      )}
      {b.uncertainOrNotAssessable > 0 && (
        <span className="muted text-sm" style={{ display: "block" }}>
          plus {b.uncertainOrNotAssessable} uncertain or not assessable
        </span>
      )}
    </>
  );
}

export function ProgressView() {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<Progress>("/api/learning/progress")
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(errorText(e, "Your progress could not be loaded.")));
    return () => {
      alive = false;
    };
  }, []);

  if (error)
    return (
      <div className="stack-lg">
        <h1 style={{ margin: 0 }}>Progress</h1>
        <Alert kind="danger" title="Progress unavailable">{error}</Alert>
      </div>
    );
  if (!data) return <Spinner label="Loading your progress" />;

  const perSkill = Array.isArray(data.perSkill) ? data.perSkill : [];
  const hasReal = perSkill.some((s) => touched(s.exam) || touched(s.practice));
  const hasFixtures = perSkill.some((s) => touched(s.developmentFixtures));
  const coverage = data.anatomyCoverage ?? {};
  const regionKeys = [...Object.keys(REGIONS), ...Object.keys(coverage).filter((k) => !(k in REGIONS))];
  const anyCoverage = Object.values(coverage).some((n) => n > 0);

  return (
    <div className="stack-lg">
      <div className="row-between">
        <h1 style={{ margin: 0 }}>Progress</h1>
        <Link className="btn" href="/app/plan">Open learning plan</Link>
      </div>

      <div className="alert alert-info" role="note">
        <strong>How to read these numbers</strong>
        {data.note} No pass probability is calculated or shown.
      </div>

      {!hasReal && !hasFixtures ? (
        <section className="card stack" aria-labelledby="empty-title">
          <h2 id="empty-title" style={{ margin: 0 }}>No observations yet</h2>
          <p style={{ margin: 0 }}>Complete a station and, once it has been assessed, the evidence for each skill will appear here.</p>
          <div className="row">
            <Link className="btn btn-primary" href="/app/setup">Set up a station</Link>
            <Link className="btn" href="/app/setup?demo=1">Try the demonstration</Link>
          </div>
        </section>
      ) : (
        <>
          <section className="card stack" aria-labelledby="skills-title">
            <h2 id="skills-title" style={{ margin: 0 }}>Skill evidence</h2>
            <p className="muted text-sm" style={{ margin: 0 }}>
              “Credited X of N” counts elements demonstrated without assistance (X) out of assessable observations (N), with the number of different case families they come from. Uncertain or not-assessable elements are listed separately and never counted against you. First and repeat exposure include both modes; repeat exposure to the same case family is not evidence of transfer to new cases.
            </p>
            {hasReal ? (
              <table className="table table-stack">
                <caption className="visually-hidden">Skill evidence by mode and by exposure</caption>
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    {COLUMNS.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {perSkill.map((s) => (
                    <tr key={s.skill}>
                      <th scope="row">{s.label}</th>
                      {COLUMNS.map((c) => (
                        <td key={c.key} data-label={c.label}>
                          <BucketCell b={s[c.key]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ margin: 0 }}>No observations from published cases yet. Results from development fixtures are shown separately below.</p>
            )}
          </section>

          {hasFixtures && (
            <section className="card stack" aria-labelledby="fixtures-title">
              <h2 id="fixtures-title" style={{ margin: 0 }}>Development-fixture results</h2>
              <p className="muted text-sm" style={{ margin: 0 }}>
                Results from fictional development cases. They are shown for transparency and excluded from the skill evidence above.
              </p>
              <table className="table table-stack">
                <caption className="visually-hidden">Development-fixture observations per skill</caption>
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">Development fixtures</th>
                  </tr>
                </thead>
                <tbody>
                  {perSkill.filter((s) => touched(s.developmentFixtures)).map((s) => (
                    <tr key={s.skill}>
                      <th scope="row">{s.label}</th>
                      <td data-label="Development fixtures"><BucketCell b={s.developmentFixtures} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      <section className="card stack" aria-labelledby="coverage-title">
        <h2 id="coverage-title" style={{ margin: 0 }}>Anatomy coverage</h2>
        <p className="muted text-sm" style={{ margin: 0 }}>
          Finished case attempts on published cases, by region. A case can be tagged with more than one region. Development-fixture cases are counted separately.
        </p>
        {anyCoverage ? (
          <table className="table" style={{ maxWidth: 520 }}>
            <caption className="visually-hidden">Finished case attempts by anatomy region</caption>
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col">Case attempts</th>
              </tr>
            </thead>
            <tbody>
              {regionKeys.map((k) => (
                <tr key={k}>
                  <td>{REGIONS[k] ?? k.replace(/_/g, " ")}</td>
                  <td>{coverage[k] ?? 0}{(coverage[k] ?? 0) === 0 && <span className="muted"> — not practised yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ margin: 0 }}>No finished cases yet.</p>
        )}
        {Object.keys(data.fixtureAnatomyCoverage ?? {}).length > 0 && (
          <p className="muted text-sm" style={{ margin: 0 }}>
            Development fixtures (not counted above): {Object.entries(data.fixtureAnatomyCoverage ?? {}).map(([k, n]) => `${REGIONS[k] ?? k.replace(/_/g, " ")} ${n}`).join(", ")}.
          </p>
        )}
      </section>
    </div>
  );
}
