const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");

const extensionScript = path.resolve(
  __dirname,
  "../../browser-extension/content.js",
);
const extensionStyles = path.resolve(
  __dirname,
  "../../browser-extension/presentation.css",
);
const autoActivateScript = path.resolve(
  __dirname,
  "../../browser-extension/auto-activate.js",
);
const launcherStyles = path.resolve(
  __dirname,
  "../../browser-extension/launcher.css",
);
const linkPreviewFeedFixture = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../test-data/browser-extension-link-preview-feed.html",
  ),
  "utf8",
);
const linkPreviewPostFixture = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../test-data/browser-extension-link-preview-post.html",
  ),
  "utf8",
);
const staleVideoOverlayFixture = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../test-data/browser-extension-stale-video-overlay.html",
  ),
  "utf8",
);
// A RedGIFs post as current Reddit's feed renders it: only Reddit's embed of
// the player, with no picture anywhere in the post.
const redgifsEmbedFixture = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../test-data/browser-extension-redgifs-embed-post.html",
  ),
  "utf8",
);
// An uploaded GIF's player and a video posted as a GIF, as current Reddit's
// feed renders them.
const gifPlayersFixture = fs.readFileSync(
  path.resolve(__dirname, "../../test-data/browser-extension-gif-players.html"),
  "utf8",
);

// A short clip for the video URLs a test lets play. The presentation starts
// every video muted.
const silentVideo = fs.readFileSync(
  path.resolve(__dirname, "../../test-data/browser-extension-sound.webm"),
);

function fulfillSilentVideo(route) {
  return route.fulfill({ contentType: "video/webm", body: silentVideo });
}

async function startPresentation(page, html) {
  await page.setContent(`<base href="https://www.reddit.com/">${html}`);
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
}

// The media hosts answer every URL a test does not route itself: video paths
// with the clip, everything else with a picture. Made-up URLs would otherwise
// reach the real hosts, which answer with a placeholder picture or an error.
// i.ytimg.com serves the stills of YouTube players' tiles.
const DEFAULT_MEDIA_RE =
  /^https:\/\/(?:i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|i\.imgur\.com|v\.redd\.it|i\.ytimg\.com)\//;

// Reddit's data for posts, which the grid asks for the stills of players
// whose cards have no picture. The specs never reach the real endpoint, which
// answers automated browsers with a challenge; a test that needs an answer
// routes it itself.
const POST_INFO_RE = /^https:\/\/www\.reddit\.com\/api\/info\.json(?:\?|$)/;

// Page routes, and context routes a test adds later, still win. A video's
// manifest on v.redd.it lists the renditions of a landscape clip.
test.beforeEach(async ({ context }) => {
  await context.route(DEFAULT_MEDIA_RE, (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "v.redd.it" && /\.mpd$/i.test(url.pathname)) {
      return route.fulfill(dashManifest(LANDSCAPE_RENDITIONS));
    }
    if (url.hostname === "v.redd.it" || /\.(?:mp4|webm)$/i.test(url.pathname)) {
      return fulfillSilentVideo(route);
    }
    return route.fulfill(svgImage(800, 600));
  });
  await context.route(POST_INFO_RE, (route) => route.abort());
});

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
  await expect(page.locator(".redditp__prev")).toBeDisabled();

  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".redditp__title")).toHaveText(
    "First old Reddit post",
  );
  await expect(page.locator(".redditp__count")).toHaveText("1 / 2");

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__title")).toHaveText(
    "Second old Reddit post",
  );
  await expect(page.locator(".redditp__prev")).toBeEnabled();
  await expect(page.locator(".redditp__link-card")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
});

test("shows the body of a Reddit text post", async ({ page }) => {
  await startPresentation(
    page,
    `
      <shreddit-post
        id="t3_textpost"
        post-title="What did I do wrong?"
        author="newbie"
        subreddit-prefixed-name="r/bjj"
        permalink="/r/bjj/comments/textpost/body/"
      >
        <shreddit-post-text-body slot="text-body">
          <div slot="text-body" class="text-neutral-content">
            <div class="md">
              <p>First paragraph of the post.</p>
              <p>Second paragraph with more context.</p>
            </div>
            <button>Read more</button>
          </div>
        </shreddit-post-text-body>
      </shreddit-post>
    `,
  );

  const postBody = page.locator(".redditp__post-body");
  await expect(postBody).toContainText("First paragraph of the post.");
  await expect(postBody).toContainText("Second paragraph with more context.");
  await expect(postBody).not.toContainText("Read more");
  await expect(page.locator(".redditp__link-icon")).toHaveText("Text post");
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
  await page.route(videoUrl, (route) => fulfillSilentVideo(route));
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

test("arrow keys still change slides after clicking native video controls", async ({
  page,
  browserName,
}) => {
  // Only Chromium stops delivering key events once its control buttons have
  // focus, and the control positions below match Chromium's layout.
  test.skip(browserName !== "chromium", "Chromium native video controls");
  const videoUrl = "https://v.redd.it/sound/DASH_480.mp4";
  await page.route(videoUrl, async (route) => {
    await route.fulfill({
      contentType: "video/webm",
      body: fs.readFileSync(
        path.resolve(__dirname, "../../test-data/browser-extension-sound.webm"),
      ),
    });
  });
  await startPresentation(
    page,
    `
      <div class="thing link" data-url="https://v.redd.it/sound" data-author="alice" data-subreddit="videos" data-permalink="/r/videos/comments/one/sound/">
        <a class="title">Video with sound</a>
        <video src="${videoUrl}"></video>
      </div>
      <div class="thing link" data-url="https://example.com/story" data-author="bob" data-subreddit="news" data-permalink="/r/news/comments/two/story/">
        <a class="title">Story after the video</a>
      </div>
    `,
  );

  const video = page.locator(".redditp__video");
  await expect(video).toHaveJSProperty("readyState", 4);
  await expect(video).toHaveJSProperty("muted", true);
  await video.hover();
  const bounds = await video.boundingBox();

  // The overflow menu closes when the video loses focus, so opening it must
  // not release focus.
  await page.mouse.click(
    bounds.x + bounds.width - 24,
    bounds.y + bounds.height - 48,
  );
  await page.waitForTimeout(300);
  await expect(video).toBeFocused();
  await page.keyboard.press("Escape");
  await video.hover();

  await page.mouse.click(
    bounds.x + bounds.width - 120,
    bounds.y + bounds.height - 48,
  );
  await expect(video).toHaveJSProperty("muted", false);
  await expect(video).not.toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__title")).toHaveText(
    "Story after the video",
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
  browserName,
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
    window.__redditPlaybackCalls = { play: 0, pause: 0 };
    const shadow = player.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.id = "shadow-adaptive-video";
    video.muted = true;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => window.__redditVideoPaused,
    });
    video.play = () => {
      window.__redditPlaybackCalls.play += 1;
      window.__redditVideoPaused = false;
      return Promise.resolve();
    };
    video.pause = () => {
      window.__redditPlaybackCalls.pause += 1;
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
  await expect(page.locator(".redditp__next")).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 1");
  expect(await page.evaluate(() => window.__redditpScrollCalls)).toBe(0);
  const playbackCalls = await page.evaluate(() => window.__redditPlaybackCalls);
  await page.getByRole("button", { name: "Collapse bottom controls" }).click();
  await page.getByRole("button", { name: "Expand bottom controls" }).click();
  expect(await page.evaluate(() => window.__redditPlaybackCalls)).toEqual(
    playbackCalls,
  );
  await expect(
    page.locator(".redditp__media video[src*='CMAF_96']"),
  ).toHaveCount(0);
  // Firefox's native video controls consume clicks on the video surface before
  // any page listener sees them, so Firefox toggles playback itself and neither
  // redditp nor Reddit's own handler runs. Only Chromium exercises this path.
  if (browserName !== "firefox") {
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
  }
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
    "https://videohost.example/ifr/some-clip-id?autoplay=1&muted=1&mute=1&sound=false",
  );
});

test("a player frame that answers no command says so on the sound button", async ({
  page,
}) => {
  await startPresentation(
    page,
    `
      <shreddit-post
        id="t3_framed_sound"
        post-title="Linked clip"
        author="poster"
        subreddit-prefixed-name="r/clips"
        content-href="https://videohost.example/watch/some-clip-id"
        permalink="/r/clips/comments/framed/linked_clip/"
      ></shreddit-post>
    `,
  );

  // Silent autoplay is the opening state, so it rides along in the frame URL.
  await expect(page.locator(".redditp__embed")).toHaveAttribute(
    "src",
    "https://videohost.example/ifr/some-clip-id?autoplay=1&muted=1&mute=1&sound=false",
  );
  await expect(page.locator(".redditp__sound")).toHaveAttribute(
    "title",
    "This embedded player answers only to its own sound control",
  );
});

test("the sound button commands a player that publishes a message protocol", async ({
  page,
}) => {
  await startPresentation(
    page,
    `
      <shreddit-post
        id="t3_youtube_sound"
        post-title="YouTube interview"
        author="poster"
        subreddit-prefixed-name="r/ukraine"
        content-href="https://www.youtube.com/watch?v=l74r1s8y7uY"
        permalink="/r/ukraine/comments/youtube/interview/"
      ></shreddit-post>
    `,
  );

  const soundButton = page.locator(".redditp__sound");
  await expect(soundButton).toHaveAttribute("title", "Toggle video sound (M)");

  // The real player never loads here, so stand in for the window the command
  // is posted to and record what it receives.
  await page.evaluate(() => {
    window.__posted = [];
    Object.defineProperty(
      document.querySelector(".redditp__embed"),
      "contentWindow",
      {
        get: () => ({
          postMessage: (message, origin) =>
            window.__posted.push([message, origin]),
        }),
      },
    );
  });

  await soundButton.click();
  await expect(soundButton).toHaveText("sound on");
  expect(await page.evaluate(() => window.__posted.at(-1))).toEqual([
    JSON.stringify({ event: "command", func: "unMute", args: [] }),
    "https://www.youtube.com",
  ]);

  await soundButton.click();
  await expect(soundButton).toHaveText("sound off");
  expect(await page.evaluate(() => window.__posted.at(-1))).toEqual([
    JSON.stringify({ event: "command", func: "mute", args: [] }),
    "https://www.youtube.com",
  ]);
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
    "https://www.youtube.com/embed/l74r1s8y7uY?start=1167&enablejsapi=1&autoplay=1&muted=1&mute=1&sound=false",
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
  // The media link opens the post's own YouTube page, not the embed player.
  await expect(
    page.getByRole("link", { name: "media", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=l74r1s8y7uY&t=1167s",
  );
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("i");
  expect((await popup).url()).toContain("youtube.com/watch?v=l74r1s8y7uY");
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
  await page.route(videoUrl, (route) => fulfillSilentVideo(route));
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
  await page.route(previewUrl, (route) => fulfillSilentVideo(route));
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

// Minimal old-Reddit gallery structure from the reported food+scenery DOM.
const oldGalleryIds = [
  "w7ko4xfmlklh1",
  "xz2bqxfmlklh1",
  "aoffmyfmlklh1",
  "q5qbzwfmlklh1",
  "uur6cxfmlklh1",
];
const oldGalleryUrl = "https://www.reddit.com/gallery/1vy9ca0";
const oldGalleryComments =
  "https://www.reddit.com/r/food/comments/1vy9ca0/pie/";
const oldGalleryImage = (id) =>
  `https://preview.redd.it/${id}.jpg?width=1170&format=pjpg&auto=webp&s=fixture`;

function oldGalleryPost(expanded = false) {
  const escape = (html) =>
    html.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const gallery = `<div class="media-gallery">
    <div class="gallery-tiles">${oldGalleryIds.map((id) => `<img class="preview" src="https://preview.redd.it/${id}.jpg?width=108" width="108" height="105">`).join("")}</div>
    ${oldGalleryIds.map((id, index) => `<div class="gallery-preview" style="display:none"><a class="gallery-item-thumbnail-link" data-position="${index + 1}" href="${escape(oldGalleryImage(id))}"><img class="preview" src="https://preview.redd.it/${id}.jpg?width=640" width="786" height="768"></a></div>`).join("")}
    <script>window.cachedGalleryScriptRan = true;</script>
    </div>`;
  return `<div class="thing link" data-fullname="t3_1vy9ca0" data-is-gallery="true" data-url="${oldGalleryUrl}" data-permalink="${oldGalleryComments}" data-author="baker" data-subreddit="food">
    <a class="title" href="${oldGalleryUrl}">Apple pie gallery</a>
    <div class="expando" data-cachedhtml="${escape(gallery)}">${expanded ? gallery.replace(/<script>.*?<\/script>/, "") : '<span class="error">loading...</span>'}</div>
  </div>`;
}

for (const expanded of [false, true]) {
  test(`old Reddit ${expanded ? "expanded" : "cached"} galleries use full-size images without duplicates`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://preview.redd.it/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="1140"/>',
      }),
    );
    const url = "https://www.reddit.com/r/food+scenery/?redditp=1";
    await page.route(url, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: oldGalleryPost(expanded),
      }),
    );
    await page.goto(url);
    await page.addStyleTag({ path: extensionStyles });
    await page.addScriptTag({ path: extensionScript });

    await expect(page.locator(".redditp__count")).toHaveText(
      /^1 \/ 1( · loading more)?$/,
    );
    for (let index = 0; index < oldGalleryIds.length; index += 1) {
      await expect(page.locator(".redditp__image")).toHaveAttribute(
        "src",
        oldGalleryImage(oldGalleryIds[index]),
      );
      await expect(page.locator(".redditp__gallery")).toHaveText(
        `(${index + 1}/5)`,
      );
      if (index < oldGalleryIds.length - 1) {
        if (index % 2) await page.keyboard.press("ArrowRight");
        else await page.locator(".redditp__next").click();
      }
    }
    await expect(
      page.getByRole("link", { name: "comments", exact: true }),
    ).toHaveAttribute("href", oldGalleryComments);
    await expect(
      page.getByRole("link", { name: "media", exact: true }),
    ).toHaveAttribute("href", oldGalleryImage(oldGalleryIds[4]));
    for (const [width, height] of [
      [360, 780],
      [390, 844],
      [393, 852],
      [412, 915],
      [1920, 1080],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height });
      const previous = page.locator(".redditp__prev");
      await expect(previous).toBeInViewport();
      await expect(page.locator(".redditp__controls")).toBeInViewport();
      await previous.click();
      await expect(page.locator(".redditp__gallery")).toHaveText("(4/5)");
      // Exercise the touch-pointer swipe handler without relying on Chromium's
      // touch-only emulation, so this also runs in Firefox.
      const stage = page.locator(".redditp__stage");
      await stage.dispatchEvent("pointerdown", {
        pointerType: "touch",
        pointerId: 1,
        clientX: 250,
        clientY: 300,
      });
      await stage.dispatchEvent("pointerup", {
        pointerType: "touch",
        pointerId: 1,
        clientX: 100,
        clientY: 300,
      });
      await expect(page.locator(".redditp__gallery")).toHaveText("(5/5)");
    }
    expect(
      await page.evaluate(() => window.cachedGalleryScriptRan),
    ).toBeUndefined();
    expect(errors).toEqual([]);
  });
}

test("G skips only the current gallery and advances ordinary posts", async ({
  page,
}) => {
  await page.route("https://preview.redd.it/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>',
    }),
  );
  await startPresentation(
    page,
    `${oldGalleryPost()}
    <shreddit-post id="t3_nextgallery" post-title="Next gallery" gallery content-href="https://www.reddit.com/gallery/nextgallery" permalink="/r/pics/comments/nextgallery/post/">
      <gallery-carousel>
        <figure><img src="https://preview.redd.it/next-1.jpg"></figure>
        <figure><img src="https://preview.redd.it/next-2.jpg"></figure>
      </gallery-carousel>
    </shreddit-post>
    <div class="thing link" data-url="https://example.com/after"><a class="title">After galleries</a></div>
    <div class="thing link" data-url="https://example.com/final"><a class="title">Final post</a></div>`,
  );
  await expect(page.locator(".redditp__count")).toHaveText("1 / 4");

  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  await page.keyboard.press("g");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 4");
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();

  await page.keyboard.press("g");
  await expect(page.locator(".redditp__title")).toHaveText("Next gallery");
  await expect(page.locator(".redditp__gallery")).toHaveText("(1/2)");
  await expect(page.locator(".redditp__count")).toHaveText("2 / 4");
  // The gallery counter must not wrap the controls onto a second row.
  const controlsBox = await page.locator(".redditp__controls").boundingBox();
  const countBox = await page.locator(".redditp__count").boundingBox();
  expect(controlsBox.height).toBeLessThan(countBox.height * 2);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".redditp__gallery")).toHaveText("(5/5)");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 4");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+G");
  await expect(page.locator(".redditp__count")).toHaveText("2 / 4");
  await expect(page.locator(".redditp__gallery")).toHaveAttribute(
    "title",
    /\(G\)/,
  );
  await page.locator(".redditp__gallery").click();
  await expect(page.locator(".redditp__title")).toHaveText("After galleries");
  await expect(page.locator(".redditp__gallery")).toBeHidden();
  await page.keyboard.press("g");
  await expect(page.locator(".redditp__title")).toHaveText("Final post");
});

test("G at the final gallery waits for more posts and otherwise wraps", async ({
  page,
}) => {
  // A load gives up only after Reddit has added nothing for a while.
  await page.clock.install();
  await page.route("https://preview.redd.it/**", (route) =>
    route.fulfill(svgImage(1170, 1140)),
  );
  await startPresentation(page, oldGalleryPost());
  await page.keyboard.press("g");
  await expect(page.locator(".redditp__count")).toHaveText(
    "1 / 1 · loading more",
  );
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="thing link" data-url="https://example.com/new"><a class="title">Newly loaded post</a></div>',
    );
  });
  await expect(page.locator(".redditp__title")).toHaveText("Newly loaded post");
  await page.keyboard.press("g");
  await page.clock.runFor(13_000);
  await expect(page.locator(".redditp__count")).toHaveText("1 / 2");
  await expect(page.locator(".redditp__gallery")).toHaveText("(1/5)");
  // Skipping a gallery with no next post must also wrap safely.
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    document.querySelector('[data-url="https://example.com/new"]').remove(),
  );
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await page.keyboard.press("g");
  await page.clock.runFor(13_000);
  await expect(page.locator(".redditp__gallery")).toHaveText("(1/5)");
  // The wrap lands on the only post, which starts another load; that one
  // gives up the same way.
  await page.clock.runFor(13_000);
  await expect(page.locator(".redditp__count")).toHaveText("1 / 1");
});

test("the last gallery starts loading more posts from its first image", async ({
  page,
}) => {
  await page.route("https://preview.redd.it/**", (route) =>
    route.fulfill(svgImage(1170, 1140)),
  );
  await startPresentation(page, oldGalleryPost());
  await expect(page.locator(".redditp__count")).toHaveText(
    "1 / 1 · loading more",
  );
  await expect(page.locator(".redditp__gallery")).toHaveText("(1/5)");

  // Browsing the gallery keeps working while the next posts load.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__gallery")).toHaveText("(2/5)");
  await page.locator(".redditp__button", { hasText: "auto" }).click();
  await expect(
    page.locator(".redditp__button", { hasText: "pause" }),
  ).toBeVisible();
  const controlsBox = await page.locator(".redditp__controls").boundingBox();
  const countBox = await page.locator(".redditp__count").boundingBox();
  expect(controlsBox.height).toBeLessThan(countBox.height * 2);
  await page.locator(".redditp__button", { hasText: "pause" }).click();

  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="thing link" data-url="https://example.com/new"><a class="title">Newly loaded post</a></div>',
    );
  });
  await expect(page.locator(".redditp__count")).toHaveText("1 / 2");
  await expect(page.locator(".redditp__gallery")).toHaveText("(2/5)");
});

test("G on a single-post gallery stops at its last image", async ({ page }) => {
  await page.route(oldGalleryComments, (route) =>
    route.fulfill({ contentType: "text/html", body: oldGalleryPost() }),
  );
  await page.route("https://preview.redd.it/**", (route) =>
    route.fulfill(svgImage(1170, 1140)),
  );
  await page.goto(oldGalleryComments);
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
  await page.keyboard.press("g");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 1");
  await expect(page.locator(".redditp__gallery")).toHaveText("(5/5)");
  await expect(page.locator(".redditp__next")).toBeDisabled();
  await page.keyboard.press("g");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 1");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".redditp__gallery")).toHaveText("(4/5)");
});

test("old Reddit search enrichment recognizes cached galleries", async ({
  page,
}) => {
  await page.route(oldGalleryComments, (route) =>
    route.fulfill({ contentType: "text/html", body: oldGalleryPost() }),
  );
  await page.route("https://preview.redd.it/**", (route) =>
    route.fulfill(svgImage(1170, 1140)),
  );
  await startPresentation(
    page,
    `<div class="search-result search-result-link" data-fullname="t3_1vy9ca0"><a class="search-title" href="${oldGalleryComments}">Apple pie gallery</a><a class="search-comments" href="${oldGalleryComments}">comments</a><a class="search-link" href="${oldGalleryUrl}">gallery</a></div>`,
  );
  await expect(page.locator(".redditp__count")).toHaveText(
    /^1 \/ 1( · loading more)?$/,
  );
  await expect(page.locator(".redditp__gallery")).toHaveText("(1/5)");
});

test("old Reddit galleries without usable cached media keep their link fallback", async ({
  page,
}) => {
  await startPresentation(
    page,
    `<div class="thing link" data-is-gallery="true" data-url="${oldGalleryUrl}"><a class="title">Unavailable gallery</a><div class="expando" data-cachedhtml="&lt;div class=&quot;media-gallery&quot;&gt;&lt;a class=&quot;gallery-item-thumbnail-link&quot; href=&quot;javascript:alert(1)&quot;&gt;"></div></div>`,
  );
  await expect(page.locator(".redditp__link-card")).toHaveAttribute(
    "href",
    oldGalleryUrl,
  );
  await expect(page.locator(".redditp__count")).toHaveText(
    /^1 \/ 1( · loading more)?$/,
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

  await expect(page.locator(".redditp__count")).toHaveText(
    /^1 \/ 1( · loading more)?$/,
  );
  await expect(page.locator(".redditp__gallery")).toHaveText("(1/3)");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__gallery")).toHaveText("(2/3)");
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

test("a small direct image post still fills the stage", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const gifUrl = "https://i.redd.it/small.gif";
  await page.route(gifUrl, async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"></svg>',
    });
  });
  await startPresentation(
    page,
    `<div class="thing link" data-url="${gifUrl}" data-author="alice" data-subreddit="gifs" data-permalink="/r/gifs/comments/one/small/">
      <a class="title" href="${gifUrl}">A small gif</a>
      <a class="comments" href="/r/gifs/comments/one/small/">comments</a>
    </div>`,
  );

  const dimensions = await page.locator(".redditp__image").evaluate((image) => {
    const bounds = image.getBoundingClientRect();
    return {
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      naturalWidth: image.naturalWidth,
    };
  });
  // The post's own media fills the stage even below the preview size gate.
  expect(dimensions).toEqual({
    width: 1920,
    height: 1080,
    naturalWidth: 640,
  });
  const originalImage = await page.locator(".redditp__image").elementHandle();
  for (const [width, height] of [
    [360, 780],
    [390, 844],
    [393, 852],
    [412, 915],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    const initialBounds = await originalImage.boundingBox();
    for (const action of [
      "Collapse bottom controls",
      "Expand bottom controls",
    ]) {
      await page.getByRole("button", { name: action }).click();
      expect(
        await originalImage.evaluate(
          (image) => image === document.querySelector(".redditp__image"),
        ),
      ).toBe(true);
      expect(await originalImage.boundingBox()).toEqual(initialBounds);
      await expect(page.locator(".redditp__image")).toHaveClass(
        /redditp__image--expand/,
      );
    }
  }
});

test("display settings preserve the auto timer and duration changes reschedule it", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-08-25T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-08-25T12:00:01Z"));
  await startPresentation(
    page,
    ["First", "Second", "Third"]
      .map(
        (title) =>
          `<div class="thing link" data-url="https://example.com/${title}"><a class="title">${title}</a></div>`,
      )
      .join(""),
  );
  await page.keyboard.press("a");
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.clock.runFor(5000);
  await page.getByRole("button", { name: "Collapse bottom controls" }).click();
  await page.getByRole("button", { name: "Expand bottom controls" }).click();
  await page.clock.runFor(1100);
  await expect(page.locator(".redditp__title")).toHaveText("Second");
  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  await page.getByLabel("Seconds per slide").fill("2");
  await page.getByLabel("Seconds per slide").press("Enter");
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await page.clock.runFor(2100);
  await expect(page.locator(".redditp__title")).toHaveText("Third");
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

  await expect(page.locator(".redditp__count")).toHaveText(
    /^1 \/ 1( · loading more)?$/,
  );
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

test("settings shortcut reference fits mobile and desktop screens", async ({
  page,
}, testInfo) => {
  await page.route("https://www.reddit.com/r/pics?redditp=1", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div class="thing link" data-url="https://example.com/post"><a class="title">Shortcut help</a></div>',
    }),
  );
  await page.goto("https://www.reddit.com/r/pics?redditp=1");
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  const help = page.getByRole("region", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(
    help.locator("dt").filter({ hasText: /^F$/ }).locator("+ dd"),
  ).toHaveText("Toggle fullscreen (if available)");
  await expect(
    help.locator("dt").filter({ hasText: /^G$/ }).locator("+ dd"),
  ).toHaveText("Skip gallery / next post");

  for (const [width, height] of [
    [360, 780],
    [390, 844],
    [393, 852],
    [412, 915],
    [1920, 1080],
    [2560, 1440],
    [360, 420],
  ]) {
    await page.setViewportSize({ width, height });
    if (width === 360 && height === 780) {
      await expect(
        page.getByRole("group", { name: "Show", exact: true }),
      ).toBeVisible();
    }
    await help.locator("p").scrollIntoViewIfNeeded();
    const bounds = await page
      .locator(".redditp__settings")
      .evaluate((panel) => {
        const rect = panel.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          overflow: panel.scrollWidth - panel.clientWidth,
        };
      });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.bottom).toBeLessThanOrEqual(height);
    expect(bounds.overflow).toBe(0);
    await expect(help.locator("p")).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`shortcuts-${width}x${height}.png`),
    });
    // Esc remains available even when the longer panel is scrolled, and the
    // next open must still allow mouse/touch users to reach the Done button.
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Open presentation settings" }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Open presentation settings" })
      .click();
    await page
      .getByRole("button", { name: "Close presentation settings" })
      .click();
    await expect(help).toBeHidden();
    await page
      .getByRole("button", { name: "Open presentation settings" })
      .click();
  }
});

test("settings persist timing and visibility while compact controls stay reachable", async ({
  page,
}) => {
  await page.route("https://i.redd.it/settings*.jpg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"/>',
    }),
  );
  await page.route("https://www.reddit.com/settings-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<shreddit-post post-title="Settings post" content-href="https://i.redd.it/settings.jpg" permalink="/r/pics/comments/settings/post/"></shreddit-post><shreddit-post post-title="Second settings post" content-href="https://i.redd.it/settings-2.jpg" permalink="/r/pics/comments/settings2/post/"></shreddit-post>`,
    }),
  );
  await page.goto("https://www.reddit.com/settings-test");
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
  const originalImage = await page.locator(".redditp__image").elementHandle();

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
  await expect(page.getByLabel("Show the bottom panel")).toBeChecked();
  await page.getByLabel("Show the bottom panel").uncheck();
  expect(
    await originalImage.evaluate(
      (image) => image === document.querySelector(".redditp__image"),
    ),
  ).toBe(true);

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
  expect(saved.showControls).toBe(false);
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
    "https://github.com/ubershmekel/redditp/blob/main/browser-extension/README.md",
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
  // The clip plays, so the video stays mounted for both src checks; a clip
  // that failed to load would leave the slideshow.
  await page.route(previewUrl, (route) => fulfillSilentVideo(route));
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
    ["f", "m", "g", "v", "o", "h"].map((key) => {
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
  expect(prevented).toEqual([false, false, false, false, false, false]);

  // The unmodified key still works.
  await page.keyboard.press("m");
  await expect(
    page.locator(".redditp__button", { hasText: "sound on" }),
  ).toBeVisible();
});

