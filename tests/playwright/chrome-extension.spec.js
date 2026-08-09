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

test("old Reddit combined-search cards upgrade their outbound media", async ({
  page,
}) => {
  const postUrl =
    "https://old.reddit.com/r/LoveTrash/comments/oldvideo/nature/";
  const videoUrl = "https://v.redd.it/oldvideo/DASH_96.mp4";
  await page.route(postUrl, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<div class="thing link" data-fullname="t3_oldvideo" data-url="https://v.redd.it/oldvideo" data-permalink="/r/LoveTrash/comments/oldvideo/nature/" data-author="poster" data-subreddit="LoveTrash"><a class="title">Nature...</a><video src="${videoUrl}"></video></div>`,
    });
  });
  await page.route(videoUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.abort();
  });
  await startPresentation(
    page,
    `<div class="search-result search-result-link has-thumbnail" data-fullname="t3_oldvideo"><a class="thumbnail" href="${postUrl}"></a><a class="search-title" href="${postUrl}">Nature...</a><a class="search-comments" href="${postUrl}">193 comments</a><a class="author" href="https://old.reddit.com/user/poster">poster</a><a class="search-subreddit-link" href="https://old.reddit.com/r/LoveTrash/">r/LoveTrash</a><a class="search-link" href="https://v.redd.it/oldvideo">https://v.redd.it/oldvideo</a></div>`,
  );

  await expect(page.locator(".redditp__title")).toHaveText("Nature...");
  await expect(page.locator(".redditp__meta")).toContainText("r/LoveTrash");
  await expect(page.locator(".redditp__video")).toHaveAttribute(
    "src",
    videoUrl,
  );
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

test("extension recognizes Reddit search media cards and packaged video", async ({
  page,
}) => {
  const videoUrl =
    "https://packaged-media.redd.it/br6s0bbf3gqe1/pb/m2-res_392p.mp4?m=DASHPlaylist.mpd";
  await page.route(videoUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.abort();
  });
  await page.route(
    "https://external-preview.redd.it/ordinary.png",
    async (route) => {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"></svg>',
      });
    },
  );
  await startPresentation(
    page,
    `
      <search-telemetry-tracker data-faceplate-tracking-context='{"post":{"title":"Nature..."},"subreddit":{"name":"LoveTrash"}}'>
        <div data-id="search-media-post-unit">
          <a href="/r/LoveTrash/comments/1jhztnq/nature/">
            <shreddit-player src="${videoUrl}" poster="https://external-preview.redd.it/nature.png">
              <source src="${videoUrl}">
              <img class="preview-image" alt="media poster" src="https://external-preview.redd.it/nature.png">
            </shreddit-player>
          </a>
        </div>
      </search-telemetry-tracker>
      <search-telemetry-tracker data-faceplate-tracking-context='{"post":{"id":"t3_next","title":"Ordinary search post"},"subreddit":{"name":"test"}}'>
        <div data-testid="search-post-unit">
          <h2><a data-testid="post-title" href="/r/test/comments/next/ordinary/">Ordinary search post</a></h2>
          <img src="https://styles.redditmedia.com/community-icon.png" width="24" height="24" alt="community icon">
          <a href="/r/test/comments/next/ordinary/" aria-label="Ordinary search post thumbnail image">
            <faceplate-img data-testid="search_post_thumbnail" src="https://external-preview.redd.it/ordinary.png" alt="Ordinary search post"></faceplate-img>
          </a>
        </div>
      </search-telemetry-tracker>
    `,
  );

  await expect(page.locator(".redditp__title")).toHaveText("Nature...");
  await expect(page.locator(".redditp__meta")).toContainText("r/LoveTrash");
  expect(await page.locator(".redditp__video").getAttribute("src")).toBe(
    videoUrl,
  );
  await expect(page.locator(".redditp__count")).toHaveText("1 / 2");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__title")).toHaveText(
    "Ordinary search post",
  );
  await expect(page.locator(".redditp__image")).toHaveAttribute(
    "src",
    "https://external-preview.redd.it/ordinary.png",
  );
});

