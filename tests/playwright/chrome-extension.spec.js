const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");

const extensionScript = path.resolve(
  __dirname,
  "../../chrome-extension/content.js",
);
const extensionStyles = path.resolve(
  __dirname,
  "../../chrome-extension/presentation.css",
);
const autoActivateScript = path.resolve(
  __dirname,
  "../../chrome-extension/auto-activate.js",
);
const linkPreviewFeedFixture = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../test-data/chrome-extension-link-preview-feed.html",
  ),
  "utf8",
);
const linkPreviewPostFixture = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../test-data/chrome-extension-link-preview-post.html",
  ),
  "utf8",
);
const staleVideoOverlayFixture = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../test-data/chrome-extension-stale-video-overlay.html",
  ),
  "utf8",
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

test("old Reddit reuses its live adaptive video instead of the seek preview", async ({
  page,
}) => {
  await page.setContent(`
    <base href="https://old.reddit.com/">
    <div class="thing link" data-url="https://v.redd.it/adaptive" data-author="runner" data-subreddit="MadeMeSmile" data-permalink="/r/MadeMeSmile/comments/adaptive/post/">
      <a class="title">Adaptive video</a>
      <div id="native-player"><video id="adaptive-video" class="portrait" muted></video></div>
      <video id="seek-preview" class="portrait" muted src="https://v.redd.it/adaptive/CMAF_96.mp4"></video>
    </div>
  `);
  await page.locator("#adaptive-video").evaluate((video) => {
    video.src = URL.createObjectURL(
      new Blob(["not real media"], { type: "video/mp4" }),
    );
  });
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });

  await expect(page.locator(".redditp__media #adaptive-video")).toBeVisible();
  await expect(page.locator(".redditp__count")).toHaveText(
    "1 / 1 · loading more",
  );
  await expect(page.locator("#adaptive-video")).toHaveJSProperty(
    "controls",
    true,
  );
  await expect(page.locator(".redditp__media #seek-preview")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator("#native-player > #adaptive-video")).toHaveCount(1);
  await expect(page.locator("#adaptive-video")).toHaveClass("portrait");
  await expect(page.locator("#adaptive-video")).toHaveJSProperty(
    "controls",
    false,
  );
});

