import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the root database handle or an open transaction. */
export type DbOrTx = Db | Tx;

export function createPool(url: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString: url, max, application_name: "neuro-oral-sim" });
}

export function createDb(urlOrPool: string | pg.Pool): Db {
  const pool = typeof urlOrPool === "string" ? createPool(urlOrPool) : urlOrPool;
  return drizzle({ client: pool, schema, casing: "snake_case" }) as Db;
}
