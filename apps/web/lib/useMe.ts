"use client";
import { useEffect, useState } from "react";
import { api, autoSignIn, type Me } from "./api";

export type TestRole = "learner" | "owner";

/** Testing mode only (the API refuses otherwise): sign in as the seeded test account. */
export async function devLogin(as: TestRole): Promise<void> {
  await api("/api/auth/dev-login", { body: { as } });
}

function hasAccess(me: Me, as: TestRole, strict: boolean): boolean {
  if (!me.authenticated) return false;
  // Station pages accept whoever started the station (owner previews run there too).
  if (as === "learner") return !strict || me.user.role === "learner";
  return me.user.role === "owner" && (me.mfa.verified || !me.mfa.requiredForOwner);
}

/**
 * The current user. With `as`, and only when the API reports testing mode (DEV_AUTO_LOGIN), a
 * visitor without access is signed in as that test account first. `strict` (learner pages
 * other than station pages) also switches a signed-in test owner back to the test learner;
 * after such a switch the page reloads, because its data may already have loaded for the owner.
 */
export function useMe(as?: TestRole, strict = false): { me: Me | null; reload: () => void } {
  const [me, setMe] = useState<Me | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      let m: Me;
      try {
        m = await api<Me>("/api/auth/me");
      } catch {
        m = { authenticated: false, authProvider: "unknown" };
      }
      if (as && m.devAutoLogin && !hasAccess(m, as, strict)) {
        const switching = m.authenticated;
        try {
          // Shared with any data requests that hit 401 meanwhile (see autoSignIn).
          if (await autoSignIn(as)) {
            if (switching) {
              window.location.reload();
              return;
            }
            m = await api<Me>("/api/auth/me");
          }
        } catch {
          // Fall back to the normal sign-in page.
        }
      }
      if (alive) setMe(m);
    })();
    return () => {
      alive = false;
    };
  }, [n, as, strict]);
  return { me, reload: () => setN((x) => x + 1) };
}
