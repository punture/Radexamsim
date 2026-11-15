import type { ObjectStorage } from "@sim/storage";

/**
 * Startup gate: refuse to run on storage that serves objects or listings without credentials,
 * or whose privacy cannot be verified (S3 driver; see docs/runbooks/STORAGE.md). Local storage
 * has no remote access to check.
 */
export async function checkStorage(storage: ObjectStorage, log: Pick<Console, "log" | "error"> = console): Promise<void> {
  if (!storage.selfCheck) return;
  try {
    const result = await storage.selfCheck();
    log.log(`[api] storage self-check passed: ${JSON.stringify(result)}`);
  } catch (e) {
    log.error(`[api] storage self-check failed; not starting: ${(e as Error).message}`);
    process.exit(1);
  }
}
