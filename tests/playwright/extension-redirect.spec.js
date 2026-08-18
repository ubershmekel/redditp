const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("@playwright/test");

const storeUrl =
  "https://chromewebstore.google.com/detail/egmammmcmhobmigmfdhmonnffhblpgnk";
const redirectPage = path.resolve(__dirname, "../../extension.html");
const readmes = [
  path.resolve(__dirname, "../../README.md"),
  path.resolve(__dirname, "../../chrome-extension/README.md"),
];

test("extension.html redirects to the Chrome Web Store", async ({ page }) => {
  await page.route(storeUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: "Chrome Web Store" }),
  );

  await page.goto(pathToFileURL(redirectPage).href);

  await expect(page).toHaveURL(storeUrl);
});

test("extension.html has a no-script redirect fallback", () => {
  const html = fs.readFileSync(redirectPage, "utf8");

  expect(html).toContain(`http-equiv="refresh"`);
  expect(html).toContain(`content="0; url=${storeUrl}"`);
  expect(html).toContain(`href="${storeUrl}"`);
});

test("both READMEs link to the friendly extension URL", () => {
  for (const readme of readmes) {
    expect(fs.readFileSync(readme, "utf8")).toContain(
      "https://redditp.com/extension",
    );
  }
});
