// Drives real tab navigations to old.reddit.com/*.json (same mechanism as a
// human browsing there, which passes Reddit's bot-check) and saves each
// response as a file via chrome.downloads. Runs from the extension's real
// browser context, so there's no CDP/automation fingerprint for Reddit to
// detect the way there is with Playwright/Puppeteer.
//
// State lives entirely in chrome.storage.local (the "job" object) and each
// URL is processed by a fresh, self-contained call to processNext(),
// triggered either by a setTimeout (auto mode) or a "next" message from the
// popup (manual mode). This matters because manual mode's pause is
// human-paced and routinely exceeds the ~30s idle timeout after which
// Chrome kills MV3 service workers — an in-memory Promise held open across
// that pause would just be silently lost. Re-triggering via storage +
// events means a fresh worker can always pick up exactly where the last one
// left off.

const THROTTLE_MS = 3000;
const TAB_LOAD_TIMEOUT_MS = 15000;

function timestamp() {
  return new Date().toISOString();
}

async function appendLog(message) {
  const { logs = [] } = await chrome.storage.local.get("logs");
  logs.push(`[${timestamp()}] ${message}`);
  await chrome.storage.local.set({ logs });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timed out"));
    }, TAB_LOAD_TIMEOUT_MS);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Deterministic 32-bit FNV-1a hash, as 8 hex chars. No manifest/lookup is
// shipped to the frontend (to avoid ever transferring an NSFW subreddit
// name to a visitor on an unrelated SFW page) — instead the frontend
// recomputes this exact filename itself from the path it's already
// requesting. That means this function must stay byte-for-byte identical
// wherever it's duplicated (currently here; the frontend will need its own
// copy once the lookup is wired in there).
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// path is like "/r/gifs/.json" or "/r/gifs/.json?limit=100". The full
// request path is the only place it's recorded — the response body itself
// has no field naming the subreddit(s) that were requested — so it's
// preserved in the resulting filename (and again in manifest.json).
//
// Flattened into a single filename (no subfolders), trailing bare ".json"
// segment dropped and used as the extension instead:
//   "/r/gonewild/.json" -> "r-gonewild.json"
//
// Multi-subreddit "sub1+sub2+..." segments are order-insensitive on
// Reddit's end, so they're sorted first (same combo, any order, same
// file). They're also unbounded in length (one combo here has 17
// subreddits), so the segment becomes a short preview (first 5, sorted)
// plus a hash of the full sorted list — the hash guarantees two different
// long combos that happen to share their first 5 names don't collide onto
// the same filename:
//   "/r/b+a+c+d+e+f+g/.json" -> "r-a+b+c+d+e-1a2b3c4d.json"
function pathToFilename(urlPath) {
  const clean = urlPath.split("?")[0].replace(/^\/+|\/+$/g, "");
  const segments = clean
    .split("/")
    .filter((s) => s && s !== ".json")
    .map((segment) => {
      if (!segment.includes("+")) return segment;
      const subs = segment.split("+").sort();
      const preview = subs.slice(0, 5).join("+");
      const hash = fnv1a(subs.join("+"));
      return `${preview}-${hash}`;
    });
  const base = segments.length ? segments.join("-") : "root";
  return `redditp-snapshot/${base}.json`;
}

async function fetchOne(urlPath) {
  const url = `https://old.reddit.com${urlPath}`;
  const tab = await chrome.tabs.create({ url, active: false });
  const fetchedAt = timestamp();

  try {
    await waitForTabComplete(tab.id);

    const [{ result: text }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText,
    });

    if (!text) {
      throw new Error("Empty response body");
    }

    const parsed = JSON.parse(text); // throws on an HTML challenge/error page
    if (parsed?.reason || parsed?.error) {
      // e.g. {"reason": "banned", "message": "Not Found", "error": 404} for
      // a banned/private/nonexistent subreddit — valid JSON, HTTP 200, but
      // not listing data.
      throw new Error(
        `Reddit error response: ${parsed.reason || parsed.message || parsed.error}`,
      );
    }
    const itemCount = parsed?.data?.children?.length ?? 0;
    if (itemCount === 0) {
      throw new Error("Parsed OK but no items in response");
    }

    const filename = pathToFilename(urlPath);
    const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
    await chrome.downloads.download({
      url: dataUrl,
      filename,
      conflictAction: "overwrite",
      saveAs: false,
    });

    await appendLog(`OK   ${urlPath} -> ${itemCount} items -> ${filename}`);
    return { ok: true, urlPath, filename, itemCount, fetchedAt };
  } catch (err) {
    await appendLog(`FAIL ${urlPath} -> ${err.message}`);
    return { ok: false, urlPath, error: err.message, fetchedAt };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function writeManifest(manifest) {
  const text = JSON.stringify(manifest, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename: "redditp-snapshot/manifest.json",
    conflictAction: "overwrite",
    saveAs: false,
  });
}

async function getJob() {
  const { job } = await chrome.storage.local.get("job");
  return job;
}

async function setJob(job) {
  await chrome.storage.local.set({ job });
}

// Processes exactly one URL (job.urlPaths[job.index]), then either
// schedules itself again (auto mode) or stops and waits for a "next"
// message (manual mode). Safe to call fresh at any time — all state needed
// to resume comes from storage, not from anything held in memory.
async function processNext() {
  const job = await getJob();
  if (!job || job.status === "stopped" || job.status === "idle") {
    return;
  }

  if (job.index >= job.urlPaths.length) {
    await appendLog(`Done. ok=${job.okCount} failed=${job.failCount}`);
    await writeManifest(job.manifest);
    job.status = "idle";
    await setJob(job);
    return;
  }

  job.status = "running";
  await setJob(job);

  const result = await fetchOne(job.urlPaths[job.index]);
  job.index += 1;
  job.manifest.push(result);
  if (result.ok) job.okCount += 1;
  else job.failCount += 1;

  if (job.index >= job.urlPaths.length) {
    await appendLog(`Done. ok=${job.okCount} failed=${job.failCount}`);
    await writeManifest(job.manifest);
    job.status = "idle";
    await setJob(job);
    return;
  }

  if (job.manualMode) {
    job.status = "waiting-next";
    await setJob(job);
    await appendLog("Waiting for Next...");
  } else {
    job.status = "running";
    await setJob(job);
    setTimeout(processNext, THROTTLE_MS);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "start") {
    (async () => {
      await chrome.storage.local.set({ logs: [] });
      await setJob({
        urlPaths: message.urlPaths,
        index: 0,
        manualMode: !!message.manualMode,
        okCount: 0,
        failCount: 0,
        manifest: [],
        status: "running",
      });
      await appendLog(
        `Starting snapshot of ${message.urlPaths.length} URLs` +
          (message.manualMode ? " (manual mode)" : ""),
      );
      processNext();
    })();
    sendResponse({ started: true });
  } else if (message.type === "stop") {
    (async () => {
      const job = await getJob();
      if (job) {
        job.status = "stopped";
        await setJob(job);
        await appendLog("Stopped by user");
      }
    })();
    sendResponse({ stopped: true });
  } else if (message.type === "next") {
    processNext();
    sendResponse({ advanced: true });
  }
  return true;
});
