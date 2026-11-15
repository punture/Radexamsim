import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function runMigrations(url: string): Promise<void> {
  const db = createDb(url);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // Outside production, default to the local development database (same default as the API).
  const url = process.env.DATABASE_URL ?? (process.env.NODE_ENV === "production" ? undefined : "postgres://sim:sim_dev_password@127.0.0.1:5432/sim_dev");
  if (!url) {
    console.error("DATABASE_URL is required in production");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log("migrations applied"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
