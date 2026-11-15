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

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "x-sim-csrf": "1" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    cache: "no-store",
  });
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

export type Me =
  | { authenticated: false; authProvider: string }
  | { authenticated: true; authProvider: string; user: { id: string; email: string; displayName: string | null; role: "learner" | "owner" }; mfa: { verified: boolean; enrolled: boolean; requiredForOwner: boolean } };
