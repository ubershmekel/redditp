(function redditpContentScript() {
  "use strict";

  if (window.__redditpPresentation) {
    window.__redditpPresentation.toggle();
    return;
  }

  const POST_SELECTORS = [
    "shreddit-post",
    ".thing.link",
    "[data-testid='post-container']",
    "article",
  ];
  const IMAGE_URL_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
  const VIDEO_URL_RE = /\.(?:m3u8|mp4|webm)(?:$|[?#])/i;
  const state = {
    open: false,
    slides: [],
    index: 0,
    autoTimer: null,
    autoPlaying: false,
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

  function usefulImage(img) {
    if (!img || img.closest("[aria-hidden='true']")) return false;
    const description = `${img.alt || ""} ${img.className || ""}`.toLowerCase();
    if (/avatar|award|emoji|icon|snoo/.test(description)) return false;
    const width = Number(img.getAttribute("width")) || img.naturalWidth || 0;
    const height = Number(img.getAttribute("height")) || img.naturalHeight || 0;
    return !(width && height && width <= 96 && height <= 96);
  }

  function imageUrl(img) {
    const raw =
      bestSrcFromSet(img.getAttribute("srcset")) ||
      img.currentSrc ||
      img.getAttribute("src") ||
      img.getAttribute("data-lazy-src");
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
    return (
      textOf(node.querySelector("[slot='title']")) ||
      textOf(node.querySelector("a.title")) ||
      textOf(node.querySelector("h1, h2, h3")) ||
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
    const community = textOf(
      node.querySelector(
        "a.subreddit, a[href^='/r/'], a[href*='reddit.com/r/']",
      ),
    );
    return community.startsWith("r/") ? community : "";
  }

  function contentUrl(node, fallbackCommentsUrl) {
    const attributeNames = ["content-href", "data-url", "url", "data-href-url"];
    for (const name of attributeNames) {
      const result = absoluteUrl(node.getAttribute(name));
      if (result && result !== fallbackCommentsUrl) return result;
    }
    const result = firstHref(node, [
      "a[data-click-id='body']",
      "a[data-click-id='media']",
      "a.thumbnail",
      "a.title",
      "a[href*='i.redd.it']",
      "a[href*='v.redd.it']",
    ]);
    return result || fallbackCommentsUrl;
  }

  function mediaFromNode(node, sourceUrl) {
    const media = [];
    const seen = new Set();
    function add(kind, url, poster) {
      const normalized = absoluteUrl(url);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      media.push({ kind, url: normalized, poster: absoluteUrl(poster) });
    }

    if (IMAGE_URL_RE.test(sourceUrl)) {
      // Prefer the post's original image over a second, lower-resolution
      // preview of the same image found inside the listing card.
      add("image", sourceUrl);
    } else {
      node.querySelectorAll("img").forEach((img) => {
        if (usefulImage(img)) add("image", imageUrl(img));
      });
    }

    if (VIDEO_URL_RE.test(sourceUrl)) add("video", sourceUrl);
    node.querySelectorAll("video").forEach((video) => {
      const source =
        video.currentSrc ||
        video.getAttribute("src") ||
        (video.querySelector("source") &&
          video.querySelector("source").getAttribute("src"));
      add("video", source, video.getAttribute("poster"));
    });
    return media;
  }

  function selectPostNodes() {
    for (const selector of POST_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length) return nodes;
    }

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
    selectPostNodes().forEach((node) => {
      if (node.closest("#redditp-presentation")) return;
      const comments = commentsUrl(node);
      const source = contentUrl(node, comments);
      const base = {
        title: postTitle(node),
        author: postAuthor(node),
        community: postCommunity(node),
        commentsUrl: comments,
        sourceUrl: source,
      };
      const media = mediaFromNode(node, source);
      if (!media.length)
        media.push({ kind: "link", url: source || comments, poster: "" });
      media.forEach((item) => {
        const key = `${comments || base.title}|${item.url}`;
        if (!seenPostMedia.has(key)) {
          seenPostMedia.add(key);
          slides.push(Object.assign({}, base, item));
        }
      });
    });
    return slides;
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

  const header = element("header", "redditp__header", "");
  const brand = element("div", "redditp__brand", "redditp");
  const count = element("div", "redditp__count", "");
  const closeButton = element(
    "button",
    "redditp__button redditp__close",
    "Close",
  );
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close presentation mode");
  header.append(brand, count, closeButton);

  const details = element("div", "redditp__details", "");
  const title = element("h1", "redditp__title", "");
  const meta = element("div", "redditp__meta", "");
  details.append(title, meta);

  const controls = element("nav", "redditp__controls", "");
  controls.setAttribute("aria-label", "Slideshow controls");
  const prevButton = element(
    "button",
    "redditp__button redditp__primary",
    "← Previous",
  );
  const autoButton = element("button", "redditp__button", "▶ Auto");
  const nextButton = element(
    "button",
    "redditp__button redditp__primary",
    "Next →",
  );
  const sourceLink = element("a", "redditp__button", "Open media");
  const commentsLink = element("a", "redditp__button", "Comments");
  prevButton.type = autoButton.type = nextButton.type = "button";
  sourceLink.target = commentsLink.target = "_blank";
  sourceLink.rel = commentsLink.rel = "noopener noreferrer";
  controls.append(prevButton, autoButton, nextButton, sourceLink, commentsLink);
  root.append(header, stage, details, controls);

  function stopMedia() {
    mediaBox.querySelectorAll("video").forEach((video) => video.pause());
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

  function render() {
    stopMedia();
    const hasSlides = state.slides.length > 0;
    empty.hidden = hasSlides;
    details.hidden = controls.hidden = !hasSlides;
    count.textContent = hasSlides
      ? `${state.index + 1} / ${state.slides.length}`
      : "0 posts";
    if (!hasSlides) return;

    const slide = state.slides[state.index];
    title.textContent = slide.title;
    meta.textContent = [slide.community, slide.author]
      .filter(Boolean)
      .join(" · ");
    const sourceHref = slide.sourceUrl || slide.url || slide.commentsUrl;
    sourceLink.hidden = !sourceHref;
    if (sourceHref) sourceLink.href = sourceHref;
    commentsLink.hidden = !slide.commentsUrl;
    if (slide.commentsUrl) commentsLink.href = slide.commentsUrl;

    if (slide.kind === "image") {
      const img = element("img", "redditp__image", "");
      img.alt = slide.title;
      img.src = slide.url;
      img.addEventListener(
        "error",
        () => mediaBox.replaceChildren(linkCard(slide, true)),
        { once: true },
      );
      mediaBox.append(img);
    } else if (slide.kind === "video") {
      const video = element("video", "redditp__video", "");
      video.src = slide.url;
      video.poster = slide.poster || "";
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.addEventListener(
        "error",
        () => mediaBox.replaceChildren(linkCard(slide, true)),
        { once: true },
      );
      mediaBox.append(video);
    } else {
      mediaBox.append(linkCard(slide, false));
    }
    scheduleAuto();
  }

  function move(delta) {
    if (!state.slides.length) return;
    state.index =
      (state.index + delta + state.slides.length) % state.slides.length;
    render();
  }

  function scheduleAuto() {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    if (state.autoPlaying && state.open && state.slides.length > 1) {
      state.autoTimer = setTimeout(() => move(1), 6000);
    }
  }

  function toggleAuto() {
    state.autoPlaying = !state.autoPlaying;
    autoButton.textContent = state.autoPlaying ? "❚❚ Pause" : "▶ Auto";
    autoButton.setAttribute("aria-pressed", String(state.autoPlaying));
    scheduleAuto();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    state.autoPlaying = false;
    clearTimeout(state.autoTimer);
    autoButton.textContent = "▶ Auto";
    stopMedia();
    root.hidden = true;
    document.documentElement.style.overflow = state.oldOverflow;
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function open() {
    state.slides = extractSlides();
    state.index = Math.min(state.index, Math.max(0, state.slides.length - 1));
    state.oldOverflow = document.documentElement.style.overflow;
    state.open = true;
    root.hidden = false;
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
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
    }
  }

  closeButton.addEventListener("click", close);
  prevButton.addEventListener("click", () => move(-1));
  nextButton.addEventListener("click", () => move(1));
  autoButton.addEventListener("click", toggleAuto);
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
