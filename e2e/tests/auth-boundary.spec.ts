import { expect, test } from "@playwright/test";

test("app remains usable on public routes when /api/auth/session returns 500", async ({
  page,
}) => {
  // Simulate NextAuth session endpoint being unavailable
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 500, body: "" })
  );

  await page.goto("/login");

  // The auth boundary fallback (or the normal login page) must be visible —
  // neither a blank screen nor React's default "Application error" crash page.
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("This page crashed");

  // The public sign-in page content or the boundary fallback must be present
  const hasLoginContent = await page
    .getByRole("heading")
    .first()
    .isVisible()
    .catch(() => false);
  const hasBoundaryFallback = await page
    .getByText("Sign-in is temporarily unavailable.")
    .isVisible()
    .catch(() => false);

  expect(hasLoginContent || hasBoundaryFallback).toBe(true);
});
