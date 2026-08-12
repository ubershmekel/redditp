// Drives ordinary tab navigations to old.reddit.com/*.json — the public
// listing view any signed-out visitor can open — and saves each response as
// a file via chrome.downloads, building a static cache redditp can serve
// when a live request doesn't succeed.
//
// This is deliberately a low-volume, hand-started, run-once tool: one
// request every 5-15s from a single browser, public data only. See
// README.md; those properties are the point, not an implementation detail.
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

// ~10s between requests, jittered. The pace is set well below anything
// that could burden the server; the jitter keeps a long run from arriving
// as a steady metronome of identical intervals.
const THROTTLE_MIN_MS = 5000;
const THROTTLE_MAX_MS = 15000;
const TAB_LOAD_TIMEOUT_MS = 15000;

function throttleMs() {
  return Math.round(
    THROTTLE_MIN_MS + Math.random() * (THROTTLE_MAX_MS - THROTTLE_MIN_MS),
  );
}

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
// preserved in the resulting filename, in the file's own redditp_source
// key, and in manifest.json.
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
//
// Query params are part of the identity of the response, not decoration:
// /top/.json?t=month and ?t=year are different listings that would
// otherwise both land on "r-gifs-top.json" and overwrite each other. They
// are sorted (so param order doesn't matter) and appended as key-value
// pairs:
//   "/r/gifs/top/.json?t=year" -> "r-gifs-top-t-year.json"
function slug(value) {
  return value.replace(/[^A-Za-z0-9+_.-]/g, "_");
}

function pathToFilename(urlPath) {
  const [rawPath, rawQuery = ""] = urlPath.split("?");
  const clean = rawPath.replace(/^\/+|\/+$/g, "");
  const segments = clean
    .split("/")
    .filter((s) => s && s !== ".json")
    .map((segment) => {
      if (!segment.includes("+")) return segment;
      const subs = segment.split("+").sort();
      const preview = subs.slice(0, 5).join("+");
      const hash = fnv1a(subs.join("+"));
      return `${preview}-${hash}`;
    })
    .map(slug);
  const queryParts = [...new URLSearchParams(rawQuery).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${slug(key)}-${slug(value)}`);
  const base = [...(segments.length ? segments : ["root"]), ...queryParts].join(
    "-",
  );
  return `redditp-snapshot/${base}.json`;
}

// Reddit answers a declined request with an HTML interstitial rather than a
// status code we can see from here, so it's identified by its text. Without
// this every blocked request just looks like a JSON parse error and the run
// keeps going, which is both useless and rude.
// Only ever tested against a response that failed to parse as JSON — see
// fetchOne. A successful listing can contain any of these phrases in a post
// title, and halting a 500-URL run because someone wrote "rate limit" in a
// title would be a worse failure than the one this guards against.
const BLOCK_SIGNATURES = [
  "you've been blocked",
  "youve been blocked",
  "blocked by network security",
  "whoa there, pardner",
  "too many requests",
  "rate limit",
];

function isBlockPage(text) {
  const head = text.slice(0, 2000).toLowerCase();
  return BLOCK_SIGNATURES.some((signature) => head.includes(signature));
}

function firstLine(text) {
  const line = text.trim().split("\n")[0].trim();
  return line.length > 120 ? `${line.slice(0, 120)}...` : line;
}

const DEFAULT_HOST = "https://old.reddit.com";

// The canonical page a person would open for this listing, with the ".json"
// view segment dropped and the host normalized:
//   "/r/gifs/top/.json?t=month" -> "https://www.reddit.com/r/gifs/top?t=month"
function listingUrl(urlPath) {
  const [rawPath, rawQuery] = urlPath.split("?");
  const clean = rawPath.replace(/\/?\.json$/, "");
  return (
    "https://www.reddit.com" +
    (clean.startsWith("/") ? clean : `/${clean}`) +
    (rawQuery ? `?${rawQuery}` : "")
  );
}

async function fetchOne(urlPath, host) {
  const url = `${host || DEFAULT_HOST}${urlPath}`;
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

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Not the listing. Classification happens only here, never against a
      // response that parsed — post titles are arbitrary text and would
      // otherwise trip the signatures below.
      if (isBlockPage(text)) {
        // Reddit is explicitly declining to serve us. Retrying is exactly
        // the wrong response — the run halts (see processNext) so a block
        // doesn't turn into hundreds more requests at a server that already
        // said no.
        const err = new Error(`Reddit declined: "${firstLine(text)}"`);
        err.blocked = true;
        throw err;
      }
      // Some other page — an error, an interstitial with wording we don't
      // recognize. One of these is not a reason to stop the run, but quote
      // it rather than reporting a parse offset, which says nothing about
      // what actually came back.
      throw new Error(`Not JSON, page began: "${firstLine(text)}"`);
    }
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

    // Reddit's response body names none of this, so without stamping it in
    // here the only record of where a file came from is manifest.json —
    // separate the two and the archive becomes a pile of anonymous blobs.
    // It's a sibling of "kind"/"data" at the top level, so a client reading
    // data.children is unaffected.
    //
    // Both URLs are kept because they answer different questions. fetch_url
    // is the exact request that produced these bytes, host included, which
    // is what you'd need to reproduce or audit the fetch. listing_url is the
    // human-openable page the data represents — stable across whichever host
    // this run happened to use, and the one worth having in ten years when
    // "old.reddit.com" may mean nothing.
    parsed.redditp_source = {
      listing_url: listingUrl(urlPath),
      fetch_url: url,
      path: urlPath,
      filename: filename.split("/").pop(),
      fetched_at: fetchedAt,
    };
    const body = JSON.stringify(parsed);
    const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(body)}`;
    await chrome.downloads.download({
      url: dataUrl,
      filename,
      conflictAction: "overwrite",
      saveAs: false,
    });

    await appendLog(`OK   ${urlPath} -> ${itemCount} items -> ${filename}`);
    return {
      ok: true,
      urlPath,
      listingUrl: listingUrl(urlPath),
      filename,
      itemCount,
      fetchedAt,
    };
  } catch (err) {
    await appendLog(`FAIL ${urlPath} -> ${err.message}`);
    return {
      ok: false,
      urlPath,
      error: err.message,
      fetchedAt,
      blocked: !!err.blocked,
    };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// The manifest accumulates across runs, in chrome.storage.local, keyed by
// request path. A run only ever covers part of the archive (one sort
// variant, or an interrupted list), and manifest.json is written with
// conflictAction:"overwrite" — so a per-run manifest would silently erase
// every earlier run's mapping. Merging here means the extension owns the
// merge and whatever picks the folder up downstream never has to.
//
// A fresh failure never overwrites an earlier success: the previously
// downloaded file is still sitting on disk and still valid, so the ok
// entry is kept and the failure is recorded alongside it.
async function recordManifestEntry(result) {
  const { manifest = {} } = await chrome.storage.local.get("manifest");
  const previous = manifest[result.urlPath];

  if (!result.ok && previous?.ok) {
    manifest[result.urlPath] = {
      ...previous,
      last_failed_at: result.fetchedAt,
      last_error: result.error,
    };
  } else {
    manifest[result.urlPath] = result;
  }

  await chrome.storage.local.set({ manifest });
}

async function writeManifest() {
  const { manifest = {} } = await chrome.storage.local.get("manifest");
  const entries = Object.values(manifest).sort((a, b) =>
    a.urlPath < b.urlPath ? -1 : a.urlPath > b.urlPath ? 1 : 0,
  );
  const text = JSON.stringify(
    { generated_at: timestamp(), count: entries.length, entries },
    null,
    2,
  );
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename: "redditp-snapshot/manifest.json",
    conflictAction: "overwrite",
    saveAs: false,
  });
  await appendLog(`Wrote manifest.json (${entries.length} paths, cumulative)`);
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
    await finish(job);
    return;
  }

  job.status = "running";
  await setJob(job);

  const result = await fetchOne(job.urlPaths[job.index], job.host);
  job.index += 1;
  if (result.ok) job.okCount += 1;
  else job.failCount += 1;
  await recordManifestEntry(result);

  if (result.blocked) {
    await appendLog(
      "Reddit is declining requests right now — stopping the run. " +
        "Open old.reddit.com in a normal tab to confirm; wait for it to " +
        "clear (hours, not minutes) before restarting. Completed paths are " +
        "in the manifest, so a restart with 'skip already downloaded' " +
        "picks up where this left off.",
    );
    job.status = "stopped";
    await setJob(job);
    await writeManifest();
    return;
  }

  if (job.index >= job.urlPaths.length) {
    await finish(job);
    return;
  }

  if (job.manualMode) {
    job.status = "waiting-next";
    await setJob(job);
    await appendLog("Waiting for Next...");
  } else {
    job.status = "running";
    await setJob(job);
    const delay = throttleMs();
    await appendLog(`Next in ${(delay / 1000).toFixed(1)}s`);
    setTimeout(processNext, delay);
  }
}

