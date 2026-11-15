import { AppShell } from "@/components/learner/AppShell";
import { Preflight } from "@/components/learner/Preflight";

export const metadata = { title: "Preflight" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <Preflight sessionId={id} />
    </AppShell>
  );
}
