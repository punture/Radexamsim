import { Suspense } from "react";
import { PublicShell } from "@/components/PublicShell";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Sign in" };
export default function Page() {
  return (
    <PublicShell>
      <div className="container page">
        <Suspense>
          <AuthForm mode="sign-in" />
        </Suspense>
      </div>
    </PublicShell>
  );
}
