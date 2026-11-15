import { createDb, eq, users } from "@sim/db";
import { loadConfig } from "./config";
import { decryptSecret, totpCode } from "./auth/crypto";

/** Development helper: print the current TOTP code for the seeded owner account. */
const config = loadConfig();
if (config.NODE_ENV === "production") process.exit(1);
const db = createDb(config.DATABASE_URL);
const email = process.argv[2] ?? config.OWNER_EMAILS.split(",")[0]!.trim();
const [u] = await db.select().from(users).where(eq(users.email, email));
if (!u?.totpSecret) {
  console.error("no TOTP secret for", email);
  process.exit(1);
}
console.log(totpCode(decryptSecret(u.totpSecret, config.AUTH_ENCRYPTION_KEY)));
await db.$client.end();
