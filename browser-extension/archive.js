// The archive page: a subreddit's whole history, pulled from the Arctic Shift
// archive into IndexedDB and browsed in the presentation viewer, ranked by
// score. archive.html loads content.js first, which builds the viewer and
// waits, then this script, which hands the viewer a source of posts. It
// never uses the extension's own APIs, so the page works as an extension
// page, opened from disk, or served from any https origin.
(function redditpArchive() {
  "use strict";

  // archive-media:start
  // How a stored post becomes the viewer's slides. The media rules read
  // every URL through the record rules below, so those sit inside this
  // block. Like every block in this file, it stays DOM-free and
  // self-contained, so nodejs/test-embedit.js can evaluate it on its own;
  // the viewer's own URL rules (window.__redditpPresentation.media) come in
  // as the `urls` parameter.

  // archive-records:start
  // The copy of a post that the archive stores: Reddit's own field names,
  // only the fields that the viewer and the ranking read, every URL decoded,
  // and nothing at all for a removed post. It stays DOM-free, so
  // nodejs/test-embedit.js can evaluate it on its own.
  const REDDIT_ORIGIN = "https://www.reddit.com";
  // A self post's text is cut to this many characters.
  const BODY_LIMIT = 1000;

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // A number, or a numeric string as older dumps store them; anything else
  // is NaN.
  function numberOf(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) return Number(value);
    return NaN;
  }

  // Reddit's listings escape <, >, ", ' and & in text. &amp; goes last, so
  // an escaped entity such as "&amp;lt;" becomes "&lt;" and no more.
  function decodeEntities(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;/g, "'")
      .replace(/&amp;/g, "&");
  }

  // Older records escape the & in their URLs as &amp;.
  function decodeUrl(value) {
    return typeof value === "string" ? value.replace(/&amp;/g, "&") : "";
  }

  // An absolute http(s) URL, with Reddit's own paths made absolute, or ""
  // for anything else, such as a javascript: URL.
  function safeUrl(value) {
    const decoded = decodeUrl(value).trim();
    if (!decoded) return "";
    try {
      const url = new URL(decoded, REDDIT_ORIGIN);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : "";
    } catch (_error) {
      return "";
    }
  }

  // The key an archive is stored under: the subreddit's name in lowercase,
  // from "Pics", "r/Pics" or "/r/Pics/", or "" when it is not a name.
  function subKey(name) {
    if (typeof name !== "string") return "";
    const key = name
      .trim()
      .replace(/^\/?r\//i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    return /^[a-z0-9_]{2,21}$/.test(key) ? key : "";
  }

  function redditVideo(post) {
    const video = post.media?.reddit_video || post.secure_media?.reddit_video;
    return isObject(video) ? video : null;
  }

  function sizeOf(value) {
    const number = numberOf(value);
    return Number.isFinite(number) ? number : 0;
  }

  // What a post shows: its link, its Reddit video, its preview picture and
  // its gallery, with the gallery's pictures in their largest size only.
  // A crosspost keeps the same fields of its original post.
  function trimMedia(post) {
    const media = {
      is_video: post.is_video === true,
      is_gallery: post.is_gallery === true,
      post_hint: typeof post.post_hint === "string" ? post.post_hint : "",
      domain: typeof post.domain === "string" ? post.domain : "",
      url: decodeUrl(post.url_overridden_by_dest || post.url),
      media: null,
    };
    const video = redditVideo(post);
    if (video) {
      media.media = {
        reddit_video: {
          fallback_url: decodeUrl(video.fallback_url),
          width: sizeOf(video.width),
          height: sizeOf(video.height),
          is_gif: video.is_gif === true,
          duration: sizeOf(video.duration),
        },
      };
    }
    const source = post.preview?.images?.[0]?.source;
    if (isObject(source) && typeof source.url === "string") {
      media.preview = {
        images: [
          {
            source: {
              url: decodeUrl(source.url),
              width: sizeOf(source.width),
              height: sizeOf(source.height),
            },
          },
        ],
      };
    }
    if (Array.isArray(post.gallery_data?.items)) {
      media.gallery_data = {
        items: post.gallery_data.items
          .filter(isObject)
          .map((item) => ({ media_id: String(item.media_id) })),
      };
    }
    if (isObject(post.media_metadata)) {
      media.media_metadata = {};
      Object.keys(post.media_metadata).forEach((id) => {
        const entry = post.media_metadata[id];
        if (!isObject(entry)) return;
        const kept = {};
        ["status", "e", "m"].forEach((key) => {
          if (typeof entry[key] === "string") kept[key] = entry[key];
        });
        if (isObject(entry.s)) {
          kept.s = {};
          ["u", "gif", "mp4"].forEach((key) => {
            if (typeof entry.s[key] === "string") {
              kept.s[key] = decodeUrl(entry.s[key]);
            }
          });
          ["x", "y"].forEach((key) => {
            if (Number.isFinite(entry.s[key])) kept.s[key] = entry.s[key];
          });
        }
        media.media_metadata[id] = kept;
      });
    }
    return media;
  }

  // The stored record of an archived post, or null for anything that is not
  // a post, has no id or date, or was removed. `sub` is the archive's key,
  // whatever the post's own spelling of its subreddit. IndexedDB leaves a
  // record out of an index when its key is not valid, so created_utc and
  // score are always numbers.
  function trimPost(raw, sub) {
    if (!isObject(raw)) return null;
    const id = typeof raw.id === "string" ? raw.id.replace(/^t3_/, "") : "";
    if (!/^[a-z0-9]+$/i.test(id)) return null;
    if (raw.removed_by_category != null && raw.removed_by_category !== "") {
      return null;
    }
    const created = Math.floor(numberOf(raw.created_utc));
    if (!Number.isFinite(created)) return null;
    const score = Math.trunc(numberOf(raw.score));
    const isSelf = raw.is_self === true;
    const record = {
      sub,
      id,
      name: `t3_${id}`,
      subreddit: typeof raw.subreddit === "string" ? raw.subreddit : "",
      created_utc: created,
      score: Number.isFinite(score) ? score : 0,
      title: decodeEntities(raw.title),
      author: typeof raw.author === "string" ? raw.author : "",
      permalink: safeUrl(raw.permalink) || `${REDDIT_ORIGIN}/comments/${id}/`,
      is_self: isSelf,
      selftext: isSelf ? decodeEntities(raw.selftext).slice(0, BODY_LIMIT) : "",
      over_18: raw.over_18 === true,
      ...trimMedia(raw),
    };
    const parent = Array.isArray(raw.crosspost_parent_list)
      ? raw.crosspost_parent_list[0]
      : null;
    if (
      isObject(parent) &&
      !redditVideo(raw) &&
      !isObject(raw.media_metadata)
    ) {
      record.crosspost_parent_list = [trimMedia(parent)];
    }
    return record;
  }
  // archive-records:end

  function hasOwnMedia(post) {
    return Boolean(redditVideo(post) || isObject(post.media_metadata));
  }

  // The post whose media a post shows: its own, or a crosspost's original
  // when only the original has a Reddit video or a gallery.
  function mediaSource(post) {
    const parent = Array.isArray(post.crosspost_parent_list)
      ? post.crosspost_parent_list[0]
      : null;
    return !hasOwnMedia(post) && isObject(parent) && hasOwnMedia(parent)
      ? parent
      : post;
  }

  function previewPicture(post) {
    return safeUrl(post?.preview?.images?.[0]?.source?.url);
  }

  // A gallery's pictures and animations in the gallery's order, numbered
  // n of N. Items that failed to process are left out, and so are videos,
  // for which the metadata names no file.
  function galleryMedia(source) {
    const metadata = source.media_metadata;
    const ids = Array.isArray(source.gallery_data?.items)
      ? source.gallery_data.items.map((item) => String(item?.media_id))
      : Object.keys(metadata);
    const items = [];
    ids.forEach((id) => {
      if (!Object.prototype.hasOwnProperty.call(metadata, id)) return;
      const entry = metadata[id];
      if (!isObject(entry) || (entry.status && entry.status !== "valid")) {
        return;
      }
      const size = isObject(entry.s) ? entry.s : {};
      let item = null;
      if (entry.e === "Image") {
        item = { kind: "image", url: safeUrl(size.u), fromGif: false };
      } else if (entry.e === "AnimatedImage") {
        // An animation plays as its MP4 where it has one.
        item = safeUrl(size.mp4)
          ? { kind: "video", url: safeUrl(size.mp4), fromGif: true }
          : { kind: "image", url: safeUrl(size.gif), fromGif: true };
      }
      if (item?.url) items.push({ ...item, poster: "", postMedia: true });
    });
    return items.map((item, index) => ({
      ...item,
      galleryItem: index + 1,
      galleryTotal: items.length,
    }));
  }

  // What a post shows, as one or more media items: a gallery's pictures, a
  // Reddit video's silent MP4, a picture, video or player that its link
  // leads to, the preview picture of a link, or the link itself. The first
  // rule that finds something wins, so the result is never empty.
  function mediaFromPost(post, urls) {
    const source = mediaSource(post);
    if (
      isObject(source.media_metadata) &&
      (source.is_gallery || source.gallery_data)
    ) {
      const items = galleryMedia(source);
      if (items.length) return items;
    }
    const video = redditVideo(source);
    const fallback = safeUrl(video?.fallback_url);
    if (fallback) {
      return [
        {
          kind: "video",
          url: fallback,
          poster: previewPicture(source) || previewPicture(post),
          postMedia: true,
          fromGif: video.is_gif === true,
        },
      ];
    }
    const url = safeUrl(post.url_overridden_by_dest || post.url);
    const preview = previewPicture(post);
    const external = url ? urls.externalMedia(url) : null;
    if (external) {
      return [
        {
          kind: external.kind,
          url: external.url,
          poster: external.kind === "video" ? preview : "",
          postMedia: true,
          fromGif: Boolean(external.fromGif),
        },
      ];
    }
    if (url && urls.IMAGE_URL_RE.test(url)) {
      return [
        { kind: "image", url, poster: "", postMedia: true, fromGif: false },
      ];
    }
    if (url && urls.isVideoUrl(url)) {
      return [
        {
          kind: "video",
          url,
          poster: preview,
          postMedia: true,
          fromGif: false,
        },
      ];
    }
    // A link's preview picture is not the post's own media, so any Show
    // filter hides it.
    if (!post.is_self && preview) {
      return [
        {
          kind: "image",
          url: preview,
          poster: "",
          postMedia: false,
          fromGif: false,
        },
      ];
    }
    return [
      {
        kind: "link",
        url:
          url ||
          safeUrl(post.permalink) ||
          `${REDDIT_ORIGIN}/comments/${post.id}/`,
        poster: "",
        postMedia: false,
        fromGif: false,
      },
    ];
  }

  // The viewer's slides for a post, one per media item, and how many items
  // were left out because they are known to fail (deadKeys holds their
  // media keys). A gallery's slides keep their n/N numbering when some are
  // left out. Every slide carries `archive`, which the viewer passes back
  // untouched.
  function postSlides(post, urls, deadKeys) {
    const permalink =
      safeUrl(post.permalink) || `${REDDIT_ORIGIN}/comments/${post.id}/`;
    const url = safeUrl(post.url_overridden_by_dest || post.url);
    const author =
      typeof post.author === "string" &&
      post.author &&
      post.author !== "[deleted]"
        ? `u/${post.author}`
        : "";
    const slides = [];
    let unavailable = 0;
    mediaFromPost(post, urls).forEach((item) => {
      if (deadKeys && deadKeys.has(urls.canonicalMediaKey(item.url))) {
        unavailable += 1;
        return;
      }
      slides.push({
        kind: item.kind,
        url: item.url,
        poster: item.poster,
        postMedia: item.postMedia,
        fromGif: item.fromGif,
        galleryItem: item.galleryItem || 0,
        galleryTotal: item.galleryTotal || 0,
        title: post.title || "Reddit post",
        body:
          post.is_self && typeof post.selftext === "string"
            ? post.selftext
            : "",
        author,
        community: post.subreddit ? `r/${post.subreddit}` : "",
        commentsUrl: permalink,
        sourceUrl: url || permalink,
        postKey: `t3_${post.id}`,
        archive: { id: post.id, created: post.created_utc, score: post.score },
      });
    });
    return { slides, unavailable };
  }
  // archive-media:end

  // archive-ranking:start
  // Which stored posts show, and in what order. Like the blocks above, this
  // stays DOM-free, so nodejs/test-embedit.js can evaluate it on its own.
  // Times are in seconds, and a range's end is exclusive. The archive is
  // browsed in windows of about WINDOW_SIZE posts, newest first, each ranked
  // by score. A window is not stored anywhere: it is the newest WINDOW_SIZE
  // posts below its end, extended to a whole second, so it reads the same
  // however the pull went.
  const WINDOW_SIZE = 5000;
  const DAY_SECONDS = 86400;
  // Arctic Shift takes a post's score about 36 hours after it is posted, and
  // younger posts read 1, so posts younger than this are left out of every
  // ranking.
  const SCORE_BLIND_SECONDS = 2 * DAY_SECONDS;
  // A refresh pulls again the posts this far below the newest one, so their
  // scores mature.
  const REFRESH_OVERLAP_SECONDS = 2 * DAY_SECONDS;
  const RANGE_PRESETS = ["all", "year", "month", "custom"];

  // "YYYY-MM-DD" when it names a real day, otherwise "".
  function dayText(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      typeof value === "string" ? value : "",
    );
    if (!match) return "";
    const date = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
    return date.getUTCFullYear() === Number(match[1]) &&
      date.getUTCMonth() === Number(match[2]) - 1 &&
      date.getUTCDate() === Number(match[3])
      ? value
      : "";
  }

  // 00:00 UTC of a "YYYY-MM-DD" day, in seconds, or NaN.
  function daySeconds(value) {
    const day = dayText(value);
    return day ? Date.parse(`${day}T00:00:00Z`) / 1000 : NaN;
  }

  // A stored or chosen view with every field valid: the order ("windows"
  // or "top"), the date range and the minimum score.
  function normalView(view) {
    const range =
      view?.range && typeof view.range === "object" ? view.range : {};
    const minScore = Number(view?.minScore);
    return {
      mode: view?.mode === "top" ? "top" : "windows",
      range: {
        preset: RANGE_PRESETS.includes(range.preset) ? range.preset : "all",
        from: dayText(range.from),
        to: dayText(range.to),
      },
      minScore:
        Number.isFinite(minScore) && minScore > 0 ? Math.floor(minScore) : 0,
    };
  }

  // The seconds a date range covers, as { start, end } with end exclusive
  // and Infinity for no end. The past year is 365 days and the past month
  // 30; a custom range runs from 00:00 UTC of its first day to the end of
  // its last, either end may be left open, and a reversed range covers
  // everything.
  function rangeBounds(range, nowSec) {
    const preset = range?.preset;
    if (preset === "year") {
      return { start: nowSec - 365 * DAY_SECONDS, end: Infinity };
    }
    if (preset === "month") {
      return { start: nowSec - 30 * DAY_SECONDS, end: Infinity };
    }
    if (preset === "custom") {
      const from = daySeconds(range.from);
      const to = daySeconds(range.to);
      const start = Number.isFinite(from) ? from : 0;
      const end = Number.isFinite(to) ? to + DAY_SECONDS : Infinity;
      if (start < end) return { start, end };
    }
    return { start: 0, end: Infinity };
  }

  // Names a view, so a resume position is used only in the view it was
  // saved in: "windows|all|||0", "top|custom|2020-01-01|2020-12-31|100".
  function viewKey(view) {
    const normal = normalView(view);
    const custom = normal.range.preset === "custom";
    return [
      normal.mode,
      normal.range.preset,
      custom ? normal.range.from : "",
      custom ? normal.range.to : "",
      normal.minScore,
    ].join("|");
  }

  // The ids of the entries ({ id, created, score }) that rank, best first:
  // by score, then newest first, then by id. Posts younger than
  // SCORE_BLIND_SECONDS and posts below the minimum score are left out.
  function rankEntries(entries, { nowSec, minScore }) {
    const latest = nowSec - SCORE_BLIND_SECONDS;
    const floor = Number.isFinite(minScore) ? minScore : 0;
    return entries
      .filter((entry) => entry.created <= latest && entry.score >= floor)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.created - a.created ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map((entry) => entry.id);
  }

  // A window from entries read newest first: at least `size` of them, then
  // any more from the same second as the last one taken, so that a window
  // always ends on a whole second. `start` is that last second, which is
  // where the next window ends, and `full` says whether `size` were found.
  function cutWindow(entriesDesc, size) {
    const taken = [];
    for (const entry of entriesDesc) {
      if (
        taken.length >= size &&
        entry.created !== taken[taken.length - 1].created
      ) {
        break;
      }
      taken.push(entry);
    }
    return {
      taken,
      start: taken.length ? taken[taken.length - 1].created : 0,
      full: taken.length >= size,
    };
  }

  // Where the pull goes after a page whose oldest post is oldestSec. The
  // API's `before` is exclusive and a page can end partway through a second,
  // so the next page asks for that second again, and everything from the
  // second after it is known to be stored (`bottom`). Only a page that is
  // all one second cannot move that way; it then moves past that second.
  function advanceCursor(cursorMs, oldestSec) {
    const next = (oldestSec + 1) * 1000;
    if (next < cursorMs) return { cursorMs: next, bottom: oldestSec + 1 };
    return { cursorMs: oldestSec * 1000, bottom: oldestSec };
  }

  // Whether a window can be ranked: the pull has reached the sub's first
  // post, the window is full, or the pull has passed the start of the range.
  // `span` is the sub's record, whose `bottom` is the oldest second known to
  // be stored in full.
  function windowReady(window, span, rangeStart) {
    return Boolean(span.done || window.full || span.bottom <= rangeStart);
  }

  // Whether every post in the range is stored, which "Top of everything"
  // needs.
  function rangeComplete(span, rangeStart) {
    return Boolean(span.done || span.bottom <= rangeStart);
  }
  // archive-ranking:end

  // archive-pull:start
  // The requests the pull makes to the Arctic Shift API, and how it reads
  // the answers. Like the blocks above, this stays DOM-free, so
  // nodejs/test-embedit.js can evaluate it on its own. The API answers an
  // unknown parameter with HTTP 400, and its `fields` parameter cannot
  // return the preview and media fields, so these two functions are the only
  // places that build its URLs.
  const API_BASE = "https://arctic-shift.photon-reddit.com/api";
  const META_APP = "redditp";
  // A query that times out is asked again smaller: at level 1 as 100 posts
  // instead of as many as the server allows, and at levels 2 and 3 as 100
  // posts from the 30 or 7 days before the cursor.
  const NARROW_LIMITS = ["auto", "100", "100", "100"];
  const NARROW_SPAN_DAYS = [0, 0, 30, 7];
  const DAY_MS = 86400000;
  const RATE_LIMIT_WAIT_MS = 60000;
  const MIN_WAIT_MS = 1000;
  const MAX_WAIT_MS = 300000;
  const NETWORK_WAIT_MS = 5000;
  const MAX_NETWORK_WAIT_MS = 60000;

  function narrowLevel(value) {
    const level = Math.floor(Number(value));
    return Number.isFinite(level) ? Math.min(3, Math.max(0, level)) : 0;
  }

  // The `after` bound of a narrowed query, in milliseconds, or 0 for none.
  function narrowedAfterMs(beforeMs, narrow) {
    const days = NARROW_SPAN_DAYS[narrowLevel(narrow)];
    return days ? beforeMs - days * DAY_MS : 0;
  }

  // The next page of a sub's posts, newest first, created before beforeMs.
  function searchUrl(sub, beforeMs, narrow) {
    const level = narrowLevel(narrow);
    const params = new URLSearchParams();
    params.set("subreddit", sub);
    params.set("sort", "desc");
    params.set("before", String(beforeMs));
    params.set("limit", NARROW_LIMITS[level]);
    const after = narrowedAfterMs(beforeMs, level);
    if (after) params.set("after", String(after));
    params.set("meta-app", META_APP);
    return `${API_BASE}/posts/search?${params}`;
  }

  // The date of a sub's first post, which turns the pull's progress into a
  // share.
  function earliestUrl(sub) {
    const params = new URLSearchParams();
    params.set("subreddit", sub);
    params.set("meta-app", META_APP);
    return `${API_BASE}/utils/min?${params}`;
  }

  // What a search answer means for the pull: "timeout" when the query took
  // too long, "limited" when the API asks us to slow down, "failed" for any
  // other error or a body that is not a list of posts, "empty" when no posts
  // are left, and "data" otherwise.
  function pageOutcome(status, body) {
    const error = typeof body?.error === "string" ? body.error : "";
    if (/timed out/i.test(error)) return "timeout";
    if (status === 429) return "limited";
    if (status < 200 || status >= 300) return "failed";
    if (!Array.isArray(body?.data)) return "failed";
    return body.data.length ? "data" : "empty";
  }

  // How long to wait after the API asked us to slow down: what its
  // X-RateLimit-Reset (seconds) or X-RateLimit-Reset-At (milliseconds since
  // the epoch) header says, when the browser lets the page read them, and
  // otherwise a minute, doubling with each attempt in a row. Always between
  // a second and five minutes.
  function rateLimitDelayMs(resetSeconds, resetAtMs, nowMs, attempt) {
    const readable = (value) =>
      value !== null &&
      value !== undefined &&
      String(value).trim() !== "" &&
      Number.isFinite(Number(value));
    let delay;
    if (readable(resetSeconds)) {
      delay = Number(resetSeconds) * 1000;
    } else if (readable(resetAtMs)) {
      delay = Number(resetAtMs) - nowMs;
    } else {
      delay = RATE_LIMIT_WAIT_MS * 2 ** Math.max(0, attempt || 0);
    }
    return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, delay));
  }

  // How long to wait after a network error: 5 seconds, doubling with each
  // attempt in a row, up to a minute.
  function backoffMs(attempt) {
    return Math.min(
      MAX_NETWORK_WAIT_MS,
      NETWORK_WAIT_MS * 2 ** Math.max(0, attempt || 0),
    );
  }
  // archive-pull:end

  // archive-format:start
  // How the page words counts, dates and progress. Like the blocks above,
  // this stays DOM-free, so nodejs/test-embedit.js can evaluate it on its
  // own. Months are shown in UTC, the time zone of the archive's dates.
  const COUNT_FORMAT = new Intl.NumberFormat("en-US");
  const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const BYTE_UNITS = ["bytes", "KB", "MB", "GB", "TB"];

  function knownTime(value) {
    return Number.isFinite(value) && value > 0;
  }

  // "12,345".
  function formatCount(value) {
    const count = Math.floor(Number(value));
    return COUNT_FORMAT.format(Number.isFinite(count) && count > 0 ? count : 0);
  }

  // "Jan 2008", from seconds.
  function formatMonth(seconds) {
    return knownTime(seconds) ? MONTH_FORMAT.format(seconds * 1000) : "";
  }

  // "Jan 2008 – Sep 2026", one month once, or "" while either end is
  // unknown.
  function formatSpan(oldestSec, newestSec) {
    if (!knownTime(oldestSec) || !knownTime(newestSec)) return "";
    const oldest = formatMonth(oldestSec);
    const newest = formatMonth(newestSec);
    return oldest === newest ? oldest : `${oldest} – ${newest}`;
  }

  // "just now", "5 minutes ago", "3 hours ago", "2 days ago", or "never".
  function formatAgo(thenMs, nowMs) {
    if (!knownTime(thenMs)) return "never";
    const seconds = Math.max(0, (nowMs - thenMs) / 1000);
    const ago = (count, unit) =>
      `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    if (seconds < 60) return "just now";
    if (seconds < 3600) return ago(Math.floor(seconds / 60), "minute");
    if (seconds < 86400) return ago(Math.floor(seconds / 3600), "hour");
    return ago(Math.floor(seconds / 86400), "day");
  }

  // "0 bytes", "512 KB", "1.5 GB".
  function formatBytes(value) {
    let size = Number(value);
    if (!Number.isFinite(size) || size <= 0) return "0 bytes";
    let unit = 0;
    while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit && size < 10 ? 1 : 0)} ${BYTE_UNITS[unit]}`;
  }

  // How much of a sub's history is stored, from 0 to 1: from its newest
  // post down to its first one, or down to the start of the chosen range
  // when that is later. Null while the newest post or that floor is
  // unknown.
  function pullProgress(record, rangeStart) {
    if (!record) return null;
    if (record.done) return 1;
    const floor = Math.max(
      Number(record.earliest) || 0,
      Number(rangeStart) || 0,
    );
    const top = Number(record.top);
    const bottom = Number(record.bottom);
    if (!(top > 0) || !(floor > 0) || !(top > floor)) return null;
    if (!Number.isFinite(bottom)) return 0;
    return Math.min(1, Math.max(0, (top - bottom) / (top - floor)));
  }
  // archive-format:end
})();
