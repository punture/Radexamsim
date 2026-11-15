import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * Owner console smoke test (Milestone 2: the owner can understand and approve a case
 * without reading raw JSON). Signs in with the second factor, opens a case's human-readable
 * review package with image previews, and checks the coverage, metrics and configuration
 * pages against the real API. Uses the fictional development fixtures only.
 */
const DB = process.env.E2E_DATABASE_URL ?? "postgres://sim:sim_dev_password@127.0.0.1:5432/sim_e2e";

function currentOwnerCode(): string {
  const out = execSync("pnpm --filter @sim/api exec tsx src/totp-cli.ts", { env: { ...process.env, DATABASE_URL: DB, NODE_ENV: "development" }, encoding: "utf8" });
  const code = out.trim().split("\n").pop()!.trim();
  if (!/^\d{6}$/.test(code)) throw new Error(`unexpected TOTP output: ${out}`);
  return code;
}

test("owner signs in with a second factor and reviews a case from the human-readable package", async ({ page }) => {
  await page.goto("/sign-in?next=/owner");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("owner-dev-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Verification code" })).toBeVisible();
  await page.getByLabel(/6-digit code/).fill(currentOwnerCode());
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();

  // Case list → review package.
  await page.getByRole("navigation", { name: "Owner" }).getByRole("link", { name: "Cases", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible();
  await page.getByRole("link", { name: /Acute left MCA infarct with M1 occlusion/ }).click();
  await expect(page.getByRole("heading", { name: /Acute left MCA infarct/ })).toBeVisible();
  await expect(page.getByText("Development fixture — fictional content with placeholder images.")).toBeVisible();

  // Everything clinically material is readable without JSON.
  await expect(page.getByRole("heading", { name: /Clinical truth/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How the case runs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Rubric/ })).toBeVisible();
  await expect(page.getByText("Localizes the abnormality to the correct (left) hemisphere.")).toBeVisible();
  const preview = page.getByRole("img", { name: /CT head without contrast, axial frame 1/ });
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // Automated checks and the approval controls are reachable from the same page.
  await page.getByRole("tab", { name: /Checks & critiques/ }).click();
  await expect(page.getByRole("heading", { name: "Automated checks" })).toBeVisible();

  // Coverage never counts fixtures as clinical cases.
  await page.getByRole("navigation", { name: "Owner" }).getByRole("link", { name: "Coverage" }).click();
  await expect(page.getByText("No clinical cases are published")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Content requests" })).toBeVisible();

  // Configuration: kill switches and provisional profiles.
  await page.getByRole("navigation", { name: "Owner" }).getByRole("link", { name: "Configuration" }).click();
  await expect(page.getByRole("heading", { name: "Kill switches" })).toBeVisible();
  await expect(page.getByText("provisional").first()).toBeVisible();

  // Metrics render with explicit denominators/notes.
  await page.getByRole("navigation", { name: "Owner" }).getByRole("link", { name: "Metrics" }).click();
  await expect(page.getByRole("heading", { name: "Live examination" })).toBeVisible();
});

test("a learner cannot open the owner console", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("learner@example.test");
  await page.getByLabel("Password").fill("learner-dev-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/owner");
  await expect(page.getByText("The owner console is restricted to the owner account.")).toBeVisible();
  const r = await page.request.get("/api/owner/overview");
  expect(r.status()).toBe(403);
});
