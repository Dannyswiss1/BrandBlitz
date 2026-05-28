import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { width: 375, height: 812, label: "mobile-375" },
  { width: 768, height: 1024, label: "tablet-768" },
  { width: 1024, height: 768, label: "laptop-1024" },
  { width: 1280, height: 900, label: "desktop-1280" },
];

const PUBLIC_ROUTES = ["/", "/login", "/leaderboard"];

for (const viewport of VIEWPORTS) {
  for (const route of PUBLIC_ROUTES) {
    test(`no horizontal scroll at ${viewport.width}px on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route);

      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(hasOverflow).toBe(false);
    });
  }
}

test("hamburger button visible at 375px on home page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: /open menu/i })).toBeVisible();
});

test("desktop nav links visible at 1280px on home page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Challenges" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Leaderboard" }).first()).toBeVisible();
});

test("hamburger opens and closes mobile nav at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const hamburger = page.getByRole("button", { name: /open menu/i });
  await hamburger.click();

  await expect(page.getByRole("link", { name: "Challenges" })).toBeVisible();

  await hamburger.click();
  // Desktop nav links are in the DOM but display:none on mobile; mobile nav links are removed
  await expect(page.getByRole("link", { name: "Challenges" }).first()).not.toBeVisible();
});
