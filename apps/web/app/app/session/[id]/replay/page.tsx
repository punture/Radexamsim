import { AppShell } from "@/components/learner/AppShell";
import { Replay } from "@/components/learner/Replay";

export const metadata = { title: "Replay" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <Replay sessionId={id} />
    </AppShell>
  );
}
