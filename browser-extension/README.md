# Presentation Mode for Reddit — browser extension

This Manifest V3 extension turns the Reddit listing currently open in the
browser into an in-page media slideshow. It reads the posts rendered in the
browser, using the user's normal Reddit session; it does not call Reddit's
public JSON API. Its [archive mode](#archive-mode) browses a subreddit's whole
history instead, ranked by score.

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
- V: switch between the slideshow and a grid of all loaded posts (the same as
  the **grid** button)
- O: cycle the media shown: everything, images only, GIFs only, videos only
- H: open this subreddit's archive in a new tab (the same as the **archive**
  button); only on a subreddit's listing pages
- Escape: close, or return to the grid when the slideshow was opened from it
- F: enter or leave browser fullscreen, when available
- M: toggle video sound; the choice is remembered for the next presentation
- T: show or hide the title panel (the same saved setting as in the gear panel)
- P: show or hide the bottom-left control panel (the same as its − / + button)
- C: open the current post's comments in a new tab
- I: open the current slide's original media in a new tab
- A: toggle auto-advance (the same as the **Auto** button)
- Swipe horizontally: previous or next slide (slideshow only)

Previous-slide controls stop on the first slide instead of wrapping to the end
of the slideshow. On an individual Reddit post, next-slide controls likewise
stop after the post's final media item.

Skipping the final gallery in a feed loads more posts, or wraps to the first
slide if there are no more posts. On an individual post page, G stops at the
last image.

- Tab: cycle the controls; focus stays inside the presentation
- **Auto**: advance using the saved time-per-slide setting

The post title in the title panel links to the post on Reddit and opens it in a
new tab. Middle-click, or Ctrl+click (Cmd+click on a Mac), the picture or video
in the slideshow, or a tile in the grid, to open that slide's hosted file in a
new tab: the same file as the **media** link and I. A plain click still plays or
pauses a video, and a plain click on a tile still opens the slideshow there.

The grid shows every loaded post as a tile, and each image of a gallery as a
numbered tile of its own. Click or tap a tile, or focus it and press Enter, to
open the slideshow at that slide; Escape then returns to the grid at the same
tile, while the × button still closes presentation mode. The arrow keys, Page
Up/Page Down, and Home/End scroll the grid. Scrolling to within about three
screens of the end of the grid loads more posts, and search results that show
only a small thumbnail upgrade to their actual media as their tiles come into
view, two at a time. The grid turns auto-advance off and starts no video or
embedded player: video tiles show the post's poster, and players load only in
the slideshow. Turn on **Open in grid view** in the settings panel to start
presentation mode in the grid.

The **Show** checkboxes in the settings panel choose which media the slideshow
and the grid show: images, GIFs, and videos. The **images**, **GIFs**, and
**videos** buttons in the bottom-left controls do the same, as does O: a lit
button's type is shown, and a struck-through one is hidden. GIFs include imgur
GIF and GIFV links, which play as video. Link and text posts appear only while
all three are on, and one type always stays on, so the last lit button, like the
last ticked box, cannot be turned off. The buttons stay in the controls in the
grid, and also while a filter hides every loaded post. With images only, a link
post's preview picture does not count as an image. While a filter is on, the
slide counter says so, as in `3 / 12 · images only`, and a dot marks the gear
button, or the + button when the controls are collapsed. Loading more posts
keeps scrolling Reddit until a matching post arrives, and gives up after 15
batches of new posts without a match, or when Reddit adds nothing for 12
seconds. Search results that show only a thumbnail stay until their post is
read, then drop out if they do not match. The choice is saved with the other
settings.

Pictures and videos that fail to load leave the slideshow and the grid instead
of turning into an "Image unavailable" card, and the slide counter says how many
did, as in `4 / 12 · 2 unavailable`. Deleted i.redd.it and imgur pictures count
as failed too, even though those hosts answer with a small placeholder picture.
Presentation mode remembers the failures until the tab reloads, so opening it
again leaves them out at once, and when every loaded post has failed it loads
more posts. Search results that show only a thumbnail keep their card until
their post is read, and stream formats the browser cannot play keep their link
card.

Open the gear button's settings panel for a keyboard shortcut reference. Use the
gear button in the bottom-left controls to choose the auto-advance duration and
which media types to show (the images, GIFs, and videos buttons beside it change
the same setting), hide the title panel, navigation arrows, or close button,
show or hide the bottom panel, open in grid view, and show or hide the archive
icon on subreddit pages. The gear is part of the expandable panel, so compact
mode leaves only a small expand button. If the close button is hidden, press
Escape from the slideshow to close presentation mode. These preferences are
saved by your browser and used the next time presentation mode opens. The
**redditp** link opens this README on GitHub.

These are bare keys only. Any combination holding Ctrl, Cmd, or Alt passes
through to the browser, so Ctrl+F and friends keep working while presentation
mode is open.

