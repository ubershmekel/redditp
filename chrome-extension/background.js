"use strict";

const REDDIT_HOST_RE = /(^|\.)reddit\.com$/i;

async function showPresentation(tab) {
  if (!tab || !tab.id) return;

  let url;
  try {
    url = new URL(tab.url || "");
  } catch (_error) {
    return;
  }

  if (url.protocol !== "https:" || !REDDIT_HOST_RE.test(url.hostname)) {
    await chrome.action.setBadgeBackgroundColor({
      tabId: tab.id,
      color: "#d93900",
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "redditp works on reddit.com pages",
    });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {});
      chrome.action
        .setTitle({
          tabId: tab.id,
          title: "Open redditp presentation mode",
        })
        .catch(() => {});
    }, 2500);
    return;
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["presentation.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (error) {
    console.error("Unable to start redditp presentation mode", error);
  }
}

chrome.action.onClicked.addListener(showPresentation);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-presentation") return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  await showPresentation(tabs[0]);
});
