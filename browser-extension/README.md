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
- X: hide the author of the current slide, or in the grid of the tile under the
  mouse pointer, or else of the focused tile (see
  [the Hidden list](#the-hidden-list))
- Z: undo that, while its message shows
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
- Swipe horizontally, or drag the picture with the mouse: previous or next slide
  (slideshow only)

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
pauses a video, and a plain click on a tile still opens the slideshow there. A
plain click or tap on the slideshow's picture goes to the grid, as V does.

The grid shows every loaded post as a tile, and each image of a gallery as a
numbered tile of its own. Click or tap a tile, or focus it and press Enter, to
open the slideshow at that slide; Escape then returns to the grid at the same
tile, while the × button still closes presentation mode. The arrow keys, Page
Up/Page Down, and Home/End scroll the grid. The grid gets ahead of you, since a
computer can afford the data and a tile that pops in is worse: it starts loading
more posts once its end is within about eight screens, up to six loads in a row
while you do not scroll (half a screen of scrolling allows six more), and search
results that show only a small thumbnail upgrade to their actual media as their
tiles come within about six screens below the view or two above it, two at a
time. Tiles load Reddit's smaller copy of a picture, about 640 pixels wide,
where the page or the archive names one, take the picture's shape before it
arrives, and start loading about six screens before they scroll into view from
below, or two from above. The grid turns auto-advance off and starts no player
with sound or controls, and no embedded player: video tiles show the post's
poster, an embedded player's tile shows a still of it (Reddit's preview, the
post card's picture, or YouTube's own still) or else an "Embedded video" card,
and a GIF's tile loops a silent MP4 of it over its still, where Reddit made one.
Where the player names several MP4s, as for a video posted as a GIF, the tile
loops the narrowest one at least 640 pixels wide; an uploaded GIF's player names
only one.

A video that Reddit hosts on v.redd.it loops over its tile's still the same way:
a Reddit video, a crossposted one, and a clip on a host such as RedGIFs or imgur
of which Reddit keeps a copy (its `reddit_video_preview`, which the archive
stores and which a live tile finds in the post data that the grid asks Reddit
for, as below). The tile loops the smallest of the video's silent renditions
that is at least 360 pixels across its short side, or the largest of a smaller
video, and reads which renditions there are from the video's manifest on
v.redd.it (`DASHPlaylist.mpd`, without your cookies, as its tile comes within
the pictures' reach, twelve at a time with those of tiles in view first, once
per video until the tab reloads), since their names differ from one year's
videos to the next; where the post's card already lists its MP4s with their
sizes, it picks from those instead. A Reddit video whose player names nothing
yet when the grid reads the post, as before Reddit fills the player in, loops
all the same: the post's own link names the video on v.redd.it. Where the
manifest or the chosen rendition fails, the tile loops the video's own file, or
keeps its still when it has none. YouTube tiles always stay stills.

A loop joins its tile once the tile is within about a screen below the view or
half a screen above it, and leaves again once the tile scrolls further away.
Ahead of the view it reads itself in, paused, so that it plays the moment its
tile shows: the nearest six at a time, and only once every loop in view plays,
so the tiles you see get the network first; until then a loop ahead reads
nothing at all. A loop shows over its still once it has a picture of its own,
which is as a rule before its tile comes into view. Every tile in view loops, up
to 80 at once, which covers a full 2560x1440 grid of the widest tiles, and all
of them start at once; none do when the system asks for reduced motion or the
browser for less data. A loop reads a few megabytes of its video, so a screen of
video tiles costs some 40 MB, and the grid reads about a screen more of them
ahead of the view. Players load only in the slideshow. Turn on **Open in grid
view** in the settings panel to start presentation mode in the grid.

Each tile says what its loop is doing in a `data-loop` attribute, which the
browser's developer tools show in their Elements panel:

- `none`: a picture, link or text post, with nothing to loop
- `no-copy`: a GIF or video whose card names no copy on Reddit to loop, and for
  which the grid does not ask Reddit's data: a YouTube post, or another source's
  post, such as an older archive record
- `asking`: the grid asks `/api/info.json` for the post's data, or will once the
  tile comes within reach
- `no-data`: Reddit's data for the post named no copy to loop
- `info-failed`: the request for the post's data failed
- `info-capped`: the grid stopped asking after failed requests, before this
  post's turn
- `off`: loops are off, for reduced motion or Data Saver, or because the browser
  lacks IntersectionObserver
- `idle`: the tile is too far from the view for its loop
- `resolving`: its video's manifest is being read
- `waiting`: ahead of the view, having read nothing yet, waiting to read in
- `buffering`: reading in, paused, ahead of the view
- `ready`: read in, paused, ahead of the view
- `starting`: in view, loading until it can play
- `playing`: playing in view
- `capped`: in view, while 80 other loops play
- `refused`: the browser refused to play it, as under an autoplay policy; it
  tries again once the tile comes back within reach
- `failed`: its video, and anything to fall back to, failed to load

The grid itself says how its asking for Reddit's data goes this time
presentation mode is open: `data-still-requests` counts the requests,
`data-still-failures` those that failed, and `data-still-gave-up` is there once
it has stopped asking.

A post whose card shows no picture at all, such as a RedGIFs post in a current
Reddit feed, would leave its tile with only the "Embedded video" or "Video"
card, and a clip whose card names nothing to loop would stay still. As such
tiles come within about six screens below the view, or two above it, the grid
asks Reddit for those posts' data (`/api/info.json` on the page's own origin,
with your Reddit session), up to 100 posts in one request and two requests at a
time, once per post each time presentation mode opens; YouTube posts are never
asked about, since Reddit keeps no copy of them. A tile without a picture then
shows Reddit's preview of the post, its copy about 640 pixels wide, or else the
thumbnail that the player itself names; never the blurred copy that Reddit keeps
of an NSFW picture, and a tile loops Reddit's copy of the clip where the data
names one. A still that fails to load leaves the card, and the post stays. After
three failed requests in a row, such as a challenge page instead of data, the
grid stops asking until presentation mode opens again. The slideshow is
unchanged: it still loads the player.

