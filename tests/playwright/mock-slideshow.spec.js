const { test, expect } = require("@playwright/test");

test("loads mock slideshow, requests more on the last slide, and wraps back to slide one", async ({
  page,
}) => {
  await page.goto("/r/pics?mock=playwright-smoke");

  await expect(page.locator("#navboxTitle")).toHaveText(
    "Playwright Mock Slide One",
  );
  await expect(page.locator("#numberButton1")).toHaveClass(/active/);
  await expect(page.locator("#numberButton3")).toBeVisible();
  await expect(page.locator("#navboxLink")).toHaveAttribute(
    "href",
    "/images/fullscreen.png",
  );
  await expect(page.locator("#navboxAboutCreator")).toHaveText("?");
  await expect
    .poll(async () => {
      return page.evaluate(() => window.rp.session.getRedditImagesCallCount);
    })
    .toBe(1);

  await page.locator("#nextButton").click();

  await expect(page.locator("#navboxTitle")).toHaveText(
    "Playwright Mock Slide Two",
  );
  await expect(page.locator("#numberButton2")).toHaveClass(/active/);
  await expect(page.locator("#navboxCommentsLink")).toHaveAttribute(
    "href",
    /mock002/,
  );
  await expect
    .poll(async () => {
      return page.evaluate(() => window.rp.session.getRedditImagesCallCount);
    })
    .toBe(1);

  await page.keyboard.press("ArrowRight");

  await expect(page.locator("#navboxTitle")).toHaveText(
    "Playwright Mock Slide 3",
  );
  await expect(page.locator("#numberButton3")).toHaveClass(/active/);
  await expect(page.locator("#navboxCommentsLink")).toHaveAttribute(
    "href",
    /mock003/,
  );
  await expect
    .poll(async () => {
      return page.evaluate(() => window.rp.session.getRedditImagesCallCount);
    })
    .toBe(2);

  await page.locator("#nextButton").click();

  await expect(page.locator("#navboxTitle")).toHaveText(
    "Playwright Mock Slide One",
  );
  await expect(page.locator("#numberButton1")).toHaveClass(/active/);
});

test("shows the maker promo when the question mark link is clicked", async ({
  page,
}) => {
  await page.goto("/r/pics?mock=playwright-smoke");

  await page.locator("#navboxAboutCreator").click();

  const toast = page.locator(".toast-info");
  await expect(toast).toContainText("ubershmekel");
  await expect(toast).toContainText("GitHub");
});
