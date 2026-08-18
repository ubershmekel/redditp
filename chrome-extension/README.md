# Presentation Mode for Reddit — Chrome extension

This Manifest V3 extension turns the Reddit listing currently open in Chrome
into an in-page media slideshow. It reads the posts rendered in the browser,
using the user's normal Reddit session; it does not call Reddit's public JSON
API.

[Install the extension from the Chrome Web Store](https://redditp.com/extension).

## Install for development

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `chrome-extension` folder.
4. Pin **Presentation Mode for Reddit** if you want its button in the toolbar.

## Use it

On an `old.reddit.com`, `www.reddit.com`, or other `reddit.com` listing page,
click the extension button or press `Alt+P`. The same action closes presentation
mode when it is already open.

Add `redditp=1` to any Reddit URL to start presentation mode automatically, for
example https://old.reddit.com/r/pics/?redditp=1 or
https://www.reddit.com/search/?q=formula1&redditp=1.

- Right arrow, Page Down, or Space: next slide
- Left arrow or Page Up: previous slide
- Escape: close
- F: enter or leave browser fullscreen, when available
- M: toggle video sound
- Swipe horizontally: previous or next slide
- Tab: cycle the controls; focus stays inside the presentation
- **Auto**: advance using the saved time-per-slide setting

Use the gear button in the bottom-left controls to choose the auto-advance
duration, hide the title panel, navigation arrows, or close button, and keep the
bottom panel compact. The gear is part of the expandable panel, so compact mode
leaves only a small expand button. If the close button is hidden, press Escape
from the slideshow to close presentation mode. These preferences are saved by
Chrome and used the next time presentation mode opens. The **redditp** link
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
the compact control bar. Unsupported link types remain useful as title cards
with links to the media and comments.

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
new runtime file there as well as to `manifest.json`.
