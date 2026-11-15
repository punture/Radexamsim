import { AppShell } from "@/components/learner/AppShell";
import { Debrief } from "@/components/learner/Debrief";

export const metadata = { title: "Results" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <Debrief sessionId={id} />
    </AppShell>
  );
}
