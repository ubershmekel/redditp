const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");

// The archive page (browser-extension/archive.html) is served from a routed
// https origin, as its real files, under the same script policy that
// Manifest V3 gives extension pages, so an inline script or eval would fail
// the test. The Arctic Shift API and every media host are routed too:
// nothing reaches the network.

const EXTENSION_DIR = path.resolve(__dirname, "../../browser-extension");
const ORIGIN = "https://archive.redditp.test";
const API = "https://arctic-shift.photon-reddit.com/api";
const EXTENSION_CSP = "script-src 'self'; object-src 'self'";
const SERVED = {
  "archive.html": "text/html",
  "archive.js": "text/javascript",
  "archive.css": "text/css",
  "content.js": "text/javascript",
  "presentation.css": "text/css",
  "favicon.png": "image/png",
};
const SEARCH_PARAMS = [
  "subreddit",
  "sort",
  "before",
  "after",
  "limit",
  "meta-app",
];

const HOUR = 3600;
const DAY = 86400;
// The tests' "now", in milliseconds and in seconds.
const NOW = Date.UTC(2026, 8, 25, 12);
const NOW_SEC = NOW / 1000;

const fixturePosts =
  require("../../test-data/reddit.com.json").data.children.map(
    (child) => child.data,
  );
const silentVideo = fs.readFileSync(
  path.resolve(__dirname, "../../test-data/browser-extension-sound.webm"),
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function svgImage(width, height) {
  return {
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`,
  };
}

// What each test's page did: errors, requests that would have left the
// machine, and requests to Reddit.
const pageLogs = new WeakMap();

function pageLog(page) {
  return pageLogs.get(page);
}

// Lets a test expect some console errors, such as the browser's note on a
// scripted HTTP error.
function allowErrors(page, pattern) {
  pageLog(page).allowed.push(pattern);
}

function serveExtensionFile(route) {
  const name =
    path.posix.basename(new URL(route.request().url()).pathname) ||
    "archive.html";
  const contentType = SERVED[name];
  if (!contentType) {
    return route.fulfill({ status: 404, contentType: "text/plain", body: "" });
  }
  return route.fulfill({
    contentType,
    headers:
      name === "archive.html"
        ? { "content-security-policy": EXTENSION_CSP }
        : {},
    body: fs.readFileSync(path.join(EXTENSION_DIR, name)),
  });
}

test.beforeEach(async ({ page, context }) => {
  const log = { errors: [], allowed: [], unexpected: [], reddit: [] };
  pageLogs.set(page, log);
  page.on("pageerror", (error) =>
    log.errors.push(`pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      log.errors.push(`console: ${message.text()}`);
    }
  });
  // Routes registered later win, so this one only answers what nothing
  // else does.
  await context.route(
    () => true,
    (route) => {
      log.unexpected.push(route.request().url());
      return route.abort();
    },
  );
  await context.route(`${ORIGIN}/**`, serveExtensionFile);
  await context.route(
    /^https:\/\/(?:i|preview|external-preview)\.redd\.it\//,
    // A picture named dead-… is gone: its host answers with Reddit's
    // placeholder.
    (route) =>
      route.fulfill(
        /^https:\/\/[^/]+\/dead-/.test(route.request().url())
          ? svgImage(130, 60)
          : svgImage(800, 600),
      ),
  );
  await context.route(/^https:\/\/(?:v\.redd\.it|i\.imgur\.com)\//, (route) =>
    route.fulfill({ contentType: "video/webm", body: silentVideo }),
  );
  // Players load a blank page, so an embed makes no network error.
  await context.route(
    /^https:\/\/(?:www\.youtube\.com|videohost\.example)\//,
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Player</title>",
      }),
  );
  await context.route(/^https:\/\/(?:www|old)\.reddit\.com\//, (route) => {
    log.reddit.push(route.request().url());
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reddit</title>",
    });
  });
});

test.afterEach(async ({ page }) => {
  const log = pageLog(page);
  expect(log.unexpected, "requests that would reach the network").toEqual([]);
  expect(
    log.errors.filter(
      (text) => !log.allowed.some((pattern) => pattern.test(text)),
    ),
    "page errors and console errors",
  ).toEqual([]);
});

// Answers the Arctic Shift API from datasets of posts, keyed by the
// lowercase sub, which a test may change between steps. A search returns
// the posts created before `before` (and after `after`), newest first,
// `pageSize` (7) at a time for limit=auto, so pages end at odd places.
// `script` holds one-off answers, used in order; one with a `sub` answers
// only that sub's searches. Every request is logged.
async function mockArchive(
  page,
  datasets,
  { script = [], earliest = {}, pageSize = 7 } = {},
) {
  const log = { searches: [], mins: [] };
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    const params = Object.fromEntries(url.searchParams);
    const json = (status, body, headers = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", ...headers },
        body: JSON.stringify(body),
      });
    const posts = datasets[params.subreddit] || [];
    if (url.pathname === "/api/utils/min") {
      log.mins.push(params);
      const first =
        earliest[params.subreddit] ??
        Math.min(...posts.map((post) => post.created_utc));
      return json(200, {
        data: Number.isFinite(first)
          ? new Date(first * 1000).toISOString()
          : null,
      });
    }
    if (url.pathname !== "/api/posts/search") {
      return json(404, { data: null, error: "Not found" });
    }
    log.searches.push(params);
    const unknown = Object.keys(params).filter(
      (key) => !SEARCH_PARAMS.includes(key),
    );
    if (unknown.length || !params["meta-app"]) {
      return json(400, { data: null, error: `Unknown parameter ${unknown}` });
    }
    const scripted = script.findIndex(
      (answer) => !answer.sub || answer.sub === params.subreddit,
    );
    if (scripted >= 0) {
      const [answer] = script.splice(scripted, 1);
      return json(answer.status, answer.body, answer.headers);
    }
    const before = Number(params.before);
    const after = params.after ? Number(params.after) : -Infinity;
    const limit = params.limit === "auto" ? pageSize : Number(params.limit);
    return json(200, {
      data: posts
        .filter(
          (post) =>
            post.created_utc * 1000 < before && post.created_utc * 1000 > after,
        )
        .sort((a, b) => b.created_utc - a.created_utc)
        .slice(0, limit),
    });
  });
  return log;
}

// `count` posts of a sub, one every `stepSec` from newestSec down, titled
// "Archive post 1" onwards, with the media of the reddit.com.json fixture's
// posts in turn (or of `templates`), and any fields `overrides` gives.
function archivePosts(
  sub,
  {
    count,
    newestSec = NOW_SEC - 3 * DAY,
    stepSec = HOUR,
    scoreOf = (index) => (index * 37) % 101,
    templates = fixturePosts,
    overrides = () => ({}),
  },
) {
  return Array.from({ length: count }, (_, index) => {
    const id = `as${index.toString(36)}`;
    const extra = overrides(index);
    const post = {
      ...clone(templates[index % templates.length]),
      id,
      name: `t3_${id}`,
      subreddit: sub,
      created_utc: newestSec - index * stepSec,
      score: scoreOf(index),
      title: `Archive post ${index + 1}`,
      permalink: `/r/${sub}/comments/${id}/archive_post_${index + 1}/`,
      removed_by_category: null,
      ...extra,
    };
    // The fixture's posts repeat their link as url_overridden_by_dest,
    // which Reddit's own posts read first.
    if (extra.url) post.url_overridden_by_dest = extra.url;
    return post;
  });
}

