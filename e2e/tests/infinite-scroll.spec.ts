import { test, expect } from "@playwright/test";

test.describe("Infinite scroll pagination", () => {
  test("should load more challenges when scrolling to bottom", async ({ page }) => {
    // Intercept API calls
    const requests: string[] = [];
    await page.route("**/api/challenges*", (route) => {
      requests.push(route.request().url());
      route.continue();
    });

    await page.goto("/challenge");
    await page.waitForSelector("main");

    // Wait for initial cards to render
    const initialCards = page.locator("a[href^='/challenge/']");
    const initialCount = await initialCards.count();
    expect(initialCount).toBeGreaterThan(0);

    // Scroll to bottom to trigger infinite scroll
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for the next page request
    await page.waitForTimeout(1000);

    // Check that more cards appeared
    const newCards = page.locator("a[href^='/challenge/']");
    const newCount = await newCards.count();
    expect(newCount).toBeGreaterThan(initialCount);

    // Verify cursor param was sent in the second request
    const cursorRequests = requests.filter((url) => url.includes("cursor="));
    expect(cursorRequests.length).toBeGreaterThanOrEqual(1);
  });
});
