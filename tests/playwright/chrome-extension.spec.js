const path = require("path");
const { test, expect } = require("@playwright/test");

const extensionScript = path.resolve(
  __dirname,
  "../../chrome-extension/content.js",
);
const extensionStyles = path.resolve(
  __dirname,
  "../../chrome-extension/presentation.css",
);

async function startPresentation(page, html) {
  await page.setContent(`<base href="https://www.reddit.com/">${html}`);
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
}

test("extension presents old Reddit image posts and supports keyboard navigation", async ({
  page,
}) => {
  await page.route("https://i.redd.it/first.jpg", async (route) => {
    await route.fulfill({
      contentType: "image/gif",
      body: Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
        "base64",
      ),
    });
  });
  await startPresentation(
    page,
    `
      <div class="thing link" data-url="https://i.redd.it/first.jpg" data-author="alice" data-subreddit="pics" data-permalink="/r/pics/comments/one/first/">
        <a class="title" href="https://i.redd.it/first.jpg">First old Reddit post</a>
        <a class="comments" href="/r/pics/comments/one/first/">comments</a>
      </div>
      <div class="thing link" data-url="https://example.com/story" data-author="bob" data-subreddit="news" data-permalink="/r/news/comments/two/story/">
        <a class="title" href="https://example.com/story">Second old Reddit post</a>
        <a class="comments" href="/r/news/comments/two/story/">comments</a>
      </div>
    `,
  );

  await expect(page.locator("#redditp-presentation")).toBeVisible();
  await expect(page.locator(".redditp__title")).toHaveText(
    "First old Reddit post",
  );
  await expect(page.locator(".redditp__count")).toHaveText("1 / 2");
  await expect(page.locator(".redditp__image")).toHaveAttribute(
    "src",
    "https://i.redd.it/first.jpg",
  );

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__title")).toHaveText(
    "Second old Reddit post",
  );
  await expect(page.locator(".redditp__link-card")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
});

test("extension extracts current Reddit post elements on a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startPresentation(
    page,
    `
      <shreddit-post
        post-title="A nature search result"
        author="photographer"
        subreddit-prefixed-name="r/nature"
        content-href="https://i.redd.it/nature.webp"
        permalink="/r/nature/comments/abc/a_nature_search_result/"
      >
        <img src="https://preview.redd.it/nature.webp" width="800" height="600" alt="A mountain">
      </shreddit-post>
    `,
  );

  await expect(page.locator(".redditp__title")).toHaveText(
    "A nature search result",
  );
  await expect(page.locator(".redditp__meta")).toHaveText(
    "r/nature · u/photographer",
  );
  await expect(page.locator(".redditp__controls")).toBeVisible();
  await expect(page.locator(".redditp__close")).toBeInViewport();
  await expect(page.locator(".redditp__controls")).toBeInViewport();
});

test("injecting the extension action again toggles presentation mode", async ({
  page,
}) => {
  await startPresentation(
    page,
    `<article><h2>Post in a user feed</h2><a href="/r/test/comments/xyz/post/">Comments</a></article>`,
  );
  await expect(page.locator("#redditp-presentation")).toBeVisible();

  await page.addScriptTag({ path: extensionScript });
  await expect(page.locator("#redditp-presentation")).toBeHidden();

  await page.addScriptTag({ path: extensionScript });
  await expect(page.locator("#redditp-presentation")).toBeVisible();
});
