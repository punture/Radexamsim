import { OwnerShell } from "@/components/owner/OwnerShell";
import { AttemptReview } from "@/components/owner/AttemptReview";

export const metadata = { title: "Attempt review" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OwnerShell>
      <AttemptReview id={id} />
    </OwnerShell>
  );
}
