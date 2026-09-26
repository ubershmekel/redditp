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
    (route) =>
      route.fulfill(
        /^https:\/\/i\.redd\.it\/dead-/.test(route.request().url())
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
// the posts created before `before` (and after `after`), newest first, 7 at
// a time for limit=auto, so pages end at odd places. `script` holds one-off
// answers, used in order; one with a `sub` answers only that sub's
// searches. Every request is logged.
async function mockArchive(
  page,
  datasets,
  { script = [], earliest = {} } = {},
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
    const limit = params.limit === "auto" ? 7 : Number(params.limit);
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
// posts in turn (or of `templates`).
function archivePosts(
  sub,
  {
    count,
    newestSec = NOW_SEC - 3 * DAY,
    stepSec = HOUR,
    scoreOf = (index) => (index * 37) % 101,
    templates = fixturePosts,
  },
) {
  return Array.from({ length: count }, (_, index) => {
    const id = `as${index.toString(36)}`;
    return {
      ...clone(templates[index % templates.length]),
      id,
      name: `t3_${id}`,
      subreddit: sub,
      created_utc: newestSec - index * stepSec,
      score: scoreOf(index),
      title: `Archive post ${index + 1}`,
      permalink: `/r/${sub}/comments/${id}/archive_post_${index + 1}/`,
      removed_by_category: null,
    };
  });
}

// Opens the archive page with the test knobs: windows of 10 posts, no
// pause between requests, and resume positions saved at once.
async function openArchive(page, hash = "", config = {}) {
  await page.addInitScript(
    (value) => {
      window.__redditpArchiveConfig = value;
    },
    { windowSize: 10, requestIntervalMs: 0, resumeSaveMs: 0, ...config },
  );
  await page.goto(`${ORIGIN}/archive.html${hash}`);
}

// A paused clock fires the pull's timers only when a test runs it on.
async function pauseClock(page) {
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.pauseAt(new Date(NOW + 1000));
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
  await openArchive(page, "#r/pics", { requestIntervalMs: 1000 });
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
  await openArchive(page, "#r/pics", { requestIntervalMs: 1000 });
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
  await page.clock.runFor(2000);
  await expect.poll(() => searches("pics").length).toBe(3);
  expect(searches("pics")[2].before).toBe(searches("pics")[1].before);

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
  await openArchive(page, "#r/pics");
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
  await openArchive(page, "#r/pics", { requestIntervalMs: 1000 });
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
  await openArchive(page, "#r/pics", { requestIntervalMs: 1000 });
  await expect(
    libraryRow(page, "r/pics").locator(".redditp-archive__item-count"),
  ).toHaveText("7 posts");

  await page.getByLabel("Past month").check();
  for (let step = 0; step < 8; step += 1) await page.clock.runFor(1000);
  await expect(status(page)).toHaveText(/^This date range is stored, back to /);
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
  await openArchive(page, "#r/aww");
  await expect(status(page)).toHaveText(/^Complete back to Sep 2026$/);
  await page.getByLabel("Subreddit").fill("pics");
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
