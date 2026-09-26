(function redditpAutoActivate() {
  "use strict";

  // Firefox exposes the promise-based `browser` namespace; Chrome only has `chrome`.
  const api = globalThis.browser || chrome;

  function sendMessage(message) {
    try {
      const sent = api.runtime.sendMessage(message);
      // Chrome returns a promise here; Firefox's `chrome` alias may not.
      if (sent && typeof sent.catch === "function") sent.catch(() => {});
    } catch (_error) {
      // The extension was reloaded or removed since this page loaded.
    }
  }

  // redditp=1 in the address opens presentation mode.
  let url = null;
  try {
    url = new URL(location.href);
  } catch (_error) {
    // An address the parser rejects carries no redditp=1.
  }
  if (url && url.searchParams.get("redditp") === "1") {
    sendMessage({ type: "activate-from-url" });
  }

  // redditp-subreddit-path:start
  // The subreddit whose archive the archive button and the archive icon open:
  // the one that a listing page's path names, spelled as in the path. Post
  // pages, multireddits and the front pages that gather many subreddits have
  // none. content.js and auto-activate.js carry this block word for word, and
  // it stays DOM-free, so nodejs/test-embedit.js can check both copies.
  const ARCHIVE_PSEUDO_SUBS = ["all", "popular", "friends", "mod", "random"];

  function subredditFromPath(pathname) {
    const match = /^\/r\/([A-Za-z0-9_]{2,21})(?:\/|$)/.exec(pathname || "");
    if (!match || /\/comments\/[^/]+/i.test(pathname)) return "";
    return ARCHIVE_PSEUDO_SUBS.includes(match[1].toLowerCase()) ? "" : match[1];
  }
  // redditp-subreddit-path:end

  // The archive icon: a small round button at the bottom right of a
  // subreddit's pages that opens that subreddit's archive in a new tab, the
  // same as the archive button in presentation mode. launcher.css, which the
  // manifest injects along with this script, styles it.

  // Keep in step with content.js, which saves the settings.
  const SETTINGS_KEY = "redditpPresentationSettings";
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Whether the settings allow the icon: null until they are read, so an
  // icon the user hid does not flash up while they load.
  let allowed = null;
  let launcher = null;
  // The subreddit the icon offers, or "" while it is hidden.
  let launcherSub = "";

  function createLauncher() {
    // An older copy of this script, from before the extension was updated or
    // reloaded, may have left its icon behind.
    document
      .querySelectorAll(".redditp-launcher")
      .forEach((stale) => stale.remove());
    const button = document.createElement("button");
    button.type = "button";
    button.className = "redditp-launcher";
    button.hidden = true;
    // A clock face with an arrow turning back around it.
    const icon = document.createElementNS(SVG_NS, "svg");
    [
      ["viewBox", "0 0 24 24"],
      ["fill", "none"],
      ["stroke", "currentColor"],
      ["stroke-width", "2"],
      ["stroke-linecap", "round"],
      ["stroke-linejoin", "round"],
      ["aria-hidden", "true"],
      ["focusable", "false"],
    ].forEach(([name, value]) => icon.setAttribute(name, value));
    ["M4 12a8 8 0 1 0 2.34-5.66", "M6.34 2.34v4h4", "M12 8v4l2.5 1.5"].forEach(
      (shape) => {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", shape);
        icon.append(path);
      },
    );
    button.append(icon);
    button.addEventListener("click", () => {
      const sub = subredditFromPath(location.pathname);
      if (sub) sendMessage({ type: "open-archive", sub });
    });
    return button;
  }

  // Shows the icon on a subreddit's pages while the settings allow it, and
  // hides it everywhere else. The icon is made the first time it shows.
  function sync() {
    const sub = allowed ? subredditFromPath(location.pathname) : "";
    if (!launcher) {
      if (!sub) return;
      launcher = createLauncher();
    }
    if (!launcher.isConnected) document.documentElement.append(launcher);
    if (sub === launcherSub) return;
    launcherSub = sub;
    launcher.hidden = !sub;
    if (!sub) return;
    launcher.setAttribute("aria-label", `Open the r/${sub} archive`);
    launcher.title = `Browse r/${sub}'s full history, ranked by score`;
  }

  function applySettings(settings) {
    allowed = !(settings && settings.showArchiveLauncher === false);
    sync();
  }

  function readSettings() {
    const area = api.storage && api.storage.local;
    if (!area || typeof area.get !== "function") {
      applySettings(null);
      return;
    }
    try {
      const pending = area.get(SETTINGS_KEY, (stored) => {
        applySettings(
          api.runtime.lastError ? null : stored && stored[SETTINGS_KEY],
        );
      });
      // Firefox's `browser` namespace may answer with a promise as well.
      if (pending && typeof pending.then === "function") {
        pending.then(
          (stored) => applySettings(stored && stored[SETTINGS_KEY]),
          () => applySettings(null),
        );
      }
    } catch (_error) {
      applySettings(null);
    }
  }

  readSettings();
  const storageChanges = api.storage && api.storage.onChanged;
  if (storageChanges && typeof storageChanges.addListener === "function") {
    // Ticking or unticking the setting in presentation mode applies at once.
    storageChanges.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes || !changes[SETTINGS_KEY]) return;
      applySettings(changes[SETTINGS_KEY].newValue);
    });
  }

  // Reddit changes pages without loading a new document. The Navigation API
  // reports pushState and replaceState, popstate reports Back and Forward, and
  // a check every second covers browsers and script worlds that report
  // neither.
  const navigation = window.navigation;
  if (navigation && typeof navigation.addEventListener === "function") {
    navigation.addEventListener("currententrychange", sync);
  }
  window.addEventListener("popstate", sync);
  setInterval(sync, 1000);
})();
