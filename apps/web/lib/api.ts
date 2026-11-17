"use client";

/**
 * Browser API client. Same-origin /api requests carry the session cookie automatically;
 * state-changing requests add the CSRF header the API requires.
 */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly issues?: { path: string; message: string }[]) {
    super(message);
  }
}

type Init = { method?: string; body?: unknown; signal?: AbortSignal };

function send(path: string, init: Init): Promise<Response> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  return fetch(path, {
    method,
    credentials: "same-origin",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "x-sim-csrf": "1" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    cache: "no-store",
  });
}

const pendingSignIns = new Map<"learner" | "owner", Promise<boolean>>();
let testingModeOff = false;

/**
 * Testing mode only (DEV_AUTO_LOGIN): sign in as the test account. Concurrent callers share one
 * sign-in, so parallel requests cannot revoke each other's session. Resolves false when the API
 * has testing mode off (remembered, so normal builds make this request at most once).
 */
export function autoSignIn(as: "learner" | "owner"): Promise<boolean> {
  if (testingModeOff) return Promise.resolve(false);
  let p = pendingSignIns.get(as);
  if (!p) {
    p = send("/api/auth/dev-login", { body: { as } })
      .then((r) => {
        if (r.status === 404) testingModeOff = true;
        return r.ok;
      })
      .catch(() => false)
      .finally(() => pendingSignIns.delete(as));
    pendingSignIns.set(as, p);
  }
  return p;
}

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  let res = await send(path, init);
  // Testing mode: a request sent before the automatic sign-in finished (401), or an owner request
  // sent while the test learner was still signed in (403), is retried once as the test account
  // for the part of the site this page belongs to. Outside testing mode nothing is retried.
  if (typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    const ownerPage = window.location.pathname.startsWith("/owner");
    const retry = res.status === 401 || (res.status === 403 && ownerPage && path.startsWith("/api/owner/"));
    if (retry && (await autoSignIn(ownerPage ? "owner" : "learner"))) res = await send(path, init);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { code?: string; message?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(res.status, d.code ?? "error", d.message ?? `Request failed (${res.status})`, d.issues);
  }
  return data as T;
}

/** devAutoLogin: development testing mode, where the test accounts are signed in automatically. */
export type Me =
  | { authenticated: false; authProvider: string; devAutoLogin?: boolean }
  | { authenticated: true; authProvider: string; devAutoLogin?: boolean; user: { id: string; email: string; displayName: string | null; role: "learner" | "owner" }; mfa: { verified: boolean; enrolled: boolean; requiredForOwner: boolean } };
