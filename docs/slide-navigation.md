# Slide Navigation Design

## Overview

redditp is a slideshow viewer for Reddit content. Navigation moves through a
flat list of photos (`rp.photos[]`), which may include individual images and
multi-image gallery posts expanded inline.

---

## Data Model

Each entry in `rp.photos[]` is a photo object. Gallery posts expand into
multiple consecutive entries, each annotated with:

- `photo.data.is_gallery` — true on the first item of a gallery post
- `photo.galleryItem` — 1-based index within the gallery (e.g. 3 of 5)
- `photo.galleryTotal` — total number of items in the gallery

Non-gallery posts have no `galleryItem` / `galleryTotal` fields.

A global `galleryOffset` counter tracks how many extra entries galleries have
added, so that the sidebar number buttons show post numbers (not photo-array
indices).

---

## Navigation Actions

### Next slide — `→`, `↓`, `Space`, `S`, swipe left/up, Next button

Calls `nextSlide(skipCount = 1)`, which delegates to `getNextSlideIndex` and
then `startAnimation`.

`getNextSlideIndex` handles:

- NSFW filtering — skips over `over18` photos when the NSFW setting is off
- Wrap-around — returns index 0 when the end of the list is reached and no more
  images are loading

### Previous slide — `←`, `↑`, `W`, `PageUp`, swipe right/down, Prev button

Calls `prevSlide()`. Steps back by 1, skipping NSFW content when filtered.
Clamps to index 0.

### Skip gallery — `G`

Advances to the next slide. When on a gallery item, skips the rest of that
gallery in one keypress; otherwise advances by 1 (equivalent to pressing `→`).

### Auto-play — `A` toggle

When enabled, `autoNextSlide` fires after `rp.settings.timeToNextSlide` ms via
`setTimeout`. Videos additionally trigger `nextSlide()` on their `ended` event
when auto-play is on (and are not looped in that mode).

---

## Keyboard Reference

| Key                                    | Action                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| `→` / `↓` / `Space` / `S` / `PageDown` | Next slide                                               |
| `←` / `↑` / `W` / `PageUp`             | Previous slide                                           |
| `G`                                    | Next slide; skips rest of gallery when on a gallery item |
| `A`                                    | Toggle auto-play                                         |
| `C`                                    | Toggle controls panel                                    |
| `T`                                    | Toggle title bar                                         |
| `F`                                    | Toggle full screen                                       |
| `M`                                    | Toggle sound                                             |
| `I`                                    | Open image source in background tab                      |
| `U`                                    | Open user slideshow in background tab                    |
| `R`                                    | Open Reddit comments in background tab                   |

Touch: swipe left/up → next, swipe right/down → previous (20 px minimum).

---

## Session State

| Field                           | Purpose                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `rp.session.activeIndex`        | Index of the currently displayed photo                                    |
| `rp.session.nextSlideTimeoutId` | Timer handle for auto-play                                                |
| `rp.session.loadingNextImages`  | True while a network fetch is in flight; suppresses premature wrap-around |
| `rp.session.foundOneImage`      | Set on first successful image load                                        |
