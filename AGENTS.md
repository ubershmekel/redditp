# AGENTS.md

## Purpose

This repo is old, inconsistent, and still actively used. Treat compatibility as
a product requirement, not a cleanup casualty.

Future edits should preserve existing behavior unless the change explicitly says
otherwise.

## Compatibility Baseline

Use the real traffic mix from the 28 days ending **2026-04-06** as the default
compatibility contract for changes:

- Resolutions with meaningful traffic:
  - `1920x1080`: ~15K views
  - `412x915`, `2560x1440`, `390x844`, `393x852`, `360x780`: mostly ~5K-7K
- Operating systems:
  - Android: ~64K
  - Windows: ~38K
  - iOS: ~32K
  - macOS: ~14K
  - Linux: ~3.8K
  - ChromeOS: ~1.6K
- Browsers:
  - Chrome: ~109K
  - Safari: ~16K
  - Firefox: ~11K
  - Edge: ~5K
  - Opera: ~4K
  - Samsung Internet: ~3K
- Top observed browser versions:
  - Chrome `145.0.7632.159`, `146.0.7680.164`, `145.0.7632.160`,
    `146.0.7680.119`, `146.0.7680.151`, `146.0.7680.165`, `146.0.7680.153`,
    `146.0.7680.80` (146 is current, so at most one version back from current)
  - Firefox `148.0` (lagging, 149 released 2 weeks ago)
  - Safari `26.3` (current, 26 released 7 months ago)

## Support Expectations

### Required

Edits must remain functional for:

- Chrome on Android and desktop
- Safari on iPhone/iPad and macOS
- Firefox on desktop
- Edge on desktop
- Samsung Internet on Android

### Expected

Edits should continue to work on:

- Opera
- Linux desktop browsers
- ChromeOS Chromium-based browsers

## Authoring Rules For Changes

### JavaScript

- Default to plain, conservative JavaScript that runs without a build step.
- Do not assume transpilation, bundling, or polyfills exist unless you add and
  justify them.
- Feature-detect newer APIs before using them.
- If a modern API lacks solid Safari or Firefox support, provide a fallback.
- Preserve existing keyboard behavior, touch behavior, and deep-link behavior.

### CSS / Layout

- Design for both desktop and mobile first-class; this is not a desktop-only
  app.
- Verify core UI at these sizes at minimum:
  - `360x780`
  - `390x844`
  - `393x852`
  - `412x915`
  - `1920x1080`
  - `2560x1440`
- Avoid fragile viewport-height assumptions. Mobile browser chrome changes
  available height, and some traffic shows unusually constrained viewports.
- Do not make hover-only interactions necessary for core actions.
- Keep controls usable with touch targets and without precision pointing.

### HTML / Accessibility / Interaction

- Keep basic navigation usable with keyboard and touch.
- Do not make core actions depend on autoplay, fullscreen, or sound being
  available.
- Preserve graceful degradation when third-party scripts fail or are blocked.
- Prefer additive enhancement over rewrites of old working behavior.

## Change Risk Rules

Be extra conservative when touching:

- `index.html`
- `js/script.js`
- `js/EmbedIt.js`
- `css/style.css`
- routing or rewrite config such as `vercel.json`, `_redirects`, `.htaccess`

These files affect the broadest compatibility surface.

## Validation Checklist

For any non-trivial UI or behavior change, verify at least:

- Initial page load still works from a routed URL such as `/r/pics`
- Slide navigation still works with mouse, keyboard, and swipe/touch
- Controls remain reachable on mobile-sized screens
- Core links still open correctly
- No console-breaking syntax is introduced in Chrome, Safari, or Firefox

If full cross-browser testing is not performed, say so explicitly in the final
handoff.
