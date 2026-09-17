const { test, expect } = require("@playwright/test");
const fixture = require("../../test-data/playwright-smoke.json");

const memorialUrl =
  "https://www.reddit.com/r/redditp/comments/1vn2v9g/in_loving_memory_of_redditp_20142026_a/";
const emptyListing = { kind: "Listing", data: { children: [], after: null } };
const unsupportedListing = {
  kind: "Listing",
  data: {
    children: [{ kind: "t3", data: { url: "https://example.com/article" } }],
    after: null,
  },
};

async function mockListing(page, listing) {
  await page.route("**/test-data/empty-state.json", (route) =>
    route.fulfill({ json: listing }),
  );
}

test("unsupported posts show a persistent memorial with a keyboard-accessible link", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockListing(page, unsupportedListing);
  await page.goto("/r/videos?mock=empty-state");
  await expect(page.locator("#ripTitle")).toHaveText("r.i.p. redditp");
  await expect(page.locator(".toast-error")).toHaveCount(0);
  await expect(page.locator("#controlsDiv")).toBeVisible();
  await expect(page.locator("#nextButton")).toBeVisible();
  await expect(page.locator("#prevButton")).toBeVisible();
  await expect(page.locator("#titleDiv")).toBeVisible();
  await page.locator("#nextButton").click();
  await page.locator("#prevButton").click();
  await page.locator("#autoNextSlide").uncheck();
  await page.keyboard.press("p");
  await expect(page.locator("#controlsDiv .collapser")).toHaveAttribute(
    "data-openstate",
    "closed",
  );
  await page.keyboard.press("p");
  await expect(page.locator("#controlsDiv .collapser")).toHaveAttribute(
    "data-openstate",
    "open",
  );
  await page.locator("#helpButton").click();
  await expect(page.locator(".toast-info")).toBeVisible();
  await page.locator(".toast-close").click();

  // Outlast both the old toast and the auto-next timer.
  await page.clock.install();
  await page.clock.fastForward(60000);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("g");
  await expect(page.locator("#emptySlideshow")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => rp.session.loadingNextImages))
    .toBe(false);
  const link = page.getByRole("link", {
    name: "Read what happened to redditp",
  });
  // Start at the last control so tab order is deterministic after closing help.
  await page.locator("#sound").focus();
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("href", memorialUrl);
  await page.route(memorialUrl, (route) =>
    route.fulfill({ body: "Memorial post" }),
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(memorialUrl);
  expect(errors).toEqual([]);
});

test("empty listings and failed initial requests show the memorial", async ({
  page,
}) => {
  await mockListing(page, emptyListing);
  await page.goto("/r/videos?mock=empty-state");
  await expect(page.locator("#emptySlideshow")).toBeVisible();
  await page.route("**/test-data/empty-state.json", (route) => route.abort());
  await page.reload();
  await expect(page.locator("#emptySlideshow")).toBeVisible();
  await expect(page.locator(".toast-error")).toHaveCount(0);
});

test("the memorial remains centered and readable at supported viewport sizes", async ({
  browser,
  browserName,
}) => {
  for (const [width, height] of [
    [360, 780],
    [390, 844],
    [393, 852],
    [412, 915],
    [1920, 1080],
    [2560, 1440],
    [360, 240],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: width < 500 && browserName !== "firefox",
      hasTouch: width < 500,
    });
    const page = await context.newPage();
    await mockListing(page, unsupportedListing);
    await page.goto("/r/videos?mock=empty-state");
    await expect(page.locator("#emptySlideshow")).toBeVisible();
    // Keep the slideshow's existing mobile layout viewport when showing the memorial.
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    await expect(page.locator('meta[name="viewport"]')).toHaveCount(0);
    await expect(page.locator("#controlsDiv")).toBeVisible();
    await expect(page.locator("#nextButton")).toBeVisible();
    const bounds = await page.locator(".memorial").boundingBox();
    expect(
      Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2),
    ).toBeLessThan(2);
    if (height > 300) {
      expect(
        Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2),
      ).toBeLessThan(2);
    }
    const link = page.locator(".memorial-link");
    await link.scrollIntoViewIfNeeded();
    const linkBounds = await link.boundingBox();
    expect(linkBounds.height).toBeGreaterThanOrEqual(44);
    expect(linkBounds.x).toBeGreaterThanOrEqual(0);
    expect(linkBounds.x + linkBounds.width).toBeLessThanOrEqual(viewport.width);
    // Scroll offsets are rounded to physical pixels by some browsers.
    expect(linkBounds.y + linkBounds.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );
    await page.screenshot({
      path: `test-results/memorial-${width}x${height}.png`,
    });
    await context.close();
  }
});

test("a failed later request keeps loaded slides and navigation available", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/test-data/empty-state.json", (route) => {
    requests += 1;
    return requests === 1 ? route.fulfill({ json: fixture }) : route.abort();
  });
  await page.goto("/r/pics?mock=empty-state");
  await expect(page.locator("#numberButton3")).toBeVisible();
  await page.locator("#autoNextSlide").uncheck();
  await page.evaluate(() => {
    rp.session.mockDataLoaded = false;
  });
  await page.locator("#numberButton3").click();
  await expect.poll(() => requests).toBe(2);
  await expect
    .poll(() => page.evaluate(() => rp.session.loadingNextImages))
    .toBe(false);
  await expect(page.locator("#emptySlideshow")).toBeHidden();
  await page.locator("#nextButton").click();
  await expect(page.locator("#navboxTitle")).toHaveText(
    "Playwright Mock Slide One",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#navboxTitle")).toHaveText(
    "Playwright Mock Slide Two",
  );
});

test("touch navigation still advances a working slideshow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/r/pics?mock=playwright-smoke");
  await expect(page.locator("#navboxTitle")).toHaveText(
    "Playwright Mock Slide One",
  );
  await page.locator("#autoNextSlide").uncheck();
  await page.locator("#pictureSlider").evaluate((slider) => {
    const touch = (x) =>
      new Touch({
        identifier: 1,
        target: slider,
        clientX: x,
        clientY: 400,
        pageX: x,
        pageY: 400,
      });
    slider.dispatchEvent(
      new TouchEvent("touchstart", { touches: [touch(300)], bubbles: true }),
    );
    slider.dispatchEvent(
      new TouchEvent("touchmove", { touches: [touch(100)], bubbles: true }),
    );
    slider.dispatchEvent(
      new TouchEvent("touchend", { touches: [], bubbles: true }),
    );
  });
  await expect(page.locator("#navboxTitle")).toHaveText(
    "Playwright Mock Slide Two",
  );
  await expect(page.locator("#emptySlideshow")).toBeHidden();
  await context.close();
});