The **Show** checkboxes in the settings panel choose which media the slideshow
and the grid show: images, GIFs, and videos. The **images**, **GIFs**, and
**videos** buttons in the bottom-left controls do the same, as does O: a lit
button's type is shown, and a struck-through one is hidden. GIFs include imgur
GIF and GIFV links, which play as video, and videos that Reddit's player marks
as GIFs. Link and text posts appear only while all three are on, and one type
always stays on, so the last lit button, like the last ticked box, cannot be
turned off. The buttons stay in the controls in the grid, and also while a
filter hides every loaded post. With images only, a link post's preview picture
does not count as an image. While a filter is on, the slide counter says so, as
in `3 / 12 · images only`, and a dot marks the gear button, or the + button when
the controls are collapsed. Loading more posts keeps scrolling Reddit until a
matching post arrives, and gives up after 15 batches of new posts without a
match, or when Reddit adds nothing for 12 seconds. After such a search, the
slideshow looks again only from its last post, where next then wraps at once, or
once the filter changes. Search results that show only a thumbnail stay until
their post is read, then drop out if they do not match. The choice is saved with
the other settings.

Pictures and videos that fail to load leave the slideshow and the grid instead
of turning into an "Image unavailable" card, and the slide counter says how many
did, as in `4 / 12 · 2 unavailable`. Deleted Reddit-hosted pictures (i.redd.it
and its preview hosts) and deleted imgur pictures count as failed too, even
though those hosts answer with a small placeholder picture. Presentation mode
remembers the failures until the tab reloads, so opening it again leaves them
out at once, and when every loaded post has failed it loads more posts. Search
results that show only a thumbnail keep their card until their post is read, and
stream formats the browser cannot play keep their link card.

Open the gear button's settings panel for a keyboard shortcut reference. Use the
gear button in the bottom-left controls to choose the auto-advance duration and
which media types to show (the images, GIFs, and videos buttons beside it change
the same setting), keep users, subreddits, and sites out with the Hidden list,
hide the title panel, navigation arrows, or close button, show or hide the
bottom panel, open in grid view, and show or hide the archive icon on subreddit
pages. The gear is part of the expandable panel, so compact mode leaves only a
small expand button. If the close button is hidden, press Escape from the
slideshow to close presentation mode. These preferences are saved by your
browser and used the next time presentation mode opens. The **redditp** link
opens this README on GitHub.

These are bare keys only. Any combination holding Ctrl, Cmd, or Alt passes
through to the browser, so Ctrl+F and friends keep working while presentation
mode is open.