test("current Reddit reuses adaptive video inside an open player shadow root", async ({
  page,
}) => {
  const detailUrl =
    "https://www.reddit.com/r/test/comments/shadowvideo/post/?redditp=1";
  await page.route(detailUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
        <shreddit-post id="t3_shadowvideo" post-title="Shadow video" post-type="video" content-href="https://v.redd.it/shadowvideo" permalink="/r/test/comments/shadowvideo/post/">
          <shreddit-player src="https://v.redd.it/shadowvideo/HLSPlaylist.m3u8" preview="https://v.redd.it/shadowvideo/CMAF_96.mp4"></shreddit-player>
        </shreddit-post>
        <div style="height: 4000px"></div>
      `,
    }),
  );
  await page.goto(detailUrl);
  await page.locator("shreddit-player").evaluate((player) => {
    window.__redditpScrollCalls = 0;
    const originalScrollTo = window.scrollTo.bind(window);
    window.scrollTo = (...args) => {
      window.__redditpScrollCalls += 1;
      originalScrollTo(...args);
    };
    window.__redditTargetClicks = 0;
    window.__redditVideoPaused = true;
    const shadow = player.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.id = "shadow-adaptive-video";
    video.muted = true;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => window.__redditVideoPaused,
    });
    video.play = () => {
      window.__redditVideoPaused = false;
      return Promise.resolve();
    };
    video.pause = () => {
      window.__redditVideoPaused = true;
    };
    video.addEventListener("click", () => {
      window.__redditTargetClicks += 1;
      if (!video.getAttribute("src")) {
        video.src = URL.createObjectURL(
          new Blob(["not real media"], { type: "video/mp4" }),
        );
      }
    });
    shadow.append(video);
  });
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });

  await expect(
    page.locator(".redditp__media #shadow-adaptive-video"),
  ).toBeVisible();
  await expect(page.locator(".redditp__count")).toContainText("1 / 1");
  await expect(
    page.locator(".redditp__media video[src*='CMAF_96']"),
  ).toHaveCount(0);
  await page
    .locator("#shadow-adaptive-video")
    .click({ position: { x: 300, y: 300 } });
  await expect
    .poll(() => page.evaluate(() => window.__redditVideoPaused))
    .toBe(true);
  expect(await page.evaluate(() => window.__redditTargetClicks)).toBe(1);
  await page
    .locator("#shadow-adaptive-video")
    .click({ position: { x: 300, y: 300 } });
  await expect
    .poll(() => page.evaluate(() => window.__redditVideoPaused))
    .toBe(false);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__redditpScrollCalls)).toBe(0);

  await page.keyboard.press("Escape");
  const restored = await page.locator("shreddit-player").evaluate((player) => {
    const video = player.shadowRoot.querySelector("#shadow-adaptive-video");
    return Boolean(video && video.parentNode === player.shadowRoot);
  });
  expect(restored).toBe(true);
});

test("a dormant adaptive player upgrades when its feed slide is reached", async ({
  page,
}) => {
  await page.setContent(`
    <base href="https://www.reddit.com/">
    <shreddit-post id="t3_image" post-title="First image" content-href="https://i.redd.it/first.jpg" permalink="/r/test/comments/image/first/"></shreddit-post>
    <shreddit-post id="t3_feedvideo" post-title="Feed video" post-type="video" content-href="https://v.redd.it/feedvideo" permalink="/r/test/comments/feedvideo/post/">
      <shreddit-player src="https://v.redd.it/feedvideo/HLSPlaylist.m3u8" preview="https://v.redd.it/feedvideo/CMAF_96.mp4" poster="https://external-preview.redd.it/feedvideo.png"></shreddit-player>
    </shreddit-post>
  `);
  await page.locator("shreddit-player").evaluate((player) => {
    window.__feedPlayerStarts = 0;
    const shadow = player.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.id = "feed-adaptive-video";
    video.addEventListener("click", () => {
      window.__feedPlayerStarts += 1;
      if (!video.getAttribute("src")) {
        video.src = URL.createObjectURL(
          new Blob(["not real media"], { type: "video/mp4" }),
        );
      }
    });
    shadow.append(video);
  });
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });

  await expect(page.locator(".redditp__title")).toHaveText("First image");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__title")).toHaveText("Feed video");
  await expect
    .poll(() => page.evaluate(() => window.__feedPlayerStarts))
    .toBe(1);
  await expect
    .poll(() =>
      page.locator("shreddit-player").evaluate((player) => {
        const video =
          document.querySelector("#feed-adaptive-video") ||
          player.shadowRoot.querySelector("#feed-adaptive-video");
        return {
          src: video?.getAttribute("src") || "",
          parent:
            video?.parentElement?.className || video?.parentNode?.nodeName,
        };
      }),
    )
    .toMatchObject({ src: /^blob:/, parent: "redditp__media" });
  await expect(
    page.locator(".redditp__media #feed-adaptive-video"),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__feedPlayerStarts)).toBe(1);
  await expect(
    page.locator(".redditp__media video[src*='CMAF_96']"),
  ).toHaveCount(0);
});

test("redditp=1 asks the extension to activate on Reddit URLs", async ({
  page,
}) => {
  const url =
    "https://old.reddit.com/r/MadeMeSmile/comments/adaptive/post/?redditp=1";
  await page.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body: "<main>Reddit</main>" }),
  );
  await page.goto(url);
  await page.evaluate(() => {
    window.__redditpMessage = null;
    window.chrome = {
      runtime: {
        sendMessage(message) {
          window.__redditpMessage = message;
          return Promise.resolve();
        },
      },
    };
  });
  await page.addScriptTag({ path: autoActivateScript });

  await expect
    .poll(() => page.evaluate(() => window.__redditpMessage))
    .toEqual({ type: "activate-from-url" });
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
  await expect(page.locator(".redditp__meta-link").nth(0)).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/nature/?redditp=1",
  );
  await expect(page.locator(".redditp__meta-link").nth(1)).toHaveAttribute(
    "href",
    "https://www.reddit.com/user/photographer/?redditp=1",
  );
  await expect(page.locator(".redditp__controls")).toBeVisible();
  await expect(page.locator(".redditp__close")).toBeInViewport();
  await expect(page.locator(".redditp__controls")).toBeInViewport();
});

test("metadata links leave the current overlay for another presentation", async ({
  page,
}) => {
  const destination = "https://www.reddit.com/r/nature/?redditp=1";
  await page.route(destination, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<main>Nature feed</main>",
    }),
  );
  await startPresentation(
    page,
    `<shreddit-post post-title="Nature" author="photographer" subreddit-prefixed-name="r/nature" content-href="https://i.redd.it/nature.jpg" permalink="/r/nature/comments/nature/post/"></shreddit-post>`,
  );

  await page.getByRole("link", { name: "r/nature" }).click();

  await expect(page).toHaveURL(destination);
  await expect(page.locator("#redditp-presentation")).toHaveCount(0);
});

test("long post titles wrap inside the title panel", async ({ page }) => {
  const longTitle =
    "AI is built to be easy, agreeable, and always available. Nietzsche’s philosophy offers a warning: if we don’t deliberately create distance from it, we risk losing power over our own thinking | Skye Cleary";
  await page.setViewportSize({ width: 390, height: 844 });
  await startPresentation(
    page,
    `<shreddit-post post-title="${longTitle}" author="Skye_Cleary" subreddit-prefixed-name="r/philosophy" content-href="https://i.redd.it/philosophy.jpg" permalink="/r/philosophy/comments/1vndrq3/post/"></shreddit-post>`,
  );

  await expect(page.locator(".redditp__title")).toHaveText(longTitle);
  const titleLayout = await page
    .locator(".redditp__title")
    .evaluate((title) => {
      const bounds = title.getBoundingClientRect();
      return {
        height: bounds.height,
        lineHeight: parseFloat(getComputedStyle(title).lineHeight),
        whiteSpace: getComputedStyle(title).whiteSpace,
        fitsWidth: title.scrollWidth <= title.clientWidth,
      };
    });
  expect(titleLayout.height).toBeGreaterThan(titleLayout.lineHeight * 2);
  expect(titleLayout.whiteSpace).toBe("normal");
  expect(titleLayout.fitsWidth).toBe(true);
  await expect(page.locator(".redditp__controls")).toBeInViewport();
});

test("current Reddit ignores repeated non-post article cards", async ({
  page,
}) => {
  await startPresentation(
    page,
    `
      <article class="sidebar-card"><h3>He tagged him!!!</h3></article>
      <article class="w-full">
        <shreddit-post
          id="t3_realpost"
          post-title="A real UFC post"
          author="fighter"
          subreddit-prefixed-name="r/ufc"
          content-href="https://i.redd.it/ufc.jpg"
          permalink="/r/ufc/comments/realpost/a_real_ufc_post/"
        >
          <img src="https://i.redd.it/ufc.jpg" width="800" height="600" alt="Fight">
        </shreddit-post>
      </article>
      <article class="sidebar-card"><h3>He tagged him!!!</h3></article>
      <article></article>
    `,
  );

  await expect(page.locator(".redditp__title")).toHaveText("A real UFC post");
  await expect(page.locator(".redditp__count")).toContainText("1 / 1");
});

test("a linked watch page becomes that host's player frame", async ({
  page,
}) => {
  await startPresentation(
    page,
    `
      <shreddit-post
        id="t3_framed"
        post-title="Linked clip"
        author="poster"
        subreddit-prefixed-name="r/clips"
        content-href="https://videohost.example/watch/some-clip-id"
        permalink="/r/clips/comments/framed/linked_clip/"
      ></shreddit-post>
    `,
  );

  await expect(page.locator(".redditp__embed")).toHaveAttribute(
    "src",
    "https://videohost.example/ifr/some-clip-id",
  );
});

test("YouTube embeds preserve the requested start time and send a referrer", async ({
  page,
}) => {
  await startPresentation(
    page,
    `
      <shreddit-post
        id="t3_youtube"
        post-title="YouTube interview"
        author="poster"
        subreddit-prefixed-name="r/ukraine"
        content-href="https://www.youtube.com/watch?v=l74r1s8y7uY&amp;t=1167s"
        permalink="/r/ukraine/comments/youtube/interview/"
      ></shreddit-post>
    `,
  );

  await expect(page.locator(".redditp__embed")).toHaveAttribute(
    "src",
    "https://www.youtube.com/embed/l74r1s8y7uY?start=1167",
  );
  await expect(page.locator(".redditp__embed")).toHaveAttribute(
    "referrerpolicy",
    "strict-origin-when-cross-origin",
  );
  await expect(page.locator(".redditp__embed")).toHaveAttribute(
    "allow",
    /(?:^|; )fullscreen(?:;|$)/,
  );
  await expect(page.locator(".redditp__embed")).not.toHaveAttribute(
    "allowfullscreen",
    "",
  );
});

test("extension recognizes Reddit search media cards and packaged video", async ({
  page,
}) => {
  const videoUrl =
    "https://packaged-media.redd.it/br6s0bbf3gqe1/pb/m2-res_392p.mp4?m=DASHPlaylist.mpd";
  const hlsUrl = "https://v.redd.it/br6s0bbf3gqe1/HLSPlaylist.m3u8";
  const packagedMedia = JSON.stringify({
    playbackMp4s: {
      permutations: [
        {
          source: {
            url: videoUrl,
            dimensions: { width: 392, height: 490 },
            videoCodec: "H264",
          },
        },
      ],
    },
  });
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
            <shreddit-player src="${hlsUrl}" packaged-media-json='${packagedMedia}' poster="https://external-preview.redd.it/nature.png">
              <source src="${hlsUrl}">
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
  await expect(page.locator(".redditp__count")).toHaveText(
    "1 / 1 · loading more",
  );
  await expect(page.locator(".redditp__title")).toHaveText(
    "Video search result",
  );
});

test("the final slide automatically loads newly rendered Reddit posts", async ({
  page,
}) => {
  await startPresentation(
    page,
    `
      <shreddit-post id="t3_first" post-title="First loaded post" content-href="https://i.redd.it/first-loaded.jpg" permalink="/r/test/comments/first/first_loaded_post/"></shreddit-post>
      <div style="height: 4000px"></div>
    `,
  );
  await expect(page.locator(".redditp__count")).toHaveText(
    "1 / 1 · loading more",
  );
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <shreddit-post id="t3_second" post-title="Newly loaded post" content-href="https://i.redd.it/newly-loaded.jpg" permalink="/r/test/comments/second/newly_loaded_post/"></shreddit-post>
        <shreddit-post id="t3_third" post-title="Another loaded post" content-href="https://i.redd.it/another-loaded.jpg" permalink="/r/test/comments/third/another_loaded_post/"></shreddit-post>
      `,
    );
  });

  await expect(page.locator(".redditp__title")).toHaveText("First loaded post");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 3");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__title")).toHaveText("Newly loaded post");
  await expect(page.locator(".redditp__count")).toHaveText("2 / 3");
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

