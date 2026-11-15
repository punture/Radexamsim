import { AppShell } from "@/components/learner/AppShell";
import { ExamRoom } from "@/components/exam/ExamRoom";

export const metadata = { title: "Examination" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell bare>
      <ExamRoom sessionId={id} />
    </AppShell>
  );
}