test("the M sound setting is remembered for the next presentation", async ({
  page,
}) => {
  // Settings storage needs a real origin, not setContent's about:blank.
  await page.route("https://www.reddit.com/sound-setting-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div class="thing link" data-url="https://example.com/story" data-permalink="/r/news/comments/one/a/"><a class="title">Only post</a></div>`,
    }),
  );
  async function openPresentation() {
    await page.goto("https://www.reddit.com/sound-setting-test");
    await page.addStyleTag({ path: extensionStyles });
    await page.addScriptTag({ path: extensionScript });
  }
  await openPresentation();
  await expect(
    page.locator(".redditp__button", { hasText: "sound off" }),
  ).toBeVisible();

  await page.keyboard.press("m");
  await expect(
    page.locator(".redditp__button", { hasText: "sound on" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("redditpPresentationSettings")),
  );
  expect(saved.sound).toBe(true);

  // A fresh content script, as on the next page load, reads it back.
  await openPresentation();
  await expect(
    page.locator(".redditp__button", { hasText: "sound on" }),
  ).toBeVisible();
});

test("a saved legacy controlsCollapsed setting becomes showControls", async ({
  page,
}) => {
  await page.route("https://www.reddit.com/legacy-setting-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div class="thing link" data-url="https://example.com/story" data-permalink="/r/news/comments/one/a/"><a class="title">Only post</a></div>`,
    }),
  );
  await page.goto("https://www.reddit.com/legacy-setting-test");
  await page.evaluate(() =>
    localStorage.setItem(
      "redditpPresentationSettings",
      JSON.stringify({ controlsCollapsed: true }),
    ),
  );
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
  await expect(page.locator(".redditp__controls")).toHaveClass(
    /redditp__controls--collapsed/,
  );

  await page.keyboard.press("p");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("redditpPresentationSettings")),
  );
  expect(saved.showControls).toBe(true);
  expect(saved).not.toHaveProperty("controlsCollapsed");
});

test("T hides and shows the title panel", async ({ page }) => {
  await startPresentation(
    page,
    `<div class="thing link" data-url="https://example.com/story" data-permalink="/r/news/comments/one/a/"><a class="title">Only post</a></div>`,
  );
  await expect(page.locator(".redditp__details")).toBeVisible();

  await page.keyboard.press("t");
  await expect(page.locator(".redditp__details")).toBeHidden();

  await page.keyboard.press("T");
  await expect(page.locator(".redditp__details")).toBeVisible();
});

test("P toggles the bottom controls and C opens comments", async ({ page }) => {
  await page
    .context()
    .route("https://www.reddit.com/r/news/comments/one/a/", (route) =>
      route.fulfill({ contentType: "text/html", body: "comments page" }),
    );
  await startPresentation(
    page,
    `<div class="thing link" data-url="https://example.com/story" data-permalink="https://www.reddit.com/r/news/comments/one/a/"><a class="title">Only post</a></div>`,
  );
  const controls = page.locator(".redditp__controls");
  await expect(controls).not.toHaveClass(/redditp__controls--collapsed/);

  await page.keyboard.press("p");
  await expect(controls).toHaveClass(/redditp__controls--collapsed/);
  await page.keyboard.press("p");
  await expect(controls).not.toHaveClass(/redditp__controls--collapsed/);

  const [commentsPage] = await Promise.all([
    page.context().waitForEvent("page"),
    page.keyboard.press("c"),
  ]);
  await commentsPage.waitForLoadState();
  expect(commentsPage.url()).toBe(
    "https://www.reddit.com/r/news/comments/one/a/",
  );
  await expect(page.locator("#redditp-presentation")).toBeVisible();
});

test("a video that fails to load is dropped, counted, and auto-advance goes on", async ({
  page,
}) => {
  await page.clock.install();
  await page.route("https://v.redd.it/broken/DASH_480.mp4", (route) =>
    route.abort(),
  );
  await startPresentation(
    page,
    `<div class="thing link" data-url="https://v.redd.it/broken/DASH_480.mp4" data-permalink="/r/v/comments/one/a/"><a class="title" href="https://v.redd.it/broken/DASH_480.mp4">Broken video</a></div>
     <div class="thing link" data-url="https://i.redd.it/second.jpg" data-permalink="/r/pics/comments/two/b/"><a class="title" href="https://i.redd.it/second.jpg">Second post</a></div>
     <div class="thing link" data-url="https://i.redd.it/third.jpg" data-permalink="/r/pics/comments/three/c/"><a class="title" href="https://i.redd.it/third.jpg">Third post</a></div>`,
  );
  const title = page.locator(".redditp__title");
  await expect(title).toHaveText("Second post");
  await expect(page.locator(".redditp__count")).toHaveText(
    /^1 \/ 2 · 1 unavailable( · loading more)?$/,
  );
  await expect(page.locator(".redditp__link-card")).toHaveCount(0);

  await page.locator(".redditp__button", { hasText: "auto" }).click();
  await page.clock.runFor(6500);
  await expect(title).toHaveText("Third post");
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

// Grid tiles take their height from the image, so every routed image needs
// real dimensions.
function svgImage(width, height) {
  return {
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`,
  };
}

// The image post titled "Post <number>".
function gridImagePost(number) {
  return `<div class="thing link" data-url="https://i.redd.it/grid-${number}.jpg" data-permalink="/r/pics/comments/grid${number}/post/"><a class="title">Post ${number}</a></div>`;
}

// Image posts titled "Post 1" to "Post <count>", in three shapes so the
// grid's columns fill unevenly.
function gridImagePosts(count) {
  return Array.from({ length: count }, (_, index) =>
    gridImagePost(index + 1),
  ).join("");
}

function routeGridImages(page) {
  return page.route(/^https:\/\/i\.redd\.it\/grid-\d+\.jpg$/, (route) => {
    const number = Number(
      route
        .request()
        .url()
        .match(/grid-(\d+)\.jpg$/)[1],
    );
    return route.fulfill(svgImage(800, [600, 800, 1200][number % 3]));
  });
}

test("V shows every slide as a grid tile without starting a player", async ({
  page,
}) => {
  await page.route("https://i.redd.it/**", (route) =>
    route.fulfill(svgImage(800, 600)),
  );
  await page.route("https://preview.redd.it/**", (route) =>
    route.fulfill(svgImage(1170, 1140)),
  );
  await page.route("https://external-preview.redd.it/**", (route) =>
    route.fulfill(svgImage(640, 360)),
  );
  await page.route("https://v.redd.it/**", (route) => route.abort());
  await startPresentation(
    page,
    `<div class="thing link" data-url="https://i.redd.it/grid-first.jpg" data-permalink="/r/pics/comments/gfirst/post/"><a class="title">First image</a></div>
    ${oldGalleryPost()}
    <div class="thing link" data-url="https://v.redd.it/gridclip" data-permalink="/r/videos/comments/gclip/post/"><a class="title">Grid clip</a><video src="https://v.redd.it/gridclip/DASH_480.mp4" poster="https://external-preview.redd.it/gridclip.png"></video></div>
    <shreddit-post id="t3_gridembed" post-title="Grid interview" content-href="https://www.youtube.com/watch?v=l74r1s8y7uY" permalink="/r/videos/comments/gridembed/post/"></shreddit-post>
    <div class="thing link" data-url="https://i.redd.it/grid-last.jpg" data-permalink="/r/pics/comments/glast/post/"><a class="title">Last image</a></div>`,
  );
  await expect(page.locator(".redditp__title")).toHaveText("First image");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 5");

  await page.keyboard.press("v");
  const grid = page.locator(".redditp__grid");
  const viewButton = page.getByRole("button", { name: "grid", exact: true });
  await expect(grid).toBeVisible();
  await expect(page.locator(".redditp__stage")).toBeHidden();
  await expect(grid.locator(".redditp__tile")).toHaveCount(9);
  // The grid may already be loading more posts at its end.
  await expect(page.locator(".redditp__count")).toHaveText(
    /^5 posts( · loading more)?$/,
  );
  await expect(viewButton).toHaveAttribute("aria-pressed", "true");
  await expect(viewButton).toHaveAttribute("title", /\(V\)/);
  await expect(
    page.getByRole("button", { name: "First image", exact: true }),
  ).toBeFocused();
  for (let item = 1; item <= 5; item += 1) {
    await expect(
      page
        .getByRole("button", {
          name: `Apple pie gallery, ${item} of 5`,
          exact: true,
        })
        .locator(".redditp__tile-badge"),
    ).toHaveText(`${item}/5`);
  }
  await expect(
    page.getByRole("button", { name: "Grid clip, video", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Grid interview, video", exact: true }),
  ).toBeVisible();
  await expect(grid.locator("video")).toHaveCount(0);
  await expect(grid.locator("iframe")).toHaveCount(0);
  // A video's tile says so to screen readers, and shows no play badge.
  await expect(grid.locator(".redditp__tile-play")).toHaveCount(0);
  await expect(page.locator(".redditp__prev")).toBeHidden();
  await expect(page.locator(".redditp__next")).toBeHidden();
  await expect(page.locator(".redditp__details")).toBeHidden();

  await page.keyboard.press("v");
  await expect(grid).toBeHidden();
  await expect(page.locator(".redditp__title")).toHaveText("First image");
  await expect(viewButton).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("v");
  await page
    .getByRole("button", { name: "Apple pie gallery, 3 of 5", exact: true })
    .click();
  await expect(grid).toBeHidden();
  await expect(page.locator(".redditp__gallery")).toHaveText("(3/5)");
  await expect(page.locator(".redditp__count")).toHaveText("2 / 5");
});

test("a grid tile opens its slide and Escape returns to that slide's tile", async ({
  page,
}) => {
  await routeGridImages(page);
  await startPresentation(page, gridImagePosts(30));
  await page.keyboard.press("v");
  await page.getByRole("button", { name: "Post 25", exact: true }).click();
  await expect(page.locator(".redditp__title")).toHaveText("Post 25");
  await expect(page.locator(".redditp__count")).toHaveText("25 / 30");
  for (let press = 0; press < 20; press += 1) {
    await page.keyboard.press("ArrowLeft");
  }
  await expect(page.locator(".redditp__title")).toHaveText("Post 5");

  await page.keyboard.press("Escape");
  await expect(page.locator(".redditp__grid")).toBeVisible();
  const tile = page.getByRole("button", { name: "Post 5", exact: true });
  await expect(tile).toBeFocused();
  await expect(tile).toBeInViewport();

  // Enter presses the focused tile.
  await page.keyboard.press("Enter");
  await expect(page.locator(".redditp__title")).toHaveText("Post 5");
  await page.keyboard.press("Escape");
  await expect(tile).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
});

test("the grid stops auto-advance", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-25T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-08-25T12:00:01Z"));
  await startPresentation(
    page,
    ["First", "Second", "Third"]
      .map(
        (title) =>
          `<div class="thing link" data-url="https://example.com/${title}"><a class="title">${title}</a></div>`,
      )
      .join(""),
  );
  await page.keyboard.press("a");
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("v");
  await expect(page.locator(".redditp__grid")).toBeVisible();
  await page.clock.runFor(10000);
  await page.keyboard.press("v");
  await expect(page.locator(".redditp__title")).toHaveText("First");
  await expect(
    page.getByRole("button", { name: "auto", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.clock.runFor(10000);
  await expect(page.locator(".redditp__title")).toHaveText("First");
});

test("the Open in grid view setting is saved and starts in the grid", async ({
  page,
}) => {
  await routeGridImages(page);
  await page.route("https://www.reddit.com/grid-setting-test", (route) =>
    route.fulfill({ contentType: "text/html", body: gridImagePosts(3) }),
  );
  async function openPresentation() {
    await page.goto("https://www.reddit.com/grid-setting-test");
    await page.addStyleTag({ path: extensionStyles });
    await page.addScriptTag({ path: extensionScript });
  }
  await openPresentation();
  await expect(page.locator(".redditp__title")).toHaveText("Post 1");

  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  await page.getByLabel("Open in grid view").check();
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  // The setting chooses the starting view; it does not switch this one.
  await expect(page.locator(".redditp__grid")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("redditpPresentationSettings")),
  );
  expect(saved.openInGrid).toBe(true);

  await openPresentation();
  await expect(page.locator(".redditp__grid")).toBeVisible();
  await expect(page.locator(".redditp__stage")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Post 1", exact: true }),
  ).toBeFocused();
});

test("the grid fits phone and desktop screens", async ({ page }) => {
  await routeGridImages(page);
  await startPresentation(page, gridImagePosts(12));
  await page.keyboard.press("v");
  const tiles = page.locator(".redditp__tile");
  const firstTile = page.getByRole("button", { name: "Post 1", exact: true });
  await expect(tiles).toHaveCount(12);
  await expect(firstTile).toBeFocused();

  for (const [width, height, columns] of [
    [360, 780, 2],
    [390, 844, 2],
    [393, 852, 2],
    [412, 915, 2],
    [1920, 1080, 6],
    [2560, 1440, 8],
  ]) {
    await page.setViewportSize({ width, height });
    // Relayout waits for the resize to settle; expect retries until then.
    await expect(page.locator(".redditp__grid-column")).toHaveCount(columns);
    const overflow = await page
      .locator(".redditp__grid")
      .evaluate((grid) => grid.scrollWidth - grid.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator(".redditp__controls")).toBeInViewport();
    await expect(firstTile).toBeInViewport();
    await expect(tiles).toHaveCount(12);
    await expect(firstTile).toBeFocused();
  }
});

test("the end of the grid loads more posts without rebuilding its tiles", async ({
  page,
}) => {
  await routeGridImages(page);
  const feedUrl = "https://www.reddit.com/r/gridfeed/";
  // A load gives up only after Reddit has added nothing for a while.
  await page.clock.install();
  await page.route(feedUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<shreddit-post id="t3_gfeed1" post-title="Post 1" content-href="https://i.redd.it/grid-1.jpg" permalink="/r/gridfeed/comments/gfeed1/post/"></shreddit-post><div style="height: 4000px"></div>`,
    }),
  );
  await page.goto(feedUrl);
  await page.evaluate(() => {
    localStorage.setItem(
      "redditpPresentationSettings",
      JSON.stringify({ openInGrid: true }),
    );
    window.__redditpScrollCalls = 0;
    const originalScrollTo = window.scrollTo.bind(window);
    window.scrollTo = (...args) => {
      window.__redditpScrollCalls += 1;
      originalScrollTo(...args);
    };
  });
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });

  const grid = page.locator(".redditp__grid");
  const count = page.locator(".redditp__count");
  const status = page.locator(".redditp__grid-status");
  await expect(count).toHaveText("1 post · loading more");
  await expect(status).toHaveText("Loading more posts…");
  const firstTile = await page
    .getByRole("button", { name: "Post 1", exact: true })
    .elementHandle();
  const gridScrollTop = await grid.evaluate((element) => element.scrollTop);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <shreddit-post id="t3_gfeed2" post-title="Post 2" content-href="https://i.redd.it/grid-2.jpg" permalink="/r/gridfeed/comments/gfeed2/post/"></shreddit-post>
        <shreddit-post id="t3_gfeed3" post-title="Post 3" content-href="https://i.redd.it/grid-3.jpg" permalink="/r/gridfeed/comments/gfeed3/post/"></shreddit-post>
      `,
    );
  });

  await expect(page.locator(".redditp__tile")).toHaveCount(3);
  await expect(count).toHaveText(/^3 posts/);
  // New posts join the grid; the tiles already there are left alone.
  expect(
    await firstTile.evaluate(
      (tile) =>
        tile.isConnected &&
        tile === document.querySelector(".redditp__tile[aria-label='Post 1']"),
    ),
  ).toBe(true);
  // Loading scrolls the Reddit page underneath, never the grid.
  expect(
    await page.evaluate(() => window.__redditpScrollCalls),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await grid.evaluate((element) => element.scrollTop)).toBe(
    gridScrollTop,
  );
  // A load that finds nothing ends the loading until the grid is shown again.
  await expect(status).toHaveText("Loading more posts…");
  await page.clock.runFor(13_000);
  await expect(status).toHaveText("No more posts right now");
  await expect(count).toHaveText("3 posts");
});

test("thumbnail tiles upgrade in view, two posts at a time", async ({
  page,
}) => {
  const searchUrl = "https://www.reddit.com/search/?q=gridsearch";
  const detailUrl = (number) =>
    `https://www.reddit.com/r/test/comments/gsearch${number}/post/`;
  const numbers = [1, 2, 3, 4, 5];
  const requests = new Map();
  let inFlight = 0;
  let maxInFlight = 0;
  await page.route("https://external-preview.redd.it/**", (route) =>
    route.fulfill(svgImage(640, 360)),
  );
  await page.route("https://i.redd.it/**", (route) =>
    route.fulfill(svgImage(800, 600)),
  );
  await page.route(
    /^https:\/\/www\.reddit\.com\/r\/test\/comments\/gsearch\d\/post\/$/,
    async (route) => {
      const url = route.request().url();
      const number = Number(url.match(/gsearch(\d)/)[1]);
      requests.set(url, (requests.get(url) || 0) + 1);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 300));
      inFlight -= 1;
      // The first result turns out to be a three-image gallery.
      const body =
        number === 1
          ? `<shreddit-post id="t3_gsearch1" post-title="Search result 1" gallery post-type="gallery" permalink="/r/test/comments/gsearch1/post/"><gallery-carousel>${[1, 2, 3].map((item) => `<figure><img src="https://i.redd.it/gsearch1-${item}.jpg"></figure>`).join("")}</gallery-carousel></shreddit-post>`
          : `<shreddit-post id="t3_gsearch${number}" post-title="Search result ${number}" content-href="https://i.redd.it/gsearch${number}.jpg" permalink="/r/test/comments/gsearch${number}/post/"></shreddit-post>`;
      await route.fulfill({ contentType: "text/html", body });
    },
  );
  await page.route(searchUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: numbers
        .map(
          (number) =>
            `<search-telemetry-tracker data-faceplate-tracking-context='{"post":{"id":"t3_gsearch${number}","title":"Search result ${number}"},"subreddit":{"name":"test"}}'><div data-testid="search-post-unit"><h2><a href="${detailUrl(number)}">Search result ${number}</a></h2><a href="${detailUrl(number)}" aria-label="Search result ${number} thumbnail image"><faceplate-img data-testid="search_post_thumbnail" src="https://external-preview.redd.it/gsearch${number}-thumb.png" alt="Search result ${number}"></faceplate-img></a></div></search-telemetry-tracker>`,
        )
        .join(""),
    }),
  );
  await page.goto(searchUrl);
  await page.evaluate(() =>
    localStorage.setItem(
      "redditpPresentationSettings",
      JSON.stringify({ openInGrid: true }),
    ),
  );
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });

  await expect(page.locator(".redditp__tile")).toHaveCount(7);
  for (const number of [2, 3, 4, 5]) {
    await expect(
      page
        .getByRole("button", { name: `Search result ${number}`, exact: true })
        .locator("img"),
    ).toHaveAttribute("src", `https://i.redd.it/gsearch${number}.jpg`);
  }
  for (let item = 1; item <= 3; item += 1) {
    await expect(
      page
        .getByRole("button", {
          name: `Search result 1, ${item} of 3`,
          exact: true,
        })
        .locator(".redditp__tile-badge"),
    ).toHaveText(`${item}/3`);
  }
  // The focused thumbnail hands focus to the first tile that replaced it.
  await expect(
    page.getByRole("button", { name: "Search result 1, 1 of 3", exact: true }),
  ).toBeFocused();
  expect([...requests.keys()].sort()).toEqual(numbers.map(detailUrl).sort());
  expect([...requests.values()]).toEqual([1, 1, 1, 1, 1]);
  expect(maxInFlight).toBeLessThanOrEqual(2);
});

// A routed page that hosts the viewer, so that the viewer can start in the
// grid, opened on a source that hands over `slides` at once. `before` runs
// in the page before the extension starts, and `settings` add to the saved
// settings. window.gridSourceDead lists the posts that the source heard were
// dropped.
async function openGridSource(page, slides, before, settings = {}) {
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/gridsource/",
    '<meta name="redditp-host" content="test">',
    { openInGrid: true, ...settings },
  );
  if (before) await page.evaluate(before);
  await injectExtension(page);
  await page.evaluate((list) => {
    window.gridSourceDead = [];
    window.__redditpPresentation.open({
      kind: "test",
      start: () => Promise.resolve({ slides: list }),
      loadMore: () => Promise.resolve({ slides: [] }),
      hasMore: () => false,
      onDead: (slide) => window.gridSourceDead.push(slide.postKey),
    });
  }, slides);
  await expect(page.locator(".redditp__grid")).toBeVisible();
}

// An image post of the grid source, titled "Grid slide <number>".
function gridSlide(number, fields = {}) {
  return {
    kind: "image",
    url: `https://i.redd.it/gs-${number}.jpg`,
    postMedia: true,
    title: `Grid slide ${number}`,
    postKey: `t3_gs${number}`,
    commentsUrl: `https://www.reddit.com/r/gridsource/comments/gs${number}/post/`,
    ...fields,
  };
}

// A GIF post of the grid source, titled "GIF <number>": the MP4 that Reddit
// made of it, its still, a 640 pixel copy of that still, and the 640 pixel
// MP4 that its tile loops.
function gifSlide(number, fields = {}) {
  const base = `https://preview.redd.it/gif-${number}.gif`;
  return gridSlide(number, {
    kind: "video",
    url: `${base}?format=mp4&s=full`,
    poster: `${base}?format=png8&s=still`,
    thumb: `${base}?width=640&format=png8&s=thumb`,
    thumbVideo: `${base}?width=640&format=mp4&s=loop`,
    fromGif: true,
    width: 640,
    height: 480,
    title: `GIF ${number}`,
    ...fields,
  });
}

// Reddit's MP4s of GIFs play the silent test clip.
function routeGifMp4s(page) {
  return page.route(
    /^https:\/\/preview\.redd\.it\/[^?]+\.gif\?(?:.*&)?format=mp4/,
    fulfillSilentVideo,
  );
}

// The renditions that the manifest of a landscape clip on v.redd.it lists,
// as [name, width, height, bandwidth], named after their short side as
// Reddit names them now; and those of a portrait clip, whose manifest stops
// at 720.
const LANDSCAPE_RENDITIONS = [
  ["CMAF_220.mp4", 392, 220, 190000],
  ["CMAF_270.mp4", 480, 270, 330000],
  ["CMAF_360.mp4", 640, 360, 620000],
  ["CMAF_480.mp4", 854, 480, 1000000],
  ["CMAF_720.mp4", 1280, 720, 1900000],
  ["CMAF_1080.mp4", 1920, 1080, 3900000],
];
const PORTRAIT_RENDITIONS = [
  ["CMAF_220.mp4", 220, 392, 157664],
  ["CMAF_270.mp4", 270, 480, 280092],
  ["CMAF_360.mp4", 360, 640, 543668],
  ["CMAF_480.mp4", 480, 854, 887294],
  ["CMAF_720.mp4", 720, 1280, 1768496],
];

// A video's manifest as v.redd.it serves it, to any origin: its renditions
// with a picture, as [name, width, height, bandwidth], and its sound.
function dashManifest(renditions) {
  const representations = renditions
    .map(
      ([name, width, height, bandwidth]) =>
        `<Representation bandwidth="${bandwidth}" codecs="avc1.4d401f" height="${height}" id="${name}" mimeType="video/mp4" width="${width}"><BaseURL>${name}</BaseURL></Representation>`,
    )
    .join("");
  return {
    status: 200,
    contentType: "application/dash+xml",
    headers: { "access-control-allow-origin": "*" },
    body: `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period><AdaptationSet contentType="video">${representations}</AdaptationSet><AdaptationSet contentType="audio"><Representation bandwidth="131851" codecs="mp4a.40.2" id="audio" mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`,
  };
}

// Answers the manifests on v.redd.it with answer(url), a response, and
// lists each request: its URL and the cookies it sent.
async function routeManifests(page, answer) {
  const requests = [];
  await page.route(
    /^https:\/\/v\.redd\.it\/[^/]+\/DASHPlaylist\.mpd$/,
    async (route) => {
      const request = route.request();
      requests.push({
        url: request.url(),
        cookie: (await request.allHeaders()).cookie || "",
      });
      return route.fulfill(answer(request.url()));
    },
  );
  return requests;
}

// A Reddit video post of the grid source, titled "Clip <number>": the 1080
// pixel file of a landscape clip on v.redd.it, which the slideshow plays and
// its tile trades for a smaller rendition, and its poster.
function redditVideoSlide(number, fields = {}) {
  const file = `https://v.redd.it/clip${number}/CMAF_1080.mp4?source=fallback`;
  return gridSlide(number, {
    kind: "video",
    url: file,
    poster: `https://external-preview.redd.it/clip${number}.png?format=pjpg&s=p`,
    thumbVideo: file,
    width: 1920,
    height: 1080,
    title: `Clip ${number}`,
    ...fields,
  });
}

// What the grid's loops are doing, by their tiles' names: each one's tile
// and src, and whether it plays.
function gridLoops(page) {
  return page.locator(".redditp__grid").evaluate((grid) =>
    Array.from(grid.querySelectorAll(".redditp__tile-video"), (video) => ({
      tile: video.closest(".redditp__tile").getAttribute("aria-label"),
      src: video.getAttribute("src"),
      playing: !video.paused,
    })).sort((a, b) => (a.tile < b.tile ? -1 : 1)),
  );
}

function gridTile(page, name) {
  return page
    .locator(".redditp__grid")
    .getByRole("button", { name, exact: true });
}

// A tile's height over its width.
async function tileShape(tile) {
  const box = await tile.boundingBox();
  return box.height / box.width;
}

