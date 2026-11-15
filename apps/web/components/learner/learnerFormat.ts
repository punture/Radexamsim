import { ApiError } from "@/lib/api";

/** Shared formatting helpers for learner pages (rendered client-side only, inside AppShell). */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Session-clock milliseconds as m:ss. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A human message for a failed API call. */
export function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "Too many requests. Please wait a while and try again.";
    return e.message || fallback;
  }
  return fallback;
}

export type PublicProfile = {
  versionId: string;
  displayName: string;
  board: string;
  track: string;
  modes: ("exam" | "practice")[];
  stationDurationSeconds: number;
  verification: { status: string };
};
