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
   generic URL-shape rule (`/watch/<id>` → `/ifr/<id>`) and names no third-party
   site anywhere in the package. Do not add host names back to the listing, the
   description, the manifest, or the source comments — not even in a "supported
   sites" list, which is what made the first version read as keyword spam in the
   first place.

Neither the shipped code nor the listing copy below currently contains any such
name. Run this after packaging and before every submission — it scans the staged
upload, which is the only set of files a reviewer sees. (Scanning
`chrome-extension/` instead would match this page, which quotes the very words
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

The extension runs only on reddit.com, uses your existing Reddit session, and
sends nothing anywhere else. It presents the posts your own Reddit account and
settings already show you on the page.

## Single purpose

Present the posts on the Reddit page the user is currently viewing as a
full-screen slideshow.

## Permission justifications

- **scripting**: injects the slideshow into the Reddit tab when the user clicks
  the toolbar button or presses the keyboard shortcut.
- **storage**: saves the user's slide timing and presentation-control choices
  locally in Chrome.
- **Host permission for reddit.com**: the extension reads the posts rendered on
  the Reddit page in order to build the slideshow, and the same permission lets
  it fetch a post's own Reddit page when a search result shows only a small
  thumbnail.
- **Content script on reddit.com**: a small script checks whether the address
  carries the opt-in `redditp=1` parameter, so a bookmark or link can open the
  slideshow directly. It reads nothing else and does nothing on any other
  address.

Mention the content script explicitly. It runs on every reddit.com page load, so
a reviewer comparing the manifest against a justification that only described
click-to-activate would find behavior the listing did not disclose.

## Submission checklist

- Run the grep above; it must return nothing.
- `npm run package:extension`, then upload
  `build/redditp-extension-v<version>.zip`.
- Screenshots must show ordinary subreddits. Nothing in a screenshot should need
  a content rating the listing does not declare.
- Set the maturity rating honestly: the extension displays whatever the user's
  own Reddit account shows, so answer the "mature content" question according to
  how you actually expect it to be used.
- Keep the icon at a real 128x128 (`icon-128.png`); an upscaled smaller image
  reads as low quality in review.