test("a grid tile loads a 640 pixel copy from the card, shaped before it arrives", async ({
  page,
}) => {
  const article = "https://external-preview.redd.it/article.jpeg";
  const photo = "https://preview.redd.it/my-photo-v0-upload1.jpeg";
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/copies/",
    `<shreddit-post id="t3_copy1" post-title="Linked article" content-href="https://example.com/article" permalink="/r/copies/comments/copy1/post/">
      <img data-post-media-primary srcset="${article}?width=320&amp;s=1 320w, ${article}?width=640&amp;s=2 640w, ${article}?width=1080&amp;s=3 1080w" width="1080" height="540" alt="Linked article">
    </shreddit-post>
    <shreddit-post id="t3_copy2" post-title="Tall photo" content-href="https://i.redd.it/upload1.jpeg" permalink="/r/copies/comments/copy2/post/">
      <img data-post-media-primary srcset="${photo}?width=640&amp;s=a 640w, ${photo}?width=1080&amp;s=b 1080w" width="1080" height="1620" alt="Tall photo">
    </shreddit-post>
    <shreddit-post id="t3_copy3" post-title="Other photo" content-href="https://i.redd.it/upload2.jpeg" permalink="/r/copies/comments/copy3/post/">
      <img data-post-media-primary srcset="https://preview.redd.it/other9.jpeg?width=640&amp;s=c 640w" width="1080" height="1620" alt="Other photo">
    </shreddit-post>`,
    { openInGrid: true },
  );
  // From here on, pictures wait until the test lets them through. The
  // page's own pictures have loaded already.
  const held = [];
  let release = null;
  await page.route(
    /^https:\/\/(?:i|preview|external-preview)\.redd\.it\//,
    (route) => {
      if (release) return release(route);
      held.push(route);
    },
  );
  await injectExtension(page);

  const articleTile = gridTile(page, "Linked article");
  const photoTile = gridTile(page, "Tall photo");
  const otherTile = gridTile(page, "Other photo");
  await expect(articleTile.locator("img")).toHaveAttribute(
    "src",
    `${article}?width=640&s=2`,
  );
  // A link straight to an upload takes the card's copy of that upload.
  await expect(photoTile.locator("img")).toHaveAttribute(
    "src",
    `${photo}?width=640&s=a`,
  );
  // A copy of another upload says nothing about this one.
  await expect(otherTile.locator("img")).toHaveAttribute(
    "src",
    "https://i.redd.it/upload2.jpeg",
  );
  // The copies have not arrived, yet the tiles have their pictures' shapes.
  expect(
    await articleTile.locator("img").evaluate((image) => image.naturalWidth),
  ).toBe(0);
  expect(await tileShape(articleTile)).toBeCloseTo(0.5, 2);
  expect(await tileShape(photoTile)).toBeCloseTo(1.5, 2);
  expect(await tileShape(otherTile)).toBeCloseTo(1, 2);

  release = (route) => {
    const url = route.request().url();
    if (url.startsWith(photo)) return route.fulfill(svgImage(640, 960));
    if (url.startsWith(article)) return route.fulfill(svgImage(640, 320));
    return route.fulfill(svgImage(800, 600));
  };
  await Promise.all(held.splice(0).map(release));
  await expect(articleTile.locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  await expect(photoTile.locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  expect(await tileShape(articleTile)).toBeCloseTo(0.5, 2);
  expect(await tileShape(photoTile)).toBeCloseTo(1.5, 2);

  // The slideshow still shows the largest picture.
  await articleTile.click();
  await expect(page.locator(".redditp__image")).toHaveAttribute(
    "src",
    `${article}?width=1080&s=3`,
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__image")).toHaveAttribute(
    "src",
    "https://i.redd.it/upload1.jpeg",
  );
});

test("a failed or placeholder copy makes way for the original, which alone decides", async ({
  page,
}) => {
  const copy = (name) => `https://preview.redd.it/${name}.jpg?width=640&s=c`;
  const originals = [];
  // Pictures named broken-… fail, and pictures named gone-… are Reddit's
  // placeholder for a deleted picture.
  await page.route(
    /^https:\/\/(?:i|preview|external-preview)\.redd\.it\//,
    (route) => {
      const url = route.request().url();
      if (url.startsWith("https://i.redd.it/")) originals.push(url);
      if (/broken-/.test(url)) return route.abort();
      if (/gone-/.test(url)) return route.fulfill(svgImage(130, 60));
      return route.fulfill(svgImage(800, 600));
    },
  );
  await openGridSource(page, [
    gridSlide(1, { title: "Copy fails", thumb: copy("broken-1") }),
    gridSlide(2, { title: "Copy gone", thumb: copy("gone-2") }),
    gridSlide(3, {
      title: "Both fail",
      url: "https://i.redd.it/broken-3.jpg",
      thumb: copy("broken-3"),
    }),
    gridSlide(4, {
      title: "Both gone",
      url: "https://i.redd.it/gone-4.jpg",
      thumb: copy("gone-4"),
    }),
    gridSlide(5, { title: "Copy loads", thumb: copy("fine-5") }),
    gridSlide(6, {
      title: "Clip",
      kind: "video",
      url: "https://v.redd.it/clip6/DASH_480.mp4",
      poster: "https://external-preview.redd.it/broken-6.png",
      thumb: "https://external-preview.redd.it/broken-6.png?width=640",
    }),
  ]);
  await expect(gridTile(page, "Copy fails").locator("img")).toHaveAttribute(
    "src",
    "https://i.redd.it/gs-1.jpg",
  );
  await expect(gridTile(page, "Copy gone").locator("img")).toHaveAttribute(
    "src",
    "https://i.redd.it/gs-2.jpg",
  );
  await expect(gridTile(page, "Copy gone").locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  await expect(gridTile(page, "Both fail")).toHaveCount(0);
  await expect(gridTile(page, "Both gone")).toHaveCount(0);
  await expect(gridTile(page, "Copy loads").locator("img")).toHaveAttribute(
    "src",
    copy("fine-5"),
  );
  // A poster that fails, copy and all, keeps its card.
  await expect(
    gridTile(page, "Clip, video").locator(".redditp__tile-kind"),
  ).toHaveText("Video");
  await expect(page.locator(".redditp__grid .redditp__tile")).toHaveCount(4);
  await expect(page.locator(".redditp__count")).toHaveText(
    "4 posts · 2 unavailable",
  );
  expect((await page.evaluate(() => window.gridSourceDead)).sort()).toEqual([
    "t3_gs3",
    "t3_gs4",
  ]);
  // A copy that loaded left the original alone.
  expect(originals).not.toContain("https://i.redd.it/gs-5.jpg");
});

test("grid pictures load six screens below the view and two above, and no further", async ({
  page,
}) => {
  for (const [width, height] of [
    [360, 780],
    [412, 915],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    const requested = new Set();
    await page.route(/^https:\/\/i\.redd\.it\/gs-\d+\.jpg$/, (route) => {
      requested.add(route.request().url());
      return route.fulfill(svgImage(800, 800));
    });
    await openGridSource(
      page,
      Array.from({ length: 600 }, (_, index) =>
        gridSlide(index + 1, { width: 800, height: 800 }),
      ),
    );
    const grid = page.locator(".redditp__grid");
    const screen = await grid.evaluate((element) => element.clientHeight);
    // The tiles whose pictures should be loading, by where they sit in the
    // grid's scrolled content, and those that do not match.
    const outOfPlace = (loaded) =>
      grid.evaluate((element, spans) => {
        const origin = element.getBoundingClientRect().top - element.scrollTop;
        const wrong = [];
        element.querySelectorAll(".redditp__tile").forEach((tile) => {
          const box = tile.getBoundingClientRect();
          const top = box.top - origin;
          const bottom = box.bottom - origin;
          // Tiles on a range's very edge may go either way.
          const edge = spans.some(
            ([from, to]) =>
              Math.abs(bottom - from) < 2 || Math.abs(top - to) < 2,
          );
          if (edge) return;
          const expected = spans.some(
            ([from, to]) => bottom > from && top < to,
          );
          const loading = tile.querySelector("img").hasAttribute("src");
          if (loading !== expected) wrong.push(tile.getAttribute("aria-label"));
        });
        return wrong;
      }, loaded);
    // At the top, the view and six screens below it.
    const first = [0, 7 * screen];
    await expect
      .poll(() => outOfPlace([first]), { message: `${width}x${height}` })
      .toEqual([]);
    const top = gridTile(page, "Grid slide 1").locator("img");
    const last = gridTile(page, "Grid slide 600").locator("img");
    await expect(top).toHaveAttribute("src", "https://i.redd.it/gs-1.jpg");
    await expect(last).not.toHaveAttribute("src");
    expect(requested.has("https://i.redd.it/gs-600.jpg")).toBe(false);

    // A jump twelve screens down loads two screens above the new view and
    // six below it, and leaves the tiles it passed alone.
    await grid.evaluate((element, value) => {
      element.scrollTop = value;
    }, 12 * screen);
    await expect
      .poll(() => outOfPlace([first, [10 * screen, 19 * screen]]), {
        message: `${width}x${height} after the jump`,
      })
      .toEqual([]);

    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(last).toHaveAttribute("src", "https://i.redd.it/gs-600.jpg");
    // A picture that has loaded stays.
    await expect(top).toHaveAttribute("src", "https://i.redd.it/gs-1.jpg");
    await expect(page.locator(".redditp__controls")).toBeInViewport();
  }
});

test("without IntersectionObserver the browser loads the grid lazily, with nothing looping", async ({
  page,
}) => {
  await routeGifMp4s(page);
  const copy = "https://preview.redd.it/gs-1.jpg?width=640&s=c";
  await openGridSource(
    page,
    [gridSlide(1, { thumb: copy }), gifSlide(2)],
    () => {
      window.IntersectionObserver = undefined;
    },
  );
  const image = gridTile(page, "Grid slide 1").locator("img");
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect(image).toHaveAttribute("src", copy);
  const gifImage = gridTile(page, "GIF 2, video").locator("img");
  await expect(gifImage).toHaveAttribute("src", gifSlide(2).thumb);
  await expect(gifImage).toHaveClass(/redditp__tile-image--loaded/);
  await expect(page.locator(".redditp__grid video")).toHaveCount(0);
  await expect(gridTile(page, "GIF 2, video")).toHaveAttribute(
    "data-loop",
    "off",
  );
  await expect(gridTile(page, "Grid slide 1")).toHaveAttribute(
    "data-loop",
    "none",
  );
  await gridTile(page, "Grid slide 1").click();
  await expect(page.locator(".redditp__title")).toHaveText("Grid slide 1");
});

test("a GIF's tile loops a small silent MP4 over its still while it shows", async ({
  page,
}) => {
  await routeGifMp4s(page);
  await openGridSource(page, [gridSlide(1), gifSlide(2), gridSlide(3)]);
  const tile = gridTile(page, "GIF 2, video");
  const video = tile.locator("video");
  await expect(video).toHaveClass(/redditp__tile-video--shown/);
  expect(
    await video.evaluate((element) => ({
      src: element.getAttribute("src"),
      muted: element.muted,
      loop: element.loop,
      playsInline: element.playsInline,
      attributes: ["muted", "playsinline", "webkit-playsinline"].map((name) =>
        element.hasAttribute(name),
      ),
      preload: element.preload,
      controls: element.controls,
      hidden: element.getAttribute("aria-hidden"),
      pointerEvents: getComputedStyle(element).pointerEvents,
      objectFit: getComputedStyle(element).objectFit,
      paused: element.paused,
    })),
  ).toEqual({
    src: gifSlide(2).thumbVideo,
    muted: true,
    loop: true,
    playsInline: true,
    attributes: [true, true, true],
    preload: "auto",
    controls: false,
    hidden: "true",
    pointerEvents: "none",
    objectFit: "cover",
    paused: false,
  });
  // The still stays underneath, with no play badge over the loop.
  await expect(tile.locator("img")).toHaveAttribute("src", gifSlide(2).thumb);
  await expect(tile.locator(".redditp__tile-play")).toHaveCount(0);
  // Only the GIF loops.
  await expect(page.locator(".redditp__grid video")).toHaveCount(1);

  // A click on the loop opens the slide, as before, and the hidden grid's
  // loop pauses.
  await video.click({ force: true });
  await expect(page.locator(".redditp__title")).toHaveText("GIF 2");
  await expect(page.locator(".redditp__video")).toHaveAttribute(
    "src",
    gifSlide(2).url,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll(".redditp__grid video"),
          (element) => element.paused,
        ),
      ),
    )
    .toEqual([true]);
  await page.keyboard.press("Escape");
  await expect(tile).toBeFocused();
  await expect
    .poll(() => video.evaluate((element) => element.paused))
    .toBe(false);
  // Enter opens it from the keyboard.
  await page.keyboard.press("Enter");
  await expect(page.locator(".redditp__title")).toHaveText("GIF 2");
});

test("a loop comes within a screen below the view or half a screen above, reads itself in there, and leaves beyond", async ({
  page,
}) => {
  await routeGifMp4s(page);
  const loops = [];
  page.on("request", (request) => {
    if (/format=mp4/.test(request.url())) loops.push(request.url());
  });
  await openGridSource(page, [
    gifSlide(1),
    // In the shape of the picture that the media hosts answer with, so
    // that no tile moves as the pictures arrive.
    ...Array.from({ length: 120 }, (_, index) =>
      gridSlide(index + 2, { width: 800, height: 600 }),
    ),
    gifSlide(122),
  ]);
  const grid = page.locator(".redditp__grid");
  const tile = gridTile(page, "GIF 1, video");
  const farTile = gridTile(page, "GIF 122, video");
  const video = tile.locator("video");
  const farVideo = farTile.locator("video");
  await expect
    .poll(() => video.evaluate((element) => element.paused))
    .toBe(false);
  await expect(tile).toHaveAttribute("data-loop", "playing");
  // A GIF far down the grid has its still waiting, and no loop yet.
  await expect(farVideo).toHaveCount(0);
  await expect(farTile.locator("img")).not.toHaveAttribute("src");
  await expect(farTile).toHaveAttribute("data-loop", "idle");
  // A picture has nothing to loop.
  await expect(gridTile(page, "Grid slide 2")).toHaveAttribute(
    "data-loop",
    "none",
  );
  const screen = await grid.evaluate((element) => element.clientHeight);
  // Where a tile's edges are in the grid's scrolled content.
  const edges = (name) =>
    gridTile(page, name).evaluate((element) => {
      const view = element.closest(".redditp__grid");
      const box = element.getBoundingClientRect();
      const top = box.top - view.getBoundingClientRect().top + view.scrollTop;
      return { top, bottom: top + box.height };
    });
  const scrollTo = (top) =>
    grid.evaluate((element, value) => {
      element.scrollTop = value;
    }, top);
  const first = await edges("GIF 1, video");
  // Out of view, within half a screen above it: paused, and kept, having
  // read itself in.
  await scrollTo(first.bottom + screen * 0.4);
  await expect
    .poll(() => video.evaluate((element) => element.paused))
    .toBe(true);
  await expect(tile).toHaveAttribute("data-loop", "ready");
  const handle = await video.elementHandle();
  // Further away: gone, with its decoder released, while the still stays.
  await scrollTo(first.bottom + screen * 0.6);
  await expect(video).toHaveCount(0);
  expect(
    await handle.evaluate((element) => [
      element.isConnected,
      element.hasAttribute("src"),
    ]),
  ).toEqual([false, false]);
  await expect(tile).toHaveAttribute("data-loop", "idle");
  await expect(tile.locator("img")).toHaveAttribute("src", gifSlide(1).thumb);
  // Over a screen below the view, the far GIF's still loads, and its loop
  // waits.
  const far = await edges("GIF 122, video");
  await scrollTo(far.top - screen * 2.3);
  await expect(farTile.locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  await page.waitForTimeout(200);
  await expect(farVideo).toHaveCount(0);
  expect(loops).not.toContain(gifSlide(122).thumbVideo);
  // Within a screen below the view, it reads itself in, paused, and shows
  // its own first picture over the still before its tile shows.
  await scrollTo(far.top - screen * 1.7);
  await expect(farTile).toHaveAttribute("data-loop", "ready");
  await expect(farVideo).toHaveClass(/redditp__tile-video--shown/);
  expect(
    await farVideo.evaluate((element) => ({
      paused: element.paused,
      preload: element.preload,
    })),
  ).toEqual({ paused: true, preload: "auto" });
  // In view, it plays.
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => farVideo.evaluate((element) => element.paused))
    .toBe(false);
  await expect(farTile).toHaveAttribute("data-loop", "playing");
  // In view again, the first GIF gets a new loop.
  await scrollTo(0);
  await expect
    .poll(() => video.evaluate((element) => element.paused))
    .toBe(false);
});

// What the grid's loops are doing, by their tiles' names: each tile's
// data-loop, and its loop's preload and whether it plays, where it has one.
function gridLoopStates(page) {
  return page.locator(".redditp__grid").evaluate((grid) => {
    const states = {};
    grid.querySelectorAll(".redditp__tile[data-loop]").forEach((tile) => {
      const video = tile.querySelector(".redditp__tile-video");
      states[tile.getAttribute("aria-label")] = {
        state: tile.getAttribute("data-loop"),
        preload: video ? video.preload : "",
        playing: video ? !video.paused : false,
      };
    });
    return states;
  });
}

test("every loop in view plays at once, GIFs and videos alike, at 2560x1440", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await routeGifMp4s(page);
  await openGridSource(
    page,
    Array.from({ length: 30 }, (_, index) =>
      index % 2 ? redditVideoSlide(index + 1) : gifSlide(index + 1),
    ),
  );
  const loops = () =>
    page.locator(".redditp__grid").evaluate((element) => {
      const videos = Array.from(
        element.querySelectorAll(".redditp__tile-video"),
      );
      return {
        videos: videos.length,
        playing: videos.filter((video) => !video.paused).length,
        loading: videos.filter((video) => video.preload === "auto").length,
        states: Array.from(
          new Set(
            Array.from(element.querySelectorAll(".redditp__tile"), (tile) =>
              tile.getAttribute("data-loop"),
            ),
          ),
        ),
      };
    });
  // Every tile is in view.
  await expect
    .poll(loops)
    .toEqual({ videos: 30, playing: 30, loading: 30, states: ["playing"] });
});

test("loops in view all start at once, and those ahead read themselves in once all in view play, the nearest six at a time", async ({
  page,
}) => {
  // 4 columns of GIF tiles 232 pixels tall: GIFs 1 to 12 in view, 13 to 24
  // within a screen below it.
  await page.setViewportSize({ width: 1280, height: 720 });
  // Every loop waits until the test lets it through.
  const held = new Map();
  const released = new Set();
  await page.route(
    /^https:\/\/preview\.redd\.it\/gif-(\d+)\.gif\?(?:.*&)?format=mp4/,
    (route) => {
      const number = Number(
        route
          .request()
          .url()
          .match(/gif-(\d+)/)[1],
      );
      if (released.has(number)) return fulfillSilentVideo(route);
      if (!held.has(number)) held.set(number, []);
      held.get(number).push(route);
    },
  );
  const release = (numbers) =>
    Promise.all(
      numbers.map((number) => {
        released.add(number);
        const routes = held.get(number) || [];
        held.delete(number);
        return Promise.all(routes.map(fulfillSilentVideo));
      }),
    );
  await openGridSource(
    page,
    Array.from({ length: 40 }, (_, index) => gifSlide(index + 1)),
  );
  const name = (number) => `GIF ${number}, video`;
  const range = (from, to) =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const inView = range(1, 12);
  const below = range(13, 24);
  // The loops in view start; those below wait having asked for nothing,
  // and further down there is no loop at all.
  await expect
    .poll(async () => {
      const states = await gridLoopStates(page);
      return [
        ...inView.map((number) => states[name(number)].state),
        ...below.map((number) => states[name(number)].state),
        states[name(25)].state,
      ];
    })
    .toEqual([
      ...inView.map(() => "starting"),
      ...below.map(() => "waiting"),
      "idle",
    ]);
  let states = await gridLoopStates(page);
  expect(
    [...inView, ...below].map((number) => states[name(number)].preload),
  ).toEqual([...inView.map(() => "auto"), ...below.map(() => "none")]);
  // While one of them cannot play yet, nothing below reads in.
  await release(range(1, 11));
  await expect
    .poll(async () => {
      const current = await gridLoopStates(page);
      return range(1, 12).map((number) => current[name(number)].state);
    })
    .toEqual([...range(1, 11).map(() => "playing"), "starting"]);
  await page.waitForTimeout(300);
  states = await gridLoopStates(page);
  expect(below.map((number) => states[name(number)].preload)).toEqual(
    below.map(() => "none"),
  );

  // Once all in view play, the six nearest below start reading in: the row
  // just below the view, then two of the next.
  await release(inView);
  await expect
    .poll(async () => {
      const current = await gridLoopStates(page);
      const reading = below.filter(
        (number) => current[name(number)].preload === "auto",
      );
      return inView.every((number) => current[name(number)].playing)
        ? reading.length
        : -1;
    })
    .toBe(6);
  states = await gridLoopStates(page);
  expect(range(13, 16).map((number) => states[name(number)].state)).toEqual(
    range(13, 16).map(() => "buffering"),
  );
  expect(range(21, 24).map((number) => states[name(number)].state)).toEqual(
    range(21, 24).map(() => "waiting"),
  );
  // None of them plays.
  expect(below.some((number) => states[name(number)].playing)).toBe(false);

  // As they finish, the rest follow, and all wait ready, paused.
  await release(below);
  await expect
    .poll(async () => {
      const current = await gridLoopStates(page);
      return below.map((number) => current[name(number)].state);
    })
    .toEqual(below.map(() => "ready"));
  states = await gridLoopStates(page);
  expect(below.some((number) => states[name(number)].playing)).toBe(false);
  expect(inView.every((number) => states[name(number)].playing)).toBe(true);
});

test("after a fast scroll, the manifests of the tiles in view are read first", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // Every manifest waits until the test lets it through.
  const requested = [];
  const held = [];
  await page.route(
    /^https:\/\/v\.redd\.it\/[^/]+\/DASHPlaylist\.mpd$/,
    (route) => {
      requested.push(
        route
          .request()
          .url()
          .match(/clip(\d+)/)[1],
      );
      held.push(route);
    },
  );
  const releaseHeld = () =>
    Promise.all(
      held
        .splice(0)
        .map((route) => route.fulfill(dashManifest(LANDSCAPE_RENDITIONS))),
    );
  await openGridSource(
    page,
    Array.from({ length: 300 }, (_, index) =>
      // In the shape of the poster that the media hosts answer with.
      redditVideoSlide(index + 1, { width: 800, height: 600 }),
    ),
  );
  // Twelve at a time, those of the first tiles first; the tiles further
  // ahead have asked for theirs too.
  await expect.poll(() => requested.length).toBe(12);
  expect(requested).toEqual(
    Array.from({ length: 12 }, (_, index) => String(index + 1)),
  );
  const grid = page.locator(".redditp__grid");
  await grid.evaluate((element) => {
    element.scrollTop = element.clientHeight * 20;
  });
  // The numbers of the tiles in view, which wait for their manifests.
  const inView = () =>
    grid.evaluate((element) => {
      const view = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll(".redditp__tile"))
        .filter((tile) => {
          const box = tile.getBoundingClientRect();
          return box.bottom > view.top && box.top < view.bottom;
        })
        .map((tile) => ({
          number: tile.getAttribute("aria-label").match(/^Clip (\d+)/)[1],
          state: tile.getAttribute("data-loop"),
        }));
    });
  await expect
    .poll(async () =>
      Array.from(new Set((await inView()).map((tile) => tile.state))),
    )
    .toEqual(["resolving"]);
  const visible = (await inView()).map((tile) => tile.number);
  expect(visible.length).toBeGreaterThanOrEqual(6);
  // The next read are theirs, ahead of the many asked for before.
  await releaseHeld();
  await expect.poll(() => requested.length).toBe(24);
  expect(
    requested
      .slice(12, 12 + Math.min(12, visible.length))
      .filter((number) => !visible.includes(number)),
  ).toEqual([]);
  // Each loops once its manifest is read.
  await expect
    .poll(async () => {
      await releaseHeld();
      return Array.from(new Set((await inView()).map((tile) => tile.state)));
    })
    .toEqual(["playing"]);
});

test("a refused play keeps the still", async ({ page }) => {
  await routeGifMp4s(page);
  await openGridSource(page, [gifSlide(1), gridSlide(2)], () => {
    // As in iOS Low Power Mode.
    window.playCalls = 0;
    HTMLMediaElement.prototype.play = function play() {
      window.playCalls += 1;
      return Promise.reject(
        new DOMException("Low Power Mode", "NotAllowedError"),
      );
    };
  });
  const tile = gridTile(page, "GIF 1, video");
  await expect
    .poll(() => page.evaluate(() => window.playCalls))
    .toBeGreaterThan(0);
  await expect(tile.locator("video")).toHaveCount(0);
  await expect(tile).toHaveAttribute("data-loop", "refused");
  await expect(tile.locator("img")).toHaveAttribute("src", gifSlide(1).thumb);
  await expect(tile.locator("img")).toHaveClass(/redditp__tile-image--loaded/);
  await expect(page.locator(".redditp__count")).toHaveText("2 posts");
});

test("reduced motion and Data Saver keep GIF tiles still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await routeGifMp4s(page);
  await openGridSource(page, [gifSlide(1), gridSlide(2)]);
  const tile = gridTile(page, "GIF 1, video");
  await expect(tile.locator("img")).toHaveClass(/redditp__tile-image--loaded/);
  await expect(tile.locator("video")).toHaveCount(0);
  await expect(tile).toHaveAttribute("data-loop", "off");
  // A change of mind shows at once.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(() => tile.locator("video").evaluate((element) => element.paused))
    .toBe(false);
  await expect(tile).toHaveAttribute("data-loop", "playing");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(tile.locator("video")).toHaveCount(0);
  await expect(tile).toHaveAttribute("data-loop", "off");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openGridSource(page, [gifSlide(1), gridSlide(2)], () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
  });
  await expect(tile.locator("img")).toHaveClass(/redditp__tile-image--loaded/);
  await expect(tile.locator("video")).toHaveCount(0);
  await expect(tile).toHaveAttribute("data-loop", "off");
});

test("a loop that fails leaves its still and its slide", async ({ page }) => {
  await routeGifMp4s(page);
  let loopRequests = 0;
  await page.route(gifSlide(1).thumbVideo, (route) => {
    loopRequests += 1;
    return route.abort();
  });
  await openGridSource(page, [gifSlide(1), gridSlide(2)]);
  const tile = gridTile(page, "GIF 1, video");
  await expect.poll(() => loopRequests).toBeGreaterThan(0);
  await expect(tile.locator("video")).toHaveCount(0);
  await expect(tile).toHaveAttribute("data-loop", "failed");
  await expect(tile.locator("img")).toHaveClass(/redditp__tile-image--loaded/);
  await expect(page.locator(".redditp__count")).toHaveText("2 posts");
  expect(await page.evaluate(() => window.gridSourceDead)).toEqual([]);
});

test("a Reddit video's tile loops a small rendition that its manifest names, while the slideshow plays the video as before", async ({
  page,
}) => {
  await page
    .context()
    .addCookies([
      { name: "session", value: "viewer", url: "https://v.redd.it/" },
    ]);
  const manifests = await routeManifests(page, (url) =>
    dashManifest(
      url.includes("/clip2/") ? PORTRAIT_RENDITIONS : LANDSCAPE_RENDITIONS,
    ),
  );
  const files = [];
  page.on("request", (request) => {
    if (/^https:\/\/v\.redd\.it\/.+\.mp4/.test(request.url())) {
      files.push(request.url());
    }
  });
  const clip = redditVideoSlide(1);
  await openGridSource(
    page,
    [
      clip,
      redditVideoSlide(2, { width: 1080, height: 1920 }),
      // A crosspost of the first clip shares its manifest.
      redditVideoSlide(3, {
        title: "Crossposted clip",
        url: clip.url,
        thumbVideo: clip.thumbVideo,
      }),
      gridSlide(4),
    ],
    undefined,
    { sound: true },
  );
  const tile = gridTile(page, "Clip 1, video");
  const video = tile.locator("video");
  await expect(video).toHaveClass(/redditp__tile-video--shown/);
  // As silent as a GIF's loop, whatever the sound setting.
  expect(
    await video.evaluate((element) => ({
      src: element.getAttribute("src"),
      muted: element.muted,
      loop: element.loop,
      playsInline: element.playsInline,
      attributes: ["muted", "playsinline", "webkit-playsinline"].map((name) =>
        element.hasAttribute(name),
      ),
      preload: element.preload,
      controls: element.controls,
      hidden: element.getAttribute("aria-hidden"),
      pointerEvents: getComputedStyle(element).pointerEvents,
    })),
  ).toEqual({
    src: "https://v.redd.it/clip1/CMAF_360.mp4",
    muted: true,
    loop: true,
    playsInline: true,
    attributes: [true, true, true],
    preload: "auto",
    controls: false,
    hidden: "true",
    pointerEvents: "none",
  });
  await expect(tile.locator("img")).toHaveAttribute("src", clip.poster);
  // A portrait clip's 360 is its width.
  await expect
    .poll(() => gridLoops(page))
    .toEqual([
      {
        tile: "Clip 1, video",
        src: "https://v.redd.it/clip1/CMAF_360.mp4",
        playing: true,
      },
      {
        tile: "Clip 2, video",
        src: "https://v.redd.it/clip2/CMAF_360.mp4",
        playing: true,
      },
      {
        tile: "Crossposted clip, video",
        src: "https://v.redd.it/clip1/CMAF_360.mp4",
        playing: true,
      },
    ]);
  // Each manifest once, without the viewer's cookies; and never the file
  // that the slideshow plays.
  expect(manifests.sort((a, b) => (a.url < b.url ? -1 : 1))).toEqual([
    { url: "https://v.redd.it/clip1/DASHPlaylist.mpd", cookie: "" },
    { url: "https://v.redd.it/clip2/DASHPlaylist.mpd", cookie: "" },
  ]);
  expect(files.filter((url) => url.includes("CMAF_1080"))).toEqual([]);

  // The slideshow plays the 1080 pixel file, with sound as the settings
  // say, and the hidden grid's loops pause.
  await video.click({ force: true });
  const slideshowVideo = page.locator(".redditp__video");
  await expect(slideshowVideo).toHaveAttribute("src", clip.url);
  expect(await slideshowVideo.evaluate((element) => element.muted)).toBe(false);
  await expect
    .poll(async () => (await gridLoops(page)).filter((loop) => loop.playing))
    .toEqual([]);
  await page.keyboard.press("Escape");
  await expect(tile).toBeFocused();
  await expect
    .poll(
      async () => (await gridLoops(page)).filter((loop) => loop.playing).length,
    )
    .toBe(3);
  expect(manifests).toHaveLength(2);
});

