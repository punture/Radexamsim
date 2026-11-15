import { loadWorkerConfig } from "./config";
import { buildWorkerDeps } from "./deps";
import { runForever } from "./runner";
import { enqueue } from "@sim/db";

const config = loadWorkerConfig();
const deps = buildWorkerDeps(config);
const controller = new AbortController();
console.log(`[worker] ${config.WORKER_ID} started; assessment model: ${deps.providerFor("assessor_a")?.name ?? (config.ALLOW_DEV_BASELINE_ASSESSOR ? "none (DEV BASELINE ASSESSOR — not a clinical assessment)" : "none (assessments will be marked unavailable)")}`);
// Daily retention sweep (idempotent per day).
const day = new Date().toISOString().slice(0, 10);
await enqueue(deps.db, { kind: "retention_sweep", payload: {}, dedupeKey: `retention:${day}` });
const stop = () => controller.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await runForever(deps, controller.signal);
await deps.db.$client.end();
