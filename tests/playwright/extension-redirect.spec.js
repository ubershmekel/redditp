const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const chromeStoreUrl =
  "https://chromewebstore.google.com/detail/egmammmcmhobmigmfdhmonnffhblpgnk";
const firefoxStoreUrl =
  "https://addons.mozilla.org/en-US/firefox/addon/presentation-mode-for-reddit/";
const firefoxUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
const fallbackPage = path.resolve(__dirname, "../../index.html");
const readmes = [
  path.resolve(__dirname, "../../README.md"),
  path.resolve(__dirname, "../../chrome-extension/README.md"),
];

async function gotoExtensionPage(page) {
  await page.route("https://redditp.com/extension", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: fs.readFileSync(fallbackPage, "utf8"),
    }),
  );
  for (const storeUrl of [chromeStoreUrl, firefoxStoreUrl]) {
    await page.route(storeUrl, (route) =>
      route.fulfill({ contentType: "text/html", body: "store" }),
    );
  }

  await page.goto("https://redditp.com/extension");
}

test("the Sitey index fallback redirects /extension to the Chrome Web Store", async ({
  page,
}) => {
  await gotoExtensionPage(page);

  await expect(page).toHaveURL(chromeStoreUrl);
});

test("Firefox browsers are redirected to the add-on listing instead", async ({
  browser,
}) => {
  const context = await browser.newContext({ userAgent: firefoxUserAgent });
  const page = await context.newPage();
  await gotoExtensionPage(page);

  await expect(page).toHaveURL(firefoxStoreUrl);
  await context.close();
});

test("both READMEs link to the friendly extension URL", () => {
  for (const readme of readmes) {
    expect(fs.readFileSync(readme, "utf8")).toContain(
      "https://redditp.com/extension",
    );
  }
});
