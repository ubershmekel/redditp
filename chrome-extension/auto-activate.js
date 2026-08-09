(function redditpAutoActivate() {
  "use strict";

  let url;
  try {
    url = new URL(location.href);
  } catch (_error) {
    return;
  }

  if (url.searchParams.get("redditp") !== "1") return;
  chrome.runtime.sendMessage({ type: "activate-from-url" }).catch(() => {});
})();
