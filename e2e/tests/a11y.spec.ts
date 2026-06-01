import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedActiveChallenge, signInWithMockGoogle } from "./helpers";

// Accessibility audit (WCAG 2.1 A/AA) for issue #120. Runs @axe-core/playwright
// against every real page + the UI primitives they render, and fails on any
// serious/critical violation so future PRs can't regress a11y.
//
// Requires the app stack to be running (same assumption as the other e2e specs:
// web on http://localhost:3000, API reachable). Run via `pnpm --filter
// @brandblitz/web a11y` or `pnpm e2e a11y`.

const OWNER = { email: "a11y-owner@example.com", name: "A11y Owner" };

// Only serious/critical impacts gate the build; minor/moderate are reported but
// not failed, matching the issue's "zero serious/critical violations" bar.
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

async function expectNoSeriousA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const summary = blocking
    .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");

  expect(blocking, `${label} has serious/critical a11y violations:\n${summary}`).toEqual([]);
}

test.describe("a11y: public pages", () => {
  test("home", async ({ page }) => {
    await page.goto("/");
    await expectNoSeriousA11yViolations(page, "home (/)");
  });

  test("login", async ({ page }) => {
    await page.goto("/login");
    await expectNoSeriousA11yViolations(page, "login (/login)");
  });

  test("leaderboard", async ({ page }) => {
    await page.goto("/leaderboard");
    await expectNoSeriousA11yViolations(page, "leaderboard (/leaderboard)");
  });
});

test.describe("a11y: authenticated pages", () => {
  test("dashboard", async ({ page }) => {
    await signInWithMockGoogle(page, OWNER, "/dashboard");
    await page.waitForURL("**/dashboard");
    await expectNoSeriousA11yViolations(page, "dashboard (/dashboard)");
  });

  test("brand/new (BrandKitForm)", async ({ page }) => {
    await signInWithMockGoogle(page, OWNER, "/brand/new");
    await page.waitForURL("**/brand/new");
    await expectNoSeriousA11yViolations(page, "brand/new (/brand/new)");
  });
});

test.describe("a11y: dynamic pages (seeded)", () => {
  test("brand/[id] and challenge/[id]", async ({ page, request }) => {
    const { brandId, challengeId } = await seedActiveChallenge(request, OWNER);
    await signInWithMockGoogle(page, OWNER, `/brand/${brandId}`);

    await page.goto(`/brand/${brandId}`);
    await expectNoSeriousA11yViolations(page, `brand/[id] (/brand/${brandId})`);

    await page.goto(`/challenge/${challengeId}`);
    await expectNoSeriousA11yViolations(page, `challenge/[id] (/challenge/${challengeId})`);
  });

  test("profile/[username]", async ({ page }) => {
    await signInWithMockGoogle(page, OWNER, "/dashboard");
    await page.waitForURL("**/dashboard");
    // Navigate to the signed-in user's own profile via the dashboard's profile
    // link, so we land on a real /profile/[username] without guessing the slug.
    const profileLink = page.getByRole("link", { name: /profile/i }).first();
    if (await profileLink.count()) {
      await profileLink.click();
      await page.waitForURL("**/profile/**");
      await expectNoSeriousA11yViolations(page, "profile/[username]");
    } else {
      test.skip(true, "No profile link surfaced from dashboard in this build");
    }
  });
});
