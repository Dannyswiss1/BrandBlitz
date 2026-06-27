import { expect, test } from "@playwright/test";
import { seedActiveChallenge, signInWithMockGoogle } from "./helpers";
import { WARMUP_MIN_SECONDS } from "../../apps/web/src/components/game/constants";

test("player can complete warmup, play 3 rounds, and reach results", async ({
  page,
  request,
}) => {
  const seeded = await seedActiveChallenge(request, {
    email: "brand-owner-game@example.com",
    name: "Game Owner",
  });

  await signInWithMockGoogle(
    page,
    { email: "player-one@example.com", name: "Player One" },
    `/challenge/${seeded.challengeId}`
  );

  await page.waitForURL(`**/challenge/${seeded.challengeId}`);
  await expect(page.getByText(/Study this brand carefully/i)).toBeVisible();

  // Button must be DISABLED at the start of the warmup phase
  const preparingButton = page.getByRole("button", { name: "Preparing..." });
  await expect(preparingButton).toBeDisabled();

  // Button must become ENABLED within WARMUP_MIN_SECONDS + 5 s buffer
  const startButton = page.getByRole("button", { name: "Start Challenge →" });
  await expect(startButton).toBeEnabled({ timeout: (WARMUP_MIN_SECONDS + 5) * 1000 });
  await startButton.click();

  for (const round of [1, 2, 3]) {
    await expect(page.getByText(`Round ${round} of 3`)).toBeVisible();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /^A/ }).click();
  }

  await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View Leaderboard" })).toBeVisible();
});

test("offline banner appears when browser context goes offline", async ({ page }) => {
  await page.goto("/leaderboard");
  await page.context().setOffline(true);

  await expect(page.getByText(/You are offline/i)).toBeVisible();

  await page.context().setOffline(false);
});