const fixturePost = (id) => fixturePosts.find((post) => post.id === id);
// An i.redd.it picture post and a Reddit video post.
const imagePost = fixturePost("kgl8vc");
const videoPost = fixturePost("kgepby");

// Image posts, each with a picture of its own.
function imagePosts(sub, options) {
  return archivePosts(sub, {
    templates: [imagePost],
    overrides: (index) => ({
      url: `https://i.redd.it/${sub}-${index + 1}.jpg`,
    }),
    ...options,
  });
}

// The titles the archive shows, in order, by the page's own rules: windows
// of `windowSize` posts from the newest down, within the range; in each,
// the posts at least two days old that reach the minimum score, by score,
// then newest first, then by id.
function expectedTitles(
  posts,
  { windowSize, minScore = 0, nowSec = NOW_SEC, start = 0, end = Infinity },
) {
  const stored = posts
    .filter(
      (post) =>
        !post.removed_by_category &&
        post.created_utc >= start &&
        post.created_utc < end,
    )
    .sort((a, b) => b.created_utc - a.created_utc);
  const titles = [];
  for (let at = 0; at < stored.length;) {
    let next = Math.min(stored.length, at + windowSize);
    while (
      next < stored.length &&
      stored[next].created_utc === stored[next - 1].created_utc
    ) {
      next += 1;
    }
    titles.push(
      ...stored
        .slice(at, next)
        .filter(
          (post) =>
            post.created_utc <= nowSec - 2 * DAY && post.score >= minScore,
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.created_utc - a.created_utc ||
            (a.id < b.id ? -1 : 1),
        )
        .map((post) => post.title),
    );
    at = next;
  }
  return titles;
}

// Steps through the slideshow with the right arrow, checking each title.
async function walkSlides(page, titles) {
  const title = page.locator(".redditp__title");
  for (let index = 0; index < titles.length; index += 1) {
    await expect(title).toHaveText(titles[index]);
    if (index < titles.length - 1) await page.keyboard.press("ArrowRight");
  }
}

// Opens the archive page with the test knobs: windows of 10 posts, no
// pause between requests, and resume positions saved at once. An archive
// named in the hash opens in the viewer by itself once its first window is
// ready.
async function openArchive(page, hash = "", config = {}) {
  await page.addInitScript(
    (value) => {
      window.__redditpArchiveConfig = value;
    },
    { windowSize: 10, requestIntervalMs: 0, resumeSaveMs: 0, ...config },
  );
  await page.goto(`${ORIGIN}/archive.html${hash}`);
}

// Opens the archive page, then an archive, by changing the hash the way a
// link on the page would, so the viewer stays closed.
async function openArchiveQuietly(page, sub, config = {}) {
  await openArchive(page, "", config);
  await page.evaluate((name) => {
    location.hash = `r/${name}`;
  }, sub);
}

// A paused clock fires the pull's timers only when a test runs it on.
async function pauseClock(page) {
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.pauseAt(new Date(NOW + 1000));
}

// Runs a paused clock on, a second at a time, until the pull's status
// matches. Answers arrive in real time, so a second can pass without one.
async function runPullUntil(page, text) {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1000);
        return page.locator("#redditp-archive-status").textContent();
      },
      { timeout: 20000 },
    )
    .toMatch(text);
}

// What IndexedDB holds for a sub, read through a second connection.
function readArchive(page, sub) {
  return page.evaluate(async (name) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("redditp-archive");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store, query) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll(query);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const range = IDBKeyRange.bound([name], [name, []]);
    const [subs, posts, dead] = await Promise.all([
      read("subs", name),
      read("posts", range),
      read("dead", range),
    ]);
    db.close();
    return { record: subs[0] || null, posts, dead };
  }, sub);
}

