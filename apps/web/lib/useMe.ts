"use client";
import { useEffect, useState } from "react";
import { api, type Me } from "./api";

export function useMe(): { me: Me | null; reload: () => void } {
  const [me, setMe] = useState<Me | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    api<Me>("/api/auth/me")
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe({ authenticated: false, authProvider: "unknown" }));
    return () => {
      alive = false;
    };
  }, [n]);
  return { me, reload: () => setN((x) => x + 1) };
}