test("small link-preview images are not stretched beyond their natural size", async ({
  page,
}) => {
  const previewUrl = "https://external-preview.redd.it/link-preview.png";
  await page.route(previewUrl, async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="868" height="488"></svg>',
    });
  });
  await startPresentation(
    page,
    `<shreddit-post post-title="Linked article" content-href="https://example.com/article" permalink="/r/news/comments/preview/article/"><img src="${previewUrl}" width="640" height="360" alt="Linked article"></shreddit-post>`,
  );

  const size = await page.locator(".redditp__image").evaluate((image) => {
    const bounds = image.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    };
  });
  expect(size).toEqual({
    width: 868,
    height: 488,
    naturalWidth: 868,
    naturalHeight: 488,
  });
});

test("a large current Reddit link preview expands to the full stage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const previewBase = "https://external-preview.redd.it/sandu-preview.jpeg";
  await page.route(`${previewBase}*`, async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="680"></svg>',
    });
  });
  await startPresentation(
    page,
    `<shreddit-post post-title="Linked article" content-href="https://example.com/article" permalink="/r/ukraine/comments/1vrzyuh/post/">
      <img role="presentation" src="${previewBase}?width=640" srcset="${previewBase}?width=640 640w, ${previewBase}?width=1080 1080w" width="640" height="403">
      <img data-post-media-primary src="${previewBase}?width=640" srcset="${previewBase}?width=640 640w, ${previewBase}?width=1080 1080w" width="640" height="403" alt="Linked article">
    </shreddit-post>`,
  );

  const dimensions = await page.locator(".redditp__image").evaluate((image) => {
    const bounds = image.getBoundingClientRect();
    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      displayWidth: Math.round(bounds.width),
      displayHeight: Math.round(bounds.height),
    };
  });
  expect(dimensions).toEqual({
    naturalWidth: 1080,
    naturalHeight: 680,
    displayWidth: 1920,
    displayHeight: 1080,
  });
});

