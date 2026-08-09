# redditp Chrome extension

This Manifest V3 extension turns the Reddit listing currently open in Chrome
into an in-page media slideshow. It reads the posts rendered in the browser,
using the user's normal Reddit session; it does not call Reddit's public JSON
API.

## Install for development

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `chrome-extension` folder.
4. Pin **redditp Presentation Mode** if you want its button in the toolbar.

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
- **Auto**: advance every six seconds

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
feed, scroll first to load more posts, then start presentation mode. Direct and
preview images, lazy-loaded Reddit galleries, animated images, ordinary HTML
video, Reddit's live adaptive video players (including players rendered inside
open shadow roots), packaged Reddit MP4 video, Imgur, Redgifs, and YouTube
embeds are handled when their rendered URLs are available. Video starts muted
and can be unmuted from the compact control bar. Unsupported link types remain
useful as title cards with links to the media and comments.

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
- `favicon.png`: extension and toolbar icon