test("a Reddit video's tile falls back to the video's own file when its manifest or rendition fails, and keeps its slide", async ({
  page,
}) => {
  const failed = {
    status: 404,
    contentType: "text/plain",
    headers: { "access-control-allow-origin": "*" },
    body: "Not found",
  };
  await routeManifests(page, (url) => {
    if (/\/clip[15]\//.test(url)) return failed;
    // A page instead of a manifest names nothing.
    if (url.includes("/clip2/")) {
      return {
        status: 200,
        contentType: "text/html",
        headers: { "access-control-allow-origin": "*" },
        body: "<!doctype html><title>Oops</title><p>Something went wrong",
      };
    }
    return dashManifest(LANDSCAPE_RENDITIONS);
  });
  await page.route("https://v.redd.it/clip3/CMAF_360.mp4", (route) =>
    route.abort(),
  );
  await page.route(/^https:\/\/v\.redd\.it\/clip4\/CMAF_/, (route) =>
    route.abort(),
  );
  await openGridSource(page, [
    redditVideoSlide(1),
    redditVideoSlide(2),
    redditVideoSlide(3),
    redditVideoSlide(4),
    // A tile that knows only the video's manifest has nothing to fall back
    // to.
    redditVideoSlide(5, {
      thumbVideo: "https://v.redd.it/clip5/DASHPlaylist.mpd",
    }),
  ]);
  const fallback = (number) => redditVideoSlide(number).url;
  await expect
    .poll(() => gridLoops(page))
    .toEqual([
      { tile: "Clip 1, video", src: fallback(1), playing: true },
      { tile: "Clip 2, video", src: fallback(2), playing: true },
      { tile: "Clip 3, video", src: fallback(3), playing: true },
    ]);
  for (const number of [4, 5]) {
    const tile = gridTile(page, `Clip ${number}, video`);
    await expect(tile.locator("img")).toHaveClass(
      /redditp__tile-image--loaded/,
    );
    await expect(tile.locator("video")).toHaveCount(0);
  }
  await expect(page.locator(".redditp__count")).toHaveText("5 posts");
  expect(await page.evaluate(() => window.gridSourceDead)).toEqual([]);
});

test("another source's loop plays only from Reddit's media hosts, over https", async ({
  page,
}) => {
  await routeGifMp4s(page);
  const elsewhere = [];
  await page.route(
    /^(?:https:\/\/videohost\.example|http:\/\/v\.redd\.it)\//,
    (route) => {
      elsewhere.push(route.request().url());
      return fulfillSilentVideo(route);
    },
  );
  await openGridSource(page, [
    redditVideoSlide(1),
    // Any slide may loop, not only a GIF.
    gifSlide(2, { title: "Unmarked", fromGif: false }),
    redditVideoSlide(3, {
      title: "Hosted clip",
      thumbVideo: "https://videohost.example/clip3.mp4",
    }),
    redditVideoSlide(4, {
      title: "Plain clip",
      thumbVideo: "http://v.redd.it/clip4/CMAF_1080.mp4",
    }),
  ]);
  await expect
    .poll(() => gridLoops(page))
    .toEqual([
      {
        tile: "Clip 1, video",
        src: "https://v.redd.it/clip1/CMAF_360.mp4",
        playing: true,
      },
      { tile: "Unmarked, video", src: gifSlide(2).thumbVideo, playing: true },
    ]);
  for (const name of ["Hosted clip, video", "Plain clip, video"]) {
    await expect(gridTile(page, name).locator("img")).toHaveClass(
      /redditp__tile-image--loaded/,
    );
  }
  expect(elsewhere).toEqual([]);
});

test("a GIF card's Reddit MP4 loops in its tile, and a GIF without one keeps its tile", async ({
  page,
}) => {
  await routeGifMp4s(page);
  const still = "https://preview.redd.it/cardgif2.gif";
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/gifcards/",
    `<shreddit-post id="t3_gifcard1" post-title="Card loop" content-href="https://i.redd.it/cardgif1.gif" permalink="/r/gifcards/comments/gifcard1/post/">
      <video src="https://preview.redd.it/cardgif1.gif?format=mp4&amp;s=m" poster="https://preview.redd.it/cardgif1.gif?format=png8&amp;s=p"></video>
    </shreddit-post>
    <shreddit-post id="t3_gifcard2" post-title="Card still" content-href="https://i.redd.it/cardgif2.gif" permalink="/r/gifcards/comments/gifcard2/post/">
      <img data-post-media-primary alt="Card still" srcset="${still}?width=320&amp;format=png8&amp;s=1 320w, ${still}?width=640&amp;format=png8&amp;s=2 640w" width="640" height="480">
    </shreddit-post>
    <shreddit-post id="t3_gifcard3" post-title="Card copies" content-href="https://i.redd.it/cardgif3.gif" permalink="/r/gifcards/comments/gifcard3/post/">
      <img data-post-media-primary alt="Card copies" srcset="https://preview.redd.it/cardgif3.gif?width=640&amp;s=1 640w" width="640" height="480">
    </shreddit-post>
    <div class="thing link" data-url="https://i.redd.it/cardgif4.gif" data-permalink="/r/gifcards/comments/gifcard4/post/"><a class="title">Old GIF</a></div>`,
    { openInGrid: true },
  );
  await injectExtension(page);
  const loop = gridTile(page, "Card loop, video").locator("video");
  await expect(loop).toHaveAttribute(
    "src",
    "https://preview.redd.it/cardgif1.gif?format=mp4&s=m",
  );
  await expect(loop).toHaveClass(/redditp__tile-video--shown/);
  // A still copy of a GIF stands in for it.
  await expect(gridTile(page, "Card still").locator("img")).toHaveAttribute(
    "src",
    `${still}?width=640&format=png8&s=2`,
  );
  // A copy that is a GIF again is no still, so the GIF itself shows, as it
  // does without any copy.
  await expect(gridTile(page, "Card copies").locator("img")).toHaveAttribute(
    "src",
    "https://i.redd.it/cardgif3.gif",
  );
  await expect(gridTile(page, "Old GIF").locator("img")).toHaveAttribute(
    "src",
    "https://i.redd.it/cardgif4.gif",
  );
  await expect(page.locator(".redditp__grid video")).toHaveCount(1);
});

test("a GIF player's tile loops the narrowest of its MP4s that is wide enough, as Reddit signed it", async ({
  page,
}) => {
  await routeGifMp4s(page);
  await page.route("https://packaged-media.redd.it/**", fulfillSilentVideo);
  const packaged = (height) =>
    new RegExp(
      `^https://packaged-media\\.redd\\.it/dvf13m3fhorh1/pb/m2-res_${height}p\\.mp4\\?`,
    );
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/HighQualityGifs/",
    gifPlayersFixture,
    { openInGrid: true },
  );
  await injectExtension(page);
  // An uploaded GIF's player names one MP4, which loops as it is: its
  // signed query is never changed.
  const upload = gridTile(page, "Let's get this over with, video");
  await expect(upload.locator("video")).toHaveAttribute(
    "src",
    "https://preview.redd.it/mqm32x4ox9sh1.gif?width=1100&format=mp4&s=ca0442188ad7d663c0a2912e69a0c8973d235928",
  );
  await expect(upload.locator("video")).toHaveClass(
    /redditp__tile-video--shown/,
  );
  // A video posted as a GIF loops its 640 pixel MP4, not its largest.
  const posted = gridTile(
    page,
    "Only have 15 years experience and all..., video",
  );
  await expect(posted.locator("video")).toHaveAttribute("src", packaged(480));
  await expect(posted.locator("video")).toHaveClass(
    /redditp__tile-video--shown/,
  );
  await expect(posted.locator("img")).toHaveAttribute(
    "src",
    /^https:\/\/external-preview\.redd\.it\/only-have-15-years-experience/,
  );
  // Reddit marks both as GIFs, so the GIFs filter shows both.
  await page.keyboard.press("o");
  await page.keyboard.press("o");
  await expect(page.locator(".redditp__count")).toHaveText(
    /^2 posts · GIFs only/,
  );
  await expect(page.locator(".redditp__grid .redditp__tile")).toHaveCount(2);
  // The slideshow still plays the largest MP4.
  await gridTile(
    page,
    "Only have 15 years experience and all..., video",
  ).click();
  await expect(page.locator(".redditp__video")).toHaveAttribute(
    "src",
    packaged(1080),
  );
});

test("a feed's Reddit video players loop a small rendition, from the MP4s the card names or else the manifest, and a YouTube post never loops", async ({
  page,
}) => {
  const manifests = await routeManifests(page, () =>
    dashManifest(LANDSCAPE_RENDITIONS),
  );
  await page.route("https://packaged-media.redd.it/**", fulfillSilentVideo);
  let players = 0;
  await page.route("https://www.youtube.com/**", (route) => {
    players += 1;
    return route.abort();
  });
  const packagedUrl = (height) =>
    `https://packaged-media.redd.it/feedclip2/pb/m2-res_${height}p.mp4?m=DASHPlaylist.mpd&v=1&e=1790665200&s=${height}`;
  // The MP4s that a player names with their sizes, as its attribute holds
  // them.
  const packagedJson = JSON.stringify({
    playbackMp4s: {
      duration: 30,
      permutations: [
        [220, 392],
        [270, 480],
        [360, 640],
        [480, 854],
        [720, 1280],
        [1080, 1920],
      ].map(([height, width]) => ({
        source: {
          url: packagedUrl(height),
          dimensions: { width, height },
          videoCodec: "H264",
        },
      })),
    },
  })
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const player = (id, attributes = "") =>
    `<shreddit-player src="https://v.redd.it/${id}/HLSPlaylist.m3u8?f=hd%2ChlsSpecOrder&amp;v=1&amp;a=1793239893" ${attributes} player-type="in_feed_player" post-type="video" poster="https://external-preview.redd.it/${id}.jpeg?width=640&amp;format=pjpg&amp;s=p" preview="https://v.redd.it/${id}/CMAF_96.mp4"></shreddit-player>`;
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/videos/",
    `<shreddit-post id="t3_feedclip1" post-title="Feed clip" post-type="video" domain="v.redd.it" content-href="https://v.redd.it/feedclip1" permalink="/r/videos/comments/feedclip1/clip/">
      ${player("feedclip1")}
    </shreddit-post>
    <shreddit-post id="t3_feedclip2" post-title="Packaged clip" post-type="video" domain="v.redd.it" content-href="https://v.redd.it/feedclip2" permalink="/r/videos/comments/feedclip2/clip/">
      ${player("feedclip2", `packaged-media-json="${packagedJson}"`)}
    </shreddit-post>
    <shreddit-post id="t3_ytclip" post-title="YouTube clip" content-href="https://www.youtube.com/watch?v=l74r1s8y7uY" permalink="/r/videos/comments/ytclip/clip/"></shreddit-post>`,
    { openInGrid: true },
  );
  await injectExtension(page);
  await expect
    .poll(() => gridLoops(page))
    .toEqual([
      {
        tile: "Feed clip, video",
        src: "https://v.redd.it/feedclip1/CMAF_360.mp4",
        playing: true,
      },
      {
        tile: "Packaged clip, video",
        src: packagedUrl(360),
        playing: true,
      },
    ]);
  // Only the player that names no sizes needed its manifest.
  expect(manifests.map((request) => request.url)).toEqual([
    "https://v.redd.it/feedclip1/DASHPlaylist.mpd",
  ]);
  const youtube = gridTile(page, "YouTube clip, video");
  await expect(youtube.locator("img")).toHaveAttribute(
    "src",
    "https://i.ytimg.com/vi/l74r1s8y7uY/hqdefault.jpg",
  );
  await expect(youtube.locator("video")).toHaveCount(0);
  await expect(youtube).toHaveAttribute("data-loop", "no-copy");
  await expect(page.locator(".redditp__grid iframe")).toHaveCount(0);
  expect(players).toBe(0);
  // They are still videos to the Show filter.
  await page.keyboard.press("o");
  await page.keyboard.press("o");
  await page.keyboard.press("o");
  await expect(page.locator(".redditp__count")).toHaveText(
    /^3 posts · videos only/,
  );
  // The slideshow still plays the largest MP4.
  await gridTile(page, "Packaged clip, video").click();
  await expect(page.locator(".redditp__video")).toHaveAttribute(
    "src",
    packagedUrl(1080),
  );
});

test("a RedGIFs post's tile loops Reddit's copy of the clip, which Reddit's data for the post names", async ({
  page,
}) => {
  const still = "https://external-preview.redd.it/redgifs-kinglet.jpg";
  const copy = "https://v.redd.it/kyuaevw0lcsh1/CMAF_1080.mp4";
  const manifests = await routeManifests(page, () =>
    dashManifest(PORTRAIT_RENDITIONS),
  );
  let players = 0;
  await page.route("https://www.redgifs.com/**", (route) => {
    players += 1;
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Player</title>",
    });
  });
  await page.route(POST_INFO_RE, (route) =>
    route.fulfill(
      postInfo([
        {
          name: "t3_1wsat28",
          domain: "redgifs.com",
          over_18: true,
          preview: {
            ...redditPreview(still, 1080, 1920),
            reddit_video_preview: {
              bitrate_kbps: 5000,
              fallback_url: copy,
              has_audio: false,
              height: 1920,
              width: 1080,
              scrubber_media_url: "https://v.redd.it/kyuaevw0lcsh1/CMAF_96.mp4",
              dash_url: "https://v.redd.it/kyuaevw0lcsh1/DASHPlaylist.mpd",
              duration: 33,
              hls_url: "https://v.redd.it/kyuaevw0lcsh1/HLSPlaylist.m3u8",
              is_gif: true,
              transcoding_status: "completed",
            },
          },
        },
      ]),
    ),
  );
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/NSFW_GIF/",
    redgifsEmbedFixture,
    { openInGrid: true },
  );
  await injectExtension(page);
  const tile = gridTile(page, "Audrey Hollander, video");
  await expect(tile.locator("img")).toHaveAttribute("src", previewCopy(still));
  // The clip is 1080 by 1920, so the tile loops the copy 360 wide.
  await expect
    .poll(() => gridLoops(page))
    .toEqual([
      {
        tile: "Audrey Hollander, video",
        src: "https://v.redd.it/kyuaevw0lcsh1/CMAF_360.mp4",
        playing: true,
      },
    ]);
  expect(manifests.map((request) => request.url)).toEqual([
    "https://v.redd.it/kyuaevw0lcsh1/DASHPlaylist.mpd",
  ]);
  await expect(page.locator(".redditp__grid iframe")).toHaveCount(0);
  expect(players).toBe(0);
  // RedGIFs is still a video to the Show filter.
  await page.keyboard.press("o");
  await page.keyboard.press("o");
  await page.keyboard.press("o");
  await expect(page.locator(".redditp__count")).toHaveText(
    /^1 post · videos only/,
  );
  // The slideshow still loads the player.
  await tile.click();
  await expect(page.locator(".redditp__embed")).toHaveAttribute(
    "src",
    "https://www.redgifs.com/ifr/cumbersomeshorttermkinglet?autoplay=1&muted=1&mute=1&sound=false",
  );
  await expect.poll(() => players).toBe(1);
});

test("a live Reddit video whose player names nothing loops from its post's link, and a clip with a card picture asks Reddit's data for its loop", async ({
  page,
}) => {
  const requests = [];
  await page.route(POST_INFO_RE, (route) => {
    requests.push(postInfoIds(route.request()));
    return route.fulfill(
      postInfo([
        {
          name: "t3_framed1",
          domain: "videohost.example",
          preview: {
            ...redditPreview(
              "https://external-preview.redd.it/framedclip.jpg",
              720,
              1280,
            ),
            reddit_video_preview: {
              fallback_url: "https://v.redd.it/framedcopy/CMAF_1080.mp4",
              width: 720,
              height: 1280,
              is_gif: true,
            },
          },
        },
        // Reddit keeps no copy of this one.
        { name: "t3_nodata1", domain: "videohost.example" },
      ]),
    );
  });
  await page.route("https://videohost.example/**", (route) => route.abort());
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/liveclips/",
    `<shreddit-post id="t3_bare1" post-title="Bare player" post-type="video" domain="v.redd.it" content-href="https://v.redd.it/bareclip1" permalink="/r/liveclips/comments/bare1/clip/">
      <shreddit-player></shreddit-player>
    </shreddit-post>
    <shreddit-post id="t3_framed1" post-title="Framed clip" post-type="link" content-href="https://videohost.example/watch/clip1" permalink="/r/liveclips/comments/framed1/post/">
      <faceplate-img src="https://external-preview.redd.it/framedclip.jpg?width=640" width="720" height="1280" alt="Framed clip"></faceplate-img>
    </shreddit-post>
    <shreddit-post id="t3_nodata1" post-title="Unknown clip" post-type="link" content-href="https://videohost.example/watch/clip2" permalink="/r/liveclips/comments/nodata1/post/">
      <faceplate-img src="https://external-preview.redd.it/unknownclip.jpg?width=640" width="640" height="360" alt="Unknown clip"></faceplate-img>
    </shreddit-post>
    <shreddit-post id="t3_ytlive" post-title="YouTube clip" content-href="https://www.youtube.com/watch?v=l74r1s8y7uY" permalink="/r/liveclips/comments/ytlive/clip/"></shreddit-post>
    <shreddit-post id="t3_pic1" post-title="Picture" content-href="https://i.redd.it/livepic1.jpg" permalink="/r/liveclips/comments/pic1/post/"></shreddit-post>`,
    { openInGrid: true },
  );
  await injectExtension(page);
  const grid = page.locator(".redditp__grid");
  await expect
    .poll(async () =>
      (await gridLoops(page)).map((loop) => [loop.src, loop.playing]),
    )
    .toEqual([
      ["https://v.redd.it/bareclip1/CMAF_360.mp4", true],
      ["https://v.redd.it/framedcopy/CMAF_360.mp4", true],
    ]);
  // Only the clips whose cards name no loop were asked about, together.
  expect(requests).toEqual([["t3_framed1", "t3_nodata1"]]);
  await expect(gridTile(page, "Framed clip, video")).toHaveAttribute(
    "data-loop",
    "playing",
  );
  await expect(gridTile(page, "Unknown clip, video")).toHaveAttribute(
    "data-loop",
    "no-data",
  );
  await expect(gridTile(page, "YouTube clip, video")).toHaveAttribute(
    "data-loop",
    "no-copy",
  );
  await expect(gridTile(page, "Picture")).toHaveAttribute("data-loop", "none");
  await expect(grid).toHaveAttribute("data-still-requests", "1");
  await expect(grid).toHaveAttribute("data-still-failures", "0");
  // The card's picture stays the clip's still.
  await expect(
    gridTile(page, "Framed clip, video").locator("img"),
  ).toHaveAttribute(
    "src",
    "https://external-preview.redd.it/framedclip.jpg?width=640",
  );
});

test("a player's tile shows a still of it, never the player, and a failed still keeps its card", async ({
  page,
}) => {
  const cardStill = "https://external-preview.redd.it/framedclip.jpg";
  const fileStill = "https://external-preview.redd.it/fileclip.jpg";
  await page.route(
    (url) => url.href.startsWith(cardStill),
    (route) => route.fulfill(svgImage(720, 1280)),
  );
  await page.route(
    "https://i.ytimg.com/vi/lostclip001/hqdefault.jpg",
    (route) => route.abort(),
  );
  // Counts the players that load, which only the slideshow may do.
  let players = 0;
  await page.route("https://videohost.example/**", (route) => {
    const url = route.request().url();
    if (url.endsWith(".mp4")) return fulfillSilentVideo(route);
    players += 1;
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Player</title>",
    });
  });
  await page.route("https://www.youtube.com/**", (route) => {
    players += 1;
    return route.abort();
  });
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/framedclips/",
    `<shreddit-post id="t3_framed1" post-title="Framed clip" post-type="link" content-href="https://videohost.example/watch/clip1" permalink="/r/framedclips/comments/framed1/post/">
      <faceplate-img src="${cardStill}?width=640&amp;crop=smart&amp;auto=webp" width="720" height="1280" alt="Framed clip"></faceplate-img>
    </shreddit-post>
    <shreddit-post id="t3_framed2" post-title="YouTube clip" content-href="https://www.youtube.com/watch?v=l74r1s8y7uY" permalink="/r/framedclips/comments/framed2/post/"></shreddit-post>
    <shreddit-post id="t3_framed3" post-title="Lost clip" content-href="https://youtu.be/lostclip001" permalink="/r/framedclips/comments/framed3/post/"></shreddit-post>
    <shreddit-post id="t3_framed4" post-title="File clip" post-type="link" content-href="https://videohost.example/files/clip4.mp4" permalink="/r/framedclips/comments/framed4/post/">
      <faceplate-img src="${fileStill}?width=640" width="640" height="360" alt="File clip"></faceplate-img>
    </shreddit-post>`,
    { openInGrid: true },
  );
  await injectExtension(page);
  const grid = page.locator(".redditp__grid");
  const framed = gridTile(page, "Framed clip, video");
  await expect(framed.locator("img")).toHaveAttribute(
    "src",
    `${cardStill}?width=640&crop=smart&auto=webp`,
  );
  await expect(framed.locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  expect(await tileShape(framed)).toBeCloseTo(1280 / 720, 2);
  // Without a picture in its card, a YouTube player shows YouTube's still.
  await expect(
    gridTile(page, "YouTube clip, video").locator("img"),
  ).toHaveAttribute("src", "https://i.ytimg.com/vi/l74r1s8y7uY/hqdefault.jpg");
  // A still that fails leaves the card, and the slide.
  const lost = gridTile(page, "Lost clip, video");
  await expect(lost.locator(".redditp__tile-kind")).toHaveText(
    "Embedded video",
  );
  await expect(lost.locator("img")).toHaveCount(0);
  // A video without a poster borrows its card's picture as well.
  await expect(
    gridTile(page, "File clip, video").locator("img"),
  ).toHaveAttribute("src", `${fileStill}?width=640`);
  await expect(grid.locator("iframe, video")).toHaveCount(0);
  expect(players).toBe(0);
  await expect(page.locator(".redditp__count")).not.toContainText(
    "unavailable",
  );

  // The slideshow is as it was: the video has no poster, and the player
  // loads.
  await gridTile(page, "File clip, video").click();
  const video = page.locator(".redditp__video");
  await expect(video).toHaveAttribute(
    "src",
    "https://videohost.example/files/clip4.mp4",
  );
  await expect(video).toHaveAttribute("poster", "");
  await page.keyboard.press("Escape");
  await framed.click();
  await expect(page.locator(".redditp__embed")).toHaveAttribute(
    "src",
    "https://videohost.example/ifr/clip1?autoplay=1&muted=1&mute=1&sound=false",
  );
  await expect.poll(() => players).toBe(1);
});

// Reddit's data for posts as /api/info.json answers with it: a listing of the
// posts it knows among those asked for.
function postInfo(posts) {
  return {
    status: 200,
    contentType: "application/json; charset=UTF-8",
    body: JSON.stringify({
      kind: "Listing",
      data: {
        after: null,
        dist: posts.length,
        children: posts.map((data) => ({ kind: "t3", data })),
        before: null,
      },
    }),
  };
}

// The posts that a request for Reddit's data asks about.
function postInfoIds(request) {
  return (new URL(request.url()).searchParams.get("id") || "")
    .split(",")
    .filter(Boolean)
    .sort();
}

// Reddit's preview of a post, its copy of the video's first frame, as its
// data gives it without raw_json (&amp; for &): the still itself and the
// copies of it narrower than it. `image` adds to or replaces its fields.
function redditPreview(base, width, height, image = {}) {
  const copy = (copyWidth) => ({
    url: `${base}?width=${copyWidth}&amp;crop=smart&amp;auto=webp&amp;s=c${copyWidth}`,
    width: copyWidth,
    height: Math.round((copyWidth * height) / width),
  });
  return {
    images: [
      {
        source: { url: `${base}?auto=webp&amp;s=full`, width, height },
        resolutions: [108, 216, 320, 640, 960, 1080]
          .filter((copyWidth) => copyWidth < width)
          .map(copy),
        variants: {},
        id: "preview",
        ...image,
      },
    ],
    enabled: false,
  };
}

// The 640 pixel copy that redditPreview lists for a still.
function previewCopy(base) {
  return `${base}?width=640&crop=smart&auto=webp&s=c640`;
}