function setHidden(page, hidden) {
  return page.evaluate((value) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => value,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

const status = (page) => page.locator("#redditp-archive-status");
const libraryRow = (page, name) =>
  page.locator(".redditp-archive__item").filter({
    has: page.getByRole("link", { name, exact: true }),
  });

test("the archive page loads under an extension-style CSP without extension APIs", async ({
  page,
}) => {
  await mockArchive(page, {});
  await openArchive(page);
  await expect(page.locator("#redditp-archive-empty")).toHaveText(
    "No archives yet. Open a subreddit to start one.",
  );
  await expect(page.locator("#redditp-archive-panel")).toBeHidden();
  await expect(page.locator("#redditp-presentation")).toHaveCount(1);
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  expect(await page.evaluate(() => typeof window.chrome?.runtime?.id)).toBe(
    "undefined",
  );
  // The policy is in force: an inline script is refused.
  allowErrors(page, /inline script violates the following Content Security/);
  const refused = await page.evaluate(
    () =>
      new Promise((resolve) => {
        document.addEventListener(
          "securitypolicyviolation",
          (event) => resolve(event.violatedDirective),
          { once: true },
        );
        const script = document.createElement("script");
        script.textContent = "window.inlineRan = true;";
        document.body.append(script);
      }),
  );
  expect(refused).toMatch(/^script-src/);
  expect(await page.evaluate(() => window.inlineRan)).toBeUndefined();
});

test("opening r/pics pulls newest first, about once a second", async ({
  page,
}) => {
  const datasets = { pics: archivePosts("pics", { count: 40 }) };
  const archive = await mockArchive(page, datasets);
  await pauseClock(page);
  await openArchiveQuietly(page, "pics", { requestIntervalMs: 1000 });
  const count = libraryRow(page, "r/pics").locator(
    ".redditp-archive__item-count",
  );
  await expect(count).toHaveText("7 posts");
  const pageNow = await page.evaluate(() => Date.now());
  expect(archive.searches).toEqual([
    {
      subreddit: "pics",
      sort: "desc",
      before: String(pageNow),
      limit: "auto",
      "meta-app": "redditp",
    },
  ]);
  await expect
    .poll(() => archive.mins)
    .toEqual([{ subreddit: "pics", "meta-app": "redditp" }]);
  await expect(status(page)).toHaveText(/^Pulling… back to /);

  await page.clock.runFor(990);
  expect(archive.searches).toHaveLength(1);
  await page.clock.runFor(20);
  await expect.poll(() => archive.searches.length).toBe(2);
  const oldest = datasets.pics[6].created_utc;
  expect(archive.searches[1].before).toBe(String((oldest + 1) * 1000));
  // The oldest second of a page is asked for again, so its posts that did
  // not fit are not lost; the one already stored is not counted twice.
  await expect(count).toHaveText("13 posts");
  expect(archive.mins).toHaveLength(1);
});

test("a rate-limited request backs off, and uses the reset header when the browser can read it", async ({
  page,
}) => {
  allowErrors(page, /status of 429/);
  const datasets = {
    pics: archivePosts("pics", { count: 40 }),
    aww: archivePosts("aww", { count: 40 }),
  };
  const script = [];
  const archive = await mockArchive(page, datasets, { script });
  await pauseClock(page);
  await openArchiveQuietly(page, "pics", { requestIntervalMs: 1000 });
  const searches = (sub) =>
    archive.searches.filter((search) => search.subreddit === sub);
  await expect(
    libraryRow(page, "r/pics").locator(".redditp-archive__item-count"),
  ).toHaveText("7 posts");

  // The browser cannot read the reset headers of a cross-origin answer
  // unless the API exposes them, so the pull waits a minute.
  script.push({
    status: 429,
    body: { data: null, error: "Too many requests" },
  });
  await page.clock.runFor(1000);
  await expect.poll(() => searches("pics").length).toBe(2);
  await expect(status(page)).toHaveText(
    "Waiting: the archive asked us to slow down (retrying in 60 s)",
  );
  await page.clock.runFor(59000);
  expect(searches("pics")).toHaveLength(2);
  await expect(status(page)).toHaveText(/retrying in 1 s\)$/);
  // Exactly the last second: the retry goes out, while the request after it,
  // due seconds after the retry, stays out of reach however fast the retry
  // is answered.
  await page.clock.runFor(1000);
  await expect.poll(() => searches("pics").length).toBe(3);
  expect(searches("pics")[2].before).toBe(searches("pics")[1].before);

  // The retry's page is stored, so the next request is set for two seconds
  // after the retry went out: the pull stays slower after a rate limit.
  await expect(
    libraryRow(page, "r/pics").locator(".redditp-archive__item-count"),
  ).toHaveText("13 posts");
  await expect(status(page)).toHaveText(
    "Pulling… back to Sep 2026 (slowed to one request every 2 s after a rate limit)",
  );
  await expect(
    libraryRow(page, "r/pics").locator(".redditp-archive__item-progress"),
  ).toHaveText(/^\d+%$/);
  await page.clock.runFor(1999);
  // A request that went out would have reached the mock by now.
  await page.waitForTimeout(300);
  expect(searches("pics")).toHaveLength(3);
  await page.clock.runFor(1);
  await expect.poll(() => searches("pics").length).toBe(4);

  // When the API exposes them, the headers say how long to wait.
  script.push({
    sub: "aww",
    status: 429,
    body: { data: null, error: "Too many requests" },
    headers: {
      "access-control-expose-headers":
        "X-RateLimit-Reset, X-RateLimit-Reset-At",
      "x-ratelimit-reset": "5",
    },
  });
  await page.goto(`${ORIGIN}/archive.html#r/aww`);
  await expect.poll(() => searches("aww").length).toBe(1);
  await expect(status(page)).toHaveText(
    "Waiting: the archive asked us to slow down (retrying in 5 s)",
  );
  await page.clock.runFor(4900);
  expect(searches("aww")).toHaveLength(1);
  await page.clock.runFor(200);
  await expect.poll(() => searches("aww").length).toBe(2);
  expect(searches("aww")[1].before).toBe(searches("aww")[0].before);
});

test("a timed-out query retries with a smaller, narrower request", async ({
  page,
}) => {
  allowErrors(page, /status of 500/);
  const datasets = {
    pics: archivePosts("pics", { count: 20, stepSec: DAY }),
  };
  const timedOut = {
    status: 500,
    body: { data: null, error: "Query timed out" },
  };
  const archive = await mockArchive(page, datasets, {
    script: [timedOut, timedOut],
  });
  await openArchiveQuietly(page, "pics");
  await expect(status(page)).toHaveText(/^Complete back to /, {
    timeout: 15000,
  });
  const [first, second, third, fourth] = archive.searches;
  expect(first.limit).toBe("auto");
  expect(second).toEqual({ ...first, limit: "100" });
  expect(third).toEqual({
    ...first,
    limit: "100",
    after: String(Number(first.before) - 30 * DAY * 1000),
  });
  // A page that answers puts the pull back to full-size requests.
  expect(fourth.limit).toBe("auto");
  expect(fourth.after).toBeUndefined();
  const { record, posts } = await readArchive(page, "pics");
  expect(posts).toHaveLength(20);
  expect(record).toMatchObject({ done: true, count: 20, narrow: 0 });
});

test("the pull pauses while the tab is hidden and resumes from its cursor after a reload", async ({
  page,
}) => {
  const datasets = { pics: archivePosts("pics", { count: 60 }) };
  const archive = await mockArchive(page, datasets);
  await pauseClock(page);
  await openArchiveQuietly(page, "pics", { requestIntervalMs: 1000 });
  const count = libraryRow(page, "r/pics").locator(
    ".redditp-archive__item-count",
  );
  await expect(count).toHaveText("7 posts");

  await setHidden(page, true);
  await expect(status(page)).toHaveText("Paused while this tab is hidden");
  await page.clock.runFor(5000);
  expect(archive.searches).toHaveLength(1);
  await setHidden(page, false);
  await expect.poll(() => archive.searches.length).toBe(2);
  await expect(count).toHaveText("13 posts");

  const { record } = await readArchive(page, "pics");
  expect(record.cursorMs).toBe((datasets.pics[12].created_utc + 1) * 1000);
  await page.reload();
  await expect.poll(() => archive.searches.length).toBe(3);
  expect(archive.searches[2].before).toBe(String(record.cursorMs));
  await expect(count).toHaveText("19 posts");
});

test("a date range limits the pull, and widening it pulls on", async ({
  page,
}) => {
  // One post a day, the newest three days old.
  const datasets = {
    pics: archivePosts("pics", { count: 60, stepSec: DAY }),
  };
  const archive = await mockArchive(page, datasets);
  await pauseClock(page);
  await openArchiveQuietly(page, "pics", { requestIntervalMs: 1000 });
  await expect(
    libraryRow(page, "r/pics").locator(".redditp-archive__item-count"),
  ).toHaveText("7 posts");

  await page.getByLabel("Past month").check();
  await runPullUntil(page, /^This date range is stored, back to /);
  const monthStart = (await page.evaluate(() => Date.now())) / 1000 - 30 * DAY;
  const { record } = await readArchive(page, "pics");
  expect(record.bottom).toBeLessThanOrEqual(monthStart);
  expect(record.done).toBe(false);
  // The last request still started inside the month, and nothing followed
  // once a page reached below it.
  const pulled = archive.searches.length;
  expect(Number(archive.searches[pulled - 1].before) / 1000).toBeGreaterThan(
    monthStart,
  );
  await page.clock.runFor(5000);
  expect(archive.searches).toHaveLength(pulled);
  await expect(
    libraryRow(page, "r/pics").locator(".redditp-archive__item-progress"),
  ).toHaveText("complete");

  // The next request is long due, so it goes at once.
  await page.getByLabel("All", { exact: true }).check();
  await expect.poll(() => archive.searches.length).toBe(pulled + 1);
  await expect(status(page)).toHaveText(/^Pulling… back to /);
  await expect(
    libraryRow(page, "r/pics").locator(".redditp-archive__item-progress"),
  ).toHaveText(/^\d+%$/);
});

test("the library lists archives and deletes one", async ({ page }) => {
  const datasets = {
    pics: archivePosts("pics", { count: 12, stepSec: 5 * DAY }),
    aww: archivePosts("aww", { count: 5 }),
  };
  await mockArchive(page, datasets);
  await openArchiveQuietly(page, "aww");
  await expect(status(page)).toHaveText(/^Complete back to Sep 2026$/);
  // Exact: the viewer's settings also have a checkbox that mentions subreddits.
  await page.getByLabel("Subreddit", { exact: true }).fill("pics");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/#r\/pics$/);
  await expect(status(page)).toHaveText("Complete back to Jul 2026");

  const rows = page.locator(".redditp-archive__item");
  await expect(rows).toHaveCount(2);
  // The pulling archive comes first.
  await expect(rows.first().getByRole("link")).toHaveText("r/pics");
  const pics = libraryRow(page, "r/pics");
  await expect(pics.locator(".redditp-archive__item-count")).toHaveText(
    "12 posts",
  );
  await expect(pics.locator(".redditp-archive__item-span")).toHaveText(
    "Jul 2026 – Sep 2026",
  );
  await expect(pics.locator(".redditp-archive__item-refreshed")).toHaveText(
    "refreshed just now",
  );
  await expect(pics.locator(".redditp-archive__item-progress")).toHaveText(
    "complete",
  );
  const aww = libraryRow(page, "r/aww");
  await expect(aww.locator(".redditp-archive__item-count")).toHaveText(
    "5 posts",
  );
  await expect(aww.locator(".redditp-archive__item-span")).toHaveText(
    "Sep 2026",
  );

  // A dead picture stored for r/aww goes with it.
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("redditp-archive");
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("dead", "readwrite");
          transaction.objectStore("dead").put({
            sub: "aww",
            id: "as0",
            keys: ["i.redd.it/gone.jpg"],
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
  expect((await readArchive(page, "aww")).dead).toHaveLength(1);

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(
      "Delete the r/aww archive and its 5 stored posts?",
    );
    return dialog.accept();
  });
  await aww.getByRole("button", { name: "Delete r/aww" }).click();
  await expect(rows).toHaveCount(1);
  await expect(libraryRow(page, "r/aww")).toHaveCount(0);
  expect(await readArchive(page, "aww")).toEqual({
    record: null,
    posts: [],
    dead: [],
  });
  expect((await readArchive(page, "pics")).posts).toHaveLength(12);
  // The selected archive stays selected.
  await expect(page.locator("#redditp-archive-name")).toHaveText("r/pics");
});

const viewerTitle = (page) => page.locator(".redditp__title");
const viewerCount = (page) => page.locator(".redditp__count");
const browseButton = (page) => page.locator("#redditp-archive-browse");

test("the first window opens ranked by score, then the next window follows", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  // One post every 16 hours, the newest an hour old: the three newest are
  // too young to rank.
  const posts = imagePosts("pics", {
    count: 30,
    newestSec: NOW_SEC - HOUR,
    stepSec: 16 * HOUR,
  });
  await mockArchive(page, { pics: posts });
  await openArchive(page, "#r/pics");
  const expected = expectedTitles(posts, { windowSize: 10 });
  expect(expected).toHaveLength(27);
  // The window of posts 4 to 10 comes first, whatever the scores below it.
  expect(expected.slice(0, 7).sort()).toEqual(
    [4, 5, 6, 7, 8, 9, 10].map((number) => `Archive post ${number}`).sort(),
  );

  // The page opened with #r/pics, so the viewer opens by itself.
  await expect(page.locator("#redditp-presentation")).toBeVisible();
  await walkSlides(page, expected);
  await expect(viewerCount(page)).toHaveText("27 / 27");

  // The grid shows the same order, placed column by column.
  await page.keyboard.press("v");
  await expect(viewerCount(page)).toHaveText("27 posts");
  const columns = page.locator(".redditp__grid-column");
  const columnCount = await columns.count();
  expect(columnCount).toBeGreaterThan(1);
  for (let column = 0; column < columnCount; column += 1) {
    expect(
      await columns
        .nth(column)
        .locator(".redditp__tile")
        .evaluateAll((tiles) =>
          tiles.map((tile) => tile.getAttribute("aria-label")),
        ),
    ).toEqual(expected.filter((_, index) => index % columnCount === column));
  }
  for (const title of expected) {
    await expect(
      page.getByRole("button", { name: title, exact: true }),
    ).toHaveCount(1);
  }
});

