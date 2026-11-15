import { execSync } from "node:child_process";

/** Fresh e2e database: drop, create, migrate and seed development fixtures. */
export default async function prepareDb(): Promise<void> {
  const admin = process.env.E2E_ADMIN_URL ?? "postgres://sim:sim_dev_password@127.0.0.1:5432/postgres";
  const db = process.env.E2E_DATABASE_URL ?? "postgres://sim:sim_dev_password@127.0.0.1:5432/sim_e2e";
  execSync(`psql "${admin}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS sim_e2e WITH (FORCE)" -c "CREATE DATABASE sim_e2e"`, { stdio: "inherit" });
  execSync("pnpm --filter @sim/api exec tsx src/seed.ts", { stdio: "inherit", env: { ...process.env, DATABASE_URL: db, NODE_ENV: "development" } });
}

if (process.argv[1]?.endsWith("prepare-db.ts")) await prepareDb();
