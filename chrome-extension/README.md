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
click the extension button or press `Ctrl+Shift+Y` (`Command+Shift+Y` on macOS).
The same action closes presentation mode when it is already open.

- Right arrow, Page Down, or Space: next slide
- Left arrow or Page Up: previous slide
- Escape: close
- F: enter or leave browser fullscreen, when available
- Swipe horizontally: previous or next slide
- **Auto**: advance every six seconds

Chrome lets users change the shortcut at `chrome://extensions/shortcuts`.

## Supported page shapes

The extractor recognizes current Reddit `shreddit-post` elements, old Reddit
`.thing.link` elements, and common article/post-container fallbacks. This covers
home and popular feeds, subreddit listings, search results, and user pages on
both old and current Reddit.

Only posts currently rendered in the page can be included. On an infinite scroll
feed, scroll first to load more posts, then start presentation mode. Direct
images and browser-readable videos are shown in place. Unsupported link types
remain useful as title cards with links to the media and comments.

## Files

- `manifest.json`: extension metadata, permissions, and shortcut
- `background.js`: toolbar and keyboard-command launcher
- `content.js`: Reddit DOM extraction and slideshow behavior
- `presentation.css`: isolated, responsive presentation UI
- `favicon.png`: extension and toolbar icon