test("posts below the minimum score or under 48 hours old are left out, and removed posts never arrive", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  // One post every 12 hours, the newest an hour old.
  const posts = imagePosts("pics", {
    count: 12,
    newestSec: NOW_SEC - HOUR,
    stepSec: 12 * HOUR,
  });
  const removed = {
    ...clone(imagePost),
    id: "gone1",
    name: "t3_gone1",
    subreddit: "pics",
    created_utc: NOW_SEC - 60 * HOUR,
    score: 999,
    title: "Removed post",
    permalink: "/r/pics/comments/gone1/removed_post/",
    removed_by_category: "moderator",
  };
  await mockArchive(page, { pics: [...posts, removed] });
  await openArchiveQuietly(page, "pics", { windowSize: 100 });
  await expect(status(page)).toHaveText(/^Complete back to /);
  const { posts: stored, record } = await readArchive(page, "pics");
  expect(stored.map((post) => post.id)).not.toContain("gone1");
  expect(record.count).toBe(12);

  await page.getByLabel("Minimum score").fill("50");
  await browseButton(page).click();
  const expected = expectedTitles(posts, { windowSize: 100, minScore: 50 });
  // Post 3 scores 74 but is only 25 hours old.
  expect(expected).toEqual([
    "Archive post 9",
    "Archive post 6",
    "Archive post 11",
    "Archive post 8",
  ]);
  await walkSlides(page, expected);
  await expect(viewerCount(page)).toHaveText("4 / 4");
  expect((await readArchive(page, "pics")).record.view.minScore).toBe(50);
});

// Reddit's preview of an i.redd.it GIF: a still picture, and an MP4.
const GIF_POSTER = "https://preview.redd.it/animated.gif?format=png8&s=still";
const GIF_MP4 = "https://preview.redd.it/animated.gif?format=mp4&s=motion";

