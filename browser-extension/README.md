# Presentation Mode for Reddit — browser extension

This Manifest V3 extension turns the Reddit listing currently open in the
browser into an in-page media slideshow. It reads the posts rendered in the
browser, using the user's normal Reddit session; it does not call Reddit's
public JSON API.

One source tree builds both stores. `nodejs/package-extension.js` patches the
manifest per browser, so this folder stays the only place to edit.

[Install the extension for Chrome or Firefox](https://redditp.com/extension).
The link opens the Firefox Add-ons listing in Firefox or the Chrome Web Store
otherwise.

## Install for development

In Chrome:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `browser-extension` folder.
4. Pin **Presentation Mode for Reddit** if you want its button in the toolbar.

In Firefox, the manifest in this folder is the Chrome one, so build the Firefox
manifest first:

1. Run `npm run ext:package:firefox`, which writes `build/firefox-extension`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and pick
   `build/firefox-extension/manifest.json`.

`npm run ext:firefox:run` does the same in a throwaway profile, and
`npx web-ext lint --source-dir build/firefox-extension` runs the checks AMO
applies at upload.

Both of those are **temporary** installs that disappear when Firefox restarts.
That is not a limitation of this build: release and beta Firefox refuse to
permanently install any add-on AMO has not signed, and the
`xpinstall.signatures.required` pref that lifts the check is ignored there. To
keep the add-on installed on a release Firefox, sign it:

1. Create an AMO API key at
   <https://addons.mozilla.org/developers/addon/api/key/>.
2. Export `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`.
3. Run `npm run ext:firefox:sign`, which uploads the build for **unlisted**
   signing and drops a signed `.xpi` in `build/`.
4. Install that `.xpi` from `about:addons` → gear → **Install Add-on From
   File**.

Unlisted signing does not publish anything to the AMO directory; it only signs
the file for self-distribution. Signing the same version twice is rejected, so
bump `version` in `manifest.json` before re-signing. The alternative to signing
is Firefox Developer Edition, Nightly, or ESR, where setting
`xpinstall.signatures.required` to `false` in `about:config` does work.

## Use it

On an `old.reddit.com`, `www.reddit.com`, or other `reddit.com` listing page,
click the extension button or press `Alt+P`. The same action closes presentation
mode when it is already open.

Add `redditp=1` to any Reddit URL to start presentation mode automatically, for
example https://old.reddit.com/r/pics/?redditp=1 or
https://www.reddit.com/search/?q=formula1&redditp=1.

- Right arrow, Page Down, or Space: next slide
- Left arrow or Page Up: previous slide
- G: skip the rest of the current gallery; otherwise advance one slide
- Escape: close
- F: enter or leave browser fullscreen, when available
- M: toggle video sound; the choice is remembered for the next presentation
- T: show or hide the title panel (the same saved setting as in the gear panel)
- P: show or hide the bottom-left control panel (the same as its − / + button)
- C: open the current post's comments in a new tab
- Swipe horizontally: previous or next slide

Previous-slide controls stop on the first slide instead of wrapping to the end
of the slideshow. On an individual Reddit post, next-slide controls likewise
stop after the post's final media item.

Skipping the final gallery in a feed loads more posts, or wraps to the first
slide if there are no more posts. On an individual post page, G stops at the
last image.

- Tab: cycle the controls; focus stays inside the presentation
- **Auto**: advance using the saved time-per-slide setting

Open the gear button's settings panel for a keyboard shortcut reference. Use the
gear button in the bottom-left controls to choose the auto-advance duration,
hide the title panel, navigation arrows, or close button, and keep the bottom
panel compact. The gear is part of the expandable panel, so compact mode leaves
only a small expand button. If the close button is hidden, press Escape from the
slideshow to close presentation mode. These preferences are saved by your
browser and used the next time presentation mode opens. The **redditp** link
opens this README on GitHub.

These are bare keys only. Any combination holding Ctrl, Cmd, or Alt passes
through to the browser, so Ctrl+F and friends keep working while presentation
mode is open.

Reaching the final slide automatically scrolls the underlying Reddit feed and
preloads newly rendered posts. Pressing next while that load is still running
queues the navigation; if Reddit has no more posts, it wraps to the first slide.
Single-post `/comments/` pages do not trigger this feed-loading scroll. The
slide counter shows `loading more` while this background preload is active.

Chrome lets users change the shortcut at `chrome://extensions/shortcuts`.
Firefox does it in `about:addons` under the gear menu's **Manage Extension
Shortcuts**.

## Browser differences

- Firefox treats Manifest V3 `host_permissions` as optional, so reddit.com
  access is not granted at install. The extension asks for `activeTab`, which
  covers the toolbar button and `Alt+P` without any grant. The `redditp=1` URL
  launch is the one flow that needs the host permission; until the user allows
  it under the add-on's **Permissions**, that launch fails and the toolbar
  button flashes a hint instead.
- Firefox's native video controls consume clicks on the video surface before
  page scripts see them, so Firefox toggles playback itself rather than through
  redditp's handler. The visible behavior is the same, and Reddit's own click
  handler stays out of the way there too.
- `background.js` and `auto-activate.js` resolve `globalThis.browser || chrome`
  because Firefox's `chrome` alias is callback-based while `browser` returns
  promises. Keep new background code on that `api` handle.

## Supported page shapes

The extractor recognizes current Reddit `shreddit-post` elements, both current
Reddit search renderers (`search-media-post-unit` and `search-post-unit`), old
Reddit `.thing.link` listings, old Reddit combined-search cards, and common
article/post-container fallbacks. This covers home and popular feeds, subreddit
listings, search results, post pages, and user pages on both old and current
Reddit.

Only posts currently rendered in the page can be included. On an infinite scroll
feed, scroll first to load more posts, then start presentation mode. Images,
galleries, and video hosted by Reddit are shown, along with the media of the few
link hosts Reddit posts commonly use. Video starts muted and can be unmuted from
the compact control bar or with M, which is remembered for later presentations.

Media played inside a host's own player frame is opened autoplaying. The frame
URL requests the viewer's saved sound preference using the common mute and
sound parameters, since a frame on another origin cannot be scripted from the
page. Hosts may ignore parameters they do not support. Where a player publishes
a message protocol the sound toggle keeps working after that too; where it does
not, the sound button's tooltip says the player keeps its own control. We could
ask for permissions (or optional permissions) to access any URL to control the
mute of videos inside iframes, but that would be a privacy concern and cause the
extension publication review time to be much longer.

Unsupported link types remain useful as title cards with links to the media and
comments.

On a direct video post, redditp initializes Reddit's dormant adaptive player
before opening it. Reddit's low-frame-rate `CMAF_96.mp4` seek preview is never
used as a playback source. Dormant video cards in listings are initialized and
upgraded to their live player when their slide is reached.

Some search result formats expose only a small custom thumbnail. When one of
those slides is shown, redditp reads that post's normal Reddit HTML in the
background and upgrades the thumbnail to its actual image, video, or gallery. If
Reddit returns a login, quarantine, or challenge page, the thumbnail remains
available as the fallback.

## Files

- `manifest.json`: extension metadata, permissions, and shortcut
- `background.js`: toolbar and keyboard-command launcher
- `auto-activate.js`: opt-in `redditp=1` URL launcher
- `content.js`: Reddit DOM extraction and slideshow behavior
- `presentation.css`: isolated, responsive presentation UI
- `favicon.png`: small toolbar icon (64px)
- `icon-128.png`: store and extensions-page icon (128px)

`nodejs/package-extension.js` lists the files that go into the upload; add any
new runtime file there as well as to `manifest.json`. It takes a target:

- `npm run ext:package` — Chrome zip, manifest used as-is
- `npm run ext:package:firefox` — Firefox zip, with the MV3 event page
  (`background.scripts`), the AMO add-on id, and the data-collection declaration
  patched in
- `npm run ext:package:all` — both

`npm run ext:firefox:run` and `npm run ext:firefox:sign` build the Firefox
target first, so they always run against fresh output.