The slideshow loads more posts before it runs out. Once fewer than 8 slides are
left after the current one, it scrolls the underlying Reddit feed in the
background and adds the newly rendered posts without moving the slideshow, up to
4 loads in a row. The pictures of the next 3 slides are fetched early too, so
they show at once, unless the browser asks to save data. A load scrolls Reddit
to the end again about once a second and waits up to 12 seconds for new posts
before treating the feed as ended, so a slow feed still gets through. The slide
counter shows `loading more` only on the last post, while a load is still
running; pressing next there queues the move. If Reddit then adds nothing for 12
seconds, the slideshow wraps to the first slide, and once the feed is known to
have ended, next on the last slide wraps at once. Single-post `/comments/` pages
do not trigger this feed-loading scroll. Closing presentation mode scrolls the
Reddit page back to where it was.

Chrome lets users change the shortcut at `chrome://extensions/shortcuts`.
Firefox does it in `about:addons` under the gear menu's **Manage Extension
Shortcuts**.

## Archive mode

The archive page, `archive.html`, browses a subreddit's whole history ranked by
score, which a Reddit listing cannot do past its first thousand or so posts. It
pulls the posts from the [Arctic Shift](https://arctic-shift.photon-reddit.com)
archive into the browser's own storage (IndexedDB) and shows them in the same
slideshow and grid as presentation mode, with the same keys, buttons, and Show
filter.

Open it with the **archive** button or H in presentation mode, or with the small
round icon at the bottom right of a subreddit's listing pages. Either one opens
that subreddit's archive in a new tab. The button is disabled, and the icon
hidden, on post pages, multireddits, and front pages such as r/all. Hide the
icon with **Show the archive icon on subreddit pages** in the settings. On the
page itself, open any subreddit with the form at the top, or with
`archive.html#r/<subreddit>`. The pull starts at once:

- It asks for the newest posts first, up to 1,000 posts a request, about once a
  second, and goes back in time until the chosen date range is stored.
- It pauses while the tab is hidden, and after a reload it goes on from where it
  stopped. Only the subreddit open on the page pulls, in one tab at a time.
- Posts are ranked in stretches of about 5,000, the newest stretch first, each
  by score, so browsing starts long before the pull ends. A page opened with a
  subreddit in its address opens the slideshow by itself once the first stretch
  is stored, and the slideshow waits for the pull when it catches up with it.
  **Top of everything**, which ranks every post in the date range at once,
  becomes available once the whole range is stored.

The panel of the open subreddit has:

- **Date range**: all, the past year, the past month, or custom dates, in UTC. A
  narrower range stops the pull once it is stored; a wider one pulls on.
- **Minimum score**: posts below it are left out.
- **Order**: newest stretches first, or top of everything.
- **Browse** reopens where you left off in the same range, minimum score, and
  order; **Start over** starts from the top.
- **Pause** or **Resume** the pull, **Refresh**, and **Delete**.

Below it, the library lists every stored subreddit with its post count, date
span, last refresh, and progress, with the same actions, and says how much
storage the archives use.

Scores are Arctic Shift's snapshot of each post about 36 hours after it was
posted; older posts carry their final scores from the Pushshift era. Younger
posts read a score of 1, so posts under 48 hours old are left out of the
ranking. **Refresh** pulls the posts that are new since, and the last two days
below them again, so those scores mature. Removed posts are never stored.

Pictures and videos that fail to load are dropped, as in presentation mode, and
the archive remembers them: later visits leave them out at once and count them
as unavailable.

Arctic Shift is a free service, so the page asks for one page of posts a second
at most, waits a minute or more when the service asks it to slow down, and asks
for less when a request times out.

Privacy: the archive page is the only part of the extension that talks to
anything other than Reddit. It sends Arctic Shift the subreddit's name and the
dates the pull has reached, without cookies. Pictures and videos load from their
hosts, as in presentation mode. Archive mode never reads anything from
reddit.com; its author and community links open Reddit in a new tab.

During development, open `chrome-extension://<extension id>/archive.html#r/pics`
with the unpacked extension loaded, or open `browser-extension/archive.html`
from disk. From disk, the page keeps its own archives and settings, apart from
the extension's.

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
- Archive mode is built and tested in Chrome. The Firefox build ships the same
  archive page and icon, but they have not been tested there.
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
URL requests the viewer's saved sound preference using the common mute and sound
parameters, since a frame on another origin cannot be scripted from the page.
Hosts may ignore parameters they do not support. Where a player publishes a
message protocol the sound toggle keeps working after that too; where it does
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
- `background.js`: toolbar and keyboard-command launcher; opens the archive page
  in a new tab
- `auto-activate.js`: opt-in `redditp=1` URL launcher, and the archive icon on
  subreddit pages
- `launcher.css`: the archive icon on subreddit pages
- `content.js`: Reddit DOM extraction and slideshow behavior
- `presentation.css`: isolated, responsive presentation UI
- `archive.html`, `archive.js`, `archive.css`: the archive page; opened by the
  extension, not listed in the manifest
- `favicon.png`: small toolbar icon (64px)
- `icon-128.png`: store and extensions-page icon (128px)

`nodejs/package-extension.js` lists the files that go into the upload; add any
new runtime file there, and to `manifest.json` when the manifest loads it. It
takes a target:

- `npm run ext:package` — Chrome zip, manifest used as-is
- `npm run ext:package:firefox` — Firefox zip, with the MV3 event page
  (`background.scripts`), the AMO add-on id, and the data-collection declaration
  patched in
- `npm run ext:package:all` — both

`npm run ext:firefox:run` and `npm run ext:firefox:sign` build the Firefox
target first, so they always run against fresh output.
