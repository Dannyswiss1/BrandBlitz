import { expect, test } from "@playwright/test";

test("root 404 renders branded page with correct CTAs", async ({ page }) => {
  const response = await page.goto("/nonexistent-page-xyz-12345");
  expect(response?.status()).toBe(404);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /play a live challenge/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /view leaderboard/i })).toBeVisible();
});

test("root 404 links back to home and leaderboard", async ({ page }) => {
  await page.goto("/nonexistent-page-xyz-12345");

  const homeLink = page.getByRole("link", { name: /play a live challenge/i });
  await expect(homeLink).toHaveAttribute("href", "/");

  const leaderboardLink = page.getByRole("link", { name: /view leaderboard/i });
  await expect(leaderboardLink).toHaveAttribute("href", "/leaderboard");
});
