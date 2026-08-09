# redditp Snapshot Downloader

A throwaway Chrome extension for building a one-time static JSON cache of
redditp's most popular subreddits, since Reddit blocks both server-side
scraping and new OAuth app registration, but still allows normal browsing.

It works by opening real background tabs to `old.reddit.com/*.json` (the
same mechanism as manually browsing there) and saving each response via
Chrome's download manager — no CDP/automation, so it isn't subject to the
Playwright/Puppeteer detection that blocks headless scraping.

## Load it

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" -> select this `extension/` folder
4. Click the extension icon to open the popup

## Run it

1. Edit the URL path list in the textarea if you want (one path per line,
   e.g. `/r/gifs/.json`). Defaults are pre-filled from redditp's actual
   traffic logs, most popular first.
2. Check **Manual mode** for your first run through a few URLs — it fetches
   one, then waits for you to click **Next** instead of running on a timer.
   Good for confirming things still work before trusting the full list to
   the unattended 3s auto-throttle. Uncheck it once you trust the run.
3. Click **Start**.
4. Watch the log for `OK`/`FAIL` per path.
5. Files land as a flat list in `Downloads/redditp-snapshot/` — one file per
   URL, request path flattened into the filename (e.g. `/r/gifs/.json` ->
   `Downloads/redditp-snapshot/r-gifs.json`, and
   `/r/celebnsfw+celebs+.../.json` -> `r-celebnsfw+celebs+....json`).

Every attempt (success or failure) is also recorded in
`Downloads/redditp-snapshot/manifest.json`, since the source URL isn't
present anywhere in Reddit's own response body — that file is the
authoritative url-to-file mapping (which flattened filename came from which
request path) for whatever processes and deploys these later.

## After it's done

Move `Downloads/redditp-snapshot/` wherever the next processing/deploy pass
picks it up from — `manifest.json` has the url-per-file mapping needed to
turn the flat list back into whatever path structure serving requires.

Uninstall the extension when you're done; it's a one-off tool, not something
meant to run continuously.
