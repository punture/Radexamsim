import { runMigrations } from "@sim/db";
import { createDb } from "@sim/db";
import { loadConfig } from "./config";
import { DEFAULT_SEED, seedDev } from "./services/seed";

const config = loadConfig();
if (config.NODE_ENV === "production") {
  console.error("Refusing to seed development fixtures in production.");
  process.exit(1);
}
await runMigrations(config.DATABASE_URL);
const db = createDb(config.DATABASE_URL);
const r = await seedDev(db, { ...DEFAULT_SEED, encryptionKey: config.AUTH_ENCRYPTION_KEY });
console.log("Seeded development data (fictional fixtures, labelled placeholder media).");
console.log(`  owner:   ${DEFAULT_SEED.ownerEmail} / ${DEFAULT_SEED.ownerPassword}`);
console.log(`  learner: ${DEFAULT_SEED.learnerEmail} / ${DEFAULT_SEED.learnerPassword}`);
if (r.ownerTotpSecret) console.log(`  owner TOTP secret (add to an authenticator app, or run: pnpm --filter @sim/api run totp): ${r.ownerTotpSecret}`);
await db.$client.end();
