/** Unwrap drizzle's "Failed query" wrapper to the underlying PostgreSQL error, if any. */
export type PgError = Error & { code?: string; constraint?: string; detail?: string };

export function pgErrorOf(e: unknown): PgError | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof Error && typeof (cur as PgError).code === "string") return cur as PgError;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const pg = pgErrorOf(e);
  return pg?.code === "23505" && (constraint === undefined || pg.constraint === constraint);
}
