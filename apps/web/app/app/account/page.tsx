import type { Metadata } from "next";
import { AppShell } from "@/components/learner/AppShell";
import { AccountView } from "@/components/learner/AccountView";

export const metadata: Metadata = { title: "Account" };

export default function Page() {
  return (
    <AppShell>
      <AccountView />
    </AppShell>
  );
}