test("a player's tile without a picture takes its still from Reddit's data for the post", async ({
  page,
}) => {
  const still = (name) => `https://external-preview.redd.it/${name}.jpg`;
  const blurred = "https://preview.redd.it/blurred-nsfwclip.jpg";
  const oembedStill = "https://thumbs.videohost.example/oembedclip-poster.jpg";
  // Every picture the page asks for.
  const pictures = [];
  await page.route(
    /^https:\/\/(?:external-preview\.redd\.it|preview\.redd\.it|thumbs\.videohost\.example)\//,
    (route) => {
      const url = route.request().url();
      pictures.push(url);
      if (url.includes("brokenclip")) return route.abort();
      if (url.includes("portrait")) return route.fulfill(svgImage(360, 640));
      if (url.startsWith(oembedStill)) return route.fulfill(svgImage(480, 640));
      return route.fulfill(svgImage(640, 480));
    },
  );
  // Counts the players that load, which only the slideshow may do.
  let players = 0;
  await page.route(
    /^https:\/\/(?:www\.redgifs\.com|videohost\.example)\//,
    (route) => {
      if (route.request().url().endsWith(".mp4")) {
        return fulfillSilentVideo(route);
      }
      players += 1;
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Player</title>",
      });
    },
  );
  const requests = [];
  await page.route(POST_INFO_RE, async (route) => {
    const request = route.request();
    requests.push({
      ids: postInfoIds(request),
      rawJson: new URL(request.url()).searchParams.get("raw_json"),
      cookie: (await request.allHeaders()).cookie || "",
    });
    return route.fulfill(
      postInfo([
        {
          name: "t3_1wsat28",
          domain: "redgifs.com",
          over_18: true,
          preview: redditPreview(still("redgifs-kinglet"), 1280, 960),
          // The preview wins over the oEmbed's thumbnail.
          secure_media: {
            type: "redgifs.com",
            oembed: {
              provider_name: "RedGIFs",
              thumbnail_url: "https://thumbs.videohost.example/unused.jpg",
              thumbnail_width: 640,
              thumbnail_height: 480,
            },
          },
        },
        {
          // An NSFW post's own source is missing here, and its variants are
          // blurred copies; the real copies are its resolutions.
          name: "t3_nsfwclip",
          over_18: true,
          thumbnail: "nsfw",
          preview: redditPreview(still("nsfwclip"), 1280, 960, {
            source: undefined,
            variants: {
              obfuscated: {
                source: {
                  url: `${blurred}?blur=40&amp;format=pjpg&amp;s=o`,
                  width: 1280,
                  height: 960,
                },
                resolutions: [
                  {
                    url: `${blurred}?width=640&amp;blur=40&amp;s=o640`,
                    width: 640,
                    height: 480,
                  },
                ],
              },
              nsfw: {
                source: {
                  url: `${blurred}?blur=40&amp;format=pjpg&amp;s=n`,
                  width: 1280,
                  height: 960,
                },
                resolutions: [
                  {
                    url: `${blurred}?width=640&amp;blur=40&amp;s=n640`,
                    width: 640,
                    height: 480,
                  },
                ],
              },
            },
          }),
        },
        {
          // No preview: the player's oEmbed thumbnail stands in.
          name: "t3_oembedclip",
          media: {
            oembed: {
              thumbnail_url: `${oembedStill}?a=1&amp;b=2`,
              thumbnail_width: 480,
              thumbnail_height: 640,
            },
          },
        },
        {
          name: "t3_fileclip",
          preview: redditPreview(still("portrait-fileclip"), 720, 1280),
        },
        {
          name: "t3_brokenclip",
          preview: redditPreview(still("brokenclip"), 1280, 720),
        },
        // Reddit knows nothing of t3_missingclip.
      ]),
    );
  });
  const clip = (id, title, href) =>
    `<shreddit-post id="t3_${id}" post-title="${title}" post-type="link" content-href="${href}" permalink="/r/NSFW_GIF/comments/${id}/clip/"></shreddit-post>`;
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/NSFW_GIF/",
    `${redgifsEmbedFixture}
    ${clip("nsfwclip", "NSFW clip", "https://videohost.example/watch/nsfwclip")}
    ${clip("oembedclip", "oEmbed clip", "https://videohost.example/watch/oembedclip")}
    ${clip("fileclip", "File clip", "https://videohost.example/files/fileclip.mp4")}
    ${clip("brokenclip", "Broken clip", "https://videohost.example/watch/brokenclip")}
    ${clip("missingclip", "Missing clip", "https://videohost.example/watch/missingclip")}
    ${clip("picture", "Picture post", "https://i.redd.it/picture1.jpg")}`,
    { openInGrid: true },
  );
  await page
    .context()
    .addCookies([
      { name: "session", value: "viewer", url: "https://www.reddit.com/" },
    ]);
  await injectExtension(page);

  const grid = page.locator(".redditp__grid");
  const redgifs = gridTile(page, "Audrey Hollander, video");
  await expect(redgifs.locator("img")).toHaveAttribute(
    "src",
    previewCopy(still("redgifs-kinglet")),
  );
  await expect(redgifs.locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  expect(await tileShape(redgifs)).toBeCloseTo(0.75, 2);
  // The players that came into range together share one request, with the
  // viewer's session; the picture post needs none.
  expect(requests).toEqual([
    {
      ids: [
        "t3_1wsat28",
        "t3_brokenclip",
        "t3_fileclip",
        "t3_missingclip",
        "t3_nsfwclip",
        "t3_oembedclip",
      ],
      rawJson: "1",
      cookie: "session=viewer",
    },
  ]);
  // An NSFW post's tile shows its real copy, never a blurred one.
  const nsfw = gridTile(page, "NSFW clip, video");
  await expect(nsfw.locator("img")).toHaveAttribute(
    "src",
    previewCopy(still("nsfwclip")),
  );
  await expect(nsfw.locator("img")).toHaveClass(/redditp__tile-image--loaded/);
  expect(pictures.filter((url) => /blur/.test(url))).toEqual([]);
  const oembed = gridTile(page, "oEmbed clip, video");
  await expect(oembed.locator("img")).toHaveAttribute(
    "src",
    `${oembedStill}?a=1&b=2`,
  );
  await expect(oembed.locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  expect(await tileShape(oembed)).toBeCloseTo(640 / 480, 2);
  // A video without a poster takes the still for its tile alone.
  const file = gridTile(page, "File clip, video");
  await expect(file.locator("img")).toHaveAttribute(
    "src",
    previewCopy(still("portrait-fileclip")),
  );
  await expect(file.locator("img")).toHaveClass(/redditp__tile-image--loaded/);
  expect(await tileShape(file)).toBeCloseTo(640 / 360, 2);
  // A still that fails, and a post Reddit said nothing of, keep their cards
  // and their slides.
  for (const name of ["Broken clip, video", "Missing clip, video"]) {
    await expect(
      gridTile(page, name).locator(".redditp__tile-kind"),
    ).toHaveText("Embedded video");
    await expect(gridTile(page, name).locator("img")).toHaveCount(0);
  }
  await expect
    .poll(() => pictures.filter((url) => url.includes("brokenclip")).length)
    .toBeGreaterThan(0);
  // Reddit's data named no loop for them, and the grid says how its asking
  // went.
  for (const name of ["Missing clip, video", "File clip, video"]) {
    await expect(gridTile(page, name)).toHaveAttribute("data-loop", "no-data");
  }
  await expect(gridTile(page, "Picture post")).toHaveAttribute(
    "data-loop",
    "none",
  );
  await expect(grid).toHaveAttribute("data-still-requests", "1");
  await expect(grid).toHaveAttribute("data-still-failures", "0");
  await expect(grid).not.toHaveAttribute("data-still-gave-up");
  await expect(page.locator(".redditp__count")).toHaveText(/^7 posts/);
  await expect(page.locator(".redditp__count")).not.toContainText(
    "unavailable",
  );
  // The grid tiles' columns kept their tiles in place.
  await expect(grid.locator(".redditp__tile")).toHaveCount(7);
  await expect(grid.locator("iframe, video")).toHaveCount(0);
  expect(players).toBe(0);

  // The slideshow is as it was: the frame loads, and the video has no
  // poster.
  await redgifs.click();
  await expect(page.locator(".redditp__embed")).toHaveAttribute(
    "src",
    "https://www.redgifs.com/ifr/cumbersomeshorttermkinglet?autoplay=1&muted=1&mute=1&sound=false",
  );
  await expect.poll(() => players).toBe(1);
  await page.keyboard.press("Escape");
  await file.click();
  const video = page.locator(".redditp__video");
  await expect(video).toHaveAttribute(
    "src",
    "https://videohost.example/files/fileclip.mp4",
  );
  await expect(video).toHaveAttribute("poster", "");
  await page.keyboard.press("Escape");
  await expect(file).toBeFocused();
  // Once per post per open: the grid asked no more, and asks again only
  // once the viewer opens afresh.
  expect(requests).toHaveLength(1);
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(redgifs.locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  expect(requests).toHaveLength(2);
});

test("the grid stops asking Reddit's data for stills after three failures in a row", async ({
  page,
}) => {
  // Reddit's answers in turn: an error, a challenge page, the posts' data,
  // an answer that is not JSON, a block, and JSON without posts.
  const answers = [
    () => ({ status: 500, contentType: "text/plain", body: "Server error" }),
    () => ({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>Reddit - Prove your humanity</title><p>Please wait for verification.</p>",
    }),
    (ids) =>
      postInfo(
        ids.map((name) => ({
          name,
          preview: redditPreview(
            `https://external-preview.redd.it/${name}.jpg`,
            1280,
            960,
          ),
        })),
      ),
    () => ({
      status: 200,
      contentType: "application/json",
      body: "<html><body>Too many requests</body></html>",
    }),
    () => ({
      status: 403,
      contentType: "text/html",
      body: "<!doctype html><title>Blocked</title>",
    }),
    () => ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Forbidden", error: 403 }),
    }),
  ];
  const requests = [];
  await page.route(POST_INFO_RE, (route) => {
    const ids = postInfoIds(route.request());
    const answer = answers[Math.min(requests.length, answers.length - 1)];
    requests.push(ids);
    return route.fulfill(answer(ids));
  });
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/framedclips/",
    // Enough that the tiles in range at first leave some for later.
    Array.from(
      { length: 300 },
      (_, index) =>
        `<shreddit-post id="t3_frame${index + 1}" post-title="Frame ${index + 1}" post-type="link" content-href="https://videohost.example/watch/frame${index + 1}" permalink="/r/framedclips/comments/frame${index + 1}/clip/"></shreddit-post>`,
    ).join(""),
    { openInGrid: true },
  );
  await injectExtension(page);
  const grid = page.locator(".redditp__grid");
  await expect(grid.locator(".redditp__tile")).toHaveCount(300);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  // Down the grid, a little at a time, so each step asks on its own.
  const screen = await grid.evaluate((element) => element.clientHeight);
  for (let top = screen / 2; ; top += screen / 2) {
    await grid.evaluate((element, value) => {
      element.scrollTop = value;
    }, top);
    await page.waitForTimeout(150);
    const end = await grid.evaluate(
      (element) =>
        element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
    );
    if (end) break;
  }
  await page.waitForTimeout(300);
  // The third request's answer counted, so it took three more failures.
  expect(requests).toHaveLength(6);
  const asked = requests.flat();
  expect(new Set(asked).size).toBe(asked.length);
  // The grid says so, and so does every tile, by what came of its post.
  await expect(grid).toHaveAttribute("data-still-requests", "6");
  await expect(grid).toHaveAttribute("data-still-failures", "5");
  await expect(grid).toHaveAttribute("data-still-gave-up", "");
  const loopState = (name) =>
    gridTile(page, `Frame ${name.replace("t3_frame", "")}, video`).getAttribute(
      "data-loop",
    );
  expect(await loopState(requests[0][0])).toBe("info-failed");
  expect(await loopState(requests[2][0])).toBe("no-data");
  expect(await loopState(requests[5][0])).toBe("info-failed");
  const neverAsked = Array.from(
    { length: 300 },
    (_, index) => `t3_frame${index + 1}`,
  ).filter((name) => !asked.includes(name));
  expect(neverAsked.length).toBeGreaterThan(0);
  expect(await loopState(neverAsked[0])).toBe("info-capped");
  // Only the tiles of the posts Reddit answered for show a picture; the
  // others keep their cards, and every slide stays.
  const answered = requests[2];
  expect(answered.length).toBeGreaterThan(0);
  for (const name of answered) {
    const number = name.replace("t3_frame", "");
    await expect(
      gridTile(page, `Frame ${number}, video`).locator("img"),
    ).toHaveAttribute(
      "src",
      previewCopy(`https://external-preview.redd.it/${name}.jpg`),
    );
  }
  await expect(grid.locator(".redditp__tile-image")).toHaveCount(
    answered.length,
  );
  await expect(page.locator(".redditp__count")).toHaveText(/^300 posts/);
  expect(asked.length).toBeLessThan(300);
});

test("posts from another source are never read from Reddit for stills", async ({
  page,
}) => {
  const requests = [];
  await page.route(POST_INFO_RE, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await openGridSource(page, [
    gridSlide(1, {
      title: "Framed",
      kind: "embed",
      url: "https://videohost.example/ifr/framed1",
    }),
    gridSlide(2),
  ]);
  await expect(
    gridTile(page, "Framed, video").locator(".redditp__tile-kind"),
  ).toHaveText("Embedded video");
  await expect(gridTile(page, "Grid slide 2").locator("img")).toHaveClass(
    /redditp__tile-image--loaded/,
  );
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
});

test("a gallery's full-size JPEG transcodes load from i.redd.it, and its tiles from 640 pixel copies", async ({
  page,
}) => {
  const figure = (id, extension) => {
    const base = `https://preview.redd.it/apple-pie-v0-${id}.${extension}`;
    return `<figure><img alt="Pie gallery" srcset="${base}?width=640&amp;crop=smart&amp;auto=webp&amp;s=a 640w, ${base}?width=3024&amp;format=pjpg&amp;auto=webp&amp;s=b 3024w" width="3024" height="4032"></figure>`;
  };
  await page.route(/apple-pie-v0-pie\d\.\w+\?width=640/, (route) =>
    route.fulfill(svgImage(640, 853)),
  );
  await startPresentation(
    page,
    `<shreddit-post post-title="Pie gallery" gallery post-type="gallery" content-href="https://www.reddit.com/gallery/piegal" permalink="/r/food/comments/piegal/pie/">
      <gallery-carousel>${figure("pie1", "jpg")}${figure("pie2", "png")}${figure("pie3", "webp")}</gallery-carousel>
    </shreddit-post>`,
  );
  const image = page.locator(".redditp__image");
  await expect(image).toHaveAttribute("src", "https://i.redd.it/pie1.jpg");
  await page.keyboard.press("ArrowRight");
  // A PNG keeps its transcode, since its original can weigh far more.
  await expect(image).toHaveAttribute(
    "src",
    "https://preview.redd.it/apple-pie-v0-pie2.png?width=3024&format=pjpg&auto=webp&s=b",
  );
  await page.keyboard.press("ArrowRight");
  await expect(image).toHaveAttribute("src", "https://i.redd.it/pie3.webp");

  await page.keyboard.press("v");
  const tile = gridTile(page, "Pie gallery, 1 of 3");
  await expect(tile.locator("img")).toHaveAttribute(
    "src",
    "https://preview.redd.it/apple-pie-v0-pie1.jpg?width=640&crop=smart&auto=webp&s=a",
  );
  expect(await tileShape(tile)).toBeCloseTo(4032 / 3024, 2);
});

// Seven posts in page order, one of each kind the Show filter tells apart:
// an image, a GIF, a Reddit video, an embed, an imgur GIFV, a link post, and
// a second image.
function mediaMixPosts() {
  return `
    <div class="thing link" data-url="https://i.redd.it/mix-first.jpg" data-permalink="/r/mix/comments/mix1/post/"><a class="title">First image</a></div>
    <div class="thing link" data-url="https://i.redd.it/mix-party.gif" data-permalink="/r/mix/comments/mix2/post/"><a class="title">Party gif</a></div>
    <div class="thing link" data-url="https://v.redd.it/mixclip" data-permalink="/r/mix/comments/mix3/post/"><a class="title">Mix clip</a><video src="https://v.redd.it/mixclip/DASH_480.mp4" poster="https://external-preview.redd.it/mixclip.png"></video></div>
    <shreddit-post id="t3_mix4" post-title="Mix interview" content-href="https://www.youtube.com/watch?v=l74r1s8y7uY" permalink="/r/mix/comments/mix4/post/"></shreddit-post>
    <div class="thing link" data-url="https://i.imgur.com/mixloop.gifv" data-permalink="/r/mix/comments/mix5/post/"><a class="title">Imgur loop</a></div>
    <div class="thing link" data-url="https://example.com/mix-story" data-permalink="/r/mix/comments/mix6/post/"><a class="title">Mix story</a></div>
    <div class="thing link" data-url="https://i.redd.it/mix-last.jpg" data-permalink="/r/mix/comments/mix7/post/"><a class="title">Last image</a></div>
  `;
}

// Pictures and videos load; embeds never do, so nothing waits on them.
async function routeMediaMix(page) {
  await page.route("https://i.redd.it/**", (route) =>
    route.fulfill(svgImage(800, 600)),
  );
  await page.route("https://external-preview.redd.it/**", (route) =>
    route.fulfill(svgImage(640, 360)),
  );
  for (const pattern of ["https://v.redd.it/**", "https://i.imgur.com/**"]) {
    await page.route(pattern, (route) => fulfillSilentVideo(route));
  }
  await page.route("https://www.youtube.com/**", (route) => route.abort());
}

// A routed Reddit page has storage, unlike setContent's about:blank, so the
// saved settings can be set before the extension starts.
async function openRoutedPage(page, url, body, settings) {
  await page.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body }),
  );
  await page.goto(url);
  await page.evaluate(
    (value) =>
      localStorage.setItem(
        "redditpPresentationSettings",
        JSON.stringify(value),
      ),
    settings,
  );
}

async function injectExtension(page) {
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
}

function mixVideoPost(id, title) {
  return `<div class="thing link" data-url="https://v.redd.it/${id}" data-permalink="/r/mixload/comments/${id}/post/"><a class="title">${title}</a><video src="https://v.redd.it/${id}/DASH_480.mp4" poster="https://external-preview.redd.it/${id}.png"></video></div>`;
}

function mixImagePost(id, title) {
  return `<shreddit-post id="t3_${id}" post-title="${title}" content-href="https://i.redd.it/${id}.jpg" permalink="/r/mixload/comments/${id}/post/"></shreddit-post>`;
}

function insertPosts(page, html) {
  return page.evaluate(
    (markup) => document.body.insertAdjacentHTML("beforeend", markup),
    html,
  );
}

function gearDot(locator) {
  return locator.evaluate(
    (button) => getComputedStyle(button, "::after").content,
  );
}

test("images only hides video, embed and GIF posts in the slideshow and the grid", async ({
  page,
}) => {
  await routeMediaMix(page);
  await openRoutedPage(page, "https://www.reddit.com/r/mix/", mediaMixPosts(), {
    showGifs: false,
    showVideos: false,
  });
  await injectExtension(page);

  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  const gear = page.getByRole("button", { name: "Open presentation settings" });
  await expect(title).toHaveText("First image");
  await expect(count).toHaveText("1 / 2 · images only");
  await expect(page.locator("#redditp-presentation")).toHaveClass(
    /redditp--filtered/,
  );
  await expect(gear).toHaveAttribute(
    "title",
    "Presentation settings (images only)",
  );
  expect(await gearDot(gear)).not.toBe("none");

  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Last image");
  await expect(count).toHaveText(/^2 \/ 2 · images only( · loading more)?$/);
  await expect(page.locator(".redditp__video")).toHaveCount(0);
  await expect(page.locator(".redditp__embed")).toHaveCount(0);

  await page.keyboard.press("v");
  const grid = page.locator(".redditp__grid");
  await expect(grid.locator(".redditp__tile")).toHaveCount(2);
  for (const name of ["First image", "Last image"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // Video tiles are named "…, video", so match the start of the name.
  for (const name of [
    "Party gif",
    "Mix clip",
    "Mix interview",
    "Imgur loop",
    "Mix story",
  ]) {
    await expect(
      grid.getByRole("button", { name: new RegExp(`^${name}`) }),
    ).toHaveCount(0);
  }
  await expect(grid.getByRole("button", { name: /, video$/ })).toHaveCount(0);
  await expect(count).toHaveText(/^2 posts · images only/);

  // With the controls collapsed, the + button carries the dot instead.
  await page.keyboard.press("p");
  expect(
    await gearDot(page.getByRole("button", { name: "Expand bottom controls" })),
  ).not.toBe("none");
});

test("changing the shown types re-filters, keeps a matching slide, and persists", async ({
  page,
}) => {
  await routeMediaMix(page);
  const feedUrl = "https://www.reddit.com/r/mixsettings/";
  // Saved settings that show nothing at all are read as showing everything.
  await openRoutedPage(page, feedUrl, mediaMixPosts(), {
    showImages: false,
    showGifs: false,
    showVideos: false,
  });
  await injectExtension(page);

  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("1 / 7");
  await expect(page.locator("#redditp-presentation")).not.toHaveClass(
    /redditp--filtered/,
  );
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Mix clip");

  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  const images = page.getByLabel("Images", { exact: true });
  const gifs = page.getByLabel("GIFs", { exact: true });
  const videos = page.getByLabel("Videos", { exact: true });
  await expect(images).toBeChecked();
  await expect(gifs).toBeChecked();
  await expect(videos).toBeChecked();

  // The hidden video makes way for the next post that still shows.
  await videos.uncheck();
  await expect(title).toHaveText("Imgur loop");
  await expect(count).toHaveText("3 / 4 · no videos");

  await gifs.uncheck();
  await expect(title).toHaveText("Last image");
  await expect(count).toHaveText(/^2 \/ 2 · images only( · loading more)?$/);
  // The last type shown cannot be turned off.
  await expect(images).toBeChecked();
  await expect(images).toBeDisabled();

  // A current slide that still matches stays, without reloading its image.
  const image = await page.locator(".redditp__image").elementHandle();
  await videos.check();
  await expect(count).toHaveText(/^4 \/ 4 · no GIFs( · loading more)?$/);
  await expect(title).toHaveText("Last image");
  await expect(images).toBeEnabled();
  expect(
    await image.evaluate(
      (element) => element === document.querySelector(".redditp__image"),
    ),
  ).toBe(true);

  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("redditpPresentationSettings")),
  );
  expect(saved).toMatchObject({
    showImages: true,
    showGifs: false,
    showVideos: true,
  });

  // A fresh content script, as on the next page load, reads it back.
  await page.goto(feedUrl);
  await injectExtension(page);
  await expect(count).toHaveText(/^1 \/ 4 · no GIFs/);
});

test("O cycles all, images, GIFs, videos and back", async ({ page }) => {
  await routeMediaMix(page);
  await startPresentation(page, mediaMixPosts());
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("1 / 7");

  await page.keyboard.press("o");
  await expect(count).toHaveText("1 / 2 · images only");
  await expect(title).toHaveText("First image");
  await page.keyboard.press("o");
  await expect(count).toHaveText("1 / 2 · GIFs only");
  await expect(title).toHaveText("Party gif");
  await page.keyboard.press("o");
  await expect(count).toHaveText("1 / 2 · videos only");
  await expect(title).toHaveText("Mix clip");

  await page.keyboard.press("v");
  const grid = page.locator(".redditp__grid");
  await expect(grid.locator(".redditp__tile")).toHaveCount(2);
  for (const name of ["Mix clip, video", "Mix interview, video"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      1,
    );
  }

  await page.keyboard.press("o");
  await expect(count).toHaveText(/^7 posts/);
  await expect(grid.locator(".redditp__tile")).toHaveCount(7);
  await expect(page.locator("#redditp-presentation")).not.toHaveClass(
    /redditp--filtered/,
  );
});

test("a filtered load keeps scrolling past non-matching posts until one matches", async ({
  page,
}) => {
  await routeMediaMix(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/mixload/",
    `${mixVideoPost("opening", "Opening clip")}<div style="height: 4000px"></div>`,
    { showGifs: false, showVideos: false },
  );
  await page.evaluate(() => {
    window.__redditpScrollCalls = 0;
    const originalScrollTo = window.scrollTo.bind(window);
    window.scrollTo = (...args) => {
      window.__redditpScrollCalls += 1;
      originalScrollTo(...args);
    };
  });
  await injectExtension(page);

  const heading = page.locator(".redditp__empty h2");
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(heading).toHaveText("No images here yet");
  await expect(page.locator(".redditp__empty p")).toHaveText(
    "Loading more posts…",
  );
  await expect(count).toHaveText("0 posts · images only · loading more");
  await expect(
    page.getByRole("button", { name: "Open presentation settings" }),
  ).toBeVisible();

  // Hidden posts keep the load going rather than ending it.
  await insertPosts(
    page,
    ["one", "two", "three"]
      .map((id) => mixVideoPost(`hidden${id}`, `Hidden clip ${id}`))
      .join(""),
  );
  await page.waitForTimeout(600);
  await expect(heading).toHaveText("No images here yet");
  expect(
    await page.evaluate(() => window.__redditpScrollCalls),
  ).toBeGreaterThan(0);

  await insertPosts(page, mixImagePost("firstmatch", "First match"));
  await expect(title).toHaveText("First match");
  await expect(count).toHaveText(/^1 \/ 1 · images only/);
  await expect(page.locator(".redditp__video")).toHaveCount(0);

  // Next on the last slide waits for the next match, past hidden posts.
  await page.keyboard.press("ArrowRight");
  await insertPosts(
    page,
    mixVideoPost("hiddenfour", "Hidden clip four") +
      mixVideoPost("hiddenfive", "Hidden clip five"),
  );
  await page.waitForTimeout(400);
  await insertPosts(page, mixImagePost("secondmatch", "Second match"));
  await expect(title).toHaveText("Second match");

  await page.keyboard.press("v");
  await expect(page.locator(".redditp__tile")).toHaveCount(2);
  await expect(
    page.locator(".redditp__grid").getByRole("button", { name: /, video$/ }),
  ).toHaveCount(0);
});

test("a filter with no matches says so and the gear still changes it", async ({
  page,
}) => {
  // A load gives up only after Reddit has added nothing for a while.
  await page.clock.install();
  await routeMediaMix(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/mixempty/",
    `${mixVideoPost("opening", "Opening clip")}<div style="height: 4000px"></div>`,
    { showGifs: false, showVideos: false },
  );
  await injectExtension(page);

  const heading = page.locator(".redditp__empty h2");
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("0 posts · images only · loading more");
  await page.clock.runFor(13_000);
  await expect(heading).toHaveText("Nothing here matches the filter");
  await expect(page.locator(".redditp__empty p")).toHaveText(
    "Only images are shown. Change that in the settings, or press O.",
  );
  await expect(count).toHaveText("0 posts · images only");
  // Controls that need a slide stay out of the way.
  await expect(page.locator(".redditp__link-control:visible")).toHaveCount(0);
  await expect(page.locator(".redditp__view")).toBeHidden();

  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  const videos = page.getByLabel("Videos", { exact: true });
  await videos.check();
  await expect(page.locator(".redditp__title")).toHaveText("Opening clip");
  await expect(count).toHaveText(/^1 \/ 1 · no GIFs( · loading more)?$/);
  await expect(page.locator(".redditp__view")).toBeVisible();

  await videos.uncheck();
  await expect(heading).toHaveText(
    /^(No images here yet|Nothing here matches the filter)$/,
  );
  await expect(page.locator(".redditp__link-control:visible")).toHaveCount(0);
  await expect(page.locator(".redditp__view")).toBeHidden();
});

const filterSearchUrl = "https://www.reddit.com/search/?q=filtersearch";
const filterDetailUrl = (number) =>
  `https://www.reddit.com/r/test/comments/fsearch${number}/post/`;

// Three search results: 1 shows a thumbnail but is a video, 2 shows nothing
// and is a text post, and 3 shows a thumbnail and is an image.
async function routeFilterSearch(page) {
  const requests = new Map();
  const details = {
    1: `<shreddit-post id="t3_fsearch1" post-title="Search result 1" post-type="video" content-href="https://v.redd.it/fsearch1" permalink="/r/test/comments/fsearch1/post/"><shreddit-player src="https://v.redd.it/fsearch1/HLSPlaylist.m3u8" preview="https://v.redd.it/fsearch1/DASH_480.mp4" poster="https://external-preview.redd.it/fsearch1.png"></shreddit-player></shreddit-post>`,
    2: `<shreddit-post id="t3_fsearch2" post-title="Search result 2" post-type="text" permalink="/r/test/comments/fsearch2/post/"><div slot="text-body"><div class="md"><p>Only words here.</p></div></div></shreddit-post>`,
    3: `<shreddit-post id="t3_fsearch3" post-title="Search result 3" content-href="https://i.redd.it/fsearch3.jpg" permalink="/r/test/comments/fsearch3/post/"></shreddit-post>`,
  };
  await page.route("https://external-preview.redd.it/**", (route) =>
    route.fulfill(svgImage(640, 360)),
  );
  await page.route("https://i.redd.it/**", (route) =>
    route.fulfill(svgImage(800, 600)),
  );
  await page.route("https://v.redd.it/**", (route) => route.abort());
  await page.route(
    /^https:\/\/www\.reddit\.com\/r\/test\/comments\/fsearch\d\/post\/$/,
    (route) => {
      const url = route.request().url();
      requests.set(url, (requests.get(url) || 0) + 1);
      const number = Number(url.match(/fsearch(\d)/)[1]);
      return route.fulfill({ contentType: "text/html", body: details[number] });
    },
  );
  const results = [1, 2, 3]
    .map((number) => {
      const url = filterDetailUrl(number);
      const thumbnail =
        number === 2
          ? ""
          : `<a href="${url}" aria-label="Search result ${number} thumbnail image"><faceplate-img data-testid="search_post_thumbnail" src="https://external-preview.redd.it/fsearch${number}-thumb.png" alt="Search result ${number}"></faceplate-img></a>`;
      return `<search-telemetry-tracker data-faceplate-tracking-context='{"post":{"id":"t3_fsearch${number}","title":"Search result ${number}"},"subreddit":{"name":"test"}}'><div data-testid="search-post-unit"><h2><a href="${url}">Search result ${number}</a></h2>${thumbnail}</div></search-telemetry-tracker>`;
    })
    .join("");
  return { requests, results };
}

test("an upgraded search thumbnail that turns out to be a video leaves the images-only grid", async ({
  page,
}) => {
  // A load gives up only after Reddit has added nothing for a while.
  await page.clock.install();
  const { requests, results } = await routeFilterSearch(page);
  await openRoutedPage(page, filterSearchUrl, results, {
    openInGrid: true,
    showGifs: false,
    showVideos: false,
  });
  await injectExtension(page);

  const tiles = page.locator(".redditp__tile");
  const match = page.getByRole("button", {
    name: "Search result 3",
    exact: true,
  });
  await expect(match.locator("img")).toHaveAttribute(
    "src",
    "https://i.redd.it/fsearch3.jpg",
  );
  await expect(tiles).toHaveCount(1);
  await expect(match).not.toHaveAccessibleName(/, video$/);
  await expect(page.locator(".redditp__count")).toHaveText(
    /^1 post · images only/,
  );
  // Focus followed the current tile as the tiles before it left.
  await expect(match).toBeFocused();
  await page.clock.runFor(13_000);
  await expect(page.locator(".redditp__grid-status")).toHaveText(
    "No more images found",
  );
  await expect(tiles).toHaveCount(1);
  expect([...requests.keys()].sort()).toEqual(
    [1, 2, 3].map(filterDetailUrl).sort(),
  );
  expect([...requests.values()]).toEqual([1, 1, 1]);
});

test("the slideshow skips search results whose posts the filter hides", async ({
  page,
}) => {
  const { requests, results } = await routeFilterSearch(page);
  await openRoutedPage(page, filterSearchUrl, results, {
    showGifs: false,
    showVideos: false,
  });
  await injectExtension(page);

  await expect(page.locator(".redditp__image")).toHaveAttribute(
    "src",
    "https://i.redd.it/fsearch3.jpg",
  );
  await expect(page.locator(".redditp__title")).toHaveText("Search result 3");
  await expect(page.locator(".redditp__count")).toHaveText(
    /^1 \/ 1 · images only/,
  );
  await expect(page.locator(".redditp__video")).toHaveCount(0);
  expect([...requests.values()]).toEqual([1, 1, 1]);
});

