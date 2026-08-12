# redditp Snapshot Downloader

A small, one-off Chrome extension that builds a static JSON cache of the public
listings redditp's visitors ask for most, so the site can still show something
useful when a live request doesn't succeed.

Reddit no longer accepts new OAuth app registrations, which is the route an
application would normally use for this. What's left is the public `.json` view
of a listing — the same page a person browsing reddit can open, no account
required — so this reads exactly that, through an ordinary browser tab, and
saves the response via Chrome's download manager.

It is built to be a considerate client:

- **Low volume.** One request every 5-15 seconds, averaging ~10s, from a single
  browser. A full run is a few hundred requests spread over hours — far less
  traffic than a person browsing the same listings by hand.
- **Public data only.** Ordinary listing pages, exactly as reddit serves them to
  a signed-out visitor — the `.json` views used here all load in a fresh
  incognito window with no account. Nothing private, nothing removed, no
  permission gate involved.
- **Run once, by hand.** A person starts it, watches it, and uninstalls the
  extension afterwards. It isn't a continuously running crawler.
- **Attributed.** Every saved file records the exact URL it came from, and
  redditp links each post back to its reddit permalink.

If you're extending this, keep those properties. Making it faster or
higher-volume is the one change that would turn a courteous archive into a
burden on someone else's servers.

## Load it

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" -> select this `extension/` folder
4. Click the extension icon to open the popup

## Run it

1. Edit the base path list in the textarea if you want (one path per line, e.g.
   `/r/gifs/.json`). Defaults are pre-filled from redditp's actual traffic logs,
   most popular first.
2. Check which **sort variants** to fetch: `hot` (the base path as-is),
   `top month`, `top year`, `top all`. Each checked variant expands every base
   path into its own request — `/r/gifs/.json` plus `/r/gifs/top/.json?t=year`
   and so on — so all four variants over the default list is ~580 fetches,
   roughly an hour and a half. The line under the checkboxes shows the count and
   ETA before you commit.
3. Check **Manual mode** for your first run through a few URLs — it fetches one,
   then waits for you to click **Next** instead of running on a timer. Good for
   confirming things still work before trusting the full list to the unattended
   throttle of 5-15 seconds between fetches. Uncheck it once you trust the run.
4. Leave **Skip paths already downloaded** checked unless you want to re-fetch
   things you already have. Resuming is the normal case — runs get interrupted —
   and the cumulative manifest already knows what succeeded, so a restart
   continues rather than repeating.
5. Pick the **Host** if you need to: `old.reddit.com` (default) or
   `www.reddit.com`. Both serve the same `.json` listings; if one starts
   declining requests, check the other in a normal tab before assuming the tool
   is at fault.
6. Click **Start**.
7. Watch the log for `OK`/`FAIL` per path.
8. Files land as a flat list in `Downloads/redditp-snapshot/` — one file per
   URL, request path flattened into the filename (e.g. `/r/gifs/.json` ->
   `r-gifs.json`, `/r/gifs/top/.json?t=year` -> `r-gifs-top-t-year.json`, and
   `/r/celebnsfw+celebs+.../.json` -> `r-celebnsfw+celebs+...json`). Query
   params are part of the name because they're part of the identity of the
   listing — without them every `/top` window would overwrite the last.

Each saved file gets a `redditp_source` key at the top level (alongside
`kind`/`data`, so nothing reading `data.children` is affected) — reddit's own
body names none of this, and a file that has drifted away from the manifest
shouldn't become an anonymous blob:

```json
"redditp_source": {
  "listing_url": "https://www.reddit.com/r/gifs/top?t=month",
  "fetch_url": "https://old.reddit.com/r/gifs/top/.json?t=month",
  "path": "/r/gifs/top/.json?t=month",
  "filename": "r-gifs-top-t-month.json",
  "fetched_at": "2026-08-12T03:40:37.671Z"
}
```

Both URLs are kept on purpose. `fetch_url` is the exact request that produced
these bytes, host included — what you'd need to reproduce or audit the fetch.
`listing_url` is the human-openable page the data represents, normalized to
`www.reddit.com` so it means the same thing regardless of which host a given run
used. It's the one still worth having years from now.

Every attempt (success or failure) is also recorded in
`Downloads/redditp-snapshot/manifest.json`, the authoritative url-to-file
mapping for whatever processes and deploys these later.

**The manifest is cumulative across runs.** It's kept in the extension's own
storage keyed by request path and rewritten in full at the end of each run (and
on **Stop**), so a second run — another sort variant, a retry of the failures —
merges into the existing mapping instead of replacing it. A fresh failure never
demotes an earlier success, since the file it downloaded is still on disk and
still good; the failure is recorded as `last_error` on the existing entry.
**Clear manifest history** wipes the accumulated mapping if you want a genuinely
clean slate; note that this only clears the extension's record, not the
already-downloaded files.

## When reddit declines a request

If a response comes back as a block or rate-limit page instead of the listing,
**the run stops immediately** rather than continuing through the remaining URLs.
A server that has just said no should not be asked several hundred more times,
and no amount of retrying would produce data anyway. Wait — hours, not minutes —
and confirm in a normal tab that reddit is serving you again before restarting.
If one host is declining and the other isn't, switch hosts.

Anything else that isn't JSON is logged with the first line of the page quoted,
so an unrecognized response is identifiable instead of showing up as a parse
offset — but it doesn't stop the run, since one odd page among hundreds is
normal.

Nothing is lost either way: completed paths are in the cumulative manifest, so
restarting with **Skip paths already downloaded** resumes where the run left
off.

## After it's done

Move `Downloads/redditp-snapshot/` wherever the next processing/deploy pass
picks it up from — `manifest.json` has the url-per-file mapping needed to turn
the flat list back into whatever path structure serving requires.

Uninstall the extension when you're done; it's a one-off tool, not something
meant to run continuously.
