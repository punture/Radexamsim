import { loadWorkerConfig } from "./config";
import { buildWorkerDeps } from "./deps";
import { runForever } from "./runner";
import { enqueue } from "@sim/db";

const config = loadWorkerConfig();
const deps = buildWorkerDeps(config);
if (deps.storage.selfCheck) {
  // Refuse to run on storage that serves objects without credentials, or whose privacy cannot be verified.
  try {
    const r = await deps.storage.selfCheck();
    console.log(`[worker] storage self-check passed: ${JSON.stringify(r)}`);
  } catch (e) {
    console.error(`[worker] storage self-check failed; not starting: ${(e as Error).message}`);
    process.exit(1);
  }
}
const controller = new AbortController();
console.log(`[worker] ${config.WORKER_ID} started; assessment model: ${deps.providerFor("assessor_a")?.name ?? (config.ALLOW_DEV_BASELINE_ASSESSOR ? "none (DEV BASELINE ASSESSOR — not a clinical assessment)" : "none (assessments will be marked unavailable)")}`);
// Daily retention sweep (idempotent per day).
const day = new Date().toISOString().slice(0, 10);
await enqueue(deps.db, { kind: "retention_sweep", payload: {}, dedupeKey: `retention:${day}` });
// Optional liveness endpoint for orchestrators (and the E2E harness).
let health: import("node:http").Server | null = null;
if (process.env.WORKER_HEALTH_PORT) {
  const { createServer } = await import("node:http");
  health = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: req.url === "/health", worker: config.WORKER_ID }));
  }).listen(Number(process.env.WORKER_HEALTH_PORT), "127.0.0.1");
}
// On SIGTERM/SIGINT: stop claiming jobs, finish the current one, close the health endpoint
// (otherwise the open server keeps the process alive after the runner stops).
const stop = () => {
  controller.abort();
  health?.close();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await runForever(deps, controller.signal);
await deps.db.$client.end();
