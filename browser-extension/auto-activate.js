(function redditpAutoActivate() {
  "use strict";

  // Firefox exposes the promise-based `browser` namespace; Chrome only has `chrome`.
  const api = globalThis.browser || chrome;

  let url;
  try {
    url = new URL(location.href);
  } catch (_error) {
    return;
  }

  if (url.searchParams.get("redditp") !== "1") return;
  const sent = api.runtime.sendMessage({ type: "activate-from-url" });
  // Chrome returns a promise here; Firefox's `chrome` alias may not.
  if (sent && typeof sent.catch === "function") sent.catch(() => {});
})();