The slideshow loads more posts before it runs out. Once fewer than 8 slides are
left after the current one, it scrolls the underlying Reddit feed in the
background and adds the newly rendered posts without moving the slideshow, up to
4 loads in a row. The pictures of the next 6 slides are fetched early too, and
the files of the next one or two Reddit-hosted videos among them are read in
ahead, muted and paused, so that they show and start at once with the usual
sound setting; a video read in ahead is let go once the slideshow is no longer
before it. None of this happens when the browser asks to save data. A load
scrolls Reddit to the end again about once a second and waits up to 12 seconds
for new posts before treating the feed as ended, so a slow feed still gets
through. The slide counter shows `loading more` only on the last post, while a
load is still running; pressing next there queues the move. If Reddit then adds
nothing for 12 seconds, the slideshow wraps to the first slide, and once the
feed is known to have ended, next on the last slide wraps at once. Single-post
`/comments/` pages do not trigger this feed-loading scroll. Closing presentation
mode scrolls the Reddit page back to where it was.

Chrome lets users change the shortcut at `chrome://extensions/shortcuts`.
Firefox does it in `about:addons` under the gear menu's **Manage Extension
Shortcuts**.

## The Hidden list

The **Hidden** list in the settings panel keeps the posts of users, subreddits,
and sites out of the slideshow and the grid, on every page and in the archive,
whatever the Show filter shows. Press X to add the author of the current slide,
or in the grid of the tile under the mouse pointer, or else of the focused tile;
after Tab moves focus, X goes by the focused tile until the mouse moves again.
Their posts leave at once: the slideshow moves on to the next post shown, and
the grid's other tiles stay where they are. A message such as `Hid u/name`
offers **Undo** for six seconds, and for as long as it is pointed at or focused;
Undo, or Z, brings the posts back exactly where they were, and the slideshow
back to the hidden post unless it has moved on since. X on a post without an
author, such as a deleted account's, says so instead, and X typed into a text
field stays there.

In the settings, type `u/name`, `r/name`, or a site such as `redgifs.com`, and
press Enter or **Add**. A leading `/` and `user/` work too, a word without a dot
is a user (Reddit's usernames have none), and anything with a dot is a site,
kept without `www.`; a reddit.com address of a user or a subreddit adds that
user or subreddit. Anything else stays in the field with a message. The × beside
an entry takes it off, and its posts come back at once. A site covers its
subdomains: `redgifs.com` hides `www.redgifs.com` and `v3.redgifs.com`, but not
`notredgifs.com`. Matching ignores case. A post matches by its author, its
subreddit, or the host of the link it posts, or of its media when it posts no
link; a search result that shows only a thumbnail matches by site only once its
post is read.

The list holds up to 1,000 entries and is saved with the other settings. Each
opening of presentation mode, or of the archive's viewer, reads it again, so a
change made in another tab applies the next time it opens. The slide counter
says how many of the loaded posts the list leaves out, as in
`3 / 12 · 5 hidden`. As with the Show filter, loading more posts searches on
past hidden posts and gives up after 15 batches without one to show, and when
nothing is left to show, the empty stage says that the list is why. The archive
reads on past hidden posts too, so each batch it hands over still holds as many
posts to show.

## Archive mode

The archive page, `archive.html`, browses a subreddit's whole history ranked by
score, which a Reddit listing cannot do past its first thousand or so posts. It
pulls the posts from the [Arctic Shift](https://arctic-shift.photon-reddit.com)
archive into the browser's own storage (IndexedDB) and shows them in the same
slideshow and grid as presentation mode, with the same keys, buttons, Show
filter, and Hidden list. A GIF post plays as the MP4 that Reddit made of the
GIF, which is a fraction of its size. Posts stored before the archive kept
Reddit's copies of RedGIFs and imgur clips have none, so their tiles stay still
until the archive is deleted and pulled again. A gallery's JPEG and WebP
pictures load from i.redd.it, which serves them at once, rather than from
preview.redd.it's full-size copies, which that host makes on demand and which
can take seconds to start.

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
- **Top of what's stored** ranks everything stored so far in the date range, and
  can start as soon as one post is stored. Posts that arrive while you browse
  are slotted in by score among what you have not seen yet, so what you have
  seen never moves; Browse and Start over rank everything stored at that moment.

The panel of the open subreddit has:

- **Date range**: all, the past year, the past month, or custom dates, in UTC. A
  narrower range stops the pull once it is stored; a wider one pulls on.
- **Minimum score**: posts below it are left out.
- **Order**: newest stretches first, or top of what's stored.
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
for less when a request times out. After being asked to slow down, the pull
stays slower for a while, down to one request every eight seconds, and speeds up
again as pages keep arriving.

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

A gallery on current Reddit names each picture's full-size copy on
preview.redd.it. For a JPEG or WebP (`format=pjpg`), redditp loads the uploaded
file from i.redd.it instead, since preview.redd.it makes those copies on demand
and a first request for one can take seconds; a PNG keeps its copy, since its
original can weigh far more.

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
