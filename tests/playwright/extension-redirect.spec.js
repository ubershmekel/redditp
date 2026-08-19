const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const storeUrl =
  "https://chromewebstore.google.com/detail/egmammmcmhobmigmfdhmonnffhblpgnk";
const fallbackPage = path.resolve(__dirname, "../../index.html");
const readmes = [
  path.resolve(__dirname, "../../README.md"),
  path.resolve(__dirname, "../../chrome-extension/README.md"),
];

test("the Sitey index fallback redirects /extension to the Chrome Web Store", async ({
  page,
}) => {
  await page.route("https://redditp.com/extension", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: fs.readFileSync(fallbackPage, "utf8"),
    }),
  );
  await page.route(storeUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: "Chrome Web Store" }),
  );

  await page.goto("https://redditp.com/extension");

  await expect(page).toHaveURL(storeUrl);
});

test("both READMEs link to the friendly extension URL", () => {
  for (const readme of readmes) {
    expect(fs.readFileSync(readme, "utf8")).toContain(
      "https://redditp.com/extension",
    );
  }
});