test("a dormant adaptive video keeps its category after upgrading", async ({
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
    const shadow = player.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.id = "feed-adaptive-video";
    video.addEventListener("click", () => {
      if (!video.getAttribute("src")) {
        video.src = URL.createObjectURL(
          new Blob(["not real media"], { type: "video/mp4" }),
        );
      }
    });
    shadow.append(video);
  });
  await injectExtension(page);
  await expect(page.locator(".redditp__title")).toHaveText("First image");

  const liveVideo = page.locator(".redditp__media #feed-adaptive-video");
  const count = page.locator(".redditp__count");
  for (let press = 0; press < 3; press += 1) await page.keyboard.press("o");
  await expect(liveVideo).toBeVisible();
  await expect(count).toHaveText(/^1 \/ 1 · videos only( · loading more)?$/);

  // Filtering again after the upgrade finds the same slide as a video.
  for (let press = 0; press < 4; press += 1) await page.keyboard.press("o");
  await expect(count).toHaveText(/^1 \/ 1 · videos only( · loading more)?$/);
  await expect(page.locator(".redditp__title")).toHaveText("Feed video");
  await expect(liveVideo).toBeVisible();
});

// Two image posts whose permalinks are absolute, so they resolve even on
// setContent's about:blank.
const newTabPosts = [1, 2]
  .map(
    (number) =>
      `<div class="thing link" data-url="https://i.redd.it/newtab-${number}.jpg" data-permalink="https://www.reddit.com/r/pics/comments/newtab${number}/post/"><a class="title">New tab post ${number}</a></div>`,
  )
  .join("");

// A new tab does not share the page's routes, so the opened URLs are routed
// for the whole context.
async function routeNewTabs(page) {
  await page
    .context()
    .route("https://i.redd.it/**", (route) =>
      route.fulfill(svgImage(800, 600)),
    );
  await page
    .context()
    .route("https://www.reddit.com/r/pics/comments/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "comments page" }),
    );
}

test("middle-click on the slide's picture opens its media in a new tab", async ({
  page,
}) => {
  await routeNewTabs(page);
  await startPresentation(page, newTabPosts);
  const image = page.locator(".redditp__image");
  await expect(image).toHaveAttribute("src", "https://i.redd.it/newtab-1.jpg");

  const [mediaPage] = await Promise.all([
    page.context().waitForEvent("page"),
    image.click({ button: "middle" }),
  ]);
  await mediaPage.waitForLoadState();
  expect(mediaPage.url()).toBe("https://i.redd.it/newtab-1.jpg");
  await mediaPage.close();

  // The slideshow stays where it was.
  await expect(page.locator("#redditp-presentation")).toBeVisible();
  await expect(page.locator(".redditp__title")).toHaveText("New tab post 1");
  await expect(page.locator(".redditp__count")).toHaveText("1 / 2");
});

test("a click on the slide's picture goes back to the grid at that post's tile", async ({
  page,
}) => {
  await routeNewTabs(page);
  await startPresentation(page, newTabPosts);
  const grid = page.locator(".redditp__grid");
  const image = page.locator(".redditp__image");
  await expect(image).toHaveCSS("cursor", "pointer");

  await page.keyboard.press("v");
  await page
    .getByRole("button", { name: "New tab post 2", exact: true })
    .click();
  await expect(grid).toBeHidden();
  await expect(image).toHaveAttribute("src", "https://i.redd.it/newtab-2.jpg");

  await image.click();
  await expect(grid).toBeVisible();
  await expect(page.locator(".redditp__stage")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "New tab post 2", exact: true }),
  ).toBeFocused();
  expect(page.context().pages()).toHaveLength(1);

  // After moving on, the click goes back to the new slide's tile.
  await page.keyboard.press("v");
  await expect(grid).toBeHidden();
  await page.keyboard.press("ArrowLeft");
  await expect(image).toHaveAttribute("src", "https://i.redd.it/newtab-1.jpg");
  await image.click();
  await expect(grid).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New tab post 1", exact: true }),
  ).toBeFocused();
});

test("Ctrl+click on the slide's picture opens it in a new tab and stays in the slideshow", async ({
  page,
}) => {
  await routeNewTabs(page);
  await startPresentation(page, newTabPosts);
  const image = page.locator(".redditp__image");
  await expect(image).toHaveAttribute("src", "https://i.redd.it/newtab-1.jpg");

  const [mediaPage] = await Promise.all([
    page.context().waitForEvent("page"),
    image.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  await mediaPage.waitForLoadState();
  expect(mediaPage.url()).toBe("https://i.redd.it/newtab-1.jpg");
  await mediaPage.close();

  await expect(page.locator(".redditp__grid")).toBeHidden();
  await expect(page.locator(".redditp__stage")).toBeVisible();
  await expect(page.locator(".redditp__title")).toHaveText("New tab post 1");
});

test("a mouse drag across the picture swipes, and never goes to the grid", async ({
  page,
}) => {
  await routeNewTabs(page);
  await startPresentation(page, newTabPosts);
  const grid = page.locator(".redditp__grid");
  const title = page.locator(".redditp__title");
  const image = page.locator(".redditp__image");
  await expect(image).toHaveAttribute("src", "https://i.redd.it/newtab-1.jpg");
  const box = await image.boundingBox();
  const y = box.y + box.height / 2;
  async function drag(fromX, toX) {
    await page.mouse.move(fromX, y);
    await page.mouse.down();
    await page.mouse.move(toX, y, { steps: 5 });
    await page.mouse.up();
  }

  // Too short to swipe, too long to be a click: nothing happens.
  await drag(box.x + box.width / 2, box.x + box.width / 2 - 30);
  await expect(title).toHaveText("New tab post 1");
  await expect(grid).toBeHidden();
  // A swipe back on the first slide goes nowhere, and ends on the same
  // picture it started on, so a click follows it; that is no click.
  await drag(box.x + box.width / 2 - 100, box.x + box.width / 2 + 100);
  await expect(title).toHaveText("New tab post 1");
  await expect(grid).toBeHidden();
  // A swipe forward changes the slide.
  await drag(box.x + box.width / 2 + 100, box.x + box.width / 2 - 100);
  await expect(title).toHaveText("New tab post 2");
  await expect(image).toHaveAttribute("src", "https://i.redd.it/newtab-2.jpg");
  await expect(grid).toBeHidden();

  // The next plain click is a click again.
  await image.click();
  await expect(grid).toBeVisible();
});

test("a click on a slideshow video plays or pauses it and stays in the slideshow", async ({
  page,
}) => {
  await startPresentation(
    page,
    `<div class="thing link" data-url="https://v.redd.it/clickclip" data-permalink="/r/videos/comments/clickclip/post/"><a class="title">Click clip</a><video src="https://v.redd.it/clickclip/DASH_480.mp4" poster="https://external-preview.redd.it/clickclip.png"></video></div>${newTabPosts}`,
  );
  const video = page.locator(".redditp__video");
  await expect(video).toHaveAttribute(
    "src",
    "https://v.redd.it/clickclip/DASH_480.mp4",
  );
  await expect
    .poll(() => video.evaluate((element) => element.paused))
    .toBe(false);
  const box = await video.boundingBox();
  // Well above the browser's control strip.
  const point = { x: box.width / 2, y: box.height / 3 };

  await video.click({ position: point });
  await expect
    .poll(() => video.evaluate((element) => element.paused))
    .toBe(true);
  await expect(page.locator(".redditp__grid")).toBeHidden();
  await expect(page.locator(".redditp__title")).toHaveText("Click clip");

  await video.click({ position: point });
  await expect
    .poll(() => video.evaluate((element) => element.paused))
    .toBe(false);
  await expect(page.locator(".redditp__grid")).toBeHidden();
  await expect(page.locator(".redditp__stage")).toBeVisible();
});

test("Ctrl+click or middle-click on a grid tile opens its media and stays in the grid", async ({
  page,
}) => {
  await routeNewTabs(page);
  await startPresentation(page, newTabPosts);
  await page.keyboard.press("v");
  const grid = page.locator(".redditp__grid");
  const first = page.getByRole("button", {
    name: "New tab post 1",
    exact: true,
  });
  const second = page.getByRole("button", {
    name: "New tab post 2",
    exact: true,
  });
  await expect(second).toBeVisible();

  const [ctrlPage] = await Promise.all([
    page.context().waitForEvent("page"),
    second.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  await ctrlPage.waitForLoadState();
  expect(ctrlPage.url()).toBe("https://i.redd.it/newtab-2.jpg");
  await ctrlPage.close();
  await expect(grid).toBeVisible();
  await expect(page.locator(".redditp__stage")).toBeHidden();

  const [middlePage] = await Promise.all([
    page.context().waitForEvent("page"),
    first.click({ button: "middle" }),
  ]);
  await middlePage.waitForLoadState();
  expect(middlePage.url()).toBe("https://i.redd.it/newtab-1.jpg");
  await middlePage.close();
  await expect(grid).toBeVisible();

  // A plain click still opens the slideshow at that tile.
  await second.click();
  await expect(grid).toBeHidden();
  await expect(page.locator(".redditp__title")).toHaveText("New tab post 2");
  expect(page.context().pages()).toHaveLength(1);
});

test("the title opens the post in a new tab and the presentation stays open", async ({
  page,
}) => {
  await routeNewTabs(page);
  await startPresentation(
    page,
    `${newTabPosts}<div class="thing link" data-url="https://i.redd.it/newtab-3.jpg"><a class="title">Post without comments</a></div>`,
  );
  const titleLink = page.getByRole("link", {
    name: "New tab post 1",
    exact: true,
  });
  await expect(titleLink).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/pics/comments/newtab1/post/",
  );
  await expect(titleLink).toHaveAttribute("target", "_blank");

  const [postPage] = await Promise.all([
    page.context().waitForEvent("page"),
    titleLink.click(),
  ]);
  await postPage.waitForLoadState();
  expect(postPage.url()).toBe(
    "https://www.reddit.com/r/pics/comments/newtab1/post/",
  );
  await postPage.close();
  await expect(page.locator("#redditp-presentation")).toBeVisible();
  await expect(page.locator(".redditp__title")).toHaveText("New tab post 1");

  // A post with no comments link keeps a plain title.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".redditp__title")).toHaveText(
    "Post without comments",
  );
  await expect(page.locator(".redditp__title-link")).toHaveCount(0);
});

// The images, GIFs and videos buttons in the control bar, by exact name so
// the Show checkboxes ("Images", "GIFs", "Videos") never match.
function mediaButtons(page) {
  return ["images", "GIFs", "videos"].map((name) =>
    page.getByRole("button", { name, exact: true }),
  );
}

test("the images, GIFs and videos buttons filter posts and agree with the gear and O", async ({
  page,
}) => {
  await routeMediaMix(page);
  await startPresentation(page, mediaMixPosts());
  const count = page.locator(".redditp__count");
  const [imagesButton, gifsButton, videosButton] = mediaButtons(page);
  await expect(count).toHaveText("1 / 7");
  for (const button of [imagesButton, gifsButton, videosButton]) {
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toBeEnabled();
  }
  await expect(videosButton).toHaveAttribute("title", "Hide videos");

  await videosButton.click();
  await expect(videosButton).toHaveAttribute("aria-pressed", "false");
  await expect(videosButton).toHaveAttribute("title", "Show videos");
  await expect(count).toHaveText("1 / 4 · no videos");

  // The last type shown cannot be turned off.
  await gifsButton.click();
  await expect(gifsButton).toHaveAttribute("aria-pressed", "false");
  await expect(count).toHaveText("1 / 2 · images only");
  await expect(imagesButton).toBeDisabled();
  await expect(imagesButton).toHaveAttribute(
    "title",
    "At least one type stays shown",
  );

  // The gear's Show checkboxes hold the same choice and change the buttons.
  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  const images = page.getByLabel("Images", { exact: true });
  const gifs = page.getByLabel("GIFs", { exact: true });
  const videos = page.getByLabel("Videos", { exact: true });
  await expect(images).toBeChecked();
  await expect(images).toBeDisabled();
  await expect(gifs).not.toBeChecked();
  await expect(videos).not.toBeChecked();
  await videos.check();
  await expect(videosButton).toHaveAttribute("aria-pressed", "true");
  await expect(imagesButton).toBeEnabled();
  await expect(count).toHaveText("1 / 4 · no GIFs");
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();

  // O goes from a mix back to everything, then to images only.
  await page.keyboard.press("o");
  await expect(count).toHaveText("1 / 7");
  for (const button of [imagesButton, gifsButton, videosButton]) {
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  // A focused button that the filter disables hands focus on.
  await imagesButton.focus();
  await page.keyboard.press("o");
  await expect(count).toHaveText("1 / 2 · images only");
  await expect(imagesButton).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Close presentation mode" }),
  ).toBeFocused();

  // The buttons stay in the grid and filter it as well.
  await page.keyboard.press("v");
  const grid = page.locator(".redditp__grid");
  await expect(grid).toBeVisible();
  for (const button of [imagesButton, gifsButton, videosButton]) {
    await expect(button).toBeVisible();
  }
  await expect(grid.locator(".redditp__tile")).toHaveCount(2);
  await gifsButton.click();
  await expect(grid.locator(".redditp__tile")).toHaveCount(4);
  await expect(count).toHaveText(/^4 posts · no videos/);
});

test("the media buttons stay on screen at phone width", async ({ page }) => {
  await routeMediaMix(page);
  async function expectOnScreen(width, height) {
    for (const button of mediaButtons(page)) {
      await expect(button).toBeInViewport();
    }
    const box = await page.locator(".redditp__controls").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    expect(box.height).toBeLessThan(130);
  }

  for (const [width, height] of [
    [360, 780],
    [360, 420],
  ]) {
    await page.setViewportSize({ width, height });
    // setContent keeps the window, and with it the last presentation.
    await page.goto("about:blank");
    await startPresentation(page, mediaMixPosts());
    await expect(page.locator(".redditp__title")).toHaveText("First image");
    await expectOnScreen(width, height);

    await page.keyboard.press("v");
    await expect(page.locator(".redditp__grid")).toBeVisible();
    await expectOnScreen(width, height);

    // A filter that hides every post still leaves the buttons to undo it.
    await openRoutedPage(
      page,
      `https://www.reddit.com/r/mixphone${width}x${height}/`,
      `${mixVideoPost("opening", "Opening clip")}<div style="height: 4000px"></div>`,
      { showGifs: false, showVideos: false },
    );
    await injectExtension(page);
    await expect(page.locator(".redditp__empty h2")).toBeVisible();
    await expect(page.locator(".redditp__count")).toHaveText(
      /^0 posts · images only/,
    );
    await expectOnScreen(width, height);
    await page.getByRole("button", { name: "videos", exact: true }).click();
    await expect(page.locator(".redditp__title")).toHaveText("Opening clip");
  }
});

// Counts the extension's scrolls of the Reddit page in
// window.__redditpScrollCalls. With a template, each scroll also renders it
// at the end of the page, with {n} replaced by start, start + 1 and so on,
// the way an infinite feed renders its next post.
function instrumentScroll(page, { template = "", start = 1 } = {}) {
  return page.evaluate(
    ({ template, start }) => {
      window.__redditpScrollCalls = 0;
      const originalScrollTo = window.scrollTo.bind(window);
      window.scrollTo = (...args) => {
        const number = start + window.__redditpScrollCalls;
        window.__redditpScrollCalls += 1;
        originalScrollTo(...args);
        if (template) {
          document.body.insertAdjacentHTML(
            "beforeend",
            template.replace(/\{n\}/g, String(number)),
          );
        }
      };
    },
    { template, start },
  );
}

function scrollCalls(page) {
  return page.evaluate(() => window.__redditpScrollCalls);
}

// A paused clock fires the load's timers only when a test runs it on.
async function pauseClock(page) {
  await page.clock.install({ time: new Date("2026-08-25T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-08-25T12:00:01Z"));
}

test("a post that arrives six seconds after the scroll still joins", async ({
  page,
}) => {
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/slowfeed/",
    `${gridImagePosts(1)}<div style="height: 4000px"></div>`,
    {},
  );
  await instrumentScroll(page);
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("Post 1");
  await expect(count).toHaveText("1 / 1 · loading more");

  // Reddit is slow to answer; the load keeps nudging it and waiting.
  await page.clock.runFor(6000);
  await expect(count).toHaveText("1 / 1 · loading more");
  expect(await scrollCalls(page)).toBeGreaterThanOrEqual(6);

  await insertPosts(page, gridImagePost(2));
  await expect(count).toHaveText("1 / 2");
  await expect(title).toHaveText("Post 1");
});

test("a feed that adds nothing ends the load after the idle window", async ({
  page,
}) => {
  await pauseClock(page);
  await routeGridImages(page);
  const body = `${gridImagePosts(1)}<div style="height: 4000px"></div>`;
  await openRoutedPage(page, "https://www.reddit.com/r/endedfeed/", body, {});
  // The reader is partway down the Reddit page.
  await page.evaluate(() => window.scrollTo(0, 300));
  await instrumentScroll(page);
  await injectExtension(page);
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("1 / 1 · loading more");

  await page.clock.runFor(11_000);
  await expect(count).toHaveText("1 / 1 · loading more");
  await page.clock.runFor(2000);
  await expect(count).toHaveText("1 / 1");
  const calls = await scrollCalls(page);
  expect(calls).toBeGreaterThanOrEqual(12);
  // The nudge timer stopped with the load.
  await page.clock.runFor(5000);
  expect(await scrollCalls(page)).toBe(calls);

  // The load scrolled Reddit to its end; closing scrolls it back.
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(300);

  // The grid's own load ends the same way.
  await openRoutedPage(page, "https://www.reddit.com/r/endedgrid/", body, {
    openInGrid: true,
  });
  await injectExtension(page);
  const status = page.locator(".redditp__grid-status");
  await expect(status).toHaveText("Loading more posts…");
  await page.clock.runFor(13_000);
  await expect(status).toHaveText("No more posts right now");
  await expect(count).toHaveText("1 post");
});

test("a filtered load gives up after fifteen batches without a match", async ({
  page,
}) => {
  // Paused, so only the posts rendered by each scroll drive the load.
  await pauseClock(page);
  await routeMediaMix(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/hiddenfeed/",
    `${mixVideoPost("opening", "Opening clip")}<div style="height: 4000px"></div>`,
    { showGifs: false, showVideos: false },
  );
  // Every scroll renders one more video post, which images only hides.
  await instrumentScroll(page, {
    template: mixVideoPost("round{n}", "Hidden clip {n}"),
  });
  await injectExtension(page);

  await expect(page.locator(".redditp__empty h2")).toHaveText(
    "Nothing here matches the filter",
  );
  await expect(page.locator(".redditp__count")).toHaveText(
    "0 posts · images only",
  );
  expect(await scrollCalls(page)).toBe(15);
  await expect(page.locator(".thing")).toHaveCount(16);
});

test("closing or refiltering mid-load leaves no observer or timer running", async ({
  page,
}) => {
  await pauseClock(page);
  await routeMediaMix(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/watchfeed/",
    `${mixVideoPost("opening", "Opening clip")}<div style="height: 4000px"></div>`,
    { showGifs: false, showVideos: false },
  );
  await instrumentScroll(page);
  // Counts connected observers of the page body: observe() calls minus
  // disconnect() calls. Playwright's own injected script observes the
  // document, so that one is left out.
  await page.evaluate(() => {
    window.__redditpObserving = 0;
    const PageObserver = window.MutationObserver;
    window.MutationObserver = class extends PageObserver {
      observe(target, options) {
        if (target === document.body) {
          this.watchesBody = true;
          window.__redditpObserving += 1;
        }
        return super.observe(target, options);
      }
      disconnect() {
        if (this.watchesBody) window.__redditpObserving -= 1;
        return super.disconnect();
      }
    };
  });
  await injectExtension(page);
  const observing = () => page.evaluate(() => window.__redditpObserving);
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("0 posts · images only · loading more");
  expect(await observing()).toBe(1);

  // GIFs only hides the clip as well, so a new load takes over.
  await page.keyboard.press("o");
  await expect(count).toHaveText("0 posts · GIFs only · loading more");
  expect(await observing()).toBe(1);

  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  expect(await observing()).toBe(0);
  const calls = await scrollCalls(page);
  await page.clock.runFor(5000);
  expect(await scrollCalls(page)).toBe(calls);
});

test("the slideshow starts loading before its last slide and stays put", async ({
  page,
}) => {
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/aheadfeed/",
    `${gridImagePosts(3)}<div style="height: 4000px"></div>`,
    {},
  );
  await instrumentScroll(page);
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("Post 1");
  // Two slides are left, so a load is already running, in the background.
  await expect(count).toHaveText("1 / 3");
  expect(await scrollCalls(page)).toBeGreaterThan(0);

  await insertPosts(page, gridImagePost(4) + gridImagePost(5));
  await expect(count).toHaveText("1 / 5");
  await expect(title).toHaveText("Post 1");
});

test("background loads stop after four in a row", async ({ page }) => {
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/chainfeed/",
    `${gridImagePosts(1)}<div style="height: 4000px"></div>`,
    {},
  );
  // Every scroll renders the next post, as if Reddit never ran out.
  await instrumentScroll(page, { template: gridImagePost("{n}"), start: 2 });
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("1 / 5");
  await page.waitForTimeout(300);
  expect(await scrollCalls(page)).toBe(4);
  await expect(count).toHaveText("1 / 5");
  await expect(title).toHaveText("Post 1");

  // Moving on starts the next four.
  await page.keyboard.press("ArrowRight");
  await expect(count).toHaveText("2 / 9");
  await expect(title).toHaveText("Post 2");
  await page.waitForTimeout(300);
  expect(await scrollCalls(page)).toBe(8);
});

test("a search the filter ended waits for the last post, and next there wraps at once", async ({
  page,
}) => {
  // Paused, so only the posts rendered by each scroll drive the loads.
  await pauseClock(page);
  await routeMediaMix(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/sparsefeed/",
    `${[1, 2, 3].map((number) => mixImagePost(`sparse${number}`, `Sparse ${number}`)).join("")}<div style="height: 4000px"></div>`,
    { showGifs: false, showVideos: false },
  );
  // Every scroll renders one more video post, which images only hides, the
  // way an endless feed of other media would.
  await instrumentScroll(page, {
    template: mixVideoPost("hidden{n}", "Hidden clip {n}"),
  });
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("Sparse 1");
  // Few slides are left, so a load starts at once. It gives up after
  // fifteen batches without a match, and nothing loads after it.
  await expect.poll(() => scrollCalls(page)).toBe(15);
  await page.waitForTimeout(300);
  expect(await scrollCalls(page)).toBe(15);
  await expect(count).toHaveText("1 / 3 · images only");

  // Moving on leaves Reddit alone until the last post, which looks again.
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Sparse 2");
  await page.waitForTimeout(300);
  expect(await scrollCalls(page)).toBe(15);
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Sparse 3");
  await expect.poll(() => scrollCalls(page)).toBe(30);
  await page.waitForTimeout(300);
  expect(await scrollCalls(page)).toBe(30);
  await expect(count).toHaveText("3 / 3 · images only");

  // That search found nothing either, so next wraps without another.
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Sparse 1");
  await expect(count).toHaveText("1 / 3 · images only");
  await page.waitForTimeout(300);
  expect(await scrollCalls(page)).toBe(30);

  // A filter change searches afresh, once.
  await page.keyboard.press("o");
  await expect(page.locator(".redditp__empty h2")).toHaveText(
    "Nothing here matches the filter",
  );
  await expect(count).toHaveText("0 posts · GIFs only");
  expect(await scrollCalls(page)).toBe(45);
});

// Ten posts: a picture, a Reddit video with a poster, a YouTube embed, and
// seven more pictures. Pictures are "<prefix>-<post number>.jpg", so two pages
// never share a URL. The player is Reddit's own custom element, which fetches
// nothing by itself.
function aheadPosts(prefix) {
  const picture = (number) =>
    `<div class="thing link" data-url="https://i.redd.it/${prefix}-${number}.jpg" data-permalink="/r/ahead/comments/${prefix}${number}/post/"><a class="title">Picture ${number}</a></div>`;
  return [
    picture(1),
    `<shreddit-post id="t3_${prefix}2" post-title="Ahead clip" post-type="video" content-href="https://v.redd.it/${prefix}clip" permalink="/r/ahead/comments/${prefix}2/post/"><shreddit-player src="https://v.redd.it/${prefix}clip/HLSPlaylist.m3u8" preview="https://v.redd.it/${prefix}clip/DASH_480.mp4" poster="https://external-preview.redd.it/${prefix}clip.png"></shreddit-player></shreddit-post>`,
    `<shreddit-post id="t3_${prefix}3" post-title="Ahead interview" content-href="https://www.youtube.com/watch?v=l74r1s8y7uY" permalink="/r/ahead/comments/${prefix}3/post/"></shreddit-post>`,
    ...[4, 5, 6, 7, 8, 9, 10].map(picture),
  ].join("");
}

test("the next six pictures load ahead, and the filter is respected", async ({
  page,
}) => {
  const requested = new Set();
  await page.route(
    /^https:\/\/(i\.redd\.it|external-preview\.redd\.it)\//,
    (route) => {
      requested.add(route.request().url());
      return route.fulfill(svgImage(800, 600));
    },
  );
  await page.route("https://v.redd.it/**", (route) =>
    fulfillSilentVideo(route),
  );
  await page.route("https://www.youtube.com/**", (route) => route.abort());
  const expectRequested = (url) =>
    expect.poll(() => requested.has(url), { message: url }).toBe(true);
  const title = page.locator(".redditp__title");

  await openRoutedPage(
    page,
    "https://www.reddit.com/r/aheadall/",
    aheadPosts("all"),
    {},
  );
  await injectExtension(page);
  await expect(title).toHaveText("Picture 1");
  // The next six slides are the video, the embed, and pictures 4 to 7.
  await expectRequested("https://external-preview.redd.it/allclip.png");
  for (const number of [4, 5, 6, 7]) {
    await expectRequested(`https://i.redd.it/all-${number}.jpg`);
  }
  await page.waitForTimeout(300);
  expect(requested.has("https://i.redd.it/all-8.jpg")).toBe(false);
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Ahead clip");
  await expectRequested("https://i.redd.it/all-8.jpg");

  // With images only, the next six are pictures 4 to 9, and the hidden
  // video's poster is left alone.
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/aheadimages/",
    aheadPosts("only"),
    { showGifs: false, showVideos: false },
  );
  await injectExtension(page);
  await expect(title).toHaveText("Picture 1");
  for (const number of [4, 5, 6, 7, 8, 9]) {
    await expectRequested(`https://i.redd.it/only-${number}.jpg`);
  }
  await page.waitForTimeout(300);
  expect(requested.has("https://i.redd.it/only-10.jpg")).toBe(false);
  expect(requested.has("https://external-preview.redd.it/onlyclip.png")).toBe(
    false,
  );
});

