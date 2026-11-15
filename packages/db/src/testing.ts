import { randomBytes } from "node:crypto";
import pg from "pg";
import { runMigrations } from "./migrate";

/**
 * Test databases: a migrated template database is created once per test run (globalSetup),
 * and each test file gets its own copy (CREATE DATABASE ... TEMPLATE) for isolation.
 */
export const TEST_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://sim:sim_dev_password@127.0.0.1:5432/postgres";
const TEMPLATE = "sim_test_template";

function urlFor(dbName: string): string {
  const u = new URL(TEST_ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: TEST_ADMIN_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function prepareTemplateDatabase(): Promise<void> {
  await admin(async (c) => {
    await c.query(`UPDATE pg_database SET datistemplate = false WHERE datname = '${TEMPLATE}'`).catch(() => undefined);
    await c.query(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${TEMPLATE}`);
  });
  await runMigrations(urlFor(TEMPLATE));
}

export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `sim_t_${randomBytes(6).toString("hex")}`;
  await admin((c) => c.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE}`));
  return {
    url: urlFor(name),
    drop: () => admin((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)).then(() => undefined),
  };
}
