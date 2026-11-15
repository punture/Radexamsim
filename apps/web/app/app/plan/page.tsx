import type { Metadata } from "next";
import { AppShell } from "@/components/learner/AppShell";
import { LearningPlanView } from "@/components/learner/LearningPlanView";

export const metadata: Metadata = { title: "Learning plan" };

export default function Page() {
  return (
    <AppShell>
      <LearningPlanView />
    </AppShell>
  );
}
