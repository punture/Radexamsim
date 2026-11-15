import type { Metadata } from "next";
import { AppShell } from "@/components/learner/AppShell";
import { AppealForm } from "@/components/learner/AppealForm";

export const metadata: Metadata = { title: "Dispute a result" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <AppShell>
      <AppealForm sessionId={one(sp.session)} caseAttemptId={one(sp.case)} assessmentId={one(sp.assessment)} />
    </AppShell>
  );
}
