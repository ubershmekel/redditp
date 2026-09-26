"use strict";

// Firefox exposes the promise-based `browser` namespace; Chrome only has `chrome`.
const api = globalThis.browser || chrome;

const REDDIT_HOST_RE = /(^|\.)reddit\.com$/i;
// A subreddit name as Reddit spells one. Nothing else reaches the archive
// page's address.
const ARCHIVE_SUB_RE = /^[A-Za-z0-9_]{2,21}$/;

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

// Opens a subreddit's archive page in a new tab next to the tab that asked.
// Always a new tab: the page opens its viewer by itself only when it loads
// with #r/<sub> in its address, not when an open page's hash changes. Opening
// an extension page this way needs no permission.
function openArchive(sub, tab) {
  if (typeof sub !== "string" || !ARCHIVE_SUB_RE.test(sub)) return undefined;
  const properties = { url: api.runtime.getURL(`archive.html#r/${sub}`) };
  if (Number.isInteger(tab?.windowId)) properties.windowId = tab.windowId;
  if (Number.isInteger(tab?.index)) properties.index = tab.index + 1;
  if (Number.isInteger(tab?.id)) properties.openerTabId = tab.id;
  return api.tabs.create(properties);
}

api.action.onClicked.addListener(showPresentation);

api.commands.onCommand.addListener(async (command) => {
  if (command !== "open-presentation") return;
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  await showPresentation(tabs[0]);
});

api.runtime.onMessage.addListener((message, sender) => {
  // From the archive button and H in presentation mode, and from the archive
  // icon on a subreddit's pages.
  if (message?.type === "open-archive") {
    void Promise.resolve(openArchive(message.sub, sender.tab)).catch(
      (error) => {
        console.error("Unable to open the archive", error);
      },
    );
    return;
  }
  if (message?.type !== "activate-from-url" || !sender.tab) return;
  void showPresentation(sender.tab);
});