test("a subreddit link thumbnail upgrades to the direct post's large preview", async ({
  page,
}) => {
  const feedUrl = "https://www.reddit.com/r/ukraine/?redditp=1";
  const postUrl =
    "https://www.reddit.com/r/ukraine/comments/1vrzyuh/we_cannot_turn_our_backs_on_ukraine_sandu_on/";
  let detailRequests = 0;
  await page.route(postUrl, async (route) => {
    detailRequests += 1;
    await route.fulfill({
      contentType: "text/html",
      body: linkPreviewPostFixture,
    });
  });
  await page.route(feedUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: linkPreviewFeedFixture }),
  );
  await page.route(
    /https:\/\/external-preview\.redd\.it\/sandu-grain-transit\.png.*/,
    async (route) => {
      const isThumbnail = new URL(route.request().url()).searchParams.has(
        "width",
      );
      const width = isThumbnail ? 320 : 1200;
      const height = isThumbnail ? 180 : 675;
      await route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`,
      });
    },
  );

  await page.goto(feedUrl);
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });

  await expect(page.locator(".redditp__count")).toHaveText("1 / 1");
  await expect(page.getByRole("link", { name: "comments" })).toHaveAttribute(
    "href",
    postUrl,
  );
  await expect.poll(() => detailRequests).toBe(1);
  await expect(page.locator(".redditp__image")).toHaveAttribute(
    "src",
    "https://external-preview.redd.it/sandu-grain-transit.png?auto=webp",
  );
  const dimensions = await page.locator(".redditp__image").evaluate((image) => {
    const bounds = image.getBoundingClientRect();
    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
    };
  });
  expect(detailRequests).toBe(1);
  expect(dimensions).toEqual({
    naturalWidth: 1200,
    naturalHeight: 675,
    displayWidth: 1280,
    displayHeight: 720,
  });
});

test("settings persist timing and visibility while compact controls stay reachable", async ({
  page,
}) => {
  await page.route("https://www.reddit.com/settings-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<shreddit-post post-title="Settings post" content-href="https://i.redd.it/settings.jpg" permalink="/r/pics/comments/settings/post/"></shreddit-post><shreddit-post post-title="Second settings post" content-href="https://i.redd.it/settings-2.jpg" permalink="/r/pics/comments/settings2/post/"></shreddit-post>`,
    }),
  );
  await page.goto("https://www.reddit.com/settings-test");
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });

  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  await page.getByLabel("Seconds per slide").press("ArrowRight");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 2");
  await page.getByLabel("Seconds per slide").fill("1");
  await page.getByLabel("Seconds per slide").press("Enter");
  await page.getByLabel("Show the title panel").uncheck();
  await page.getByLabel("Show previous and next arrows").uncheck();
  await page
    .getByLabel("Show the close button (press Esc instead when hidden)")
    .uncheck();
  await expect(page.getByLabel("Show media and comments links")).toHaveCount(0);
  await expect(
    page.getByLabel("Show auto-play and sound controls"),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Video slides also move on when the video ends. Settings are saved in this browser.",
    ),
  ).toHaveCount(0);
  const settingsColors = await page
    .locator(".redditp__settings")
    .evaluate((panel) => ({
      panel: getComputedStyle(panel).backgroundColor,
      row: getComputedStyle(panel.querySelector(".redditp__setting"))
        .backgroundColor,
      text: getComputedStyle(panel.querySelector(".redditp__setting")).color,
    }));
  expect(settingsColors).toEqual({
    panel: "rgb(23, 23, 23)",
    row: "rgb(43, 43, 43)",
    text: "rgb(255, 255, 255)",
  });
  await page.getByLabel("Keep the bottom panel compact").check();

  await expect(page.locator(".redditp__details")).toBeHidden();
  await expect(page.locator(".redditp__prev")).toBeHidden();
  await expect(page.locator(".redditp__close")).toBeHidden();
  await expect(page.locator(".redditp__controls")).toHaveClass(
    /redditp__controls--collapsed/,
  );
  await expect(
    page.getByRole("button", { name: "Open presentation settings" }),
  ).toBeHidden();

  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__redditpPresentation.toggle());
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("redditpPresentationSettings")),
  );
  expect(saved.slideDurationSeconds).toBe(1);
  expect(saved.controlsCollapsed).toBe(true);
  expect(saved.showClose).toBe(false);

  await expect(page.locator(".redditp__controls")).toHaveClass(
    /redditp__controls--collapsed/,
  );
  await page.getByRole("button", { name: "Expand bottom controls" }).click();
  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  await expect(page.getByLabel("Seconds per slide")).toHaveValue("1");
  await expect(page.getByLabel("Show the title panel")).not.toBeChecked();

  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await page.getByRole("button", { name: "auto" }).click();
  await expect(page.locator(".redditp__title")).toHaveText(
    "Second settings post",
    { timeout: 2500 },
  );
});