// Posts of every kind the viewer shows, best score first.
function mediaPosts() {
  const gallery = clone(
    require("../../test-data/gallery-feature.json").data.children[1].data,
  );
  // Older records escape the & in their URLs.
  Object.values(gallery.media_metadata).forEach((entry) => {
    entry.s.u += "&amp;s=x";
  });
  const gif = {
    ...imagePost,
    url: "https://i.redd.it/animated.gif",
    url_overridden_by_dest: "https://i.redd.it/animated.gif",
    preview: {
      images: [
        {
          source: {
            url: GIF_POSTER.replace("&", "&amp;"),
            width: 400,
            height: 300,
          },
          variants: {
            gif: {
              source: {
                url: "https://preview.redd.it/animated.gif?s=gif",
                width: 400,
                height: 300,
              },
            },
            mp4: {
              source: {
                url: GIF_MP4.replace("&", "&amp;"),
                width: 400,
                height: 300,
              },
            },
          },
        },
      ],
    },
  };
  return [
    [gallery, "Gallery post"],
    [videoPost, "Reddit video"],
    [fixturePost("kgcs19"), "Imgur loop"],
    [gif, "Animated GIF"],
    [fixturePost("kgifs8"), "YouTube clip"],
    [
      {
        ...fixturePost("kghink"),
        url: "https://videohost.example/watch/abc",
        url_overridden_by_dest: "https://videohost.example/watch/abc",
        domain: "videohost.example",
      },
      "Watch page clip",
    ],
    [fixturePost("kgkkid"), "News story"],
    [fixturePost("kgjlvd"), "Text post"],
  ].map(([template, title], index) => ({
    ...clone(template),
    id: `media${index}`,
    name: `t3_media${index}`,
    subreddit: "media",
    created_utc: NOW_SEC - 3 * DAY - index * HOUR,
    score: 900 - index * 100,
    title,
    permalink: `/r/media/comments/media${index}/post/`,
    removed_by_category: null,
  }));
}

test("archive posts play their media", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const posts = mediaPosts();
  await page.route(GIF_MP4, (route) =>
    route.fulfill({ contentType: "video/webm", body: silentVideo }),
  );
  await mockArchive(page, { media: posts });
  await openArchive(page, "#r/media");
  const title = viewerTitle(page);
  const image = page.locator(".redditp__image");
  const video = page.locator(".redditp__video");
  const embed = page.locator(".redditp__embed");
  const next = () => page.keyboard.press("ArrowRight");

  await expect(title).toHaveText("Gallery post");
  for (const number of [1, 2, 3]) {
    if (number > 1) await next();
    await expect(page.locator(".redditp__gallery")).toHaveText(`(${number}/3)`);
    await expect(image).toHaveAttribute(
      "src",
      `https://preview.redd.it/galimg${number}.png?width=1080&s=x`,
    );
  }
  await next();
  await expect(title).toHaveText("Reddit video");
  await expect(video).toHaveAttribute(
    "src",
    "https://v.redd.it/h57x3pgw57661/DASH_360.mp4?source=fallback",
  );
  await expect(video).toHaveAttribute(
    "poster",
    videoPost.preview.images[0].source.url.replace(/&amp;/g, "&"),
  );
  await next();
  await expect(title).toHaveText("Imgur loop");
  await expect(video).toHaveAttribute("src", "https://i.imgur.com/RCtmQG7.mp4");
  await next();
  // A GIF plays as the MP4 that Reddit made of it.
  await expect(title).toHaveText("Animated GIF");
  await expect(video).toHaveAttribute("src", GIF_MP4);
  await expect(video).toHaveAttribute("poster", GIF_POSTER);
  await next();
  await expect(title).toHaveText("YouTube clip");
  await expect(embed).toHaveAttribute(
    "src",
    /^https:\/\/www\.youtube\.com\/embed\/zb_oMA-v_wI\?enablejsapi=1&/,
  );
  await next();
  await expect(title).toHaveText("Watch page clip");
  await expect(embed).toHaveAttribute(
    "src",
    /^https:\/\/videohost\.example\/ifr\/abc\?/,
  );
  await next();
  await expect(title).toHaveText("News story");
  await expect(image).toHaveAttribute(
    "src",
    fixturePost("kgkkid").preview.images[0].source.url.replace(/&amp;/g, "&"),
  );
  await next();
  await expect(title).toHaveText("Text post");
  await expect(page.locator(".redditp__post-body")).toHaveText(
    fixturePost("kgjlvd").selftext,
  );
  await expect(viewerCount(page)).toHaveText("8 / 8");

  // With images only, the news story's preview picture goes too, and so
  // does the GIF.
  await page.keyboard.press("o");
  await expect(viewerCount(page)).toHaveText("1 / 1 · images only");
  await expect(title).toHaveText("Gallery post");
  // With GIFs only, the GIF shows, with the imgur loop.
  await page.keyboard.press("o");
  await expect(viewerCount(page)).toHaveText("1 / 2 · GIFs only");
  await expect(title).toHaveText("Imgur loop");
  await next();
  await expect(title).toHaveText("Animated GIF");
  await expect(video).toHaveAttribute("src", GIF_MP4);
  await expect(viewerCount(page)).toHaveText("2 / 2 · GIFs only");
});

test("archive mode never contacts reddit.com", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  // One post of each kind in the reddit.com.json fixture.
  const total = fixturePosts.length;
  await mockArchive(page, {
    pics: archivePosts("pics", { count: total }),
  });
  await openArchive(page, "#r/pics", { windowSize: 100 });
  await expect(viewerCount(page)).toHaveText(`1 / ${total}`);
  for (let number = 2; number <= total; number += 1) {
    await page.keyboard.press("ArrowRight");
    await expect(viewerCount(page)).toHaveText(`${number} / ${total}`);
  }
  await page.keyboard.press("v");
  await expect(page.locator(".redditp__tile")).toHaveCount(total);
  expect(pageLog(page).reddit).toEqual([]);
});

test("dead archive pictures, a gallery's among them, are skipped on the next visit", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  // The best post's picture is gone, and so is the middle picture of the
  // third post's gallery, on Reddit's preview host: both hosts answer with
  // Reddit's placeholder.
  const gallery = clone(
    require("../../test-data/gallery-feature.json").data.children[1].data,
  );
  gallery.media_metadata.galimg2.s.u =
    "https://preview.redd.it/dead-gallery.png?width=1080";
  const posts = archivePosts("pics", {
    count: 5,
    templates: [imagePost],
    scoreOf: (index) => 100 - index,
    overrides: (index) =>
      index === 2
        ? {
            url: "https://www.reddit.com/gallery/as2",
            is_gallery: true,
            gallery_data: gallery.gallery_data,
            media_metadata: gallery.media_metadata,
          }
        : {
            url: index
              ? `https://i.redd.it/pics-${index + 1}.jpg`
              : "https://i.redd.it/dead-1.jpg",
          },
  });
  let deadRequests = 0;
  await page.route(
    /^https:\/\/(?:i\.redd\.it\/dead-1\.jpg|preview\.redd\.it\/dead-gallery\.png)/,
    (route) => {
      deadRequests += 1;
      return route.fulfill(svgImage(130, 60));
    },
  );
  await mockArchive(page, { pics: posts });
  await openArchive(page, "#r/pics", { windowSize: 100 });
  await expect(viewerCount(page)).toHaveText("1 / 4 · 1 unavailable");
  await expect(viewerTitle(page)).toHaveText("Archive post 2");
  const galleryNumber = page.locator(".redditp__gallery");
  await page.keyboard.press("ArrowRight");
  await expect(viewerTitle(page)).toHaveText("Archive post 3");
  await expect(galleryNumber).toHaveText("(1/3)");
  await page.keyboard.press("ArrowRight");
  await expect(galleryNumber).toHaveText("(3/3)");
  await expect(viewerCount(page)).toHaveText("2 / 4 · 2 unavailable");
  await expect
    .poll(async () => (await readArchive(page, "pics")).dead)
    .toEqual([
      { sub: "pics", id: "as0", keys: ["i.redd.it/dead-1.jpg"] },
      { sub: "pics", id: "as2", keys: ["preview.redd.it/dead-gallery.png"] },
    ]);
  const requests = deadRequests;
  expect(requests).toBeGreaterThan(1);

  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await page.locator("#redditp-archive-start-over").click();
  await expect(viewerTitle(page)).toHaveText("Archive post 2");
  // Counted from the archive's own record of dead media.
  await expect(viewerCount(page)).toHaveText("1 / 4 · 2 unavailable");
  await page.keyboard.press("ArrowRight");
  await expect(galleryNumber).toHaveText("(1/3)");
  await page.keyboard.press("ArrowRight");
  await expect(galleryNumber).toHaveText("(3/3)");
  expect(deadRequests).toBe(requests);
});

