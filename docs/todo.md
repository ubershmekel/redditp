# Repo Health Todo

Prioritized list of issues to address, highest priority first.

---

## 1. Consolidate domain/URL detection into EmbedIt (CRITICAL)

Domain matching happens in at least three places today:

- `EmbedIt.js` convertor `detect` regexes
- `script.js` `transformRedditData` long if-else chain (lines 330–414) using
  `.indexOf()` and `.search()`
- `script.js` `tryConvertUrl` / `createDiv` branching

The note "DO NOT ADD DOMAINS HERE" appears three times because the author knew
this was wrong but never fixed it. The fix: all domain detection should live in
`EmbedIt.js` using consistent key-value convertor objects with `detect` regex +
`convert` function. Remove the duplicated logic from `script.js`.

---

## 2. Refactor the three near-identical AJAX handlers (CRITICAL)

`getRedditImages` and `getImgurAlbum` each define their own `handleData` and
`failedAjax` closures. A third variant handles test fixtures. ~150 lines of
duplicated structure. Extract a shared `fetchJson(url, onSuccess, onError)`
helper and shared error/cleanup logic.

---

## 3. Split script.js into modules (HIGH)

At 1413 lines, `script.js` handles UI rendering, state management, data
fetching, event handling, cookie persistence, video/audio control, and history
management — all in one `$(function())` closure, making everything untestable
and hard to navigate. Suggested splits:

- `state.js` — `rp` object init and accessors
- `api.js` — Reddit and Imgur fetch logic
- `slides.js` — slide creation, gallery logic, `addImageSlide`, `createDiv`
- `controls.js` — keyboard/touch/mouse event handlers
- `settings.js` — cookie persistence, settings panel updates

---

## 4. Fix `galleryOffset` global (HIGH)

`galleryOffset` (script.js line 11) is the only state variable outside the `rp`
namespace, violating the existing `// TODO: refactor globals into rp`
convention. Move it to `rp.session.galleryOffset`.

---

## 5. Replace `transformRedditData` if-else chain with data-driven dispatch (HIGH)

The 10-branch if-else at lines 330–414 is hard to extend and test. Replace with
an ordered array of `{ detect, transform }` handler objects (same pattern as
EmbedIt convertors). Each domain handler returns a normalized photo object or
`null`.

---

## 6. Fix misleading `async` functions (HIGH)

`startAnimation` (line 691), `toggleNumberButton` (line 730), and `skipGallery`
(line 961) are marked `async` but contain no `await` and return no meaningful
promises. Remove `async` or properly await their sub-operations and add
`.catch()` handling.

---

## 7. Extract `addImageSlide` into two functions (MEDIUM)

`addImageSlide` (lines 411–503, 92 lines) handles gallery items and single
images via deeply nested branching with completely different logic paths. Split
into `addGallerySlide` and `addSingleSlide`.

---

## 8. Standardize variable naming (MEDIUM)

- `pic` vs `photo` — both mean the same image object; pick one
- `imageIndex` vs `index` — same concept, different names across call sites
- Function naming is inconsistent (`showImage`, `startAnimation`,
  `slideBackgroundPhoto`)

---

## 9. Remove dead/commented-out code (MEDIUM)

~90 lines of commented-out code:

- `rp.flattenRedditData` (lines 1352–1394) — never called
- Audio sync block (lines 917–945) — "I'm ashamed of the spaghetti"
- EmbedIt.js video block (lines 37–58)
- Scattered `setTimeout` and other dead lines

Delete them. Git history preserves everything.

---

## 10. Cache DOM queries for video/audio (LOW)

`updateSound` (line 273) calls `getElementsByTagName('video')` and
`getElementsByTagName('audio')` on every invocation. Cache the current slide's
media element reference when the slide is activated.

---

## 11. Remove IE/obsolete CSS (LOW)

- `-ms-filter` and `filter` IE hacks (style.css lines 126–129)
- `cursor: hand` (lines 213, 234, 250) — obsolete, should be `cursor: pointer`
  only
- Unused background-image classes `.cam`, `.key`, `.flowers` (lines 197–204)

---

## 12. Add ARIA labels and semantic HTML (LOW)

Navigation controls lack `aria-label`. Only one element has an aria attribute.
The navbox/collapser structure uses generic divs throughout. Low urgency but
worth a pass once the JS structure is cleaner.
