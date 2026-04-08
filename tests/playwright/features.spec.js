const { test, expect } = require("@playwright/test");

// ---------------------------------------------------------------------------
// NSFW filtering
// ---------------------------------------------------------------------------

test.describe("NSFW toggle", () => {
  test("shows NSFW slides when nsfw is enabled (default)", async ({ page }) => {
    await page.goto("/r/pics?mock=nsfw-mix");

    // All three slides should be loaded
    await expect(page.locator("#numberButton1")).toBeVisible();
    await expect(page.locator("#numberButton2")).toBeVisible();
    await expect(page.locator("#numberButton3")).toBeVisible();

    // NSFW slide's number button gets the 'over18' class
    await expect(page.locator("#numberButton2")).toHaveClass(/over18/);

    // With nsfw ON, next from slide 1 should land on slide 2 (NSFW)
    await page.locator("#nextButton").click();
    await expect(page.locator("#navboxTitle")).toHaveText("NSFW Slide Two");
    await expect(page.locator("#numberButton2")).toHaveClass(/active/);
  });

  test("skips NSFW slides when nsfw is disabled", async ({ page }) => {
    await page.goto("/r/pics?mock=nsfw-mix");

    // Wait for slides to load
    await expect(page.locator("#numberButton3")).toBeVisible();

    // Disable NSFW via checkbox
    await page.locator("#nsfw").uncheck();
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.nsfw))
      .toBe(false);

    // Next from slide 1 should skip slide 2 (NSFW) and land on slide 3
    await page.locator("#nextButton").click();
    await expect(page.locator("#navboxTitle")).toHaveText("SFW Slide Three");
    await expect(page.locator("#numberButton3")).toHaveClass(/active/);
  });

  test("nsfw checkbox reflects rp.settings.nsfw", async ({ page }) => {
    await page.goto("/r/pics?mock=nsfw-mix");
    await expect(page.locator("#numberButton1")).toBeVisible();

    // Default: nsfw is true, checkbox is checked
    await expect(page.locator("#nsfw")).toBeChecked();

    await page.locator("#nsfw").uncheck();
    await expect(page.locator("#nsfw")).not.toBeChecked();
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.nsfw))
      .toBe(false);

    await page.locator("#nsfw").check();
    await expect(page.locator("#nsfw")).toBeChecked();
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.nsfw))
      .toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sound toggle
// ---------------------------------------------------------------------------

test.describe("Sound toggle", () => {
  test("sound is off by default", async ({ page }) => {
    await page.goto("/r/pics?mock=playwright-smoke");
    await expect(page.locator("#numberButton1")).toBeVisible();

    const soundOn = await page.evaluate(() => window.rp.settings.sound);
    expect(soundOn).toBe(false);
    await expect(page.locator("#sound")).not.toBeChecked();
  });

  test("M key toggles sound on", async ({ page }) => {
    await page.goto("/r/pics?mock=playwright-smoke");
    await expect(page.locator("#numberButton1")).toBeVisible();

    await page.keyboard.press("m");
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.sound))
      .toBe(true);
    await expect(page.locator("#sound")).toBeChecked();
  });

  test("M key toggles sound off again", async ({ page }) => {
    await page.goto("/r/pics?mock=playwright-smoke");
    await expect(page.locator("#numberButton1")).toBeVisible();

    await page.keyboard.press("m");
    await page.keyboard.press("m");
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.sound))
      .toBe(false);
    await expect(page.locator("#sound")).not.toBeChecked();
  });

  test("sound checkbox directly updates rp.settings.sound", async ({
    page,
  }) => {
    await page.goto("/r/pics?mock=playwright-smoke");
    await expect(page.locator("#numberButton1")).toBeVisible();

    await page.locator("#sound").check();
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.sound))
      .toBe(true);

    await page.locator("#sound").uncheck();
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.sound))
      .toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auto-next
// ---------------------------------------------------------------------------

