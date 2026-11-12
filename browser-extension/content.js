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
    // The Hidden list: users, subreddits and sites whose posts never show
    // (see normalizeHiddenEntry). A change replaces the list rather than
    // changing it in place.
    hidden: [],
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

  // redditp-grid-rendition:start
  // Which of Reddit's smaller copies of a picture a grid tile loads.
  // content.js and archive.js carry this block word for word, and it stays
  // DOM-free, so nodejs/test-embedit.js can check both copies. Grid columns
  // are 300 to 600 CSS pixels wide on a computer, and about 170 to 200 on a
  // phone, whose screen has 2 or 3 device pixels to the CSS pixel, so a copy
  // GRID_THUMB_WIDTH pixels wide looks sharp in any column at a fraction of
  // the original's weight.
  const GRID_THUMB_WIDTH = 640;

  // The narrowest of a picture's copies that is at least GRID_THUMB_WIDTH
  // wide, from a list of { url, width }. When none is that wide, the
  // picture is small already, so its tile loads the picture itself: null,
  // unless orWidest asks for the widest copy instead, as for a GIF, whose
  // file weighs far more than any copy of it. Copies without a URL or a
  // width are passed over.
  function gridRendition(copies, orWidest) {
    let narrowest = null;
    let widest = null;
    (Array.isArray(copies) ? copies : []).forEach((copy) => {
      if (!copy || typeof copy.url !== "string" || !copy.url) return;
      const width = Number(copy.width);
      if (!Number.isFinite(width) || width <= 0) return;
      if (!widest || width > Number(widest.width)) widest = copy;
      if (
        width >= GRID_THUMB_WIDTH &&
        (!narrowest || width < Number(narrowest.width))
      ) {
        narrowest = copy;
      }
    });
    return narrowest || (orWidest ? widest : null);
  }

  // Whether a copy is a still picture. Reddit's copies of a GIF keep the
  // .gif name, and are stills only when their format says so; without one
  // they are GIFs again, often of megabytes.
  function isStillCopy(url) {
    if (typeof url !== "string") return false;
    const decoded = url.replace(/&amp;/g, "&");
    if (!/\.gif(?:$|[?#])/i.test(decoded)) return true;
    try {
      const format = new URL(decoded).searchParams.get("format") || "";
      return /^(?:png8?|p?jpg)$/i.test(format);
    } catch (_error) {
      return false;
    }
  }
  // redditp-grid-rendition:end

  // redditp-media-filter:start
  // Media types for the Show filter, and the Hidden list. Like the grid
  // layout block, this stays DOM-free and self-contained, so
  // nodejs/test-embedit.js can evaluate it on its own.
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

  // The Hidden list: users ("u/name"), subreddits ("r/name") and sites
  // ("redgifs.com", which covers its subdomains too) whose posts the
  // slideshow and the grid leave out, whatever the Show filter shows.
  // Entries keep the case they came in, and match in any case. The list is
  // saved with the other settings, and capped at HIDDEN_MAX_ENTRIES.
  const HIDDEN_MAX_ENTRIES = 1000;
  // Longer input is no entry: a site's name is at most 253 characters, and a
  // URL that names one rarely needs more than this.
  const HIDDEN_MAX_INPUT = 2048;
  const HIDDEN_USER_RE = /^[A-Za-z0-9_-]{1,20}$/;
  const HIDDEN_SUB_RE = /^[A-Za-z0-9_]{2,21}$/;
  const HIDDEN_SITE_RE =
    /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const HIDDEN_PREFIX_RE = /^(u|user|r)\/([^/]+)\/?$/i;
  // A Reddit address that names a user or a subreddit, as pasted from the
  // address bar, stands for them rather than for all of reddit.com.
  const HIDDEN_REDDIT_PATH_RE = /^\/(u|user|r)\/([^/]+)/i;

  function hiddenNameEntry(prefix, name) {
    if (prefix.toLowerCase() === "r") {
      return HIDDEN_SUB_RE.test(name) ? `r/${name}` : "";
    }
    return HIDDEN_USER_RE.test(name) ? `u/${name}` : "";
  }

  // A site's entry: the host that the text names, lowercase, without "www."
  // in front. Text without a scheme reads as a host, maybe with a path.
  function hiddenSiteEntry(text) {
    let parsed;
    try {
      parsed = new URL(
        /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`,
      );
    } catch (_error) {
      return "";
    }
    const host = parsed.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
    const named = HIDDEN_REDDIT_PATH_RE.exec(parsed.pathname);
    if (named && /(?:^|\.)reddit\.com$/.test(host)) {
      return hiddenNameEntry(named[1], named[2]);
    }
    return HIDDEN_SITE_RE.test(host) ? host : "";
  }

  // An entry for the Hidden list from what someone typed, or from a slide's
  // author or community, or "" when it names none. A leading "/" is dropped;
  // "u/", "user/" and "r/" say what follows; a word without a dot is a user,
  // since Reddit's usernames have none; and anything with a dot is a site.
  function normalizeHiddenEntry(value) {
    if (typeof value !== "string") return "";
    const text = value.trim().replace(/^\/+/, "");
    if (!text || text.length > HIDDEN_MAX_INPUT) return "";
    const prefixed = HIDDEN_PREFIX_RE.exec(text);
    if (prefixed) return hiddenNameEntry(prefixed[1], prefixed[2]);
    if (!text.includes(".")) return hiddenNameEntry("u", text);
    return hiddenSiteEntry(text);
  }

  // What an entry matches by: the same in any case.
  function hiddenEntryKey(entry) {
    return String(entry).toLowerCase();
  }

  // A saved list as the viewer uses it: entries only, each once, at most
  // HIDDEN_MAX_ENTRIES of them. Anything else reads as an empty list.
  function normalizedHiddenList(value) {
    const list = [];
    const keys = new Set();
    (Array.isArray(value) ? value : []).forEach((item) => {
      if (list.length >= HIDDEN_MAX_ENTRIES) return;
      const entry = normalizeHiddenEntry(item);
      const key = hiddenEntryKey(entry);
      if (!entry || keys.has(key)) return;
      keys.add(key);
      list.push(entry);
    });
    return list;
  }

  // The list with what someone typed added at its end: { list, entry,
  // status }, where status is "added", "invalid" when the text names no
  // entry, "duplicate" when the entry is there already, or "full". Only
  // "added" gives a new list; the list given is never changed.
  function addToHiddenList(list, value) {
    const entry = normalizeHiddenEntry(value);
    if (!entry) return { list, entry, status: "invalid" };
    const key = hiddenEntryKey(entry);
    const existing = list.find((item) => hiddenEntryKey(item) === key);
    if (existing) return { list, entry: existing, status: "duplicate" };
    if (list.length >= HIDDEN_MAX_ENTRIES) {
      return { list, entry, status: "full" };
    }
    return { list: list.concat(entry), entry, status: "added" };
  }

  // The list without the entry, in any case, as a new list.
  function removeFromHiddenList(list, entry) {
    const key = hiddenEntryKey(entry);
    return list.filter((item) => hiddenEntryKey(item) !== key);
  }

  // The keys of a list, made once per list: a change gives a new list
  // rather than changing the old one.
  const hiddenKeySets = new WeakMap();

  function hiddenKeys(list) {
    if (!Array.isArray(list) || !list.length) return null;
    let keys = hiddenKeySets.get(list);
    if (!keys) {
      keys = new Set(list.map(hiddenEntryKey));
      hiddenKeySets.set(list, keys);
    }
    return keys;
  }

  // A slide's host, read once per address it has.
  const slideHosts = new WeakMap();

  function urlHost(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function slideHost(slide) {
    const known = slideHosts.get(slide);
    if (
      known &&
      known.sourceUrl === slide.sourceUrl &&
      known.url === slide.url
    ) {
      return known.host;
    }
    const host = urlHost(slide.sourceUrl) || urlHost(slide.url);
    slideHosts.set(slide, { sourceUrl: slide.sourceUrl, url: slide.url, host });
    return host;
  }

  // A slide's author or community as a key, with its prefix even where
  // another source left it out.
  function prefixedKey(value, prefix) {
    const key = hiddenEntryKey(value).replace(/^\/+/, "");
    return key.startsWith(prefix) ? key : prefix + key;
  }

  // Whether the Hidden list leaves a slide out: by its author, its
  // subreddit, or the host of the post's link (or else of its media), or
  // any domain above that host. A search result that shows only a
  // thumbnail does not know its post's link yet, so only its author and
  // subreddit count until enrichSlide has read the post.
  function slideIsHidden(slide, list) {
    const keys = hiddenKeys(list);
    if (!keys) return false;
    if (slide.author && keys.has(prefixedKey(slide.author, "u/"))) {
      return true;
    }
    if (slide.community && keys.has(prefixedKey(slide.community, "r/"))) {
      return true;
    }
    if (slide.mediaUnknown) return false;
    let host = slideHost(slide);
    while (host) {
      if (keys.has(host)) return true;
      const dot = host.indexOf(".");
      host = dot < 0 ? "" : host.slice(dot + 1);
    }
    return false;
  }

  function slideMatchesFilter(slide, settings) {
    if (slideIsHidden(slide, settings.hidden)) return false;
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

  // The counter's whole note on what is left out: the Show filter's, then
  // how many loaded posts the Hidden list leaves out, as in "images only ·
  // 3 hidden".
  function filterSummary(settings, hiddenPosts) {
    return [
      mediaFilterSummary(settings),
      hiddenPosts > 0 ? `${hiddenPosts} hidden` : "",
    ]
      .filter(Boolean)
      .join(" · ");
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
  // stay referenced until they show, which covers the way there and back.
  // Of the next PRELOAD_AHEAD slides, the first WARM_VIDEOS_AHEAD videos
  // whose file is on one of WARM_VIDEO_HOST_RE, Reddit's own media hosts,
  // are read in ahead too, so that they start at once. On a computer a
  // picture ahead costs little, and a slide that shows late costs a lot.
  const PREFETCH_AHEAD = 8;
  const PREFETCH_ROUNDS = 4;
  const PRELOAD_AHEAD = 6;
  const PRELOAD_CACHE_SIZE = 12;
  const WARM_VIDEOS_AHEAD = 2;
  const WARM_VIDEO_HOST_RE =
    /^(?:v|i|preview|external-preview|packaged-media)\.redd\.it$/i;

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

  // The videos to read in before the next few slides show: the files of the
  // first WARM_VIDEOS_AHEAD video slides among the next PRELOAD_AHEAD, where
  // Reddit hosts them over https, each once. Reddit's own players, whose
  // video the slideshow borrows from the page, other hosts' videos and
  // stream playlists are left alone.
  function warmVideoUrls(slides, index) {
    const urls = [];
    slides.slice(index + 1, index + 1 + PRELOAD_AHEAD).forEach((slide) => {
      if (urls.length >= WARM_VIDEOS_AHEAD || slide?.kind !== "video") return;
      let parsed;
      try {
        parsed = new URL(slide.url);
      } catch (_error) {
        return;
      }
      if (
        parsed.protocol === "https:" &&
        WARM_VIDEO_HOST_RE.test(parsed.hostname) &&
        !/\.(?:m3u8|mpd)$/i.test(parsed.pathname) &&
        !urls.includes(slide.url)
      ) {
        urls.push(slide.url);
      }
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
    // The last press moved too far to count as a tap.
    pointerDragged: false,
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
    // Loads in a row that the end of the grid started by itself, and where
    // the grid was scrolled when the first of them started (see
    // gridLoadWanted).
    gridLoads: 0,
    gridLoadTop: 0,
    // Thumbnail slides waiting for the grid to upgrade them, and how many of
    // those upgrades are in flight.
    gridEnrichQueue: [],
    gridEnrichActive: 0,
    // Failed upgrades in a row; the grid stops asking after a few.
    gridEnrichFailures: 0,
    // Players' slides waiting for a still from Reddit's data, how many
    // requests for them are in flight, and how many failed in a row.
    gridStillQueue: [],
    gridStillActive: 0,
    gridStillFailures: 0,
    // Requests for Reddit's data made this open, and how many failed.
    gridStillRequests: 0,
    gridStillFailed: 0,
    // Posts the running load has found so far, shown or not.
    loadFound: 0,
    // Set when a load ends because Reddit added nothing for LOAD_IDLE_MS, or
    // because the filter hid FILTERED_MAX_ROUNDS batches in a row, and
    // cleared when a load finds posts and ends otherwise, or the filter
    // changes. While it is set, only the last post starts loads, and next on
    // the last slide wraps at once.
    feedExhausted: false,
    // How many loads the running background prefetch has started, the first
    // included; 0 when the running load is not a prefetch.
    prefetchLoads: 0,
    // Pictures fetched ahead of the slideshow: URL -> Image, oldest first.
    preloads: new Map(),
    // Videos read ahead of the slideshow: URL -> a video element in no
    // document (see warmVideosAhead).
    warmVideos: new Map(),
    // Where the Reddit page was scrolled when presentation mode opened.
    pageScrollY: 0,
    // Pictures and videos this open dropped, or left out, because they
    // failed to load.
    unavailable: 0,
  };
  // Grid tile -> { slide, height, loadPicture, loop, loopSrc, inRange,
  // visible, video, buffer, loopFailed, loopState }: the height in column
  // widths; the function that starts loading the tile's picture, until it
  // has started; and the tile's loop (see addGridLoop): the loop that its
  // slide names, what the tile plays of it once that is known (see
  // gridLoopSource), whether the tile is within the loop's range (see
  // GRID_LOOP_MARGIN) and in view, its video element while it has one,
  // whether that reads itself in (see gridLoopPlan), whether the loop
  // failed, and what the tile's data-loop attribute says of it (see
  // setGridLoopState).
  const gridTileInfo = new WeakMap();
  // Watches the grid's thumbnail tiles, and the tiles of players without a
  // picture or a loop (see wantsGridStill), where supported.
  let gridObserver = null;
  // Watches the end of the grid, further ahead than the tiles.
  let gridEndObserver = null;
  // Watches the tiles whose pictures have not started loading, where
  // supported.
  let gridPictureObserver = null;
  // Watches which tiles with a loop are within the loop's range, where
  // supported.
  let gridLoopRangeObserver = null;
  // Watches which tiles with a loop are in view, where supported.
  let gridLoopObserver = null;
  // The tiles whose loops are in the grid, in the order they arrived.
  const gridLoopTiles = new Set();
  // What Reddit videos' tiles play, until the tab reloads: video id -> the
  // rendition that their manifest names (see videoLoopRendition), or ""
  // where it could not be read, for the GRID_MANIFEST_CACHE_SIZE videos read
  // last.
  const videoLoopSources = new Map();
  // Video id -> the tiles within the loop's range that wait for its
  // manifest, while it waits to be read or is being read.
  const manifestWaiters = new Map();
  // The ids of the videos whose manifests wait to be read, in the order
  // their tiles asked, and of those being read.
  let manifestQueue = [];
  const manifestsReading = new Set();
  // The ids of the videos whose manifests tiles within the picture's range
  // asked for ahead of their loops (see prefetchGridManifest), until read.
  const manifestsAhead = new Set();
  // The animation frame that syncs the grid's loops after their media
  // events, while one is pending (see scheduleGridLoopSync).
  let gridLoopSyncFrame = 0;
  // The viewer's reduced motion preference, where the browser reports one.
  const reducedMotion =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
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
  // Players' slides the grid has asked Reddit's data about: once each, per
  // open.
  const gridStillTried = new WeakSet();
  // What Reddit's data brought for those players' slides: "asking" while
  // the request is in flight, then "loop", "no-data" when it named no loop,
  // or "info-failed" when the request failed (see restingGridLoopState).
  const gridStillOutcomes = new WeakMap();
  // The media keys of the page's pictures and videos that failed to load in
  // this tab, so later opens leave them out. A reload forgets them.
  const liveDeadKeys = new Set();

  // redditp-grid-ahead:start
  // How far ahead of its view the grid gets tiles ready, and in what order.
  // The extension runs on computers, where a few more megabytes cost little
  // and a tile that pops in as it scrolls into view costs a lot, so the grid
  // loads greedily, above all in the direction it is read: down. What it
  // holds stays bounded all the same: a picture is small, and a loop leaves
  // again once its tile is well out of range. Like the blocks above, this
  // stays DOM-free, so nodejs/test-embedit.js can evaluate it on its own.
  const GRID_ENRICH_CONCURRENCY = 2;
  const GRID_ENRICH_MAX_FAILURES = 3;
  // A load can take a while, and a screen of small tiles holds many posts,
  // so the grid starts one within eight screens of its end.
  const GRID_LOAD_MARGIN = "800% 0px";
  // The grid starts at most this many loads in a row by itself; after that,
  // only once the viewer has scrolled it (see gridLoadWanted). Filling eight
  // screens can take many loads, and a load whose posts all fail, or a Show
  // filter that lets one post in hundreds through, could otherwise keep
  // Reddit scrolling while the viewer sits still.
  const GRID_LOAD_ROUNDS = 6;
  // A tile's picture starts loading once the tile is within two screens
  // above the grid's view or six below it, so that even a fast scroll down
  // finds it loaded. The browser's own lazy loading looks too little ahead
  // inside a scrolling element such as the grid. A picture never unloads.
  const GRID_PICTURE_MARGIN = "200% 0px 600% 0px";
  // Thumbnail upgrades, players' stills from Reddit's data, and Reddit
  // videos' manifests come as far ahead as pictures, so that what they bring
  // is there before the tile shows too.
  const GRID_STILL_MARGIN = GRID_PICTURE_MARGIN;
  // A loop comes once its tile is within half a screen above the view or a
  // screen below it, and goes once the tile scrolls further away, so that
  // the grid holds a few screens' worth of loops at most. Ahead of the view
  // a loop reads itself in, paused (see gridLoopPlan), so that it plays the
  // moment its tile shows. Until it has a picture of its own, the tile shows
  // its still.
  const GRID_LOOP_MARGIN = "50% 0px 100% 0px";
  // At most this many loops play at once, in the tiles in view; the rest in
  // view wait under their stills. It covers the most tiles that fit in view
  // at 2560x1440: 8 columns of tiles 311 pixels wide and, at their widest
  // (see tileHeightRatio), 156 tall, of which 10 can show at once in each.
  const GRID_MAX_PLAYING_LOOPS = 80;
  // At most this many loops read themselves in ahead of the view at once,
  // nearest first, and none before every loop in view plays or can: those
  // in view get the network first. A loop has read itself in once it holds
  // all of itself, or GRID_LOOP_READ_SECONDS past where it is: enough to
  // play on while the browser reads the rest; or once the browser stops
  // reading it before that.
  const GRID_MAX_BUFFERING_LOOPS = 6;
  const GRID_LOOP_READ_SECONDS = 5;
  // A Reddit video's tile reads the video's manifest once the tile comes
  // within the picture's range, many manifests at a time, those of tiles in
  // view first, then those within the loop's range, and each once per video
  // (see videoLoopSources). A manifest weighs a kilobyte or two, and
  // v.redd.it serves many at once over one connection.
  const GRID_MANIFEST_CONCURRENCY = 12;
  const GRID_MANIFEST_CACHE_SIZE = 500;
  // A player whose card has no picture, such as a RedGIFs frame, gets its
  // tile's still, and a GIF or video that its card names no loop for gets
  // its loop, from Reddit's own data for the post, which the grid asks for
  // as the tiles come into range: for up to GRID_STILL_BATCH posts in one
  // request, the most that Reddit answers for, GRID_STILL_CONCURRENCY
  // requests at a time, and at most once per post per open. Several failed
  // requests in a row stop the asking until the next open.
  const GRID_STILL_BATCH = 100;
  const GRID_STILL_CONCURRENCY = 2;
  const GRID_STILL_MAX_FAILURES = 3;

  // What each loop in the grid does next. loops are each { visible, top,
  // distance, ready, buffer }: whether its tile is in view, where its tile
  // starts, how far from the view it is, whether it has enough to play, and
  // whether it reads itself in ahead of the view ("reading"), has done so
  // ("read"), or was never asked to (""). Returns, for each loop in view,
  // from the top of the view down, "play" for the first
  // GRID_MAX_PLAYING_LOOPS and "cap" for the rest. All start at once: loops
  // started a few at a time start later, since those started first go on
  // reading themselves in. Ahead of the view: "buffer", paused, for the loops
  // asked to read in already and, once every loop that plays has enough to,
  // for more of the nearest, while fewer than GRID_MAX_BUFFERING_LOOPS are
  // reading; and "wait", paused, for the rest, which have read nothing yet.
  function gridLoopPlan(loops) {
    const plan = loops.map(() => "wait");
    let playing = 0;
    let started = true;
    loops
      .map((_loop, index) => index)
      .filter((index) => loops[index].visible)
      .sort((a, b) => loops[a].top - loops[b].top)
      .forEach((index) => {
        if (playing >= GRID_MAX_PLAYING_LOOPS) {
          plan[index] = "cap";
          return;
        }
        plan[index] = "play";
        playing += 1;
        if (!loops[index].ready) started = false;
      });
    let reading = 0;
    const ahead = [];
    loops.forEach((loop, index) => {
      if (loop.visible) return;
      if (loop.buffer) {
        plan[index] = "buffer";
        if (loop.buffer === "reading") reading += 1;
      } else {
        ahead.push(index);
      }
    });
    if (!started) return plan;
    ahead
      .sort((a, b) => loops[a].distance - loops[b].distance)
      .forEach((index) => {
        if (reading >= GRID_MAX_BUFFERING_LOOPS) return;
        plan[index] = "buffer";
        reading += 1;
      });
    return plan;
  }

  // Whether a loop has read itself in (see GRID_LOOP_READ_SECONDS), from
  // what it holds, as [start, end] spans in seconds, where it is and how
  // long it lasts.
  function gridLoopReadIn(spans, time, duration) {
    if (!(duration > 0)) return false;
    const until = Math.min(duration, time + GRID_LOOP_READ_SECONDS) - 0.1;
    return spans.some(([start, end]) => start <= time + 0.1 && end >= until);
  }

  // Whether the end of the grid may start another load, after `loads` in a
  // row that it started by itself, with the grid scrolled by `scrolled`
  // pixels since the first of them, on a screen `screen` pixels tall: while
  // it has started fewer than GRID_LOAD_ROUNDS, or once the viewer has
  // scrolled half a screen, which starts a new row.
  function gridLoadWanted(loads, scrolled, screen) {
    return loads < GRID_LOAD_ROUNDS || Math.abs(scrolled) >= screen / 2;
  }
  // redditp-grid-ahead:end

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

  // The pictures a listing card may show for its post, most specific first.
  const CARD_IMAGE_SELECTOR =
    "gallery-carousel figure img:not([role='presentation']), faceplate-img[data-testid='search_post_thumbnail'], faceplate-img[src], faceplate-img[data-lazy-src], img[data-post-media-primary], img.preview-image, img:not([role='presentation'])";

  function sizeAttribute(image, name) {
    const value = Number(image.getAttribute(name));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function srcsetOf(image) {
    return srcsetCandidates(
      image.getAttribute("srcset") ||
        image.getAttribute("data-lazy-srcset") ||
        "",
    );
  }

  // What the grid needs of a picture in the card `node`, whose full URL is
  // `url`: thumb, the smaller still copy a tile loads, from the element's
  // srcset (see gridRendition), and the picture's size from its width and
  // height attributes, with "" and 0 for what the element does not say; and
  // for a GIF, thumbVideo, a small silent loop of it (see cardGifLoop). A
  // GIF with neither keeps its tile playing the GIF itself.
  function cardPicture(node, image, url) {
    const gif = GIF_URL_RE.test(url);
    const copy = gridRendition(srcsetOf(image), gif);
    return {
      thumb: copy && isStillCopy(copy.url) ? absoluteUrl(copy.url) : "",
      thumbVideo: gif ? cardGifLoop(node, url) : "",
      width: sizeAttribute(image, "width"),
      height: sizeAttribute(image, "height"),
    };
  }

  // The MP4 that Reddit made of a GIF (see isRedditGifMp4), where the card
  // has one among its players' and pictures' sources: the narrowest that is
  // wide enough, or the widest, where they say their widths. Only a copy of
  // the same upload counts; "" when the card has none.
  function cardGifLoop(node, url) {
    const found = [];
    node.querySelectorAll("video[src], source[src]").forEach((media) => {
      found.push({ url: media.getAttribute("src"), width: 0 });
    });
    node.querySelectorAll(CARD_IMAGE_SELECTOR).forEach((image) => {
      found.push(...srcsetOf(image), {
        url: image.getAttribute("src"),
        width: 0,
      });
    });
    const loops = found
      .map((candidate) => ({
        url: absoluteUrl((candidate.url || "").replace(/&amp;/g, "&")),
        width: candidate.width,
      }))
      .filter(
        (candidate) =>
          isRedditGifMp4(candidate.url) && sameRedditUpload(candidate.url, url),
      );
    const loop = gridRendition(loops, true) || loops[0];
    return loop ? loop.url : "";
  }

  // What the grid needs (see cardPicture) of a link straight to a Reddit
  // upload, from the card's preview of it. Only a preview that is a copy of
  // that same upload counts, though a GIF's loop may be in a card without
  // one; null when the card has neither.
  function uploadPicture(node, sourceUrl) {
    if (!redditUpload(sourceUrl)) return null;
    const preview = Array.from(node.querySelectorAll(CARD_IMAGE_SELECTOR)).find(
      (image) =>
        usefulImage(image) && sameRedditUpload(imageUrl(image), sourceUrl),
    );
    if (preview) return cardPicture(node, preview, sourceUrl);
    const loop = GIF_URL_RE.test(sourceUrl) ? cardGifLoop(node, sourceUrl) : "";
    return loop ? { thumbVideo: loop } : null;
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
  // share, which upload Reddit's copies of a picture come from, a srcset's
  // candidates, and the player frame for a link to a video host, with its
  // still where the host has one at a known address. Like the blocks above,
  // this stays DOM-free, so nodejs/test-embedit.js can evaluate it on its
  // own. A page that hosts the viewer reads the URL rules from
  // window.__redditpPresentation.media.
  const IMAGE_URL_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
  const VIDEO_URL_RE = /\.(?:m3u8|mp4|webm)(?:$|[?#])/i;
  // Reddit keeps an uploaded picture at i.redd.it/<id>.<ext>, and
  // preview.redd.it serves resized and re-encoded copies of it at the same
  // path, or at /<title>-v0-<id>.<ext>, with the size and format in the
  // query.
  const REDDIT_UPLOAD_PATH_RE = /^\/(?:[^/]*-v0-)?([a-z0-9]+)\.([a-z0-9]+)$/i;

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

  // The upload behind a picture on i.redd.it or preview.redd.it, as
  // { host, id, extension, format }, or null for any other URL.
  function redditUpload(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== "i.redd.it" && host !== "preview.redd.it") return null;
    const match = REDDIT_UPLOAD_PATH_RE.exec(parsed.pathname);
    if (!match) return null;
    return {
      host,
      id: match[1],
      extension: match[2],
      format: parsed.searchParams.get("format") || "",
    };
  }

  // Whether two URLs are copies of the same upload.
  function sameRedditUpload(first, second) {
    const a = redditUpload(first);
    const b = redditUpload(second);
    return Boolean(a && b && a.id.toLowerCase() === b.id.toLowerCase());
  }

  // The upload itself for one of preview.redd.it's full-size transcodes
  // (format=pjpg) of a JPEG or WebP, or "". The host makes those on demand,
  // so a first request for one can take seconds, while i.redd.it serves the
  // file it has, of about the same weight. A PNG keeps its transcode, since
  // the original can weigh many times more.
  function redditOriginalUrl(url) {
    const upload = redditUpload(url);
    if (
      !upload ||
      upload.host !== "preview.redd.it" ||
      upload.format !== "pjpg" ||
      !/^(?:jpe?g|webp)$/i.test(upload.extension)
    ) {
      return "";
    }
    return `https://i.redd.it/${upload.id}.${upload.extension}`;
  }

  // Whether a URL is the MP4 that Reddit's hosts make of a GIF: the GIF's
  // own address asked for format=mp4. It weighs a fraction of the GIF.
  function isRedditGifMp4(url) {
    try {
      const parsed = new URL(url);
      return (
        /^(?:i|preview|external-preview)\.redd\.it$/i.test(parsed.hostname) &&
        /\.gif$/i.test(parsed.pathname) &&
        parsed.searchParams.get("format") === "mp4"
      );
    } catch (_error) {
      return false;
    }
  }

  // A srcset's candidates as { url, width }, the width from a "640w"
  // descriptor and 0 for any other. Older markup escapes & as &amp;.
  function srcsetCandidates(srcset) {
    if (typeof srcset !== "string") return [];
    return srcset
      .replace(/&amp;/g, "&")
      .split(",")
      .map((part) => {
        const bits = part.trim().split(/\s+/);
        const descriptor = /^(\d+(?:\.\d+)?)w$/i.exec(bits[1] || "");
        return { url: bits[0], width: descriptor ? Number(descriptor[1]) : 0 };
      })
      .filter((candidate) => candidate.url);
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
      // A link to a video file is a video, which a picture would fail to
      // show.
      if (extension === "mp4" || extension === "webm") {
        return {
          kind: "video",
          url: `https://i.imgur.com/${match[1]}.${extension}`,
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

  // A still of the video in a player frame, where its host serves one at a
  // known address: YouTube does for its players (see externalMedia). ""
  // for any other frame.
  function embedStill(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      return "";
    }
    const match = /^\/embed\/([\w-]+)$/.exec(parsed.pathname);
    return parsed.hostname === "www.youtube.com" && match
      ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`
      : "";
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

  // redditp-media-save:start
  // Saving the current media to the local gallery: the message for the
  // native helper (com.edo.media_sync, reached through background.js), which
  // downloads the URL itself, and the short message for each of its replies.
  // Like the blocks above, this stays DOM-free, so nodejs/test-embedit.js can
  // evaluate it on its own, together with redditp-media-urls, which it reads.
  const SAVE_PORT_NAME = "media-sync";
  // The only hosts the helper downloads from.
  const SAVE_HOSTS = [
    "i.redd.it",
    "v.redd.it",
    "preview.redd.it",
    "external-preview.redd.it",
    "i.imgur.com",
  ];
  // What the helper accepts for a folder name and a file id.
  const SAVE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const SAVE_POST_ID_RE = /^[a-z0-9]{1,16}$/i;
  // A long video takes minutes to download; the helper has its own limits.
  const SAVE_TIMEOUT_MS = 900000;
  const SAVE_MESSAGES = {
    saved: "Saved",
    already: "Already saved",
    unsavable: "Can't save this one (not a direct image or video)",
    noPost: "Can't save this one (no post id or subreddit)",
    vault: "Mount the vault (V:) first",
    helper: "Helper not installed — run install.ps1 in civitai-collector",
    unavailable: "Saving to the gallery isn't available in this browser",
  };

  // The folder a post saves under: the subreddit as Reddit names it in a
  // post's `subreddit` field. A profile post's community, u/name, is
  // u_name there. "" when the community does not read as a valid name.
  function saveDest(slide) {
    let name = String(slide?.community || "").trim();
    if (!name) {
      const match = /\/r\/([^/]+)\/comments\//i.exec(slide?.commentsUrl || "");
      name = match ? match[1] : "";
    }
    const profile = /^(?:u|user)\/(.+)$/i.exec(name);
    name = profile ? `u_${profile[1]}` : name.replace(/^r\//i, "");
    return SAVE_NAME_RE.test(name) ? name : "";
  }

  // The post's id, base36 with no t3_, from where the slide carries it: the
  // archive's record, the post's key, or its comments address. "" if none
  // reads as one.
  function savePostId(slide) {
    const candidates = [
      slide?.archive?.id,
      (/(?:^|_)t3_([a-z0-9]+)$/i.exec(slide?.postKey || "") || [])[1],
      (/\/comments\/([a-z0-9]+)/i.exec(slide?.commentsUrl || "") || [])[1],
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && SAVE_POST_ID_RE.test(candidate)) {
        return candidate;
      }
    }
    return "";
  }

  // The direct media URL the helper should download for a slide, or "" when
  // the slide is not a picture or video on an allowed host. A picture on
  // preview.redd.it is saved from the upload it was made from, which is
  // i.redd.it's file at full size. A video on v.redd.it must be the MP4 that
  // the viewer plays, not a stream's playlist. Reddit serves a video and its
  // sound as separate files, so such a video saves without sound.
  function saveMediaUrl(slide) {
    if (!slide || (slide.kind !== "image" && slide.kind !== "video")) return "";
    // Older markup escapes & as &amp;.
    const raw = String(slide.url || "").replace(/&amp;/g, "&");
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_error) {
      return "";
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || !SAVE_HOSTS.includes(host)) return "";
    if (host === "v.redd.it" && !/\.mp4$/i.test(parsed.pathname)) return "";
    const upload = redditUpload(parsed.href);
    if (
      slide.kind === "image" &&
      upload &&
      upload.host === "preview.redd.it" &&
      /^(?:jpe?g|png|gif|webp)$/i.test(upload.extension)
    ) {
      return `https://i.redd.it/${upload.id}.${upload.extension}`;
    }
    return parsed.href;
  }

  // What the slide's page says of its post, for the fields a slide does not
  // carry: { score, createdUtc, over18 }, each null when unknown. `get` reads
  // an attribute of the post's element, or null. New Reddit's shreddit-post
  // has score, created-timestamp (an ISO date) and nsfw; old Reddit has
  // data-score, data-timestamp (milliseconds) and data-nsfw.
  function saveFactsFromAttributes(get) {
    const number = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    let createdUtc = null;
    const iso = get("created-timestamp");
    const millis = number(get("data-timestamp"));
    if (iso && Number.isFinite(Date.parse(iso))) {
      createdUtc = Math.floor(Date.parse(iso) / 1000);
    } else if (millis !== null) {
      createdUtc = Math.floor(millis / 1000);
    }
    let over18 = null;
    const nsfw = get("nsfw");
    const dataNsfw = get("data-nsfw");
    if (nsfw !== null && nsfw !== undefined) over18 = nsfw !== "false";
    else if (dataNsfw === "true") over18 = true;
    else if (dataNsfw === "false") over18 = false;
    const score = number(get("score"));
    return {
      score: score !== null ? score : number(get("data-score")),
      createdUtc,
      over18,
    };
  }

  // The helper's sync request for the media a slide shows, as
  // { ok: true, request, itemId, mediaUrl } or { ok: false, reason } with
  // reason "unsavable" (not a direct image or video on an allowed host) or
  // "no-post" (no valid post id or subreddit folder). `facts` is
  // saveFactsFromAttributes' answer, for a slide that does not carry its own.
  function buildSaveRequest(slide, facts) {
    const mediaUrl = saveMediaUrl(slide);
    if (!mediaUrl) return { ok: false, reason: "unsavable" };
    const dest = saveDest(slide);
    const postId = savePostId(slide);
    const gallery = Number(slide.galleryItem) > 0;
    const itemId = gallery
      ? `${postId}_${Math.floor(slide.galleryItem)}`
      : postId;
    if (!dest || !postId || !SAVE_NAME_RE.test(itemId)) {
      return { ok: false, reason: "no-post" };
    }
    const archive = slide.archive || {};
    const known = facts || {};
    const finite = (value) =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    const pick = (first, second) => (first !== null ? first : second);
    const permalink = /^https:\/\//i.test(slide.commentsUrl || "")
      ? slide.commentsUrl
      : `https://www.reddit.com/r/${dest}/comments/${postId}/`;
    const author = String(slide.author || "")
      .replace(/^u\//i, "")
      .trim();
    let over18 = null;
    if (typeof archive.over18 === "boolean") over18 = archive.over18;
    else if (typeof known.over18 === "boolean") over18 = known.over18;
    const path = new URL(mediaUrl).pathname;
    const isGif =
      slide.fromGif === true ||
      (slide.kind === "image" && /\.gif$/i.test(path));
    let mediaType = "image";
    if (isGif) mediaType = "gif";
    else if (slide.kind === "video") mediaType = "video";
    const galleryCount = gallery ? Math.floor(Number(slide.galleryTotal)) : 0;
    const metadata = {
      source: "reddit",
      postId,
      subreddit: dest,
      title: String(slide.title == null ? "" : slide.title),
      author: author || null,
      permalink,
      postUrl: /^https?:\/\//i.test(slide.sourceUrl || "")
        ? slide.sourceUrl
        : null,
      createdUtc: pick(finite(archive.created), finite(known.createdUtc)),
      score: pick(finite(archive.score), finite(known.score)),
      over18,
      mediaType,
      galleryIndex: gallery ? Math.floor(slide.galleryItem) : null,
      galleryCount: galleryCount > 0 ? galleryCount : null,
      fileName: path.split("/").pop() || "",
    };
    return {
      ok: true,
      itemId,
      mediaUrl,
      request: {
        op: "sync",
        dest,
        items: [{ id: itemId, url: mediaUrl, metadata }],
      },
    };
  }

  // A short reason out of a helper's message.
  function saveShortReason(value) {
    const text = String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "unknown error";
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  }

  // What one message from the helper settles about the one item sent, as
  // { status: "saved" | "already" | "failed" | "vault" | "helper" |
  // "unavailable", text }, or null for a message that settles nothing (a
  // progress for another id, or an unknown message). The relay in
  // background.js adds { type: "error", code } for a helper it cannot reach.
  function saveOutcome(message, itemId) {
    if (!message || typeof message !== "object") return null;
    const failed = (reason) => ({
      status: /vault not mounted/i.test(reason) ? "vault" : "failed",
      text: /vault not mounted/i.test(reason)
        ? SAVE_MESSAGES.vault
        : `Save failed: ${saveShortReason(reason)}`,
    });
    if (message.type === "progress") {
      if (itemId && message.id !== undefined && message.id !== itemId) {
        return null;
      }
      if (message.status === "ok") {
        return { status: "saved", text: SAVE_MESSAGES.saved };
      }
      if (message.status === "skipped") {
        return { status: "already", text: SAVE_MESSAGES.already };
      }
      if (message.status === "failed") {
        return failed(String(message.error || ""));
      }
      return null;
    }
    if (message.type === "done") {
      if (Number(message.ok) > 0) {
        return { status: "saved", text: SAVE_MESSAGES.saved };
      }
      if (Number(message.skipped) > 0) {
        return { status: "already", text: SAVE_MESSAGES.already };
      }
      return failed("the helper saved nothing");
    }
    if (message.type === "error") {
      if (
        message.code === "host_missing" ||
        message.code === "host_forbidden"
      ) {
        return { status: "helper", text: SAVE_MESSAGES.helper };
      }
      if (message.code === "unavailable") {
        return { status: "unavailable", text: SAVE_MESSAGES.unavailable };
      }
      return failed(String(message.message || message.code || ""));
    }
    return null;
  }

  // Which items are being saved or are saved, for the life of the page. begin
  // answers "go" once per item at a time, "pending" while its request is out
  // (a second press of the key sends nothing), and "saved" after a save or an
  // already-saved reply.
  function createSaveTracker() {
    const pending = new Set();
    const saved = new Set();
    return {
      begin(itemId) {
        if (saved.has(itemId)) return "saved";
        if (pending.has(itemId)) return "pending";
        pending.add(itemId);
        return "go";
      },
      end(itemId, status) {
        pending.delete(itemId);
        if (status === "saved" || status === "already") saved.add(itemId);
      },
      isSaved: (itemId) => saved.has(itemId),
      isPending: (itemId) => pending.has(itemId),
    };
  }

  // Sends the request through the extension's relay and resolves, never
  // rejecting, with the first outcome the replies settle. `runtime` is
  // chrome.runtime: content scripts cannot reach a native helper themselves,
  // so background.js holds the connection.
  function sendSaveRequest(runtime, request, itemId, timeoutMs) {
    return new Promise((resolve) => {
      let port = null;
      let settled = false;
      let timer = null;
      const closePort = () => {
        try {
          if (port) port.disconnect();
        } catch (_error) {
          // Already closed.
        }
      };
      const settle = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };
      const fail = (reason) =>
        settle({ status: "failed", text: `Save failed: ${reason}` });
      timer = setTimeout(() => {
        fail("no reply");
        closePort();
      }, timeoutMs || SAVE_TIMEOUT_MS);
      try {
        port = runtime.connect({ name: SAVE_PORT_NAME });
        port.onMessage.addListener((message) => {
          const outcome = saveOutcome(message, itemId);
          if (outcome) settle(outcome);
          if (
            message &&
            (message.type === "done" || message.type === "error")
          ) {
            closePort();
          }
        });
        port.onDisconnect.addListener(() => fail("the helper stopped"));
        port.postMessage(request);
      } catch (_error) {
        fail("the extension was reloaded");
        closePort();
      }
    });
  }
  // redditp-media-save:end

  // redditp-grid-media:start
  // What a grid tile shows where a post's card or record leaves it short,
  // and what its loop plays: a still for a player whose card has no
  // picture, from Reddit's own data for the post; the loop that a GIF
  // player's tile plays; and the small rendition of a video on v.redd.it
  // that its tile loops, from the sizes its player names or from the
  // video's manifest. Like the blocks above, this stays DOM-free, so
  // nodejs/test-embedit.js can evaluate it, together with the grid rendition
  // and media URL blocks that it reads; the manifest comes in parsed.
  const POST_FULLNAME_RE = /^t3_[a-z0-9]+$/i;
  // The short side, in pixels, of the rendition of a Reddit video that its
  // tile loops. On a computer the grid's columns are about 300 to 480 CSS
  // pixels wide (see gridColumnCount), and a tile crops its video to fill
  // it, so a clip 360 pixels across its short side fills its column in
  // either orientation: a portrait clip is then 360 wide, and a landscape
  // clip 640 wide, sharp even at two device pixels to the CSS pixel. The
  // next size up, 480, weighs about half as much again, for a silent
  // preview under a caption.
  const GRID_LOOP_SHORT_SIDE = 360;
  // The hosts that a loop may come from (see gridLoopUrl).
  const GRID_LOOP_HOST_RE = /^(?:v|i|preview|external-preview)\.redd\.it$/i;

  // A post's fullname, t3_<id>, from its card's post key, or else from the
  // id in its comments URL; "" when neither names one.
  function postFullname(postKey, commentsUrl) {
    if (typeof postKey === "string" && POST_FULLNAME_RE.test(postKey)) {
      return postKey;
    }
    const match = /\/comments\/([a-z0-9]+)(?:[/?#]|$)/i.exec(
      typeof commentsUrl === "string" ? commentsUrl : "",
    );
    return match ? `t3_${match[1]}` : "";
  }

  // A URL from Reddit's data, with &amp; decoded, or "" for anything but an
  // absolute http(s) URL.
  function dataUrl(value) {
    if (typeof value !== "string" || !value) return "";
    try {
      const url = new URL(value.replace(/&amp;/g, "&"));
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : "";
    } catch (_error) {
      return "";
    }
  }

  function dataSize(value) {
    const size = Number(value);
    return Number.isFinite(size) && size > 0 ? size : 0;
  }

  // A picture from Reddit's data as { url, width, height }, or null for one
  // that is blurred, as the copies in an NSFW post's variants.nsfw and
  // variants.obfuscated are, or that is no still (see isStillCopy).
  function dataStill(url, width, height) {
    const still = dataUrl(url);
    if (!still || /[?&]blur=/i.test(still) || !isStillCopy(still)) {
      return null;
    }
    return { url: still, width: dataSize(width), height: dataSize(height) };
  }

  // A still for the grid tile of a player whose card shows no picture, from
  // the post's data as Reddit's API gives it (a child's data in
  // /api/info.json): { url, thumb, width, height }, where url is the still,
  // thumb the copy of it about GRID_THUMB_WIDTH wide that the tile loads
  // (see gridRendition), or "", and width and height the still's size, 0
  // when unknown; or null. The still is Reddit's preview of the post, its
  // copy of the video's first frame, or else the thumbnail that the
  // player's oEmbed names. Only the preview's own source and resolutions are
  // read, never its variants, which for an NSFW post are blurred.
  function postStill(post) {
    if (!post || typeof post !== "object") return null;
    const image = Array.isArray(post.preview?.images)
      ? post.preview.images[0]
      : null;
    const copies = (Array.isArray(image?.resolutions) ? image.resolutions : [])
      .map((entry) => dataStill(entry?.url, entry?.width, entry?.height))
      .filter(Boolean);
    // Without a source of its own, the widest copy stands in for it.
    const source = image?.source;
    const still =
      dataStill(source?.url, source?.width, source?.height) ||
      copies.reduce(
        (widest, copy) =>
          !widest || copy.width > widest.width ? copy : widest,
        null,
      );
    if (still) {
      const copy = gridRendition(copies);
      return {
        url: still.url,
        thumb: copy && copy.url !== still.url ? copy.url : "",
        width: still.width,
        height: still.height,
      };
    }
    const oembed = [post.secure_media, post.media]
      .map((media) =>
        dataStill(
          media?.oembed?.thumbnail_url,
          media?.oembed?.thumbnail_width,
          media?.oembed?.thumbnail_height,
        ),
      )
      .find(Boolean);
    return oembed ? Object.assign({ thumb: "" }, oembed) : null;
  }

  // The MP4s that a Reddit player's packaged-media-json names, as { url,
  // width, height }, with 0 for a size it does not say. Reddit signs these
  // URLs, so each is taken as it is.
  function packagedMp4s(packagedJson) {
    let permutations = [];
    try {
      permutations = JSON.parse(packagedJson || "null")?.playbackMp4s
        ?.permutations;
    } catch (_error) {
      permutations = [];
    }
    const mp4s = [];
    (Array.isArray(permutations) ? permutations : []).forEach((item) => {
      const url = dataUrl(item?.source?.url);
      if (!url) return;
      mp4s.push({
        url,
        width: dataSize(item.source.dimensions?.width),
        height: dataSize(item.source.dimensions?.height),
      });
    });
    return mp4s;
  }

  // The loop that a GIF player's tile plays, from the MP4s the player names:
  // the narrowest that is wide enough, or else the widest (see
  // gridRendition). Its src is Reddit's MP4 of the uploaded GIF, whose width
  // the query says; a video posted as a GIF names its MP4s and their sizes
  // in packaged-media-json instead (see packagedMp4s). Reddit signs these
  // URLs, so each is taken as it is. "" when the player names none.
  function gifPlayerLoop(src, packagedJson) {
    const loops = [];
    const source = dataUrl(src);
    if (isRedditGifMp4(source)) {
      loops.push({
        url: source,
        width: dataSize(new URL(source).searchParams.get("width")),
      });
    }
    loops.push(...packagedMp4s(packagedJson));
    const loop = gridRendition(loops, true) || loops[0];
    return loop ? loop.url : "";
  }

  // The id of a video on v.redd.it, from any of its URLs: the video's own
  // (https://v.redd.it/<id>), or a file or playlist in its folder. "" for
  // any other URL.
  function redditVideoId(url) {
    const match = /^https:\/\/v\.redd\.it\/([a-z0-9]+)(?:[/?#]|$)/i.exec(
      typeof url === "string" ? url : "",
    );
    return match ? match[1] : "";
  }

  // The DASH manifest of a video on v.redd.it, which lists the video's
  // renditions with their sizes. Reddit serves it unsigned, to any origin.
  function dashManifestUrl(id) {
    return `https://v.redd.it/${id}/DASHPlaylist.mpd`;
  }

  // Whether a URL is a file of a video on v.redd.it that plays by itself:
  // not its manifest or playlist, and not the 96 pixel copy that Reddit's
  // player seeks with.
  function redditVideoFile(url) {
    if (!redditVideoId(url)) return false;
    const path = new URL(url).pathname;
    return (
      /^\/[a-z0-9]+\/[^/]+$/i.test(path) &&
      !/\.(?:mpd|m3u8)$/i.test(path) &&
      !/_96(?:\.mp4)?$/i.test(path)
    );
  }

  // The loop of a tile whose video is on v.redd.it, from the URLs that its
  // player or post names: the first of them that is a file of the video
  // (see redditVideoFile), which the tile trades for the smaller rendition
  // that the video's manifest names, and falls back to; or else the
  // manifest itself, with nothing to fall back to. "" when none of them is
  // on v.redd.it.
  function redditPlayerLoop(urls) {
    let id = "";
    let file = "";
    (Array.isArray(urls) ? urls : []).forEach((value) => {
      const url = dataUrl(value);
      const urlId = redditVideoId(url);
      if (!urlId || (id && urlId !== id)) return;
      id = urlId;
      if (!file && redditVideoFile(url)) file = url;
    });
    if (!id) return "";
    return file || dashManifestUrl(id);
  }

  // The renditions of a video with a picture that a DASH manifest lists, as
  // { url, width, height, bandwidth }; never its audio. Each URL comes from
  // the manifest's own BaseURL, since Reddit has named them differently over
  // the years (CMAF_360.mp4, DASH_360.mp4, DASH_360, DASH_1_2_M), not always
  // after their size, and refuses a name that is guessed. A rendition
  // outside the video's own folder on v.redd.it is passed over. `doc` is the
  // manifest at manifestUrl, parsed as XML.
  function dashVideoRenditions(doc, manifestUrl) {
    const id = redditVideoId(manifestUrl);
    if (!id || !doc || typeof doc.getElementsByTagName !== "function") {
      return [];
    }
    const folder = `https://v.redd.it/${id}/`;
    const attribute = (node, name) =>
      node && typeof node.getAttribute === "function"
        ? node.getAttribute(name) || ""
        : "";
    const renditions = [];
    Array.prototype.forEach.call(
      doc.getElementsByTagName("Representation"),
      (representation) => {
        // Older manifests say what a rendition is on the rendition, newer
        // ones on its adaptation set.
        const set = representation.parentNode;
        const types = [representation, set]
          .map(
            (node) =>
              `${attribute(node, "mimeType")} ${attribute(node, "contentType")}`,
          )
          .join(" ");
        if (/audio/i.test(types)) return;
        const width = dataSize(attribute(representation, "width"));
        const height = dataSize(attribute(representation, "height"));
        const base = representation.getElementsByTagName("BaseURL")[0];
        const name = base ? (base.textContent || "").trim() : "";
        if (!width || !height || !name) return;
        let url = "";
        try {
          url = new URL(name, manifestUrl).href;
        } catch (_error) {
          return;
        }
        if (!url.startsWith(folder)) return;
        renditions.push({
          url,
          width,
          height,
          bandwidth: dataSize(attribute(representation, "bandwidth")),
        });
      },
    );
    return renditions;
  }

  // The rendition of a video that its tile loops, from a list of { url,
  // width, height, bandwidth }: the smallest that is at least
  // GRID_LOOP_SHORT_SIDE pixels across its short side, or else, for a
  // smaller video, the largest. Of two the same size, the lighter is
  // smaller. Renditions without a URL or a size are passed over; null when
  // none is left.
  function videoLoopRendition(renditions) {
    const shortSide = (item) => Math.min(item.width, item.height);
    const compare = (a, b) =>
      shortSide(a) - shortSide(b) || a.bandwidth - b.bandwidth;
    let smallest = null;
    let largest = null;
    (Array.isArray(renditions) ? renditions : []).forEach((rendition) => {
      if (!rendition || typeof rendition.url !== "string" || !rendition.url) {
        return;
      }
      const item = {
        url: rendition.url,
        width: dataSize(rendition.width),
        height: dataSize(rendition.height),
        bandwidth: dataSize(rendition.bandwidth),
      };
      if (!item.width || !item.height) return;
      if (!largest || compare(item, largest) > 0) largest = item;
      if (
        shortSide(item) >= GRID_LOOP_SHORT_SIDE &&
        (!smallest || compare(item, smallest) < 0)
      ) {
        smallest = item;
      }
    });
    return smallest || largest;
  }

  // The loop of a Reddit video player's tile from the MP4s that its
  // packaged-media-json names with their sizes (see videoLoopRendition), so
  // that the tile needs no manifest; "" when it names none with a size.
  function packagedVideoLoop(packagedJson) {
    const loop = videoLoopRendition(packagedMp4s(packagedJson));
    return loop ? loop.url : "";
  }

  // The loop of a post's tile from its data as Reddit's API gives it: the
  // file on v.redd.it of Reddit's own copy of the clip that the post links
  // to on a host such as RedGIFs (preview.reddit_video_preview), or else of
  // the post's own video. Its tile trades it for a smaller rendition (see
  // redditPlayerLoop). "" when the post has neither.
  function postLoop(post) {
    if (!post || typeof post !== "object") return "";
    return (
      [
        post.preview?.reddit_video_preview,
        post.secure_media?.reddit_video,
        post.media?.reddit_video,
      ]
        .map((video) => dataUrl(video?.fallback_url))
        .find(redditVideoFile) || ""
    );
  }

  // A loop that another source names, where it may play: an https URL on
  // one of Reddit's media hosts, so that no source can have the grid load a
  // video from anywhere else. "" for any other.
  function gridLoopUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      return "";
    }
    return parsed.protocol === "https:" &&
      GRID_LOOP_HOST_RE.test(parsed.hostname)
      ? parsed.href
      : "";
  }
  // redditp-grid-media:end

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
    // fromGif marks a video that a host converted from a GIF. picture, where
    // the card says, is what the grid needs of the picture (see
    // cardPicture): thumb, the smaller copy a tile loads, its size, and a
    // loop. A video that is Reddit's MP4 of a GIF is its own loop, and a
    // video on v.redd.it loops a smaller rendition of itself (see
    // redditPlayerLoop).
    function add(kind, url, poster, postMedia, fromGif, picture) {
      const normalized = absoluteUrl(url);
      const key = canonicalMediaKey(normalized);
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      const thumb = absoluteUrl(picture?.thumb);
      const gifMp4 = kind === "video" && isRedditGifMp4(normalized);
      media.push({
        kind,
        url: normalized,
        poster: absoluteUrl(poster),
        postMedia: Boolean(postMedia),
        fromGif: Boolean(fromGif) || gifMp4,
        thumb: thumb === normalized ? "" : thumb,
        thumbVideo:
          absoluteUrl(picture?.thumbVideo) ||
          (gifMp4 ? normalized : "") ||
          (kind === "video" ? redditPlayerLoop([normalized]) : ""),
        width: picture?.width || 0,
        height: picture?.height || 0,
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
        thumbVideo: redditPlayerLoop([sourceUrl]),
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
        if (image && usefulImage(image)) {
          const url = imageUrl(image);
          // A full-size transcode is slow to start, so the slide loads the
          // upload itself where that is safe (see redditOriginalUrl).
          add(
            "image",
            redditOriginalUrl(url) || url,
            "",
            true,
            false,
            cardPicture(node, image, url),
          );
        }
      });
      if (media.length) return media;
    }

    node.querySelectorAll("shreddit-player").forEach((player) => {
      const preview = player.getAttribute("preview") || "";
      const isSeekPreview = /\/CMAF_96\.mp4(?:$|[?#])/i.test(preview);
      const packagedUrl = packagedVideoUrl(player);
      // What says where the player's video is on v.redd.it, whose tile then
      // loops a small rendition of it (see redditPlayerLoop).
      const videoUrls = [player.getAttribute("src"), preview, sourceUrl];
      if (!packagedUrl && isSeekPreview && player.ownerDocument === document) {
        media.push({
          kind: "pending-native-video",
          url: absoluteUrl(player.getAttribute("src")) || sourceUrl,
          poster: absoluteUrl(player.getAttribute("poster")),
          playerElement: player,
          thumbVideo: redditPlayerLoop(videoUrls),
        });
        return;
      }
      const playablePreview = isSeekPreview ? "" : preview;
      const playerUrl =
        packagedUrl ||
        absoluteUrl(playablePreview) ||
        absoluteUrl(player.getAttribute("src")) ||
        firstHref(player, ["source"]);
      // Reddit marks the player of a GIF, whether uploaded as one or posted
      // as a video; its tile loops the smallest adequate MP4 it names (see
      // gifPlayerLoop), while the slideshow plays the largest. Any other
      // player's tile loops the rendition that suits a tile among the MP4s
      // it names with their sizes, or else among those that its video's
      // manifest names.
      const gifLoop = player.hasAttribute("gif")
        ? gifPlayerLoop(
            absoluteUrl(player.getAttribute("src")),
            player.getAttribute("packaged-media-json"),
          )
        : "";
      const loop =
        gifLoop ||
        packagedVideoLoop(player.getAttribute("packaged-media-json")) ||
        redditPlayerLoop([playerUrl, ...videoUrls]);
      add(
        "video",
        playerUrl,
        player.getAttribute("poster"),
        false,
        Boolean(gifLoop),
        loop ? { thumbVideo: loop } : null,
      );
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
      // preview of the same image found inside the listing card. That
      // preview still gives the grid its smaller copy.
      add("image", sourceUrl, "", true, false, uploadPicture(node, sourceUrl));
    } else {
      node.querySelectorAll(CARD_IMAGE_SELECTOR).forEach((image) => {
        if (!usefulImage(image)) return;
        const url = imageUrl(image);
        add("image", url, "", false, false, cardPicture(node, image, url));
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
    lendCardStill(media);
    return media;
  }

  // The grid never loads a player frame, so a frame's tile shows a still of
  // it: the card's own preview picture of the post, where the card has one,
  // or else the still that the frame's host keeps (see embedStill). A video
  // without a poster borrows the card's picture too, as its tile's still
  // alone, so that the slideshow's player stays as it was. No slide is
  // added or taken away. A tile left without a picture asks Reddit's data
  // for one later (see wantsGridStill).
  function lendCardStill(media) {
    const card = media.find((item) => item.kind === "image" && !item.postMedia);
    media.forEach((item) => {
      if (item.kind === "embed") {
        item.poster = card ? card.url : embedStill(item.url);
        item.thumb = card ? card.thumb : "";
        item.width = card ? card.width : 0;
        item.height = card ? card.height : 0;
      } else if (item.kind === "video" && !item.poster && !item.thumb && card) {
        item.thumb = card.thumb || card.url;
        item.width = card.width;
        item.height = card.height;
      }
    });
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
      // A Reddit video whose player said nothing of the video when it was
      // read, as before Reddit fills it in, still loops in its tile: the
      // post's own link (content-href, or data-url on old Reddit) names the
      // video on v.redd.it, whose manifest says what to loop (see
      // redditPlayerLoop).
      if (media.length === 1 && !media[0].thumbVideo) {
        media[0].thumbVideo = redditPlayerLoop([source]);
      }
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
  // says whether the Show filter and the Hidden list would show a slide, so
  // a source can size its batches. A player frame's poster is a still of it, which its grid
  // tile shows, since the grid loads no frame. A slide may name thumb, a
  // smaller copy of its picture (a video's or a frame's poster) that its
  // grid tile loads instead; width and height, the picture's size, which
  // shapes its tile before the picture arrives; and thumbVideo, a silent
  // MP4 on one of Reddit's media hosts that the tile loops over the still:
  // a small MP4 of a GIF, or a file of a video on v.redd.it, whether the
  // post's own or Reddit's copy of a clip elsewhere, which the tile trades
  // for a smaller rendition (see gridLoopSource).
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
        thumb: "",
        thumbVideo: "",
        width: 0,
        height: 0,
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
    [
      "url",
      "poster",
      "thumb",
      "thumbVideo",
      "sourceUrl",
      "commentsUrl",
    ].forEach((key) => {
      result[key] = absoluteHttpUrl(result[key]);
    });
    // A tile loops only a video from Reddit's own media hosts.
    result.thumbVideo = gridLoopUrl(result.thumbVideo);
    ["width", "height"].forEach((key) => {
      const size = Number(result[key]);
      result[key] = Number.isFinite(size) && size > 0 ? size : 0;
    });
    result.media = mediaCategory(result.kind, result.url, result.fromGif);
    return result;
  }

  // Whether the Show filter and the Hidden list would show one of a source's
  // slides.
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
      // The thumbnail's own smaller copy and size say nothing about the
      // post's media.
      const replacements = detailMedia.map((item, index) =>
        Object.assign(
          {},
          slide,
          { thumb: "", thumbVideo: "", width: 0, height: 0 },
          item,
          {
            sourceUrl: detailSource || slide.sourceUrl,
            galleryItem: isGallery ? index + 1 : 0,
            galleryTotal: isGallery ? detailMedia.length : 0,
            needsEnrichment: false,
            mediaUnknown: false,
            media: mediaCategory(item.kind, item.url, item.fromGif),
          },
        ),
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
    const result = Object.assign({}, DEFAULT_SETTINGS, { hidden: [] });
    if (!value || typeof value !== "object") return result;
    result.hidden = normalizedHiddenList(value.hidden);
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

  // The first open reads every setting. Later opens read the Hidden list
  // again, which another tab or the archive page may have changed since;
  // the other settings stay as this page has them.
  function loadSettings() {
    return new Promise((resolve) => {
      function finish(value) {
        if (!state.settingsLoaded) {
          state.settings = normalizedSettings(value);
          state.settingsLoaded = true;
        } else if (value && typeof value === "object") {
          state.settings.hidden = normalizedHiddenList(value.hidden);
        }
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
  // Saves the media shown, or the grid tile last pointed at or focused, to
  // the local gallery through the native helper (S).
  const saveButton = element(
    "button",
    "redditp__button redditp__save redditp__control-item",
    "save",
  );
  saveButton.title = "Save to the gallery (S)";
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
    saveButton.type =
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
    saveButton,
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

  // The Hidden list: its entries, each with a button that takes it off, and
  // a field that adds one. Enter in the field adds too.
  const hiddenGroup = element("section", "redditp__hidden", "");
  hiddenGroup.setAttribute("aria-labelledby", "redditp-hidden-title");
  const hiddenTitle = element("h3", "", "Hidden");
  hiddenTitle.id = "redditp-hidden-title";
  const hiddenList = element("ul", "redditp__hidden-list", "");
  hiddenList.setAttribute("aria-labelledby", "redditp-hidden-title");
  const hiddenEmpty = element(
    "p",
    "redditp__hidden-empty",
    "Nothing hidden. Press X on a post to hide its author.",
  );
  const hiddenAdd = element("div", "redditp__hidden-add", "");
  const hiddenInput = element("input", "", "");
  hiddenInput.type = "text";
  hiddenInput.id = "redditp-hidden-input";
  hiddenInput.placeholder = "u/name, r/name or site.com";
  hiddenInput.autocomplete = "off";
  hiddenInput.setAttribute("autocapitalize", "off");
  hiddenInput.spellcheck = false;
  hiddenInput.maxLength = HIDDEN_MAX_INPUT;
  hiddenInput.setAttribute("aria-label", "User, subreddit or site to hide");
  hiddenInput.setAttribute("aria-describedby", "redditp-hidden-message");
  const hiddenAddButton = element(
    "button",
    "redditp__hidden-add-button",
    "Add",
  );
  hiddenAddButton.type = "button";
  hiddenAdd.append(hiddenInput, hiddenAddButton);
  const hiddenMessage = element("p", "redditp__hidden-message", "");
  hiddenMessage.id = "redditp-hidden-message";
  // An alert that stays in the page, empty until there is something to say.
  hiddenMessage.setAttribute("role", "alert");
  hiddenGroup.append(
    hiddenTitle,
    element(
      "p",
      "",
      "Posts by these users, in these subreddits, or from these sites stay out of the slideshow and the grid. A site covers its subdomains too.",
    ),
    hiddenList,
    hiddenEmpty,
    hiddenAdd,
    hiddenMessage,
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
    [
      ["X"],
      "Hide the post's author (in the grid: the tile under the pointer, or else the focused tile)",
    ],
    [["Z"], "Undo hiding, while its message shows"],
    [["H"], "Browse this subreddit's archive (new tab)"],
    [
      ["S"],
      "Save the media to the gallery (in the grid: the tile under the pointer, or else the focused tile)",
    ],
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
    hiddenGroup,
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

  // A short message at the foot of the screen, such as "Hid u/name" with
  // its Undo button. The region stays in the page, empty, so that a screen
  // reader hears each message as it arrives.
  const toast = element("div", "redditp__toast", "");
  toast.setAttribute("role", "status");
  const toastText = element("span", "redditp__toast-text", "");
  const toastUndo = element(
    "button",
    "redditp__button redditp__toast-undo",
    "Undo",
  );
  toastUndo.type = "button";
  toastUndo.title = "Show these posts again (Z)";
  toastUndo.hidden = true;
  toast.append(toastText, toastUndo);

  root.append(
    stage,
    grid,
    prevButton,
    nextButton,
    details,
    controls,
    closeButton,
    toast,
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
  // player with controls or sound, loads a third-party frame, or touches
  // Reddit's own video element; a video tile shows the post's poster when it
  // has one, a player frame's tile its still (see lendCardStill), a
  // player's tile without either the still from Reddit's data for the post
  // (see applyGridStill), and the tile of a GIF, or of a video that Reddit
  // keeps on v.redd.it, may loop a small silent MP4 of it over its still
  // (see addGridLoop).
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

  // A tile shows thumb, a smaller copy of its picture, where the slide has
  // one, and otherwise the picture itself, original. Whether a picture
  // failed is only ever judged on the original: a copy that fails to load,
  // or that turns out to be a host's placeholder, makes way for the
  // original, once, and the original decides. ownMedia marks the slide's own
  // picture, which takes the slide with it when it fails; a video's poster
  // or a player's still that fails, or turns out to be a placeholder, makes
  // way for a card instead. A tile that has left the grid since drops
  // nothing. Returns the image and the function that starts its loading,
  // which the grid calls as the tile comes within range (see
  // GRID_PICTURE_MARGIN).
  function gridTileImage(
    tile,
    thumb,
    original,
    fallbackLabel,
    slide,
    ownMedia,
  ) {
    const image = element("img", "redditp__tile-image", "");
    image.alt = "";
    image.setAttribute("decoding", "async");
    let url = thumb || original;
    const dropsSlide = () =>
      ownMedia && dropsWhenDead(slide) && state.gridTiles.get(slide) === tile;
    function useOriginal() {
      if (!original || url === original) return false;
      url = original;
      image.src = url;
      return true;
    }
    function settle() {
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    }
    // The picture failed for good: the slide goes, or the tile keeps a card.
    function fail() {
      settle();
      if (dropsSlide()) {
        dropDeadSlide(slide);
        return;
      }
      tile.querySelector(".redditp__tile-caption")?.remove();
      image.replaceWith(gridTileCard(fallbackLabel, slide));
      setGridTileHeight(tile, 0.75);
    }
    function onLoad() {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (isPlaceholderImage(url, width, height)) {
        if (!useOriginal()) fail();
        return;
      }
      settle();
      image.classList.add("redditp__tile-image--loaded");
      setGridTileHeight(tile, tileHeightRatio(width, height));
    }
    function onError() {
      if (!useOriginal()) fail();
    }
    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    return {
      image,
      load() {
        image.src = url;
      },
    };
  }

  // What a tile shows of its slide. An image's picture is its file, a
  // video's is its poster, and a player frame's is its still; any of them
  // may have a smaller copy for the tile (see gridTileImage). Returns the
  // original, that copy or "", the URL the tile loads first or "" for none,
  // and the label of the card that stands in for a missing picture.
  function gridTilePicture(slide) {
    let original = "";
    let hasPicture = false;
    let cardLabel = slide.body ? "Text post" : "Link";
    if (slide.kind === "image") {
      original = slide.url;
      hasPicture = true;
      cardLabel = "Image unavailable";
    } else if (slide.kind === "embed") {
      original = slide.poster;
      hasPicture = true;
      cardLabel = "Embedded video";
    } else if (isGridVideo(slide)) {
      original = slide.poster;
      hasPicture = true;
      cardLabel = "Video";
    }
    const thumb =
      hasPicture && slide.thumb && slide.thumb !== original ? slide.thumb : "";
    return { original, thumb, url: thumb || original, cardLabel };
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

    const picture = gridTilePicture(slide);
    // A picture of known size gets its shape before it arrives; the picture
    // corrects it once it has loaded.
    const height = picture.url
      ? tileHeightRatio(slide.width, slide.height)
      : 0.75;
    let loadPicture = null;
    if (picture.url) {
      const tileImage = gridTileImage(
        tile,
        picture.thumb,
        picture.original,
        picture.cardLabel,
        slide,
        slide.kind === "image",
      );
      loadPicture = tileImage.load;
      // Without IntersectionObserver the browser's own lazy loading decides
      // when the picture loads.
      if (!gridPictureObserver) {
        tileImage.image.setAttribute("loading", "lazy");
        loadPicture();
        loadPicture = null;
      }
      tile.append(
        tileImage.image,
        element("span", "redditp__tile-caption", slide.title),
      );
    } else {
      tile.append(gridTileCard(picture.cardLabel, slide));
    }
    if (slide.galleryItem) {
      tile.append(
        element(
          "span",
          "redditp__tile-badge",
          `${slide.galleryItem}/${slide.galleryTotal}`,
        ),
      );
    }
    const info = {
      slide,
      height,
      loadPicture,
      // Without IntersectionObserver the grid shows stills only.
      loop: gridLoopObserver ? slide.thumbVideo || "" : "",
      loopSrc: "",
      inRange: false,
      visible: false,
      video: null,
      buffer: "",
      loopFailed: false,
      loopState: "",
    };
    gridTileInfo.set(tile, info);
    setGridLoopState(tile, restingGridLoopState(info));
    tile.style.aspectRatio = String(1 / height);
    return tile;
  }

  // Says on a tile, in its data-loop attribute, what its loop is doing, so
  // that why a tile does or does not move can be read in the browser's
  // developer tools (see the README): "none", "no-copy", "asking",
  // "no-data", "info-failed", "info-capped", "off", "failed", "refused" or
  // "idle" (see restingGridLoopState), "resolving" while its video's
  // manifest is read, and "waiting", "buffering", "ready", "starting",
  // "playing" or "capped" (see syncGridLoops). The attribute changes only
  // with the state.
  function setGridLoopState(tile, loopState) {
    const info = gridTileInfo.get(tile);
    if (!info || info.loopState === loopState) return;
    info.loopState = loopState;
    tile.setAttribute("data-loop", loopState);
  }

  // What a tile's loop is doing while the tile has no video element. A tile
  // without a loop says "none" for a picture, link or text post; for a GIF
  // or video, "no-copy" when its card names no loop and the grid does not
  // ask Reddit's data for one, as for a YouTube post or another source's;
  // "asking" while it does, or will once the tile is within reach;
  // "no-data" when the data named none; "info-failed" when the request
  // failed; and "info-capped" once the grid has stopped asking (see
  // pumpGridStills). A tile with a loop says "off" when loops are turned
  // off, by reduced motion or Data Saver, or cannot play without
  // IntersectionObserver; "failed" when the loop failed for good; and
  // "idle" while the tile is out of the loop's range.
  function restingGridLoopState(info) {
    const slide = info.slide;
    if (!info.loop) {
      if (slide.thumbVideo && !gridLoopObserver) return "off";
      if (!isGridVideo(slide) && slide.media !== "gif") return "none";
      const outcome = gridStillOutcomes.get(slide);
      if (outcome && outcome !== "loop") return outcome;
      if (!wantsGridStill(slide)) return "no-copy";
      return state.gridStillFailures >= GRID_STILL_MAX_FAILURES
        ? "info-capped"
        : "asking";
    }
    if (info.loopFailed) return "failed";
    return gridLoopsAllowed() ? "idle" : "off";
  }

  // Starts loading a tile's picture, once.
  function startGridPicture(tile) {
    const info = gridTileInfo.get(tile);
    if (!info?.loadPicture) return;
    const load = info.loadPicture;
    info.loadPicture = null;
    load();
  }

  // A player's tile that shows only its card takes the still that its slide
  // has gained since (see applyGridStill), in the card's place, and loads it
  // as any tile's picture loads. The tile keeps its place in its column,
  // whose height stays in step (see setGridTileHeight). A still that fails
  // brings the card back, and the slide stays.
  function showGridStill(slide) {
    const tile = state.gridTiles.get(slide);
    const info = tile && gridTileInfo.get(tile);
    const card = tile?.querySelector(".redditp__tile-card");
    const picture = gridTilePicture(slide);
    if (!info || info.slide !== slide || !card || !picture.url) return;
    const tileImage = gridTileImage(
      tile,
      picture.thumb,
      picture.original,
      picture.cardLabel,
      slide,
      false,
    );
    card.replaceWith(tileImage.image);
    // Over the loop, if the tile has one, as in a new tile.
    (info.video || tileImage.image).after(
      element("span", "redditp__tile-caption", slide.title),
    );
    if (slide.width && slide.height) {
      setGridTileHeight(tile, tileHeightRatio(slide.width, slide.height));
    }
    if (gridPictureObserver) {
      info.loadPicture = tileImage.load;
      // Observed afresh, so that a tile already in range is reported now.
      gridPictureObserver.unobserve(tile);
      gridPictureObserver.observe(tile);
    } else {
      tileImage.image.setAttribute("loading", "lazy");
      tileImage.load();
    }
  }

  // Whether the grid is on screen.
  function gridShowing() {
    return state.open && state.view === "grid" && state.gridBuilt;
  }

  // A tile loops a small silent MP4 of its GIF or video (see
  // gridLoopSource) over its still while the tile is in view, unless the
  // viewer asks for reduced motion or for less data (Data Saver).
  function gridLoopsAllowed() {
    if (reducedMotion && reducedMotion.matches) return false;
    const connection = navigator.connection;
    return !(connection && connection.saveData);
  }

  // What a tile plays of the loop that its slide names (the slide's
  // thumbVideo). A video on v.redd.it plays the rendition that its manifest
  // names (see videoLoopRendition), or, where the manifest could not be
  // read, the loop itself (see gridLoopFallback); any other loop plays as it
  // is. null while the manifest waits to be read, and "" when there is
  // nothing to play.
  function gridLoopSource(loop) {
    const id = redditVideoId(loop);
    if (!id) return loop;
    if (!videoLoopSources.has(id)) return null;
    return videoLoopSources.get(id) || gridLoopFallback(loop);
  }

  // What a tile plays when the rendition it chose fails: the loop that its
  // slide names, unless that is a video's manifest or playlist, which a
  // video element cannot play.
  function gridLoopFallback(loop) {
    return !redditVideoId(loop) || redditVideoFile(loop) ? loop : "";
  }

  // Puts a loop in a tile within the loop's range (see GRID_LOOP_MARGIN). A
  // Reddit video's tile first waits for the video's manifest (see
  // waitForManifest). The loop shows over the still once it has a picture
  // of its own, which is as a rule while its tile is still ahead of the
  // view, so that the tile arrives looking as it will play; until then, and
  // if it never does, the still shows. A loop that fails leaves for good,
  // and only the loop: whether the slide failed is judged on its own media
  // alone.
  function addGridLoop(tile) {
    const info = gridTileInfo.get(tile);
    if (
      !info?.loop ||
      info.video ||
      info.loopFailed ||
      !info.inRange ||
      state.gridTiles.get(info.slide) !== tile
    ) {
      return;
    }
    if (!gridLoopsAllowed()) {
      setGridLoopState(tile, "off");
      return;
    }
    if (!info.loopSrc) {
      const source = gridLoopSource(info.loop);
      if (source === null) {
        setGridLoopState(tile, "resolving");
        waitForManifest(tile, redditVideoId(info.loop));
        return;
      }
      if (!source) {
        info.loopFailed = true;
        setGridLoopState(tile, "failed");
        return;
      }
      info.loopSrc = source;
    }
    const video = element("video", "redditp__tile-video", "");
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute("muted", "");
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    // Nothing at all, until it gets to play or to read itself in ahead of
    // the view (see syncGridLoops), so that the loops in view that start
    // meanwhile have the network to themselves.
    video.preload = "none";
    video.setAttribute("aria-hidden", "true");
    const show = () => {
      if (info.video === video) {
        video.classList.add("redditp__tile-video--shown");
      }
    };
    video.addEventListener("loadeddata", show);
    video.addEventListener("playing", show);
    // What a loop can do and holds decides what the grid's loops do next
    // (see gridLoopPlan).
    ["canplay", "playing", "waiting", "suspend"].forEach((type) => {
      video.addEventListener(type, () => {
        if (info.video === video) scheduleGridLoopSync();
      });
    });
    video.addEventListener("error", () => {
      if (info.video !== video) return;
      removeGridLoop(tile);
      // A rendition that fails makes way for the loop that the slide names,
      // once.
      const fallback = gridLoopFallback(info.loop);
      if (fallback && fallback !== info.loopSrc) {
        info.loopSrc = fallback;
        addGridLoop(tile);
      } else {
        info.loopFailed = true;
        setGridLoopState(tile, "failed");
      }
      syncGridLoops();
    });
    video.src = info.loopSrc;
    // Over the still, and under the caption and the gallery badge.
    const picture = tile.querySelector(
      ".redditp__tile-image, .redditp__tile-card",
    );
    if (picture) picture.after(video);
    else tile.prepend(video);
    info.video = video;
    info.buffer = "";
    gridLoopTiles.add(tile);
    setGridLoopState(tile, "waiting");
  }

  // Takes a tile's loop out, and lets the browser release its decoder. A
  // tile that waits for its video's manifest waits no more.
  function removeGridLoop(tile) {
    stopWaitingForManifest(tile);
    gridLoopTiles.delete(tile);
    const info = gridTileInfo.get(tile);
    if (!info) return;
    const video = info.video;
    info.video = null;
    info.buffer = "";
    setGridLoopState(tile, restingGridLoopState(info));
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  }

  // A Reddit video's tile waits for the video's manifest, which is read
  // once per video (see videoLoopSources), GRID_MANIFEST_CONCURRENCY at a
  // time; then its loop comes, if it is still within range.
  function waitForManifest(tile, id) {
    let waiting = manifestWaiters.get(id);
    if (!waiting) {
      waiting = new Set();
      manifestWaiters.set(id, waiting);
    }
    if (!manifestsReading.has(id) && !manifestQueue.includes(id)) {
      manifestQueue.push(id);
    }
    waiting.add(tile);
    pumpManifests();
  }

  // A Reddit video's tile asks for the video's manifest as soon as the tile
  // comes within the picture's range, behind the tiles that wait for theirs
  // (see pumpManifests), so that its loop knows what to play before it
  // comes. The manifest stays asked for when the tile scrolls away, since it
  // weighs little and is kept (see videoLoopSources).
  function prefetchGridManifest(tile) {
    const info = gridTileInfo.get(tile);
    const id = info?.loop ? redditVideoId(info.loop) : "";
    if (
      !id ||
      videoLoopSources.has(id) ||
      manifestsReading.has(id) ||
      manifestsAhead.has(id) ||
      !gridLoopsAllowed()
    ) {
      return;
    }
    manifestsAhead.add(id);
    if (!manifestQueue.includes(id)) manifestQueue.push(id);
    pumpManifests();
  }

  // A manifest that no tile waits for any more leaves the queue, unless a
  // tile asked for it ahead, though one being read is read to the end.
  function stopWaitingForManifest(tile) {
    const id = redditVideoId(gridTileInfo.get(tile)?.loop);
    const waiting = id ? manifestWaiters.get(id) : null;
    if (!waiting) return;
    waiting.delete(tile);
    if (waiting.size) return;
    manifestWaiters.delete(id);
    const queued = manifestQueue.indexOf(id);
    if (queued >= 0 && !manifestsAhead.has(id)) manifestQueue.splice(queued, 1);
  }

  // How soon a queued manifest is read: 0 while a tile in view waits for
  // it, 1 while a tile within the loop's range does, and 2 while only tiles
  // further ahead asked for it.
  function manifestRank(id) {
    const waiting = manifestWaiters.get(id);
    if (!waiting || !waiting.size) return 2;
    let rank = 1;
    waiting.forEach((tile) => {
      if (gridTileInfo.get(tile)?.visible) rank = 0;
    });
    return rank;
  }

  // Reads the queued manifests, GRID_MANIFEST_CONCURRENCY at a time, the
  // soonest first (see manifestRank), and those equally soon in the order
  // they were asked for. A fast scroll thus never leaves a tile in view
  // waiting behind tiles that it passed or has yet to reach.
  function pumpManifests() {
    while (
      manifestsReading.size < GRID_MANIFEST_CONCURRENCY &&
      manifestQueue.length
    ) {
      let next = 0;
      let nextRank = manifestRank(manifestQueue[0]);
      for (
        let index = 1;
        nextRank > 0 && index < manifestQueue.length;
        index += 1
      ) {
        const rank = manifestRank(manifestQueue[index]);
        if (rank < nextRank) {
          next = index;
          nextRank = rank;
        }
      }
      const id = manifestQueue.splice(next, 1)[0];
      manifestsAhead.delete(id);
      manifestsReading.add(id);
      readVideoManifest(id)
        .then((source) => {
          rememberBounded(
            videoLoopSources,
            id,
            source,
            GRID_MANIFEST_CACHE_SIZE,
          );
          const waiting = manifestWaiters.get(id);
          manifestWaiters.delete(id);
          if (waiting) waiting.forEach((tile) => addGridLoop(tile));
          syncGridLoops();
        })
        .finally(() => {
          manifestsReading.delete(id);
          pumpManifests();
        });
    }
  }

  // Reads a Reddit video's manifest, without the viewer's cookies, and
  // resolves to the rendition that its tiles loop (see videoLoopRendition),
  // or to "" when the browser cannot fetch or parse it, or it names none.
  function readVideoManifest(id) {
    if (typeof fetch !== "function" || typeof DOMParser !== "function") {
      return Promise.resolve("");
    }
    const url = dashManifestUrl(id);
    return fetch(url, { credentials: "omit" })
      .then((response) => {
        if (!response.ok)
          throw new Error(`v.redd.it returned ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const manifest = new DOMParser().parseFromString(
          text,
          "application/xml",
        );
        const rendition = videoLoopRendition(
          dashVideoRenditions(manifest, url),
        );
        return rendition ? rendition.url : "";
      })
      .catch(() => "");
  }

  // Plays the loops of the tiles in view, reads in those ahead of the view,
  // paused, and pauses the rest, as gridLoopPlan says from where each tile
  // is. A hidden grid plays none and reads no more in. A loop reads
  // anything only once it gets to play or to read ahead.
  function syncGridLoops() {
    const tiles = Array.from(gridLoopTiles).filter(
      (tile) => gridTileInfo.get(tile)?.video,
    );
    if (!gridShowing()) {
      tiles.forEach((tile) => {
        const video = gridTileInfo.get(tile).video;
        if (!video.paused) video.pause();
      });
      return;
    }
    let view = null;
    const loops = tiles.map((tile) => {
      const info = gridTileInfo.get(tile);
      // A loop that reads itself in is done once it holds enough, or once
      // the browser, having read as much as it will, stops reading it.
      if (
        info.buffer === "reading" &&
        (gridLoopHolds(info.video) ||
          info.video.networkState === info.video.NETWORK_IDLE)
      ) {
        info.buffer = "read";
      }
      const loop = {
        visible: info.visible,
        top: 0,
        distance: 0,
        ready: info.video.readyState >= info.video.HAVE_FUTURE_DATA,
        buffer: info.buffer,
      };
      // Only a loop in view, or one that may start reading in, needs to know
      // where it is.
      if (info.visible || !info.buffer) {
        view = view || grid.getBoundingClientRect();
        const box = tile.getBoundingClientRect();
        loop.top = box.top;
        loop.distance = Math.max(box.top - view.bottom, view.top - box.bottom);
      }
      return loop;
    });
    // A loop that already held itself when asked to read in frees its place
    // at once, since no more of its media events may come.
    let freed = false;
    gridLoopPlan(loops).forEach((action, index) => {
      const tile = tiles[index];
      const info = gridTileInfo.get(tile);
      const video = info.video;
      if (action === "play" || action === "buffer") {
        if (!info.buffer) {
          info.buffer = gridLoopHolds(video) ? "read" : "reading";
          freed = freed || info.buffer === "read";
        }
        if (video.preload !== "auto") video.preload = "auto";
      }
      if (action === "play") {
        if (video.paused) playGridLoop(tile, video);
      } else if (!video.paused) {
        video.pause();
      }
      let loopState = "waiting";
      if (action === "play") {
        loopState =
          !video.paused && video.readyState >= video.HAVE_FUTURE_DATA
            ? "playing"
            : "starting";
      } else if (action === "buffer") {
        loopState = info.buffer === "read" ? "ready" : "buffering";
      } else if (action === "cap") {
        loopState = "capped";
      }
      setGridLoopState(tile, loopState);
    });
    if (freed) scheduleGridLoopSync();
  }

  // Whether a loop's video has read itself in (see gridLoopReadIn).
  function gridLoopHolds(video) {
    const spans = [];
    const ranges = video.buffered;
    for (let index = 0; index < ranges.length; index += 1) {
      spans.push([ranges.start(index), ranges.end(index)]);
    }
    return gridLoopReadIn(spans, video.currentTime, video.duration);
  }

  // Syncs the grid's loops at the next animation frame, once for however
  // many of their media events come before it.
  function scheduleGridLoopSync() {
    if (gridLoopSyncFrame) return;
    gridLoopSyncFrame = requestAnimationFrame(() => {
      gridLoopSyncFrame = 0;
      syncGridLoops();
    });
  }

  // The browser may refuse to play, as in iOS Low Power Mode or under an
  // autoplay policy. The loop then leaves, and the still stays, until the
  // tile comes within range again. A pause or a removal that cuts a start
  // short is no refusal.
  function playGridLoop(tile, video) {
    function refused() {
      if (gridTileInfo.get(tile)?.video !== video) return;
      removeGridLoop(tile);
      setGridLoopState(tile, "refused");
      syncGridLoops();
    }
    let started;
    try {
      started = video.play();
    } catch (_error) {
      Promise.resolve().then(refused);
      return;
    }
    if (started && typeof started.catch === "function") {
      started.catch((error) => {
        if (error?.name !== "AbortError") refused();
      });
    }
  }

  // A hidden grid keeps its loops, paused. Once it shows again, the tiles
  // with loops that were within range are observed afresh, since the grid
  // may have scrolled to another place meanwhile.
  function rearmGridLoops() {
    if (!gridLoopRangeObserver) return;
    state.gridTiles.forEach((tile) => {
      if (!gridTileInfo.get(tile)?.inRange) return;
      gridLoopRangeObserver.unobserve(tile);
      gridLoopRangeObserver.observe(tile);
    });
    syncGridLoops();
  }

  // A change of the reduced motion preference adds or takes out the loops
  // of the tiles within range at once, and says so on every tile with a
  // loop.
  function onMotionPreference() {
    if (!state.gridBuilt) return;
    const allowed = gridLoopsAllowed();
    state.gridTiles.forEach((tile) => {
      const info = gridTileInfo.get(tile);
      if (!info?.loop) return;
      if (!allowed) {
        removeGridLoop(tile);
        return;
      }
      if (!info.video) setGridLoopState(tile, restingGridLoopState(info));
      addGridLoop(tile);
    });
    syncGridLoops();
  }

  // Older Safari has only addListener on a media query list.
  function watchMotionPreference(watch) {
    if (!reducedMotion) return;
    if (typeof reducedMotion.addEventListener === "function") {
      if (watch) reducedMotion.addEventListener("change", onMotionPreference);
      else reducedMotion.removeEventListener("change", onMotionPreference);
    } else if (typeof reducedMotion.addListener === "function") {
      if (watch) reducedMotion.addListener(onMotionPreference);
      else reducedMotion.removeListener(onMotionPreference);
    }
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
    unobserveGridTile(oldTile);
    removeGridLoop(oldTile);
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

  function unobserveGridTile(tile) {
    if (gridObserver) gridObserver.unobserve(tile);
    if (gridPictureObserver) gridPictureObserver.unobserve(tile);
    if (gridLoopRangeObserver) gridLoopRangeObserver.unobserve(tile);
    if (gridLoopObserver) gridLoopObserver.unobserve(tile);
  }

  function gridColumnIndex(column) {
    return Array.prototype.indexOf.call(gridColumns.children, column);
  }

  // A tile that the Hidden list took out of the grid waits here, by its
  // slide, with its place: its column and the tiles beside it then. Hiding
  // the same posts again and showing them again puts each tile back there,
  // as it was, without loading its picture again (see updateGridInPlace).
  // Built afresh, the grid forgets them.
  const parkedTiles = new Map();
  // Counts the tiles taken out, so they go back in the reverse order.
  let parkedCount = 0;

  // Takes a slide's tile out of the grid and keeps it, with its place. Its
  // column's running height loses it.
  function parkGridTile(slide) {
    const tile = state.gridTiles.get(slide);
    if (!tile) return;
    state.gridTiles.delete(slide);
    const info = gridTileInfo.get(tile);
    unobserveGridTile(tile);
    removeGridLoop(tile);
    info.inRange = false;
    info.visible = false;
    const column = tile.parentElement;
    if (column && column.parentElement === gridColumns) {
      state.gridColumnHeights[gridColumnIndex(column)] -= info.height;
      parkedCount += 1;
      parkedTiles.set(slide, {
        tile,
        column,
        previous: tile.previousElementSibling,
        next: tile.nextElementSibling,
        order: parkedCount,
      });
    }
    tile.remove();
  }

  // Puts a kept tile back in its place: before the tile that followed it,
  // or else after the one before it, or at its column's start or end, as it
  // was. False when there is no such place any more, as after the column
  // count changed, or when the slide's tile was never kept.
  function restoreGridTile(slide) {
    const spot = parkedTiles.get(slide);
    if (!spot || spot.column.parentElement !== gridColumns) return false;
    const { tile, column, previous, next } = spot;
    if (next && next.parentElement === column) {
      column.insertBefore(tile, next);
    } else if (previous && previous.parentElement === column) {
      previous.after(tile);
    } else if (!previous) {
      column.prepend(tile);
    } else if (!next) {
      column.append(tile);
    } else {
      return false;
    }
    parkedTiles.delete(slide);
    const info = gridTileInfo.get(tile);
    state.gridColumnHeights[gridColumnIndex(column)] += info.height;
    state.gridTiles.set(slide, tile);
    setGridLoopState(tile, restingGridLoopState(info));
    observeGridTile(tile, slide);
    return true;
  }

  // Brings the grid in step with a change of the Hidden list without
  // building it afresh, so it keeps its place and its pictures: the tiles of
  // slides that no longer show leave, kept with their places, and those of
  // slides that show again go back to theirs, the last to leave first.
  // Returns false when a slide that shows now has no tile to go back, and
  // the grid needs building afresh.
  function updateGridInPlace(before) {
    const now = new Set(state.slides);
    before.forEach((slide) => {
      if (!now.has(slide)) parkGridTile(slide);
    });
    const was = new Set(before);
    const order = (slide) => parkedTiles.get(slide)?.order || 0;
    return state.slides
      .filter((slide) => !was.has(slide))
      .sort((a, b) => order(b) - order(a))
      .every(restoreGridTile);
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
    if (gridPictureObserver) {
      gridPictureObserver.disconnect();
      gridPictureObserver = null;
    }
    if (gridLoopRangeObserver) {
      gridLoopRangeObserver.disconnect();
      gridLoopRangeObserver = null;
    }
    if (gridLoopObserver) {
      gridLoopObserver.disconnect();
      gridLoopObserver = null;
    }
    Array.from(gridLoopTiles).forEach(removeGridLoop);
    if (gridLoopSyncFrame) {
      cancelAnimationFrame(gridLoopSyncFrame);
      gridLoopSyncFrame = 0;
    }
    // Manifests being read are read to the end, and remembered.
    manifestWaiters.clear();
    manifestQueue = [];
    manifestsAhead.clear();
    // Upgrades and requests for stills still in flight count themselves
    // down when they finish.
    state.gridEnrichQueue = [];
    state.gridEnrichFailures = 0;
    state.gridStillQueue = [];
    state.gridStillFailures = 0;
    state.gridStillRequests = 0;
    state.gridStillFailed = 0;
    syncGridStillStatus();
    state.gridExhausted = false;
    state.gridLoads = 0;
    state.gridLoadTop = 0;
    gridColumns.replaceChildren();
    state.gridTiles.clear();
    parkedTiles.clear();
    state.gridColumnHeights = [];
    state.gridBuilt = false;
    state.gridScrollTop = 0;
    grid.scrollTop = 0;
  }

  // Loading more posts, upgrading thumbnails, asking Reddit for players'
  // stills, loading tiles' pictures and playing loops all wait for the grid
  // to be scrolled near them. Without IntersectionObserver the grid still
  // shows and opens every post that is already loaded, the browser's own
  // lazy loading loads the pictures, no player's still is asked for, and
  // nothing loops.
  function ensureGridObserver() {
    if (gridObserver || typeof IntersectionObserver !== "function") return;
    gridObserver = new IntersectionObserver(onGridIntersection, {
      root: grid,
      rootMargin: GRID_STILL_MARGIN,
    });
    gridPictureObserver = new IntersectionObserver(onGridPictureIntersection, {
      root: grid,
      rootMargin: GRID_PICTURE_MARGIN,
    });
    gridLoopRangeObserver = new IntersectionObserver(onGridLoopRange, {
      root: grid,
      rootMargin: GRID_LOOP_MARGIN,
    });
    gridLoopObserver = new IntersectionObserver(onGridLoopVisibility, {
      root: grid,
    });
    // The sentinel sits under the tallest column, so it marks the real end.
    // Widening the tiles' observer instead would upgrade thumbnails eight
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
    if (gridObserver && (slide.needsEnrichment || wantsGridStill(slide))) {
      gridObserver.observe(tile);
    }
    const info = gridTileInfo.get(tile);
    if (
      gridPictureObserver &&
      (info?.loadPicture || redditVideoId(info?.loop))
    ) {
      gridPictureObserver.observe(tile);
    }
    if (info?.loop) {
      if (gridLoopRangeObserver) gridLoopRangeObserver.observe(tile);
      if (gridLoopObserver) gridLoopObserver.observe(tile);
    }
  }

  // A tile in range starts its picture, which then stays, and asks for its
  // video's manifest, which is then kept, so the tile needs watching no
  // more.
  function onGridPictureIntersection(entries) {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      startGridPicture(entry.target);
      prefetchGridManifest(entry.target);
      gridPictureObserver?.unobserve(entry.target);
    });
  }

  // A loop comes with its range (see GRID_LOOP_MARGIN) and goes with it. A
  // hidden grid has nothing in range, though it keeps its loops (see
  // rearmGridLoops).
  function onGridLoopRange(entries) {
    entries.forEach((entry) => {
      const tile = entry.target;
      const info = gridTileInfo.get(tile);
      if (!info?.loop) return;
      if (entry.isIntersecting) {
        info.inRange = true;
        addGridLoop(tile);
      } else if (gridShowing()) {
        info.inRange = false;
        removeGridLoop(tile);
      }
    });
    syncGridLoops();
  }

  // Loops play only in tiles in view.
  function onGridLoopVisibility(entries) {
    entries.forEach((entry) => {
      const info = gridTileInfo.get(entry.target);
      if (info) info.visible = entry.isIntersecting;
    });
    syncGridLoops();
  }

  function onGridIntersection(entries) {
    entries.forEach((entry) => {
      const info = gridTileInfo.get(entry.target);
      if (!info) return;
      if (entry.isIntersecting) {
        queueGridEnrichment(info.slide);
        queueGridStill(info.slide);
      } else {
        dropGridEnrichment(info.slide);
        dropGridStill(info.slide);
      }
    });
    // Once all are queued, so that the players that came into range
    // together share a request.
    pumpGridStills();
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

  // Whether a slide's tile waits for Reddit's data for its post: a
  // player's tile that would show no picture or has no loop, in the grid of
  // the page's own posts, which has not asked for this post yet this open.
  // Reddit keeps no copy of a YouTube video, and other sources' posts are
  // never read from Reddit.
  function wantsGridStill(slide) {
    return (
      activeSource === liveSource &&
      (location.protocol === "https:" || location.protocol === "http:") &&
      isGridVideo(slide) &&
      (!gridTilePicture(slide).url || !slide.thumbVideo) &&
      !/^https:\/\/www\.youtube\.com\//.test(slide.url || "") &&
      !gridStillTried.has(slide) &&
      Boolean(postFullname(slide.postKey, slide.commentsUrl))
    );
  }

  // Says on the grid how its asking for Reddit's data goes, for anyone who
  // wonders in the browser's developer tools (see the README): how many
  // requests it made and how many failed this open, and whether it gave up.
  function syncGridStillStatus() {
    grid.setAttribute("data-still-requests", String(state.gridStillRequests));
    grid.setAttribute("data-still-failures", String(state.gridStillFailed));
    if (state.gridStillFailures >= GRID_STILL_MAX_FAILURES) {
      grid.setAttribute("data-still-gave-up", "");
    } else {
      grid.removeAttribute("data-still-gave-up");
    }
  }

  // Says afresh what the loops of these slides' tiles are doing, where the
  // tiles have no loop (see restingGridLoopState).
  function refreshLooplessStates(slides) {
    slides.forEach((slide) => {
      const tile = state.gridTiles.get(slide);
      const info = tile && gridTileInfo.get(tile);
      if (info && !info.loop)
        setGridLoopState(tile, restingGridLoopState(info));
    });
  }

  // Players' tiles in range wait for a still, and the grid asks for them in
  // batches (see pumpGridStills).
  function queueGridStill(slide) {
    if (
      !wantsGridStill(slide) ||
      state.gridStillQueue.includes(slide) ||
      state.gridStillFailures >= GRID_STILL_MAX_FAILURES
    )
      return;
    state.gridStillQueue.push(slide);
  }

  // A tile scrolled out of range gives up its place in the queue, though a
  // request already in flight carries on.
  function dropGridStill(slide) {
    const index = state.gridStillQueue.indexOf(slide);
    if (index >= 0) state.gridStillQueue.splice(index, 1);
  }

  // Asks for the stills of up to GRID_STILL_BATCH waiting slides in one
  // request, GRID_STILL_CONCURRENCY requests at a time. Several failures in
  // a row, such as Reddit answering with a challenge page, stop the grid
  // from asking again until the next open.
  function pumpGridStills() {
    while (
      state.gridStillActive < GRID_STILL_CONCURRENCY &&
      state.gridStillFailures < GRID_STILL_MAX_FAILURES &&
      state.gridStillQueue.length
    ) {
      // The filter may have hidden some in the meantime.
      const batch = state.gridStillQueue
        .splice(0, GRID_STILL_BATCH)
        .filter((slide) => state.slides.includes(slide));
      if (!batch.length) continue;
      batch.forEach((slide) => {
        gridStillTried.add(slide);
        gridStillOutcomes.set(slide, "asking");
        // Its tile needs watching no more, unless it waits for an upgrade.
        const tile = state.gridTiles.get(slide);
        if (tile && gridObserver && !slide.needsEnrichment) {
          gridObserver.unobserve(tile);
        }
      });
      state.gridStillActive += 1;
      state.gridStillRequests += 1;
      syncGridStillStatus();
      const openRequest = state.openRequest;
      fetchGridStills(batch)
        .then((answered) => {
          // A result from before a close or reopen counts for nothing now.
          if (openRequest !== state.openRequest) return;
          if (answered === false) {
            state.gridStillFailures += 1;
            state.gridStillFailed += 1;
          } else if (answered) {
            state.gridStillFailures = 0;
          }
          batch.forEach((slide) => {
            if (gridStillOutcomes.get(slide) !== "asking") return;
            gridStillOutcomes.set(
              slide,
              answered === false ? "info-failed" : "no-data",
            );
          });
          syncGridStillStatus();
          // Once the grid gives up, every tile still waiting says so.
          refreshLooplessStates(
            state.gridStillFailures >= GRID_STILL_MAX_FAILURES
              ? Array.from(state.gridTiles.keys())
              : batch,
          );
        })
        .finally(() => {
          state.gridStillActive -= 1;
          pumpGridStills();
        });
    }
  }

  // Asks Reddit, on the page's own origin and with the viewer's session,
  // for the data of the slides' posts, and gives each slide the still that
  // its post has (see postStill), and the loop, such as Reddit's copy of a
  // RedGIFs clip (see postLoop). Resolves to true once Reddit has answered
  // with its data, false when the request failed or Reddit answered with
  // anything else, such as a challenge page, and undefined when there was
  // nothing to ask.
  async function fetchGridStills(slides) {
    const waiting = new Map();
    slides.forEach((slide) => {
      const name = postFullname(slide.postKey, slide.commentsUrl).toLowerCase();
      if (!name) return;
      if (!waiting.has(name)) waiting.set(name, []);
      waiting.get(name).push(slide);
    });
    if (!waiting.size) return undefined;
    let children;
    try {
      const response = await fetch(
        `${location.origin}/api/info.json?id=${Array.from(waiting.keys()).join(",")}&raw_json=1`,
        { credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error(`Reddit returned ${response.status}`);
      if (/html/i.test(response.headers.get("content-type") || "")) {
        throw new Error("Reddit answered with a page");
      }
      children = JSON.parse(await response.text())?.data?.children;
      if (!Array.isArray(children)) throw new Error("Reddit named no posts");
    } catch (_error) {
      return false;
    }
    children.forEach((child) => {
      const post = child?.data;
      const name =
        typeof post?.name === "string" ? post.name.toLowerCase() : "";
      if (!waiting.has(name)) return;
      const still = postStill(post);
      const loop = postLoop(post);
      waiting.get(name).forEach((slide) => {
        if (still) applyGridStill(slide, still);
        if (!loop) return;
        gridStillOutcomes.set(slide, "loop");
        applyGridLoop(slide, loop);
      });
    });
    return true;
  }

  // Puts a loop from Reddit's data (see postLoop) on a player's slide that
  // has none, and its tile watches for the loop's range as a new tile would.
  // The tile is within the picture's range, since that is where the grid
  // asks for the data, so it asks for its video's manifest at once. Only
  // the tile reads it.
  function applyGridLoop(slide, loop) {
    if (slide.thumbVideo) return;
    slide.thumbVideo = loop;
    const tile = state.gridTiles.get(slide);
    const info = tile && gridTileInfo.get(tile);
    if (!info || info.slide !== slide || info.loop || !gridLoopObserver) {
      return;
    }
    info.loop = loop;
    setGridLoopState(tile, restingGridLoopState(info));
    prefetchGridManifest(tile);
    gridLoopRangeObserver.observe(tile);
    gridLoopObserver.observe(tile);
  }

  // Puts a still from Reddit's data (see postStill) on a player's slide:
  // thumb, the copy that its tile loads, and the still's size; and for a
  // player frame, the still itself as its poster, which only its tile reads,
  // since the slideshow loads the frame. A video's poster stays as it was,
  // so that the slideshow's player is unchanged. The tile then shows it.
  function applyGridStill(slide, still) {
    if (gridTilePicture(slide).url) return;
    if (slide.kind === "embed") {
      slide.poster = still.url;
      slide.thumb = still.thumb;
    } else {
      slide.thumb = still.thumb || still.url;
    }
    if (still.width && still.height) {
      slide.width = still.width;
      slide.height = still.height;
    }
    showGridStill(slide);
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

  // How many of the loaded posts the Hidden list leaves out.
  function hiddenPostCount() {
    const list = state.settings.hidden;
    if (!Array.isArray(list) || !list.length) return 0;
    const posts = new Set();
    state.allSlides.forEach((slide) => {
      if (slideIsHidden(slide, list)) posts.add(postIdentity(slide));
    });
    return posts.size;
  }

  // Whether loaded posts are left out by choice: the Show filter is on, or
  // the Hidden list leaves out a post here. Either way an empty stage keeps
  // the controls, and a load searches on past the posts it leaves out.
  function filtering() {
    return mediaFilterActive(state.settings) || hiddenPostCount() > 0;
  }

  function syncPresentationUi() {
    const hasSlides = state.slides.length > 0;
    const inGrid = state.view === "grid" && hasSlides;
    // The gear's dot and tooltip are the Show filter's alone; the counter
    // says what the Hidden list leaves out.
    const mediaFiltering = mediaFilterActive(state.settings);
    root.classList.toggle("redditp--grid", inGrid);
    root.classList.toggle("redditp--filtered", mediaFiltering);
    empty.hidden = hasSlides;
    syncEmptyState();
    details.hidden = !hasSlides || !state.settings.showDetails;
    // A filter that hides every post keeps the controls, so the gear can
    // still change it; the controls that need a slide go meanwhile.
    controls.hidden = !hasSlides && !filtering();
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
    syncSaveButton();
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
    settingsButton.title = mediaFiltering
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

  const saveTracker = createSaveTracker();
  // The grid tile that was last pointed at or focused, which the Save button
  // acts on, since clicking the button leaves neither.
  let lastGridTile = null;

  // The slide that S or the Save button acts on: the current slide in the
  // slideshow (a gallery post's media shown, not the whole gallery); in the
  // grid, what X acts on, and for the button, the tile last pointed at or
  // focused.
  function saveTarget(fromButton) {
    const target = hideTarget();
    if (target) return target.slide;
    if (state.view !== "grid" || !fromButton) return null;
    const tile =
      lastGridTile && gridColumns.contains(lastGridTile) ? lastGridTile : null;
    return (tile && gridTileInfo.get(tile)?.slide) || null;
  }

  // What the slide's own post element says of its score, date and rating,
  // for a live Reddit page; the archive's slides carry theirs.
  function saveFacts(slide) {
    const node = slide.postNode;
    if (!node || typeof node.getAttribute !== "function") return null;
    return saveFactsFromAttributes((name) => node.getAttribute(name));
  }

  function canSaveHere() {
    const runtime = extensionRuntime();
    return Boolean(runtime && typeof runtime.connect === "function");
  }

  // The button names its state for the slide shown. It is hidden where there
  // is no extension to relay to the helper, as on a page that loads the
  // script by itself.
  function syncSaveButton() {
    saveButton.hidden = !canSaveHere();
    const slide = state.view === "slideshow" ? state.slides[state.index] : null;
    const built = slide ? buildSaveRequest(slide) : null;
    const saved = Boolean(built?.ok && saveTracker.isSaved(built.itemId));
    const saving = Boolean(built?.ok && saveTracker.isPending(built.itemId));
    saveButton.textContent = saved ? "saved" : saving ? "saving…" : "save";
    saveButton.setAttribute("aria-pressed", String(saved));
    saveButton.classList.toggle("redditp__save--saved", saved);
    saveButton.title = saved
      ? "Saved to the gallery (S)"
      : "Save to the gallery (S)";
  }

  // Saves a slide's media to the gallery and says how it went.
  function saveSlide(slide) {
    if (!slide) {
      showToast("Point at a post, or focus it, to save it.");
      return;
    }
    if (!canSaveHere()) {
      showToast(SAVE_MESSAGES.unavailable);
      return;
    }
    const built = buildSaveRequest(slide, saveFacts(slide));
    if (!built.ok) {
      showToast(
        built.reason === "no-post"
          ? SAVE_MESSAGES.noPost
          : SAVE_MESSAGES.unsavable,
      );
      return;
    }
    const turn = saveTracker.begin(built.itemId);
    if (turn === "saved") {
      showToast(SAVE_MESSAGES.already);
      return;
    }
    // A second press while the request is out sends nothing.
    if (turn === "pending") return;
    showToast("Saving…");
    syncSaveButton();
    sendSaveRequest(extensionRuntime(), built.request, built.itemId).then(
      (outcome) => {
        saveTracker.end(built.itemId, outcome.status);
        showToast(outcome.text);
        syncSaveButton();
      },
    );
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
  // shows, such as "images only", the Hidden list how many loaded posts it
  // leaves out, as "3 hidden", and media that failed to load adds how many
  // did, before "loading more".
  function updateCount(loading) {
    const suffix = countSuffix(
      filterSummary(state.settings, hiddenPostCount()),
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
  // prepared, the page has no posts, the Show filter or the Hidden list
  // leaves them all out, or all their pictures and videos failed to load.
  // Another source can say the first two in its own words.
  function syncEmptyState() {
    let heading = "No posts found on this page";
    let text =
      "Scroll Reddit to load some posts, then try presentation mode again.";
    let ownWords = null;
    if (state.preparing) {
      heading = "Preparing Reddit video…";
      text = "Waiting for Reddit's full-quality player.";
      ownWords = sourceText("preparing");
    } else if (filtering()) {
      const mediaFiltering = mediaFilterActive(state.settings);
      if (state.loadingMore) {
        heading = mediaFiltering
          ? `No ${shownMediaLabel(state.settings, "or")} here yet`
          : "Nothing to show here yet";
        text = "Loading more posts…";
        if (state.loadFound) text += ` ${state.loadFound} checked`;
      } else {
        heading = "Nothing here matches the filter";
        text = emptyFilterText(mediaFiltering);
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

  // Why the filters leave nothing to show. The Hidden list is named when it
  // leaves out posts that the Show filter alone would show.
  function emptyFilterText(mediaFiltering) {
    const showOnly = Object.assign({}, state.settings, { hidden: [] });
    const posts = new Set();
    state.allSlides.forEach((slide) => {
      if (
        slideIsHidden(slide, state.settings.hidden) &&
        slideMatchesFilter(slide, showOnly)
      ) {
        posts.add(postIdentity(slide));
      }
    });
    const hidden = posts.size;
    if (!mediaFiltering) {
      return `Your Hidden list hides ${hidden === 1 ? "the one post" : `all ${hidden} posts`} here. Change it in the settings.`;
    }
    const byList = hidden
      ? `, and your Hidden list hides ${hidden} ${hidden === 1 ? "post" : "posts"} here`
      : "";
    return `Only ${shownMediaLabel(state.settings, "and")} are shown${byList}. Change that in the settings, or press O.`;
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
      // A mouse drag across the picture is a swipe. As a drag source, the
      // picture would have the browser drag it instead and cancel the
      // pointer, so the swipe would never end.
      img.draggable = false;
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
      // A video read in ahead (see warmVideosAhead) is already buffered.
      const warm = takeWarmVideo(slide.url);
      const video = warm || element("video", "redditp__video", "");
      if (warm) video.className = "redditp__video";
      else video.src = slide.url;
      video.poster = slide.poster || "";
      video.controls = true;
      video.playsInline = true;
      video.autoplay = true;
      video.muted = !state.settings.sound;
      video.loop = !state.autoPlaying;
      if (!warm) video.preload = "metadata";
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
        poster.draggable = false;
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
    // window found its end. A load whose every batch the filter hid, up to
    // FILTERED_MAX_ROUNDS, has searched as far as the viewer goes by itself:
    // the next search waits for the last post, as at the end of the feed,
    // rather than starting again from every slide while few are left.
    if (found) state.feedExhausted = false;
    if (verdict === "idle" || verdict === "rounds") state.feedExhausted = true;
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
      // A search that the filter ended goes no further in the background.
      continuePrefetch(verdict === "rounds" ? 0 : found);
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
  // The next Reddit videos are read in too (see warmVideosAhead). Data Saver
  // turns this off.
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
    warmVideosAhead(warmVideoUrls(state.slides, state.index));
  }

  // Reads each of the next Reddit videos (see warmVideoUrls) into a muted,
  // paused video element of its own, in no document, which the slideshow
  // takes over when it gets there (see takeWarmVideo), so that the video
  // starts at once, with the sound and settings that any slide's video
  // has. A video that is no longer ahead, because the slideshow passed it or
  // moved away, is let go.
  function warmVideosAhead(urls) {
    state.warmVideos.forEach((video, url) => {
      if (urls.includes(url)) return;
      state.warmVideos.delete(url);
      releaseWarmVideo(video);
    });
    urls.forEach((url) => {
      if (state.warmVideos.has(url)) return;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
      state.warmVideos.set(url, video);
    });
  }

  // The video read in ahead for this URL, which the slideshow now shows, or
  // null. One that failed is let go, so the slideshow's own attempt shows
  // the failure as usual.
  function takeWarmVideo(url) {
    const video = state.warmVideos.get(url);
    if (!video) return null;
    state.warmVideos.delete(url);
    if (video.error) {
      releaseWarmVideo(video);
      return null;
    }
    return video;
  }

  // Stops reading a video in, and lets the browser release it.
  function releaseWarmVideo(video) {
    video.removeAttribute("src");
    video.load();
  }

  function releaseWarmVideos() {
    state.warmVideos.forEach(releaseWarmVideo);
    state.warmVideos.clear();
  }

  // Counts the posts a load has looked at, for a filtered load's progress
  // text, and the counter's count of hidden posts.
  function noteLoadProgress(scan) {
    if (!scan.found) return;
    state.loadFound += scan.found;
    if (!scan.shown && filtering()) {
      syncEmptyState();
      syncGridStatus();
      updateCount(loadingSuffixShown());
    }
  }

  // Scrolling near the end of the grid loads more posts the way the last
  // slide does, without moving to them, up to GRID_LOAD_ROUNDS loads in a
  // row while the viewer does not scroll (see gridLoadWanted).
  function loadMoreFromGrid() {
    if (
      isSinglePostPage() ||
      !state.open ||
      state.view !== "grid" ||
      state.loadingMore ||
      state.gridExhausted
    )
      return;
    const scrolled = grid.scrollTop - state.gridLoadTop;
    if (!gridLoadWanted(state.gridLoads, scrolled, grid.clientHeight)) return;
    if (!state.gridLoads || Math.abs(scrolled) >= grid.clientHeight / 2) {
      state.gridLoads = 0;
      state.gridLoadTop = grid.scrollTop;
    }
    state.gridLoads += 1;
    state.advanceAfterLoad = false;
    state.prefetchLoads = 0;
    void loadMorePosts();
  }

  // A grid that has stopped loading by itself (see gridLoadWanted) looks at
  // its end again once the viewer has scrolled half a screen.
  function onGridScroll() {
    if (
      state.gridLoads < GRID_LOAD_ROUNDS ||
      state.loadingMore ||
      state.gridExhausted ||
      Math.abs(grid.scrollTop - state.gridLoadTop) < grid.clientHeight / 2
    )
      return;
    rearmGridSentinel();
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
      (!filtering() && !state.unavailable)
    )
      return;
    state.advanceAfterLoad = false;
    state.prefetchLoads = 0;
    void loadMorePosts();
  }

  // Shows what the Show filter and the Hidden list now let through. The
  // slides come from the ones already read rather than from the page, so
  // upgraded thumbnails stay upgraded. A current slide that still matches
  // stays, and the slideshow then keeps its image, video and timer;
  // otherwise `preferred` takes over where it shows, as when Undo brings
  // back the slide that X hid, or else the next shown slide in page order.
  // A change of the Show filter builds the grid afresh. A change of the
  // Hidden list (hiddenOnly) leaves the grid where it is: tiles leave and
  // come back in place (see updateGridInPlace), and a focused tile that
  // leaves hands focus to the next tile in page order.
  function applyFilter(hiddenOnly, preferred) {
    if (!state.open || state.preparing) return;
    const current = state.slides[state.index];
    const before = state.slides;
    const focusedTile = focusedGridTile();
    const focusedSlide = focusedTile
      ? gridTileInfo.get(focusedTile)?.slide
      : null;
    cancelLoadMore();
    state.gridExhausted = false;
    // Other posts show now, so the feed may well have more of them.
    state.feedExhausted = false;
    state.slides = state.allSlides.filter((slide) =>
      slideMatchesFilter(slide, state.settings),
    );
    state.index = shownIndexFor(
      preferred && state.slides.includes(preferred) ? preferred : current,
    );
    let inPlace = false;
    if (state.gridBuilt) {
      inPlace = Boolean(hiddenOnly) && updateGridInPlace(before);
      if (!inPlace) resetGrid();
    }
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
      if (state.view === "grid" && !inPlace) {
        revealGridTile(state.gridTiles.get(state.slides[state.index]));
      }
    }
    if (inPlace) {
      // The grid's end may have come within reach, and stays watched.
      state.gridLoads = 0;
      state.gridLoadTop = grid.scrollTop;
      rearmGridSentinel();
      syncGridLoops();
      if (focusedSlide && !state.gridTiles.has(focusedSlide)) {
        const next = state.gridTiles.get(
          state.slides[shownIndexFor(focusedSlide)],
        );
        if (next) {
          revealGridTile(next);
          next.focus({ preventScroll: true });
        }
      }
    }
    refocusIfLost();
    loadForEmptyFilter();
  }

  function syncGridStatus() {
    let text = "";
    if (!isSinglePostPage()) {
      const mediaFiltering = mediaFilterActive(state.settings);
      // The Hidden list alone looks for any post it does not leave out.
      const leavingOut = filtering();
      const shownLabel = mediaFiltering
        ? shownMediaLabel(state.settings, "or")
        : "posts";
      if (state.loadingMore) {
        text = leavingOut
          ? `Looking for more ${shownLabel}…`
          : "Loading more posts…";
        const checked = state.loadFound;
        if (leavingOut && checked) {
          text += ` ${checked} ${checked === 1 ? "post" : "posts"} checked`;
        }
      } else if (state.gridExhausted) {
        if (mediaFiltering) {
          text = `No more ${shownLabel} found`;
        } else if (leavingOut) {
          text = "No more posts found outside your Hidden list";
        } else {
          text = "No more posts right now";
        }
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
    syncHiddenList();
  }

  // Lists the Hidden list's entries, each with a button that takes it off.
  function syncHiddenList() {
    const entries = state.settings.hidden;
    hiddenList.replaceChildren(
      ...entries.map((entry) => {
        const item = element("li", "redditp__hidden-item", "");
        const remove = element("button", "redditp__hidden-remove", "×");
        remove.type = "button";
        remove.dataset.entry = entry;
        remove.setAttribute("aria-label", `Unhide ${entry}`);
        remove.title = `Unhide ${entry}`;
        item.append(element("span", "redditp__hidden-entry", entry), remove);
        return item;
      }),
    );
    hiddenList.hidden = !entries.length;
    hiddenEmpty.hidden = entries.length > 0;
  }

  // Says why the field's text was not added, or clears that.
  function showHiddenMessage(text) {
    hiddenMessage.textContent = text;
    if (text) hiddenInput.setAttribute("aria-invalid", "true");
    else hiddenInput.removeAttribute("aria-invalid");
  }

  // Adds the field's text to the Hidden list: a user, a subreddit or a
  // site. Anything else stays in the field, with a message.
  function addHiddenFromField() {
    const result = addToHiddenList(state.settings.hidden, hiddenInput.value);
    if (result.status === "added") {
      hiddenInput.value = "";
      showHiddenMessage("");
      updateSettings({ hidden: result.list });
      return;
    }
    if (result.status === "duplicate") {
      showHiddenMessage(`${result.entry} is hidden already.`);
    } else if (result.status === "full") {
      showHiddenMessage(
        `The list holds ${HIDDEN_MAX_ENTRIES} entries at most. Remove some first.`,
      );
    } else {
      showHiddenMessage(
        "Enter a user as u/name, a subreddit as r/name, or a site such as redgifs.com.",
      );
    }
    hiddenInput.focus({ preventScroll: true });
  }

  // Takes an entry off the Hidden list from its × button. Focus moves to
  // the entry that takes its place, or the one before, or else the field.
  function onHiddenListClick(event) {
    const button = event.target.closest?.(".redditp__hidden-remove");
    if (!button || !hiddenList.contains(button)) return;
    const buttons = () =>
      Array.from(hiddenList.querySelectorAll(".redditp__hidden-remove"));
    const position = buttons().indexOf(button);
    showHiddenMessage("");
    updateSettings({
      hidden: removeFromHiddenList(
        state.settings.hidden,
        button.dataset.entry || "",
      ),
    });
    const left = buttons();
    (left[Math.min(position, left.length - 1)] || hiddenInput).focus({
      preventScroll: true,
    });
  }

  function openSettings() {
    state.settingsOpen = true;
    showHiddenMessage("");
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

  // `preferred` is the slide to show when a change of the Hidden list brings
  // it back (see applyFilter).
  function updateSettings(changes, preferred) {
    Object.assign(state.settings, changes);
    saveSettings();
    // Display changes must not reload the image, restart playback, or reset
    // the current slide's timer. Only a new duration needs a fresh timer,
    // and only the Show filter and the Hidden list change which slides
    // there are.
    syncPresentationUi();
    if ("slideDurationSeconds" in changes) scheduleAuto();
    const mediaChanged = MEDIA_FILTER_TYPES.some(([key]) => key in changes);
    if (mediaChanged || "hidden" in changes) {
      syncSettingsUi();
      applyFilter(!mediaChanged, preferred);
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
    state.gridLoads = 0;
    // The grid takes the network over from the slideshow.
    releaseWarmVideos();
    setAutoPlaying(false);
    render();
    // display:none dropped the grid's scroll position.
    grid.scrollTop = state.gridScrollTop;
    rearmGridLoops();
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
    // The hidden grid's loops pause.
    syncGridLoops();
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

  // How long a message shows. One that is pointed at or focused stays
  // until it no longer is.
  const TOAST_MS = 6000;
  let toastTimer = null;
  // What the message's Undo button undoes: { entry, current, landed,
  // target, targetFocused } (see hideAuthorOf), or null.
  let toastUndoAction = null;

  // Shows a message, with an Undo button when there is something to undo.
  function showToast(text, undo) {
    toastText.textContent = text;
    toastUndoAction = undo || null;
    toastUndo.hidden = !undo;
    toast.classList.add("redditp__toast--shown");
    endToastLater();
  }

  function endToastLater() {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      if (toast.matches(":hover") || toast.contains(document.activeElement)) {
        endToastLater();
      } else {
        hideToast();
      }
    }, TOAST_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
    const hadFocus = toast.contains(document.activeElement);
    toastUndoAction = null;
    toastText.textContent = "";
    toastUndo.hidden = true;
    toast.classList.remove("redditp__toast--shown");
    if (hadFocus && state.open) refocusIfLost();
  }

  // Where the mouse pointer is over the presentation, while it is there and
  // the keyboard has not moved focus since; a touch or a pen leaves none.
  let mousePoint = null;

  // The grid tile under the mouse pointer, if any.
  function pointedGridTile() {
    if (!mousePoint) return null;
    const hit = document.elementFromPoint(mousePoint.x, mousePoint.y);
    const tile =
      hit && typeof hit.closest === "function"
        ? hit.closest(".redditp__tile")
        : null;
    return tile && gridColumns.contains(tile) ? tile : null;
  }

  // Whether a key goes into a field that is being typed in. A field inside
  // an open shadow root, as on current Reddit, counts too, though the event
  // names its host as the target.
  function isTypingTarget(event) {
    const path =
      typeof event.composedPath === "function" ? event.composedPath() : [];
    const target = path[0] || event.target;
    return Boolean(
      target &&
      (target.isContentEditable ||
        /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "")),
    );
  }

  // What X hides the author of: in the grid, the tile under the mouse
  // pointer, or else the focused tile; in the slideshow, the current slide.
  function hideTarget() {
    if (state.view !== "grid") {
      const slide = state.slides[state.index];
      return slide ? { slide, tile: null } : null;
    }
    const tile = pointedGridTile() || focusedGridTile();
    const slide = tile ? gridTileInfo.get(tile)?.slide : null;
    return slide ? { slide, tile } : null;
  }

  // Puts a slide's author on the Hidden list, so that their posts leave the
  // grid and the slideshow, which moves on to the next post shown. The
  // message that follows can undo it. A post without an author, such as a
  // deleted account's, says so instead.
  function hideAuthorOf(slide, tile) {
    const result = addToHiddenList(state.settings.hidden, slide.author);
    if (result.status === "invalid") {
      showToast("This post has no author to hide.");
      return;
    }
    if (result.status === "duplicate") {
      showToast(`${result.entry} is hidden already.`);
      return;
    }
    if (result.status === "full") {
      showToast(
        `The Hidden list holds ${HIDDEN_MAX_ENTRIES} entries at most. Remove some in the settings first.`,
      );
      return;
    }
    const undo = {
      entry: result.entry,
      current: state.slides[state.index] || null,
      landed: null,
      target: slide,
      targetFocused: Boolean(tile) && document.activeElement === tile,
    };
    updateSettings({ hidden: result.list });
    undo.landed = state.slides[state.index] || null;
    showToast(`Hid ${result.entry}`, undo);
  }

  // Takes the last hide back, while its message shows. The posts come back
  // where they were: in the grid in their places, and in the slideshow at
  // the hidden post, unless the slideshow has moved on since. A tile that
  // had focus, or the tile that X hid when Undo had focus, gets it back.
  function undoHide() {
    const undo = toastUndoAction;
    if (!undo) return;
    const undoHadFocus = toast.contains(document.activeElement);
    toastUndoAction = null;
    const list = removeFromHiddenList(state.settings.hidden, undo.entry);
    if (list.length !== state.settings.hidden.length) {
      const stayed = (state.slides[state.index] || null) === undo.landed;
      updateSettings({ hidden: list }, stayed ? undo.current : null);
    }
    const tile =
      state.view === "grid" ? state.gridTiles.get(undo.target) : null;
    if (tile && (undo.targetFocused || undoHadFocus)) {
      revealGridTile(tile);
      tile.focus({ preventScroll: true });
    }
    hideToast();
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

  // A plain click or tap on the slideshow's picture goes back to the grid,
  // as V does. A drag that ends on the picture, such as a mouse swipe, is no
  // click, and a Ctrl/Cmd click has already opened the picture in a new tab.
  function showGridFromPicture(event) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      state.pointerDragged ||
      state.view !== "slideshow"
    )
      return;
    const picture = event.target.closest?.(".redditp__image");
    if (!picture || picture.parentNode !== mediaBox) return;
    event.preventDefault();
    showGrid();
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
    releaseWarmVideos();
    state.settingsOpen = false;
    settingsOverlay.hidden = true;
    hideToast();
    mousePoint = null;
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
    watchMotionPreference(false);
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
    releaseWarmVideos();
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
    // Moving focus with the keyboard makes X act on the focused tile again,
    // rather than on one the mouse pointer rests over.
    if (event.key === "Tab") mousePoint = null;
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
    if (event.key.toLowerCase() === "x") {
      // An x typed into a field stays there; with no post, X passes
      // through.
      if (isTypingTarget(event) || !state.slides.length) return;
      event.preventDefault();
      event.stopPropagation();
      const target = hideTarget();
      if (target) hideAuthorOf(target.slide, target.tile);
      else showToast("Point at a post, or focus it, to hide its author.");
      return;
    }
    if (event.key.toLowerCase() === "z") {
      // Z undoes a hide only while its message shows.
      if (isTypingTarget(event) || !toastUndoAction) return;
      event.preventDefault();
      event.stopPropagation();
      undoHide();
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
    if (event.key.toLowerCase() === "s") {
      // An s typed into a field stays there; where saving is not available
      // (no extension to ask), S passes through.
      if (isTypingTarget(event) || !canSaveHere() || !state.slides.length) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      saveSlide(saveTarget(false));
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
  saveButton.addEventListener("click", () => saveSlide(saveTarget(true)));
  const rememberGridTile = (event) => {
    const tile =
      typeof event.target.closest === "function"
        ? event.target.closest(".redditp__tile")
        : null;
    if (tile) lastGridTile = tile;
  };
  gridColumns.addEventListener("pointerover", rememberGridTile);
  gridColumns.addEventListener("focusin", rememberGridTile);
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
  hiddenList.addEventListener("click", onHiddenListClick);
  hiddenAddButton.addEventListener("click", addHiddenFromField);
  hiddenInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    addHiddenFromField();
  });
  toastUndo.addEventListener("click", undoHide);
  collapseButton.addEventListener("click", () => {
    updateSetting("showControls", !state.settings.showControls);
  });
  // Ahead of the surface toggle, so a Ctrl/Cmd click opens the media rather
  // than pausing it.
  mediaBox.addEventListener("click", openMediaInNewTab, true);
  mediaBox.addEventListener("click", toggleVideoFromSurface, true);
  mediaBox.addEventListener("click", showGridFromPicture);
  // After clicking "mute" and "unmute" the right-left arows failed to change
  // the current slide in Chrome (seemed to work in Firefox).
  // Media events do not bubble, so listen during capture.
  ["volumechange", "play", "pause", "seeked", "ratechange"].forEach((type) => {
    mediaBox.addEventListener(type, releaseVideoFocus, true);
  });
  document.addEventListener("redditp:presentation-retire", retire);
  window.addEventListener("message", onEmbedMessage);
  watchMotionPreference(true);
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
  grid.addEventListener("scroll", onGridScroll, { passive: true });
  [mediaBox, grid].forEach((surface) => {
    surface.addEventListener(MIDDLE_CLICK_EVENT, openMediaInNewTab);
    surface.addEventListener("mousedown", preventMiddleButtonScroll);
  });
  // X in the grid acts on the tile under the mouse pointer (see
  // pointedGridTile).
  root.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") {
      mousePoint = { x: event.clientX, y: event.clientY };
    }
  });
  root.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") mousePoint = null;
  });
  root.addEventListener("pointerdown", (event) => {
    state.pointerDragged = false;
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
    // The click that follows a drag is no tap (see showGridFromPicture).
    state.pointerDragged = Math.abs(dx) > 10 || Math.abs(dy) > 10;
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
      embedStill,
    },
  };
  if (!EMBEDDED) open();
})();
