import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { chromium } from "@playwright/test";

/**
 * End-to-end test of the vertical slice: real API + worker + production web build against
 * a fresh database. Speech uses the labelled development channels (dev-injected transcript,
 * text-only examiner), so it exercises the full examination flow deterministically.
 */
const API_PORT = 4100;
const WEB_PORT = 3100;
const DB = process.env.E2E_DATABASE_URL ?? "postgres://sim:sim_dev_password@127.0.0.1:5432/sim_e2e";
const defaultChrome = chromium.executablePath();
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH overrides; otherwise Playwright's own browser, else the preinstalled one.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync(defaultChrome) ? undefined : "/opt/pw-browsers/chromium");

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "off",
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    {
      command: "pnpm --filter @sim/api exec tsx src/main.ts",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        API_PORT: String(API_PORT),
        PUBLIC_API_WS_URL: `ws://localhost:${API_PORT}`,
        PUBLIC_WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        DATABASE_URL: DB,
        ASR_PROVIDER: "dev_injection_only",
        TTS_PROVIDER: "none",
        ALLOW_DEV_INJECTION: "true",
        ALLOW_FIXTURES: "true",
        STORAGE_LOCAL_ROOT: "../../var/e2e-storage",
      },
    },
    {
      command: "pnpm --filter @sim/worker exec tsx src/main.ts",
      url: "http://127.0.0.1:4199/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NODE_ENV: "development", DATABASE_URL: DB, ALLOW_DEV_BASELINE_ASSESSOR: "true", WORKER_HEALTH_PORT: "4199", STORAGE_LOCAL_ROOT: "../../var/e2e-storage" },
    },
    {
      command: `pnpm next build && pnpm next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { NEXT_DIST_DIR: ".next-e2e", API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`, NEXT_PUBLIC_API_WS_URL: `ws://localhost:${API_PORT}`, NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
