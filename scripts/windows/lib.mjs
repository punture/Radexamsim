// Helpers shared by the native Windows versions of the dev scripts (see scripts/platform.mjs).
import { spawn, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A failure with a message for the user; scripts/platform.mjs prints it without a stack trace. */
export class UserError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "UserError";
    this.exitCode = exitCode;
  }
}

export function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** A copy of the environment with `dir` first on PATH (the variable is usually spelled "Path"). */
export function withPathPrepended(dir, base = process.env) {
  const env = { ...base };
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[key] = env[key] ? `${dir}${path.delimiter}${env[key]}` : dir;
  return env;
}

/** Full path of a program on PATH, trying each PATHEXT extension, or null. */
export function which(name) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).map((d) => d.replace(/^"(.*)"$/, "$1")).filter(Boolean);
  const exts = path.extname(name) ? [""] : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/** Runs a program to completion, attached to this terminal; returns its exit status. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", windowsHide: true, ...opts });
  if (r.error) throw new UserError(`could not run ${path.basename(cmd)}: ${r.error.message}`);
  return r.status ?? 1;
}

/** Runs a program and captures its output as text. */
export function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...opts });
  return { ok: !r.error && r.status === 0, status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * How to start pnpm without a shell (pnpm.cmd would need cmd.exe and its quoting rules): the pnpm
 * that is running this script (npm_execpath), else the pnpm found on PATH.
 */
function pnpmCommand() {
  const candidates = [process.env.npm_execpath];
  const onPath = which("pnpm");
  if (onPath) candidates.push(onPath, path.join(path.dirname(onPath), "node_modules", "pnpm", "bin", "pnpm.cjs"));
  for (const c of candidates) {
    if (!c || !isFile(c)) continue;
    if (/\.[cm]?js$/i.test(c)) return [process.execPath, [c]];
    if (/\.exe$/i.test(c)) return [c, []];
  }
  throw new UserError("pnpm was not found. Install it with: npm install -g pnpm@10.28.0");
}

export function runPnpm(args, opts) {
  const [cmd, pre] = pnpmCommand();
  return run(cmd, [...pre, ...args], opts);
}

export function spawnPnpm(args, opts = {}) {
  const [cmd, pre] = pnpmCommand();
  return spawn(cmd, [...pre, ...args], { stdio: "inherit", windowsHide: true, ...opts });
}

/** Stops a child process and everything it started. */
export function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}

/** The bin folder of PostgreSQL `major`: PG_BIN, PATH, then the usual install folders; or null. */
export function findPostgresBin(major) {
  const dirs = [process.env.PG_BIN];
  const onPath = which("pg_ctl");
  if (onPath) dirs.push(path.dirname(onPath));
  for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles]) {
    if (base) dirs.push(path.join(base, "PostgreSQL", String(major), "bin"));
  }
  for (const dir of dirs) {
    const pgCtl = dir && path.join(dir, "pg_ctl.exe");
    if (!pgCtl || !isFile(pgCtl)) continue;
    const m = /\(PostgreSQL\)\s+(\d+)/.exec(capture(pgCtl, ["--version"]).stdout);
    if (m && Number(m[1]) === major) return dir;
  }
  return null;
}

/** tesseract.exe on PATH or in the usual install folders, or null. */
export function findTesseract() {
  const found = which("tesseract");
  if (found) return found;
  const local = process.env.LOCALAPPDATA;
  for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], local && path.join(local, "Programs"), local]) {
    const p = base && path.join(base, "Tesseract-OCR", "tesseract.exe");
    if (p && isFile(p)) return p;
  }
  return null;
}

/** A Python interpreter of at least version [major, minor] (py launcher first, then PATH), or null. */
export function findPython([major, minor]) {
  const probe = `import sys; print(sys.executable if sys.version_info >= (${major}, ${minor}) else "")`;
  const candidates = [];
  const py = which("py");
  if (py) for (const v of [`-${major}.${minor}`, `-${major}`]) candidates.push([py, [v]]);
  for (const name of ["python3", "python"]) {
    const p = which(name);
    if (p) candidates.push([p, []]);
  }
  for (const [cmd, pre] of candidates) {
    const exe = capture(cmd, [...pre, "-I", "-c", probe]).stdout.trim();
    if (exe && isFile(exe)) return exe;
  }
  return null;
}
