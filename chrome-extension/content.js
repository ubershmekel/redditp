(function redditpContentScript() {
  "use strict";

  if (window.__redditpPresentation) {
    window.__redditpPresentation.toggle();
    return;
  }

  const SPECIFIC_POST_SELECTOR = [
    "shreddit-post",
    ".thing.link",
    ".search-result.search-result-link",
    "[data-id='search-media-post-unit']",
    "[data-testid='search-post-unit']",
    "[data-testid='post-container']",
  ].join(",");
  const POST_SELECTOR = `${SPECIFIC_POST_SELECTOR},article`;
  const IMAGE_URL_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
  const VIDEO_URL_RE = /\.(?:m3u8|mp4|webm)(?:$|[?#])/i;
  const state = {
    open: false,
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
    if (hostname === "youtu.be" || hostname.endsWith("youtube.com")) {
      const id =
        hostname === "youtu.be"
          ? parsed.pathname.slice(1)
          : parsed.searchParams.get("v");
      if (id && /^[\w-]+$/.test(id)) {
        return { kind: "embed", url: `https://www.youtube.com/embed/${id}` };
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
      const sourceUrl = source.getAttribute("src");
      if (isVideoUrl(sourceUrl)) add("video", sourceUrl);
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
      const media = externalMedia(iframe.getAttribute("src"));
      if (media) add(media.kind, media.url);
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
        node.matches(
          "[data-testid='search-post-unit'], .search-result.search-result-link",
        ) &&
        Boolean(comments) &&
        media.length <= 1 &&
        Boolean(
          node.querySelector(
            "faceplate-img[data-testid='search_post_thumbnail']",
          ) || media[0]?.kind === "link",
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
  const prevButton = element("button", "redditp__arrow redditp__prev", "");
  prevButton.setAttribute("aria-label", "Previous slide");
  const autoButton = element("button", "redditp__button", "auto");
  const soundButton = element("button", "redditp__button", "sound off");
  const nextButton = element("button", "redditp__arrow redditp__next", "");
  nextButton.setAttribute("aria-label", "Next slide");
  const sourceLink = element("a", "redditp__button", "media");
  const commentsLink = element("a", "redditp__button", "comments");
  const brand = element("span", "redditp__brand", "redditp");
  prevButton.type =
    autoButton.type =
    soundButton.type =
    nextButton.type =
      "button";
  sourceLink.target = commentsLink.target = "_blank";
  sourceLink.rel = commentsLink.rel = "noopener noreferrer";
  controls.append(
    brand,
    commentsLink,
    sourceLink,
    autoButton,
    soundButton,
    count,
  );
  root.append(stage, prevButton, nextButton, details, controls, closeButton);

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
    }
  }

  function render() {
    stopMedia();
    const hasSlides = state.slides.length > 0;
    empty.hidden = hasSlides;
    details.hidden = controls.hidden = !hasSlides;
    count.textContent = hasSlides
      ? `${state.index + 1} / ${state.slides.length}${
          state.loadingMore && state.index === state.slides.length - 1
            ? " · loading more"
            : ""
        }`
      : "0 posts";
    if (!hasSlides) return;

    const slide = state.slides[state.index];
    title.textContent = slide.title;
    const galleryLabel = slide.galleryItem
      ? `gallery ${slide.galleryItem}/${slide.galleryTotal}`
      : "";
    meta.textContent = [slide.community, galleryLabel, slide.author]
      .filter(Boolean)
      .join(" · ");
    const sourceHref = slide.url || slide.sourceUrl || slide.commentsUrl;
    sourceLink.hidden = !sourceHref;
    if (sourceHref) sourceLink.href = sourceHref;
    commentsLink.hidden = !slide.commentsUrl;
    if (slide.commentsUrl) commentsLink.href = slide.commentsUrl;

    if (slide.kind === "image") {
      const img = element("img", "redditp__image", "");
      img.alt = slide.title;
      img.src = slide.url;
      img.addEventListener("error", () => showMediaFailure(img, slide), {
        once: true,
      });
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
    } else if (slide.kind === "native-video" && slide.nativeElement) {
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
      iframe.allow = "autoplay; fullscreen; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = "no-referrer";
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
    state.index =
      (state.index + delta + state.slides.length) % state.slides.length;
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
    const slide = state.slides[state.index];
    if (
      state.autoPlaying &&
      state.open &&
      state.slides.length > 1 &&
      slide?.kind !== "video" &&
      slide?.kind !== "pending-native-video" &&
      slide?.kind !== "native-video"
    ) {
      state.autoTimer = setTimeout(() => move(1), 6000);
    }
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

  function close() {
    if (!state.open) return;
    state.open = false;
    state.autoPlaying = false;
    state.loadingMore = false;
    state.advanceAfterLoad = false;
    state.loadRequest += 1;
    state.openRequest += 1;
    clearTimeout(state.autoTimer);
    autoButton.textContent = "auto";
    stopMedia();
    root.hidden = true;
    document.documentElement.style.overflow = state.oldOverflow;
    document.removeEventListener("keydown", onKeyDown, true);
  }

  async function open() {
    const request = ++state.openRequest;
    state.oldOverflow = document.documentElement.style.overflow;
    state.open = true;
    root.hidden = false;
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
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
    closeButton.focus({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (!state.open) return;
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
  mediaBox.addEventListener("click", toggleVideoFromSurface, true);
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
      if (state.open) close();
      else open();
    },
  };
  open();
})();
