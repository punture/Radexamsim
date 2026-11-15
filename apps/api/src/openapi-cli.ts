import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { buildDeps } from "./deps";
import { buildServer } from "./server";

/**
 * Writes docs/openapi.json (`pnpm --filter @sim/api run openapi`).
 *
 * Nothing is assembled here. The server is built in-process from the same route modules as
 * the running API and GET /api/openapi.json is injected, so the file is exactly what that
 * route serves. No port is opened.
 *
 * Configuration comes from defaults only; the process environment is ignored. Route
 * registration does not depend on configuration, so the output is the same, and no
 * provider credentials are loaded. NODE_ENV=test only turns off the request logger. The
 * database pool connects lazily and this route reads no data, so no database is needed.
 */
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/openapi.json");

const deps = buildDeps(loadConfig({ NODE_ENV: "test" }));
const { app, live } = await buildServer(deps);
try {
  const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
  if (res.statusCode !== 200) throw new Error(`GET /api/openapi.json returned ${res.statusCode}: ${res.body.slice(0, 300)}`);
  const doc = JSON.parse(res.body) as { paths?: Record<string, Record<string, unknown>> };
  const paths = Object.values(doc.paths ?? {});
  const operations = paths.reduce((n, ops) => n + Object.keys(ops).length, 0);
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${paths.length} paths, ${operations} operations)`);
} finally {
  await live.shutdown();
  await app.close();
  await deps.db.$client.end();
}