test("the archive reopens where you left off", async ({ page }) => {
  // No fake clock here: it hides the navigation timing that tells a reload
  // from an opening, so the posts are dated from the real now.
  const posts = imagePosts("pics", {
    count: 20,
    newestSec: Math.floor(Date.now() / 1000) - 3 * DAY,
  });
  await mockArchive(page, { pics: posts });
  await openArchive(page, "#r/pics");
  const expected = expectedTitles(posts, { windowSize: 10 });
  const idOf = (title) => posts.find((post) => post.title === title).id;
  await walkSlides(page, expected.slice(0, 5));
  await expect
    .poll(async () => (await readArchive(page, "pics")).record.resume?.id)
    .toBe(idOf(expected[4]));
  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await expect(browseButton(page)).toBeFocused();

  // A reload leaves the viewer closed until Browse.
  await page.reload();
  await expect(browseButton(page)).toBeEnabled();
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  await browseButton(page).click();
  await expect(viewerTitle(page)).toHaveText(expected[4]);
  await expect(viewerCount(page)).toHaveText(/^1 \/ /);
  await page.keyboard.press("ArrowRight");
  await expect(viewerTitle(page)).toHaveText(expected[5]);

  await page.keyboard.press("Escape");
  await page.locator("#redditp-archive-start-over").click();
  await expect(viewerTitle(page)).toHaveText(expected[0]);
});

test("refresh re-pulls the last two days and upserts matured scores", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  // One post every 6 hours, the newest 12 hours old. The one 60 hours old,
  // two days below the newest, still reads a score of 1.
  const posts = archivePosts("pics", {
    count: 20,
    newestSec: NOW_SEC - 12 * HOUR,
    stepSec: 6 * HOUR,
    scoreOf: (index) => (index === 8 ? 1 : 10 + index),
  });
  const datasets = { pics: posts };
  const archive = await mockArchive(page, datasets);
  await openArchiveQuietly(page, "pics", { windowSize: 100 });
  await expect(status(page)).toHaveText(/^Complete back to /);
  expect((await readArchive(page, "pics")).record.count).toBe(20);
  const pulled = archive.searches.length;

  // Three newer posts arrive, and the old post's score matures.
  const newer = archivePosts("pics", {
    count: 3,
    newestSec: NOW_SEC - HOUR,
    stepSec: 3 * HOUR,
    overrides: (index) => ({
      id: `new${index}`,
      name: `t3_new${index}`,
      title: `New post ${index + 1}`,
    }),
  });
  datasets.pics = [
    ...newer,
    ...posts.map((post) =>
      post.id === "as8" ? { ...post, score: 500 } : post,
    ),
  ];
  await page.locator("#redditp-archive-refresh").click();
  await expect
    .poll(async () => (await readArchive(page, "pics")).record.refreshedAt)
    .toBeGreaterThan(0);
  const refreshes = archive.searches.slice(pulled);
  expect(refreshes[0].before).toBe(String(NOW));
  // The second page reached two days below the old newest post, and the
  // refresh stopped there.
  expect(refreshes).toHaveLength(2);
  const { record, posts: stored } = await readArchive(page, "pics");
  expect(record).toMatchObject({
    count: 23,
    top: newer[0].created_utc,
    refresh: null,
  });
  expect(stored.find((post) => post.id === "as8").score).toBe(500);
  await expect(status(page)).toHaveText(/^Complete back to /);

  await browseButton(page).click();
  await expect(viewerTitle(page)).toHaveText("Archive post 9");
});

test("a date range limits what the archive shows", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  // One post a day, the newest three days old.
  const posts = archivePosts("pics", { count: 60, stepSec: DAY });
  await mockArchive(page, { pics: posts });
  await openArchiveQuietly(page, "pics", { windowSize: 100 });
  await page.getByLabel("Past month").check();
  await expect(browseButton(page)).toBeEnabled();
  await browseButton(page).click();
  const expected = expectedTitles(posts, {
    windowSize: 100,
    start: NOW_SEC - 30 * DAY,
  });
  // Posts 3 to 30 days old.
  expect(expected).toHaveLength(28);
  await walkSlides(page, expected);
  await expect(viewerCount(page)).toHaveText("28 / 28");
});

// The titles of a stretch of "Top of what's stored": the posts from
// startSec up to (not including) endSec, ranked by the page's own rules.
function stretchTitles(posts, startSec, endSec) {
  return expectedTitles(posts, {
    windowSize: Infinity,
    start: startSec,
    end: endSec,
  });
}

// The oldest second of a sub stored in full, where "Top of what's stored"
// ranks down to.
async function storedFrom(page, sub) {
  return (await readArchive(page, sub)).record.bottom;
}

