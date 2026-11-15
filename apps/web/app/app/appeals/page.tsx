import type { Metadata } from "next";
import { AppShell } from "@/components/learner/AppShell";
import { AppealsList } from "@/components/learner/AppealsList";

export const metadata: Metadata = { title: "Appeals" };

export default function Page() {
  return (
    <AppShell>
      <AppealsList />
    </AppShell>
  );
}
