// Native Windows version of scripts/dev-db.sh: local PostgreSQL 16 for development and tests.
//   pnpm db:start | pnpm db:stop   (or: node scripts/platform.mjs dev-db start|stop|status)
//
// Uses the first of: a server already accepting connections on 127.0.0.1:PGPORT; Docker (the same
// container as dev-db.sh); or the PostgreSQL 16 programs (PG_BIN, PATH or the usual install
// folders), with which it runs a private cluster in var/postgres-16. That cluster listens on
// 127.0.0.1 only and keeps running in the background until `pnpm db:stop` or sign-out.
// Creates role "sim" (development password only) and databases sim_dev / sim_test.
// Never use these credentials outside local development.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT, UserError, capture, findPostgresBin, run, which } from "./lib.mjs";

const PGPORT = process.env.PGPORT || "5432";
const CONTAINER = "sim-postgres";
const DEV_PASSWORD = "sim_dev_password";
const DATA_DIR = path.join(REPO_ROOT, "var", "postgres-16");
const LOG_FILE = path.join(REPO_ROOT, "var", "postgres-16.log");
const rel = (p) => path.relative(REPO_ROOT, p);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function main([action = "start"] = []) {
  if (action === "start") return start();
  if (action === "stop") return stop();
  if (action === "status") return status();
  throw new UserError("usage: node scripts/platform.mjs dev-db start|stop|status", 2);
}

function context() {
  const dockerExe = which("docker");
  return { docker: dockerExe && capture(dockerExe, ["info"]).ok ? dockerExe : null, pgBin: findPostgresBin(16) };
}

const exe = (ctx, name) => path.join(ctx.pgBin, `${name}.exe`);

function containerRunning(ctx) {
  if (!ctx.docker) return false;
  const r = capture(ctx.docker, ["ps", "--format", "{{.Names}}"]);
  return r.ok && r.stdout.split(/\r?\n/).includes(CONTAINER);
}

async function ready(ctx) {
  if (ctx.pgBin) return capture(exe(ctx, "pg_isready"), ["-q", "-h", "127.0.0.1", "-p", PGPORT]).ok;
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: Number(PGPORT) });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitReady(ctx, seconds = 30) {
  for (let i = 0; i < seconds; i++) {
    if (await ready(ctx)) return true;
    await sleep(1000);
  }
  return false;
}

function psql(ctx, user, password, sql) {
  return capture(exe(ctx, "psql"), ["-w", "-X", "-h", "127.0.0.1", "-p", PGPORT, "-U", user, "-d", "postgres", "-tAc", sql], {
    env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: "5" },
  });
}

/** One SQL statement as the development role itself. */
const simSql = (ctx, sql) => psql(ctx, "sim", DEV_PASSWORD, sql);
const simCanLogin = (ctx) =>
  Boolean(ctx.pgBin) && simSql(ctx, "SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user").stdout.trim() === "t";

/**
 * One SQL statement as the PostgreSQL superuser: inside the Docker container, or as "postgres"
 * with the development password (which the private cluster and the container both use).
 */
