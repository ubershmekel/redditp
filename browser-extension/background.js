"use strict";

// Firefox exposes the promise-based `browser` namespace; Chrome only has `chrome`.
const api = globalThis.browser || chrome;

const REDDIT_HOST_RE = /(^|\.)reddit\.com$/i;

async function flashHint(tabId, title) {
  await api.action.setBadgeBackgroundColor({
    tabId,
    color: "#d93900",
  });
  await api.action.setBadgeText({ tabId, text: "!" });
  await api.action.setTitle({ tabId, title });
  setTimeout(() => {
    Promise.resolve(api.action.setBadgeText({ tabId, text: "" })).catch(
      () => {},
    );
    Promise.resolve(
      api.action.setTitle({
        tabId,
        title: "Open redditp presentation mode",
      }),
    ).catch(() => {});
  }, 2500);
}

async function showPresentation(tab) {
  if (!tab || !tab.id) return;

  let url;
  try {
    url = new URL(tab.url || "");
  } catch (_error) {
    return;
  }

  if (url.protocol !== "https:" || !REDDIT_HOST_RE.test(url.hostname)) {
    await flashHint(tab.id, "redditp works on reddit.com pages");
    return;
  }

  try {
    await api.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["presentation.css"],
    });
    // Lends the page's own dash.js to v.redd.it slides. It is optional: without
    // it those slides play a silent rendition, so never let it block startup.
    try {
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["page-bridge.js"],
        world: "MAIN",
      });
    } catch (error) {
      console.warn("redditp page bridge unavailable", error);
    }
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (error) {
    console.error("Unable to start redditp presentation mode", error);
    // Firefox treats MV3 host permissions as optional, so the redditp=1 launch
    // can be denied until the user allows reddit.com access for the add-on.
    await flashHint(
      tab.id,
      "redditp needs permission for reddit.com - click the toolbar button to start",
    ).catch(() => {});
  }
}

api.action.onClicked.addListener(showPresentation);

// Safari on iPhone and iPad has no keyboard commands API. Registering against
// it there would throw and leave the redditp=1 listener below unregistered.
if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command) => {
    if (command !== "open-presentation") return;
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    await showPresentation(tabs[0]);
  });
}

api.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "activate-from-url" || !sender.tab) return;
  void showPresentation(sender.tab);
});