test("the slideshow reads the next two Reddit videos in ahead, plays them from there with its usual sound, and lets them go once behind", async ({
  page,
}) => {
  const clipA = "https://v.redd.it/warma/DASH_480.mp4";
  const clipB = "https://preview.redd.it/warmb.gif?format=mp4&s=b";
  const clipC = "https://v.redd.it/warmc/DASH_480.mp4";
  const elsewhere = "https://videohost.example/warm.mp4";
  const requested = [];
  await page.route(/^https:\/\/(?:v|preview)\.redd\.it\/warm/, (route) => {
    requested.push(route.request().url());
    return fulfillSilentVideo(route);
  });
  await page.route("https://videohost.example/**", (route) => {
    requested.push(route.request().url());
    return fulfillSilentVideo(route);
  });
  const clip = (number, title, url) =>
    gridSlide(number, {
      title,
      kind: "video",
      url,
      poster: `https://external-preview.redd.it/warm${number}.png`,
    });
  const slides = [
    gridSlide(1, { title: "Picture 1" }),
    clip(2, "Clip A", clipA),
    gridSlide(3, { title: "Picture 3" }),
    clip(4, "Clip B", clipB),
    clip(5, "Clip C", clipC),
    clip(6, "Clip elsewhere", elsewhere),
  ];
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/warmsource/",
    '<meta name="redditp-host" content="test">',
    { sound: true },
  );
  // Every video element made, in order.
  await page.evaluate(() => {
    window.madeVideos = [];
    const create = document.createElement.bind(document);
    document.createElement = (name, options) => {
      const made = create(name, options);
      if (String(name).toLowerCase() === "video") window.madeVideos.push(made);
      return made;
    };
  });
  await injectExtension(page);
  await page.evaluate((list) => {
    window.__redditpPresentation.open({
      kind: "test",
      start: () => Promise.resolve({ slides: list }),
      loadMore: () => Promise.resolve({ slides: [] }),
      hasMore: () => false,
    });
  }, slides);
  const title = page.locator(".redditp__title");
  await expect(title).toHaveText("Picture 1");
  // The videos in no document, each as the latest one made for its file
  // left it.
  const warm = () =>
    page.evaluate(() => {
      const latest = new Map();
      window.madeVideos.forEach((video) => {
        const src = video.getAttribute("src");
        if (src) latest.set(src, video);
      });
      return Array.from(latest.values())
        .filter((video) => !video.isConnected)
        .map((video) => ({
          src: video.getAttribute("src"),
          preload: video.preload,
          muted: video.muted,
          paused: video.paused,
        }));
    });
  // The first two videos among the next six slides, and not the one on
  // another host.
  await expect.poll(warm).toEqual([
    { src: clipA, preload: "auto", muted: true, paused: true },
    { src: clipB, preload: "auto", muted: true, paused: true },
  ]);
  await expect.poll(() => requested.includes(clipA)).toBe(true);
  await expect.poll(() => requested.includes(clipB)).toBe(true);
  // The slideshow's video is the one read in, and plays with sound, as the
  // settings say.
  const shownIsWarm = (src) =>
    page.evaluate(
      (value) =>
        document.querySelector(".redditp__video") ===
        window.madeVideos.find((video) => video.getAttribute("src") === value),
      src,
    );
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Clip A");
  expect(await shownIsWarm(clipA)).toBe(true);
  const shown = page.locator(".redditp__video");
  await expect
    .poll(() => shown.evaluate((video) => [video.paused, video.muted]))
    .toEqual([false, false]);
  expect(
    await shown.evaluate((video) => [
      video.controls,
      video.className,
      video.poster,
    ]),
  ).toEqual([
    true,
    "redditp__video",
    "https://external-preview.redd.it/warm2.png",
  ]);
  await expect
    .poll(async () => (await warm()).map((video) => video.src))
    .toEqual([clipB, clipC]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Clip B");
  expect(await shownIsWarm(clipB)).toBe(true);
  // Back at the start, the video no longer ahead is let go.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText("Picture 1");
  expect(
    await page.evaluate(
      (value) =>
        window.madeVideos
          .filter((video) => !video.isConnected)
          .some((video) => video.getAttribute("src") === value),
      clipC,
    ),
  ).toBe(false);
  expect(requested).not.toContain(elsewhere);
});

test("the preload cache keeps twelve pictures and is dropped on close", async ({
  page,
}) => {
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/cachefeed/",
    gridImagePosts(24),
    {},
  );
  // Records every picture fetched ahead, which the extension creates with
  // new Image(); the slideshow's own pictures are elements it creates.
  await page.evaluate(() => {
    window.__redditpPreloaded = [];
    const PageImage = window.Image;
    window.Image = function (...args) {
      const image = new PageImage(...args);
      window.__redditpPreloaded.push(image);
      return image;
    };
  });
  await injectExtension(page);
  const preloaded = () =>
    page.evaluate(() =>
      window.__redditpPreloaded.map(
        (image) => image.src.match(/grid-(\d+)\.jpg$/)[1],
      ),
    );
  const title = page.locator(".redditp__title");
  await expect(title).toHaveText("Post 1");
  for (let press = 0; press < 10; press += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(title).toHaveText("Post 11");
  for (let press = 0; press < 10; press += 1) {
    await page.keyboard.press("ArrowLeft");
  }
  await expect(title).toHaveText("Post 1");
  // Pictures 2 to 17 were fetched once on the way; 2 to 5 then fell out of
  // the twelve kept and were fetched again on the way back.
  const created = await preloaded();
  expect(created).toHaveLength(20);
  for (const number of ["2", "3", "4", "5"]) {
    expect(created.filter((item) => item === number)).toHaveLength(2);
  }
  expect(created.filter((item) => item === "6")).toHaveLength(1);

  // Closing drops the cache, so the next open fetches ahead afresh.
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(title).toHaveText("Post 1");
  await expect.poll(async () => (await preloaded()).length).toBe(26);
  expect((await preloaded()).slice(20)).toEqual(["2", "3", "4", "5", "6", "7"]);
});

// Opens the grid on a source that hands over `start` at once, then `batch`
// posts of `pool` each time the viewer asks for more, as long as it has any.
// window.gridLoadMores counts the asking. `settings` add to the saved
// settings.
async function openPooledGridSource(page, start, pool, batch, settings = {}) {
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/gridsource/",
    '<meta name="redditp-host" content="test">',
    { openInGrid: true, ...settings },
  );
  await injectExtension(page);
  await page.evaluate(
    (value) => {
      window.gridLoadMores = 0;
      let given = 0;
      window.__redditpPresentation.open({
        kind: "test",
        start: () => Promise.resolve({ slides: value.start }),
        loadMore: () => {
          window.gridLoadMores += 1;
          const slides = value.pool.slice(given, given + value.batch);
          given += slides.length;
          return Promise.resolve({ slides });
        },
        hasMore: () => given < value.pool.length,
      });
    },
    { start, pool, batch },
  );
  await expect(page.locator(".redditp__grid")).toBeVisible();
}

// Image posts of the grid source numbered from `first`, `count` of them, in
// the shape of the picture that the media hosts answer with, so that no tile
// moves as the pictures arrive.
function gridSlides(first, count) {
  return Array.from({ length: count }, (_, index) =>
    gridSlide(first + index, { width: 800, height: 600 }),
  );
}

const gridLoadMores = (page) => page.evaluate(() => window.gridLoadMores);

test("the grid starts loading within eight screens of its end", async ({
  page,
}) => {
  // 4 columns of tiles 240 pixels apart: 120 posts are 10 screens.
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPooledGridSource(page, gridSlides(1, 120), gridSlides(121, 400), 8);
  const grid = page.locator(".redditp__grid");
  await expect(gridTile(page, "Grid slide 120")).toBeAttached();
  await page.waitForTimeout(500);
  expect(await gridLoadMores(page)).toBe(0);
  // A screen and a half down, the end comes within eight screens below the
  // view, and a load brings it back out of reach.
  await grid.evaluate((element) => {
    element.scrollTop = element.clientHeight * 1.5;
  });
  await expect.poll(() => gridLoadMores(page)).toBe(1);
  await expect(gridTile(page, "Grid slide 128")).toBeAttached();
  await page.waitForTimeout(500);
  expect(await gridLoadMores(page)).toBe(1);
  expect(await grid.evaluate((element) => element.scrollTop)).toBe(1080);
});

test("the grid loads at most six times in a row by itself, then again once scrolled half a screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // Batches too small to fill eight screens in six loads.
  await openPooledGridSource(page, gridSlides(1, 16), gridSlides(17, 400), 8);
  const grid = page.locator(".redditp__grid");
  await expect.poll(() => gridLoadMores(page)).toBe(6);
  await page.waitForTimeout(500);
  expect(await gridLoadMores(page)).toBe(6);
  await expect(page.locator(".redditp__grid .redditp__tile")).toHaveCount(64);
  await expect(page.locator(".redditp__grid-status")).toBeHidden();
  const scrollTo = (screens) =>
    grid.evaluate((element, value) => {
      element.scrollTop = element.clientHeight * value;
    }, screens);
  // A little scrolling is not enough.
  await scrollTo(0.3);
  await page.waitForTimeout(500);
  expect(await gridLoadMores(page)).toBe(6);
  // Half a screen starts another row of six.
  await scrollTo(0.6);
  await expect.poll(() => gridLoadMores(page)).toBe(12);
  await page.waitForTimeout(500);
  expect(await gridLoadMores(page)).toBe(12);
});

test("a Show filter that the grid's new posts never match stops after fifteen batches", async ({
  page,
}) => {
  // Images only, and the source has nothing but videos after its first
  // posts, without end.
  const hidden = Array.from({ length: 400 }, (_, index) =>
    gridSlide(index + 5, {
      kind: "video",
      url: `https://v.redd.it/hidden${index + 5}/DASH_480.mp4`,
      title: `Hidden clip ${index + 5}`,
    }),
  );
  await openPooledGridSource(page, gridSlides(1, 4), hidden, 4, {
    showGifs: false,
    showVideos: false,
  });
  await expect.poll(() => gridLoadMores(page)).toBe(15);
  await expect(page.locator(".redditp__grid-status")).toHaveText(
    /^No more images/,
  );
  await page.waitForTimeout(500);
  expect(await gridLoadMores(page)).toBe(15);
  await expect(page.locator(".redditp__grid .redditp__tile")).toHaveCount(4);
});

test("next on the last slide wraps at once when the feed has ended", async ({
  page,
}) => {
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/endedpair/",
    `${gridImagePosts(2)}<div style="height: 4000px"></div>`,
    {},
  );
  await instrumentScroll(page);
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  // Two posts are few enough to start loading from the first.
  await expect(count).toHaveText("1 / 2");
  await page.keyboard.press("ArrowRight");
  await expect(count).toHaveText("2 / 2 · loading more");
  await page.clock.runFor(13_000);
  await expect(count).toHaveText("2 / 2");
  const calls = await scrollCalls(page);

  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Post 1");
  await expect(count).toHaveText("1 / 2");
  expect(await scrollCalls(page)).toBe(calls);
});

// A page that hosts the viewer says so in a meta tag, so the viewer waits
// for the page to hand it a source of posts. window.makeTestSource({ total,
// batch, urls }) builds one that hands over `total` image posts, `batch` at a
// time, and records what the viewer asks of it: its `calls`, the posts the
// slideshow showed (`shown`) and dropped (`dead`), and how often the viewer
// closed (`closes`).
async function hostPage(page) {
  await page.setContent(
    '<meta name="redditp-host" content="test"><base href="https://www.reddit.com/">',
  );
  await page.addStyleTag({ path: extensionStyles });
  await page.addScriptTag({ path: extensionScript });
  await page.evaluate(() => {
    window.makeTestSource = ({ total, batch, urls }) => {
      let given = 0;
      function nextBatch() {
        const slides = [];
        while (slides.length < batch && given < total) {
          given += 1;
          slides.push({
            kind: "image",
            url: urls?.[given - 1] || `https://i.redd.it/source-${given}.jpg`,
            title: `Source ${given}`,
            postKey: `t3_source${given}`,
            commentsUrl: `https://www.reddit.com/r/sourcetest/comments/source${given}/post/`,
            author: "u/tester",
            community: "r/sourcetest",
          });
        }
        return Promise.resolve({ slides });
      }
      const source = {
        kind: "test",
        calls: [],
        shown: [],
        dead: [],
        closes: 0,
        start() {
          source.calls.push("start");
          return nextBatch();
        },
        loadMore() {
          source.calls.push("loadMore");
          return nextBatch();
        },
        hasMore: () => given < total,
        onDead(slide) {
          source.dead.push(slide.postKey);
        },
        onShow(slide) {
          source.shown.push(slide.postKey);
        },
        onClose() {
          source.closes += 1;
        },
      };
      return source;
    };
  });
}

// Opens the hosted viewer on a test source, kept as window.testSource.
function openTestSource(page, options) {
  return page.evaluate((value) => {
    window.testSource = window.makeTestSource(value);
    window.__redditpPresentation.open(window.testSource);
  }, options);
}

// What the test source has recorded so far.
function testSourceLog(page) {
  return page.evaluate(() => {
    const { calls, shown, dead, closes } = window.testSource;
    return { calls, shown, dead, closes };
  });
}

test("a page that hosts the viewer keeps it closed until it hands over a source", async ({
  page,
}) => {
  await hostPage(page);
  await expect(page.locator("#redditp-presentation")).toHaveCount(1);
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await instrumentScroll(page);

  await openTestSource(page, { total: 30, batch: 10 });
  const count = page.locator(".redditp__count");
  await expect(page.locator(".redditp__title")).toHaveText("Source 1");
  await expect(count).toHaveText("1 / 10");
  for (let press = 0; press < 3; press += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(page.locator(".redditp__title")).toHaveText("Source 4");
  await expect(count).toHaveText("4 / 20");
  // The source hands its posts over; nothing scrolls the page to find more.
  expect(await scrollCalls(page)).toBe(0);
  expect((await testSourceLog(page)).calls).toEqual(["start", "loadMore"]);
});

test("a finished source never waits: next on the last slide wraps at once", async ({
  page,
}) => {
  // Paused, so any wait for more posts would never end.
  await pauseClock(page);
  await hostPage(page);
  await openTestSource(page, { total: 3, batch: 3 });
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("1 / 3");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Source 3");
  await expect(count).toHaveText("3 / 3");

  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Source 1");
  await expect(count).toHaveText("1 / 3");

  await page.keyboard.press("v");
  await expect(page.locator(".redditp__grid-status")).toHaveText(
    "No more posts right now",
  );
  await expect(count).toHaveText("3 posts");
  expect((await testSourceLog(page)).calls).toEqual(["start"]);
});

test("posts from another source open their Reddit links in a new tab", async ({
  page,
}) => {
  const communityUrl = "https://www.reddit.com/r/sourcetest/?redditp=1";
  await page
    .context()
    .route(communityUrl, (route) =>
      route.fulfill({ contentType: "text/html", body: "<main>Feed</main>" }),
    );
  await hostPage(page);
  await openTestSource(page, { total: 3, batch: 3 });
  const communityLink = page.getByRole("link", {
    name: "r/sourcetest",
    exact: true,
  });
  const authorLink = page.getByRole("link", { name: "u/tester", exact: true });
  await expect(communityLink).toHaveAttribute("href", communityUrl);
  await expect(communityLink).toHaveAttribute("target", "_blank");
  await expect(authorLink).toHaveAttribute(
    "href",
    "https://www.reddit.com/user/tester/?redditp=1",
  );
  await expect(authorLink).toHaveAttribute("target", "_blank");

  const [feedPage] = await Promise.all([
    page.context().waitForEvent("page"),
    communityLink.click(),
  ]);
  await feedPage.waitForLoadState();
  expect(feedPage.url()).toBe(communityUrl);
  await feedPage.close();
  // The page that hosts the viewer stays where it was.
  await expect(page.locator("#redditp-presentation")).toBeVisible();
  await expect(page.locator(".redditp__title")).toHaveText("Source 1");
});

test("a source hears which slide shows and when the viewer closes", async ({
  page,
}) => {
  await hostPage(page);
  await openTestSource(page, { total: 3, batch: 3 });
  const title = page.locator(".redditp__title");
  await expect(title).toHaveText("Source 1");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Source 2");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Source 3");
  expect(await testSourceLog(page)).toMatchObject({
    shown: ["t3_source1", "t3_source2", "t3_source3"],
    closes: 0,
  });

  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  expect((await testSourceLog(page)).closes).toBe(1);
});

test("links a source cannot vouch for are dropped", async ({ page }) => {
  await hostPage(page);
  await page.evaluate(() =>
    window.__redditpPresentation.open({
      kind: "test",
      start: () =>
        Promise.resolve({
          slides: [
            {
              kind: "link",
              url: "javascript:alert(1)",
              commentsUrl: "javascript:alert(2)",
              sourceUrl: "/r/sourcetest/comments/unsafe/post/",
              title: "Unsafe link",
              postKey: "t3_unsafe",
            },
          ],
        }),
      loadMore: () => Promise.resolve({ slides: [] }),
      hasMore: () => false,
    }),
  );
  await expect(page.locator(".redditp__title")).toHaveText("Unsafe link");
  await expect(page.locator(".redditp__title-link")).toHaveCount(0);
  const card = page.locator(".redditp__link-card");
  await expect(card).toBeVisible();
  // Neither the javascript: URLs nor the relative one survive.
  await expect(card).toHaveAttribute("href", "");
  await expect(page.locator("a[href^='javascript:' i]")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "comments", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "media", exact: true }),
  ).toHaveCount(0);
});

// Opens the hosted viewer on a source whose batches wait until the test
// releases them, in order, with window.releaseBatch(slides).
// window.pendingBatches() says how many loads are waiting.
function openHeldSource(page, { first, text }) {
  return page.evaluate(
    ({ first, text }) => {
      const waiting = [];
      window.pendingBatches = () => waiting.length;
      window.releaseBatch = (slides) => waiting.shift()({ slides });
      const held = () => new Promise((resolve) => waiting.push(resolve));
      window.__redditpPresentation.open({
        kind: "test",
        text,
        start: () => (first ? Promise.resolve({ slides: first }) : held()),
        loadMore: held,
        hasMore: () => true,
      });
    },
    { first, text },
  );
}

test("a batch that arrives after a filter change still joins and shows", async ({
  page,
}) => {
  await hostPage(page);
  await openHeldSource(page, {
    first: [
      {
        kind: "video",
        url: "https://v.redd.it/heldclip/DASH_480.mp4",
        title: "Opening clip",
        postKey: "t3_heldclip",
      },
    ],
  });
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("Opening clip");
  // The only slide is the last one, so a load is already waiting.
  await expect.poll(() => page.evaluate(() => window.pendingBatches())).toBe(1);

  // Images only hides the clip; a new load takes over from the first.
  await page.keyboard.press("o");
  await expect(page.locator(".redditp__empty h2")).toHaveText(
    "No images here yet",
  );
  await expect.poll(() => page.evaluate(() => window.pendingBatches())).toBe(2);

  // The first load's batch still arrives, with the first picture to show.
  await page.evaluate(() =>
    window.releaseBatch([
      {
        kind: "image",
        url: "https://i.redd.it/held-picture.jpg",
        postMedia: true,
        title: "Late picture",
        postKey: "t3_heldpicture",
      },
    ]),
  );
  await expect(title).toHaveText("Late picture");
  await expect(count).toHaveText("1 / 1 · images only · loading more");

  // The newer load finds nothing more and ends.
  await page.evaluate(() => window.releaseBatch([]));
  await expect(count).toHaveText("1 / 1 · images only");
  await expect(title).toHaveText("Late picture");
});

test("a source can put the empty stage in its own words", async ({ page }) => {
  await hostPage(page);
  await openHeldSource(page, {
    text: {
      preparing: ["Opening the archive", "Reading the first posts…"],
      empty: ["Nothing archived yet", "Try a wider date range."],
    },
  });
  const heading = page.locator(".redditp__empty h2");
  const text = page.locator(".redditp__empty p");
  await expect(heading).toHaveText("Opening the archive");
  await expect(text).toHaveText("Reading the first posts…");

  // The first batch is empty; the next load finds nothing either.
  await page.evaluate(() => window.releaseBatch([]));
  await expect(heading).toHaveText("Nothing archived yet");
  await expect(text).toHaveText("Try a wider date range.");
});

// Old Reddit image posts, each "<title>" linking "https://<host>/<file>".
function deadMediaPosts(posts) {
  return posts
    .map(
      ([title, url], index) =>
        `<div class="thing link" data-url="${url}" data-permalink="/r/pics/comments/dead${index}/post/"><a class="title">${title}</a></div>`,
    )
    .join("");
}

test("a picture that fails to load is dropped, counted, and skipped after reopening", async ({
  page,
}) => {
  let deadRequests = 0;
  await page.route("https://i.redd.it/dead-two.jpg", (route) => {
    deadRequests += 1;
    return route.abort();
  });
  await startPresentation(
    page,
    deadMediaPosts([
      ["First post", "https://i.redd.it/dead-one.jpg"],
      ["Second post", "https://i.redd.it/dead-two.jpg"],
      ["Third post", "https://i.redd.it/dead-three.jpg"],
    ]),
  );
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("First post");
  await expect(count).toHaveText("1 / 3");

  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Third post");
  await expect(count).toHaveText(/^2 \/ 2 · 1 unavailable( · loading more)?$/);
  await expect(page.locator(".redditp__link-card")).toHaveCount(0);

  // The failure is remembered, so the next open leaves the picture out. A
  // reopen keeps the slide it was on, so go back to the first one first.
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText("First post");
  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  const requestsBefore = deadRequests;
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(count).toHaveText(/^1 \/ 2 · 1 unavailable/);
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Third post");
  // Neither the slideshow nor its look-ahead asked for the picture again.
  expect(deadRequests).toBe(requestsBefore);
});

test("deleted Reddit-hosted and imgur pictures are recognised by their placeholder size", async ({
  page,
}) => {
  for (const [url, width, height] of [
    ["https://i.redd.it/gone.jpg", 130, 60],
    ["https://i.imgur.com/kept.jpg", 161, 80],
    ["https://i.imgur.com/removed1.jpg", 161, 81],
    ["https://preview.redd.it/gone-preview.jpg", 130, 60],
    ["https://i.redd.it/last.jpg", 800, 600],
  ]) {
    await page.route(url, (route) => route.fulfill(svgImage(width, height)));
  }
  await startPresentation(
    page,
    deadMediaPosts([
      ["Gone", "https://i.redd.it/gone.jpg"],
      ["Kept", "https://i.imgur.com/kept.jpg"],
      ["Removed", "https://i.imgur.com/removed1.jpg"],
      ["Preview gone", "https://preview.redd.it/gone-preview.jpg"],
      ["Last", "https://i.redd.it/last.jpg"],
    ]),
  );
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("Kept");
  await expect(count).toHaveText(/^1 \/ 4 · 1 unavailable/);
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Last");
  await expect(count).toHaveText(/^2 \/ 2 · 3 unavailable( · loading more)?$/);
  await expect(page.locator(".redditp__link-card")).toHaveCount(0);
});

test("a grid tile whose picture fails leaves the grid; a failed poster keeps its card", async ({
  page,
}) => {
  await page.route("https://i.redd.it/grid-broken.jpg", (route) =>
    route.abort(),
  );
  await page.route("https://external-preview.redd.it/deadclip.png", (route) =>
    route.abort(),
  );
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/deadgrid/",
    `${deadMediaPosts([
      ["Good image", "https://i.redd.it/grid-good.jpg"],
      ["Broken image", "https://i.redd.it/grid-broken.jpg"],
    ])}<div class="thing link" data-url="https://v.redd.it/deadclip" data-permalink="/r/deadgrid/comments/clip/post/"><a class="title">Clip</a><video src="https://v.redd.it/deadclip/DASH_480.mp4" poster="https://external-preview.redd.it/deadclip.png"></video></div>`,
    { openInGrid: true },
  );
  await injectExtension(page);
  const grid = page.locator(".redditp__grid");
  const clip = grid.getByRole("button", { name: "Clip, video", exact: true });
  await expect(
    grid.getByRole("button", { name: "Good image", exact: true }),
  ).toBeVisible();
  await expect(clip.locator(".redditp__tile-kind")).toHaveText("Video");
  await expect(
    grid.getByRole("button", { name: "Broken image", exact: true }),
  ).toHaveCount(0);
  await expect(grid.locator(".redditp__tile")).toHaveCount(2);
  await expect(page.locator(".redditp__count")).toHaveText(
    /^2 posts · 1 unavailable/,
  );
});

test("a search thumbnail that fails keeps its card until its post is read", async ({
  page,
}) => {
  const postUrl = "https://www.reddit.com/r/test/comments/deadthumb/post/";
  const thumbnailUrl = "https://external-preview.redd.it/deadthumb.png";
  let detailRequests = 0;
  await page.route(thumbnailUrl, (route) => route.abort());
  await page.route(postUrl, (route) => {
    detailRequests += 1;
    return route.fulfill({ status: 500, contentType: "text/html", body: "" });
  });
  await startPresentation(
    page,
    `<search-telemetry-tracker data-faceplate-tracking-context='{"post":{"id":"t3_deadthumb","title":"Thumbnail result"},"subreddit":{"name":"test"}}'><div data-testid="search-post-unit"><h2><a href="${postUrl}">Thumbnail result</a></h2><a href="${postUrl}" aria-label="Thumbnail result thumbnail image"><faceplate-img data-testid="search_post_thumbnail" src="${thumbnailUrl}" alt="Thumbnail result"></faceplate-img></a></div></search-telemetry-tracker>`,
  );
  await expect(page.locator(".redditp__title")).toHaveText("Thumbnail result");
  await expect(page.locator(".redditp__link-icon")).toHaveText(
    "Image unavailable",
  );
  // Reading the post failed as well, so the card stays.
  await expect.poll(() => detailRequests).toBe(1);
  await expect(page.locator(".redditp__link-icon")).toHaveText(
    "Image unavailable",
  );
  await expect(page.locator(".redditp__count")).not.toContainText(
    "unavailable",
  );
});

test("a failed picture from another source is reported to that source", async ({
  page,
}) => {
  await page.route("https://i.redd.it/source-dead.jpg", (route) =>
    route.abort(),
  );
  await hostPage(page);
  await openTestSource(page, {
    total: 3,
    batch: 3,
    urls: [
      "https://i.redd.it/source-ok-1.jpg",
      "https://i.redd.it/source-dead.jpg",
      "https://i.redd.it/source-ok-3.jpg",
    ],
  });
  const title = page.locator(".redditp__title");
  await expect(title).toHaveText("Source 1");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Source 3");
  await expect(page.locator(".redditp__count")).toContainText(
    "· 1 unavailable",
  );
  expect((await testSourceLog(page)).dead).toEqual(["t3_source2"]);
});

test("a page whose every picture failed goes looking for more posts", async ({
  page,
}) => {
  await pauseClock(page);
  // The picture fails only when the test says so.
  let heldPicture = null;
  await page.route("https://i.redd.it/lonely.jpg", (route) => {
    heldPicture = route;
  });
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/lonelyfeed/",
    `${deadMediaPosts([["Lonely picture", "https://i.redd.it/lonely.jpg"]])}<div style="height: 4000px"></div>`,
    {},
  );
  await instrumentScroll(page);
  await injectExtension(page);
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("1 / 1 · loading more");
  // The feed ends first.
  await page.clock.runFor(13_000);
  await expect(count).toHaveText("1 / 1");
  await expect.poll(() => heldPicture !== null).toBe(true);
  const calls = await scrollCalls(page);

  await heldPicture.abort();
  await expect(page.locator(".redditp__empty h2")).toHaveText(
    "Nothing here could be loaded",
  );
  await expect(page.locator(".redditp__empty p")).toHaveText(
    "Loading more posts…",
  );
  await expect(count).toHaveText("0 posts · 1 unavailable · loading more");
  expect(await scrollCalls(page)).toBeGreaterThan(calls);

  await insertPosts(page, gridImagePost(1));
  await expect(page.locator(".redditp__title")).toHaveText("Post 1");
  await expect(count).toHaveText(/^1 \/ 1 · 1 unavailable( · loading more)?$/);
});

test("media a source left out counts, and an empty stage says it failed", async ({
  page,
}) => {
  await page.route("https://i.redd.it/only-dead.jpg", (route) => route.abort());
  await hostPage(page);
  await page.evaluate(() => {
    window.sourceCalls = [];
    window.__redditpPresentation.open({
      kind: "test",
      start: () =>
        Promise.resolve({
          slides: [
            {
              kind: "image",
              url: "https://i.redd.it/only-dead.jpg",
              postMedia: true,
              title: "Only picture",
              postKey: "t3_onlydead",
            },
          ],
          unavailable: 2,
        }),
      loadMore: () => {
        window.sourceCalls.push("loadMore");
        return Promise.resolve({ slides: [] });
      },
      hasMore: () => false,
    });
  });
  await expect(page.locator(".redditp__empty h2")).toHaveText(
    "Nothing here could be loaded",
  );
  await expect(page.locator(".redditp__empty p")).toHaveText(
    "3 pictures or videos failed to load.",
  );
  await expect(page.locator(".redditp__count")).toHaveText(
    "0 posts · 3 unavailable",
  );
  // The source has nothing more, so the empty stage asks it for nothing.
  expect(await page.evaluate(() => window.sourceCalls)).toEqual([]);
});

// Stands in for the installed extension's messaging, which records what the
// page sends in window.__redditpMessages. It has no storage, so settings fall
// back to localStorage.
function stubExtensionRuntime(page) {
  return page.evaluate(() => {
    window.chrome = {
      runtime: {
        sendMessage(message) {
          (window.__redditpMessages ||= []).push(message);
          return Promise.resolve();
        },
      },
    };
  });
}

function sentMessages(page) {
  return page.evaluate(() => window.__redditpMessages || []);
}

