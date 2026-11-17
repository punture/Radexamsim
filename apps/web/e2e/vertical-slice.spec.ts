import { expect, test, type Page } from "@playwright/test";

/**
 * Vertical slice (Milestone 1 definition of done): sign in, pick a case, preflight, take
 * the case with controlled follow-ups and image reveals, finish, get supported feedback,
 * and find the result again after signing back in.
 *
 * Speech uses the labelled development channel (typed "simulated speech" sent as a
 * dev-injected transcript) and text-only examiner output, because a headless browser has
 * no microphone or speech engine. Real ASR/TTS adapters are covered separately.
 */

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function say(page: Page, text: string) {
  await page.getByTestId("dev-speech").fill(text);
  await page.getByTestId("dev-speech-send").click();
}

test("learner completes the demonstration case and receives an evidence-linked debrief", async ({ page }) => {
  await signIn(page, "learner@example.test", "learner-dev-password-123");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Setup: demonstration case (practice mode).
  await page.getByRole("link", { name: "Start demonstration" }).click();
  await expect(page.getByRole("heading", { name: "Free demonstration case" })).toBeVisible();
  await expect(page.getByText("Provisional practice configuration").first()).toBeVisible();
  await page.getByLabel(/I consent to my microphone audio/).check();
  await page.getByTestId("create-session").click();

  // Preflight.
  await expect(page.getByRole("heading", { name: "Preflight checks" })).toBeVisible();
  await expect(page.getByText("Test image decoded and displayed.")).toBeVisible();
  await page.getByTestId("preflight-continue").click();

  // Examination room.
  await expect(page.getByTestId("begin-station")).toBeVisible();
  await expect(page.getByText(/Development fixture — fictional case/)).toBeVisible();
  await page.getByTestId("begin-station").click();
  await expect(page.getByText(/67-year-old presents with sudden right-sided weakness/)).toBeVisible();
  await page.getByRole("checkbox", { name: "Live transcript" }).check();
  await expect(page.getByText(/present your findings and interpretation/).first()).toBeVisible();

  // The image is served through the authorized media route and actually decodes.
  const ctImage = page.locator('img[alt^="CT head without contrast, axial"]').first();
  await expect(ctImage).toBeVisible();
  await expect.poll(async () => ctImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Unavailable study: approved reply, no invented image.
  await say(page, "Is there an MRI with diffusion available?");
  await expect(page.getByText("MRI is not available for this patient at this time.").first()).toBeVisible();

  // Request vascular imaging: revealed through the approved reply after render acknowledgement.
  await say(page, "Could I see a CT angiogram please?");
  await expect(page.getByRole("button", { name: "CT angiogram head, axial MIP", exact: true })).toBeVisible();
  await expect(page.getByText("Here is the CT angiogram.").first()).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/screens/exam-room.png" });

  await say(page, "There is no intracranial hemorrhage. Early hypodensity in the left MCA territory with a hyperdense left MCA. Leading diagnosis acute left MCA infarct. That's all.");
  await expect(page.getByText("What does the CT angiogram show?").first()).toBeVisible();
  await say(page, "Left M1 occlusion. This is an emergency; I would call the stroke team directly now. That's all.");

  // The case concludes and the learner is taken to results.
  await page.waitForURL(/\/results$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Debrief" })).toBeVisible();
  await expect(page.getByText("Development baseline — not a clinical assessment").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Strengths" })).toBeVisible();
  await expect(page.locator("blockquote.evidence").first()).toContainText("“");
  await expect(page.getByRole("heading", { name: "Reference approach (owner-approved)" })).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/screens/debrief.png", fullPage: true });
  const resultsUrl = page.url();

  // Sign out and back in: the result persists.
  await page.goto("/app");
  await page.locator("summary", { hasText: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "learner@example.test", "learner-dev-password-123");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Results available").first()).toBeVisible();
  await page.getByRole("link", { name: "Results" }).first().click();
  await expect(page).toHaveURL(resultsUrl);
  await expect(page.getByText("Development baseline — not a clinical assessment").first()).toBeVisible();
});

test("another account cannot open the learner's media or results", async ({ page }) => {
  const request = page.request; // shares cookies with the page
  // Register a second learner via the API (through the same-origin proxy).
  const r = await request.post("/api/auth/register", { data: { email: "intruder@example.test", password: "intruder-password-1", acceptTerms: true }, headers: { "x-sim-csrf": "1" } });
  expect(r.ok()).toBeTruthy();
  const sessions = await request.get("/api/sessions");
  expect(await sessions.json()).toEqual([]);
  const media = await request.get(`/api/media/h_${"a".repeat(32)}/0`);
  expect(media.status()).toBe(404);
  await page.goto("/app");
  await expect(page.getByText("No stations yet.")).toBeVisible();
});