test.describe("Auto-next toggle", () => {
  test("auto-next is on by default", async ({ page }) => {
    await page.goto("/r/pics?mock=playwright-smoke");
    await expect(page.locator("#numberButton1")).toBeVisible();

    const autoOn = await page.evaluate(
      () => window.rp.settings.shouldAutoNextSlide,
    );
    expect(autoOn).toBe(true);
    await expect(page.locator("#autoNextSlide")).toBeChecked();
  });

  test("auto-next checkbox updates rp.settings", async ({ page }) => {
    await page.goto("/r/pics?mock=playwright-smoke");
    await expect(page.locator("#numberButton1")).toBeVisible();

    await page.locator("#autoNextSlide").uncheck();
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.shouldAutoNextSlide))
      .toBe(false);

    await page.locator("#autoNextSlide").check();
    await expect
      .poll(() => page.evaluate(() => window.rp.settings.shouldAutoNextSlide))
      .toBe(true);
  });

  test("slide advances automatically when auto-next is on", async ({
    page,
  }) => {
    await page.goto("/r/pics?mock=playwright-smoke");
    await expect(page.locator("#navboxTitle")).toHaveText(
      "Playwright Mock Slide One",
    );

    // Speed up the timer so the test doesn't wait 6 seconds
    await page.evaluate(() => {
      window.rp.settings.timeToNextSlide = 300;
      // resetNextSlideTimer is inside the closure — trigger it by calling
      // the auto-next checkbox change handler which calls updateAutoNext
      const checkbox = document.getElementById("autoNextSlide");
      checkbox.dispatchEvent(new Event("change"));
    });

    await expect(page.locator("#navboxTitle")).toHaveText(
      "Playwright Mock Slide Two",
      { timeout: 2000 },
    );
  });

  test("slide does NOT advance when auto-next is off", async ({ page }) => {
    await page.goto("/r/pics?mock=playwright-smoke");
    await expect(page.locator("#navboxTitle")).toHaveText(
      "Playwright Mock Slide One",
    );

    // Disable auto-next, then speed up and fire the timer
    await page.locator("#autoNextSlide").uncheck();
    await page.evaluate(() => {
      window.rp.settings.timeToNextSlide = 300;
      const checkbox = document.getElementById("autoNextSlide");
      checkbox.dispatchEvent(new Event("change"));
    });

    // Wait longer than the timer and verify no slide change
    await page.waitForTimeout(600);
    await expect(page.locator("#navboxTitle")).toHaveText(
      "Playwright Mock Slide One",
    );
  });
});

// ---------------------------------------------------------------------------
// Gallery / album navigation
// ---------------------------------------------------------------------------

test.describe("Gallery navigation", () => {
  test("gallery post creates a single numbered button with count", async ({
    page,
  }) => {
    await page.goto("/r/aww?mock=gallery-feature");

    // 3 fixture entries: 1 regular + 1 gallery (3 images) + 1 regular
    // The gallery is compressed into one numbered button (button id="numberButton2")
    // The post-gallery regular slide has id="numberButton5" because button ids are
    // 1-based indices into rp.photos (which has 5 entries: reg + 3 gallery + reg)
    await expect(page.locator("#numberButton1")).toBeVisible();
    await expect(page.locator("#numberButton2")).toBeVisible();
    await expect(page.locator("#numberButton5")).toBeVisible();

    // The gallery button has class "gallery"
    await expect(page.locator("#numberButton2")).toHaveClass(/gallery/);

    // The gallery button contains a galleryCount element showing /3
    const galleryCount = page.locator("#numberButton2 .galleryCount");
    await expect(galleryCount).toHaveText("/3");
  });

  test("first gallery slide shows Gallery: 1/3 in navbox", async ({ page }) => {
    await page.goto("/r/aww?mock=gallery-feature");

    // Navigate to the gallery (slide 2)
    await page.locator("#numberButton2").click();

    await expect(page.locator("#navboxGallery")).toHaveText("Gallery: 1/3");
    await expect(page.locator("#navboxTitle")).toHaveText(
      "Three Cat Photos Gallery",
    );
  });

  test("next button advances through gallery images", async ({ page }) => {
    await page.goto("/r/aww?mock=gallery-feature");

    // Jump to gallery start
    await page.locator("#numberButton2").click();
    await expect(page.locator("#navboxGallery")).toHaveText("Gallery: 1/3");

    await page.locator("#nextButton").click();
    await expect(page.locator("#navboxGallery")).toHaveText("Gallery: 2/3");

    await page.locator("#nextButton").click();
    await expect(page.locator("#navboxGallery")).toHaveText("Gallery: 3/3");
  });

  test("G key skips the rest of the gallery", async ({ page }) => {
    await page.goto("/r/aww?mock=gallery-feature");

    // Jump to gallery start (gallery image 1/3)
    await page.locator("#numberButton2").click();
    await expect(page.locator("#navboxGallery")).toHaveText("Gallery: 1/3");

    // Wait for animation to settle before pressing G so skipGallery
    // runs against the correct activeIndex and isn't queued as a scheduledAnimation
    await expect
      .poll(() => page.evaluate(() => !window.rp.session.isAnimating))
      .toBe(true);

    // G key calls skipGallery — should jump from gallery 1/3 past
    // the remaining 2 gallery items and land on the post-gallery slide
    await page.keyboard.press("g");

    // After skipping the gallery we should be on the regular post-gallery slide
    await expect(page.locator("#navboxGallery")).toHaveText("");
    await expect(page.locator("#navboxTitle")).toHaveText(
      "Regular Slide After Gallery",
    );
  });
});