test("one close click cancels a direct post that is still preparing video", async ({
  page,
}) => {
  const postUrl =
    "https://www.reddit.com/r/test/comments/slowclose/preparing_video/?redditp=1";
  await page.route(postUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<shreddit-post id="t3_slowclose" post-title="Preparing video" content-href="https://v.redd.it/slowclose" permalink="/r/test/comments/slowclose/preparing_video/"><shreddit-player preview="https://v.redd.it/slowclose/CMAF_96.mp4"><video></video></shreddit-player></shreddit-post>`,
    }),
  );
  await page.goto(postUrl);
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
  await expect(page.locator("#redditp-presentation")).toBeVisible();

  await page.getByRole("button", { name: "Close presentation mode" }).click();

  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await page.waitForTimeout(4500);
  await expect(page.locator("#redditp-presentation")).toBeHidden();
});

test("a new extension instance retires a stale overlay and recovers its live video", async ({
  page,
}) => {
  await startPresentation(page, staleVideoOverlayFixture);

  await expect(page.locator("#redditp-presentation")).toHaveCount(1);
  await expect(page.locator(".redditp__title")).toHaveText(
    "Streamer gets knocked out after threatening to slap Tiki Ghosn",
  );
  await expect(page.locator(".redditp__video")).toHaveAttribute(
    "src",
    "blob:https://www.reddit.com/sanitized-live-video",
  );
  await expect(page.locator(".redditp__link-card")).toHaveCount(0);

  await page.getByRole("button", { name: "Close presentation mode" }).click();
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await expect(page.locator("shreddit-player > #stale-live-video")).toHaveCount(
    1,
  );
});

test("redditp brand opens the extension README on GitHub", async ({ page }) => {
  await startPresentation(
    page,
    `<shreddit-post post-title="Brand link" content-href="https://i.redd.it/brand.jpg" permalink="/r/pics/comments/brand/post/"></shreddit-post>`,
  );

  await expect(page.getByRole("link", { name: "redditp" })).toHaveAttribute(
    "href",
    "https://github.com/ubershmekel/redditp/blob/main/chrome-extension/README.md",
  );
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

test("a thumbnail-only search result upgrades again after reopening", async ({
  page,
}) => {
  const postUrl = "https://www.reddit.com/r/test/comments/reopen/clip/";
  const thumbnailUrl = "https://external-preview.redd.it/reopen-thumb.png";
  const previewUrl = "https://v.redd.it/reopen123/DASH_480.mp4";
  await page.route(thumbnailUrl, async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"></svg>',
    });
  });
  await page.route(postUrl, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<shreddit-post id="t3_reopen" post-title="Reopened clip" post-type="video" content-href="https://v.redd.it/reopen123" permalink="/r/test/comments/reopen/clip/"><shreddit-player src="https://v.redd.it/reopen123/HLSPlaylist.m3u8" preview="${previewUrl}" poster="${thumbnailUrl}"></shreddit-player></shreddit-post>`,
    });
  });
  await page.route(previewUrl, async (route) => {
    await route.abort();
  });
  await startPresentation(
    page,
    `<search-telemetry-tracker data-faceplate-tracking-context='{"post":{"id":"t3_reopen","title":"Reopened clip"},"subreddit":{"name":"test"}}'><div data-testid="search-post-unit"><h2><a href="${postUrl}">Reopened clip</a></h2><a href="${postUrl}" aria-label="Reopened clip thumbnail image"><faceplate-img data-testid="search_post_thumbnail" src="${thumbnailUrl}" alt="Reopened clip"></faceplate-img></a></div></search-telemetry-tracker>`,
  );
  await expect(page.locator(".redditp__video")).toHaveAttribute(
    "src",
    previewUrl,
  );

  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(page.locator("#redditp-presentation")).toBeVisible();

  await expect(page.locator(".redditp__video")).toHaveAttribute(
    "src",
    previewUrl,
  );
});