test("top of what's stored ranks the stored posts at once, and slots in what the pull stores by score", async ({
  page,
}) => {
  // The first page's posts score from 400 down by twos, the second page's
  // from 311 down by twos, among the lowest of the first page's, and the
  // last twenty posts score the most of all.
  const posts = imagePosts("pics", {
    count: 120,
    scoreOf: (index) =>
      index < 50
        ? 400 - 2 * index
        : index < 100
          ? 411 - 2 * index
          : 500 - index,
  });
  await mockArchive(page, { pics: posts }, { pageSize: 51 });
  await pauseClock(page);
  await openArchiveQuietly(page, "pics", { requestIntervalMs: 1000 });
  const count = libraryRow(page, "r/pics").locator(
    ".redditp-archive__item-count",
  );
  await expect(count).toHaveText("51 posts");
  // The panel's Pause button. While the viewer covers the panel, the test
  // clicks it through the page's own events.
  const pause = page.locator("#redditp-archive-pause");
  await pause.click();
  await expect(status(page)).toHaveText("Paused");
  const hint = page.locator("#redditp-archive-order-hint");
  // The posts stored in full that the viewer has not been handed, in the
  // order the page ranks them; how many slides the viewer holds; and which
  // page a post came in.
  const unseen = async (handed) =>
    stretchTitles(
      posts.filter((post) => !handed.includes(post.title)),
      await storedFrom(page, "pics"),
      Infinity,
    );
  const held = async () =>
    Number(/ \/ (\d+)/.exec(await viewerCount(page).textContent())[1]);
  const pageOf = (title) =>
    Number(title.replace("Archive post ", "")) <= 50 ? 1 : 2;

  // The range is far from complete, yet the top order can start.
  const top = page.getByLabel("Top of what's stored");
  await expect(top).toBeEnabled();
  await expect(hint).toHaveText(
    "Ranks everything stored so far, back to Sep 2026. The pull keeps running, and posts that arrive while you browse are slotted in by score among those you have not seen yet.",
  );
  await top.check();
  await browseButton(page).click();
  await expect(viewerCount(page)).toHaveText(/^1 \/ \d+$/);
  const first = (await unseen([])).slice(0, await held());
  // The viewer holds the best of the stored posts, not all of them yet.
  expect(first.length).toBeLessThan(50);
  await walkSlides(page, first.slice(0, 3));

  // The pull stores another page while the viewer stays open. Its posts
  // are slotted in by score among the first page's that the viewer does
  // not hold yet.
  await pause.dispatchEvent("click");
  await page.clock.runFor(1000);
  await expect(count).toHaveText("101 posts");
  const next = await unseen(first);
  expect(next.slice(0, 8).map(pageOf)).toEqual([2, 2, 2, 2, 1, 2, 1, 2]);
  await walkSlides(page, first.slice(2));
  await expect.poll(held).toBeGreaterThan(first.length);
  const second = next.slice(0, (await held()) - first.length);
  await page.keyboard.press("ArrowRight");
  await walkSlides(page, second.slice(0, 12));

  // The pull completes while the viewer stays open. The rest follows, the
  // newcomers that outscore it first, and then the list wraps.
  await runPullUntil(page, /^Complete back to /);
  await expect(hint).toHaveText(
    "Ranks everything stored so far, back to Sep 2026 · complete",
  );
  const rest = await unseen([...first, ...second]);
  expect(first.length + second.length + rest.length).toBe(120);
  expect(Number(rest[0].replace("Archive post ", ""))).toBeGreaterThan(100);
  await walkSlides(page, [...second.slice(11), ...rest]);
  await page.keyboard.press("ArrowRight");
  await expect(viewerTitle(page)).toHaveText(first[0]);
  await expect(viewerCount(page)).toHaveText("1 / 120");
});

test("top of what's stored waits for the pull when it runs out", async ({
  page,
}) => {
  const posts = imagePosts("pics", { count: 30 });
  await mockArchive(page, { pics: posts });
  await pauseClock(page);
  await openArchiveQuietly(page, "pics", { requestIntervalMs: 1000 });
  const count = libraryRow(page, "r/pics").locator(
    ".redditp-archive__item-count",
  );
  await expect(count).toHaveText("7 posts");
  await page.getByLabel("Top of what's stored").check();
  await browseButton(page).click();
  const first = stretchTitles(posts, await storedFrom(page, "pics"), Infinity);
  await walkSlides(page, first);
  // The pull goes on, so the end of the list waits for it, not wrapping.
  await page.keyboard.press("ArrowRight");
  await expect(viewerCount(page)).toHaveText(
    `${first.length} / ${first.length} · loading more`,
  );
  await expect(viewerTitle(page)).toHaveText(first[first.length - 1]);

  // The next page arrives, and the slideshow moves on to its best post.
  await page.clock.runFor(1000);
  await expect(count).toHaveText("13 posts");
  const next = stretchTitles(
    posts.filter((post) => !first.includes(post.title)),
    await storedFrom(page, "pics"),
    Infinity,
  );
  expect(next).toHaveLength(6);
  await walkSlides(page, next);
});

test("browse and start over rank everything stored at that moment", async ({
  page,
}) => {
  const posts = imagePosts("pics", { count: 30 });
  await mockArchive(page, { pics: posts });
  await pauseClock(page);
  await openArchiveQuietly(page, "pics", { requestIntervalMs: 1000 });
  const count = libraryRow(page, "r/pics").locator(
    ".redditp-archive__item-count",
  );
  await expect(count).toHaveText("7 posts");
  const pause = page.locator("#redditp-archive-pause");
  await pause.click();
  // Too few posts for a window of ten, but enough for the top order.
  await expect(browseButton(page)).toBeDisabled();
  await page.getByLabel("Top of what's stored").check();
  await expect(browseButton(page)).toBeEnabled();
  await browseButton(page).click();
  const before = stretchTitles(posts, await storedFrom(page, "pics"), Infinity);
  await walkSlides(page, before.slice(0, 3));
  await page.keyboard.press("Escape");
  await expect(page.locator("#redditp-presentation")).toBeHidden();

  // Meanwhile the pull stores another page, with a better post.
  await pause.click();
  await page.clock.runFor(1000);
  await expect(count).toHaveText("13 posts");
  await pause.click();
  const after = stretchTitles(posts, await storedFrom(page, "pics"), Infinity);
  expect(after).toHaveLength(12);
  expect(after[0]).not.toBe(before[0]);
  // Browse goes back to the post it left on, in the order of everything
  // stored now, which mixes the new posts in.
  const left = after.indexOf(before[2]);
  const rest = after.slice(left);
  expect(rest).not.toEqual(before.slice(2));
  await browseButton(page).click();
  // The title still reads the post the viewer closed on, which is where it
  // reopens, so the count tells when the new list is there.
  await expect(viewerCount(page)).toHaveText(`1 / ${rest.length}`);
  await walkSlides(page, rest);
  // The pull is paused, so the end of the list wraps.
  await page.keyboard.press("ArrowRight");
  await expect(viewerTitle(page)).toHaveText(rest[0]);
  await expect(viewerCount(page)).toHaveText(`1 / ${rest.length}`);

  // Start over opens at the best post stored now.
  await page.keyboard.press("Escape");
  await page.locator("#redditp-archive-start-over").click();
  await expect(viewerCount(page)).toHaveText(`1 / ${after.length}`);
  await walkSlides(page, after);
});

test("author and community links open Reddit in a new tab", async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(NOW);
  await mockArchive(page, { pics: imagePosts("pics", { count: 3 }) });
  await openArchive(page, "#r/pics", { windowSize: 100 });
  const links = page.locator(".redditp__meta-link");
  await expect(links).toHaveText(["r/pics", `u/${imagePost.author}`]);
  for (const index of [0, 1]) {
    await expect(links.nth(index)).toHaveAttribute("target", "_blank");
  }
  const archiveUrl = page.url();
  const [reddit] = await Promise.all([
    context.waitForEvent("page"),
    links.first().click(),
  ]);
  await reddit.waitForLoadState();
  expect(reddit.url()).toBe("https://www.reddit.com/r/pics/?redditp=1");
  expect(page.url()).toBe(archiveUrl);
  await expect(page.locator("#redditp-presentation")).toBeVisible();
});

test("the viewer's media filter carries over", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    localStorage.setItem(
      "redditpPresentationSettings",
      JSON.stringify({ showGifs: false, showVideos: false }),
    );
  });
  await mockArchive(page, {
    pics: archivePosts("pics", {
      count: 3,
      templates: [imagePost, videoPost, imagePost],
      scoreOf: (index) => 90 - index * 10,
      overrides: (index) =>
        index === 1 ? {} : { url: `https://i.redd.it/pics-${index + 1}.jpg` },
    }),
  });
  await openArchive(page, "#r/pics", { windowSize: 100 });
  await expect(viewerCount(page)).toHaveText("1 / 2 · images only");
  await walkSlides(page, ["Archive post 1", "Archive post 3"]);
  await expect(page.locator(".redditp__video")).toHaveCount(0);
});