test("thumbnail-only search results upgrade from post HTML to their actual video", async ({
  page,
}) => {
  const postUrl =
    "https://www.reddit.com/r/test/comments/upgrade/video_search_result/";
  const thumbnailUrl = "https://external-preview.redd.it/video-thumb.png";
  const previewUrl = "https://v.redd.it/video123/DASH_480.mp4";
  await page.route(thumbnailUrl, async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"></svg>',
    });
  });
  await page.route(postUrl, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<shreddit-post id="t3_upgrade" post-title="Video search result" post-type="video" content-href="https://v.redd.it/video123" permalink="/r/test/comments/upgrade/video_search_result/"><shreddit-player src="https://v.redd.it/video123/HLSPlaylist.m3u8" preview="${previewUrl}" poster="${thumbnailUrl}"><source src="https://v.redd.it/video123/HLSPlaylist.m3u8"></shreddit-player></shreddit-post>`,
    });
  });
  await page.route(previewUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.abort();
  });
  await startPresentation(
    page,
    `<search-telemetry-tracker data-faceplate-tracking-context='{"post":{"id":"t3_upgrade","title":"Video search result"},"subreddit":{"name":"test"}}'><div data-testid="search-post-unit"><h2><a href="${postUrl}">Video search result</a></h2><a href="${postUrl}" aria-label="Video search result thumbnail image"><faceplate-img data-testid="search_post_thumbnail" src="${thumbnailUrl}" alt="Video search result"></faceplate-img></a></div></search-telemetry-tracker>`,
  );

  await expect(page.locator(".redditp__video")).toHaveAttribute(
    "src",
    previewUrl,
  );
  await expect(page.locator(".redditp__title")).toHaveText(
    "Video search result",
  );
});

test("extension expands lazy Reddit galleries in order without decorative duplicates", async ({
  page,
}) => {
  const imagePattern = /https:\/\/preview\.redd\.it\/gallery-[123]\.jpg.*/;
  await page.route(imagePattern, async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="green"/></svg>',
    });
  });
  await startPresentation(
    page,
    `
      <shreddit-post post-title="Gallery post" author="artist" subreddit-prefixed-name="r/pics" gallery post-type="gallery" content-href="https://www.reddit.com/gallery/gallery1" permalink="/r/pics/comments/gallery1/gallery_post/">
        <gallery-carousel>
          <figure>
            <img role="presentation" src="https://preview.redd.it/gallery-1.jpg?width=640">
            <img alt="Gallery post" srcset="https://preview.redd.it/gallery-1.jpg?width=320 320w, https://preview.redd.it/gallery-1.jpg?width=1080 1080w">
          </figure>
          <figure><img alt="Gallery post" data-lazy-srcset="https://preview.redd.it/gallery-2.jpg?width=320 320w, https://preview.redd.it/gallery-2.jpg?width=1080 1080w"></figure>
          <figure><img alt="Gallery post" data-lazy-src="https://preview.redd.it/gallery-3.jpg?width=1080"></figure>
        </gallery-carousel>
      </shreddit-post>
    `,
  );

  await expect(page.locator(".redditp__count")).toHaveText("1 / 3");
  await expect(page.locator(".redditp__meta")).toContainText("gallery 1/3");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__meta")).toContainText("gallery 2/3");
  await expect(page.locator(".redditp__image")).toHaveAttribute(
    "src",
    /gallery-2\.jpg\?width=1080/,
  );
});

test("portrait images are contained by the stage instead of clipped", async ({
  page,
}) => {
  await page.route("https://i.redd.it/portrait.jpg", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2268" height="4032"><rect width="100%" height="100%" fill="blue"/></svg>',
    });
  });
  await startPresentation(
    page,
    `<shreddit-post post-title="Portrait" content-href="https://i.redd.it/portrait.jpg" permalink="/r/pics/comments/portrait/post/"></shreddit-post>`,
  );

  const viewports = [
    { width: 360, height: 780 },
    { width: 390, height: 844 },
    { width: 393, height: 852 },
    { width: 412, height: 915 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const dimensions = await page.locator(".redditp__image").evaluate((img) => {
      const image = img.getBoundingClientRect();
      const media = img.parentElement.getBoundingClientRect();
      const controls = document
        .querySelector(".redditp__controls")
        .getBoundingClientRect();
      return {
        imageWidth: image.width,
        imageHeight: image.height,
        mediaWidth: media.width,
        mediaHeight: media.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        objectFit: getComputedStyle(img).objectFit,
        controlsRight: controls.right,
        controlsBottom: controls.bottom,
      };
    });
    expect(dimensions.naturalWidth).toBe(2268);
    expect(dimensions.naturalHeight).toBe(4032);
    expect(dimensions.imageWidth).toBeLessThanOrEqual(dimensions.mediaWidth);
    expect(dimensions.imageHeight).toBeLessThanOrEqual(dimensions.mediaHeight);
    expect(dimensions.controlsRight).toBeLessThanOrEqual(viewport.width);
    expect(dimensions.controlsBottom).toBeLessThanOrEqual(viewport.height);
    expect(dimensions.objectFit).toBe("contain");
  }
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
