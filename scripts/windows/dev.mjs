// Native Windows version of scripts/dev.sh: database, migrations, seed, then API (:4000), worker
// and web (:3000). Uses development fixtures and dev-only settings; never point this at
// production data.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { start as startDatabase } from "./dev-db.mjs";
import { REPO_ROOT, UserError, killTree, runPnpm, spawnPnpm } from "./lib.mjs";

export async function main() {
  process.chdir(REPO_ROOT);
  // Load a local .env if present (never commit it). As with `. ./.env` in dev.sh, its values
  // override the inherited environment. Then development-only defaults.
  if (existsSync(".env")) Object.assign(process.env, parseEnv(readFileSync(".env", "utf8")));
  process.env.NODE_ENV ||= "development";
  if (process.env.NODE_ENV === "production") throw new UserError("pnpm dev is for local development only");
  // Without model keys, results come from the labelled development baseline assessor.
  process.env.ALLOW_DEV_BASELINE_ASSESSOR ||= "true";
  process.env.DATABASE_URL ||= "postgres://sim:sim_dev_password@127.0.0.1:5432/sim_dev";
  await startDatabase();
  for (const step of ["db:migrate", "db:seed"]) {
    const status = runPnpm([step]);
    if (status !== 0) throw new UserError(`pnpm ${step} failed (exit ${status})`, status);
  }
  const children = ["dev:api", "dev:worker", "dev:web"].map((script) => spawnPnpm([script]));
  let stopping = false;
  const stopAll = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) killTree(child);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(sig, stopAll);
  process.on("exit", stopAll);
  console.log("Web http://localhost:3000 · API http://localhost:4000 (Ctrl-C stops all)");
  await Promise.all(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
  return 0;
}
