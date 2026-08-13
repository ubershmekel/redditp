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
  await expect(page.locator("#navboxAboutCreator")).toHaveText("redditp (rip)");
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

test("the redditp (rip) link points at the memorial post", async ({ page }) => {
  await page.goto("/r/pics?mock=playwright-smoke");

  const ripLink = page.locator("#navboxAboutCreator");
  await expect(ripLink).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/redditp/comments/1vn2v9g/in_loving_memory_of_redditp_20142026_a/",
  );
  await expect(ripLink).toHaveAttribute("target", "_blank");
});