test("the archive button sends the subreddit to the extension", async ({
  page,
}) => {
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/Pics/",
    gridImagePost(1),
    {},
  );
  await stubExtensionRuntime(page);
  await injectExtension(page);
  const archive = page.getByRole("button", { name: "archive", exact: true });
  await expect(archive).toBeEnabled();
  await expect(archive).toHaveAttribute("title", /\(H\)/);
  await expect(archive).toHaveAttribute("title", /r\/Pics/);

  await archive.click();
  await expect
    .poll(() => sentMessages(page))
    .toEqual([{ type: "open-archive", sub: "Pics" }]);
  await page.keyboard.press("h");
  await expect.poll(async () => (await sentMessages(page)).length).toBe(2);

  // H works in the grid as well.
  await page.keyboard.press("v");
  await expect(page.locator(".redditp__grid")).toBeVisible();
  await page.keyboard.press("h");
  await expect.poll(async () => (await sentMessages(page)).length).toBe(3);

  // With the settings open, slide shortcuts rest.
  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  await page.keyboard.press("h");
  await page.waitForTimeout(200);
  expect(await sentMessages(page)).toHaveLength(3);
});

test("the archive button is disabled away from a subreddit listing or without the extension", async ({
  page,
}) => {
  for (const [path, withExtension] of [
    ["/r/pics/comments/abc/post/", true],
    ["/user/someone/", true],
    ["/r/a+b/", true],
    ["/r/pics/", false],
  ]) {
    await openRoutedPage(
      page,
      `https://www.reddit.com${path}`,
      gridImagePost(1),
      {},
    );
    if (withExtension) await stubExtensionRuntime(page);
    await injectExtension(page);
    const archive = page.getByRole("button", { name: "archive", exact: true });
    await expect(archive, path).toBeDisabled();
    await expect(archive, path).toHaveAttribute("title", /\(H\)/);
    await page.keyboard.press("h");
    for (let press = 0; press < 16; press += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() =>
          document.activeElement.classList.contains("redditp__archive"),
        ),
        path,
      ).toBe(false);
    }
    expect(await sentMessages(page), path).toEqual([]);
  }
});

test("a host page's viewer has no archive button", async ({ page }) => {
  await hostPage(page);
  await openTestSource(page, { total: 3, batch: 3 });
  await expect(page.locator(".redditp__title")).toHaveText("Source 1");
  await expect(page.locator(".redditp__archive")).toHaveCount(1);
  await expect(page.locator(".redditp__archive")).toBeHidden();
});

// Stands in for the installed extension from the page's first script on: its
// messaging, and chrome.storage.local holding `stored` as the saved settings.
// A write reaches the storage listeners, as it does in the extension.
function stubExtension(page, stored = null) {
  return page.addInitScript((settings) => {
    const key = "redditpPresentationSettings";
    window.__redditpMessages = [];
    window.__storageListeners = [];
    window.__stored = settings;
    window.chrome = {
      runtime: {
        sendMessage(message) {
          window.__redditpMessages.push(message);
          return Promise.resolve();
        },
      },
      storage: {
        local: {
          get(name, callback) {
            callback({ [name]: window.__stored });
          },
          set(items, callback) {
            const change = { oldValue: window.__stored, newValue: items[key] };
            window.__stored = items[key];
            window.__storageListeners.forEach((listener) =>
              listener({ [key]: change }, "local"),
            );
            if (callback) callback();
          },
        },
        onChanged: {
          addListener(listener) {
            window.__storageListeners.push(listener);
          },
        },
      },
    };
  }, stored);
}

// A Reddit page with the archive icon's script and styles, which the manifest
// injects into every reddit.com page.
async function openLauncherPage(
  page,
  url,
  { stored, body = "<main>Reddit</main>" } = {},
) {
  await page.route("https://www.reddit.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body }),
  );
  await stubExtension(page, stored);
  await page.goto(url);
  await page.addStyleTag({ path: launcherStyles });
  await page.addScriptTag({ path: autoActivateScript });
  return page.locator(".redditp-launcher");
}

// What chrome.storage.onChanged reports when the saved settings change.
function changeStoredSettings(page, newValue, areaName = "local") {
  return page.evaluate(
    ([value, area]) =>
      window.__storageListeners.forEach((listener) =>
        listener({ redditpPresentationSettings: { newValue: value } }, area),
      ),
    [newValue, areaName],
  );
}

test("a floating archive icon on subreddit listings follows Reddit's navigation", async ({
  page,
}) => {
  const launcher = await openLauncherPage(
    page,
    "https://www.reddit.com/r/pics/",
  );
  // Reddit styles buttons globally; none of that reaches the icon.
  await page.addStyleTag({
    content:
      "button { width: 300px; height: 80px; margin: 40px; padding: 20px; background: red; }",
  });
  const icon = page.getByRole("button", { name: "Open the r/pics archive" });
  for (const [width, height] of [
    [360, 780],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(icon).toBeVisible();
    await expect(icon).toBeInViewport();
    const box = await icon.boundingBox();
    expect(box.width).toBe(36);
    expect(box.height).toBe(36);
    expect(box.x + box.width).toBeGreaterThanOrEqual(width - 60);
    expect(box.y + box.height).toBeGreaterThanOrEqual(height - 60);
  }
  await expect(icon).toHaveAttribute(
    "title",
    "Browse r/pics's full history, ranked by score",
  );

  await icon.click();
  await expect
    .poll(() => sentMessages(page))
    .toEqual([{ type: "open-archive", sub: "pics" }]);
  await icon.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sentMessages(page)).length).toBe(2);

  await page.evaluate(() =>
    history.pushState({}, "", "/r/pics/comments/abc/post/"),
  );
  await expect(launcher).toBeHidden();
  await page.evaluate(() => history.pushState({}, "", "/r/aww/"));
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute(
    "aria-label",
    "Open the r/aww archive",
  );
  await page.evaluate(() => history.pushState({}, "", "/"));
  await expect(launcher).toBeHidden();
  await page.evaluate(() => history.back());
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute(
    "aria-label",
    "Open the r/aww archive",
  );
  await expect(launcher).toHaveCount(1);
  expect(await sentMessages(page)).toHaveLength(2);
});

test("without the Navigation API the icon still follows Reddit within a second", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(window, "navigation", {
      value: undefined,
      configurable: true,
    });
  });
  const launcher = await openLauncherPage(
    page,
    "https://www.reddit.com/r/pics/",
  );
  expect(await page.evaluate(() => window.navigation)).toBeUndefined();
  await expect(launcher).toBeVisible();

  // pushState fires no event of its own, so the icon waits for its check.
  await page.evaluate(() =>
    history.pushState({}, "", "/r/pics/comments/abc/post/"),
  );
  await expect(launcher).toBeVisible();
  await page.clock.runFor(1000);
  await expect(launcher).toBeHidden();
});

test("the icon setting hides it right away", async ({ page }) => {
  const launcher = await openLauncherPage(
    page,
    "https://www.reddit.com/r/pics/",
    { stored: { showArchiveLauncher: false } },
  );
  expect(await page.evaluate(() => window.__storageListeners.length)).toBe(1);
  await expect(launcher).toHaveCount(0);

  await changeStoredSettings(page, { showArchiveLauncher: true });
  await expect(launcher).toBeVisible();
  // Only the local storage area holds the setting.
  await changeStoredSettings(page, { showArchiveLauncher: false }, "sync");
  await expect(launcher).toBeVisible();
  await changeStoredSettings(page, { showArchiveLauncher: false });
  await expect(launcher).toBeHidden();
  // Cleared settings mean the default, which shows the icon.
  await changeStoredSettings(page, undefined);
  await expect(launcher).toBeVisible();
});

test("the settings panel has the archive icon setting", async ({ page }) => {
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/pics/",
    gridImagePost(1),
    {},
  );
  await injectExtension(page);
  const openSettings = page.getByRole("button", {
    name: "Open presentation settings",
  });
  await openSettings.click();
  const setting = page.getByLabel("Show the archive icon on subreddit pages");
  await expect(setting).toBeChecked();
  await setting.uncheck();
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("redditpPresentationSettings")),
  );
  expect(saved.showArchiveLauncher).toBe(false);

  await page.evaluate(() => window.__redditpPresentation.toggle());
  await openSettings.click();
  await expect(setting).not.toBeChecked();
});

test("unticking the icon setting in presentation mode hides the icon at once", async ({
  page,
}) => {
  const launcher = await openLauncherPage(
    page,
    "https://www.reddit.com/r/pics/",
    { body: gridImagePost(1) },
  );
  await expect(launcher).toBeVisible();
  await injectExtension(page);
  await expect(page.locator(".redditp__title")).toHaveText("Post 1");
  // The presentation covers the icon.
  const box = await launcher.boundingBox();
  expect(
    await page.evaluate(
      ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest(".redditp")),
      [box.x + box.width / 2, box.y + box.height / 2],
    ),
  ).toBe(true);

  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  const setting = page.getByLabel("Show the archive icon on subreddit pages");
  await expect(setting).toBeChecked();
  await setting.uncheck();
  await expect(launcher).toBeHidden();
  expect(await page.evaluate(() => window.__stored.showArchiveLauncher)).toBe(
    false,
  );
  await setting.check();
  await expect(launcher).toBeVisible();
  // The archive button does not depend on the setting.
  await setting.uncheck();
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await expect(
    page.getByRole("button", { name: "archive", exact: true }),
  ).toBeEnabled();
});

// The Hidden list

const HIDE_AUTHORS = ["alice", "bob", "carol"];

// An image post titled "Post <number>" by u/<author> in r/<sub>, whose
// picture routeGridImages answers. A null author leaves the post without
// one.
function authoredPost(number, author, sub = "pics") {
  const byline = author === null ? "" : ` data-author="${author}"`;
  return `<div class="thing link" data-url="https://i.redd.it/grid-${number}.jpg"${byline} data-subreddit="${sub}" data-permalink="/r/${sub}/comments/hide${number}/post/"><a class="title">Post ${number}</a></div>`;
}

// Posts 1 to count, by alice, bob and carol in turn.
function authoredPosts(count) {
  return Array.from({ length: count }, (_, index) =>
    authoredPost(index + 1, HIDE_AUTHORS[index % HIDE_AUTHORS.length]),
  ).join("");
}

// The titles of the posts by one of HIDE_AUTHORS, among posts 1 to count.
function postsBy(author, count) {
  return Array.from({ length: count }, (_, index) => index + 1)
    .filter(
      (number) => HIDE_AUTHORS[(number - 1) % HIDE_AUTHORS.length] === author,
    )
    .map((number) => `Post ${number}`);
}

// The grid's tiles by their names, column by column.
function gridColumnLabels(page) {
  return page
    .locator(".redditp__grid-column")
    .evaluateAll((columns) =>
      columns.map((column) =>
        Array.from(column.querySelectorAll(".redditp__tile"), (tile) =>
          tile.getAttribute("aria-label"),
        ),
      ),
    );
}

function savedSettings(page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("redditpPresentationSettings")),
  );
}

const hideToast = (page) => page.locator(".redditp__toast");

test("X hides the author of the tile under the pointer from the grid and the slideshow, and Undo puts the tiles back in place", async ({
  page,
}) => {
  // Paused, so the message stays until the test moves the clock on.
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/hidegrid/",
    authoredPosts(12),
    { openInGrid: true },
  );
  await injectExtension(page);
  const tiles = page.locator(".redditp__grid .redditp__tile");
  const count = page.locator(".redditp__count");
  await expect(tiles).toHaveCount(12);
  const before = await gridColumnLabels(page);
  const bobs = postsBy("bob", 12);
  await expect(gridTile(page, "Post 1")).toBeFocused();

  // The tile under the pointer wins over the focused one, and every post
  // by its author leaves.
  await gridTile(page, "Post 5").hover();
  await page.keyboard.press("x");
  await expect(tiles).toHaveCount(8);
  for (const name of bobs) await expect(gridTile(page, name)).toHaveCount(0);
  // The other tiles stay in their columns, in their order.
  expect(await gridColumnLabels(page)).toEqual(
    before.map((column) => column.filter((name) => !bobs.includes(name))),
  );
  await expect(gridTile(page, "Post 1")).toBeFocused();
  await expect(count).toHaveText(/^8 posts · 4 hidden( · loading more)?$/);
  const toast = hideToast(page);
  await expect(toast).toHaveAttribute("role", "status");
  await expect(toast).toContainText("Hid u/bob");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  expect((await savedSettings(page)).hidden).toEqual(["u/bob"]);

  // The slideshow leaves them out too.
  await page.keyboard.press("v");
  const title = page.locator(".redditp__title");
  await expect(title).toHaveText("Post 1");
  await expect(count).toHaveText(/^1 \/ 8 · 4 hidden/);
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Post 3");
  await page.keyboard.press("Escape");
  await expect(page.locator(".redditp__grid")).toBeVisible();

  // Undo puts every tile back exactly where it was.
  await undo.click();
  await expect(tiles).toHaveCount(12);
  expect(await gridColumnLabels(page)).toEqual(before);
  await expect(count).toHaveText(/^12 posts( · loading more)?$/);
  await expect(toast).toBeHidden();
  await expect(toast.locator(".redditp__toast-text")).toHaveText("");
  await expect(undo).toBeHidden();
  expect((await savedSettings(page)).hidden).toEqual([]);

  // A message leaves by itself after six seconds.
  await gridTile(page, "Post 6").hover();
  await page.keyboard.press("x");
  await expect(toast).toContainText("Hid u/carol");
  await page.mouse.move(5, 5);
  await page.clock.runFor(5000);
  await expect(toast).toContainText("Hid u/carol");
  await page.clock.runFor(1500);
  await expect(toast).toBeHidden();
  await expect(tiles).toHaveCount(8);
});

test("X hides the focused tile's author, focus moves on, and Z puts them back", async ({
  page,
}) => {
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/hidefocus/",
    authoredPosts(9),
    { openInGrid: true },
  );
  await injectExtension(page);
  const tiles = page.locator(".redditp__grid .redditp__tile");
  await expect(tiles).toHaveCount(9);
  const before = await gridColumnLabels(page);
  // The pointer rests clear of the tiles.
  await page.mouse.move(5, 5);
  await gridTile(page, "Post 2").focus();
  await page.keyboard.press("x");
  await expect(tiles).toHaveCount(6);
  for (const name of postsBy("bob", 9)) {
    await expect(gridTile(page, name)).toHaveCount(0);
  }
  // Focus moves to the next post shown, in page order.
  await expect(gridTile(page, "Post 3")).toBeFocused();
  await expect(hideToast(page)).toContainText("Hid u/bob");

  await page.keyboard.press("z");
  await expect(tiles).toHaveCount(9);
  expect(await gridColumnLabels(page)).toEqual(before);
  await expect(gridTile(page, "Post 2")).toBeFocused();
  await expect(hideToast(page)).toBeHidden();
  // With no message, Z does nothing.
  await page.keyboard.press("z");
  await expect(tiles).toHaveCount(9);

  // Tab hands X back to the focused tile, though the pointer rests on
  // another.
  await gridTile(page, "Post 7").hover();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() =>
    document.activeElement.getAttribute("aria-label"),
  );
  const number = Number(/^Post (\d+)$/.exec(focused)[1]);
  const author = HIDE_AUTHORS[(number - 1) % HIDE_AUTHORS.length];
  expect(author).not.toBe("alice");
  await page.keyboard.press("x");
  await expect(hideToast(page)).toContainText(`Hid u/${author}`);
  await expect(gridTile(page, focused)).toHaveCount(0);
  await expect(gridTile(page, "Post 7")).toHaveCount(1);
});

test("X in the slideshow moves on to the next post shown, and Undo goes back to it unless the slideshow moved", async ({
  page,
}) => {
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/hideshow/",
    authoredPosts(6),
    {},
  );
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("Post 1");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Post 2");

  await page.keyboard.press("x");
  await expect(title).toHaveText("Post 3");
  await expect(count).toHaveText("2 / 4 · 2 hidden");
  await expect(hideToast(page)).toContainText("Hid u/bob");
  await page.keyboard.press("z");
  await expect(title).toHaveText("Post 2");
  await expect(count).toHaveText("2 / 6");

  // Once the slideshow has moved on, Undo leaves it where it is.
  await page.keyboard.press("x");
  await expect(title).toHaveText("Post 3");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Post 4");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(count).toHaveText("4 / 6");
  await expect(title).toHaveText("Post 4");
});

test("X on a post without an author says so, and X typed into a field is only typed", async ({
  page,
}) => {
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/hidenoauthor/",
    authoredPost(1, null) +
      authoredPost(2, "[deleted]") +
      authoredPost(3, "alice"),
    {},
  );
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(count).toHaveText("1 / 3");
  await page.keyboard.press("x");
  await expect(hideToast(page)).toContainText(
    "This post has no author to hide.",
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Post 2");
  await page.keyboard.press("x");
  await expect(hideToast(page)).toContainText(
    "This post has no author to hide.",
  );
  await expect(count).toHaveText("2 / 3");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Post 3");

  // A field that has focus takes the x.
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "page-field";
    document.body.prepend(field);
    field.focus();
  });
  await page.keyboard.press("x");
  await expect(page.locator("#page-field")).toHaveValue("x");
  // The last post waits on a load, which the paused clock never ends.
  await expect(count).toHaveText(/^3 \/ 3( · loading more)?$/);
  await expect(title).toHaveText("Post 3");

  // So does the settings panel's field.
  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  const field = page.getByLabel("User, subreddit or site to hide");
  await field.focus();
  await page.keyboard.press("x");
  await expect(field).toHaveValue("x");
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await expect(count).toHaveText(/^3 \/ 3( · loading more)?$/);
  // Nothing was hidden, so nothing was saved either.
  expect((await savedSettings(page)).hidden || []).toEqual([]);
});

test("the settings list the hidden entries, add users, subreddits and sites by hand, and take entries off", async ({
  page,
}) => {
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/hidesettings/",
    authoredPost(1, "alice") +
      authoredPost(2, "bob", "Funny") +
      `<div class="thing link" data-url="https://news.example.com/story" data-author="carol" data-subreddit="pics" data-permalink="/r/pics/comments/hide3/post/"><a class="title">Post 3</a></div>` +
      authoredPost(4, "dave") +
      authoredPost(5, "alice", "funny"),
    { hidden: ["u/alice"] },
  );
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("Post 2");
  await expect(count).toHaveText("1 / 3 · 2 hidden");

  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  const hiddenSection = page.getByRole("region", { name: "Hidden" });
  await expect(hiddenSection).toBeVisible();
  const entries = hiddenSection.locator(".redditp__hidden-entry");
  await expect(entries).toHaveText(["u/alice"]);
  await expect(
    hiddenSection.getByRole("button", { name: "Unhide u/alice" }),
  ).toBeVisible();
  const field = page.getByLabel("User, subreddit or site to hide");
  const message = hiddenSection.getByRole("alert");

  // A subreddit, with Enter. The slideshow moves on at once.
  await field.fill("/r/Funny/");
  await page.keyboard.press("Enter");
  await expect(entries).toHaveText(["u/alice", "r/Funny"]);
  await expect(field).toHaveValue("");
  await expect(title).toHaveText("Post 3");
  await expect(count).toHaveText("1 / 2 · 3 hidden");

  // A site, with the Add button, covers its subdomains.
  await field.fill("Example.com");
  await hiddenSection.getByRole("button", { name: "Add", exact: true }).click();
  await expect(entries).toHaveText(["u/alice", "r/Funny", "example.com"]);
  await expect(title).toHaveText("Post 4");
  // The last post waits on a load, which the paused clock never ends.
  await expect(count).toHaveText(/^1 \/ 1 · 4 hidden( · loading more)?$/);

  // What names nothing stays in the field, with a message.
  await field.fill("not a name!");
  await page.keyboard.press("Enter");
  await expect(message).toHaveText(
    "Enter a user as u/name, a subreddit as r/name, or a site such as redgifs.com.",
  );
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveValue("not a name!");
  await field.fill("U/ALICE");
  await page.keyboard.press("Enter");
  await expect(message).toHaveText("u/alice is hidden already.");
  await expect(entries).toHaveText(["u/alice", "r/Funny", "example.com"]);

  // × takes an entry off, and its posts come back where they were; focus
  // moves to the entry that took its place.
  await hiddenSection.getByRole("button", { name: "Unhide u/alice" }).click();
  await expect(entries).toHaveText(["r/Funny", "example.com"]);
  await expect(message).toHaveText("");
  await expect(
    hiddenSection.getByRole("button", { name: "Unhide r/Funny" }),
  ).toBeFocused();
  await expect(title).toHaveText("Post 4");
  await expect(count).toHaveText(/^2 \/ 2 · 3 hidden( · loading more)?$/);
  expect((await savedSettings(page)).hidden).toEqual([
    "r/Funny",
    "example.com",
  ]);

  // The grid agrees.
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await page.keyboard.press("v");
  await expect(page.locator(".redditp__grid .redditp__tile")).toHaveCount(2);
  for (const name of ["Post 1", "Post 4"]) {
    await expect(gridTile(page, name)).toHaveCount(1);
  }

  // Taking the last entries off empties the list.
  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  await hiddenSection.getByRole("button", { name: "Unhide r/Funny" }).click();
  await hiddenSection
    .getByRole("button", { name: "Unhide example.com" })
    .click();
  await expect(entries).toHaveCount(0);
  await expect(hiddenSection).toContainText("Nothing hidden.");
  await expect(field).toBeFocused();
  await page
    .getByRole("button", { name: "Close presentation settings" })
    .click();
  await expect(page.locator(".redditp__grid .redditp__tile")).toHaveCount(5);
  await expect(count).toHaveText(/^5 posts( · loading more)?$/);
});

test("the Hidden list is remembered, and each open reads it afresh", async ({
  page,
}) => {
  await routeGridImages(page);
  const feedUrl = "https://www.reddit.com/r/hideremember/";
  await openRoutedPage(page, feedUrl, authoredPosts(6), {});
  await injectExtension(page);
  const title = page.locator(".redditp__title");
  const count = page.locator(".redditp__count");
  await expect(title).toHaveText("Post 1");
  await page.keyboard.press("x");
  await expect(title).toHaveText("Post 2");
  await expect(count).toHaveText(/^1 \/ 4 · 2 hidden/);

  // Closing and opening again keeps it.
  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(title).toHaveText("Post 2");
  await expect(count).toHaveText(/^1 \/ 4 · 2 hidden/);

  // Another tab changes the list meanwhile; the next open takes it up.
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const key = "redditpPresentationSettings";
    const settings = JSON.parse(localStorage.getItem(key));
    settings.hidden = ["u/bob"];
    localStorage.setItem(key, JSON.stringify(settings));
  });
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(title).toHaveText("Post 1");
  await expect(count).toHaveText(/^1 \/ 4 · 2 hidden/);
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Post 3");

  // A fresh content script, as on the next page load, reads it back, and
  // the settings list it.
  await page.goto(feedUrl);
  await injectExtension(page);
  await expect(title).toHaveText("Post 1");
  await expect(count).toHaveText(/^1 \/ 4 · 2 hidden/);
  await page
    .getByRole("button", { name: "Open presentation settings" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Hidden" })
      .locator(".redditp__hidden-entry"),
  ).toHaveText(["u/bob"]);
});

test("a page whose every post is hidden searches fifteen batches, then says why", async ({
  page,
}) => {
  // Paused, so only the posts rendered by each scroll drive the load.
  await pauseClock(page);
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/hideall/",
    `${authoredPost(1, "spammer")}<div style="height: 4000px"></div>`,
    { hidden: ["u/spammer"] },
  );
  // Every scroll renders one more post by the hidden author.
  await instrumentScroll(page, {
    template: authoredPost("{n}", "spammer"),
    start: 2,
  });
  await injectExtension(page);

  await expect(page.locator(".redditp__empty h2")).toHaveText(
    "Nothing here matches the filter",
  );
  await expect(page.locator(".redditp__empty p")).toHaveText(
    "Your Hidden list hides all 16 posts here. Change it in the settings.",
  );
  await expect(page.locator(".redditp__count")).toHaveText(
    "0 posts · 16 hidden",
  );
  expect(await scrollCalls(page)).toBe(15);
  // The gear stays, so the list can be changed.
  await expect(
    page.getByRole("button", { name: "Open presentation settings" }),
  ).toBeVisible();

  // With the Show filter on as well, the message names both.
  await page.keyboard.press("o");
  await expect(page.locator(".redditp__empty p")).toHaveText(
    /^Only images are shown, and your Hidden list hides \d+ posts here\. Change that in the settings, or press O\.$/,
  );
});

test("a grid whose new posts are all hidden stops after fifteen batches", async ({
  page,
}) => {
  const spam = Array.from({ length: 400 }, (_, index) =>
    gridSlide(index + 5, { author: "u/spammer" }),
  );
  await openPooledGridSource(page, gridSlides(1, 4), spam, 4, {
    hidden: ["u/spammer"],
  });
  await expect.poll(() => gridLoadMores(page)).toBe(15);
  await expect(page.locator(".redditp__grid-status")).toHaveText(
    "No more posts found outside your Hidden list",
  );
  await page.waitForTimeout(500);
  expect(await gridLoadMores(page)).toBe(15);
  await expect(page.locator(".redditp__grid .redditp__tile")).toHaveCount(4);
  await expect(page.locator(".redditp__count")).toHaveText(
    "4 posts · 60 hidden",
  );
});

// Stands in for the extension's relay to the native helper: a port that
// answers each request with an "ok" progress and then "done", after a short
// delay, and records every request in window.__saveRequests. Nothing reaches
// the real helper.
function stubSaveRelay(page) {
  return page.evaluate(() => {
    window.__saveRequests = [];
    window.chrome = {
      runtime: {
        sendMessage() {
          return Promise.resolve();
        },
        connect() {
          const messageListeners = [];
          return {
            onMessage: { addListener: (fn) => messageListeners.push(fn) },
            onDisconnect: { addListener() {} },
            disconnect() {},
            postMessage(request) {
              window.__saveRequests.push(request);
              const id = request.items[0].id;
              setTimeout(() => {
                messageListeners.forEach((fn) =>
                  fn({ type: "progress", id, status: "ok" }),
                );
                messageListeners.forEach((fn) =>
                  fn({ type: "done", ok: 1, skipped: 0, failed: 0 }),
                );
              }, 50);
            },
          };
        },
      },
    };
  });
}

test("S saves the shown media once, marks it saved, and says when it cannot", async ({
  page,
}) => {
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/pics/",
    gridImagePost(1) +
      gridImagePost(2) +
      `<div class="thing link" data-url="https://example.com/story" data-permalink="/r/pics/comments/linkpost/post/"><a class="title">A link</a></div>`,
    {},
  );
  await stubSaveRelay(page);
  await injectExtension(page);
  const save = page.getByRole("button", { name: "save", exact: true });
  const toast = page.locator(".redditp__toast-text");
  await expect(save).toBeVisible();
  await expect(save).toHaveAttribute("title", /\(S\)/);

  // Two quick presses send one request.
  await page.keyboard.press("s");
  await page.keyboard.press("s");
  await expect(toast).toHaveText("Saved");
  const requests = () => page.evaluate(() => window.__saveRequests);
  expect(await requests()).toHaveLength(1);
  const request = (await requests())[0];
  expect(request.op).toBe("sync");
  expect(request.dest).toBe("pics");
  expect(request.items[0].id).toBe("grid1");
  expect(request.items[0].url).toBe("https://i.redd.it/grid-1.jpg");
  expect(request.items[0].metadata.title).toBe("Post 1");
  expect(request.items[0].metadata.mediaType).toBe("image");

  // The slide shows as saved, and saving it again sends nothing.
  await expect(
    page.getByRole("button", { name: "saved", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("s");
  await expect(toast).toHaveText("Already saved");
  expect(await requests()).toHaveLength(1);

  // Another slide is not marked, and a link post cannot be saved.
  await page.keyboard.press("ArrowRight");
  await expect(save).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("s");
  await expect(toast).toHaveText(/Can't save this one/);
  expect(await requests()).toHaveLength(1);

  // In the grid the tile under the pointer is the one saved.
  await page.keyboard.press("v");
  await expect(page.locator(".redditp__grid")).toBeVisible();
  await page.locator(".redditp__tile").nth(1).hover();
  await page.keyboard.press("s");
  await expect(toast).toHaveText("Saved");
  expect((await requests())[1].items[0].id).toBe("grid2");
});

test("without an extension to ask there is no save button and S does nothing", async ({
  page,
}) => {
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/pics/",
    gridImagePost(1),
    {},
  );
  await injectExtension(page);
  await expect(page.locator(".redditp__image")).toBeVisible();
  await expect(page.locator(".redditp__save")).toBeHidden();
  await page.keyboard.press("s");
  await expect(page.locator(".redditp__toast-text")).toHaveText("");
});
