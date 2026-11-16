#!/usr/bin/env node
// Entry point for the dev scripts that differ by operating system:
//
//   node scripts/platform.mjs dev | dev-db <start|stop|status> | intake <folder-or-zip> [batch-name]
//
// macOS and Linux run the bash scripts (scripts/<name>.sh) unchanged. Windows runs native Node
// versions of them (scripts/windows/<name>.mjs), so neither WSL nor bash is needed there.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NAMES = ["dev", "dev-db", "intake"];
const [name, ...args] = process.argv.slice(2);
if (!NAMES.includes(name)) {
  console.error(`usage: node scripts/platform.mjs <${NAMES.join("|")}> [args...]`);
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));

if (process.platform === "win32") {
  try {
    const { main } = await import(pathToFileURL(path.join(here, "windows", `${name}.mjs`)).href);
    process.exitCode = (await main(args)) ?? 0;
  } catch (e) {
    // Expected failures carry a message for the user; anything else is a bug, so show the stack.
    if (e?.name === "UserError") {
      if (e.message) console.error(e.message);
      process.exitCode = e.exitCode ?? 1;
    } else {
      console.error(e);
      process.exitCode = 1;
    }
  }
  // Give pending output time to flush, but never hang on a stray handle.
  setTimeout(() => process.exit(), 2000).unref();
} else {
  const child = spawn("bash", [path.join(here, `${name}.sh`), ...args], { stdio: "inherit" });
  // Ctrl-C reaches bash directly (same process group), so let it run its own cleanup; forward
  // the signals that were sent to this process only.
  process.on("SIGINT", () => {});
  for (const sig of ["SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
  child.on("error", (e) => {
    console.error(`could not run bash: ${e.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
