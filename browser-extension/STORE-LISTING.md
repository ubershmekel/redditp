# Chrome Web Store listing copy

Paste these exact fields into the Web Store dashboard.

## History, and what not to reintroduce

Two rejections shaped this copy. Read this section before editing anything below
it.

1. **Keyword spam.** An early listing ended in a long comma-separated pile of
   media formats and host names instead of describing what the extension does.
   Do not reintroduce a list like that.
2. **An adult-site name in the submission.** The listing and the code both named
   a specific video host. The extension now recognizes that host through a
   generic URL-shape rule (`/watch/<id>` → `/ifr/<id>`) and names no such site
   anywhere in the package. Do not add host names back to the listing, the
   description, the manifest, or the source comments — not even in a "supported
   sites" list, which is what made the first version read as keyword spam in the
   first place.

Archive mode adds one site name to the package, and it has to: the public
archive the archive page reads posts from, `arctic-shift.photon-reddit.com`.
`archive.js` sends its requests there, and `archive.html` names it so the user
knows where the posts come from. Only the archive page talks to it, and only
once the user opens that page; nothing else is sent anywhere. None of the words
the grep below looks for appears in it.

Neither the shipped code nor the listing copy below currently contains any such
name. Run this after packaging and before every submission — it scans the staged
upload, which is the only set of files a reviewer sees. (Scanning
`browser-extension/` instead would match this page, which quotes the very words
it is searching for and is not shipped.)

    grep -ril "redgif\|gfycat\|nsfw\|porn\|adult" build/chrome-extension/

## Name

Presentation Mode for Reddit

The brand goes in the descriptive position. A name that _leads_ with another
company's trademark ("redditp Presentation Mode") risks a trademark or
impersonation rejection, which matters most on a brand-new listing that gets a
full first-time review.

## Short description (132 char limit)

Turn the Reddit page you are browsing into a full-screen slideshow.

## Detailed description

Presentation Mode for Reddit turns the Reddit page you already have open into a
full-screen slideshow.

Click the toolbar button or press Alt+P on a Reddit feed, subreddit, search
result, or post page. The extension reads the posts that are already on screen
and presents them one at a time, with the title, community, and a link back to
the comments.

Navigate with the arrow keys, Page Up and Page Down, or by swiping. Choose Auto
to advance automatically, press M to unmute video, F for browser fullscreen, and
Escape to return to Reddit. A settings panel lets you choose the slide duration
and hide the title, arrows, or close button, or compact the bottom controls;
these preferences persist in Chrome. Escape closes presentation mode from the
slideshow even when its close button is hidden.

You can also start the slideshow straight from a link: add redditp=1 to any
Reddit address and the page opens in presentation mode by itself.

Archive mode reaches further back than Reddit's own listings, which stop after
about a thousand posts. The archive button in the slideshow, or a small icon in
the corner of a subreddit's pages, opens a page that browses the subreddit's
whole history ranked by score, within the dates you choose. The posts are kept
in your browser, so a later visit picks up where you left off. The icon can be
hidden in the settings.

The extension runs only on reddit.com and uses your existing Reddit session; the
slideshow presents the posts your own Reddit account and settings already show
you on the page. Only the archive page talks to anything else: when you open it,
it asks the public Arctic Shift archive (arctic-shift.photon-reddit.com) for
that subreddit's posts, sending the subreddit's name and the dates it needs,
without cookies. Pictures and videos load from wherever each post links them, as
they do on Reddit. Nothing else is sent anywhere.

## Single purpose

Present the posts on the Reddit page the user is currently viewing, or a
subreddit's archived posts, as a full-screen slideshow.

## Permission justifications

- **activeTab**: granted only by the user's own click on the toolbar button or
  press of the keyboard shortcut. It lets the extension see that tab's address,
  so it can confirm the page is a reddit.com page before starting the slideshow
  and show a hint on the toolbar icon when it is not.
- **scripting**: injects the slideshow into the Reddit tab when the user clicks
  the toolbar button or presses the keyboard shortcut.
- **storage**: saves the user's slide timing and presentation-control choices,
  including whether to show the archive icon, locally in Chrome. The archive
  page keeps the archived posts the user asked for in the browser's own storage
  (IndexedDB).
- **Host permission for reddit.com**: the extension reads the posts rendered on
  the Reddit page in order to build the slideshow, and the same permission lets
  it fetch a post's own Reddit page when a search result shows only a small
  thumbnail.
- **Content script on reddit.com**: a small script checks whether the address
  carries the opt-in `redditp=1` parameter, so a bookmark or link can open the
  slideshow directly. On a subreddit's listing pages it also shows a small
  archive icon, styled by a stylesheet that touches nothing else, which opens
  that subreddit's archive page in a new tab. It reads the extension's own saved
  setting, so the user can hide the icon, and follows the address as Reddit
  changes pages. It reads nothing from the page itself.

Mention the content script explicitly. It runs on every reddit.com page load, so
a reviewer comparing the manifest against a justification that only described
click-to-activate would find behavior the listing did not disclose.

## Submission checklist

- Run the grep above; it must return nothing.
- `npm run ext:package`, then upload `build/redditp-extension-v<version>.zip`.
- Screenshots must show ordinary subreddits. Nothing in a screenshot should need
  a content rating the listing does not declare.
- Set the maturity rating honestly: the extension displays whatever the user's
  own Reddit account shows, so answer the "mature content" question according to
  how you actually expect it to be used.
- Keep the icon at a real 128x128 (`icon-128.png`); an upscaled smaller image
  reads as low quality in review.
