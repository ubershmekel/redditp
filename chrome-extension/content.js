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
  const IMAGE_URL_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
  const VIDEO_URL_RE = /\.(?:m3u8|mp4|webm)(?:$|[?#])/i;
  const MIN_EXPAND_IMAGE_LONG_EDGE = 1000;
  const MIN_EXPAND_IMAGE_SHORT_EDGE = 600;
  const SETTINGS_KEY = "redditpPresentationSettings";
  const README_URL =
    "https://github.com/ubershmekel/redditp/blob/main/chrome-extension/README.md";
  const DEFAULT_SETTINGS = {
    slideDurationSeconds: 6,
    showDetails: true,
    showArrows: true,
    showClose: true,
    controlsCollapsed: false,
  };
  const state = {
    open: false,
    opening: false,
    slides: [],
    index: 0,
    autoTimer: null,
    autoPlaying: false,
    sound: false,
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
  };

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
        return { kind: "video", url: `https://i.imgur.com/${match[1]}.mp4` };
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

  function mediaFromNode(node, sourceUrl) {
    const media = [];
    const seen = new Set();
    function add(kind, url, poster) {
      const normalized = absoluteUrl(url);
      const key = canonicalMediaKey(normalized);
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      media.push({ kind, url: normalized, poster: absoluteUrl(poster) });
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
        if (image && usefulImage(image)) add("image", imageUrl(image));
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
      add("image", sourceUrl);
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
    if (external) add(external.kind, external.url);
    node.querySelectorAll("iframe[src]").forEach((iframe) => {
      const iframeMedia = externalMedia(iframe.getAttribute("src"));
      if (iframeMedia) add(iframeMedia.kind, iframeMedia.url);
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
      const source = contentUrl(node, comments);
      const base = {
        title: postTitle(node),
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
      const isGallery =
        node.hasAttribute("gallery") ||
        node.getAttribute("post-type") === "gallery" ||
        Boolean(node.querySelector("gallery-carousel"));
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
      media.forEach((item, mediaIndex) => {
        const key = `${comments || base.title}|${item.url}`;
        if (!seenPostMedia.has(key)) {
          seenPostMedia.add(key);
          slides.push(
            Object.assign({}, base, item, {
              galleryItem: isGallery ? mediaIndex + 1 : 0,
              galleryTotal: isGallery ? media.length : 0,
              needsEnrichment,
            }),
          );
        }
      });
    });
    return slides;
  }

  async function enrichSlide(slide) {
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
      if (!detailMedia.length) throw new Error("Post had no supported media");
      const isGallery =
        detailNode.hasAttribute("gallery") ||
        detailNode.getAttribute("post-type") === "gallery" ||
        Boolean(detailNode.querySelector("gallery-carousel"));
      const replacements = detailMedia.map((item, index) =>
        Object.assign({}, slide, item, {
          sourceUrl: detailSource || slide.sourceUrl,
          galleryItem: isGallery ? index + 1 : 0,
          galleryTotal: isGallery ? detailMedia.length : 0,
          needsEnrichment: false,
        }),
      );

      const slideIndex = state.slides.findIndex(
        (candidate) =>
          candidate.needsEnrichment &&
          (candidate.postKey || candidate.commentsUrl) === key,
      );
      if (slideIndex < 0) return;
      const wasCurrent = state.index === slideIndex;
      if (slideIndex < state.index) {
        state.index += replacements.length - 1;
      }
      state.slides.splice(slideIndex, 1, ...replacements);
      state.enrichments.set(key, "done");
      if (wasCurrent && state.open) {
        state.index = slideIndex;
        render();
      }
    } catch (_error) {
      // Keep the visible thumbnail/link card and allow another attempt if the
      // user revisits this slide. Reddit may return a challenge or gated page.
      state.enrichments.delete(key);
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

  const count = element("div", "redditp__count", "");
  const closeButton = element("button", "redditp__button redditp__close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close presentation mode");
  const details = element("div", "redditp__details", "");
  const title = element("h1", "redditp__title", "");
  const meta = element("div", "redditp__meta", "");
  details.append(title, meta);

  const controls = element("nav", "redditp__controls", "");
  controls.setAttribute("aria-label", "Slideshow controls");
  const prevButton = element("button", "redditp__arrow redditp__prev", "‹");
  prevButton.setAttribute("aria-label", "Previous slide");
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
  brand.title = "Open the Chrome extension README on GitHub";
  const autoButton = element(
    "button",
    "redditp__button redditp__playback-control redditp__control-item",
    "auto",
  );
  const soundButton = element(
    "button",
    "redditp__button redditp__playback-control redditp__control-item",
    "sound off",
  );
  const nextButton = element("button", "redditp__arrow redditp__next", "›");
  nextButton.setAttribute("aria-label", "Next slide");
  const sourceLink = element(
    "a",
    "redditp__button redditp__link-control redditp__control-item",
    "media",
  );
  const commentsLink = element(
    "a",
    "redditp__button redditp__link-control redditp__control-item",
    "comments",
  );
  const collapseButton = element(
    "button",
    "redditp__button redditp__collapse",
    "−",
  );
  collapseButton.setAttribute("aria-label", "Collapse bottom controls");
  prevButton.type =
    settingsButton.type =
    autoButton.type =
    soundButton.type =
    nextButton.type =
    collapseButton.type =
      "button";
  sourceLink.target = commentsLink.target = "_blank";
  sourceLink.rel = commentsLink.rel = "noopener noreferrer";
  controls.append(
    settingsButton,
    brand,
    commentsLink,
    sourceLink,
    autoButton,
    soundButton,
    count,
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

  settingsPanel.append(
    settingsTitle,
    settingsClose,
    durationLabel,
    checkboxSetting("showDetails", "Show the title panel"),
    checkboxSetting("showArrows", "Show previous and next arrows"),
    checkboxSetting(
      "showClose",
      "Show the close button (press Esc instead when hidden)",
    ),
    checkboxSetting("controlsCollapsed", "Keep the bottom panel compact"),
  );
  settingsOverlay.append(settingsPanel);
  root.append(
    stage,
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
        failed ? "Image unavailable" : "Open linked post",
      ),
      element("strong", "", slide.title),
      element("span", "", slide.sourceUrl || slide.commentsUrl),
    );
    return card;
  }

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

  function showMediaFailure(mediaElement, slide) {
    if (
      state.open &&
      state.slides[state.index] === slide &&
      mediaElement.parentNode === mediaBox
    ) {
      mediaBox.replaceChildren(linkCard(slide, true));
      slide.mediaFailed = true;
      scheduleAuto();
    }
  }

  function expandLargeImage(image) {
    const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const shortEdge = Math.min(image.naturalWidth, image.naturalHeight);
    image.classList.toggle(
      "redditp__image--expand",
      longEdge >= MIN_EXPAND_IMAGE_LONG_EDGE &&
        shortEdge >= MIN_EXPAND_IMAGE_SHORT_EDGE,
    );
  }

  function render() {
    stopMedia();
    const hasSlides = state.slides.length > 0;
    empty.hidden = hasSlides;
    details.hidden = !hasSlides || !state.settings.showDetails;
    controls.hidden = !hasSlides;
    prevButton.hidden = nextButton.hidden =
      !hasSlides || !state.settings.showArrows;
    prevButton.disabled = !hasSlides || state.index === 0;
    nextButton.disabled =
      !hasSlides ||
      (isSinglePostPage() && state.index === state.slides.length - 1);
    closeButton.hidden = !state.settings.showClose;
    controls.classList.toggle(
      "redditp__controls--collapsed",
      state.settings.controlsCollapsed,
    );
    collapseButton.textContent = state.settings.controlsCollapsed ? "+" : "−";
    collapseButton.setAttribute(
      "aria-label",
      state.settings.controlsCollapsed
        ? "Expand bottom controls"
        : "Collapse bottom controls",
    );
    count.textContent = hasSlides
      ? `${state.index + 1} / ${state.slides.length}${
          state.loadingMore && state.index === state.slides.length - 1
            ? " · loading more"
            : ""
        }`
      : "0 posts";
    if (!hasSlides) return;

    const slide = state.slides[state.index];
    // Revisiting a slide retries its media, so a past failure must not keep
    // forcing the timer path.
    slide.mediaFailed = false;
    title.textContent = slide.title;
    const galleryLabel = slide.galleryItem
      ? `gallery ${slide.galleryItem}/${slide.galleryTotal}`
      : "";
    const metaItems = [];
    if (slide.community) {
      const communityLink = element("a", "redditp__meta-link", slide.community);
      communityLink.href = redditPageUrl(slide.community, "community");
      communityLink.addEventListener("click", navigateToPresentation);
      metaItems.push(communityLink);
    }
    if (galleryLabel) metaItems.push(document.createTextNode(galleryLabel));
    if (slide.author) {
      const authorLink = element("a", "redditp__meta-link", slide.author);
      authorLink.href = redditPageUrl(slide.author, "user");
      authorLink.addEventListener("click", navigateToPresentation);
      metaItems.push(authorLink);
    }
    meta.replaceChildren();
    metaItems.forEach((item, index) => {
      if (index) meta.append(document.createTextNode(" · "));
      meta.append(item);
    });
    const sourceHref = slide.url || slide.sourceUrl || slide.commentsUrl;
    sourceLink.hidden = !sourceHref;
    if (sourceHref) sourceLink.href = sourceHref;
    commentsLink.hidden = !slide.commentsUrl;
    if (slide.commentsUrl) commentsLink.href = slide.commentsUrl;

    if (slide.kind === "image") {
      const img = element("img", "redditp__image", "");
      img.alt = slide.title;
      img.addEventListener("load", () => expandLargeImage(img), { once: true });
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
      video.muted = !state.sound;
      video.loop = !state.autoPlaying;
      video.preload = "metadata";
      video.addEventListener("ended", () => {
        if (state.autoPlaying) move(1);
      });
      video.addEventListener("error", () => showMediaFailure(video, slide), {
        once: true,
      });
      mediaBox.append(video);
      video.play().catch(() => {});
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
      video.muted = !state.sound;
      video.loop = !state.autoPlaying;
      video.addEventListener("ended", endedHandler);
      mediaBox.append(video);
      video.play().catch(() => {});
    } else if (slide.kind === "embed") {
      const iframe = element("iframe", "redditp__embed", "");
      iframe.src = slide.url;
      iframe.title = slide.title;
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      mediaBox.append(iframe);
    } else {
      mediaBox.append(linkCard(slide, false));
    }
    scheduleAuto();
    void enrichSlide(slide);
    void upgradePendingAdaptiveSlide(slide);
    if (!isSinglePostPage() && state.index === state.slides.length - 1) {
      void loadMoreAtEnd(false);
    }
  }

  function move(delta) {
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
        count.textContent = `${state.index + 1} / ${state.slides.length} · loading more`;
        return;
      }
      if (delta < 0) {
        state.loadRequest += 1;
        state.loadingMore = false;
        state.advanceAfterLoad = false;
        document.documentElement.style.overflow = "hidden";
      } else {
        return;
      }
    }
    if (delta > 0 && state.index === state.slides.length - 1) {
      void loadMoreAtEnd(true);
      return;
    }
    state.index += delta;
    render();
  }

  function postIdentity(slide) {
    if (slide.postKey) return `post:${slide.postKey}`;
    if (slide.commentsUrl) return `comments:${slide.commentsUrl}`;
    return `fallback:${slide.title}|${slide.sourceUrl}`;
  }

  function appendNewPosts() {
    const existingPosts = new Set(state.slides.map(postIdentity));
    const additions = extractSlides().filter(
      (slide) => !existingPosts.has(postIdentity(slide)),
    );
    if (additions.length) state.slides.push(...additions);
    return additions.length;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function loadMoreAtEnd(advanceWhenReady) {
    if (isSinglePostPage()) return;
    if (state.loadingMore) {
      if (advanceWhenReady) {
        state.advanceAfterLoad = true;
        count.textContent = `${state.index + 1} / ${state.slides.length} · loading more`;
      }
      return;
    }
    if (!state.open || state.index !== state.slides.length - 1) return;
    state.loadingMore = true;
    state.advanceAfterLoad = Boolean(advanceWhenReady);
    const request = ++state.loadRequest;
    count.textContent = `${state.index + 1} / ${state.slides.length} · loading more`;

    let added = appendNewPosts();
    try {
      if (!added) {
        document.documentElement.style.overflow = state.oldOverflow;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const scrollingElement = document.scrollingElement;
          window.scrollTo(0, scrollingElement?.scrollHeight || 0);
          await wait(200);
          if (!state.open || request !== state.loadRequest) return;
          added = appendNewPosts();
          if (added) break;
        }
      }
    } finally {
      if (state.open && request === state.loadRequest) {
        document.documentElement.style.overflow = "hidden";
        state.loadingMore = false;
      }
    }

    if (!state.open || request !== state.loadRequest) return;
    const shouldAdvance = state.advanceAfterLoad;
    state.advanceAfterLoad = false;
    if (added && shouldAdvance) {
      state.index += 1;
      render();
    } else if (!added && shouldAdvance) {
      state.index = 0;
      render();
    } else {
      count.textContent = `${state.index + 1} / ${state.slides.length}`;
    }
  }

  function scheduleAuto() {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    if (state.autoPlaying && state.open && state.slides.length > 1) {
      state.autoTimer = setTimeout(
        () => move(1),
        state.settings.slideDurationSeconds * 1000,
      );
    }
  }

  function syncSettingsUi() {
    durationInput.value = String(state.settings.slideDurationSeconds);
    Object.keys(settingCheckboxes).forEach((key) => {
      settingCheckboxes[key].checked = state.settings[key];
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
    (state.settings.controlsCollapsed ? collapseButton : settingsButton).focus({
      preventScroll: true,
    });
  }

  function updateSetting(key, value) {
    state.settings[key] = value;
    saveSettings();
    render();
  }

  function toggleAuto() {
    state.autoPlaying = !state.autoPlaying;
    autoButton.textContent = state.autoPlaying ? "pause" : "auto";
    autoButton.setAttribute("aria-pressed", String(state.autoPlaying));
    const video = mediaBox.querySelector("video");
    if (video) video.loop = !state.autoPlaying;
    scheduleAuto();
  }

  function toggleSound() {
    state.sound = !state.sound;
    soundButton.textContent = state.sound ? "sound on" : "sound off";
    soundButton.setAttribute("aria-pressed", String(state.sound));
    const video = mediaBox.querySelector("video");
    if (video) video.muted = !state.sound;
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
    state.open = false;
    state.opening = false;
    state.autoPlaying = false;
    state.loadingMore = false;
    state.advanceAfterLoad = false;
    state.loadRequest += 1;
    state.openRequest += 1;
    state.settingsOpen = false;
    settingsOverlay.hidden = true;
    clearTimeout(state.autoTimer);
    autoButton.textContent = "auto";
    stopMedia();
    root.hidden = true;
    document.documentElement.style.overflow = state.oldOverflow;
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function retire() {
    close();
    root.remove();
    document.removeEventListener("redditp:presentation-retire", retire);
  }

  async function open() {
    if (state.open || state.opening) return;
    const request = ++state.openRequest;
    state.opening = true;
    await loadSettings();
    if (request !== state.openRequest) {
      state.opening = false;
      return;
    }
    state.opening = false;
    state.oldOverflow = document.documentElement.style.overflow;
    state.open = true;
    root.hidden = false;
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
    // Slides are rebuilt from the live page on every open, so the previous
    // run's enrichment results no longer refer to anything. Keeping them would
    // make enrichSlide skip every thumbnail it had already upgraded once.
    state.enrichments.clear();
    state.slides = [];
    emptyTitle.textContent = "Preparing Reddit video…";
    emptyText.textContent = "Waiting for Reddit's full-quality player.";
    render();
    await waitForAdaptivePlayer(request);
    if (!state.open || request !== state.openRequest) return;
    emptyTitle.textContent = "No posts found on this page";
    emptyText.textContent =
      "Scroll Reddit to load some posts, then try presentation mode again.";
    state.slides = extractSlides();
    state.index = Math.min(state.index, Math.max(0, state.slides.length - 1));
    render();
    const initialFocus = closeButton.hidden
      ? state.settings.controlsCollapsed
        ? collapseButton
        : settingsButton
      : closeButton;
    initialFocus.focus({ preventScroll: true });
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
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key.toLowerCase() === "f" && document.fullscreenEnabled) {
      event.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen().catch(() => {});
    } else if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      toggleSound();
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
    updateSetting("controlsCollapsed", !state.settings.controlsCollapsed);
  });
  mediaBox.addEventListener("click", toggleVideoFromSurface, true);
  document.addEventListener("redditp:presentation-retire", retire);
  prevButton.addEventListener("click", () => move(-1));
  nextButton.addEventListener("click", () => move(1));
  autoButton.addEventListener("click", toggleAuto);
  soundButton.addEventListener("click", toggleSound);
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
  };
  open();
})();
