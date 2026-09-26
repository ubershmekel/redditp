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
  await page.route("https://preview.redd.it/**", (route) => route.abort());
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
  await page.route("https://preview.redd.it/**", (route) => route.abort());
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
  await page.route("https://preview.redd.it/**", (route) => route.abort());
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
  await page.route("https://preview.redd.it/**", (route) => route.abort());
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
  await page.route(previewUrl, async (route) => {
    // An instant abort can swap the video for a link card before the
    // assertion below polls; hold it long enough for the src check.
    await new Promise((resolve) => setTimeout(resolve, 1500));
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
    ["f", "m", "g", "v", "o"].map((key) => {
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
  expect(prevented).toEqual([false, false, false, false, false]);

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
  await expect(grid.locator(".redditp__tile-play")).toHaveCount(2);
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

// Pictures load; players and embeds never do, so nothing waits on them.
async function routeMediaMix(page) {
  await page.route("https://i.redd.it/**", (route) =>
    route.fulfill(svgImage(800, 600)),
  );
  await page.route("https://external-preview.redd.it/**", (route) =>
    route.fulfill(svgImage(640, 360)),
  );
  for (const pattern of [
    "https://v.redd.it/**",
    "https://i.imgur.com/**",
    "https://www.youtube.com/**",
  ]) {
    await page.route(pattern, (route) => route.abort());
  }
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
  await expect(grid.locator(".redditp__tile-play")).toHaveCount(0);
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
    await expect(
      page
        .getByRole("button", { name, exact: true })
        .locator(".redditp__tile-play"),
    ).toHaveCount(1);
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
  await expect(page.locator(".redditp__tile-play")).toHaveCount(0);
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
  await expect(match.locator(".redditp__tile-play")).toHaveCount(0);
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

// Seven posts: a picture, a Reddit video with a poster, a YouTube embed, and
// four more pictures. Pictures are "<prefix>-<post number>.jpg", so two pages
// never share a URL. The player is Reddit's own custom element, which fetches
// nothing by itself.
function aheadPosts(prefix) {
  const picture = (number) =>
    `<div class="thing link" data-url="https://i.redd.it/${prefix}-${number}.jpg" data-permalink="/r/ahead/comments/${prefix}${number}/post/"><a class="title">Picture ${number}</a></div>`;
  return [
    picture(1),
    `<shreddit-post id="t3_${prefix}2" post-title="Ahead clip" post-type="video" content-href="https://v.redd.it/${prefix}clip" permalink="/r/ahead/comments/${prefix}2/post/"><shreddit-player src="https://v.redd.it/${prefix}clip/HLSPlaylist.m3u8" preview="https://v.redd.it/${prefix}clip/DASH_480.mp4" poster="https://external-preview.redd.it/${prefix}clip.png"></shreddit-player></shreddit-post>`,
    `<shreddit-post id="t3_${prefix}3" post-title="Ahead interview" content-href="https://www.youtube.com/watch?v=l74r1s8y7uY" permalink="/r/ahead/comments/${prefix}3/post/"></shreddit-post>`,
    ...[4, 5, 6, 7].map(picture),
  ].join("");
}

test("the next three pictures load ahead, and the filter is respected", async ({
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
  for (const pattern of [
    "https://v.redd.it/**",
    "https://www.youtube.com/**",
  ]) {
    await page.route(pattern, (route) => route.abort());
  }
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
  // The next three slides are the video, the embed, and picture 4.
  await expectRequested("https://external-preview.redd.it/allclip.png");
  await expectRequested("https://i.redd.it/all-4.jpg");
  await page.waitForTimeout(300);
  expect(requested.has("https://i.redd.it/all-5.jpg")).toBe(false);
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Ahead clip");
  await expectRequested("https://i.redd.it/all-5.jpg");

  // With images only, the next three are pictures 4 to 6, and the hidden
  // video's poster is left alone.
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/aheadimages/",
    aheadPosts("only"),
    { showGifs: false, showVideos: false },
  );
  await injectExtension(page);
  await expect(title).toHaveText("Picture 1");
  for (const number of [4, 5, 6]) {
    await expectRequested(`https://i.redd.it/only-${number}.jpg`);
  }
  await page.waitForTimeout(300);
  expect(requested.has("https://i.redd.it/only-7.jpg")).toBe(false);
  expect(requested.has("https://external-preview.redd.it/onlyclip.png")).toBe(
    false,
  );
});

test("the preload cache keeps six pictures and is dropped on close", async ({
  page,
}) => {
  await routeGridImages(page);
  await openRoutedPage(
    page,
    "https://www.reddit.com/r/cachefeed/",
    gridImagePosts(12),
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
  for (let press = 0; press < 5; press += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(title).toHaveText("Post 6");
  for (let press = 0; press < 5; press += 1) {
    await page.keyboard.press("ArrowLeft");
  }
  await expect(title).toHaveText("Post 1");
  // Pictures 2 to 9 were fetched once on the way; 2 and 3 then fell out of
  // the six kept and were fetched again on the way back.
  const created = await preloaded();
  expect(created).toHaveLength(10);
  expect(created.filter((number) => number === "2")).toHaveLength(2);
  expect(created.filter((number) => number === "3")).toHaveLength(2);

  // Closing drops the cache, so the next open fetches ahead afresh.
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await page.evaluate(() => window.__redditpPresentation.toggle());
  await expect(title).toHaveText("Post 1");
  await expect.poll(async () => (await preloaded()).length).toBe(13);
  expect((await preloaded()).slice(10)).toEqual(["2", "3", "4"]);
});

test("the grid starts loading three screens before its end", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await routeGridImages(page);
  await startPresentation(page, gridImagePosts(24));
  const count = page.locator(".redditp__count");
  // Far from the end, the slideshow loads nothing yet.
  await expect(count).toHaveText("1 / 24");
  await page.keyboard.press("v");
  await expect(count).toHaveText("24 posts · loading more");
  await expect(page.locator(".redditp__grid-status")).toHaveText(
    "Loading more posts…",
  );
  expect(
    await page.locator(".redditp__grid").evaluate((grid) => grid.scrollTop),
  ).toBe(0);
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
