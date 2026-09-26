(function redditpContentScript() {
  "use strict";

  if (window.__redditpPresentation) {
    window.__redditpPresentation.toggle();
    return;
  }

  // Reloading or updating an unpacked extension creates a fresh isolated
  // JavaScript world, so the marker above is no longer visible even though an
  // older presentation can still be mounted in the page. Retire cooperating
  // versions first, then click older versions' close buttons so they restore
  // any live Reddit video they moved into their overlay.
  document.dispatchEvent(new Event("redditp:presentation-retire"));
  Array.from(
    document.querySelectorAll("#redditp-presentation.redditp"),
  ).forEach((staleRoot) => {
    const staleClose = staleRoot.querySelector(".redditp__close");
    if (staleClose && typeof staleClose.click === "function") {
      staleClose.click();
    }
    staleRoot.remove();
  });

  // A page that hosts the viewer says so with <meta name="redditp-host">. It
  // opens the viewer itself, on a source of posts it hands over, rather than
  // having the viewer read the page as a Reddit feed.
  const EMBEDDED = Boolean(document.querySelector("meta[name='redditp-host']"));

  const SPECIFIC_POST_SELECTOR = [
    "shreddit-post",
    ".thing.link",
    ".search-result.search-result-link",
    "[data-id='search-media-post-unit']",
    "[data-testid='search-post-unit']",
    "[data-testid='post-container']",
  ].join(",");
  const POST_SELECTOR = `${SPECIFIC_POST_SELECTOR},article`;
  const FOCUSABLE_SELECTOR =
    "a[href], button:not([disabled]), input:not([disabled]), video[controls], iframe";
  const MIN_EXPAND_IMAGE_LONG_EDGE = 1000;
  const MIN_EXPAND_IMAGE_SHORT_EDGE = 600;
  const SETTINGS_KEY = "redditpPresentationSettings";
  // The one embed origin that publishes a message protocol for controlling
  // its player. Every other player keeps its own sound control.
  const JS_API_EMBED_ORIGIN = "https://www.youtube.com";
  const README_URL =
    "https://github.com/ubershmekel/redditp/blob/main/browser-extension/README.md";
  const DEFAULT_SETTINGS = {
    slideDurationSeconds: 6,
    showDetails: true,
    showArrows: true,
    showClose: true,
    showControls: true,
    sound: false,
    openInGrid: false,
    // The archive icon on a subreddit's pages, which auto-activate.js shows
    // and reads this setting for. The archive button and H ignore it.
    showArchiveLauncher: true,
    // The Show filter: which media types the slideshow and the grid show.
    showImages: true,
    showGifs: true,
    showVideos: true,
  };

  // redditp-grid-layout:start
  // Layout math for the grid view. This block stays DOM-free, so
  // nodejs/test-embedit.js can evaluate it on its own. Heights are measured in
  // column widths (tile height / column width): every column is equally wide,
  // so placing a tile needs no layout reads and works while the grid is
  // display:none.
  const GRID_MIN_COLUMN_WIDTH = 300;
  const GRID_MIN_COLUMNS = 2;
  const GRID_MAX_COLUMNS = 8;

  function gridColumnCount(width) {
    if (!Number.isFinite(width)) return GRID_MIN_COLUMNS;
    return Math.min(
      GRID_MAX_COLUMNS,
      Math.max(GRID_MIN_COLUMNS, Math.floor(width / GRID_MIN_COLUMN_WIDTH)),
    );
  }

  // The first shortest column, so ties fill from the left.
  function shortestColumn(heights) {
    let shortest = 0;
    for (let index = 1; index < heights.length; index += 1) {
      if (heights[index] < heights[shortest]) shortest = index;
    }
    return shortest;
  }

  // A tile's height in column widths. Panoramas and very tall images are
  // cropped to a sensible range; a tile of unknown size starts square.
  function tileHeightRatio(width, height) {
    const known = (value) => Number.isFinite(value) && value > 0;
    if (!known(width) || !known(height)) return 1;
    return Math.min(2, Math.max(0.5, height / width));
  }

  // Places tiles in order, each in the shortest column so far. A tile's
  // column depends only on the tiles before it, so appending tiles never
  // moves the earlier ones.
  function layoutColumns(tileHeights, columnCount) {
    const heights = [];
    for (let index = 0; index < Math.max(1, columnCount); index += 1) {
      heights.push(0);
    }
    const columns = tileHeights.map((height) => {
      const column = shortestColumn(heights);
      heights[column] += height;
      return column;
    });
    return { columns, heights };
  }
  // redditp-grid-layout:end

  // redditp-media-filter:start
  // Media types for the Show filter. Like the grid layout block, this stays
  // DOM-free and self-contained, so nodejs/test-embedit.js can evaluate it on
  // its own.
  const GIF_URL_RE = /\.gif(?:$|[?#])/i;
  // Each type's setting key and the label the counter and messages use.
  const MEDIA_FILTER_TYPES = [
    ["showImages", "images"],
    ["showGifs", "GIFs"],
    ["showVideos", "videos"],
  ];

  // A slide's media type: "image", "gif", "video", or "link" for link cards,
  // text posts, and anything else that is not media of its own. A GIF is a
  // picture or video served from a .gif URL, or a video converted from one
  // (Reddit's mp4 rendition, an imgur GIFV).
  function mediaCategory(kind, url, fromGif) {
    if (kind === "image" || kind === "video") {
      return fromGif || GIF_URL_RE.test(url || "") ? "gif" : kind;
    }
    if (
      kind === "native-video" ||
      kind === "pending-native-video" ||
      kind === "embed"
    ) {
      return "video";
    }
    return "link";
  }

  function mediaFilterActive(settings) {
    return !(settings.showImages && settings.showGifs && settings.showVideos);
  }

  // A later include/exclude list of domains would test the host of
  // slide.sourceUrl, falling back to slide.url and slide.commentsUrl, let
  // mediaUnknown slides through as well, and apply whenever the media filter
  // is active or a domain list is set.
  function slideMatchesFilter(slide, settings) {
    if (!mediaFilterActive(settings)) return true;
    // A search result that shows only a thumbnail stands in for its post
    // until enrichSlide has read the post.
    if (slide.mediaUnknown) return true;
    // A preview picture scraped from a link post's card is not the post's
    // own media. Reddit's own players are added without postMedia, so the
    // check stays with pictures.
    if (slide.postMedia === false && slide.kind === "image") return false;
    if (slide.media === "image") return Boolean(settings.showImages);
    if (slide.media === "gif") return Boolean(settings.showGifs);
    if (slide.media === "video") return Boolean(settings.showVideos);
    // Link and text posts need every type on.
    return false;
  }

  // The counter's note: "images only" with one type on, "no GIFs" with two,
  // and nothing when every type (or, by mistake, none) is on.
  function mediaFilterSummary(settings) {
    const shown = MEDIA_FILTER_TYPES.filter(([key]) => settings[key]);
    if (shown.length === 1) return `${shown[0][1]} only`;
    if (shown.length === 2) {
      const hidden = MEDIA_FILTER_TYPES.find(([key]) => !settings[key]);
      return `no ${hidden[1]}`;
    }
    return "";
  }

  // The shown types in words: "images", "images or GIFs", "images and
  // videos", "images, GIFs and videos".
  function shownMediaLabel(settings, conjunction) {
    const labels = MEDIA_FILTER_TYPES.filter(([key]) => settings[key]).map(
      ([, label]) => label,
    );
    if (labels.length < 2) return labels.join("");
    return `${labels.slice(0, -1).join(", ")} ${conjunction} ${labels[labels.length - 1]}`;
  }

  // O steps through everything, images only, GIFs only, videos only, and
  // back to everything. Any other mix goes back to everything. Returns the
  // three settings to apply.
  function nextMediaFilter(settings) {
    const shown = MEDIA_FILTER_TYPES.filter(([key]) => settings[key]);
    let only = -1;
    if (shown.length === MEDIA_FILTER_TYPES.length) {
      only = 0;
    } else if (shown.length === 1) {
      only = MEDIA_FILTER_TYPES.indexOf(shown[0]) + 1;
      if (only >= MEDIA_FILTER_TYPES.length) only = -1;
    }
    const result = {};
    MEDIA_FILTER_TYPES.forEach(([key], index) => {
      result[key] = only < 0 || index === only;
    });
    return result;
  }

  // At least one type always shows: the key of the only type still on,
  // which cannot be turned off, or "" while two or three are on.
  function lockedMediaType(settings) {
    const shown = MEDIA_FILTER_TYPES.filter(([key]) => settings[key]);
    return shown.length === 1 ? shown[0][0] : "";
  }
  // redditp-media-filter:end

  // redditp-feed-loading:start
  // When a load of more posts gives up. Like the blocks above, this stays
  // DOM-free, so nodejs/test-embedit.js can evaluate it on its own. A load
  // scrolls Reddit to the end of the page again every LOAD_NUDGE_MS and waits
  // for new posts. Reddit marks no end of its feeds, so a feed that adds no
  // post at all for LOAD_IDLE_MS counts as ended. With a filter on, the new
  // posts may all be hidden; the load then stops after FILTERED_MAX_ROUNDS
  // such batches.
  const LOAD_NUDGE_MS = 1000;
  const LOAD_IDLE_MS = 12000;
  const FILTERED_MAX_ROUNDS = 15;

  // "matched" once the load has a post to show, "rounds" after too many
  // batches of posts the filter hides, "idle" once Reddit has added nothing
  // for LOAD_IDLE_MS, and "wait" while it should keep going.
  function loadVerdict(shown, rounds, idleMs) {
    if (shown > 0) return "matched";
    if (rounds >= FILTERED_MAX_ROUNDS) return "rounds";
    if (idleMs >= LOAD_IDLE_MS) return "idle";
    return "wait";
  }

  // How a load from a source other than the page ends. Such a source hands
  // its posts over itself, so there is no idle window to wait out:
  // "matched" once the load has a post to show, "idle" once the source hands
  // over nothing or has nothing more, "rounds" after too many batches that
  // the filter hides, and "wait" while the load should ask it again.
  function sourceVerdict(shown, found, rounds, hasMore) {
    if (shown > 0) return "matched";
    if (!found || !hasMore) return "idle";
    if (rounds >= FILTERED_MAX_ROUNDS) return "rounds";
    return "wait";
  }

  // The slideshow loads ahead of itself: once fewer than PREFETCH_AHEAD
  // slides follow the current one, more posts load in the background, up to
  // PREFETCH_ROUNDS loads in a row. The pictures of the next PRELOAD_AHEAD
  // slides are fetched early, and the PRELOAD_CACHE_SIZE most recent of them
  // stay referenced until they show.
  const PREFETCH_AHEAD = 8;
  const PREFETCH_ROUNDS = 4;
  const PRELOAD_AHEAD = 3;
  const PRELOAD_CACHE_SIZE = 6;

  // Whether the slideshow should load more posts now. The last post always
  // does. Before it, loading starts once few slides are left, unless the
  // feed is known to have ended.
  function prefetchWanted(slideCount, index, onLastPost, exhausted) {
    if (!slideCount) return false;
    if (onLastPost) return true;
    if (exhausted) return false;
    return slideCount - 1 - index < PREFETCH_AHEAD;
  }

  // The pictures to fetch before the next few slides show: an image's file
  // and a video's poster, each once. Players, embeds, link cards, and search
  // thumbnails that are still to be read are left alone.
  function preloadUrls(slides, index) {
    const urls = [];
    slides.slice(index + 1, index + 1 + PRELOAD_AHEAD).forEach((slide) => {
      if (!slide || slide.needsEnrichment) return;
      let url = "";
      if (slide.kind === "image") {
        url = slide.url;
      } else if (
        slide.kind === "video" ||
        slide.kind === "pending-native-video"
      ) {
        url = slide.poster;
      }
      if (url && !urls.includes(url)) urls.push(url);
    });
    return urls;
  }

  // Stores the value as the map's newest entry, then drops the oldest ones
  // beyond the limit. Returns the dropped values.
  function rememberBounded(map, key, value, limit) {
    map.delete(key);
    map.set(key, value);
    const evicted = [];
    while (map.size > limit) {
      const oldest = map.keys().next().value;
      evicted.push(map.get(oldest));
      map.delete(oldest);
    }
    return evicted;
  }
  // redditp-feed-loading:end

  // redditp-dead-media:start
  // Which media that fails to load leaves the presentation. Like the blocks
  // above, this stays DOM-free, so nodejs/test-embedit.js can evaluate it on
  // its own. The picture that Reddit serves for a deleted image, on i.redd.it
  // and on its preview hosts alike, and imgur's removed.png both load as
  // pictures (Reddit's with an HTTP 404), so they are told by their host and
  // their size.
  const PLACEHOLDER_IMAGES = [
    {
      host: /^(?:i|preview|external-preview)\.redd\.it$/i,
      width: 130,
      height: 60,
    },
    { host: /^(?:i\.)?imgur\.com$/i, width: 161, height: 81 },
  ];

  function isPlaceholderImage(url, width, height) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch (_error) {
      return false;
    }
    return PLACEHOLDER_IMAGES.some(
      (placeholder) =>
        placeholder.host.test(host) &&
        placeholder.width === width &&
        placeholder.height === height,
    );
  }

  // Whether a slide leaves the presentation when its media fails: only a
  // picture or video of its own does. A search thumbnail that is still to be
  // read, a stream format the browser cannot play, a player, an embed and a
  // link card keep their place.
  function dropsWhenDead(slide) {
    return (
      (slide.kind === "image" || slide.kind === "video") &&
      !slide.needsEnrichment &&
      !/\.m3u8(?:$|[?#])/i.test(slide.url || "")
    );
  }

  // The counter's suffix: what the filter shows, how many pictures and
  // videos failed to load, then "loading more".
  function countSuffix(summary, unavailable, loading) {
    return (
      (summary ? ` · ${summary}` : "") +
      (unavailable ? ` · ${unavailable} unavailable` : "") +
      (loading ? " · loading more" : "")
    );
  }
  // redditp-dead-media:end

  // redditp-subreddit-path:start
  // The subreddit whose archive the archive button and the archive icon open:
  // the one that a listing page's path names, spelled as in the path. Post
  // pages, multireddits and the front pages that gather many subreddits have
  // none. content.js and auto-activate.js carry this block word for word, and
  // it stays DOM-free, so nodejs/test-embedit.js can check both copies.
  const ARCHIVE_PSEUDO_SUBS = ["all", "popular", "friends", "mod", "random"];

  function subredditFromPath(pathname) {
    const match = /^\/r\/([A-Za-z0-9_]{2,21})(?:\/|$)/.exec(pathname || "");
    if (!match || /\/comments\/[^/]+/i.test(pathname)) return "";
    return ARCHIVE_PSEUDO_SUBS.includes(match[1].toLowerCase()) ? "" : match[1];
  }
  // redditp-subreddit-path:end

  const state = {
    open: false,
    opening: false,
    // Waiting for Reddit's full-quality player before reading the page.
    preparing: false,
    // Every slide extracted this open, in page order; slides is the part of
    // it the Show filter lets through, and the list everything else reads.
    allSlides: [],
    slides: [],
    index: 0,
    autoTimer: null,
    autoPlaying: false,
    loadingMore: false,
    advanceAfterLoad: false,
    loadRequest: 0,
    openRequest: 0,
    enrichments: new Map(),
    nativeRestores: new WeakMap(),
    oldOverflow: "",
    pointerStart: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    settingsLoaded: false,
    settingsOpen: false,
    embedKeepsOwnSound: false,
    // "slideshow" or "grid".
    view: "slideshow",
    // The slideshow was opened from the grid, so Escape goes back there.
    returnToGrid: false,
    gridBuilt: false,
    // Slide object -> its grid tile.
    gridTiles: new Map(),
    // Running height of each grid column, in column widths.
    gridColumnHeights: [],
    // display:none drops the grid's scroll offset, so it is kept here.
    gridScrollTop: 0,
    gridResizeTimer: null,
    // A load from the grid found no new posts. Cleared when the grid is
    // shown again, so a sentinel left in range stops scrolling Reddit.
    gridExhausted: false,
    // Thumbnail slides waiting for the grid to upgrade them, and how many of
    // those upgrades are in flight.
    gridEnrichQueue: [],
    gridEnrichActive: 0,
    // Failed upgrades in a row; the grid stops asking after a few.
    gridEnrichFailures: 0,
    // Posts the running load has found so far, shown or not.
    loadFound: 0,
    // Set when a load ends because Reddit added nothing for LOAD_IDLE_MS,
    // and cleared when a load finds posts. While it is set, only the last
    // post starts loads, and next on the last slide wraps at once.
    feedExhausted: false,
    // How many loads the running background prefetch has started, the first
    // included; 0 when the running load is not a prefetch.
    prefetchLoads: 0,
    // Pictures fetched ahead of the slideshow: URL -> Image, oldest first.
    preloads: new Map(),
    // Where the Reddit page was scrolled when presentation mode opened.
    pageScrollY: 0,
    // Pictures and videos this open dropped, or left out, because they
    // failed to load.
    unavailable: 0,
  };
  // Grid tile -> { slide, height }, the height in column widths.
  const gridTileInfo = new WeakMap();
  // Watches the grid's thumbnail tiles, where supported.
  let gridObserver = null;
  // Watches the end of the grid, further ahead than the tiles.
  let gridEndObserver = null;
  // The page watch of the load that is waiting for Reddit, if any.
  let feedWatch = null;
  // Post elements already read this open, so a load that looks again and
  // again reads only the posts Reddit has added since.
  let seenPostNodes = new WeakSet();
  // What Reddit adds when it renders more posts: a post element, or a
  // comments link that the fallback in selectPostNodes() would pick up.
  const FEED_GROWTH_SELECTOR = POST_SELECTOR + ",a[href*='/comments/']";
  // Slides the grid has tried to upgrade: once each, per open.
  const gridEnrichTried = new WeakSet();
  // The media keys of the page's pictures and videos that failed to load in
  // this tab, so later opens leave them out. A reload forgets them.
  const liveDeadKeys = new Set();
  const GRID_ENRICH_CONCURRENCY = 2;
  const GRID_ENRICH_MAX_FAILURES = 3;
  // A load can take a while, so the grid starts one within three screens of
  // its end.
  const GRID_LOAD_MARGIN = "300% 0px";

  function absoluteUrl(value) {
    if (!value || value === "#") return "";
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function redditPageUrl(label, kind) {
    if (!label) return "";
    const prefix = kind === "user" ? "u/" : "r/";
    const name = label.startsWith(prefix) ? label.slice(prefix.length) : label;
    if (!name) return "";
    const path = kind === "user" ? "user" : "r";
    return `https://www.reddit.com/${path}/${encodeURIComponent(name)}/?redditp=1`;
  }

  function textOf(element) {
    return element
      ? (element.textContent || "").replace(/\s+/g, " ").trim()
      : "";
  }

  function bestSrcFromSet(srcset) {
    if (!srcset) return "";
    const choices = srcset.split(",").map((part) => {
      const bits = part.trim().split(/\s+/);
      const score = parseFloat(bits[1]) || 0;
      return { url: bits[0], score };
    });
    choices.sort((a, b) => b.score - a.score);
    return choices.length ? choices[0].url : "";
  }

  function trackingData(node) {
    const tracked =
      node.closest("[data-faceplate-tracking-context]") ||
      node.querySelector("[data-faceplate-tracking-context]");
    if (!tracked) return {};
    try {
      return JSON.parse(
        tracked.getAttribute("data-faceplate-tracking-context"),
      );
    } catch (_error) {
      return {};
    }
  }

  function usefulImage(image) {
    if (!image || image.closest("[aria-hidden='true']")) return false;
    const description =
      `${image.getAttribute("alt") || ""} ${image.className || ""}`.toLowerCase();
    if (/avatar|award|emoji|icon|snoo/.test(description)) return false;
    const width =
      Number(image.getAttribute("width")) || image.naturalWidth || 0;
    const height =
      Number(image.getAttribute("height")) || image.naturalHeight || 0;
    return !(width && height && width <= 96 && height <= 96);
  }

  function imageUrl(image) {
    const raw =
      bestSrcFromSet(image.getAttribute("srcset")) ||
      bestSrcFromSet(image.getAttribute("data-lazy-srcset")) ||
      image.currentSrc ||
      image.getAttribute("src") ||
      image.getAttribute("data-lazy-src");
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
    return absoluteUrl(raw.replace(/&amp;/g, "&"));
  }

  function firstHref(node, selectors) {
    for (const selector of selectors) {
      const link = node.querySelector(selector);
      if (link) {
        const href = absoluteUrl(link.getAttribute("href") || link.href);
        if (href) return href;
      }
    }
    return "";
  }

  function commentsUrl(node) {
    const permalink =
      node.getAttribute("permalink") || node.getAttribute("data-permalink");
    return (
      absoluteUrl(permalink) ||
      firstHref(node, [
        "a[data-click-id='comments']",
        "a.comments",
        "a[href*='/comments/']",
      ])
    );
  }

  function postTitle(node) {
    const attributeTitle = node.getAttribute("post-title");
    if (attributeTitle) return attributeTitle.trim();
    const trackedTitle = trackingData(node).post?.title;
    if (trackedTitle) return trackedTitle.trim();
    return (
      textOf(node.querySelector("[slot='title']")) ||
      textOf(node.querySelector("a.title")) ||
      textOf(node.querySelector("a.search-title")) ||
      textOf(node.querySelector("h1, h2, h3")) ||
      textOf(
        node.querySelector(
          "a[href*='/comments/']:not([aria-label*='thumbnail']):not([aria-label='media poster'])",
        ),
      ) ||
      "Reddit post"
    );
  }

  function postBodyText(node) {
    const body = node.querySelector(
      "[slot='text-body'] .md, .usertext-body .md, [data-click-id='text'] .md, [data-post-click-location='text-body']",
    );
    if (!body) return "";
    const text = body.innerText || body.textContent || "";
    return text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function postAuthor(node) {
    const value =
      node.getAttribute("author") || node.getAttribute("data-author");
    if (value) return value.startsWith("u/") ? value : `u/${value}`;
    const author = textOf(node.querySelector("a.author, a[href*='/user/']"));
    return author ? (author.startsWith("u/") ? author : `u/${author}`) : "";
  }

  function postCommunity(node) {
    const value =
      node.getAttribute("subreddit-prefixed-name") ||
      node.getAttribute("data-subreddit-prefixed") ||
      node.getAttribute("data-subreddit");
    if (value) return value.startsWith("r/") ? value : `r/${value}`;
    const trackedCommunity = trackingData(node).subreddit?.name;
    if (trackedCommunity) return `r/${trackedCommunity}`;
    const explicitCommunity = textOf(
      node.querySelector("a.subreddit, a.search-subreddit-link"),
    );
    if (explicitCommunity.startsWith("r/")) return explicitCommunity;
    const community = textOf(
      node.querySelector("a[href^='/r/'], a[href*='reddit.com/r/']"),
    );
    return community.startsWith("r/") ? community : "";
  }

  // redditp-media-urls:start
  // Which URLs are pictures or videos, the key that two URLs of the same file
  // share, and the player frame for a link to a video host. Like the blocks
  // above, this stays DOM-free, so nodejs/test-embedit.js can evaluate it on
  // its own. A page that hosts the viewer reads the same rules from
  // window.__redditpPresentation.media.
  const IMAGE_URL_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
  const VIDEO_URL_RE = /\.(?:m3u8|mp4|webm)(?:$|[?#])/i;

  function isVideoUrl(url) {
    if (VIDEO_URL_RE.test(url)) return true;
    try {
      return new URL(url).searchParams.get("format") === "mp4";
    } catch (_error) {
      return false;
    }
  }

  function canonicalMediaKey(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    } catch (_error) {
      return url;
    }
  }

  function externalMedia(sourceUrl) {
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch (_error) {
      return null;
    }
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === "imgur.com" || hostname === "i.imgur.com") {
      const match = parsed.pathname.match(
        /(?:\/gallery|\/a)?\/([\w]+)(?:\.(\w+))?$/i,
      );
      if (!match || /\/gallery\/|\/a\//.test(parsed.pathname)) return null;
      const extension = (match[2] || "").toLowerCase();
      if (extension === "gifv" || extension === "gif") {
        return {
          kind: "video",
          url: `https://i.imgur.com/${match[1]}.mp4`,
          fromGif: true,
        };
      }
      return {
        kind: "image",
        url: `https://i.imgur.com/${match[1]}.${extension || "jpg"}`,
      };
    }
    if (
      hostname === "youtu.be" ||
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtube-nocookie.com" ||
      hostname.endsWith(".youtube-nocookie.com")
    ) {
      const pathId = parsed.pathname.match(
        /^\/(?:embed|shorts|live)\/([\w-]+)/i,
      );
      const id =
        hostname === "youtu.be"
          ? parsed.pathname.split("/").filter(Boolean)[0]
          : parsed.searchParams.get("v") || pathId?.[1];
      if (id && /^[\w-]+$/.test(id)) {
        const embedParams = new URLSearchParams();
        const start = youtubeStartSeconds(
          parsed.searchParams.get("start") || parsed.searchParams.get("t"),
        );
        if (start) embedParams.set("start", String(start));
        if (parsed.searchParams.get("list")) {
          embedParams.set("list", parsed.searchParams.get("list"));
        }
        // Asking for the player's message protocol is what lets the sound
        // toggle reach this frame later without any extra browser access.
        embedParams.set("enablejsapi", "1");
        const query = embedParams.toString();
        return {
          kind: "embed",
          url: `https://www.youtube.com/embed/${id}${query ? `?${query}` : ""}`,
        };
      }
    }
    // Several video hosts linked from Reddit publish a watch page at
    // /watch/<id> and the matching player frame at /ifr/<id> on the same
    // origin. Follow that convention instead of naming individual sites.
    const framed = parsed.pathname.match(/^\/(?:watch|ifr)\/([\w-]+)\/?$/i);
    if (framed) {
      return { kind: "embed", url: `${parsed.origin}/ifr/${framed[1]}` };
    }
    return null;
  }

  // A slide is meant to start playing on its own, and to start silent unless
  // the viewer asked for sound. Both have to be requested in the URL, because
  // the frame cannot be scripted before it exists. Hosts spell the mute
  // request differently and ignore parameters they do not recognise, so send
  // the common variants. Players that ignore the lot keep their own control.
  function embedUrl(url, muted) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set("autoplay", "1");
      if (muted) {
        parsed.searchParams.set("muted", "1");
        parsed.searchParams.set("mute", "1");
        parsed.searchParams.set("sound", "false");
      } else {
        // Some players default to muted and expose the inverse setting rather
        // than a mute parameter. Unknown parameters are ignored by hosts that
        // use their own controls.
        parsed.searchParams.set("sound", "true");
      }
      return parsed.toString();
    } catch (_error) {
      return url;
    }
  }

  function youtubeStartSeconds(value) {
    if (!value) return 0;
    if (/^\d+$/.test(value)) return Number(value);
    const match = String(value).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!match) return 0;
    return (
      (Number(match[1]) || 0) * 3600 +
      (Number(match[2]) || 0) * 60 +
      (Number(match[3]) || 0)
    );
  }
  // redditp-media-urls:end

  function packagedVideoUrl(player) {
    const raw = player.getAttribute("packaged-media-json");
    if (!raw) return "";
    try {
      const permutations = JSON.parse(raw).playbackMp4s?.permutations || [];
      permutations.sort((a, b) => {
        const aSize =
          (a.source?.dimensions?.width || 0) *
          (a.source?.dimensions?.height || 0);
        const bSize =
          (b.source?.dimensions?.width || 0) *
          (b.source?.dimensions?.height || 0);
        return bSize - aSize;
      });
      return permutations[0]?.source?.url || "";
    } catch (_error) {
      return "";
    }
  }

  function contentUrl(node, fallbackCommentsUrl) {
    const attributeNames = ["content-href", "data-url", "url", "data-href-url"];
    for (const name of attributeNames) {
      const result = absoluteUrl(node.getAttribute(name));
      if (result && result !== fallbackCommentsUrl) return result;
    }
    const result = firstHref(node, [
      "a.search-link",
      "a[data-click-id='body']",
      "a[data-click-id='media']",
      "a.thumbnail",
      "a.title",
      "a[href*='i.redd.it']",
      "a[href*='v.redd.it']",
    ]);
    return result || fallbackCommentsUrl;
  }

  function elementsIncludingOpenShadows(root, selector) {
    const results = Array.from(root.querySelectorAll(selector));
    if (root.shadowRoot) {
      results.push(...elementsIncludingOpenShadows(root.shadowRoot, selector));
    }
    root.querySelectorAll("*").forEach((element) => {
      if (element.shadowRoot) {
        results.push(
          ...elementsIncludingOpenShadows(element.shadowRoot, selector),
        );
      }
    });
    return results;
  }

  function isSinglePostPage() {
    return /\/comments\/[^/]+/i.test(location.pathname);
  }

  function unresolvedAdaptivePlayerExists() {
    return Array.from(
      document.querySelectorAll(
        "shreddit-player[preview]:not([packaged-media-json])",
      ),
    ).some(
      (player) =>
        Boolean(player.getAttribute("preview")) &&
        !elementsIncludingOpenShadows(player, "video").some((video) =>
          (video.currentSrc || video.getAttribute("src") || "").startsWith(
            "blob:",
          ),
        ),
    );
  }

  function adaptiveBlobVideo(root) {
    return elementsIncludingOpenShadows(root, "video").find((video) =>
      (video.currentSrc || video.getAttribute("src") || "").startsWith("blob:"),
    );
  }

  function requestPlayerStart(player) {
    if (!player?.getAttribute("preview")) return false;
    const video = elementsIncludingOpenShadows(player, "video").find(
      (candidate) =>
        !(candidate.currentSrc || candidate.getAttribute("src") || ""),
    );
    if (!video || typeof video.click !== "function") return false;
    video.click();
    return true;
  }

  function requestAdaptivePlayerStart() {
    document
      .querySelectorAll("shreddit-player[preview]:not([packaged-media-json])")
      .forEach(requestPlayerStart);
  }

  async function waitForAdaptivePlayer(request) {
    if (!isSinglePostPage() || !unresolvedAdaptivePlayerExists()) return;
    requestAdaptivePlayerStart();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await wait(100);
      if (!state.open || request !== state.openRequest) return;
      if (!unresolvedAdaptivePlayerExists()) return;
    }
  }

  function isGalleryPost(node) {
    return (
      node.hasAttribute("gallery") ||
      node.getAttribute("post-type") === "gallery" ||
      node.getAttribute("data-is-gallery") === "true" ||
      Boolean(node.querySelector("gallery-carousel, .media-gallery"))
    );
  }

  function oldRedditGalleryLinks(node) {
    const selector = ".media-gallery .gallery-item-thumbnail-link";
    const liveLinks = Array.from(node.querySelectorAll(selector));
    if (liveLinks.length) return liveLinks;

    const links = [];
    node.querySelectorAll(".expando[data-cachedhtml]").forEach((expando) => {
      // Collapsed old-Reddit galleries live in escaped HTML, not child nodes.
      // A template keeps scripts and resources inert; never mount that markup.
      const template = document.createElement("template");
      template.innerHTML = expando.getAttribute("data-cachedhtml") || "";
      links.push(...template.content.querySelectorAll(selector));
    });
    return links;
  }

  function mediaFromNode(node, sourceUrl) {
    const media = [];
    const seen = new Set();
    // postMedia marks the post's own media, as opposed to a preview image
    // scraped out of a listing card for a post that links somewhere else.
    // fromGif marks a video that a host converted from a GIF.
    function add(kind, url, poster, postMedia, fromGif) {
      const normalized = absoluteUrl(url);
      const key = canonicalMediaKey(normalized);
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      media.push({
        kind,
        url: normalized,
        poster: absoluteUrl(poster),
        postMedia: Boolean(postMedia),
        fromGif: Boolean(fromGif),
      });
    }

    // On old Reddit post pages the real adaptive player is already attached
    // to a MediaSource blob. A second video element is only a muted, low-frame
    // rate seek preview, so preserve and reuse the live player when available.
    const nativeVideo = adaptiveBlobVideo(node);
    if (nativeVideo) {
      media.push({
        kind: "native-video",
        url: sourceUrl,
        poster: absoluteUrl(nativeVideo.getAttribute("poster")),
        nativeElement: nativeVideo,
      });
      return media;
    }

    oldRedditGalleryLinks(node).forEach((link) => {
      // The anchor is the full-size image; grid tiles and nested previews are
      // smaller renditions of the same item, not additional gallery slides.
      const url = absoluteUrl(link.getAttribute("href"));
      if (IMAGE_URL_RE.test(url)) add("image", url, "", true);
    });
    if (media.length) return media;

    const galleryFigures = Array.from(
      node.querySelectorAll("gallery-carousel figure"),
    );
    if (galleryFigures.length) {
      galleryFigures.forEach((figure) => {
        const player = figure.querySelector("shreddit-player");
        if (player) {
          add(
            "video",
            packagedVideoUrl(player) ||
              player.getAttribute("preview") ||
              player.getAttribute("src"),
            player.getAttribute("poster"),
          );
          return;
        }
        const image = figure.querySelector("img:not([role='presentation'])");
        if (image && usefulImage(image))
          add("image", imageUrl(image), "", true);
      });
      if (media.length) return media;
    }

    node.querySelectorAll("shreddit-player").forEach((player) => {
      const preview = player.getAttribute("preview") || "";
      const isSeekPreview = /\/CMAF_96\.mp4(?:$|[?#])/i.test(preview);
      const packagedUrl = packagedVideoUrl(player);
      if (!packagedUrl && isSeekPreview && player.ownerDocument === document) {
        media.push({
          kind: "pending-native-video",
          url: absoluteUrl(player.getAttribute("src")) || sourceUrl,
          poster: absoluteUrl(player.getAttribute("poster")),
          playerElement: player,
        });
        return;
      }
      const playablePreview = isSeekPreview ? "" : preview;
      const playerUrl =
        packagedUrl ||
        absoluteUrl(playablePreview) ||
        absoluteUrl(player.getAttribute("src")) ||
        firstHref(player, ["source"]);
      add("video", playerUrl, player.getAttribute("poster"));
    });
    // A shreddit-player may also contain its HLS source element. That is an
    // alternate rendition of the same post, not a second slide (and Chromium
    // cannot play the HLS URL directly).
    if (
      media.some(
        (item) => item.kind === "video" || item.kind === "pending-native-video",
      )
    )
      return media;
    node.querySelectorAll("video").forEach((video) => {
      const source =
        video.currentSrc ||
        video.getAttribute("src") ||
        (video.querySelector("source") &&
          video.querySelector("source").getAttribute("src"));
      add("video", source, video.getAttribute("poster"));
    });
    node.querySelectorAll("source").forEach((source) => {
      const elementSource = source.getAttribute("src");
      if (isVideoUrl(elementSource)) add("video", elementSource);
    });

    // A player poster is not a separate slide. Prefer the actual video when
    // Reddit has exposed any playable source in the listing card.
    if (media.some((item) => item.kind === "video")) return media;

    if (IMAGE_URL_RE.test(sourceUrl)) {
      // Prefer the post's original image over a second, lower-resolution
      // preview of the same image found inside the listing card.
      add("image", sourceUrl, "", true);
    } else {
      node
        .querySelectorAll(
          "gallery-carousel figure img:not([role='presentation']), faceplate-img[data-testid='search_post_thumbnail'], faceplate-img[src], faceplate-img[data-lazy-src], img[data-post-media-primary], img.preview-image, img:not([role='presentation'])",
        )
        .forEach((image) => {
          if (usefulImage(image)) add("image", imageUrl(image));
        });
    }

    if (isVideoUrl(sourceUrl)) add("video", sourceUrl);
    const external = externalMedia(sourceUrl);
    if (external) {
      add(external.kind, external.url, "", true, external.fromGif);
    }
    node.querySelectorAll("iframe[src]").forEach((iframe) => {
      const iframeMedia = externalMedia(iframe.getAttribute("src"));
      if (iframeMedia) {
        add(iframeMedia.kind, iframeMedia.url, "", false, iframeMedia.fromGif);
      }
    });
    return media;
  }

  function selectPostNodes() {
    const candidates = Array.from(
      document.querySelectorAll(POST_SELECTOR),
    ).filter((node) => {
      // Current Reddit wraps shreddit-post in a generic article. Prefer the
      // element that carries the actual post identity and metadata. In the
      // inverse shape (a specific search container wrapping an article), keep
      // the specific outer container.
      if (node.matches("article") && node.querySelector(SPECIFIC_POST_SELECTOR))
        return false;
      const specificParent = node.parentElement?.closest(
        SPECIFIC_POST_SELECTOR,
      );
      return !specificParent;
    });
    if (candidates.length) return candidates;

    const nodes = [];
    const seen = new Set();
    document.querySelectorAll("a[href*='/comments/']").forEach((link) => {
      const node = link.closest("div, li");
      if (node && !seen.has(node)) {
        seen.add(node);
        nodes.push(node);
      }
    });
    return nodes;
  }

  function extractSlides() {
    const slides = [];
    const seenPostMedia = new Set();
    const seenPosts = new Set();
    selectPostNodes().forEach((node) => {
      if (seenPostNodes.has(node)) return;
      if (node.closest("#redditp-presentation")) return;
      const comments = commentsUrl(node);
      const postKey =
        node.id ||
        node.getAttribute("data-fullname") ||
        trackingData(node).post?.id ||
        (comments.match(/\/comments\/([^/]+)/) || [])[1] ||
        "";
      // `article` is only a last-resort compatibility selector. Current
      // Reddit also uses it for unrelated sidebar cards and placeholders; do
      // not turn those into repeated generic "Reddit post" slides.
      const explicitPostNode = node.matches(
        "shreddit-post, .thing.link, .search-result.search-result-link, [data-id='search-media-post-unit'], [data-testid='search-post-unit'], [data-testid='post-container']",
      );
      if (!explicitPostNode && !postKey && !comments) return;
      if (postKey && seenPosts.has(postKey)) return;
      if (postKey) seenPosts.add(postKey);
      // A node without a post identity yet, such as a placeholder, is looked
      // at again next time; this one is done.
      seenPostNodes.add(node);
      const source = contentUrl(node, comments);
      const base = {
        title: postTitle(node),
        body: postBodyText(node),
        author: postAuthor(node),
        community: postCommunity(node),
        commentsUrl: comments,
        sourceUrl: source,
        postKey,
        postNode: node,
      };
      const media = mediaFromNode(node, source);
      if (!media.length)
        media.push({ kind: "link", url: source || comments, poster: "" });
      const isGallery = isGalleryPost(node);
      const needsEnrichment =
        Boolean(comments) &&
        media.length <= 1 &&
        !isSinglePostPage() &&
        (Boolean(
          node.matches(
            "[data-testid='search-post-unit'], .search-result.search-result-link",
          ) &&
          (node.querySelector(
            "faceplate-img[data-testid='search_post_thumbnail']",
          ) ||
            media[0]?.kind === "link"),
        ) ||
          Boolean(
            node.getAttribute("post-type") === "link" &&
            media[0]?.kind === "image",
          ));
      // A search result's thumbnail says nothing about the post's media, so
      // the Show filter judges it only once enrichSlide has read the post.
      // A feed link preview is judged by its preview picture.
      const mediaUnknown =
        needsEnrichment &&
        node.matches(
          "[data-testid='search-post-unit'], .search-result.search-result-link",
        );
      media.forEach((item, mediaIndex) => {
        const key = `${comments || base.title}|${item.url}`;
        if (!seenPostMedia.has(key)) {
          seenPostMedia.add(key);
          slides.push(
            Object.assign({}, base, item, {
              galleryItem: isGallery ? mediaIndex + 1 : 0,
              galleryTotal: isGallery ? media.length : 0,
              needsEnrichment,
              mediaUnknown,
              media: mediaCategory(item.kind, item.url, item.fromGif),
            }),
          );
        }
      });
    });
    return slides;
  }

  // Where the posts come from. By default that is the Reddit page
  // underneath: extractSlides reads it, and loadMorePosts scrolls it and
  // waits for more, so the progress text can count posts as they arrive. A
  // page that hosts the viewer hands open() a source of its own instead:
  //
  //   start({ wants }) resolves to the first batch: { slides, index,
  //     unavailable }, where index is the slide to open at and unavailable
  //     counts media the source left out as known to fail. Meanwhile the
  //     stage shows the source's preparing text.
  //   loadMore({ wants }) resolves to the next batch, the same without
  //     index, and with no slides once the source is finished, paused or
  //     failing. It may be called again before its last batch has arrived.
  //   hasMore() says at once, without waiting, whether a load could find
  //     more. False ends every load straight away.
  //   onDead(slide), onShow(slide) and onClose(), all optional, hear that a
  //     slide's own media failed to load (the viewer has dropped the slide
  //     already), that the slideshow shows a slide, and that the viewer
  //     closed.
  //   text, optional, holds a [heading, text] pair for the empty stage in
  //     text.preparing, while start is pending, and in text.empty, when
  //     there are no posts.
  //
  // A source's slides take extractSlides' shape (see sourceSlide). A picture
  // that is the post's own media needs postMedia: true; without it, it
  // counts as the preview of a link, which any filter hides. wants(slide)
  // says whether the Show filter would show a slide, so a source can size
  // its batches.
  const liveSource = {
    kind: "live",
    hasMore: () => true,
    // Remembered for later opens in this tab.
    onDead(slide) {
      liveDeadKeys.add(canonicalMediaKey(slide.url));
    },
  };
  let activeSource = liveSource;

  // Whether the source may have more posts. The page always may; a source
  // whose answer throws has none.
  function sourceHasMore() {
    try {
      return Boolean(activeSource.hasMore());
    } catch (_error) {
      return false;
    }
  }

  const SOURCE_SLIDE_KINDS = ["image", "video", "embed", "link"];

  // A link from another source ends up in an href, or in an img or iframe
  // source, so only an absolute http(s) URL survives. A relative,
  // javascript: or data: URL becomes "".
  function absoluteHttpUrl(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value)
      ? absoluteUrl(value)
      : "";
  }

  // Another source's slide in the shape extractSlides gives, with every
  // field the viewer reads. Fields the viewer does not read pass through
  // untouched.
  function sourceSlide(slide) {
    const result = Object.assign(
      {
        title: "",
        body: "",
        author: "",
        community: "",
        commentsUrl: "",
        sourceUrl: "",
        postKey: "",
        poster: "",
        postMedia: false,
        fromGif: false,
        galleryItem: 0,
        galleryTotal: 0,
      },
      slide,
      {
        postNode: null,
        needsEnrichment: false,
        mediaUnknown: false,
        dead: false,
      },
    );
    ["title", "body", "author", "community", "postKey"].forEach((key) => {
      result[key] = result[key] == null ? "" : String(result[key]);
    });
    if (!SOURCE_SLIDE_KINDS.includes(result.kind)) result.kind = "link";
    ["url", "poster", "sourceUrl", "commentsUrl"].forEach((key) => {
      result[key] = absoluteHttpUrl(result[key]);
    });
    result.media = mediaCategory(result.kind, result.url, result.fromGif);
    return result;
  }

  // Whether the Show filter would show one of a source's slides.
  function sourceWants(slide) {
    return slideMatchesFilter(sourceSlide(slide), state.settings);
  }

  // Adds a batch that another source handed over, the way appendNewPosts
  // adds the page's new posts. A missing or malformed batch adds nothing.
  function appendSourceResult(result) {
    const skipped = Number(result?.unavailable);
    if (Number.isFinite(skipped) && skipped > 0) {
      state.unavailable += Math.floor(skipped);
    }
    const slides = Array.isArray(result?.slides) ? result.slides : [];
    return appendSlides(
      slides
        .filter((slide) => slide && typeof slide === "object")
        .map(sourceSlide),
    );
  }

  // Resolves to true when the slide was upgraded, false when the fetch failed,
  // and undefined when there was nothing to do or another request owns it.
  async function enrichSlide(slide) {
    // Only the page's own posts are ever read from Reddit.
    if (activeSource !== liveSource) return;
    if (!slide.needsEnrichment || !slide.commentsUrl) return;
    const key = slide.postKey || slide.commentsUrl;
    if (state.enrichments.has(key)) return;
    state.enrichments.set(key, "pending");

    try {
      const response = await fetch(slide.commentsUrl, {
        credentials: "include",
        headers: { Accept: "text/html" },
      });
      if (!response.ok) throw new Error(`Reddit returned ${response.status}`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const safePostKey = /^[\w-]+$/.test(slide.postKey || "")
        ? slide.postKey
        : "";
      const detailNode =
        (safePostKey &&
          doc.querySelector(`shreddit-post[id="${safePostKey}"]`)) ||
        doc.querySelector("shreddit-post, .thing.link");
      if (!detailNode)
        throw new Error("Post media was not present in the response");

      const detailSource = contentUrl(detailNode, slide.commentsUrl);
      const detailMedia = mediaFromNode(detailNode, detailSource);
      if (!detailMedia.length) {
        // A thumbnail stays as it is. A result that showed no media is now
        // known to be a link or text post, which the Show filter can judge.
        if (slide.kind !== "link") {
          throw new Error("Post had no supported media");
        }
        detailMedia.push({
          kind: "link",
          url: detailSource || slide.commentsUrl,
          poster: "",
        });
      }
      const isGallery = isGalleryPost(detailNode);
      const replacements = detailMedia.map((item, index) =>
        Object.assign({}, slide, item, {
          sourceUrl: detailSource || slide.sourceUrl,
          galleryItem: isGallery ? index + 1 : 0,
          galleryTotal: isGallery ? detailMedia.length : 0,
          needsEnrichment: false,
          mediaUnknown: false,
          media: mediaCategory(item.kind, item.url, item.fromGif),
        }),
      );

      const fullIndex = state.allSlides.findIndex(
        (candidate) =>
          candidate.needsEnrichment &&
          (candidate.postKey || candidate.commentsUrl) === key,
      );
      if (fullIndex < 0) return;
      // After a reopen during the fetch this is a newer copy of the argument,
      // and the one the grid has a tile for.
      const replaced = state.allSlides[fullIndex];
      state.allSlides.splice(fullIndex, 1, ...replacements);
      state.enrichments.set(key, "done");
      // A slide the filter hid since needs nothing more.
      const slideIndex = state.slides.indexOf(replaced);
      if (slideIndex < 0) return true;
      // Now that the post is known, the filter may keep none of it.
      const shown = replacements.filter((candidate) =>
        slideMatchesFilter(candidate, state.settings),
      );
      const wasCurrent = state.index === slideIndex;
      if (slideIndex < state.index) {
        state.index += shown.length - 1;
      }
      state.slides.splice(slideIndex, 1, ...shown);
      // A current slide that dropped out makes way for the next shown slide,
      // or for the last one when it was last.
      if (wasCurrent) {
        state.index = Math.max(
          0,
          Math.min(slideIndex, state.slides.length - 1),
        );
      }
      if (state.gridBuilt) replaceGridTile(replaced, shown);
      if (wasCurrent && state.open) {
        render();
        refocusIfLost();
        loadForEmptyFilter();
      } else if (state.open) {
        // The counter may have lost a post.
        syncPresentationUi();
      }
      return true;
    } catch (_error) {
      // Keep the visible thumbnail/link card and allow another attempt if the
      // user revisits this slide. Reddit may return a challenge or gated page.
      state.enrichments.delete(key);
      return false;
    }
  }

  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text) result.textContent = text;
    return result;
  }

  function normalizedSettings(value) {
    const result = Object.assign({}, DEFAULT_SETTINGS);
    if (!value || typeof value !== "object") return result;
    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
      if (key === "slideDurationSeconds") {
        const seconds = Number(value[key]);
        if (Number.isFinite(seconds)) {
          result[key] = Math.min(3600, Math.max(1, Math.round(seconds)));
        }
      } else if (typeof value[key] === "boolean") {
        result[key] = value[key];
      }
    });
    // Before 2026-09 this was stored inverted as `controlsCollapsed`.
    if (
      typeof value.showControls !== "boolean" &&
      typeof value.controlsCollapsed === "boolean"
    ) {
      result.showControls = !value.controlsCollapsed;
    }
    // At least one media type always shows.
    if (!MEDIA_FILTER_TYPES.some(([key]) => result[key])) {
      MEDIA_FILTER_TYPES.forEach(([key]) => {
        result[key] = true;
      });
    }
    return result;
  }

  function loadSettings() {
    if (state.settingsLoaded) return Promise.resolve();
    return new Promise((resolve) => {
      function finish(value) {
        state.settings = normalizedSettings(value);
        state.settingsLoaded = true;
        resolve();
      }
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get(SETTINGS_KEY, (stored) => {
            if (chrome.runtime?.lastError) finish(null);
            else finish(stored?.[SETTINGS_KEY]);
          });
          return;
        }
        finish(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"));
      } catch (_error) {
        finish(null);
      }
    });
  }

  function saveSettings() {
    const stored = Object.assign({}, state.settings);
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ [SETTINGS_KEY]: stored }, () => {
          void chrome.runtime?.lastError;
        });
      } else {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
      }
    } catch (_error) {
      // Settings remain active for this presentation if storage is blocked.
    }
  }

  const root = element("section", "redditp", "");
  root.id = "redditp-presentation";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "redditp presentation mode");
  root.hidden = true;

  const stage = element("div", "redditp__stage", "");
  const mediaBox = element("div", "redditp__media", "");
  const empty = element("div", "redditp__empty", "");
  const emptyTitle = element("h2", "", "No posts found on this page");
  const emptyText = element(
    "p",
    "",
    "Scroll Reddit to load some posts, then try presentation mode again.",
  );
  empty.append(emptyTitle, emptyText);
  stage.append(mediaBox, empty);

  // The grid view shows every slide as a tile in equal-width columns.
  const grid = element("section", "redditp__grid", "");
  grid.setAttribute("aria-label", "All posts");
  const gridColumns = element("div", "redditp__grid-columns", "");
  const gridStatus = element("p", "redditp__grid-status", "");
  gridStatus.setAttribute("role", "status");
  gridStatus.hidden = true;
  const gridSentinel = element("div", "redditp__grid-sentinel", "");
  gridSentinel.setAttribute("aria-hidden", "true");
  grid.append(gridColumns, gridStatus, gridSentinel);

  const count = element("div", "redditp__count", "");
  const galleryButton = element(
    "button",
    "redditp__button redditp__gallery redditp__control-item",
    "",
  );
  galleryButton.title = "Skip the rest of this gallery (G)";
  galleryButton.setAttribute("aria-label", "Skip gallery");
  const closeButton = element("button", "redditp__button redditp__close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close presentation mode");
  closeButton.title = "Close presentation mode (Esc)";
  const details = element("div", "redditp__details", "");
  const title = element("h1", "redditp__title", "");
  const meta = element("div", "redditp__meta", "");
  details.append(title, meta);

  const controls = element("nav", "redditp__controls", "");
  controls.setAttribute("aria-label", "Slideshow controls");
  const prevButton = element("button", "redditp__arrow redditp__prev", "‹");
  prevButton.setAttribute("aria-label", "Previous slide");
  prevButton.title = "Previous slide (←)";
  const settingsButton = element(
    "button",
    "redditp__button redditp__gear redditp__control-item",
    "⚙",
  );
  settingsButton.setAttribute("aria-label", "Open presentation settings");
  settingsButton.title = "Presentation settings";
  const brand = element("a", "redditp__brand redditp__control-item", "redditp");
  brand.href = README_URL;
  brand.target = "_blank";
  brand.rel = "noopener noreferrer";
  brand.title = "Open the browser extension README on GitHub";
  const viewButton = element(
    "button",
    "redditp__button redditp__view redditp__control-item",
    "grid",
  );
  // The Show filter as buttons: lit while a type shows, struck through while
  // it is hidden. They do the same as the Show checkboxes in the settings.
  const mediaToggles = element(
    "div",
    "redditp__media-toggles redditp__control-item",
    "",
  );
  mediaToggles.setAttribute("role", "group");
  mediaToggles.setAttribute("aria-label", "Shown media");
  const mediaToggleButtons = {};
  MEDIA_FILTER_TYPES.forEach(([key, label]) => {
    const button = element(
      "button",
      "redditp__button redditp__media-toggle",
      label,
    );
    button.type = "button";
    mediaToggleButtons[key] = button;
    mediaToggles.append(button);
  });
  // Opens the current subreddit's whole history, ranked by score, in a new
  // tab.
  const archiveButton = element(
    "button",
    "redditp__button redditp__archive redditp__control-item",
    "archive",
  );
  const autoButton = element(
    "button",
    "redditp__button redditp__playback-control redditp__control-item",
    "auto",
  );
  autoButton.title = "Advance slides automatically (A)";
  const soundButton = element(
    "button",
    "redditp__button redditp__playback-control redditp__control-item redditp__sound",
    "sound off",
  );
  const nextButton = element("button", "redditp__arrow redditp__next", "›");
  nextButton.setAttribute("aria-label", "Next slide");
  nextButton.title = "Next slide (→)";
  const sourceLink = element(
    "a",
    "redditp__button redditp__link-control redditp__control-item",
    "media",
  );
  sourceLink.title = "Open the original media in a new tab (I)";
  const commentsLink = element(
    "a",
    "redditp__button redditp__link-control redditp__control-item",
    "comments",
  );
  commentsLink.title = "Open comments in a new tab (C)";
  const collapseButton = element(
    "button",
    "redditp__button redditp__collapse",
    "−",
  );
  collapseButton.setAttribute("aria-label", "Collapse bottom controls");
  prevButton.type =
    settingsButton.type =
    viewButton.type =
    archiveButton.type =
    autoButton.type =
    soundButton.type =
    nextButton.type =
    galleryButton.type =
    collapseButton.type =
      "button";
  sourceLink.target = commentsLink.target = "_blank";
  sourceLink.rel = commentsLink.rel = "noopener noreferrer";
  controls.append(
    settingsButton,
    brand,
    viewButton,
    mediaToggles,
    archiveButton,
    commentsLink,
    sourceLink,
    autoButton,
    soundButton,
    count,
    galleryButton,
    collapseButton,
  );

  const settingsOverlay = element("div", "redditp__settings-overlay", "");
  settingsOverlay.hidden = true;
  const settingsPanel = element("section", "redditp__settings", "");
  settingsPanel.setAttribute("role", "dialog");
  settingsPanel.setAttribute("aria-modal", "true");
  settingsPanel.setAttribute("aria-labelledby", "redditp-settings-title");
  const settingsTitle = element("h2", "", "Presentation settings");
  settingsTitle.id = "redditp-settings-title";
  const settingsClose = element("button", "redditp__settings-close", "Done");
  settingsClose.type = "button";
  settingsClose.setAttribute("aria-label", "Close presentation settings");
  const durationLabel = element(
    "label",
    "redditp__setting redditp__setting--duration",
    "",
  );
  const durationText = element("span", "", "Time per slide");
  const durationControl = element("span", "redditp__duration-control", "");
  const durationInput = element("input", "", "");
  durationInput.type = "number";
  durationInput.min = "1";
  durationInput.max = "3600";
  durationInput.step = "1";
  durationInput.setAttribute("aria-label", "Seconds per slide");
  durationControl.append(durationInput, element("span", "", "seconds"));
  durationLabel.append(durationText, durationControl);

  const settingCheckboxes = {};
  function checkboxSetting(key, labelText) {
    const label = element("label", "redditp__setting", "");
    const input = element("input", "", "");
    input.type = "checkbox";
    input.dataset.setting = key;
    settingCheckboxes[key] = input;
    label.append(input, element("span", "", labelText));
    return label;
  }

  // The Show filter's checkboxes, which apply to the slideshow and the grid.
  const filterGroup = element("div", "redditp__filter", "");
  filterGroup.setAttribute("role", "group");
  filterGroup.setAttribute("aria-labelledby", "redditp-filter-title");
  const filterTitle = element("h3", "", "Show");
  filterTitle.id = "redditp-filter-title";
  const filterOptions = element("div", "redditp__filter-options", "");
  filterOptions.append(
    checkboxSetting("showImages", "Images"),
    checkboxSetting("showGifs", "GIFs"),
    checkboxSetting("showVideos", "Videos"),
  );
  filterGroup.append(
    filterTitle,
    filterOptions,
    element("p", "", "Link and text posts show only when all three are on."),
  );

  const shortcutHelp = element("section", "redditp__shortcuts", "");
  shortcutHelp.setAttribute("aria-labelledby", "redditp-shortcuts-title");
  const shortcutTitle = element("h3", "", "Keyboard shortcuts");
  shortcutTitle.id = "redditp-shortcuts-title";
  const shortcutList = element("dl", "", "");
  [
    [["→", "PgDn", "Space"], "Next slide"],
    [["←", "PgUp"], "Previous slide"],
    [["G"], "Skip gallery / next post"],
    [["V"], "Switch between grid and slideshow"],
    [["O"], "Cycle media: all, images, GIFs, videos"],
    [["H"], "Browse this subreddit's archive (new tab)"],
    [["F"], "Toggle fullscreen (if available)"],
    [["M"], "Toggle video sound"],
    [["T"], "Show / hide the title panel"],
    [["P"], "Show / hide the bottom-left controls"],
    [["C"], "Open comments in a new tab"],
    [["I"], "Open the original media in a new tab"],
    [["A"], "Toggle auto-advance"],
    [["Esc"], "Close settings / back to grid / close"],
    [["Tab", "Shift+Tab"], "Next / previous control"],
    [["Alt+P"], "Toggle presentation (default)"],
  ].forEach(([keys, description]) => {
    const keyGroup = element("dt", "", "");
    keys.forEach((key) => keyGroup.append(element("kbd", "", key)));
    shortcutList.append(keyGroup, element("dd", "", description));
  });
  shortcutHelp.append(
    shortcutTitle,
    shortcutList,
    element(
      "p",
      "",
      "Close settings to use slide shortcuts. Your browser’s shortcuts still work.",
    ),
  );

  settingsPanel.append(
    settingsTitle,
    settingsClose,
    durationLabel,
    filterGroup,
    checkboxSetting("showDetails", "Show the title panel"),
    checkboxSetting("showArrows", "Show previous and next arrows"),
    checkboxSetting(
      "showClose",
      "Show the close button (press Esc instead when hidden)",
    ),
    checkboxSetting("showControls", "Show the bottom panel"),
    checkboxSetting("openInGrid", "Open in grid view"),
    checkboxSetting(
      "showArchiveLauncher",
      "Show the archive icon on subreddit pages",
    ),
    shortcutHelp,
  );
  settingsOverlay.append(settingsPanel);
  root.append(
    stage,
    grid,
    prevButton,
    nextButton,
    details,
    controls,
    closeButton,
    settingsOverlay,
  );

  function stopMedia() {
    mediaBox.querySelectorAll("video").forEach((video) => {
      video.pause();
      const restore = state.nativeRestores.get(video);
      if (!restore) return;
      video.removeEventListener("ended", restore.endedHandler);
      if (restore.className === null) video.removeAttribute("class");
      else video.setAttribute("class", restore.className);
      if (restore.style === null) video.removeAttribute("style");
      else video.setAttribute("style", restore.style);
      video.controls = restore.controls;
      video.muted = restore.muted;
      video.loop = restore.loop;
      video.autoplay = restore.autoplay;
      if (restore.placeholder.isConnected) {
        restore.placeholder.replaceWith(video);
      }
      state.nativeRestores.delete(video);
    });
    state.embedKeepsOwnSound = false;
    mediaBox.replaceChildren();
  }

  function linkCard(slide, failed) {
    const card = element("a", "redditp__link-card", "");
    card.href = slide.sourceUrl || slide.commentsUrl;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.append(
      element(
        "span",
        "redditp__link-icon",
        failed
          ? "Image unavailable"
          : slide.body
            ? "Text post"
            : "Open linked post",
      ),
      element("strong", "", slide.title),
    );
    if (slide.body) {
      card.append(element("div", "redditp__post-body", slide.body));
    }
    card.append(element("span", "", slide.sourceUrl || slide.commentsUrl));
    return card;
  }

  // Grid tiles are built from slide data alone. The grid never creates a
  // player, loads a third-party frame, or touches Reddit's own video element;
  // a video tile shows the post's poster when it has one.
  function isGridVideo(slide) {
    return (
      slide.kind === "video" ||
      slide.kind === "pending-native-video" ||
      slide.kind === "native-video" ||
      slide.kind === "embed"
    );
  }

  function gridTileCard(label, slide) {
    const card = element("span", "redditp__tile-card", "");
    card.append(
      element("span", "redditp__tile-kind", label),
      element("span", "redditp__tile-title", slide.title),
    );
    return card;
  }

  // ownMedia marks the slide's own picture, which takes the slide with it
  // when it fails; a video's poster keeps a card instead. A tile that has
  // left the grid since drops nothing.
  function gridTileImage(tile, url, fallbackLabel, slide, ownMedia) {
    const image = element("img", "redditp__tile-image", "");
    image.alt = "";
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    const dropsSlide = () =>
      ownMedia && dropsWhenDead(slide) && state.gridTiles.get(slide) === tile;
    image.addEventListener(
      "load",
      () => {
        if (
          dropsSlide() &&
          isPlaceholderImage(url, image.naturalWidth, image.naturalHeight)
        ) {
          dropDeadSlide(slide);
          return;
        }
        setGridTileHeight(
          tile,
          tileHeightRatio(image.naturalWidth, image.naturalHeight),
        );
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        if (dropsSlide()) {
          dropDeadSlide(slide);
          return;
        }
        tile.querySelector(".redditp__tile-caption")?.remove();
        image.replaceWith(gridTileCard(fallbackLabel, slide));
        setGridTileHeight(tile, 0.75);
      },
      { once: true },
    );
    image.src = url;
    return image;
  }

  function createGridTile(slide) {
    const tile = element("button", "redditp__tile", "");
    tile.type = "button";
    tile.title = slide.title;
    const isVideo = isGridVideo(slide);
    const itemLabel = slide.galleryItem
      ? `, ${slide.galleryItem} of ${slide.galleryTotal}`
      : "";
    tile.setAttribute(
      "aria-label",
      `${slide.title}${itemLabel}${isVideo ? ", video" : ""}`,
    );

    let picture = "";
    let cardLabel = slide.body ? "Text post" : "Link";
    if (slide.kind === "image") {
      picture = slide.url;
      cardLabel = "Image unavailable";
    } else if (slide.kind === "embed") {
      cardLabel = "Embedded video";
    } else if (isVideo) {
      picture = slide.poster;
      cardLabel = "Video";
    }
    const height = picture ? 1 : 0.75;
    if (picture) {
      tile.append(
        gridTileImage(tile, picture, cardLabel, slide, slide.kind === "image"),
        element("span", "redditp__tile-caption", slide.title),
      );
    } else {
      tile.append(gridTileCard(cardLabel, slide));
    }
    if (isVideo) tile.append(element("span", "redditp__tile-play", "▶\uFE0E"));
    if (slide.galleryItem) {
      tile.append(
        element(
          "span",
          "redditp__tile-badge",
          `${slide.galleryItem}/${slide.galleryTotal}`,
        ),
      );
    }
    gridTileInfo.set(tile, { slide, height });
    tile.style.aspectRatio = String(1 / height);
    return tile;
  }

  // Resizes a tile to its picture and keeps its column's running height in
  // step. A tile that has left the grid since only records the new height.
  function setGridTileHeight(tile, height) {
    const info = gridTileInfo.get(tile);
    if (!info) return;
    const previous = info.height;
    info.height = height;
    tile.style.aspectRatio = String(1 / height);
    const column = tile.parentElement;
    if (!column || column.parentElement !== gridColumns) return;
    const columnIndex = Array.prototype.indexOf.call(
      gridColumns.children,
      column,
    );
    state.gridColumnHeights[columnIndex] += height - previous;
  }

  // Tiles hold their slide rather than an index, because new posts and
  // upgraded thumbnails shift indices. A slide replaced since is found again
  // by its post.
  function gridSlideIndex(tile) {
    const info = gridTileInfo.get(tile);
    if (!info) return -1;
    const index = state.slides.indexOf(info.slide);
    if (index >= 0) return index;
    const identity = postIdentity(info.slide);
    return state.slides.findIndex((slide) => postIdentity(slide) === identity);
  }

  function focusedGridTile() {
    const active = document.activeElement;
    return active &&
      gridColumns.contains(active) &&
      active.classList.contains("redditp__tile")
      ? active
      : null;
  }

  function makeGridColumns(count) {
    const columns = [];
    for (let index = 0; index < count; index += 1) {
      columns.push(element("div", "redditp__grid-column", ""));
    }
    gridColumns.replaceChildren(...columns);
    state.gridColumnHeights = columns.map(() => 0);
  }

  // Each tile goes to the shortest column so far, in slide order, so the
  // tiles of newly loaded posts never move the ones already placed.
  function placeGridTiles(slides) {
    slides.forEach((slide) => {
      const tile = createGridTile(slide);
      const column = shortestColumn(state.gridColumnHeights);
      gridColumns.children[column].append(tile);
      state.gridColumnHeights[column] += gridTileInfo.get(tile).height;
      state.gridTiles.set(slide, tile);
      observeGridTile(tile, slide);
    });
  }

  function buildGrid() {
    makeGridColumns(gridColumnCount(grid.clientWidth || window.innerWidth));
    ensureGridObserver();
    placeGridTiles(state.slides);
    state.gridBuilt = true;
  }

  // When a new width changes the column count, the same tile elements move
  // into the new columns, so their images do not load again.
  function relayoutGrid() {
    const count = gridColumnCount(grid.clientWidth || window.innerWidth);
    if (count === gridColumns.children.length) return;
    const focusedTile = focusedGridTile();
    const anchor =
      focusedTile || state.gridTiles.get(state.slides[state.index]);
    const tiles = state.slides
      .map((slide) => state.gridTiles.get(slide))
      .filter(Boolean);
    const layout = layoutColumns(
      tiles.map((tile) => gridTileInfo.get(tile).height),
      count,
    );
    makeGridColumns(count);
    tiles.forEach((tile, index) => {
      gridColumns.children[layout.columns[index]].append(tile);
    });
    state.gridColumnHeights = layout.heights;
    // Moving the focused tile to another column blurred it.
    if (focusedTile) focusedTile.focus({ preventScroll: true });
    if (anchor) revealGridTile(anchor);
  }

  // Scrolls the grid, and only the grid, until the tile is in view.
  // scrollIntoView would also scroll the Reddit page underneath. The grid's
  // scroll padding marks where the close button and controls cover it.
  function revealGridTile(tile) {
    if (!tile || !gridColumns.contains(tile)) return;
    const gridBox = grid.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const top = gridBox.top + (parseFloat(style.scrollPaddingTop) || 0);
    const bottom =
      gridBox.bottom - (parseFloat(style.scrollPaddingBottom) || 0);
    if (tileBox.top >= top && tileBox.bottom <= bottom) return;
    grid.scrollTop +=
      tileBox.top - top - Math.max(0, (bottom - top - tileBox.height) / 2);
  }

  // An upgraded thumbnail's tile makes way for the tiles of the slides that
  // replaced it, in the same place in the same column. When the filter shows
  // none of them, the tile simply leaves.
  function replaceGridTile(oldSlide, replacements) {
    const oldTile = state.gridTiles.get(oldSlide);
    state.gridTiles.delete(oldSlide);
    const column = oldTile?.parentElement;
    if (!column || column.parentElement !== gridColumns) {
      placeGridTiles(replacements);
      return;
    }
    const hadFocus = document.activeElement === oldTile;
    // Where focus goes when no tile replaces this one.
    const neighbour =
      oldTile.nextElementSibling || oldTile.previousElementSibling;
    const newTiles = replacements.map(createGridTile);
    if (gridObserver) gridObserver.unobserve(oldTile);
    oldTile.replaceWith(...newTiles);
    replacements.forEach((slide, index) => {
      state.gridTiles.set(slide, newTiles[index]);
      observeGridTile(newTiles[index], slide);
    });
    const columnIndex = Array.prototype.indexOf.call(
      gridColumns.children,
      column,
    );
    const newHeight = newTiles.reduce(
      (sum, tile) => sum + gridTileInfo.get(tile).height,
      0,
    );
    state.gridColumnHeights[columnIndex] +=
      newHeight - gridTileInfo.get(oldTile).height;
    if (!hadFocus) return;
    if (newTiles.length) newTiles[0].focus({ preventScroll: true });
    else if (neighbour) neighbour.focus({ preventScroll: true });
    else focusInitialControl();
  }

  function resetGrid() {
    if (gridObserver) {
      gridObserver.disconnect();
      gridObserver = null;
    }
    if (gridEndObserver) {
      gridEndObserver.disconnect();
      gridEndObserver = null;
    }
    // Upgrades still in flight count themselves down when they finish.
    state.gridEnrichQueue = [];
    state.gridEnrichFailures = 0;
    state.gridExhausted = false;
    gridColumns.replaceChildren();
    state.gridTiles.clear();
    state.gridColumnHeights = [];
    state.gridBuilt = false;
    state.gridScrollTop = 0;
    grid.scrollTop = 0;
  }

  // Loading more posts and upgrading thumbnails both wait for the grid to
  // be scrolled near them. Without IntersectionObserver the grid still
  // shows and opens every post that is already loaded.
  function ensureGridObserver() {
    if (gridObserver || typeof IntersectionObserver !== "function") return;
    gridObserver = new IntersectionObserver(onGridIntersection, {
      root: grid,
      // A screen ahead, so thumbnails upgrade before they show.
      rootMargin: "100% 0px",
    });
    // The sentinel sits under the tallest column, so it marks the real end.
    // Widening the tiles' observer instead would upgrade thumbnails three
    // screens ahead too.
    gridEndObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreFromGrid();
      },
      { root: grid, rootMargin: GRID_LOAD_MARGIN },
    );
    gridEndObserver.observe(gridSentinel);
  }

  function observeGridTile(tile, slide) {
    if (gridObserver && slide.needsEnrichment) gridObserver.observe(tile);
  }

  function onGridIntersection(entries) {
    entries.forEach((entry) => {
      const info = gridTileInfo.get(entry.target);
      if (!info) return;
      if (entry.isIntersecting) queueGridEnrichment(info.slide);
      else dropGridEnrichment(info.slide);
    });
  }

  // An observer reports only changes, so a sentinel that is still in range
  // after a load must be observed afresh to be reported again.
  function rearmGridSentinel() {
    if (!gridEndObserver) return;
    gridEndObserver.unobserve(gridSentinel);
    gridEndObserver.observe(gridSentinel);
  }

  // Thumbnail-only slides are upgraded as their tiles come into range, a
  // couple at a time and at most once each per open. Several failures in a
  // row, such as Reddit answering with a challenge page, stop the grid from
  // asking again until the next open.
  function queueGridEnrichment(slide) {
    if (
      !slide.needsEnrichment ||
      gridEnrichTried.has(slide) ||
      state.gridEnrichQueue.includes(slide) ||
      state.gridEnrichFailures >= GRID_ENRICH_MAX_FAILURES
    )
      return;
    state.gridEnrichQueue.push(slide);
    pumpGridEnrichment();
  }

  // A tile scrolled out of range gives up its place in the queue, though an
  // upgrade already in flight carries on.
  function dropGridEnrichment(slide) {
    const index = state.gridEnrichQueue.indexOf(slide);
    if (index >= 0) state.gridEnrichQueue.splice(index, 1);
  }

  function pumpGridEnrichment() {
    while (
      state.gridEnrichActive < GRID_ENRICH_CONCURRENCY &&
      state.gridEnrichFailures < GRID_ENRICH_MAX_FAILURES &&
      state.gridEnrichQueue.length
    ) {
      const slide = state.gridEnrichQueue.shift();
      // The slideshow may have upgraded and replaced it in the meantime.
      if (!state.slides.includes(slide)) continue;
      gridEnrichTried.add(slide);
      state.gridEnrichActive += 1;
      const openRequest = state.openRequest;
      enrichSlide(slide)
        .then((upgraded) => {
          // A result from before a close or reopen counts for nothing now.
          if (openRequest !== state.openRequest) return;
          if (upgraded === false) state.gridEnrichFailures += 1;
          else if (upgraded) state.gridEnrichFailures = 0;
        })
        .finally(() => {
          state.gridEnrichActive -= 1;
          pumpGridEnrichment();
        });
    }
  }

  // Upgrades the slide in place. Its media type stays "video" on both paths,
  // including the link card a failed upgrade falls back to, so the slide
  // keeps its place under the Show filter.
  async function upgradePendingAdaptiveSlide(slide) {
    if (
      slide.kind !== "pending-native-video" ||
      !slide.playerElement ||
      slide.adaptiveUpgrade === "pending"
    )
      return;
    slide.adaptiveUpgrade = "pending";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!slide.adaptiveStartRequested) {
        slide.adaptiveStartRequested = requestPlayerStart(slide.playerElement);
      }
      const nativeVideo = adaptiveBlobVideo(slide.playerElement);
      if (nativeVideo) {
        slide.kind = "native-video";
        slide.nativeElement = nativeVideo;
        slide.adaptiveUpgrade = "done";
        if (state.open && state.slides[state.index] === slide) render();
        return;
      }
      await wait(100);
    }
    slide.kind = "link";
    slide.adaptiveUpgrade = "failed";
    if (state.open && state.slides[state.index] === slide) render();
  }

  // Takes a slide out of the presentation, the way an upgrade that the
  // filter hides does. A current slide makes way for the next one, or for
  // the new last one when it was last, and the grid loses its tile.
  function removeSlide(slide) {
    const fullIndex = state.allSlides.indexOf(slide);
    if (fullIndex >= 0) state.allSlides.splice(fullIndex, 1);
    const slideIndex = state.slides.indexOf(slide);
    if (slideIndex < 0) {
      syncPresentationUi();
      return;
    }
    const wasCurrent = state.index === slideIndex;
    state.slides.splice(slideIndex, 1);
    if (slideIndex < state.index) state.index -= 1;
    state.index = Math.max(0, Math.min(state.index, state.slides.length - 1));
    if (state.gridBuilt) replaceGridTile(slide, []);
    if (wasCurrent && state.view === "slideshow") {
      render();
      refocusIfLost();
    } else {
      syncPresentationUi();
    }
    if (!state.slides.length) loadForEmptyFilter();
  }

  // A picture or video that failed to load leaves the presentation and
  // counts as unavailable. Its source hears about it, so the same media can
  // be left out next time.
  function dropDeadSlide(slide) {
    if (!state.open || slide.dead) return;
    slide.dead = true;
    state.unavailable += 1;
    try {
      activeSource.onDead?.(slide);
    } catch (_error) {
      // A source's own bookkeeping never keeps a failed slide.
    }
    removeSlide(slide);
  }

  // Media that failed while it showed. A slide's own picture or video takes
  // the slide with it; anything else leaves a link card.
  function showMediaFailure(mediaElement, slide) {
    if (
      state.open &&
      state.slides[state.index] === slide &&
      mediaElement.parentNode === mediaBox
    ) {
      if (dropsWhenDead(slide)) {
        dropDeadSlide(slide);
        return;
      }
      mediaBox.replaceChildren(linkCard(slide, true));
      slide.mediaFailed = true;
      scheduleAuto();
    }
  }

  function expandLargeImage(image, slide) {
    const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const shortEdge = Math.min(image.naturalWidth, image.naturalHeight);
    // The post's own image is the whole point of the slide, so it fills the
    // stage at any size. The size gate only holds back preview images scraped
    // from a card for a post that links elsewhere, which are often far smaller
    // than the media they stand in for.
    image.classList.toggle(
      "redditp__image--expand",
      Boolean(slide?.postMedia) ||
        (longEdge >= MIN_EXPAND_IMAGE_LONG_EDGE &&
          shortEdge >= MIN_EXPAND_IMAGE_SHORT_EDGE),
    );
  }

  function syncPresentationUi() {
    const hasSlides = state.slides.length > 0;
    const inGrid = state.view === "grid" && hasSlides;
    const filtering = mediaFilterActive(state.settings);
    root.classList.toggle("redditp--grid", inGrid);
    root.classList.toggle("redditp--filtered", filtering);
    empty.hidden = hasSlides;
    syncEmptyState();
    details.hidden = !hasSlides || !state.settings.showDetails;
    // A filter that hides every post keeps the controls, so the gear can
    // still change it; the controls that need a slide go meanwhile.
    controls.hidden = !hasSlides && !filtering;
    viewButton.hidden = !hasSlides;
    if (!hasSlides) sourceLink.hidden = commentsLink.hidden = true;
    prevButton.hidden = nextButton.hidden =
      !hasSlides || !state.settings.showArrows;
    prevButton.disabled = !hasSlides || state.index === 0;
    nextButton.disabled =
      !hasSlides ||
      (isSinglePostPage() && state.index === state.slides.length - 1);
    closeButton.hidden = !state.settings.showClose;
    // In a slideshow opened from the grid, Escape goes back to the grid.
    closeButton.title =
      state.view === "slideshow" && state.returnToGrid
        ? "Close presentation mode"
        : "Close presentation mode (Esc)";
    viewButton.setAttribute("aria-pressed", String(inGrid));
    viewButton.title = inGrid
      ? "Back to the slideshow (V)"
      : "Show every post in a grid (V)";
    syncMediaToggles();
    syncArchiveButton();
    controls.classList.toggle(
      "redditp__controls--collapsed",
      !state.settings.showControls,
    );
    collapseButton.textContent = state.settings.showControls ? "−" : "+";
    collapseButton.setAttribute(
      "aria-label",
      state.settings.showControls
        ? "Collapse bottom controls"
        : "Expand bottom controls",
    );
    soundButton.textContent = state.settings.sound ? "sound on" : "sound off";
    soundButton.setAttribute("aria-pressed", String(state.settings.sound));
    soundButton.title = state.embedKeepsOwnSound
      ? "This embedded player answers only to its own sound control"
      : "Toggle video sound (M)";
    collapseButton.title = state.settings.showControls
      ? "Collapse controls (P)"
      : "Expand controls (P)";
    // A dot on the gear says a filter is on; its tooltip says which.
    settingsButton.title = filtering
      ? `Presentation settings (${mediaFilterSummary(state.settings)})`
      : "Presentation settings";
    updateCount(loadingSuffixShown());
    const slide = hasSlides ? state.slides[state.index] : null;
    galleryButton.hidden = !slide?.galleryItem;
    galleryButton.textContent = slide?.galleryItem
      ? `(${slide.galleryItem}/${slide.galleryTotal})`
      : "";
  }

  // The media buttons stay in the slideshow, the grid, and the empty state a
  // filter can leave, so a filter can always be changed back.
  function syncMediaToggles() {
    const locked = lockedMediaType(state.settings);
    MEDIA_FILTER_TYPES.forEach(([key, label]) => {
      const button = mediaToggleButtons[key];
      const shown = Boolean(state.settings[key]);
      button.setAttribute("aria-pressed", String(shown));
      button.disabled = key === locked;
      button.title = button.disabled
        ? "At least one type stays shown"
        : `${shown ? "Hide" : "Show"} ${label}`;
    });
  }

  // The installed extension's messaging, when this script runs as part of
  // it. A page that loads the script by itself has none.
  function extensionRuntime() {
    const api =
      globalThis.browser || (typeof chrome !== "undefined" ? chrome : null);
    const runtime = api?.runtime;
    return runtime && typeof runtime.sendMessage === "function"
      ? runtime
      : null;
  }

  // The archive button needs a subreddit listing and the installed extension
  // to ask. A page that hosts the viewer with a source of its own has no use
  // for it.
  function syncArchiveButton() {
    archiveButton.hidden = activeSource !== liveSource;
    const sub = subredditFromPath(location.pathname);
    const runtime = extensionRuntime();
    archiveButton.disabled = !sub || !runtime;
    if (!sub) {
      archiveButton.title = "Open a subreddit's page to browse its archive (H)";
    } else if (!runtime) {
      archiveButton.title =
        "The archive opens from the installed extension (H)";
    } else {
      archiveButton.title = `Browse all of r/${sub} ranked by score, in a new tab (H)`;
    }
  }

  // Asks the extension to open the archive of the current subreddit.
  function openArchive() {
    if (archiveButton.hidden || archiveButton.disabled) return;
    const runtime = extensionRuntime();
    const sub = subredditFromPath(location.pathname);
    if (!runtime || !sub) return;
    try {
      const sent = runtime.sendMessage({ type: "open-archive", sub });
      // Chrome returns a promise here; Firefox's `chrome` alias may not.
      if (sent && typeof sent.catch === "function") sent.catch(() => {});
    } catch (_error) {
      // The extension was reloaded or removed since this page loaded.
    }
  }

  // "loading more" shows where the viewer is waiting on the load: in the
  // grid, on an empty stage, and on the last post. A load running ahead of
  // the slideshow leaves the counter alone.
  function loadingSuffixShown() {
    return (
      state.loadingMore &&
      (state.view === "grid" || !state.slides.length || isOnLastPost())
    );
  }

  // Counts posts rather than slides, so a gallery advances only its own
  // "(2/7)" counter while the post number stays put. The grid shows every
  // post at once, so it shows only the total. An active filter adds what it
  // shows, such as "images only", and media that failed to load adds how
  // many did, before "loading more".
  function updateCount(loading) {
    const suffix = countSuffix(
      mediaFilterSummary(state.settings),
      state.unavailable,
      loading,
    );
    if (!state.slides.length) {
      count.textContent = `0 posts${suffix}`;
      return;
    }
    let current = 0;
    let total = 0;
    let previous = null;
    state.slides.forEach((slide, index) => {
      const identity = postIdentity(slide);
      if (identity !== previous) total += 1;
      previous = identity;
      if (index === state.index) current = total;
    });
    count.textContent =
      state.view === "grid"
        ? `${total} post${total === 1 ? "" : "s"}${suffix}`
        : `${current} / ${total}${suffix}`;
  }

  // The empty stage says why it is empty: Reddit's player is still being
  // prepared, the page has no posts, the Show filter hides them all, or all
  // their pictures and videos failed to load. Another source can say the
  // first two in its own words.
  function syncEmptyState() {
    let heading = "No posts found on this page";
    let text =
      "Scroll Reddit to load some posts, then try presentation mode again.";
    let ownWords = null;
    if (state.preparing) {
      heading = "Preparing Reddit video…";
      text = "Waiting for Reddit's full-quality player.";
      ownWords = sourceText("preparing");
    } else if (mediaFilterActive(state.settings)) {
      if (state.loadingMore) {
        heading = `No ${shownMediaLabel(state.settings, "or")} here yet`;
        text = "Loading more posts…";
        if (state.loadFound) text += ` ${state.loadFound} checked`;
      } else {
        heading = "Nothing here matches the filter";
        text = `Only ${shownMediaLabel(state.settings, "and")} are shown. Change that in the settings, or press O.`;
      }
    } else if (state.unavailable) {
      heading = "Nothing here could be loaded";
      text = state.loadingMore
        ? "Loading more posts…"
        : `${state.unavailable} ${state.unavailable === 1 ? "picture or video" : "pictures or videos"} failed to load.`;
    } else {
      ownWords = sourceText("empty");
    }
    if (ownWords) [heading, text] = ownWords;
    emptyTitle.textContent = heading;
    emptyText.textContent = text;
  }

  // A source's own [heading, text] for the empty stage, if it gives one.
  function sourceText(name) {
    if (activeSource === liveSource) return null;
    const words = activeSource.text?.[name];
    return Array.isArray(words) && words.length === 2
      ? words.map((part) => String(part))
      : null;
  }

  function render() {
    stopMedia();
    syncPresentationUi();
    if (!state.slides.length) return;
    if (state.view === "grid") {
      // Later render() calls, such as a finished enrichment, only need the
      // grid kept in shape; its tiles update through their own hooks.
      if (!state.gridBuilt) buildGrid();
      else relayoutGrid();
      syncGridStatus();
      return;
    }

    const slide = state.slides[state.index];
    // Revisiting a slide retries its media, so a past failure must not keep
    // forcing the timer path.
    slide.mediaFailed = false;
    // The title is a link to the post on Reddit, so a left, middle or
    // Ctrl/Cmd click all open it in a new tab.
    if (slide.commentsUrl) {
      const titleLink = element("a", "redditp__title-link", slide.title);
      titleLink.href = slide.commentsUrl;
      titleLink.target = "_blank";
      titleLink.rel = "noopener noreferrer";
      title.replaceChildren(titleLink);
    } else {
      title.textContent = slide.title;
    }
    const metaItems = [];
    if (slide.community) {
      const communityLink = element("a", "redditp__meta-link", slide.community);
      communityLink.href = redditPageUrl(slide.community, "community");
      followMetaLink(communityLink);
      metaItems.push(communityLink);
    }
    if (slide.author) {
      const authorLink = element("a", "redditp__meta-link", slide.author);
      authorLink.href = redditPageUrl(slide.author, "user");
      followMetaLink(authorLink);
      metaItems.push(authorLink);
    }
    meta.replaceChildren();
    metaItems.forEach((item, index) => {
      if (index) meta.append(document.createTextNode(" · "));
      meta.append(item);
    });
    const sourceHref = mediaHref(slide);
    sourceLink.hidden = !sourceHref;
    if (sourceHref) sourceLink.href = sourceHref;
    commentsLink.hidden = !slide.commentsUrl;
    if (slide.commentsUrl) commentsLink.href = slide.commentsUrl;

    if (slide.kind === "image") {
      const img = element("img", "redditp__image", "");
      img.alt = slide.title;
      img.addEventListener(
        "load",
        () => {
          // Some hosts answer for a deleted picture with a placeholder.
          if (
            dropsWhenDead(slide) &&
            isPlaceholderImage(
              slide.url,
              img.naturalWidth,
              img.naturalHeight,
            ) &&
            img.parentNode === mediaBox &&
            state.slides[state.index] === slide
          ) {
            dropDeadSlide(slide);
          } else {
            expandLargeImage(img, slide);
          }
        },
        { once: true },
      );
      img.addEventListener("error", () => showMediaFailure(img, slide), {
        once: true,
      });
      img.src = slide.url;
      mediaBox.append(img);
    } else if (slide.kind === "video") {
      const video = element("video", "redditp__video", "");
      video.src = slide.url;
      video.poster = slide.poster || "";
      video.controls = true;
      video.playsInline = true;
      video.autoplay = true;
      video.muted = !state.settings.sound;
      video.loop = !state.autoPlaying;
      video.preload = "metadata";
      video.addEventListener("ended", () => {
        if (state.autoPlaying) move(1);
      });
      video.addEventListener("error", () => showMediaFailure(video, slide), {
        once: true,
      });
      mediaBox.append(video);
      playVideo(video);
    } else if (slide.kind === "pending-native-video") {
      if (slide.poster) {
        const poster = element("img", "redditp__image", "");
        poster.alt = slide.title;
        poster.src = slide.poster;
        mediaBox.append(poster);
      } else {
        mediaBox.append(linkCard(slide, false));
      }
    } else if (
      slide.kind === "native-video" &&
      slide.nativeElement?.parentNode
    ) {
      const video = slide.nativeElement;
      const placeholder = document.createComment("redditp native video");
      const endedHandler = () => {
        if (
          state.open &&
          state.autoPlaying &&
          state.slides[state.index]?.nativeElement === video
        ) {
          move(1);
        }
      };
      video.parentNode.insertBefore(placeholder, video);
      state.nativeRestores.set(video, {
        placeholder,
        className: video.getAttribute("class"),
        style: video.getAttribute("style"),
        controls: video.controls,
        muted: video.muted,
        loop: video.loop,
        autoplay: video.autoplay,
        endedHandler,
      });
      video.className = "redditp__video";
      video.removeAttribute("style");
      video.controls = true;
      video.playsInline = true;
      video.autoplay = true;
      video.muted = !state.settings.sound;
      video.loop = !state.autoPlaying;
      video.addEventListener("ended", endedHandler);
      mediaBox.append(video);
      playVideo(video);
    } else if (slide.kind === "embed") {
      const iframe = element("iframe", "redditp__embed", "");
      iframe.title = slide.title;
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.addEventListener("load", () => initializeEmbed(iframe));
      iframe.src = embedUrl(slide.url, !state.settings.sound);
      mediaBox.append(iframe);
      // Say so plainly when the toggle cannot reach this player, rather than
      // leaving a control that looks live and does nothing.
      state.embedKeepsOwnSound = !commandableEmbed();
      syncPresentationUi();
    } else {
      mediaBox.append(linkCard(slide, false));
    }
    scheduleAuto();
    void enrichSlide(slide);
    void upgradePendingAdaptiveSlide(slide);
    // More posts start loading well before the last slide, and the next
    // pictures before they show.
    prefetchIfLow();
    preloadAhead();
    if (activeSource !== liveSource) {
      try {
        activeSource.onShow?.(slide);
      } catch (_error) {
        // A source's own bookkeeping never stops the slideshow.
      }
    }
  }

  function move(delta) {
    if (state.view !== "slideshow") return;
    if (!state.slides.length) return;
    if (delta < 0 && state.index === 0) return;
    if (
      delta > 0 &&
      isSinglePostPage() &&
      state.index === state.slides.length - 1
    ) {
      return;
    }
    if (state.loadingMore) {
      if (delta > 0 && state.index === state.slides.length - 1) {
        state.advanceAfterLoad = true;
        updateCount(true);
        return;
      }
      // Leaving the last post drops a queued move, but the load goes on in
      // the background.
      if (delta < 0 && state.index + delta < lastPostStart()) {
        state.advanceAfterLoad = false;
      }
    }
    if (delta > 0 && state.index === state.slides.length - 1) {
      // A feed known to have ended wraps at once rather than waiting out
      // another load.
      if (state.feedExhausted) {
        state.index = 0;
        render();
        return;
      }
      void loadMoreAtEnd(true);
      return;
    }
    state.index += delta;
    render();
  }

  function skipGallery() {
    if (state.view !== "slideshow") return;
    const slide = state.slides[state.index];
    if (!slide) return;
    let nextIndex = state.index + 1;
    if (slide.galleryItem) {
      const identity = postIdentity(slide);
      while (
        nextIndex < state.slides.length &&
        postIdentity(state.slides[nextIndex]) === identity
      ) {
        nextIndex += 1;
      }
    }
    if (nextIndex < state.slides.length) {
      move(nextIndex - state.index);
      return;
    }
    // Settle on the last image before using the normal end-of-feed path.
    // This keeps loading, wrapping, and single-post boundaries in move().
    if (state.index < state.slides.length - 1) {
      state.index = state.slides.length - 1;
      render();
    }
    move(1);
  }

  function lastPostStart() {
    const lastIndex = state.slides.length - 1;
    const identity = postIdentity(state.slides[lastIndex]);
    let start = lastIndex;
    while (start > 0 && postIdentity(state.slides[start - 1]) === identity) {
      start -= 1;
    }
    return start;
  }

  function isOnLastPost() {
    return state.slides.length > 0 && state.index >= lastPostStart();
  }

  function postIdentity(slide) {
    if (slide.postKey) return `post:${slide.postKey}`;
    if (slide.commentsUrl) return `comments:${slide.commentsUrl}`;
    return `fallback:${slide.title}|${slide.sourceUrl}`;
  }

  // Adds the slides of posts not seen before. Every new slide joins
  // allSlides; the ones the filter lets through also join slides. Returns how
  // many new slides were found and how many of them show.
  function appendSlides(slides) {
    const existingPosts = new Set(state.allSlides.map(postIdentity));
    const additions = slides.filter(
      (slide) => !existingPosts.has(postIdentity(slide)),
    );
    const shown = additions.filter((slide) =>
      slideMatchesFilter(slide, state.settings),
    );
    state.allSlides.push(...additions);
    if (shown.length) {
      state.slides.push(...shown);
      // A built grid gets the new tiles even while it is hidden.
      if (state.gridBuilt) placeGridTiles(shown);
    }
    return { found: additions.length, shown: shown.length };
  }

  // Adds the posts Reddit has rendered since the last look. Another source
  // hands its posts to loadMorePosts itself.
  function appendNewPosts() {
    return activeSource === liveSource
      ? appendSlides(skipDeadSlides(extractSlides()))
      : { found: 0, shown: 0 };
  }

  // Leaves out the page's pictures and videos that already failed to load in
  // this tab, and counts them as unavailable straight away.
  function skipDeadSlides(slides) {
    return slides.filter((slide) => {
      if (!dropsWhenDead(slide)) return true;
      if (!liveDeadKeys.has(canonicalMediaKey(slide.url))) return true;
      state.unavailable += 1;
      return false;
    });
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  // Reddit renders more posts when its page is scrolled to the end.
  function scrollToFeedEnd() {
    const scrollingElement = document.scrollingElement;
    window.scrollTo(0, scrollingElement?.scrollHeight || 0);
  }

  // Whether a page change added something that may be a new post. The
  // presentation's own elements never count.
  function addsPostCandidate(record) {
    return Array.prototype.some.call(
      record.addedNodes,
      (node) =>
        node.nodeType === 1 &&
        !root.contains(node) &&
        (node.matches(FEED_GROWTH_SELECTOR) ||
          Boolean(node.querySelector(FEED_GROWTH_SELECTOR))),
    );
  }

  // Watches the page while a load waits for Reddit. New post elements wake
  // the load straight away, where MutationObserver is available, and a timer
  // scrolls Reddit to the end again every LOAD_NUDGE_MS and wakes it too.
  // A wake-up that arrives while the load is busy is kept for its next wait.
  // Only one watch runs at a time.
  function startFeedWatch() {
    stopFeedWatch(feedWatch);
    const watch = {
      stopped: false,
      signalled: false,
      waiter: null,
      observer: null,
      timer: null,
    };
    function signal() {
      if (watch.stopped) return;
      const waiter = watch.waiter;
      watch.waiter = null;
      if (waiter) waiter();
      else watch.signalled = true;
    }
    if (typeof MutationObserver === "function") {
      watch.observer = new MutationObserver((records) => {
        if (records.some(addsPostCandidate)) signal();
      });
      watch.observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    watch.timer = setInterval(() => {
      scrollToFeedEnd();
      signal();
    }, LOAD_NUDGE_MS);
    feedWatch = watch;
    return watch;
  }

  // Resolves at the watch's next wake-up, at once if one is waiting, and at
  // once when the watch has stopped.
  function waitForFeed(watch) {
    if (watch.stopped || watch.signalled) {
      watch.signalled = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      watch.waiter = resolve;
    });
  }

  // Disconnects the observer and clears the timer. Safe to call twice; a
  // load still waiting on the watch wakes up and sees that it stopped.
  function stopFeedWatch(watch) {
    if (!watch || watch.stopped) return;
    watch.stopped = true;
    if (watch.observer) watch.observer.disconnect();
    clearInterval(watch.timer);
    const waiter = watch.waiter;
    watch.waiter = null;
    if (waiter) waiter();
    if (feedWatch === watch) feedWatch = null;
  }

  async function loadMoreAtEnd(advanceWhenReady) {
    if (isSinglePostPage()) return;
    if (state.loadingMore) {
      if (advanceWhenReady) {
        state.advanceAfterLoad = true;
        updateCount(true);
      }
      return;
    }
    if (!state.open || !isOnLastPost()) return;
    state.advanceAfterLoad = Boolean(advanceWhenReady);
    state.prefetchLoads = 0;
    return loadMorePosts();
  }

  // Scrolls the Reddit page underneath so it renders more posts, and adds
  // them as slides; another source is asked for its next batch instead.
  // Resolves to the number of added slides the filter shows, or null when
  // the presentation closed or a newer request took over.
  // Callers check their own preconditions first; loadingMore is set before
  // the first await, so a second caller sees the load that is already
  // running.
  async function loadMorePosts() {
    // A source with nothing more ends the load at once. Only Reddit's feed,
    // which never says that it has ended, waits out LOAD_IDLE_MS.
    if (!sourceHasMore()) return endFinishedLoad();
    state.loadingMore = true;
    state.loadFound = 0;
    const request = ++state.loadRequest;
    const openRequest = state.openRequest;
    updateCount(loadingSuffixShown());
    syncEmptyState();
    syncGridStatus();

    let scan = appendNewPosts();
    let added = scan.shown;
    // Every post this load found, shown or not.
    let found = scan.found;
    let verdict = added ? "matched" : "wait";
    noteLoadProgress(scan);
    try {
      if (!added && activeSource === liveSource) {
        document.documentElement.style.overflow = state.oldOverflow;
        const watch = startFeedWatch();
        let rounds = 0;
        let lastGrowth = Date.now();
        let wasHidden = false;
        try {
          scrollToFeedEnd();
          while (verdict === "wait") {
            await waitForFeed(watch);
            if (watch.stopped || !state.open || request !== state.loadRequest)
              return null;
            // Time in a background tab, where Reddit renders nothing, does
            // not count towards the idle window.
            const hidden = Boolean(document.hidden);
            if (hidden || wasHidden) lastGrowth = Date.now();
            wasHidden = hidden;
            scan = appendNewPosts();
            added = scan.shown;
            found += scan.found;
            noteLoadProgress(scan);
            if (scan.found) {
              // Posts the filter hides still show that Reddit is loading.
              lastGrowth = Date.now();
              if (!added) rounds += 1;
            }
            verdict = loadVerdict(added, rounds, Date.now() - lastGrowth);
            // Ask for the next batch now rather than at the next nudge.
            if (verdict === "wait" && scan.found) scrollToFeedEnd();
          }
        } finally {
          stopFeedWatch(watch);
        }
      } else if (!added) {
        // Another source hands its posts over itself: there is no page to
        // scroll and no idle window to wait out.
        let rounds = 0;
        while (verdict === "wait") {
          if (!sourceHasMore()) {
            verdict = "idle";
            break;
          }
          let result = null;
          try {
            result = await activeSource.loadMore({ wants: sourceWants });
          } catch (_error) {
            // A batch that failed counts as an empty one.
          }
          if (!state.open || openRequest !== state.openRequest) return null;
          // The source has moved past this batch, so it joins even when a
          // newer load took over, as after a filter change.
          scan = appendSourceResult(result);
          if (request !== state.loadRequest) {
            showLateSlides(scan);
            return null;
          }
          added = scan.shown;
          found += scan.found;
          noteLoadProgress(scan);
          if (scan.found && !added) rounds += 1;
          verdict = sourceVerdict(added, scan.found, rounds, sourceHasMore());
        }
      }
    } finally {
      if (state.open && request === state.loadRequest) {
        document.documentElement.style.overflow = "hidden";
        state.loadingMore = false;
      }
    }

    if (!state.open || request !== state.loadRequest) return null;
    // New posts show that the feed goes on; a load that waited out the idle
    // window found its end.
    if (found) state.feedExhausted = false;
    if (verdict === "idle") state.feedExhausted = true;
    // A load that found nothing to show stops the grid loading on its own
    // until the grid is shown again or the filter changes; otherwise the
    // grid watches its end afresh.
    if (!added) state.gridExhausted = true;
    syncEmptyState();
    syncGridStatus();
    rearmGridSentinel();
    // Only the slideshow moves on to a newly loaded post.
    const shouldAdvance = state.advanceAfterLoad && state.view === "slideshow";
    state.advanceAfterLoad = false;
    // render() decides afresh whether to load more, so a background
    // prefetch never chains past one of these.
    if (added && state.slides.length === added) {
      // The first posts a filter lets through; either view starts there.
      state.prefetchLoads = 0;
      state.index = 0;
      render();
      refocusIfLost();
    } else if (added && shouldAdvance) {
      state.prefetchLoads = 0;
      state.index += 1;
      render();
    } else if (!added && shouldAdvance) {
      state.prefetchLoads = 0;
      state.index = 0;
      render();
    } else {
      updateCount(false);
      // The new posts may be among the next few slides.
      if (added && state.view === "slideshow") preloadAhead();
      continuePrefetch(found);
    }
    return added;
  }

  // A load from a source that has nothing more. The feed has ended, so the
  // grid stops loading and a move queued on the last slide wraps at once.
  function endFinishedLoad() {
    state.feedExhausted = true;
    state.gridExhausted = true;
    state.prefetchLoads = 0;
    const shouldAdvance = state.advanceAfterLoad && state.view === "slideshow";
    state.advanceAfterLoad = false;
    syncGridStatus();
    syncEmptyState();
    if (shouldAdvance) {
      state.index = 0;
      render();
    } else {
      updateCount(loadingSuffixShown());
    }
    return 0;
  }

  // A batch from a load that a newer one took over still joins, and it may
  // hold the first slides the filter shows. The newer load settles the rest.
  function showLateSlides(scan) {
    if (scan.shown && state.slides.length === scan.shown) {
      state.index = 0;
      render();
      refocusIfLost();
    } else {
      updateCount(loadingSuffixShown());
    }
  }

  // Starts loading more posts in the background once the slideshow is low,
  // without moving it. Only the slideshow does this; the grid loads from its
  // end, and an empty stage from loadForEmptyFilter().
  function prefetchIfLow() {
    if (
      !state.open ||
      state.preparing ||
      state.view !== "slideshow" ||
      state.loadingMore ||
      isSinglePostPage() ||
      !prefetchWanted(
        state.slides.length,
        state.index,
        isOnLastPost(),
        state.feedExhausted,
      )
    )
      return;
    state.prefetchLoads = 1;
    state.advanceAfterLoad = false;
    void loadMorePosts();
  }

  // A background prefetch that found posts loads again while the slideshow
  // is still low, up to PREFETCH_ROUNDS loads in a row.
  function continuePrefetch(found) {
    if (!state.prefetchLoads) return;
    if (
      found > 0 &&
      state.prefetchLoads < PREFETCH_ROUNDS &&
      state.view === "slideshow" &&
      !state.loadingMore &&
      prefetchWanted(
        state.slides.length,
        state.index,
        isOnLastPost(),
        state.feedExhausted,
      )
    ) {
      state.prefetchLoads += 1;
      void loadMorePosts();
      return;
    }
    state.prefetchLoads = 0;
  }

  // Fetches the pictures of the next few slides so they show at once. The
  // few most recent stay referenced, so the browser keeps them until then.
  // Data Saver turns this off.
  function preloadAhead() {
    if (!state.open || state.view !== "slideshow") return;
    const connection = navigator.connection;
    if (connection && connection.saveData) return;
    preloadUrls(state.slides, state.index).forEach((url) => {
      let image = state.preloads.get(url);
      if (!image) {
        image = new Image();
        image.decoding = "async";
        image.src = url;
      }
      rememberBounded(state.preloads, url, image, PRELOAD_CACHE_SIZE);
    });
  }

  // Counts the posts a load has looked at, for a filtered load's progress
  // text.
  function noteLoadProgress(scan) {
    if (!scan.found) return;
    state.loadFound += scan.found;
    if (!scan.shown && mediaFilterActive(state.settings)) {
      syncEmptyState();
      syncGridStatus();
    }
  }

  // Scrolling near the end of the grid loads more posts the way the last
  // slide does, without moving to them.
  function loadMoreFromGrid() {
    if (
      isSinglePostPage() ||
      !state.open ||
      state.view !== "grid" ||
      state.loadingMore ||
      state.gridExhausted
    )
      return;
    state.advanceAfterLoad = false;
    state.prefetchLoads = 0;
    void loadMorePosts();
  }

  // Stops a load in flight: its loop sees the newer request and gives up.
  function cancelLoadMore() {
    state.loadRequest += 1;
    state.loadingMore = false;
    state.advanceAfterLoad = false;
    state.prefetchLoads = 0;
    stopFeedWatch(feedWatch);
    document.documentElement.style.overflow = "hidden";
  }

  // Where a slide sits, or would sit, among the shown slides: the number of
  // shown slides before it in page order. A hidden slide makes way for the
  // next shown slide after it, or for the last one when none follows.
  function shownIndexFor(slide) {
    const position = state.allSlides.indexOf(slide);
    let index = 0;
    for (let before = 0; before < position; before += 1) {
      if (slideMatchesFilter(state.allSlides[before], state.settings)) {
        index += 1;
      }
    }
    return Math.max(0, Math.min(index, state.slides.length - 1));
  }

  // A filter change or an upgrade can remove the focused tile, or hide or
  // disable the focused control. Focus then goes where opening the view
  // would put it. A disabled button keeps focus until the browser's next
  // rendering step, so it counts as lost straight away.
  function refocusIfLost() {
    if (state.settingsOpen) return;
    const active = document.activeElement;
    if (
      !active ||
      !root.contains(active) ||
      active.disabled ||
      !active.getClientRects().length
    ) {
      focusInitialControl();
    }
  }

  // A filter that shows none of the loaded posts keeps loading until one
  // matches, and so does a stage whose every picture and video failed.
  function loadForEmptyFilter() {
    if (
      !state.open ||
      state.preparing ||
      state.slides.length ||
      state.loadingMore ||
      isSinglePostPage() ||
      (!mediaFilterActive(state.settings) && !state.unavailable)
    )
      return;
    state.advanceAfterLoad = false;
    state.prefetchLoads = 0;
    void loadMorePosts();
  }

  // Shows what the Show filter now lets through. The slides come from the
  // ones already read rather than from the page, so upgraded thumbnails stay
  // upgraded. A current slide that still matches stays, and the slideshow
  // then keeps its image, video and timer; otherwise the next shown slide in
  // page order takes over.
  function applyMediaFilter() {
    if (!state.open || state.preparing) return;
    const current = state.slides[state.index];
    cancelLoadMore();
    state.gridExhausted = false;
    // Other posts show now, so the feed may well have more of them.
    state.feedExhausted = false;
    state.slides = state.allSlides.filter((slide) =>
      slideMatchesFilter(slide, state.settings),
    );
    state.index = shownIndexFor(current);
    if (state.gridBuilt) resetGrid();
    if (
      state.view === "slideshow" &&
      current &&
      state.slides[state.index] === current
    ) {
      syncPresentationUi();
      prefetchIfLow();
      preloadAhead();
    } else {
      render();
      if (state.view === "grid") {
        revealGridTile(state.gridTiles.get(state.slides[state.index]));
      }
    }
    refocusIfLost();
    loadForEmptyFilter();
  }

  function syncGridStatus() {
    let text = "";
    if (!isSinglePostPage()) {
      const filtering = mediaFilterActive(state.settings);
      const shownLabel = shownMediaLabel(state.settings, "or");
      if (state.loadingMore) {
        text = filtering
          ? `Looking for more ${shownLabel}…`
          : "Loading more posts…";
        const checked = state.loadFound;
        if (filtering && checked) {
          text += ` ${checked} ${checked === 1 ? "post" : "posts"} checked`;
        }
      } else if (state.gridExhausted) {
        text = filtering
          ? `No more ${shownLabel} found`
          : "No more posts right now";
      }
    }
    gridStatus.textContent = text;
    gridStatus.hidden = !text;
  }

  function scheduleAuto() {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    if (
      state.autoPlaying &&
      state.open &&
      state.view === "slideshow" &&
      state.slides.length > 1
    ) {
      state.autoTimer = setTimeout(
        () => move(1),
        state.settings.slideDurationSeconds * 1000,
      );
    }
  }

  // Embeds point at a player page (youtube.com/embed/…), so prefer the post's
  // own link (youtube.com/watch?…) for them. Other kinds link the media file.
  function mediaHref(slide) {
    if (slide.kind === "embed" && slide.sourceUrl) return slide.sourceUrl;
    return slide.url || slide.sourceUrl || slide.commentsUrl;
  }

  function syncSettingsUi() {
    durationInput.value = String(state.settings.slideDurationSeconds);
    Object.keys(settingCheckboxes).forEach((key) => {
      settingCheckboxes[key].checked = state.settings[key];
    });
    // At least one media type always shows, so its box cannot be unticked.
    const locked = lockedMediaType(state.settings);
    MEDIA_FILTER_TYPES.forEach(([key]) => {
      const input = settingCheckboxes[key];
      input.disabled = key === locked;
      if (input.disabled) {
        input.parentElement.title = "At least one type stays shown";
      } else {
        input.parentElement.removeAttribute("title");
      }
    });
  }

  function openSettings() {
    state.settingsOpen = true;
    syncSettingsUi();
    settingsOverlay.hidden = false;
    settingsClose.focus({ preventScroll: true });
  }

  function closeSettings() {
    if (!state.settingsOpen) return;
    state.settingsOpen = false;
    settingsOverlay.hidden = true;
    (state.settings.showControls ? settingsButton : collapseButton).focus({
      preventScroll: true,
    });
  }

  function updateSettings(changes) {
    Object.assign(state.settings, changes);
    saveSettings();
    // Display changes must not reload the image, restart playback, or reset
    // the current slide's timer. Only a new duration needs a fresh timer,
    // and only the Show filter changes which slides there are.
    syncPresentationUi();
    if ("slideDurationSeconds" in changes) scheduleAuto();
    if (MEDIA_FILTER_TYPES.some(([key]) => key in changes)) {
      syncSettingsUi();
      applyMediaFilter();
    }
  }

  function updateSetting(key, value) {
    updateSettings({ [key]: value });
  }

  function setAutoPlaying(playing) {
    state.autoPlaying = playing;
    autoButton.textContent = playing ? "pause" : "auto";
    autoButton.setAttribute("aria-pressed", String(playing));
    const video = mediaBox.querySelector("video");
    if (video) video.loop = !playing;
    scheduleAuto();
  }

  function toggleAuto() {
    setAutoPlaying(!state.autoPlaying);
  }

  // The grid and the slideshow share one overlay. The grid stops playback
  // and auto-advance, and the slideshow opens at whichever tile was chosen.
  function showGrid() {
    if (!state.open || !state.slides.length) return;
    state.view = "grid";
    state.returnToGrid = false;
    state.advanceAfterLoad = false;
    state.gridExhausted = false;
    setAutoPlaying(false);
    render();
    // display:none dropped the grid's scroll position.
    grid.scrollTop = state.gridScrollTop;
    focusInitialControl();
  }

  function showSlideshow(index) {
    if (!state.open || index < 0 || index >= state.slides.length) return;
    if (state.view === "grid") state.gridScrollTop = grid.scrollTop;
    // Hidden tiles are out of range; upgrades already in flight still land.
    state.gridEnrichQueue = [];
    state.view = "slideshow";
    state.returnToGrid = true;
    state.index = index;
    render();
    focusInitialControl();
  }

  function toggleView() {
    if (!state.slides.length) return;
    if (state.view !== "grid") {
      showGrid();
      return;
    }
    const tile = focusedGridTile();
    const index = tile ? gridSlideIndex(tile) : -1;
    showSlideshow(index >= 0 ? index : state.index);
  }

  // In the grid, the current slide's tile. Otherwise the close button, or
  // whichever control is left when it is hidden.
  function focusInitialControl() {
    const tile =
      state.view === "grid"
        ? state.gridTiles.get(state.slides[state.index])
        : null;
    if (tile) {
      revealGridTile(tile);
      tile.focus({ preventScroll: true });
      return;
    }
    const initialFocus = closeButton.hidden
      ? state.settings.showControls
        ? settingsButton
        : collapseButton
      : closeButton;
    initialFocus.focus({ preventScroll: true });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen().catch(() => {});
  }

  // Safari has had no auxclick event; a middle click still ends in a mouseup
  // there.
  const MIDDLE_CLICK_EVENT = "onauxclick" in window ? "auxclick" : "mouseup";

  // The slide whose media a middle click or a Ctrl/Cmd click opens in a new
  // tab: the slideshow's picture or video, or a grid tile. Link cards are
  // real links already, and an embedded player keeps its own clicks.
  function newTabSlide(event) {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return null;
    const tile = target.closest(".redditp__tile");
    if (tile) {
      return gridColumns.contains(tile)
        ? gridTileInfo.get(tile)?.slide || null
        : null;
    }
    const media = target.closest(".redditp__image, .redditp__video");
    if (!media || media.parentNode !== mediaBox) return null;
    return state.slides[state.index] || null;
  }

  function opensNewTab(event) {
    if (event.type === "click") {
      return event.button === 0 && (event.ctrlKey || event.metaKey);
    }
    return event.button === 1;
  }

  // Opens the slide's hosted file in a new tab, the way a middle click or a
  // Ctrl/Cmd click would on a link. A plain click keeps its own job: playing
  // or pausing a video, or opening the slideshow from a tile.
  function openMediaInNewTab(event) {
    if (!opensNewTab(event)) return;
    const slide = newTabSlide(event);
    const href = slide ? mediaHref(slide) : "";
    if (!href) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.open(href, "_blank", "noopener,noreferrer");
  }

  // Keeps the middle button from starting the browser's autoscroll where
  // its click opens the media instead.
  function preventMiddleButtonScroll(event) {
    if (event.button === 1 && newTabSlide(event)) event.preventDefault();
  }

  function onGridClick(event) {
    const tile = event.target.closest?.(".redditp__tile");
    if (!tile || !gridColumns.contains(tile)) return;
    const index = gridSlideIndex(tile);
    if (index >= 0) showSlideshow(index);
  }

  // Waits for a resize to settle. Only a new width can change the column
  // count, and relayoutGrid leaves the grid alone otherwise.
  function onWindowResize() {
    clearTimeout(state.gridResizeTimer);
    state.gridResizeTimer = setTimeout(() => {
      state.gridResizeTimer = null;
      if (state.open && state.view === "grid" && state.gridBuilt) {
        relayoutGrid();
      }
    }, 150);
  }

  function playVideo(video) {
    video.play().catch((error) => {
      // The remembered sound setting can start a presentation without a user
      // gesture on the page, where browsers refuse unmuted autoplay. Play this
      // video muted instead; the setting stays on for later slides.
      if (error?.name !== "NotAllowedError" || video.muted) return;
      if (video.parentNode !== mediaBox) return;
      video.muted = true;
      video.play().catch(() => {});
    });
  }

  function currentEmbed() {
    return mediaBox.querySelector("iframe.redditp__embed");
  }

  // A player frame is cross-origin, so its video cannot be touched from this
  // document and no amount of DOM work will reach it. Two things still are
  // possible: ask for the opening state in the frame URL, and speak a player's
  // own message protocol where it publishes one.
  function commandableEmbed() {
    const embed = currentEmbed();
    if (!embed) return null;
    try {
      return new URL(embed.src).origin === JS_API_EMBED_ORIGIN ? embed : null;
    } catch (_error) {
      return null;
    }
  }

  function sendEmbedSound() {
    const embed = commandableEmbed();
    if (!embed?.contentWindow) return;
    try {
      embed.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: state.settings.sound ? "unMute" : "mute",
          args: [],
        }),
        JS_API_EMBED_ORIGIN,
      );
    } catch (_error) {
      // The frame went away between the click and the message.
    }
  }

  function initializeEmbed(embed) {
    if (embed !== commandableEmbed() || !embed.contentWindow) return;
    try {
      // YouTube's iframe protocol emits onReady after a parent announces that
      // it is listening. The load event alone can fire before the player is
      // ready to accept commands.
      embed.contentWindow.postMessage(
        JSON.stringify({ event: "listening", id: "redditp" }),
        JS_API_EMBED_ORIGIN,
      );
    } catch (_error) {
      return;
    }
    sendEmbedSound();
  }

  function onEmbedMessage(event) {
    if (event.origin !== JS_API_EMBED_ORIGIN) return;
    const embed = commandableEmbed();
    if (!embed?.contentWindow || event.source !== embed.contentWindow) return;
    let message = event.data;
    if (typeof message === "string") {
      try {
        message = JSON.parse(message);
      } catch (_error) {
        return;
      }
    }
    if (message?.event === "onReady") sendEmbedSound();
  }

  function toggleSound() {
    const video = mediaBox.querySelector("video");
    // Follow what the user hears: a video muted by the autoplay fallback is
    // silent even though the setting is on, so the toggle unmutes it.
    const sound = video ? video.muted : !state.settings.sound;
    updateSetting("sound", sound);
    if (video) video.muted = !sound;
    sendEmbedSound();
  }

  function toggleVideoFromSurface(event) {
    const video = event.target.closest?.("video.redditp__video");
    if (!video || event.button !== 0) return;
    const bounds = video.getBoundingClientRect();
    // Leave the browser's native control strip alone. Reddit also attaches a
    // click handler to its video element; intercept clicks on the picture so
    // the two handlers do not pause and immediately resume each other.
    if (event.clientY >= bounds.bottom - 56) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function releaseVideoFocus(event) {
    const video = event.target;
    if (
      video.tagName !== "VIDEO" ||
      document.activeElement !== video ||
      video.matches(":focus-visible")
    )
      return;
    // Clicking a native control such as mute, play or the seek bar focuses a
    // button inside the video's user-agent shadow root, and Chrome then stops
    // delivering key events to the page, so the arrow keys could no longer
    // change slides. Chrome does not dispatch the control's pointer events to
    // the page, so wait for the media event the control causes. Blurring on
    // focus instead would close the overflow menu as soon as it opened.
    // Keyboard users who tab into the player keep its native controls.
    video.blur();
  }

  // On Reddit, a community or author link leaves this presentation for the
  // one on that page. A page that hosts the viewer stays put, and the link
  // opens Reddit in a new tab instead.
  function followMetaLink(link) {
    if (activeSource === liveSource) {
      link.addEventListener("click", navigateToPresentation);
    } else {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }

  function navigateToPresentation(event) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const href = event.currentTarget.href;
    close();
    location.assign(href);
  }

  function close() {
    if (!state.open && !state.opening) return;
    const wasOpen = state.open;
    const source = activeSource;
    state.open = false;
    state.opening = false;
    state.preparing = false;
    state.autoPlaying = false;
    state.loadingMore = false;
    state.advanceAfterLoad = false;
    state.loadRequest += 1;
    state.openRequest += 1;
    stopFeedWatch(feedWatch);
    state.prefetchLoads = 0;
    state.preloads.clear();
    state.settingsOpen = false;
    settingsOverlay.hidden = true;
    clearTimeout(state.autoTimer);
    autoButton.textContent = "auto";
    stopMedia();
    resetGrid();
    state.returnToGrid = false;
    clearTimeout(state.gridResizeTimer);
    state.gridResizeTimer = null;
    window.removeEventListener("resize", onWindowResize);
    root.hidden = true;
    document.documentElement.style.overflow = state.oldOverflow;
    // Loads scrolled Reddit to its end; the page goes back to where it was.
    if (wasOpen) window.scrollTo(0, state.pageScrollY);
    document.removeEventListener("keydown", onKeyDown, true);
    if (wasOpen && source !== liveSource) {
      try {
        source.onClose?.();
      } catch (_error) {
        // A source's own bookkeeping never keeps the viewer open.
      }
    }
  }

  function retire() {
    close();
    root.remove();
    document.removeEventListener("redditp:presentation-retire", retire);
    window.removeEventListener("message", onEmbedMessage);
  }

  // Opens on the Reddit page underneath, or on the source that a page
  // hosting the viewer hands over.
  async function open(source) {
    if (state.open || state.opening) return;
    activeSource = source || liveSource;
    const request = ++state.openRequest;
    state.opening = true;
    await loadSettings();
    if (request !== state.openRequest) {
      state.opening = false;
      return;
    }
    state.opening = false;
    state.oldOverflow = document.documentElement.style.overflow;
    state.pageScrollY = window.scrollY;
    state.open = true;
    root.hidden = false;
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onWindowResize);
    // The starting view comes from the setting alone, never from the last
    // presentation.
    state.view = state.settings.openInGrid ? "grid" : "slideshow";
    state.returnToGrid = false;
    resetGrid();
    // Slides are rebuilt from the live page on every open, so the previous
    // run's enrichment results no longer refer to anything. Keeping them would
    // make enrichSlide skip every thumbnail it had already upgraded once.
    state.enrichments.clear();
    state.feedExhausted = false;
    state.prefetchLoads = 0;
    state.preloads.clear();
    state.allSlides = [];
    state.slides = [];
    state.unavailable = 0;
    state.preparing = true;
    render();
    if (activeSource !== liveSource) {
      await openSource(request);
      return;
    }
    await waitForAdaptivePlayer(request);
    if (!state.open || request !== state.openRequest) return;
    state.preparing = false;
    // Every post is read afresh on each open.
    seenPostNodes = new WeakSet();
    state.allSlides = skipDeadSlides(extractSlides());
    state.slides = state.allSlides.filter((slide) =>
      slideMatchesFilter(slide, state.settings),
    );
    state.index = Math.min(state.index, Math.max(0, state.slides.length - 1));
    render();
    focusInitialControl();
    // A filter that hides every post here goes looking for more.
    loadForEmptyFilter();
  }

  // Opens on the first batch another source hands over, where the page's
  // posts would be read. Until it arrives, the stage shows the source's
  // preparing text.
  async function openSource(request) {
    let first = null;
    try {
      first = await activeSource.start({ wants: sourceWants });
    } catch (_error) {
      // A source that fails to start leaves the stage empty.
    }
    if (!state.open || request !== state.openRequest) return;
    state.preparing = false;
    appendSourceResult(first);
    // The slide to open at, or the next one the filter shows.
    const startIndex = Math.min(
      Math.max(0, Math.floor(Number(first?.index) || 0)),
      state.allSlides.length - 1,
    );
    state.index = state.allSlides.length
      ? shownIndexFor(state.allSlides[startIndex])
      : 0;
    state.feedExhausted = !sourceHasMore();
    render();
    focusInitialControl();
    loadForEmptyFilter();
  }

  function focusableElements() {
    const container = state.settingsOpen ? settingsPanel : root;
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.hidden && element.getClientRects().length > 0,
    );
  }

  function trapFocus(event) {
    const focusable = focusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const container = state.settingsOpen ? settingsPanel : root;
    if (!container.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // In the grid the browser does the work for these keys: it scrolls the
  // grid and presses the focused tile. They only need keeping from Reddit's
  // own page shortcuts.
  const GRID_BROWSER_KEYS = [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
    "Enter",
  ];
  // Slide shortcuts, which have no slide to act on in the grid.
  const GRID_IDLE_KEYS = ["g", "m", "t", "c", "i", "a"];

  function onGridKeyDown(event) {
    const key = event.key.toLowerCase();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (key === "f" && document.fullscreenEnabled) {
      event.preventDefault();
      toggleFullscreen();
    } else if (key === "p") {
      event.preventDefault();
      updateSetting("showControls", !state.settings.showControls);
    } else if (GRID_BROWSER_KEYS.includes(event.key)) {
      event.stopPropagation();
    } else if (GRID_IDLE_KEYS.includes(key)) {
      event.preventDefault();
    }
  }

  function onKeyDown(event) {
    if (!state.open) return;
    // Never swallow browser and OS shortcuts such as Ctrl+F or Cmd+M; every
    // binding below is a bare key.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (state.settingsOpen) {
      if (event.key === "Tab") {
        trapFocus(event);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSettings();
      }
      return;
    }
    if (event.key === "Tab") {
      trapFocus(event);
      return;
    }
    if (event.key.toLowerCase() === "v") {
      event.preventDefault();
      event.stopPropagation();
      toggleView();
      return;
    }
    if (event.key.toLowerCase() === "o") {
      event.preventDefault();
      event.stopPropagation();
      updateSettings(nextMediaFilter(state.settings));
      return;
    }
    if (event.key.toLowerCase() === "h") {
      // Like C and I, H passes through when there is nothing to open.
      if (archiveButton.hidden || archiveButton.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      openArchive();
      return;
    }
    if (state.view === "grid") {
      onGridKeyDown(event);
      return;
    }
    if (
      event.key === "ArrowRight" ||
      event.key === "PageDown" ||
      event.key === " "
    ) {
      event.preventDefault();
      event.stopPropagation();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      event.stopPropagation();
      move(-1);
    } else if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      event.stopPropagation();
      skipGallery();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // A slideshow opened from the grid goes back to it; × still closes.
      if (state.returnToGrid) showGrid();
      else close();
    } else if (event.key.toLowerCase() === "f" && document.fullscreenEnabled) {
      event.preventDefault();
      toggleFullscreen();
    } else if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      toggleSound();
    } else if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      updateSetting("showDetails", !state.settings.showDetails);
    } else if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      updateSetting("showControls", !state.settings.showControls);
    } else if (event.key.toLowerCase() === "c") {
      const slide = state.slides[state.index];
      if (!slide?.commentsUrl) return;
      event.preventDefault();
      window.open(slide.commentsUrl, "_blank", "noopener,noreferrer");
    } else if (event.key.toLowerCase() === "i") {
      const slide = state.slides[state.index];
      const href = slide && mediaHref(slide);
      if (!href) return;
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    } else if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      toggleAuto();
    }
  }

  closeButton.addEventListener("click", close);
  settingsButton.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", (event) => {
    if (event.target === settingsOverlay) closeSettings();
  });
  durationInput.addEventListener("change", () => {
    const seconds = Math.min(
      3600,
      Math.max(1, Math.round(Number(durationInput.value) || 1)),
    );
    durationInput.value = String(seconds);
    updateSetting("slideDurationSeconds", seconds);
  });
  Object.keys(settingCheckboxes).forEach((key) => {
    settingCheckboxes[key].addEventListener("change", () => {
      updateSetting(key, settingCheckboxes[key].checked);
    });
  });
  collapseButton.addEventListener("click", () => {
    updateSetting("showControls", !state.settings.showControls);
  });
  // Ahead of the surface toggle, so a Ctrl/Cmd click opens the media rather
  // than pausing it.
  mediaBox.addEventListener("click", openMediaInNewTab, true);
  mediaBox.addEventListener("click", toggleVideoFromSurface, true);
  // After clicking "mute" and "unmute" the right-left arows failed to change
  // the current slide in Chrome (seemed to work in Firefox).
  // Media events do not bubble, so listen during capture.
  ["volumechange", "play", "pause", "seeked", "ratechange"].forEach((type) => {
    mediaBox.addEventListener(type, releaseVideoFocus, true);
  });
  document.addEventListener("redditp:presentation-retire", retire);
  window.addEventListener("message", onEmbedMessage);
  prevButton.addEventListener("click", () => move(-1));
  nextButton.addEventListener("click", () => move(1));
  autoButton.addEventListener("click", toggleAuto);
  soundButton.addEventListener("click", toggleSound);
  galleryButton.addEventListener("click", skipGallery);
  viewButton.addEventListener("click", toggleView);
  archiveButton.addEventListener("click", openArchive);
  MEDIA_FILTER_TYPES.forEach(([key]) => {
    mediaToggleButtons[key].addEventListener("click", () => {
      if (key === lockedMediaType(state.settings)) return;
      updateSettings({ [key]: !state.settings[key] });
    });
  });
  // Ahead of onGridClick, so a Ctrl/Cmd click opens the media and stays in
  // the grid.
  grid.addEventListener("click", openMediaInNewTab, true);
  grid.addEventListener("click", onGridClick);
  [mediaBox, grid].forEach((surface) => {
    surface.addEventListener(MIDDLE_CLICK_EVENT, openMediaInNewTab);
    surface.addEventListener("mousedown", preventMiddleButtonScroll);
  });
  root.addEventListener("pointerdown", (event) => {
    state.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
    };
  });
  root.addEventListener("pointerup", (event) => {
    if (!state.pointerStart || state.pointerStart.id !== event.pointerId)
      return;
    const dx = event.clientX - state.pointerStart.x;
    const dy = event.clientY - state.pointerStart.y;
    state.pointerStart = null;
    if (
      state.view === "slideshow" &&
      Math.abs(dx) > 55 &&
      Math.abs(dx) > Math.abs(dy) &&
      !event.target.closest("button, a, video")
    ) {
      move(dx < 0 ? 1 : -1);
    }
  });

  document.documentElement.append(root);
  window.__redditpPresentation = {
    toggle() {
      if (state.open || state.opening) close();
      else open();
    },
    // For a page that hosts the viewer: open it on a source of posts (see
    // liveSource for the shape), close it, and read its media URL rules.
    open: (source) => open(source),
    close: () => close(),
    media: {
      IMAGE_URL_RE,
      VIDEO_URL_RE,
      isVideoUrl,
      canonicalMediaKey,
      externalMedia,
    },
  };
  if (!EMBEDDED) open();
})();
