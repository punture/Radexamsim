import type { ZodError } from "zod";

export type ContractIssue = { path: string; message: string; code: string };

/** Format a Zod path array as `stages[2].transitions[0].toStageId`. */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out.length === 0 ? String(seg) : `.${String(seg)}`;
  }
  return out.length === 0 ? "(root)" : out;
}

export function zodIssues(error: ZodError): ContractIssue[] {
  return error.issues.map((i) => ({ path: formatPath(i.path), message: i.message, code: i.code }));
}

/** Errors returned to API clients: stable code, human message, optional detail list. */
export type ApiError = { code: string; message: string; issues?: ContractIssue[] };
