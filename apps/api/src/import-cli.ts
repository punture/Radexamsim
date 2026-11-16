import { readFileSync } from "node:fs";
import path from "node:path";
import { createDb, eq, users } from "@sim/db";
import { loadConfig, ownerEmails } from "./config";
import { buildDeps } from "./deps";
import { importPackage } from "./services/owner-cases";
import { HttpError } from "./http";

/**
 * Owner tool: import sim-case-import@1 packages (zip files from tools/ingestion) as DRAFT
 * case versions, exactly as the owner console's Import page does. Imports never approve or
 * publish anything; packages with high-severity privacy findings are refused.
 *
 *   pnpm --filter @sim/api exec tsx src/import-cli.ts path/to/pkg-01.zip [more.zip ...]
 */
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: import-cli.ts <package.zip> [...]");
  process.exit(2);
}
const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const deps = buildDeps(config, { db });
const ownerEmail = [...ownerEmails(config)][0];
const [owner] = ownerEmail ? await db.select().from(users).where(eq(users.email, ownerEmail)) : [];
if (!owner || owner.role !== "owner") {
  console.error("no owner account found; run the seed or create the owner first");
  process.exit(1);
}
let failed = 0;
for (const f of files) {
  try {
    const r = await importPackage(deps, owner.id, new Uint8Array(readFileSync(f)));
    console.log(`imported ${path.basename(f)} -> ${r.versionId} (draft, ${r.issues.length} validation issue(s) to complete)`);
  } catch (e) {
    failed++;
    console.log(`refused ${path.basename(f)}:${e instanceof HttpError ? `${e.code} — ${e.message}` : (e as Error).message}`);
  }
}
await db.$client.end();
process.exit(failed ? 1 : 0);
