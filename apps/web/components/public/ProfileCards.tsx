"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ProvisionalProfileNote } from "@sim/ui";
import { api } from "@/lib/api";

type PublicProfile = {
  versionId: string;
  displayName: string;
  board: string;
  track: string;
  stationDurationSeconds: number;
  modes?: string[];
  verification: { status: string };
  publicDescription: string;
};

type CardData = {
  key: string;
  title: string;
  tag: string;
  status: string;
  facts: string[];
  description: string;
  link: { href: string; label: string } | null;
};

/** Shown while loading and whenever the live profile list cannot be fetched. */
const STATIC_CARDS: CardData[] = [
  {
    key: "abr",
    title: "ABR-oriented practice",
    tag: "ABR-oriented",
    status: "provisional",
    facts: ["About 25 minutes per station", "Practice estimates on the publicly described 68–72 case scale"],
    description:
      "A provisional practice configuration for the neuroradiology category of the ABR Diagnostic Radiology oral exam format, publicly described as returning in 2028. Independent; not affiliated with or endorsed by the ABR.",
    link: { href: "/abr", label: "About ABR-oriented practice" },
  },
  {
    key: "rcpsc",
    title: "RCPSC-oriented practice",
    tag: "RCPSC-oriented",
    status: "provisional",
    facts: ["14-minute station (length unconfirmed for Diagnostic Radiology)", "Qualitative ratings in four product domains"],
    description:
      "A provisional practice configuration with neuroradiology content for Royal College Diagnostic Radiology candidates. Independent; not affiliated with or endorsed by the Royal College.",
    link: { href: "/rcpsc", label: "About RCPSC-oriented practice" },
  },
  {
    key: "advanced",
    title: "Advanced neuroradiology practice track",
    tag: "Practice track",
    status: "provisional",
    facts: ["Deliberate practice", "No exam-equivalence claim"],
    description: "An optional advanced neuroradiology practice track, separate from exam-oriented practice.",
    link: { href: "/how-it-works", label: "How practice works" },
  },
];

function isProfile(v: unknown): v is PublicProfile {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<PublicProfile>;
  return typeof p.versionId === "string" && typeof p.displayName === "string" && typeof p.board === "string" && typeof p.stationDurationSeconds === "number" && typeof p.publicDescription === "string" && !!p.verification && typeof p.verification.status === "string";
}

function toCard(p: PublicProfile): CardData {
  const minutes = Math.round(p.stationDurationSeconds / 60);
  const modes = p.modes ?? [];
  const modeText = modes.includes("exam") && modes.includes("practice") ? "Examination and practice modes" : modes.includes("practice") ? "Practice mode only" : modes.includes("exam") ? "Examination mode" : null;
  const isAbr = p.board === "ABR";
  const isRc = p.board === "RCPSC";
  return {
    key: p.versionId,
    title: p.displayName,
    tag: isAbr ? "ABR-oriented" : isRc ? "RCPSC-oriented" : p.track === "advanced_practice" ? "Practice track" : "Practice",
    status: p.verification.status,
    facts: [`${minutes}-minute station`, ...(modeText ? [modeText] : [])],
    description: p.publicDescription,
    link: isAbr ? { href: "/abr", label: "About ABR-oriented practice" } : isRc ? { href: "/rcpsc", label: "About RCPSC-oriented practice" } : { href: "/how-it-works", label: "How practice works" },
  };
}

/** Practice profile cards. Fetches the live profile list; falls back to static text if it is unavailable. */
export function ProfileCards() {
  const [cards, setCards] = useState<CardData[] | null>(null);
  useEffect(() => {
    let alive = true;
    api<unknown>("/api/profiles")
      .then((r) => {
        if (!alive) return;
        const list = Array.isArray(r) ? r.filter(isProfile) : [];
        setCards(list.length > 0 ? list.map(toCard) : null);
      })
      .catch(() => {
        if (alive) setCards(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  const shown = cards ?? STATIC_CARDS;
  return (
    <div className="grid-auto">
      {shown.map((c) => (
        <article key={c.key} className="card stack" aria-labelledby={`profile-${c.key}`}>
          <div className="row">
            <span className="badge">{c.tag}</span>
            <ProvisionalProfileNote status={c.status} />
          </div>
          <h3 id={`profile-${c.key}`} style={{ margin: 0 }}>{c.title}</h3>
          <ul className="dots muted-dots text-sm">
            {c.facts.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <p className="muted" style={{ margin: 0 }}>{c.description}</p>
          {c.link && <Link href={c.link.href} className="self-start">{c.link.label}</Link>}
        </article>
      ))}
    </div>
  );
}
