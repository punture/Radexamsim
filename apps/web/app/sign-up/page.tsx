import { Suspense } from "react";
import { PublicShell } from "@/components/PublicShell";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Create an account" };
export default function Page() {
  return (
    <PublicShell>
      <div className="container page">
        <Suspense>
          <AuthForm mode="sign-up" />
        </Suspense>
      </div>
    </PublicShell>
  );
}