test("a subreddit without archived posts says so and opens nothing", async ({
  page,
}) => {
  const archive = await mockArchive(page, { nosuch: [] });
  await openArchive(page, "#r/nosuch");
  await expect(status(page)).toHaveText(
    "Arctic Shift has no posts for r/nosuch",
  );
  await expect(browseButton(page)).toBeDisabled();
  await expect(page.locator("#redditp-presentation")).toBeHidden();
  expect(archive.searches).toHaveLength(1);
  expect((await readArchive(page, "nosuch")).record).toMatchObject({
    done: true,
    count: 0,
  });
});

test("the archive page fits phone and desktop screens", async ({ page }) => {
  await mockArchive(page, { pics: archivePosts("pics", { count: 5 }) });
  await openArchiveQuietly(page, "pics", { windowSize: 100 });
  await expect(status(page)).toHaveText(/^Complete back to /);
  for (const [width, height] of [
    [360, 780],
    [390, 844],
    [393, 852],
    [412, 915],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    const size = `${width}x${height}`;
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      size,
    ).toBeLessThanOrEqual(0);
    for (const control of [
      page.locator("#redditp-archive-sub"),
      browseButton(page),
    ]) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box.height, size).toBeGreaterThanOrEqual(40);
      expect(box.x, size).toBeGreaterThanOrEqual(0);
      expect(box.y, size).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, size).toBeLessThanOrEqual(width);
      expect(box.y + box.height, size).toBeLessThanOrEqual(height);
    }
  }
});

// Run once, with REDDITP_ARCHIVE_BENCH=1, to measure a large archive.
test("500,000 posts stay usable", async ({ page }) => {
  test.skip(
    !process.env.REDDITP_ARCHIVE_BENCH,
    "Set REDDITP_ARCHIVE_BENCH=1 to run the benchmark.",
  );
  test.setTimeout(10 * 60 * 1000);
  const total = 500000;
  const step = 1100;
  // Scores cycle through a prime, so the best posts are spread out.
  const scoreOf = (index) => (index * 7919) % 100003;
  const bestOf = (count) => {
    let best = 0;
    for (let index = 1; index < count; index += 1) {
      if (scoreOf(index) > scoreOf(best)) best = index;
    }
    return `Bench post ${best + 1}`;
  };
  await mockArchive(page, { bench: [] });
  await openArchive(page, "", { windowSize: 5000, requestIntervalMs: 1000 });
  await expect(page.locator("#redditp-archive-empty")).toBeVisible();

  const writeMs = await page.evaluate(
    async ({ total, step }) => {
      const started = performance.now();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("redditp-archive");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const done = (transaction) =>
        new Promise((resolve, reject) => {
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(transaction.error);
        });
      const now = Date.now();
      const newest = Math.floor(now / 1000) - 3 * 86400;
      for (let from = 0; from < total; from += 5000) {
        const transaction = db.transaction("posts", "readwrite");
        const store = transaction.objectStore("posts");
        for (let index = from; index < from + 5000; index += 1) {
          const id = `b${index.toString(36)}`;
          store.put({
            sub: "bench",
            id,
            name: `t3_${id}`,
            subreddit: "bench",
            created_utc: newest - index * step,
            score: (index * 7919) % 100003,
            title: `Bench post ${index + 1}`,
            author: "bench",
            permalink: `https://www.reddit.com/r/bench/comments/${id}/`,
            is_self: false,
            selftext: "",
            over_18: false,
            is_video: false,
            is_gallery: false,
            post_hint: "image",
            domain: "i.redd.it",
            url: `https://i.redd.it/bench-${index}.jpg`,
            media: null,
            preview: {
              images: [
                {
                  source: {
                    url: `https://preview.redd.it/bench-${index}.jpg?width=640&s=x`,
                    width: 640,
                    height: 480,
                  },
                },
              ],
            },
          });
        }
        await done(transaction);
      }
      const oldest = newest - (total - 1) * step;
      const transaction = db.transaction("subs", "readwrite");
      transaction.objectStore("subs").put({
        name: "bench",
        display: "bench",
        createdAt: now,
        earliest: oldest,
        count: total,
        top: newest,
        bottom: oldest,
        done: true,
        cursorMs: 0,
        narrow: 0,
        refresh: null,
        refreshedAt: now,
        lastPullAt: now,
        paused: false,
        error: "",
        view: {
          mode: "windows",
          range: { preset: "all", from: "", to: "" },
          minScore: 0,
        },
        resume: null,
      });
      await done(transaction);
      db.close();
      return Math.round(performance.now() - started);
    },
    { total, step },
  );

  // Milliseconds from an action until the page meets a condition.
  const timed = async (action, condition, arg) => {
    await page.evaluate(() => {
      window.benchStart = performance.now();
    });
    await action();
    await page.waitForFunction(condition, arg, {
      polling: 10,
      timeout: 5 * 60 * 1000,
    });
    return page.evaluate(() =>
      Math.round(performance.now() - window.benchStart),
    );
  };
  const titleIs = (text) =>
    document.querySelector(".redditp__title")?.textContent === text;

  await page.evaluate(() => {
    location.hash = "r/bench";
  });
  await expect(browseButton(page)).toBeEnabled({ timeout: 60000 });
  const firstWindowMs = await timed(
    () => browseButton(page).click(),
    titleIs,
    bestOf(5000),
  );
  await expect(viewerCount(page)).toHaveText("1 / 48");
  for (let index = 0; index < 39; index += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(viewerCount(page)).toHaveText("40 / 48");
  // Seven slides ahead, the slideshow loads the next batch.
  const batchMs = await timed(
    () => page.keyboard.press("ArrowRight"),
    () => / \/ 96$/.test(document.querySelector(".redditp__count").textContent),
  );

  await page.keyboard.press("Escape");
  await page.getByLabel("Top of what's stored").check();
  const topMs = await timed(
    () => browseButton(page).click(),
    titleIs,
    bestOf(total),
  );
  await page.keyboard.press("Escape");

  const estimate = await page.evaluate(() => navigator.storage.estimate());
  page.once("dialog", (dialog) => dialog.accept());
  const deleteMs = await timed(
    () => page.locator("#redditp-archive-delete").click(),
    () => !document.querySelector(".redditp-archive__item"),
  );

  const timings = {
    posts: total,
    writeMs,
    firstWindowMs,
    batchMs,
    topMs,
    deleteMs,
    storedMB: Math.round(estimate.usage / 1024 / 1024),
  };
  console.log(`archive benchmark: ${JSON.stringify(timings)}`);
  test.info().annotations.push({
    type: "benchmark",
    description: JSON.stringify(timings),
  });
  expect.soft(firstWindowMs, "first window").toBeLessThan(500);
  expect.soft(batchMs, "one batch").toBeLessThan(200);
  expect.soft(topMs, "Top of what's stored").toBeLessThan(10000);
  expect.soft(deleteMs, "delete").toBeLessThan(10000);
});
