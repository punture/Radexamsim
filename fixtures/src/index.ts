import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CaseVersion } from "@sim/contracts";

/** Loader for generated development fixtures (fictional text + labelled placeholder media). */
const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_GENERATED_DIR = path.resolve(here, "../generated");
export const FIXTURE_MEDIA_DIR = path.join(FIXTURES_GENERATED_DIR, "media");

export function loadFixtureCases(): CaseVersion[] {
  const dir = path.join(FIXTURES_GENERATED_DIR, "cases");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => CaseVersion.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))));
}

export function loadFixtureCase(caseId: string): CaseVersion {
  const found = loadFixtureCases().find((c) => c.caseId === caseId);
  if (!found) throw new Error(`fixture ${caseId} not found`);
  return found;
}

export function fixtureMediaFile(storageKey: string): string {
  const resolved = path.resolve(FIXTURE_MEDIA_DIR, storageKey);
  if (!resolved.startsWith(FIXTURE_MEDIA_DIR + path.sep)) throw new Error("invalid storage key");
  return resolved;
}
