#!/usr/bin/env node
// Takes the App Store screenshots: presentation mode running over a live
// Reddit page in Playwright's WebKit, at the iPhone 6.9", iPad 13", and Mac
// sizes App Store Connect asks for. Writes them to fastlane/screenshots, which
// the App Store workflow uploads.
//
// Usage: node nodejs/app-store-screenshots.js
//
// Needs `npx playwright install webkit`. The extension is injected the way the
// Playwright tests do it, so the shots show the slideshow without a browser
// frame. Each device keeps one image slide per post, picking photos whose
// shape suits its screen, until it has SHOTS_PER_DEVICE of them.

const fs = require("fs");
const path = require("path");
const { webkit } = require("playwright");

const root = path.join(__dirname, "..");
const extDir = path.join(root, "browser-extension");
const shotsDir = path.join(root, "fastlane", "screenshots");
const SOURCE = "https://www.reddit.com/r/scenery/top?t=year";
const SHOTS_PER_DEVICE = 5;
const MAX_POSTS = 40;

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15" +
  " (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

// The viewport times the scale is the pixel size App Store Connect accepts.
const devices = [
  {
    name: "iphone",
    dir: "ios",
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IOS_UA,
  },
  {
    name: "ipad",
    dir: "ios",
    viewport: { width: 1032, height: 1376 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IOS_UA.replace("iPhone; CPU iPhone OS", "iPad; CPU OS"),
  },
  {
    name: "mac",
    dir: "mac",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  },
];

(async () => {
  const browser = await webkit.launch();
  try {
    for (const { name, dir, ...options } of devices) {
      const outDir = path.join(shotsDir, dir, "en-US");
      fs.mkdirSync(outDir, { recursive: true });
      for (const old of fs.readdirSync(outDir)) {
        if (old.startsWith(`${name}-`)) fs.rmSync(path.join(outDir, old));
      }
      const context = await browser.newContext({ ...options, bypassCSP: true });
      const count = await shoot(await context.newPage(), name, outDir);
      await context.close();
      console.log(
        `${name}: ${count} screenshots in ${path.relative(root, outDir)}`,
      );
      if (count < SHOTS_PER_DEVICE) process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
})();

async function shoot(page, name, outDir) {
  const { width, height } = page.viewportSize();
  const portrait = height > width;

  await page.goto(SOURCE);
  // Reddit answers the first load with a JavaScript challenge that navigates
  // to the real page, so wait for that to settle before touching it.
  await page.waitForLoadState("load");
  await page.waitForTimeout(3000);
  // Scroll so the feed lazy-loads enough posts to choose from.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => scrollBy(0, 3000));
    await page.waitForTimeout(800);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.addStyleTag({ path: path.join(extDir, "presentation.css") });
  await page.addScriptTag({ path: path.join(extDir, "content.js") });

  let count = 0;
  for (let post = 0; post < MAX_POSTS && count < SHOTS_PER_DEVICE; post++) {
    // G skips the rest of a gallery, so each step is a new post.
    if (post) await page.keyboard.press("g");
    const image = await currentImage(page);
    if (!image) continue;
    // A landscape photo is a thin strip on a phone or tablet. The feed is
    // mostly portrait phone photos, which still look fine on the Mac.
    if (portrait && image.width > image.height) continue;
    count += 1;
    // The slideshow focuses its close button, whose focus ring is not
    // something a viewer would see.
    await page.evaluate(() => document.activeElement?.blur());
    // Let the slide transition finish.
    await page.waitForTimeout(800);
    // JPEG: App Store Connect rejects screenshots with an alpha channel, and
    // full-size PNGs of photos run to megabytes each in git.
    await page.screenshot({
      path: path.join(outDir, `${name}-${count}.jpg`),
      quality: 90,
    });
  }
  return count;
}

// The current slide's photo once it has loaded, or null for a video, text
// post, or an image that would not load.
async function currentImage(page) {
  try {
    await page.waitForFunction(
      () => {
        const img = document.querySelector(
          ".redditp__media img.redditp__image",
        );
        const video = document.querySelector(".redditp__media video");
        return video || (img && img.complete) || !img;
      },
      null,
      { timeout: 10000 },
    );
  } catch (_error) {
    return null;
  }
  return page.evaluate(() => {
    if (document.querySelector(".redditp__media video")) return null;
    const img = document.querySelector(".redditp__media img.redditp__image");
    if (!img || !img.naturalWidth) return null;
    return {
      title: document.querySelector(".redditp__title")?.textContent || "",
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  });
}
