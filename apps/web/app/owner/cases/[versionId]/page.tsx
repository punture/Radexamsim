import { OwnerShell } from "@/components/owner/OwnerShell";
import { CaseWorkspace } from "@/components/owner/CaseWorkspace";

export const metadata = { title: "Case review" };
export default async function Page({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  return (
    <OwnerShell>
      <CaseWorkspace versionId={decodeURIComponent(versionId)} />
    </OwnerShell>
  );
}
