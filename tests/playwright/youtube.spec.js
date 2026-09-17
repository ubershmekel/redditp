const { test, expect } = require("@playwright/test");

const firstUrl = "https://www.youtube.com/watch?v=M7lc1UVf-VE&t=1m30s";
const secondUrl = "https://youtu.be/aqz-KE-bpKQ";

// Exercise the site's player integration without depending on YouTube ads,
// availability, or network autoplay policy. The iframe itself is cross-origin.
const api = `
parent.youtubePlayers = parent.youtubePlayers || [];
window.YT = { Player: function (frame, config) {
  var self = this;
  this.frame = frame;
  this.events = config.events;
  this.mute = function () { self.muted = true; };
  this.unMute = function () { self.muted = false; };
  this.playVideo = function () { self.played = true; };
  this.destroy = function () { self.destroyed = true; frame.remove(); };
  parent.youtubePlayers.push(this);
  setTimeout(function () { config.events.onReady({ target: self }); }, 0);
}};
window.onYouTubeIframeAPIReady();
`;

async function setup(page, { blockedAPI = false, firstImage = false } = {}) {
  await page.addInitScript(() => {
    window.youtubePlayers = [];
  });
  const children = [
    { url: firstUrl, title: "YouTube One" },
    { url: secondUrl, title: "YouTube Two" },
    { url: "/images/favicon.png", title: "Still Image" },
  ];
  if (firstImage) children.unshift(children.pop());
  await page.route("**/test-data/playwright-smoke.json", (route) =>
    route.fulfill({
      json: {
        kind: "Listing",
        data: {
          after: null,
          children: children.map((item, i) => ({
            kind: "t3",
            data: {
              ...item,
              over_18: false,
              subreddit: "videos",
              permalink: `/r/videos/comments/test${i}/video/`,
              author: "tester",
            },
          })),
        },
      },
    }),
  );
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><button style="position:absolute;left:45%;top:45%" onclick="this.textContent=\'Playing\'">Play</button>',
    }),
  );
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    blockedAPI
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: api }),
  );
  await page.goto("/r/videos?mock=playwright-smoke");
  await expect(page.locator("#navboxTitle")).toHaveText(children[0].title);
  await expect
    .poll(() => page.evaluate(() => rp.session.isAnimating))
    .toBe(false);
}

test("plays YouTube links, honors sound, advances on end, and disposes old players", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("youtube.com/embed/")) requests.push(request);
  });
  await setup(page);
  const frame = page.locator("iframe[data-youtube-src]");
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute(
    "data-youtube-src",
    /\/embed\/M7lc1UVf-VE\?.*start=90/,
  );
  await expect(frame).toHaveAttribute(
    "data-youtube-src",
    /origin=http%3A%2F%2F127.0.0.1%3A8080/,
  );
  await expect
    .poll(() =>
      page.evaluate(() => youtubePlayers[0] && youtubePlayers[0].played),
    )
    .toBe(true);
  expect(await page.evaluate(() => youtubePlayers[0].muted)).toBe(true);
  expect(requests).toHaveLength(1); // No request for the preloaded next video.
  expect(await requests[0].headerValue("referer")).toBe(
    "http://127.0.0.1:8080/",
  );
  await expect(page.locator("#navboxLink")).toHaveAttribute("href", firstUrl);
  await expect(page.locator("#navboxLink")).toHaveText("YouTube");
  await expect(page.locator("#navboxCommentsLink")).toHaveAttribute(
    "href",
    /test0/,
  );

  await page.keyboard.press("m");
  expect(await page.evaluate(() => youtubePlayers[0].muted)).toBe(false);
  await page.locator("#sound").uncheck();
  expect(await page.evaluate(() => youtubePlayers[0].muted)).toBe(true);

  // Toggling auto-next must not restore the still-image timer for a video.
  await page.evaluate(() => {
    rp.settings.timeToNextSlide = 100;
  });
  await page.locator("#autoNextSlide").uncheck();
  await page.locator("#autoNextSlide").check();
  await page.waitForTimeout(350);
  await expect(page.locator("#navboxTitle")).toHaveText("YouTube One");
  await page.evaluate(() =>
    youtubePlayers[0].events.onStateChange({ data: 0 }),
  );
  await expect(page.locator("#navboxTitle")).toHaveText("YouTube Two");
  await expect
    .poll(() => page.evaluate(() => youtubePlayers[0].destroyed))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => youtubePlayers[1] && youtubePlayers[1].played),
    )
    .toBe(true);
  await page.locator("#autoNextSlide").uncheck();
  await page.evaluate(() =>
    youtubePlayers[1].events.onStateChange({ data: 0 }),
  );
  await page.waitForTimeout(200);
  await expect(page.locator("#navboxTitle")).toHaveText("YouTube Two");
  await page.locator("#nextButton").click();
  await expect(page.locator("#navboxTitle")).toHaveText("Still Image");
  await expect(frame).toHaveCount(0);
  await expect(page.locator("#navboxLink")).toHaveText("image");
  expect(await page.evaluate(() => youtubePlayers[1].destroyed)).toBe(true);
  // Late events from a retired iframe cannot advance the current slide.
  await page.evaluate(() =>
    youtubePlayers[1].events.onStateChange({ data: 0 }),
  );
  await expect(page.locator("#navboxTitle")).toHaveText("Still Image");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#navboxTitle")).toHaveText("YouTube Two");
  expect(errors).toEqual([]);
});