test("browser shortcuts such as Ctrl+F are not swallowed", async ({ page }) => {
  await startPresentation(
    page,
    `<div class="thing link" data-url="https://i.redd.it/one.jpg" data-permalink="/r/pics/comments/one/a/"><a class="title" href="https://i.redd.it/one.jpg">Only post</a></div>`,
  );
  await expect(page.locator("#redditp-presentation")).toBeVisible();

  const prevented = await page.evaluate(() =>
    ["f", "m"].map((key) => {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(prevented).toEqual([false, false]);

  // The unmodified key still works.
  await page.keyboard.press("m");
  await expect(
    page.locator(".redditp__button", { hasText: "sound on" }),
  ).toBeVisible();
});

test("auto-advance keeps moving when a video slide fails to load", async ({
  page,
}) => {
  await page.route("https://v.redd.it/broken/DASH_480.mp4", async (route) => {
    await route.abort();
  });
  await page.route("https://i.redd.it/second.jpg", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"></svg>',
    });
  });
  await startPresentation(
    page,
    `<div class="thing link" data-url="https://v.redd.it/broken/DASH_480.mp4" data-permalink="/r/v/comments/one/a/"><a class="title" href="https://v.redd.it/broken/DASH_480.mp4">Broken video</a></div>
     <div class="thing link" data-url="https://i.redd.it/second.jpg" data-permalink="/r/pics/comments/two/b/"><a class="title" href="https://i.redd.it/second.jpg">Second post</a></div>`,
  );
  await expect(page.locator(".redditp__title")).toHaveText("Broken video");
  await expect(page.locator(".redditp__link-icon")).toHaveText(
    "Image unavailable",
  );

  await page.locator(".redditp__button", { hasText: "auto" }).click();
  await expect(page.locator(".redditp__title")).toHaveText("Second post", {
    timeout: 9000,
  });
});

test("Tab cycles focus inside the presentation instead of the page behind it", async ({
  page,
}) => {
  await startPresentation(
    page,
    `<div class="thing link" data-url="https://i.redd.it/one.jpg" data-permalink="/r/pics/comments/one/a/"><a class="title" href="https://i.redd.it/one.jpg">Only post</a></div>
     <a id="behind" href="https://www.reddit.com/r/all/">A link on the Reddit page</a>`,
  );
  await expect(page.locator("#redditp-presentation")).toBeVisible();

  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press("Tab");
    const insideDialog = await page.evaluate(() =>
      Boolean(document.activeElement?.closest("#redditp-presentation")),
    );
    expect(insideDialog).toBe(true);
  }
});
