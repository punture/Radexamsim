import type { Metadata } from "next";
import { AppShell } from "@/components/learner/AppShell";
import { ProgressView } from "@/components/learner/ProgressView";

export const metadata: Metadata = { title: "Progress" };

export default function Page() {
  return (
    <AppShell>
      <ProgressView />
    </AppShell>
  );
}
