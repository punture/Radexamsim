import type { Metadata } from "next";
import { AppShell } from "@/components/learner/AppShell";
import { BillingView } from "@/components/learner/BillingView";

export const metadata: Metadata = { title: "Billing" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const checkout = typeof sp.checkout === "string" ? sp.checkout : null;
  return (
    <AppShell>
      <BillingView checkout={checkout} />
    </AppShell>
  );
}