test("does not contact YouTube while only preloading a video", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("youtube.com")) requests.push(request.url());
  });
  await setup(page, { firstImage: true });
  await page.locator("#autoNextSlide").uncheck();
  expect(requests).toEqual([]);
  await page.locator("#nextButton").click();
  await expect(page.locator("iframe[data-youtube-src]")).toHaveAttribute(
    "data-youtube-src",
    /M7lc1UVf-VE/,
  );
});

test("keeps native playback and navigation usable when the API is blocked", async ({
  page,
}) => {
  await setup(page, { blockedAPI: true });
  await page
    .frameLocator("iframe[data-youtube-src]")
    .frameLocator("iframe")
    .getByRole("button", { name: "Play" })
    .click();
  await expect(
    page
      .frameLocator("iframe[data-youtube-src]")
      .frameLocator("iframe")
      .getByRole("button"),
  ).toHaveText("Playing");
  await expect(page.locator("#navboxLink")).toHaveAttribute("href", firstUrl);
  await page.locator("#nextButton").click();
  await expect(page.locator("#navboxTitle")).toHaveText("YouTube Two");
  await expect(page.locator("iframe[data-youtube-src]")).toHaveCount(1);
  await expect(
    page.frameLocator("iframe[data-youtube-src]").locator("iframe"),
  ).toHaveAttribute("src", /aqz-KE-bpKQ/);
});

test("unavailable videos resume the slideshow timer", async ({ page }) => {
  await setup(page);
  await expect
    .poll(() =>
      page.evaluate(() => youtubePlayers[0] && youtubePlayers[0].played),
    )
    .toBe(true);
  await page.evaluate(() => {
    rp.settings.timeToNextSlide = 100;
    youtubePlayers[0].events.onError({ data: 150 });
  });
  await expect(page.locator("#navboxTitle")).toHaveText("YouTube Two");
});

test("touch controls navigate YouTube slides", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await setup(page);
  await page.locator("#nextButton").tap();
  await expect(page.locator("#navboxTitle")).toHaveText("YouTube Two");
  await page.locator("#prevButton").tap();
  await expect(page.locator("#navboxTitle")).toHaveText("YouTube One");
  await context.close();
});

for (const [width, height] of [
  [360, 780],
  [390, 844],
  [393, 852],
  [412, 915],
  [1920, 1080],
  [2560, 1440],
]) {
  test(`YouTube player and navigation fit ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await setup(page);
    await page.locator("#autoNextSlide").uncheck();
    const bounds = await page.locator("iframe[data-youtube-src]").boundingBox();
    expect(bounds.width).toBeGreaterThanOrEqual(200);
    expect(bounds.height).toBeGreaterThanOrEqual(200);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await page.locator("#nextButton").click();
    await expect(page.locator("#navboxTitle")).toHaveText("YouTube Two");
    await page.locator("#prevButton").click();
    await expect(page.locator("#navboxTitle")).toHaveText("YouTube One");
  });
}