async function finish(job) {
  await appendLog(`Done. ok=${job.okCount} failed=${job.failCount}`);
  await writeManifest();
  job.status = "idle";
  await setJob(job);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "start") {
    (async () => {
      await chrome.storage.local.set({ logs: [] });

      // Resuming is the normal case, not the exception — a run gets
      // interrupted by a block, a closed browser, or a Stop, and re-fetching
      // what's already on disk would be pure waste of someone else's
      // bandwidth. The cumulative manifest already knows what succeeded.
      let urlPaths = message.urlPaths;
      let skipped = 0;
      if (message.skipDownloaded) {
        const { manifest = {} } = await chrome.storage.local.get("manifest");
        const before = urlPaths.length;
        urlPaths = urlPaths.filter((urlPath) => !manifest[urlPath]?.ok);
        skipped = before - urlPaths.length;
      }

      await setJob({
        urlPaths,
        index: 0,
        host: message.host || DEFAULT_HOST,
        manualMode: !!message.manualMode,
        okCount: 0,
        failCount: 0,
        status: "running",
      });
      await appendLog(
        `Starting snapshot of ${urlPaths.length} URLs from ` +
          `${message.host || DEFAULT_HOST}` +
          (skipped ? ` (skipped ${skipped} already downloaded)` : "") +
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
      // Flush what this run got so far — the manifest is cumulative, and a
      // stopped run's entries are just as real as a finished one's.
      await writeManifest();
    })();
    sendResponse({ stopped: true });
  } else if (message.type === "next") {
    processNext();
    sendResponse({ advanced: true });
  } else if (message.type === "clear-history") {
    (async () => {
      await chrome.storage.local.set({ manifest: {} });
      await appendLog("Cleared manifest history");
    })();
    sendResponse({ cleared: true });
  }
  return true;
});