function superSql(ctx, sql) {
  if (containerRunning(ctx)) return capture(ctx.docker, ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-tAc", sql]);
  if (ctx.pgBin) return psql(ctx, "postgres", DEV_PASSWORD, sql);
  return { ok: false, status: null, stdout: "", stderr: "" };
}

function check(result, what) {
  if (!result.ok) throw new UserError(`${what} failed${result.stderr.trim() ? `: ${result.stderr.trim()}` : ""}`);
}

function psqlCommand(ctx) {
  return ctx.pgBin ? `"${exe(ctx, "psql")}"` : "psql";
}

function setupHelp(ctx) {
  return [
    `PostgreSQL is running on port ${PGPORT}, but the development role "sim" is not set up yet, and this`,
    `script can't act as the database superuser. Run this once (psql asks for the password of the`,
    `"postgres" superuser chosen when PostgreSQL was installed), then run the same command again:`,
    ``,
    `  ${psqlCommand(ctx)} -h 127.0.0.1 -p ${PGPORT} -U postgres -c "CREATE ROLE sim LOGIN CREATEDB PASSWORD '${DEV_PASSWORD}'"`,
    ``,
    `If PostgreSQL answers that the role already exists, run it with ALTER ROLE instead of CREATE ROLE.`,
  ].join("\n");
}

function ensureRoles(ctx) {
  if (!ctx.pgBin && !containerRunning(ctx)) {
    throw new UserError(
      `PostgreSQL is accepting connections on ${PGPORT}, but psql was not found to set it up. Install PostgreSQL 16 ` +
        `(README, "On Windows") or set PG_BIN to its bin folder.`,
    );
  }
  if (!simCanLogin(ctx)) {
    if (!superSql(ctx, "SELECT 1").ok) throw new UserError(setupHelp(ctx));
    if (superSql(ctx, "SELECT 1 FROM pg_roles WHERE rolname='sim'").stdout.trim() !== "1") {
      check(superSql(ctx, `CREATE ROLE sim LOGIN CREATEDB PASSWORD '${DEV_PASSWORD}'`), 'Creating the role "sim"');
    }
  }
  const simOk = simCanLogin(ctx);
  const sql = simOk ? (s) => simSql(ctx, s) : (s) => superSql(ctx, s);
  for (const db of ["sim_dev", "sim_test"]) {
    if (sql(`SELECT 1 FROM pg_database WHERE datname='${db}'`).stdout.trim() !== "1") {
      check(sql(simOk ? `CREATE DATABASE ${db}` : `CREATE DATABASE ${db} OWNER sim`), `Creating the database ${db}`);
    }
  }
  if (ctx.pgBin && !simOk) {
    throw new UserError(
      [
        `The role "sim" exists but can't log in at 127.0.0.1:${PGPORT} with the development password, or lacks CREATEDB.`,
        `Reset it once (psql asks for the "postgres" superuser password):`,
        `  ${psqlCommand(ctx)} -h 127.0.0.1 -p ${PGPORT} -U postgres -c "ALTER ROLE sim LOGIN CREATEDB PASSWORD '${DEV_PASSWORD}'"`,
      ].join("\n"),
    );
  }
}

function initPrivateCluster(ctx) {
  console.log(`Creating a private development PostgreSQL 16 cluster in ${rel(DATA_DIR)} (one time)...`);
  mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  // The superuser gets the same development-only password as the Docker container in dev-db.sh.
  const tmp = mkdtempSync(path.join(os.tmpdir(), "sim-initdb-"));
  try {
    const pwfile = path.join(tmp, "pw");
    writeFileSync(pwfile, `${DEV_PASSWORD}\n`);
    const args = ["-D", DATA_DIR, "-U", "postgres", `--pwfile=${pwfile}`, "-A", "scram-sha-256", "-E", "UTF8", "--locale=C"];
    if (run(exe(ctx, "initdb"), args, { stdio: ["ignore", "ignore", "inherit"] }) !== 0) {
      throw new UserError("initdb failed (see the messages above).");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function startPrivateCluster(ctx) {
  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) initPrivateCluster(ctx);
  console.log(`Starting the development PostgreSQL in ${rel(DATA_DIR)} (log: ${rel(LOG_FILE)})...`);
  // No inherited console (ignored stdio + windowsHide): the server keeps running in the background
  // after this command exits, and Ctrl-C in this terminal doesn't stop it.
  const opts = `-p ${PGPORT} -c listen_addresses=127.0.0.1`;
  const r = capture(exe(ctx, "pg_ctl"), ["start", "-D", DATA_DIR, "-l", LOG_FILE, "-w", "-t", "60", "-o", opts], { stdio: "ignore" });
  if (!r.ok || !(await waitReady(ctx, 10))) {
    const tail = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8").trim().split(/\r?\n/).slice(-15).join("\n") : "(no log)";
    throw new UserError(`PostgreSQL did not start (pg_ctl exit ${r.status}). Last lines of ${rel(LOG_FILE)}:\n${tail}`);
  }
}

export async function start() {
  const ctx = context();
  if (await ready(ctx)) {
    console.log(`PostgreSQL already accepting connections on ${PGPORT}.`);
  } else if (ctx.docker) {
    if (capture(ctx.docker, ["ps", "-a", "--format", "{{.Names}}"]).stdout.split(/\r?\n/).includes(CONTAINER)) {
      check(capture(ctx.docker, ["start", CONTAINER]), "docker start");
    } else {
      const volume = "sim-postgres-data:/var/lib/postgresql/data";
      const args = ["run", "-d", "--name", CONTAINER, "-p", `127.0.0.1:${PGPORT}:5432`, "-e", `POSTGRES_PASSWORD=${DEV_PASSWORD}`, "-v", volume, "postgres:16"];
      check(capture(ctx.docker, args), "docker run");
    }
    if (!(await waitReady(ctx))) throw new UserError(`The PostgreSQL container did not become ready (see: docker logs ${CONTAINER}).`);
  } else if (ctx.pgBin) {
    await startPrivateCluster(ctx);
  } else {
    throw new UserError('No Docker and no PostgreSQL 16 found. Install PostgreSQL 16 first (README, "On Windows"), or set PG_BIN to its bin folder.');
  }
  ensureRoles(ctx);
  console.log(`PostgreSQL ready: postgres://sim:${DEV_PASSWORD}@127.0.0.1:${PGPORT}/sim_dev`);
  return 0;
}

function stop() {
  const ctx = context();
  if (containerRunning(ctx)) {
    check(capture(ctx.docker, ["stop", CONTAINER]), "docker stop");
  } else if (ctx.pgBin && existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    if (capture(exe(ctx, "pg_ctl"), ["status", "-D", DATA_DIR]).ok) run(exe(ctx, "pg_ctl"), ["stop", "-D", DATA_DIR, "-m", "fast", "-w"]);
  } else {
    console.log(`No development cluster in ${rel(DATA_DIR)}. If PostgreSQL runs as a Windows service, stop it in Services.`);
  }
  console.log("stopped");
  return 0;
}

async function status() {
  const ctx = context();
  if (ctx.pgBin) return run(exe(ctx, "pg_isready"), ["-h", "127.0.0.1", "-p", PGPORT]);
  const ok = await ready(ctx);
  console.log(`127.0.0.1:${PGPORT} - ${ok ? "accepting connections" : "no response"}`);
  return ok ? 0 : 1;
}
