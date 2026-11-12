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

  // The still that a post's player frame names in its oEmbed, such as a
  // RedGIFs clip's poster, decoded; "" when it names none.
  function oembedThumbnail(post) {
    const oembed = post.media?.oembed || post.secure_media?.oembed;
    return isObject(oembed) ? decodeUrl(oembed.thumbnail_url) : "";
  }

  function sizeOf(value) {
    const number = numberOf(value);
    return Number.isFinite(number) ? number : 0;
  }

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

  // A gallery item's smaller copies, from its metadata's `p`, in the shape
  // gridRendition reads.
  function galleryCopies(entry) {
    return Array.isArray(entry.p)
      ? entry.p
          .filter(isObject)
          .map((size) => ({ url: size.u, width: size.x, height: size.y }))
      : [];
  }

  // The one smaller copy a record keeps of a list (see gridRendition), as
  // a one-item list in the list's own shape, or null. The widest copy is
  // kept when none is wide enough, so that a GIF can still use it.
  function keptCopy(copies) {
    const copy = gridRendition(copies, true);
    return copy
      ? [
          {
            url: decodeUrl(copy.url),
            width: sizeOf(copy.width),
            height: sizeOf(copy.height),
          },
        ]
      : null;
  }

  // What a post shows: its link, its Reddit video, its preview picture, the
  // MP4 that Reddit made of a GIF, Reddit's own copy of a clip that it
  // links to on a host such as RedGIFs, and its gallery, with the gallery's
  // pictures in their largest size. Of the smaller copies of the preview,
  // of a GIF's MP4 and of each gallery picture, only the one a grid tile
  // loads is kept (see keptCopy), to keep records small, of a player
  // frame's oEmbed only its still, and of the copy of a clip only its file
  // and size. A crosspost keeps the same fields of its original post.
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
    const image = post.preview?.images?.[0];
    const preview = {};
    if (isObject(image?.source) && typeof image.source.url === "string") {
      preview.source = {
        url: decodeUrl(image.source.url),
        width: sizeOf(image.source.width),
        height: sizeOf(image.source.height),
      };
    }
    const still = keptCopy(image?.resolutions);
    if (still) preview.resolutions = still;
    const mp4 = image?.variants?.mp4;
    if (typeof mp4?.source?.url === "string") {
      preview.variants = {
        mp4: { source: { url: decodeUrl(mp4.source.url) } },
      };
      const loop = keptCopy(mp4.resolutions);
      if (loop) preview.variants.mp4.resolutions = loop;
    }
    if (preview.source || preview.resolutions || preview.variants) {
      media.preview = { images: [preview] };
    }
    // Reddit's copy of a linked clip, on v.redd.it, which a grid tile loops
    // (see clipLoop).
    const clip = post.preview?.reddit_video_preview;
    if (isObject(clip) && typeof clip.fallback_url === "string") {
      media.preview = {
        ...media.preview,
        reddit_video_preview: {
          fallback_url: decodeUrl(clip.fallback_url),
          width: sizeOf(clip.width),
          height: sizeOf(clip.height),
        },
      };
    }
    // A player frame's own still stands in for a preview that the post
    // lacks, so of its oEmbed, only that URL is kept.
    const thumbnail = oembedThumbnail(post);
    if (thumbnail && !preview.source) {
      media.media = {
        ...media.media,
        oembed: { thumbnail_url: thumbnail },
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
        const smaller = keptCopy(galleryCopies(entry));
        if (smaller) {
          kept.p = smaller.map((copy) => ({
            u: copy.url,
            x: copy.width,
            y: copy.height,
          }));
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

  // A link to a GIF, whatever its query.
  const GIF_URL_RE = /\.gif(?:$|[?#])/i;

  // The MP4 that Reddit made of a GIF, from the post's preview, or "".
  function mp4Rendition(post) {
    return safeUrl(post?.preview?.images?.[0]?.variants?.mp4?.source?.url);
  }

  function hasOwnMedia(post) {
    return Boolean(
      redditVideo(post) || isObject(post.media_metadata) || mp4Rendition(post),
    );
  }

  // The post whose media a post shows: its own, or a crosspost's original
  // when only the original has a Reddit video, a gallery or the MP4 of a
  // GIF.
  function mediaSource(post) {
    const parent = Array.isArray(post.crosspost_parent_list)
      ? post.crosspost_parent_list[0]
      : null;
    return !hasOwnMedia(post) && isObject(parent) && hasOwnMedia(parent)
      ? parent
      : post;
  }

  // A post's preview picture, Reddit's copy of its picture or of its
  // video's first frame: its URL, its size (0 when unknown), its smaller
  // copies, and for a GIF the MP4 that Reddit made of it with that MP4's
  // smaller copies. Records stored before the copies were kept have none.
  function previewOf(post) {
    const image = post?.preview?.images?.[0];
    const mp4 = image?.variants?.mp4;
    return {
      url: safeUrl(image?.source?.url),
      width: sizeOf(image?.source?.width),
      height: sizeOf(image?.source?.height),
      copies: image?.resolutions,
      mp4: safeUrl(mp4?.source?.url),
      mp4Copies: mp4?.resolutions,
    };
  }

  const NO_PREVIEW = previewOf(null);

  // What a grid tile shows of an item whose picture, or video's poster, is
  // `preview` (see previewOf): thumb, the smaller still copy that the tile
  // loads instead (see gridRendition), and the picture's size; and
  // thumbVideo, the silent loop that plays over the still: a GIF's MP4 of
  // Reddit's (see gifLoop), or the file on v.redd.it of a Reddit video or
  // of Reddit's copy of a clip (see clipLoop), which the viewer trades for
  // a smaller rendition. A GIF's still may be narrower than
  // GRID_THUMB_WIDTH, since the GIF itself weighs far more.
  function gridFields(preview, gif, loop) {
    const copy = gridRendition(preview.copies, gif);
    return {
      thumb: copy && isStillCopy(copy.url) ? safeUrl(copy.url) : "",
      thumbVideo: loop || "",
      width: preview.width,
      height: preview.height,
    };
  }

  // The loop a GIF's tile plays: the narrowest of the MP4's copies that is
  // wide enough, or its widest, or else the MP4 itself, which is small too.
  function gifLoop(preview) {
    const copy = gridRendition(preview.mp4Copies, true);
    return (copy && safeUrl(copy.url)) || preview.mp4;
  }

  // The file on v.redd.it of Reddit's own copy of the clip that a post
  // links to on a host such as RedGIFs or imgur, from its preview or from
  // its crosspost original's; "" when neither has one.
  function clipLoop(post) {
    const parent = Array.isArray(post.crosspost_parent_list)
      ? post.crosspost_parent_list[0]
      : null;
    return (
      [post, parent]
        .map((source) =>
          isObject(source)
            ? safeUrl(source.preview?.reddit_video_preview?.fallback_url)
            : "",
        )
        .find((url) => /^https:\/\/v\.redd\.it\//i.test(url)) || ""
    );
  }

  // A gallery picture's own file on i.redd.it, for a JPEG or WebP, or "".
  // Its s.u is one of preview.redd.it's full-size transcodes, which the
  // host makes on demand, so a first request for one can take seconds,
  // while i.redd.it serves the file it has, of about the same weight. A PNG
  // keeps its transcode, since the original can weigh many times more.
  function galleryUpload(id, mime) {
    const type = /^image\/(jpe?g|webp)$/i.exec(
      typeof mime === "string" ? mime : "",
    );
    return type && /^[a-z0-9]+$/i.test(id)
      ? `https://i.redd.it/${id}.${type[1].toLowerCase()}`
      : "";
  }

  // A gallery's pictures and animations in the gallery's order, numbered
  // n of N. Items that failed to process are left out, and so are videos,
  // for which the metadata names no file. A picture that loads from
  // i.redd.it (see galleryUpload) keeps its transcode's URL as formerUrl,
  // under which slides of it were known before.
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
      const animated = entry.e === "AnimatedImage";
      const picture = {
        url: "",
        width: Number.isFinite(size.x) ? size.x : 0,
        height: Number.isFinite(size.y) ? size.y : 0,
        copies: galleryCopies(entry),
      };
      let item = null;
      if (entry.e === "Image") {
        const upload = galleryUpload(id, entry.m);
        const transcode = safeUrl(size.u);
        item = {
          kind: "image",
          url: upload || transcode,
          fromGif: false,
          ...gridFields(picture, false, ""),
        };
        if (upload && transcode) item.formerUrl = transcode;
      } else if (animated && safeUrl(size.mp4)) {
        // An animation plays as its MP4 where it has one. The metadata has
        // no smaller MP4, so its tile loops that one.
        const mp4 = safeUrl(size.mp4);
        item = {
          kind: "video",
          url: mp4,
          fromGif: true,
          ...gridFields(picture, true, mp4),
        };
      } else if (animated) {
        item = {
          kind: "image",
          url: safeUrl(size.gif),
          fromGif: true,
          ...gridFields(picture, true, ""),
        };
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
  // leads to (a GIF as the MP4 that Reddit made of it), the preview picture
  // of a link, or the link itself. The first rule that finds something
  // wins, so the result is never empty. Each item also says what its grid
  // tile shows (see gridFields): a Reddit video's tile loops the video, and
  // the tile of a clip elsewhere loops Reddit's copy of it, where the post
  // has one.
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
      const sourcePreview = previewOf(source);
      const poster = sourcePreview.url ? sourcePreview : previewOf(post);
      return [
        {
          kind: "video",
          url: fallback,
          poster: poster.url,
          postMedia: true,
          fromGif: video.is_gif === true,
          ...gridFields(poster, video.is_gif === true, fallback),
        },
      ];
    }
    const url = safeUrl(post.url_overridden_by_dest || post.url);
    const preview = previewOf(post);
    const external = url ? urls.externalMedia(url) : null;
    if (external) {
      // Reddit's preview is its copy of the picture, or of the video's
      // first frame. The grid never loads a player, so a player's tile
      // shows that still as its poster. Where the post has no preview, it
      // shows the still that the player's oEmbed names, or else the one
      // that its host keeps (see embedStill). An imgur GIF's own MP4 can
      // weigh megabytes, so a video's or a player's tile loops only
      // Reddit's copy of the clip, where the post has one (see clipLoop).
      let still = "";
      if (external.kind === "embed" && !preview.url) {
        still =
          safeUrl(oembedThumbnail(post)) ||
          (typeof urls.embedStill === "function"
            ? urls.embedStill(external.url)
            : "");
      }
      return [
        {
          kind: external.kind,
          url: external.url,
          poster: external.kind === "image" ? "" : preview.url || still,
          postMedia: true,
          fromGif: Boolean(external.fromGif),
          ...gridFields(
            preview,
            Boolean(external.fromGif),
            external.kind === "image" ? "" : clipLoop(post),
          ),
        },
      ];
    }
    // A GIF plays as the MP4 that Reddit made of it, a fraction of its size
    // and far cheaper to play, where the post has one.
    const rendition = mp4Rendition(source);
    if (url && rendition && GIF_URL_RE.test(url)) {
      const poster = preview.url ? preview : previewOf(source);
      return [
        {
          kind: "video",
          url: rendition,
          poster: poster.url,
          postMedia: true,
          fromGif: true,
          ...gridFields(poster, true, gifLoop(previewOf(source))),
        },
      ];
    }
    // The preview is Reddit's copy of a linked picture.
    if (url && urls.IMAGE_URL_RE.test(url)) {
      return [
        {
          kind: "image",
          url,
          poster: "",
          postMedia: true,
          fromGif: false,
          ...gridFields(preview, GIF_URL_RE.test(url), ""),
        },
      ];
    }
    if (url && urls.isVideoUrl(url)) {
      return [
        {
          kind: "video",
          url,
          poster: preview.url,
          postMedia: true,
          fromGif: false,
          ...gridFields(preview, false, ""),
        },
      ];
    }
    // A link's preview picture is not the post's own media, so any Show
    // filter hides it.
    if (!post.is_self && preview.url) {
      return [
        {
          kind: "image",
          url: preview.url,
          poster: "",
          postMedia: false,
          fromGif: false,
          ...gridFields(preview, GIF_URL_RE.test(preview.url), ""),
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
        ...gridFields(NO_PREVIEW, false, ""),
      },
    ];
  }

  // The viewer's slides for a post, one per media item, and how many items
  // were left out because they are known to fail (deadKeys holds their
  // media keys, some recorded under an item's formerUrl). A gallery's
  // slides keep their n/N numbering when some are left out. Every slide
  // carries `archive`, which the viewer passes back untouched.
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
    const isDead = (mediaUrl) =>
      Boolean(
        mediaUrl && deadKeys && deadKeys.has(urls.canonicalMediaKey(mediaUrl)),
      );
    const slides = [];
    let unavailable = 0;
    mediaFromPost(post, urls).forEach((item) => {
      if (isDead(item.url) || isDead(item.formerUrl)) {
        unavailable += 1;
        return;
      }
      slides.push({
        kind: item.kind,
        url: item.url,
        poster: item.poster,
        thumb: item.thumb,
        thumbVideo: item.thumbVideo,
        width: item.width,
        height: item.height,
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

  // The order entries ({ id, created, score }) rank in: by score, then
  // newest first, then by id.
  function compareRanked(a, b) {
    return (
      b.score - a.score ||
      b.created - a.created ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }

  // The entries that rank, best first. Posts younger than
  // SCORE_BLIND_SECONDS and posts below the minimum score are left out.
  function rankedEntries(entries, { nowSec, minScore }) {
    const latest = nowSec - SCORE_BLIND_SECONDS;
    const floor = Number.isFinite(minScore) ? minScore : 0;
    return entries
      .filter((entry) => entry.created <= latest && entry.score >= floor)
      .sort(compareRanked);
  }

  // The ids of the entries that rank, best first.
  function rankEntries(entries, options) {
    return rankedEntries(entries, options).map((entry) => entry.id);
  }

  // Two lists of entries, each best first, as one list, best first. Of two
  // entries that rank alike, the one from `a` comes first.
  function mergeRanked(a, b) {
    const merged = [];
    let fromA = 0;
    let fromB = 0;
    while (fromA < a.length && fromB < b.length) {
      merged.push(
        compareRanked(b[fromB], a[fromA]) < 0 ? b[fromB++] : a[fromA++],
      );
    }
    return merged.concat(a.slice(fromA), b.slice(fromB));
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

  // Whether every post in the range is stored, so the pull has no more to
  // bring to it.
  function rangeComplete(span, rangeStart) {
    return Boolean(span.done || span.bottom <= rangeStart);
  }

  // What "Top of what's stored" ranks as it opens, as { start, end } with
  // end exclusive: the range's posts from the oldest second stored in full
  // up to just above the newest stored post. During a refresh that post
  // stays put until the refresh is done, so no gap opens above it. Before
  // anything is stored, the whole range is still to come. `start` is where
  // the ranked posts reach down to.
  function firstStretch(range, span) {
    const end = span.top > 0 ? Math.min(range.end, span.top + 1) : range.end;
    return { start: Math.min(Math.max(range.start, span.bottom), end), end };
  }

  // What the pull has stored in full since "Top of what's stored" ranked
  // down to rankedFloor: the range's posts below it, as { start, end } with
  // end exclusive, or null while there are none.
  function newStretch(rangeStart, rankedFloor, recordBottom) {
    const start = Math.max(rangeStart, recordBottom);
    return start < rankedFloor ? { start, end: rankedFloor } : null;
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
  // After a rate limit, requests stay further apart, up to this many times
  // the usual pause, until this many pages in a row have brought posts.
  const MAX_PACE_FACTOR = 8;
  const PACE_RECOVERY_PAGES = 30;

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

  // The pause between requests after an answer, from the pause so far and
  // the usual one (baseMs): doubled after a rate limit, up to
  // MAX_PACE_FACTOR times the usual pause, and halved, down to the usual
  // pause, after each PACE_RECOVERY_PAGES pages in a row that brought posts.
  // okStreak counts those pages, this one included.
  function nextPace(paceMs, baseMs, outcome, okStreak) {
    if (outcome === "limited") {
      return Math.min(paceMs * 2, baseMs * MAX_PACE_FACTOR);
    }
    if (
      outcome === "data" &&
      okStreak > 0 &&
      okStreak % PACE_RECOVERY_PAGES === 0
    ) {
      return Math.max(baseMs, paceMs / 2);
    }
    return paceMs;
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

  // Everything below runs on the page: it stores the archives, pulls them
  // and shows them.

  // Knobs for the Playwright suite, which shrinks the windows and speeds up
  // the pull and the saving of resume positions. The page never sets them.
  const CONFIG = archiveConfig(window.__redditpArchiveConfig);

  function archiveConfig(overrides) {
    const config = {
      windowSize: WINDOW_SIZE,
      requestIntervalMs: 1000,
      resumeSaveMs: 2000,
    };
    if (overrides && typeof overrides === "object") {
      Object.keys(config).forEach((key) => {
        const value = Number(overrides[key]);
        const least = key === "windowSize" ? 1 : 0;
        if (Number.isFinite(value) && value >= least) config[key] = value;
      });
    }
    return config;
  }

  // IndexedDB holds each archive's record ("subs"), its posts, and the media
  // of its posts that failed to load ("dead"). Posts and dead media are
  // keyed by [sub, id], so deleting an archive is one range delete. Each
  // index of the posts ends in a third field, so a key cursor reads
  // { id, created, score } without loading a single post: that, and never
  // the posts themselves, is all the ranking holds in memory.
  const DB_NAME = "redditp-archive";
  const DB_VERSION = 1;

  // Every [name, id] key, since arrays sort after strings.
  function subRange(name) {
    return IDBKeyRange.bound([name], [name, []]);
  }

  function requestDone(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error || new Error("The change was not saved."));
    });
  }

  function openDb(onBlocked) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("subs")) {
          db.createObjectStore("subs", { keyPath: "name" });
        }
        if (!db.objectStoreNames.contains("posts")) {
          const posts = db.createObjectStore("posts", {
            keyPath: ["sub", "id"],
          });
          posts.createIndex("bySubCreated", ["sub", "created_utc", "score"]);
          posts.createIndex("bySubScore", ["sub", "score", "created_utc"]);
        }
        if (!db.objectStoreNames.contains("dead")) {
          db.createObjectStore("dead", { keyPath: ["sub", "id"] });
        }
      };
      request.onblocked = () => onBlocked();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getSub(db, name) {
    return requestDone(
      db.transaction("subs").objectStore("subs").get(name),
    ).then((record) => record || null);
  }

  function listSubs(db) {
    return requestDone(db.transaction("subs").objectStore("subs").getAll());
  }

  // An archive's record, created as `fresh` when there is none yet.
  // Resolves to { record, created }.
  function openSub(db, fresh) {
    const transaction = db.transaction("subs", "readwrite");
    const store = transaction.objectStore("subs");
    let record = null;
    let created = false;
    store.get(fresh.name).onsuccess = (event) => {
      record = event.target.result || null;
      if (record) return;
      record = fresh;
      created = true;
      store.add(fresh);
    };
    return transactionDone(transaction).then(() => ({ record, created }));
  }

  // Writes some fields of an archive's record. Every write goes through
  // here or storePage, which read the stored record in the same
  // transaction, so a change never undoes another one made meanwhile, in
  // this tab or another. Resolves to the stored record, or to null when
  // the archive is gone.
  function patchSub(db, name, changes) {
    const transaction = db.transaction("subs", "readwrite");
    const store = transaction.objectStore("subs");
    let record = null;
    store.get(name).onsuccess = (event) => {
      if (!event.target.result) return;
      record = { ...event.target.result, ...changes };
      store.put(record);
    };
    return transactionDone(transaction).then(() => record);
  }

  // Stores a page of posts and moves the archive's record on in ONE
  // transaction, so after a crash or a reload the cursor never points past
  // posts that were not stored. A post stored before is replaced, which is
  // how a refresh brings in matured scores; only new posts add to the
  // count. Resolves to the stored record, or to null when the archive was
  // deleted meanwhile.
  function storePage(db, name, changes, posts) {
    const transaction = db.transaction(["posts", "subs"], "readwrite");
    const postStore = transaction.objectStore("posts");
    const subStore = transaction.objectStore("subs");
    let record = null;
    let missing = false;
    let inserted = 0;
    let pending = posts.length;
    const finish = () => {
      record = {
        ...record,
        ...changes,
        count: (record.count || 0) + inserted,
      };
      subStore.put(record);
    };
    const settle = () => {
      pending -= 1;
      if (!pending) finish();
    };
    subStore.get(name).onsuccess = (event) => {
      record = event.target.result;
      if (!record) {
        missing = true;
        transaction.abort();
        return;
      }
      if (!posts.length) finish();
      posts.forEach((post) => {
        const add = postStore.add(post);
        add.onsuccess = () => {
          inserted += 1;
          settle();
        };
        add.onerror = (event) => {
          if (add.error?.name !== "ConstraintError") return;
          // Stored before: replace it rather than fail the page.
          event.preventDefault();
          event.stopPropagation();
          postStore.put(post);
          settle();
        };
      });
    };
    return transactionDone(transaction).then(
      () => record,
      (error) => {
        if (missing) return null;
        throw error;
      },
    );
  }

  // Deletes an archive: its record, its posts and its dead media, at once.
  function deleteSub(db, name) {
    const transaction = db.transaction(["subs", "posts", "dead"], "readwrite");
    transaction.objectStore("subs").delete(name);
    transaction.objectStore("posts").delete(subRange(name));
    transaction.objectStore("dead").delete(subRange(name));
    return transactionDone(transaction);
  }

  // The { id, created, score } of a sub's posts created from lowerSec up to
  // (not including) endSec, newest first. With a finite `size` it stops as
  // soon as cutWindow would.
  function readEntries(db, sub, lowerSec, endSec, size) {
    return new Promise((resolve, reject) => {
      const entries = [];
      if (!(lowerSec < endSec)) {
        resolve(entries);
        return;
      }
      // A key is [sub, created, score], so [sub, endSec] as the upper bound
      // leaves second endSec out, and Infinity is a valid bound.
      const request = db
        .transaction("posts")
        .objectStore("posts")
        .index("bySubCreated")
        .openKeyCursor(
          IDBKeyRange.bound([sub, lowerSec], [sub, endSec]),
          "prev",
        );
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(entries);
          return;
        }
        const created = cursor.key[1];
        if (
          entries.length >= size &&
          created !== entries[entries.length - 1].created
        ) {
          resolve(entries);
          return;
        }
        entries.push({
          id: cursor.primaryKey[1],
          created,
          score: cursor.key[2],
        });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // The window that ends (exclusively) at endSec, read no lower than
  // lowerSec.
  function readWindow(db, sub, endSec, lowerSec, size) {
    return readEntries(db, sub, lowerSec, endSec, size).then((entries) =>
      cutWindow(entries, size),
    );
  }

  // Every post of a stretch, for "Top of what's stored".
  function readRange(db, sub, startSec, endSec) {
    return readEntries(db, sub, startSec, endSec, Infinity);
  }

  // How many posts a range holds, counted without reading them.
  function countRange(db, sub, lowerSec, endSec) {
    if (!(lowerSec < endSec)) return Promise.resolve(0);
    return requestDone(
      db
        .transaction("posts")
        .objectStore("posts")
        .index("bySubCreated")
        .count(IDBKeyRange.bound([sub, lowerSec], [sub, endSec])),
    );
  }

  // Posts by id, in the order asked for; a post that is gone is undefined.
  function getPosts(db, sub, ids) {
    const store = db.transaction("posts").objectStore("posts");
    return Promise.all(ids.map((id) => requestDone(store.get([sub, id]))));
  }

  // A sub's media that failed to load: post id -> Set of media keys.
  function getDead(db, sub) {
    return requestDone(
      db.transaction("dead").objectStore("dead").getAll(subRange(sub)),
    ).then(
      (entries) =>
        new Map(entries.map((entry) => [entry.id, new Set(entry.keys)])),
    );
  }

  function addDead(db, sub, id, key) {
    const transaction = db.transaction("dead", "readwrite");
    const store = transaction.objectStore("dead");
    store.get([sub, id]).onsuccess = (event) => {
      const keys = event.target.result?.keys || [];
      if (!keys.includes(key)) store.put({ sub, id, keys: [...keys, key] });
    };
    return transactionDone(transaction);
  }

  function storageErrorText(error) {
    return error?.name === "QuotaExceededError"
      ? "Storage is full: delete an archive or free disk space."
      : `The archive could not be stored (${error?.message || error}).`;
  }

  // The pull: one sub's posts, newest first, into IndexedDB, about once a
  // second (CONFIG.requestIntervalMs), until the chosen range is stored.
  // After a rate limit it asks less often for a while (nextPace). It waits
  // while paused, while the tab is hidden and while another tab pulls the
  // same sub, and it goes on from its stored cursor after a reload. A
  // refresh pulls the newest posts again first. Only the selected sub
  // pulls.
  const REDDIT_FIRST_SECOND = Date.UTC(2005, 5, 1) / 1000;
  // What another tab's pull changes in a record.
  const PULL_FIELDS = [
    "display",
    "earliest",
    "count",
    "top",
    "bottom",
    "done",
    "cursorMs",
    "narrow",
    "refresh",
    "refreshedAt",
    "lastPullAt",
    "error",
  ];

  function createPuller(db, record, onChange) {
    // phase: starting, pulling, refreshing, idle (the range is stored),
    // paused, hidden, elsewhere (another tab pulls), failed (stopped on an
    // error until Retry), limited, offline, server, narrowing (waiting
    // until `until` before asking again) or stopped. paceMs is the pause
    // between requests, longer than CONFIG.requestIntervalMs for a while
    // after a rate limit.
    const state = {
      phase: "starting",
      until: 0,
      detail: "",
      paceMs: CONFIG.requestIntervalMs,
    };
    const attempts = { limited: 0, network: 0, server: 0 };
    // Pages in a row that brought posts.
    let okStreak = 0;
    let hold = { until: 0, phase: "", detail: "" };
    let stopped = false;
    let wakeUp = null;
    let waiters = [];
    let lockRequest = null;
    let poll = null;

    function notify() {
      const resolved = waiters;
      waiters = [];
      resolved.forEach((resolve) => resolve());
      onChange();
    }

    function setPhase(phase, until = 0, detail = "") {
      if (
        state.phase === phase &&
        state.until === until &&
        state.detail === detail
      ) {
        return;
      }
      Object.assign(state, { phase, until, detail });
      notify();
    }

    // Sleeps until the time is up, or until the page wakes the pull: a new
    // range, a pause, the tab shown again, a stop.
    function sleep(ms) {
      return new Promise((resolve) => {
        let timer = null;
        const done = () => {
          clearTimeout(timer);
          if (wakeUp === done) wakeUp = null;
          resolve();
        };
        if (Number.isFinite(ms)) timer = setTimeout(done, Math.max(0, ms));
        wakeUp = done;
      });
    }

    function wake() {
      if (wakeUp) wakeUp();
    }

    function holdFor(phase, ms, detail = "") {
      hold = { until: Date.now() + ms, phase, detail };
    }

    async function save(changes) {
      Object.assign(record, changes);
      if (!(await patchSub(db, record.name, changes))) stop();
    }

    // A refresh until it is done, then the pull back in time until it has
    // passed the start of the range or reached the sub's first post.
    function pickJob() {
      if (record.refresh) return "refresh";
      if (record.done) return "";
      const range = rangeBounds(
        normalView(record.view).range,
        Math.floor(Date.now() / 1000),
      );
      return record.bottom > range.start ? "backfill" : "";
    }

    async function run() {
      while (!stopped) {
        if (record.paused) {
          setPhase("paused");
          await sleep(Infinity);
          continue;
        }
        if (document.hidden) {
          setPhase("hidden");
          await sleep(Infinity);
          continue;
        }
        if (record.error) {
          setPhase("failed");
          await sleep(Infinity);
          continue;
        }
        const job = pickJob();
        if (!job) {
          setPhase("idle");
          await sleep(Infinity);
          continue;
        }
        const wait = hold.until - Date.now();
        if (wait > 0) {
          if (hold.phase) setPhase(hold.phase, hold.until, hold.detail);
          await sleep(wait);
          continue;
        }
        setPhase(job === "refresh" ? "refreshing" : "pulling");
        // The next request waits out the rest of the pause.
        hold = { until: Date.now() + state.paceMs, phase: "", detail: "" };
        try {
          await step(job === "refresh");
        } catch (error) {
          if (stopped) break;
          record.error = storageErrorText(error);
          patchSub(db, record.name, { error: record.error }).catch(() => {});
        }
        if (!stopped) notify();
      }
    }

    // One request, and what its answer means for the record.
    async function step(refresh) {
      // A cursor of 0 starts at now. That now stays for this page's retries,
      // though only in memory: after a reload the pull starts at a new now.
      const cursor = refresh ? record.refresh : record;
      if (!cursor.cursorMs) cursor.cursorMs = Date.now();
      const beforeMs = cursor.cursorMs;
      const narrow = record.narrow;
      let response = null;
      let body = null;
      try {
        response = await fetch(searchUrl(record.name, beforeMs, narrow), {
          credentials: "omit",
        });
        body = await response.json().catch(() => null);
      } catch (_error) {
        okStreak = 0;
        holdFor("offline", backoffMs(attempts.network++));
        return;
      }
      if (stopped) return;
      attempts.network = 0;
      const outcome = pageOutcome(response.status, body);
      if (outcome !== "limited") attempts.limited = 0;
      if (outcome !== "failed") attempts.server = 0;
      // A rate limit slows every request after it for a while, beyond the
      // wait before its retry.
      okStreak = outcome === "data" ? okStreak + 1 : 0;
      state.paceMs = nextPace(
        state.paceMs,
        CONFIG.requestIntervalMs,
        outcome,
        okStreak,
      );
      if (outcome === "data") {
        await storeData(refresh, beforeMs, body.data);
      } else if (outcome === "empty") {
        await storeEmpty(refresh, beforeMs, narrow);
      } else if (outcome === "timeout") {
        await save({ narrow: Math.min(3, narrow + 1) });
        holdFor("narrowing", 2000);
      } else if (outcome === "limited") {
        // The reset headers stay unreadable unless the API exposes them to
        // pages, so the backoff is what usually applies.
        holdFor(
          "limited",
          rateLimitDelayMs(
            response.headers.get("x-ratelimit-reset"),
            response.headers.get("x-ratelimit-reset-at"),
            Date.now(),
            attempts.limited++,
          ),
        );
      } else if (response.status >= 400 && response.status < 500) {
        await save({ error: body?.error || `HTTP ${response.status}` });
      } else {
        // A server error, or an answer that is not a list of posts: the
        // service may be having a bad moment, so it is asked again later.
        holdFor(
          "server",
          backoffMs(attempts.server++),
          body?.error || `HTTP ${response.status}`,
        );
      }
    }

    function refreshDone(newTop) {
      return {
        refresh: null,
        top: Math.max(record.top, newTop || 0),
        refreshedAt: Date.now(),
      };
    }

    async function storeData(refresh, beforeMs, raw) {
      const times = raw
        .map((post) => Math.floor(numberOf(post?.created_utc)))
        .filter(Number.isFinite);
      if (!times.length) {
        holdFor("server", backoffMs(attempts.server++), "posts without dates");
        return;
      }
      const oldest = Math.min(...times);
      const newest = Math.max(...times);
      const posts = raw
        .map((post) => trimPost(post, record.name))
        .filter((post) => post && post.subreddit.toLowerCase() === record.name);
      const next = advanceCursor(beforeMs, oldest);
      const changes = { narrow: 0, lastPullAt: Date.now() };
      if (refresh) {
        const newTop = record.refresh.newTop || newest;
        if (oldest <= record.refresh.stopAt) {
          Object.assign(changes, refreshDone(newTop));
        } else {
          changes.refresh = {
            ...record.refresh,
            cursorMs: next.cursorMs,
            newTop,
          };
        }
      } else {
        if (!record.top) {
          changes.top = newest;
          // The sub's own spelling of its name.
          if (posts[0]) changes.display = posts[0].subreddit;
        }
        changes.cursorMs = next.cursorMs;
        changes.bottom = Math.min(record.bottom, next.bottom);
      }
      const stored = await storePage(db, record.name, changes, posts);
      if (!stored) {
        stop();
        return;
      }
      Object.assign(record, changes, { count: stored.count });
    }

    async function storeEmpty(refresh, beforeMs, narrow) {
      const afterMs = narrowedAfterMs(beforeMs, narrow);
      const afterSec = Math.floor(afterMs / 1000);
      const changes = { lastPullAt: Date.now() };
      // A narrowed query that found nothing moves the cursor down to its
      // `after`, asking for that second again, since the API may leave it
      // out.
      if (refresh) {
        if (afterMs && afterSec > record.refresh.stopAt) {
          changes.refresh = { ...record.refresh, cursorMs: afterMs + 1000 };
        } else {
          Object.assign(changes, refreshDone(record.refresh.newTop));
        }
      } else if (
        afterMs &&
        afterSec + 1 > (record.earliest || REDDIT_FIRST_SECOND)
      ) {
        changes.cursorMs = afterMs + 1000;
        changes.bottom = Math.min(record.bottom, afterSec + 1);
      } else {
        changes.done = true;
        changes.bottom = Math.min(
          record.bottom,
          record.earliest || record.bottom,
        );
      }
      await save(changes);
    }

    // The date of the sub's first post, for the progress bar. A failure is
    // tried again the next time the archive opens.
    async function fetchEarliest() {
      if (record.earliest || record.done) return;
      try {
        const response = await fetch(earliestUrl(record.name), {
          credentials: "omit",
        });
        const body = await response.json();
        const seconds = Math.floor(Date.parse(body?.data) / 1000);
        if (!response.ok || !(seconds > 0) || stopped) return;
        await save({ earliest: seconds });
        notify();
      } catch (_error) {
        // Unknown for now: the progress bar waits.
      }
    }

    // The pull's fields as another tab stored them.
    async function adoptStored() {
      const stored = await getSub(db, record.name).catch(() => null);
      if (!stored || stopped) return;
      PULL_FIELDS.forEach((key) => {
        record[key] = stored[key];
      });
      notify();
    }

    // Pulls while this tab holds the sub's lock, where the browser has Web
    // Locks. When another tab holds it, this one shows that tab's progress
    // and takes over once it lets go.
    async function start() {
      void fetchEarliest();
      const locks = navigator.locks;
      if (!locks || typeof locks.request !== "function") {
        await run();
        return;
      }
      const name = `redditp-archive:${record.name}`;
      let held = false;
      try {
        await locks.request(name, { ifAvailable: true }, async (lock) => {
          if (!lock) return;
          held = true;
          await run();
        });
        if (held || stopped) return;
        setPhase("elsewhere");
        lockRequest = new AbortController();
        poll = setInterval(() => void adoptStored(), 5000);
        await locks.request(name, { signal: lockRequest.signal }, async () => {
          clearInterval(poll);
          await adoptStored();
          await run();
        });
      } catch (error) {
        if (error?.name !== "AbortError") throw error;
      } finally {
        clearInterval(poll);
      }
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      lockRequest?.abort();
      clearInterval(poll);
      wake();
      setPhase("stopped");
    }

    return {
      state,
      start,
      stop,
      wake,
      // Resolves at the pull's next step or change of phase.
      waitForChange: () => new Promise((resolve) => waiters.push(resolve)),
      // Whether more posts are on their way: not while paused, failed,
      // stopped, or pulled by another tab.
      isPulling: () =>
        !stopped &&
        !record.paused &&
        !record.error &&
        state.phase !== "elsewhere",
    };
  }

  // The viewer's source for an archive: its stored posts in one view, a
  // batch at a time (content.js describes the shape at liveSource).
  // "Newest windows first" walks the windows from the newest down, each
  // ranked by score, and waits for the pull while the next one fills. "Top
  // of what's stored" ranks everything stored so far at once, and slots the
  // posts that the pull stores meanwhile in by score among those not handed
  // to the viewer yet, so what it has shown never moves. Only ids, dates
  // and scores are ranked; the posts themselves are read READ_CHUNK at a
  // time.
  const BATCH_WANTED = 24;
  const BATCH_MAX_POSTS = 400;
  const READ_CHUNK = 48;

  function createArchiveSource({
    record,
    puller,
    view,
    resume,
    onResume,
    onClosed,
  }) {
    const sub = record.name;
    const key = viewKey(view);
    const urls = viewer.media;
    let queue = Promise.resolve();
    // Post id -> the media keys of its pictures and videos that failed.
    let dead = null;
    // Window mode: the window being walked, { windowEnd, start, ids, pos,
    // last }, where windowEnd 0 is the newest window.
    let walk = null;
    // Top mode: { entries, pos, floor, handed }. The ranked entries
    // ({ id, created, score }) from `pos` on are the posts not handed to
    // the viewer yet, best first; they cover the range down to the second
    // `floor`, and `handed` posts came before them.
    let list = null;
    let exhausted = false;
    let closed = false;
    let pendingResume = null;
    let resumeTimer = null;
    let resumeSavedAt = 0;

    const nowSec = () => Math.floor(Date.now() / 1000);
    const ranking = () => ({ nowSec: nowSec(), minScore: view.minScore });

    // A window of the view, ranked, or null while the pull has not filled
    // it. The newest window ends just above the newest stored post; during
    // a refresh that post stays put until the refresh is done, so no gap
    // opens above it.
    async function readRanked(windowEnd) {
      const range = rangeBounds(view.range, nowSec());
      const newest = Math.min(range.end, record.top + 1);
      const window = await readWindow(
        db,
        sub,
        windowEnd || newest,
        Math.max(range.start, record.bottom),
        CONFIG.windowSize,
      );
      if (!windowReady(window, record, range.start)) return null;
      return {
        windowEnd,
        start: window.start,
        ids: rankEntries(window.taken, ranking()),
        pos: 0,
        last: !window.full,
      };
    }

    // The window at windowEnd, once the pull has filled it; null when the
    // pull cannot fill it now (paused, failed, or pulling in another tab).
    async function nextWindow(windowEnd) {
      for (;;) {
        // Listening first, so a change during the read is not missed.
        const changed = puller.waitForChange();
        const window = await readRanked(windowEnd);
        if (window || closed || !puller.isPulling()) return window;
        await changed;
      }
    }

    // The next ids to read in window mode, moving on to the next window
    // once the pull has filled it; null when the view runs out.
    async function nextWindowChunk() {
      while (!walk || walk.pos >= walk.ids.length) {
        if (closed) return null;
        if (walk?.last) {
          exhausted = true;
          return null;
        }
        const next = await nextWindow(walk ? walk.start : 0);
        if (!next) return null;
        walk = next;
      }
      const ids = walk.ids.slice(walk.pos, walk.pos + READ_CHUNK);
      const chunk = { ids, windowEnd: walk.windowEnd, rank: walk.pos };
      walk.pos += ids.length;
      return chunk;
    }

    // "Top of what's stored" as it opens: everything stored in full in the
    // range, ranked. Posts that a refresh stores above it later join the
    // next Browse or Start over, which rank everything stored at that
    // moment.
    async function openList() {
      const range = rangeBounds(view.range, nowSec());
      const stretch = firstStretch(range, record);
      const entries = await readRange(db, sub, stretch.start, stretch.end);
      list = {
        entries: rankedEntries(entries, ranking()),
        pos: 0,
        floor: stretch.start,
        handed: 0,
      };
    }

    // Ranks what the pull has stored below the list since, and slots it in
    // by score among the posts not handed to the viewer yet. The puller
    // keeps `record` current, also while another tab pulls. Resolves to
    // whether the whole range was stored by then, so that nothing more can
    // come.
    async function catchUp() {
      const range = rangeBounds(view.range, nowSec());
      const complete = rangeComplete(record, range.start);
      const stretch = newStretch(range.start, list.floor, record.bottom);
      if (stretch) {
        const entries = await readRange(db, sub, stretch.start, stretch.end);
        list.entries = mergeRanked(
          list.entries.slice(list.pos),
          rankedEntries(entries, ranking()),
        );
        list.pos = 0;
        list.floor = stretch.start;
      }
      return complete;
    }

    // The next ids to read in top mode: the best of the posts not handed
    // over yet, the latest arrivals included. When there are none, it waits
    // for the pull while the pull can bring more and the batch has nothing
    // to show yet; null when the view runs out, for good once the whole
    // range is stored.
    async function nextListChunk(batchShows) {
      if (!list) await openList();
      for (;;) {
        // Listening first, so a change during the read is not missed.
        const changed = puller.waitForChange();
        const complete = await catchUp();
        if (list.pos < list.entries.length) break;
        if (complete) {
          exhausted = true;
          return null;
        }
        if (batchShows || closed || !puller.isPulling()) return null;
        await changed;
      }
      const ids = list.entries
        .slice(list.pos, list.pos + READ_CHUNK)
        .map((entry) => entry.id);
      const chunk = { ids, windowEnd: 0, rank: list.handed };
      list.pos += ids.length;
      list.handed += ids.length;
      return chunk;
    }

    // Slides until the viewer's Show filter and Hidden list want
    // BATCH_WANTED of them, or BATCH_MAX_POSTS posts have been read, or the
    // view runs out.
    async function takeBatch(wants) {
      if (!dead) dead = await getDead(db, sub).catch(() => new Map());
      const slides = [];
      let unavailable = 0;
      let wanted = 0;
      let read = 0;
      while (
        !closed &&
        !exhausted &&
        wanted < BATCH_WANTED &&
        read < BATCH_MAX_POSTS
      ) {
        const chunk =
          view.mode === "top"
            ? await nextListChunk(wanted > 0)
            : await nextWindowChunk();
        if (!chunk) break;
        const posts = await getPosts(db, sub, chunk.ids);
        chunk.ids.forEach((id, offset) => {
          // A post can be gone, for one, when its archive was deleted.
          if (!posts[offset]) return;
          const result = postSlides(posts[offset], urls, dead.get(id));
          unavailable += result.unavailable;
          result.slides.forEach((slide) => {
            slide.archive.windowEnd = chunk.windowEnd;
            slide.archive.rank = chunk.rank + offset;
            slides.push(slide);
            if (wants(slide)) wanted += 1;
          });
        });
        read += chunk.ids.length;
      }
      return { slides, unavailable };
    }

    // Where a resume position lies among ranked posts: at the post it left
    // on, found by its id in case the ranking has moved since, or else at
    // its rank.
    function resumeIndex(found, length) {
      return found >= 0
        ? found
        : Math.min(Math.max(0, resume.rank || 0), length);
    }

    // Resume opens the view where it left off: in its window, or in the top
    // list ranked afresh over everything stored now, which then takes in
    // new arrivals as usual.
    async function start(wants) {
      if (resume && view.mode === "top") {
        await openList();
        list.pos = list.handed = resumeIndex(
          list.entries.findIndex((entry) => entry.id === resume.id),
          list.entries.length,
        );
      } else if (resume) {
        const window = await nextWindow(resume.windowEnd || 0);
        if (window) {
          window.pos = resumeIndex(
            window.ids.indexOf(resume.id),
            window.ids.length,
          );
          walk = window;
        }
      }
      return { ...(await takeBatch(wants)), index: 0 };
    }

    // The viewer may ask again before a batch has arrived, as after a
    // filter change, so batches are taken one at a time.
    function serialize(task) {
      const run = queue.then(task);
      queue = run.catch(() => {});
      return run;
    }

    function flush() {
      clearTimeout(resumeTimer);
      resumeTimer = null;
      if (!pendingResume) return;
      resumeSavedAt = Date.now();
      onResume(pendingResume);
      pendingResume = null;
    }

    return {
      kind: "archive",
      text: {
        preparing: ["Loading the archive…", "Ranking posts by score."],
        empty: [
          "Nothing to show here yet",
          "The archive is still being pulled, or nothing in this range reaches the minimum score. Widen the range, lower the minimum score, or resume the pull.",
        ],
      },
      start: ({ wants }) => serialize(() => start(wants)),
      loadMore: ({ wants }) => serialize(() => takeBatch(wants)),
      hasMore: () => !exhausted,
      // Remembered, so the next visit leaves the media out.
      onDead(slide) {
        const id = slide.archive?.id;
        if (!id || !dead) return;
        const mediaKey = urls.canonicalMediaKey(slide.url);
        if (!dead.has(id)) dead.set(id, new Set());
        dead.get(id).add(mediaKey);
        addDead(db, sub, id, mediaKey).catch(() => {});
      },
      // Where to resume, saved at most every CONFIG.resumeSaveMs, and when
      // the viewer closes or the page goes away.
      onShow(slide) {
        const place = slide.archive;
        if (!place) return;
        pendingResume = {
          key,
          windowEnd: place.windowEnd,
          rank: place.rank,
          id: place.id,
          at: Date.now(),
        };
        const wait = CONFIG.resumeSaveMs - (Date.now() - resumeSavedAt);
        if (wait <= 0) flush();
        else if (!resumeTimer) resumeTimer = setTimeout(flush, wait);
      },
      onClose() {
        closed = true;
        flush();
        onClosed();
      },
      // For the page: saves the resume position now, and stops the source
      // for good.
      flush,
      dispose() {
        closed = true;
        flush();
      },
    };
  }

  // The page's controls.
  const viewer = window.__redditpPresentation;
  const byId = (id) => document.getElementById(`redditp-archive-${id}`);
  const ui = {
    form: byId("open"),
    subInput: byId("sub"),
    error: byId("error"),
    panel: byId("panel"),
    name: byId("name"),
    stats: byId("stats"),
    progress: byId("progress"),
    status: byId("status"),
    retry: byId("retry"),
    rangeInputs: Array.from(
      document.querySelectorAll("input[name='redditp-archive-range']"),
    ),
    from: byId("from"),
    to: byId("to"),
    minScore: byId("min-score"),
    orderInputs: Array.from(
      document.querySelectorAll("input[name='redditp-archive-order']"),
    ),
    orderHint: byId("order-hint"),
    browse: byId("browse"),
    startOver: byId("start-over"),
    pause: byId("pause"),
    refresh: byId("refresh"),
    remove: byId("delete"),
    empty: byId("empty"),
    list: byId("list"),
    storage: byId("storage"),
  };
  // The status line counts these waits down.
  const COUNTDOWN_PHASES = ["limited", "offline", "server", "narrowing"];

  let db = null;
  // The selected archive: { record, puller }.
  let current = null;
  let selectRequest = 0;
  // An archive whose library row asked for a refresh before it was selected.
  let pendingRefresh = "";
  let renderQueued = false;
  let tickTimer = null;
  let libraryRequest = 0;
  let storageRequest = 0;
  let browseRequest = 0;
  // Archive name -> its library row.
  const rows = new Map();
  // The source the viewer was last opened on.
  let activeSource = null;
  // An archive named in the address when the page was opened, not
  // reloaded, opens by itself once its first window is ready, unless the
  // page has been used since.
  let autoOpen = false;

  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text) result.textContent = text;
    return result;
  }

  function button(text, label) {
    const result = element("button", "redditp-archive__button", text);
    result.type = "button";
    if (label) result.setAttribute("aria-label", label);
    return result;
  }

  function showError(text) {
    ui.error.textContent = text;
    ui.error.hidden = !text;
  }

  function postCount(count) {
    return `${formatCount(count)} ${count === 1 ? "post" : "posts"}`;
  }

  function newRecord(name, display) {
    return {
      name,
      display: display || name,
      createdAt: Date.now(),
      // The sub's first post, in seconds; 0 while unknown.
      earliest: 0,
      count: 0,
      // Everything from bottom up to top (seconds) is stored.
      top: 0,
      bottom: Infinity,
      // The pull reached the sub's first post.
      done: false,
      // The next request's `before`; 0 starts at now.
      cursorMs: 0,
      narrow: 0,
      // A refresh in progress: { cursorMs, stopAt, newTop }.
      refresh: null,
      refreshedAt: 0,
      lastPullAt: 0,
      paused: false,
      error: "",
      view: normalView({}),
      // Where browsing left off: { key, windowEnd, rank, id, at }.
      resume: null,
    };
  }

  // The archive the hash names: #r/<sub>, with an optional trailing slash.
  function hashTarget() {
    let text = location.hash.slice(1);
    try {
      text = decodeURIComponent(text);
    } catch (_error) {
      // Kept as it is.
    }
    text = text.trim();
    const match = /^\/?r\/([^/]*)\/?$/i.exec(text);
    return {
      text,
      key: match ? subKey(match[1]) : "",
      display: match ? match[1] : "",
    };
  }

  async function route() {
    const target = hashTarget();
    if (target.text && !target.key) {
      showError(
        `"${target.text}" does not name a subreddit. The address should end in #r/ and a name of 2 to 21 letters, digits or underscores.`,
      );
    } else {
      showError("");
    }
    await select(target.key, target.display);
  }

  function showArchive(display) {
    const hash = `#r/${display}`;
    if (location.hash === hash) void route();
    else location.hash = hash;
  }

  // Selects an archive, creating it when it is new, and starts its pull.
  // The previous one stops pulling.
  async function select(key, display) {
    if (current && current.record.name === key) return;
    const request = ++selectRequest;
    if (current) {
      closeViewer();
      current.puller.stop();
      current = null;
    }
    ui.panel.hidden = true;
    ui.browse.disabled = ui.startOver.disabled = true;
    scheduleRender();
    if (!key) return;
    let opened;
    try {
      opened = await openSub(db, newRecord(key, display));
    } catch (error) {
      showError(storageErrorText(error));
      return;
    }
    if (request !== selectRequest) return;
    const record = opened.record;
    record.view = normalView(record.view);
    if (opened.created) requestPersistence();
    current = { record, puller: createPuller(db, record, scheduleRender) };
    fillControls(record);
    ui.panel.hidden = false;
    current.puller.start().catch((error) => {
      showError(storageErrorText(error));
    });
    if (pendingRefresh === key) startRefresh();
    pendingRefresh = "";
    scheduleRender();
  }

  // Without persistent storage, the browser may clear the archives when
  // disk space runs low.
  function requestPersistence() {
    try {
      const asked = navigator.storage?.persist?.();
      if (asked && typeof asked.then === "function") {
        asked.then(scheduleRender, () => {});
      }
    } catch (_error) {
      // The footer says what the browser allows.
    }
  }

  function fillControls(record) {
    const view = record.view;
    ui.rangeInputs.forEach((input) => {
      input.checked = input.value === view.range.preset;
    });
    ui.from.value = view.range.from;
    ui.to.value = view.range.to;
    ui.minScore.value = String(view.minScore);
    ui.orderInputs.forEach((input) => {
      input.checked = input.value === view.mode;
    });
  }

  // Applies changes to the selected archive's record, stores them, and
  // wakes its pull, which may have more to do now.
  function updateRecord(changes) {
    if (!current) return;
    Object.assign(current.record, changes);
    patchSub(db, current.record.name, changes).catch((error) => {
      showError(storageErrorText(error));
    });
    current.puller.wake();
    scheduleRender();
  }

  // A new range, minimum score or order. A resume position saved in
  // another view no longer applies.
  function changeView(changes) {
    if (!current) return;
    const old = current.record.view;
    const view = normalView({
      ...old,
      ...changes,
      range: { ...old.range, ...changes.range },
    });
    const update = { view };
    const resume = current.record.resume;
    if (resume && resume.key !== viewKey(view)) update.resume = null;
    updateRecord(update);
  }

  function startRefresh() {
    if (!current || !current.record.top) return;
    updateRecord({
      refresh: {
        cursorMs: 0,
        stopAt: current.record.top - REFRESH_OVERLAP_SECONDS,
        newTop: 0,
      },
      paused: false,
      error: "",
    });
  }

  function refreshArchive(record) {
    if (current?.record.name === record.name) {
      startRefresh();
      return;
    }
    pendingRefresh = record.name;
    showArchive(record.display);
  }

  function viewerShowing() {
    const root = document.getElementById("redditp-presentation");
    return Boolean(root && !root.hidden);
  }

  // Closes the viewer, and stops the source it was showing for good.
  function closeViewer() {
    viewer.close();
    if (activeSource) activeSource.dispose();
    activeSource = null;
  }

  // Opens the viewer on the selected archive in its chosen view: where
  // browsing last left off in that view, or from the top.
  async function browse(fromResume) {
    if (!current) return;
    const { record, puller } = current;
    closeViewer();
    autoOpen = false;
    const view = normalView(record.view);
    const resume =
      fromResume && record.resume?.key === viewKey(view) ? record.resume : null;
    activeSource = createArchiveSource({
      record,
      puller,
      view,
      resume,
      onResume(value) {
        record.resume = value;
        patchSub(db, record.name, { resume: value }).catch(() => {});
      },
      onClosed() {
        if (!ui.panel.hidden && !ui.browse.disabled) ui.browse.focus();
      },
    });
    await viewer.open(activeSource);
  }

  function startOver() {
    if (!current) return;
    updateRecord({ resume: null });
    void browse(false);
  }

  // Browse needs something to show: the view's first window, ready once it
  // holds a full window of posts, or, for "Top of what's stored", a single
  // post of the range stored in full; the posts are counted without reading
  // them. Either is ready once the pull has passed the start of the range.
  // An archive without a single post has nothing to browse. The top order
  // can be chosen whenever it could be browsed.
  async function syncBrowse() {
    if (!current) return;
    const request = ++browseRequest;
    const { record } = current;
    const view = record.view;
    const range = rangeBounds(view.range, Math.floor(Date.now() / 1000));
    const complete = record.count > 0 && rangeComplete(record, range.start);
    let stored = 0;
    if (!complete) {
      const stretch = firstStretch(range, record);
      stored = await countRange(
        db,
        record.name,
        stretch.start,
        stretch.end,
      ).catch(() => 0);
    }
    if (request !== browseRequest || current?.record !== record) return;
    const topReady = complete || stored > 0;
    const ready =
      view.mode === "top" ? topReady : complete || stored >= CONFIG.windowSize;
    const top = ui.orderInputs.find((input) => input.value === "top");
    top.disabled = !topReady && !top.checked;
    ui.browse.disabled = ui.startOver.disabled = !ready;
    if (ready && autoOpen && !viewerShowing()) void browse(true);
  }

  async function removeArchive(name) {
    const record =
      current?.record.name === name
        ? current.record
        : await getSub(db, name).catch(() => null);
    if (!record) return;
    if (
      !window.confirm(
        `Delete the r/${record.display} archive and its ${formatCount(record.count)} stored ${record.count === 1 ? "post" : "posts"}?`,
      )
    ) {
      return;
    }
    if (current?.record.name === name) {
      closeViewer();
      current.puller.stop();
      current = null;
      selectRequest += 1;
      ui.panel.hidden = true;
      // Clearing the hash this way fires no hashchange.
      history.replaceState(null, "", location.pathname + location.search);
    }
    try {
      await deleteSub(db, name);
    } catch (error) {
      showError(storageErrorText(error));
    }
    scheduleRender();
  }

  function onOpenSubmit(event) {
    event.preventDefault();
    const display = ui.subInput.value.trim().replace(/^\/?r\//i, "");
    if (!subKey(display)) {
      showError(
        "A subreddit's name has 2 to 21 letters, digits or underscores.",
      );
      return;
    }
    showError("");
    showArchive(display.replace(/\/+$/, ""));
  }

  function bindControls() {
    ui.form.addEventListener("submit", onOpenSubmit);
    ui.rangeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        changeView({ range: { preset: input.value } });
      });
    });
    [ui.from, ui.to].forEach((input) => {
      input.addEventListener("change", () => {
        changeView({ range: { from: ui.from.value, to: ui.to.value } });
      });
    });
    ui.minScore.addEventListener("change", () => {
      changeView({ minScore: ui.minScore.value });
      ui.minScore.value = String(current?.record.view.minScore ?? 0);
    });
    ui.orderInputs.forEach((input) => {
      input.addEventListener("change", () => changeView({ mode: input.value }));
    });
    ui.retry.addEventListener("click", () => updateRecord({ error: "" }));
    ui.pause.addEventListener("click", () => {
      if (current) updateRecord({ paused: !current.record.paused });
    });
    ui.refresh.addEventListener("click", startRefresh);
    ui.remove.addEventListener("click", () => {
      if (current) void removeArchive(current.record.name);
    });
    ui.browse.addEventListener("click", () => void browse(true));
    ui.startOver.addEventListener("click", startOver);
    // Using the page in any way cancels its opening the viewer by itself.
    ["pointerdown", "keydown", "input", "change"].forEach((type) => {
      document.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) autoOpen = false;
        },
        true,
      );
    });
  }

  function statusText(record, state, now) {
    const seconds = Math.max(1, Math.ceil((state.until - now) / 1000));
    switch (state.phase) {
      case "elsewhere":
        return "Pulling in another tab";
      case "paused":
        return "Paused";
      case "hidden":
        return "Paused while this tab is hidden";
      case "failed":
        return `Stopped: the archive answered "${record.error}"`;
      case "limited":
        return `Waiting: the archive asked us to slow down (retrying in ${seconds} s)`;
      case "offline":
        return `Offline or unreachable, retrying in ${seconds} s`;
      case "server":
        return `The archive is having trouble (${state.detail}), retrying in ${seconds} s`;
      case "narrowing":
        return `The archive took too long, asking for less in ${seconds} s`;
      case "refreshing":
        return "Refreshing the newest posts…";
      case "pulling":
        return (
          (Number.isFinite(record.bottom)
            ? `Pulling… back to ${formatMonth(record.bottom)}`
            : "Pulling…") + slowedText(state.paceMs)
        );
      case "idle":
        if (!record.done) {
          return `This date range is stored, back to ${formatMonth(record.bottom)}`;
        }
        return record.count
          ? `Complete back to ${formatMonth(record.bottom)}`
          : `Arctic Shift has no posts for r/${record.display}`;
      default:
        return "Starting…";
    }
  }

  // What the status adds while a rate limit keeps the pull slower.
  function slowedText(paceMs) {
    if (!(paceMs > CONFIG.requestIntervalMs)) return "";
    const seconds = Math.round(paceMs / 100) / 10;
    return ` (slowed to one request every ${seconds} s after a rate limit)`;
  }

  // The library row's word for how far the pull is.
  function progressText(record, now) {
    if (record.error) return "stopped by an error";
    if (record.paused) return "paused";
    const range = rangeBounds(
      normalView(record.view).range,
      Math.floor(now / 1000),
    );
    const progress = pullProgress(record, range.start);
    if (progress === 1) return "complete";
    if (progress === null) return record.top ? "in progress" : "not started";
    return `${Math.floor(progress * 100)}%`;
  }

  function renderPanel(now) {
    if (!current) return;
    const { record, puller } = current;
    const range = rangeBounds(record.view.range, Math.floor(now / 1000));
    ui.name.textContent = `r/${record.display}`;
    ui.stats.textContent = [
      postCount(record.count),
      formatSpan(record.bottom, record.top),
      `refreshed ${formatAgo(record.refreshedAt || record.createdAt, now)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const progress = pullProgress(record, range.start);
    if (progress === null) ui.progress.removeAttribute("value");
    else ui.progress.value = progress;
    ui.status.textContent = statusText(record, puller.state, now);
    ui.retry.hidden = puller.state.phase !== "failed";
    ui.pause.textContent = record.paused ? "Resume" : "Pause";
    ui.refresh.disabled = !record.top || Boolean(record.refresh);
    ui.from.disabled = ui.to.disabled = record.view.range.preset !== "custom";
    ui.orderHint.textContent = orderHint(record, range);
    void syncBrowse();
  }

  // What "Top of what's stored" would rank if it opened now.
  function orderHint(record, range) {
    const stretch = firstStretch(range, record);
    if (!(stretch.start < stretch.end)) {
      return "Ranks everything stored so far, once the pull has stored posts from this date range.";
    }
    const text = `Ranks everything stored so far, back to ${formatMonth(stretch.start)}`;
    return rangeComplete(record, range.start)
      ? `${text} · complete`
      : `${text}. The pull keeps running, and posts that arrive while you browse are slotted in by score among those you have not seen yet.`;
  }

  function createRow(name) {
    const row = {
      item: element("li", "redditp-archive__item"),
      link: element("a", "redditp-archive__item-name"),
      count: element("span", "redditp-archive__item-count"),
      span: element("span", "redditp-archive__item-span"),
      refreshed: element("span", "redditp-archive__item-refreshed"),
      progress: element("span", "redditp-archive__item-progress"),
      open: button("Open"),
      refresh: button("Refresh"),
      pause: button("Pause"),
      remove: button("Delete"),
      record: null,
    };
    const facts = element("p", "redditp-archive__item-facts");
    facts.append(row.count, row.span, row.refreshed, row.progress);
    const actions = element("div", "redditp-archive__item-actions");
    actions.append(row.open, row.refresh, row.pause, row.remove);
    row.item.append(row.link, facts, actions);
    row.open.addEventListener("click", () => showArchive(row.record.display));
    row.refresh.addEventListener("click", () => refreshArchive(row.record));
    row.pause.addEventListener("click", () => {
      if (current?.record.name === name) {
        updateRecord({ paused: !current.record.paused });
      }
    });
    row.remove.addEventListener("click", () => void removeArchive(name));
    rows.set(name, row);
    return row;
  }

  function fillRow(row, record, now) {
    const name = `r/${record.display}`;
    const selected = current?.record.name === record.name;
    row.record = record;
    row.item.classList.toggle("redditp-archive__item--selected", selected);
    row.link.href = `#r/${record.display}`;
    row.link.textContent = name;
    row.count.textContent = postCount(record.count);
    row.span.textContent = formatSpan(record.bottom, record.top);
    row.span.hidden = !row.span.textContent;
    row.refreshed.textContent = `refreshed ${formatAgo(record.refreshedAt || record.createdAt, now)}`;
    row.progress.textContent = progressText(record, now);
    row.pause.hidden = !selected;
    row.pause.textContent = record.paused ? "Resume" : "Pause";
    row.refresh.disabled = !record.top || Boolean(record.refresh);
    row.open.setAttribute("aria-label", `Open ${name}`);
    row.refresh.setAttribute("aria-label", `Refresh ${name}`);
    row.pause.setAttribute("aria-label", `${row.pause.textContent} ${name}`);
    row.remove.setAttribute("aria-label", `Delete ${name}`);
  }

  // The library: every stored archive, most recently pulled first. Rows are
  // updated in place, so a focused button keeps its focus.
  async function renderLibrary(now) {
    const request = ++libraryRequest;
    let records;
    try {
      records = await listSubs(db);
    } catch (_error) {
      return;
    }
    if (request !== libraryRequest) return;
    if (current) {
      // This tab's copy of the selected archive is the newest.
      const index = records.findIndex(
        (record) => record.name === current.record.name,
      );
      if (index >= 0) records[index] = current.record;
    }
    const recent = (record) => record.lastPullAt || record.createdAt || 0;
    records.sort((a, b) => recent(b) - recent(a) || (a.name < b.name ? -1 : 1));
    const names = new Set(records.map((record) => record.name));
    rows.forEach((row, name) => {
      if (names.has(name)) return;
      row.item.remove();
      rows.delete(name);
    });
    records.forEach((record, index) => {
      const row = rows.get(record.name) || createRow(record.name);
      fillRow(row, record, now);
      if (ui.list.children[index] !== row.item) {
        ui.list.insertBefore(row.item, ui.list.children[index] || null);
      }
    });
    ui.empty.hidden = records.length > 0;
    void renderStorage();
  }

  async function renderStorage() {
    const storage = navigator.storage;
    if (!storage || typeof storage.estimate !== "function") return;
    const request = ++storageRequest;
    try {
      const estimate = await storage.estimate();
      const persisted =
        typeof storage.persisted === "function"
          ? await storage.persisted()
          : true;
      if (request !== storageRequest) return;
      ui.storage.textContent =
        `Stored on this device: ${formatBytes(estimate.usage)}, of ${formatBytes(estimate.quota)} the browser allows this page.` +
        (persisted
          ? ""
          : " The browser may clear archives when disk space runs low.");
      ui.storage.hidden = false;
    } catch (_error) {
      ui.storage.hidden = true;
    }
  }

  // Repaints once per turn of the event loop, however many changes asked
  // for it: about once per request, and once a second while a countdown
  // shows.
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    Promise.resolve().then(() => {
      renderQueued = false;
      const now = Date.now();
      renderPanel(now);
      void renderLibrary(now);
      clearTimeout(tickTimer);
      tickTimer = null;
      const state = current?.puller.state;
      if (
        state &&
        COUNTDOWN_PHASES.includes(state.phase) &&
        state.until > now
      ) {
        tickTimer = setTimeout(scheduleRender, 1000);
      }
    });
  }

  async function init() {
    // Settled before anything waits: whether the address named an archive
    // as the page opened, rather than reloaded.
    const navigation =
      typeof performance.getEntriesByType === "function"
        ? performance.getEntriesByType("navigation")[0]
        : null;
    autoOpen = Boolean(hashTarget().key) && navigation?.type !== "reload";
    if (!viewer || typeof viewer.open !== "function" || !viewer.media) {
      showError("The viewer did not load.");
      return;
    }
    if (typeof indexedDB === "undefined" || !indexedDB) {
      showError("This browser does not let the page store archives.");
      return;
    }
    try {
      db = await openDb(() => {
        showError("Close this page's other tabs so its storage can update.");
      });
    } catch (error) {
      showError(storageErrorText(error));
      return;
    }
    db.onversionchange = () => {
      db.close();
      current?.puller.stop();
      showError("The archive was updated in another tab. Reload this page.");
    };
    bindControls();
    window.addEventListener("hashchange", () => void route());
    document.addEventListener("visibilitychange", () => {
      current?.puller.wake();
    });
    window.addEventListener("pagehide", () => activeSource?.flush());
    await route();
    scheduleRender();
  }

  void init();
})();
