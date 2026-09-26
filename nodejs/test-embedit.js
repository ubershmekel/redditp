const assert = require("assert");
const embedit = require("../js/EmbedIt");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  PASS:", name);
    passed++;
  } catch (e) {
    console.error("  FAIL:", name);
    console.error("      ", e.message);
    failed++;
  }
}

function suite(name, fn) {
  console.log("\n" + name);
  fn();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides) {
  return {
    kind: "t3",
    data: {
      url: "https://example.com/image.jpg",
      title: "Test Title",
      over_18: false,
      subreddit: "pics",
      permalink: "/r/pics/comments/abc/test/",
      author: "test-user",
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// gfyUrlToId
// ---------------------------------------------------------------------------

suite("gfyUrlToId", () => {
  test("parses standard gfycat URL", () => {
    assert.strictEqual(
      embedit.gfyUrlToId("https://gfycat.com/EntireForkedArachnid"),
      "EntireForkedArachnid",
    );
  });

  test("parses gifs/detail variant", () => {
    assert.strictEqual(
      embedit.gfyUrlToId("https://gfycat.com/gifs/detail/EntireForkedArachnid"),
      "EntireForkedArachnid",
    );
  });

  test("returns false for non-gfycat URL", () => {
    assert.strictEqual(embedit.gfyUrlToId("https://example.com/foo"), false);
  });
});

// ---------------------------------------------------------------------------
// redGifUrlToId
// ---------------------------------------------------------------------------

suite("redGifUrlToId", () => {
  test("parses /watch/ URL", () => {
    assert.strictEqual(
      embedit.redGifUrlToId("https://www.redgifs.com/watch/gaseousoblongant"),
      "gaseousoblongant",
    );
  });

  test("parses URL with trailing slash", () => {
    assert.strictEqual(
      embedit.redGifUrlToId("https://www.redgifs.com/watch/gaseousoblongant/"),
      "gaseousoblongant",
    );
  });

  test("parses hyphenated slug", () => {
    assert.strictEqual(
      embedit.redGifUrlToId(
        "https://www.redgifs.com/watch/palatableflashybantamrooster-nature",
      ),
      "palatableflashybantamrooster-nature",
    );
  });

  test("parses /ifr/ embed URL", () => {
    assert.strictEqual(
      embedit.redGifUrlToId("https://redgifs.com/ifr/unhappyfluidgrassspider"),
      "unhappyfluidgrassspider",
    );
  });

  test("returns false for non-redgifs URL", () => {
    assert.strictEqual(
      embedit.redGifUrlToId("https://example.com/watch/something"),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// redditItemToPic — URL type handling via transformRedditData
// ---------------------------------------------------------------------------

suite("YouTube links", () => {
  const id = "M7lc1UVf-VE";
  const links = [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?feature=shared&v=${id}&t=90`,
    `http://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}&list=ignored`,
    `https://youtu.be/${id}?si=shared`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://youtube.com/v/${id}`,
  ];
  links.forEach((url) => {
    test(`accepts ${url}`, () => {
      assert.strictEqual(embedit.youtubeVideo(url).id, id);
      const pic = embedit.redditItemToPic(makeItem({ url }));
      assert.strictEqual(pic.type, embedit.imageTypes.youtube);
      assert.strictEqual(pic.url, url, "preserves original source link");
    });
  });
  const invalid = [
    `https://youtube.com.evil.example/watch?v=${id}`,
    `https://notyoutube.com/watch?v=${id}`,
    `https://evil.youtube.com/watch?v=${id}`,
    `https://youtube.com@evil.example/watch?v=${id}`,
    `https://example.com/youtube.com/watch?v=${id}`,
    `ftp://youtube.com/watch?v=${id}`,
    "https://youtube.com/playlist?list=PL123",
    "https://youtube.com/@channel",
    "https://youtube.com/watch?v=short",
    `https://youtu.be/${id}extra`,
    `https://youtube.com/embed/${id}/extra`,
    "https://youtube.com/watch?v=%22%3E%3Cscript%3E",
    "not a url",
  ];
  invalid.forEach((url) => {
    test(`rejects ${url}`, () => {
      assert.strictEqual(embedit.youtubeVideo(url), null);
      assert.strictEqual(embedit.redditItemToPic(makeItem({ url })), null);
    });
  });
  for (const [suffix, seconds] of [
    ["?t=90", 90],
    ["?t=1h2m3s", 3723],
    ["?t=2m", 120],
    ["?start=45&t=90", 45],
    ["#t=1m30s", 90],
    ["?t=-1", 0],
    ["?t=bogus", 0],
    ["", 0],
  ]) {
    test(`timestamp ${suffix || "absent"}`, () => {
      assert.strictEqual(
        embedit.youtubeVideo(`https://youtu.be/${id}${suffix}`).start,
        seconds,
      );
    });
  }
});

suite("redditItemToPic — plain image extensions", () => {
  for (const ext of ["jpg", "jpeg", "png", "gif", "bmp"]) {
    test(`accepts .${ext} URL`, () => {
      const pic = embedit.redditItemToPic(
        makeItem({ url: `https://example.com/photo.${ext}` }),
      );
      assert.ok(pic, `expected pic for .${ext}`);
      assert.strictEqual(pic.url, `https://example.com/photo.${ext}`);
    });
  }

  test("rejects URL with no recognised extension", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://example.com/not-an-image" }),
    );
    assert.strictEqual(pic, null);
  });
});

suite("redditItemToPic — gfycat", () => {
  test("sets type to gfycat", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://gfycat.com/SomeCoolGif" }),
    );
    assert.ok(pic);
    assert.strictEqual(pic.type, embedit.imageTypes.gfycat);
  });

  test("upgrades http to https", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "http://gfycat.com/SomeCoolGif" }),
    );
    assert.ok(pic);
    assert.ok(pic.url.startsWith("https://"), "url should be https");
  });
});

suite("redditItemToPic — redgifs", () => {
  test("sets type to redgif", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://www.redgifs.com/watch/coolclip" }),
    );
    assert.ok(pic);
    assert.strictEqual(pic.type, embedit.imageTypes.redgif);
  });

  test("upgrades http to https", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "http://www.redgifs.com/watch/coolclip" }),
    );
    assert.ok(pic);
    assert.ok(pic.url.startsWith("https://"), "url should be https");
  });
});

suite("redditItemToPic — v.redd.it", () => {
  test("extracts fallback_url from media", () => {
    const fallback = "https://v.redd.it/abc123/DASH_720.mp4?source=fallback";
    const pic = embedit.redditItemToPic(
      makeItem({
        url: "https://v.redd.it/abc123",
        media: {
          reddit_video: {
            fallback_url: fallback,
          },
        },
      }),
    );
    assert.ok(pic);
    assert.strictEqual(pic.url, fallback);
  });

  test("sets sound URL based on fallback_url path", () => {
    const fallback = "https://v.redd.it/abc123/DASH_720.mp4?source=fallback";
    const pic = embedit.redditItemToPic(
      makeItem({
        url: "https://v.redd.it/abc123",
        media: {
          reddit_video: {
            fallback_url: fallback,
          },
        },
      }),
    );
    assert.ok(pic);
    assert.ok(
      pic.sound.includes("DASH_audio.mp4"),
      "sound should point to DASH_audio.mp4",
    );
  });

  test("extracts fallback_url from crosspost_parent_list", () => {
    const fallback = "https://v.redd.it/crosspost/DASH_480.mp4?source=fallback";
    const pic = embedit.redditItemToPic(
      makeItem({
        url: "https://v.redd.it/crosspost",
        crosspost_parent_list: [
          {
            media: {
              reddit_video: {
                fallback_url: fallback,
              },
            },
          },
        ],
      }),
    );
    assert.ok(pic);
    assert.strictEqual(pic.url, fallback);
  });

  test("returns null when neither media nor crosspost available", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://v.redd.it/abc123" }),
    );
    assert.strictEqual(pic, null);
  });
});

suite("redditItemToPic — imgur gifv", () => {
  test("accepts imgur gifv URL", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://i.imgur.com/abcde.gifv" }),
    );
    assert.ok(pic);
  });

  test("accepts imgur gif URL", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://i.imgur.com/abcde.gif" }),
    );
    assert.ok(pic);
  });

  test("upgrades http imgur gifv to https", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "http://i.imgur.com/abcde.gifv" }),
    );
    assert.ok(pic);
    assert.ok(pic.url.startsWith("https://"), "url should be https");
  });
});

suite("redditItemToPic — imgur (no extension)", () => {
  test("appends .jpg to bare imgur URL via tryConvertUrl", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://imgur.com/abcde" }),
    );
    assert.ok(pic);
    assert.ok(pic.url.endsWith(".jpg"), "url should end in .jpg");
  });

  test("returns null for imgur album (/a/) URL", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://imgur.com/a/somealbum" }),
    );
    assert.strictEqual(pic, null);
  });

  test("returns null for imgur /gallery/ URL", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://imgur.com/gallery/somethingorother" }),
    );
    assert.strictEqual(pic, null);
  });
});

suite("redditItemToPic — reddit.com/gallery", () => {
  function makeGalleryItem(items, mediaMetadata) {
    return makeItem({
      url: "https://www.reddit.com/gallery/xyz123",
      gallery_data: { items },
      media_metadata: mediaMetadata,
    });
  }

  test("extracts first image URL from gallery metadata", () => {
    const pic = embedit.redditItemToPic(
      makeGalleryItem([{ media_id: "img001", id: 1 }], {
        img001: {
          m: "image/jpg",
          s: { u: "https://preview.redd.it/img001.jpg?width=2000" },
        },
      }),
    );
    assert.ok(pic);
    assert.ok(pic.url.includes("img001"), "url should reference img001");
  });

  test("decodes HTML entities in gallery URL", () => {
    const pic = embedit.redditItemToPic(
      makeGalleryItem([{ media_id: "img001", id: 1 }], {
        img001: {
          m: "image/jpg",
          s: {
            u: "https://preview.redd.it/img001.jpg?width=2000&amp;auto=webp",
          },
        },
      }),
    );
    assert.ok(pic);
    assert.ok(!pic.url.includes("&amp;"), "url should not contain &amp;");
    assert.ok(pic.url.includes("&auto=webp"), "url should have decoded &");
  });

  test("sets type to gifv when only mp4 key available", () => {
    const pic = embedit.redditItemToPic(
      makeGalleryItem([{ media_id: "vid001", id: 1 }], {
        vid001: {
          m: "image/gif",
          s: { mp4: "https://preview.redd.it/vid001.mp4?width=2000" },
        },
      }),
    );
    assert.ok(pic);
    assert.strictEqual(pic.type, embedit.imageTypes.gifv);
  });
});

suite("redditItemToPic — reddit post link rejected", () => {
  test("rejects reddit.com/r/ post URL", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ url: "https://reddit.com/r/pics/comments/abc/my_post/" }),
    );
    assert.strictEqual(pic, null);
  });
});

suite("redditItemToPic — pic metadata", () => {
  test("preserves title", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ title: "My Awesome Photo", url: "https://example.com/x.jpg" }),
    );
    assert.strictEqual(pic.title, "My Awesome Photo");
  });

  test("preserves over18 flag (true)", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ over_18: true, url: "https://example.com/x.jpg" }),
    );
    assert.strictEqual(pic.over18, true);
  });

  test("preserves over18 flag (false)", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ over_18: false, url: "https://example.com/x.jpg" }),
    );
    assert.strictEqual(pic.over18, false);
  });

  test("preserves subreddit", () => {
    const pic = embedit.redditItemToPic(
      makeItem({ subreddit: "aww", url: "https://example.com/x.jpg" }),
    );
    assert.strictEqual(pic.subreddit, "aww");
  });

  test("builds commentsLink from permalink", () => {
    const pic = embedit.redditItemToPic(
      makeItem({
        permalink: "/r/pics/comments/abc123/my_post/",
        url: "https://example.com/x.jpg",
      }),
    );
    assert.ok(
      pic.commentsLink.includes("/r/pics/comments/abc123/"),
      "commentsLink should include permalink",
    );
  });
});

// ---------------------------------------------------------------------------
// processRedditJson
// ---------------------------------------------------------------------------

suite("processRedditJson", () => {
  test("extracts children from listing", () => {
    const data = {
      kind: "Listing",
      data: {
        after: "t3_next",
        children: [{ kind: "t3", data: { url: "https://example.com/a.jpg" } }],
      },
    };
    const result = embedit.processRedditJson(data);
    assert.strictEqual(result.children.length, 1);
    assert.strictEqual(result.after, "t3_next");
  });

  test("after is null when no more pages", () => {
    const data = {
      kind: "Listing",
      data: {
        after: null,
        children: [],
      },
    };
    const result = embedit.processRedditJson(data);
    assert.strictEqual(result.after, null);
  });

  test("handles single-post page (two-element array)", () => {
    const singlePostData = [
      {
        kind: "Listing",
        data: {
          after: null,
          children: [
            {
              kind: "t3",
              data: { url: "https://example.com/post.jpg", title: "A Post" },
            },
          ],
        },
      },
      {
        kind: "Listing",
        data: { after: null, children: [] }, // comments listing
      },
    ];
    const result = embedit.processRedditJson(singlePostData);
    assert.strictEqual(result.children.length, 1);
  });

  test("processes real reddit-image-v2.json fixture", () => {
    const redditJson = require("../test-data/reddit-image-v2.json");
    const { children } = embedit.processRedditJson(redditJson[0]);
    assert.ok(children.length > 0, "should have children");

    const pics = children.map(embedit.redditItemToPic).filter(Boolean);
    assert.ok(pics.length > 0, "should produce at least one pic");

    const first = pics[0];
    assert.ok(first.title, "pic should have a title");
    assert.ok(first.url, "pic should have a url");
    assert.ok(first.subreddit, "pic should have a subreddit");
  });
});

// ---------------------------------------------------------------------------
// archiveFilenameForPath — reddit request path -> bucket object name
// ---------------------------------------------------------------------------

suite("archiveFilenameForPath — default sort", () => {
  test("plain subreddit", () => {
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/gifs/.json"),
      "r-gifs.json",
    );
  });

  test("bare /r/ becomes r.json", () => {
    assert.strictEqual(embedit.archiveFilenameForPath("/r/.json"), "r.json");
  });

  test("site root becomes root.json, distinct from bare /r/", () => {
    assert.strictEqual(embedit.archiveFilenameForPath("/.json"), "root.json");
  });

  test("subreddit name is lowercased, so any casing finds the snapshot", () => {
    // Reddit paths are case-insensitive but bucket object names are not.
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/EarthPorn/.json"),
      "r-earthporn.json",
    );
  });

  test("multireddit casing does not change sort order or hash", () => {
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/B+a+C+d+E+f/.json"),
      embedit.archiveFilenameForPath("/r/a+b+c+d+e+f/.json"),
    );
  });
});

suite("archiveFilenameForPath — multireddits", () => {
  test("short combo is sorted, so any order gives one file", () => {
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/celebs+celebnsfw/.json"),
      embedit.archiveFilenameForPath("/r/celebnsfw+celebs/.json"),
    );
  });

  test("combo over 5 subs is truncated to a preview plus a hash", () => {
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/b+a+c+d+e+f+g/.json"),
      "r-a+b+c+d+e-ab284527.json",
    );
  });

  test("combos sharing their first 5 subs do not collide", () => {
    // The whole reason the hash exists — a preview alone would map both of
    // these onto "r-a+b+c+d+e.json" and one would silently overwrite the
    // other in the bucket.
    assert.notStrictEqual(
      embedit.archiveFilenameForPath("/r/a+b+c+d+e+f/.json"),
      embedit.archiveFilenameForPath("/r/a+b+c+d+e+g/.json"),
    );
  });
});

suite("archiveFilenameForPath — top listings", () => {
  test("each time window is its own file", () => {
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/gifs/top/.json?t=month"),
      "r-gifs-top-t-month.json",
    );
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/gifs/top/.json?t=year"),
      "r-gifs-top-t-year.json",
    );
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/gifs/top/.json?t=all"),
      "r-gifs-top-t-all.json",
    );
  });

  test("top window never collides with the default-sort file", () => {
    assert.notStrictEqual(
      embedit.archiveFilenameForPath("/r/gifs/top/.json?t=all"),
      embedit.archiveFilenameForPath("/r/gifs/.json"),
    );
  });

  test("query params are sorted, so param order does not matter", () => {
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/gifs/.json?b=2&a=1"),
      embedit.archiveFilenameForPath("/r/gifs/.json?a=1&b=2"),
    );
  });

  test("multireddit top listing combines both rules", () => {
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/celebs+celebnsfw/top/.json?t=all"),
      "r-celebnsfw+celebs-2e7e104d-top-t-all.json",
    );
  });

  test("path separators cannot escape the flat bucket namespace", () => {
    // Object names are flat by design; a value that decodes to a slash must
    // not turn into a nested path or climb out of the prefix.
    const name = embedit.archiveFilenameForPath("/r/gifs/.json?x=%2F..%2Fetc");
    assert.ok(!name.includes("/"), "should not contain a slash: " + name);
  });
});

// ---------------------------------------------------------------------------
// archiveMatchesPath — which requests the archive is allowed to answer
// ---------------------------------------------------------------------------

suite("archiveMatchesPath — eligible", () => {
  test("plain subreddit", () => {
    assert.strictEqual(embedit.archiveMatchesPath("/r/gifs/", "", null), true);
  });

  test("site root", () => {
    assert.strictEqual(embedit.archiveMatchesPath("/", "", null), true);
  });

  test("multireddit", () => {
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/celebs+celebnsfw/", "", null),
      true,
    );
  });

  test("top with each snapshotted window", () => {
    ["month", "year", "all"].forEach((window) => {
      assert.strictEqual(
        embedit.archiveMatchesPath("/r/gifs/top/", "t=" + window, null),
        true,
        "expected t=" + window + " to match",
      );
    });
  });
});

suite("archiveMatchesPath — ineligible", () => {
  test("pagination is never archived", () => {
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/gifs/", "", "t3_abc123"),
      false,
    );
  });

  test("random subreddits are meant to differ per request", () => {
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/random/", "", null),
      false,
    );
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/randnsfw/", "", null),
      false,
    );
  });

  test("unsnapshotted top windows do not fall back to a nearby one", () => {
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/gifs/top/", "t=hour", null),
      false,
    );
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/gifs/top/", "t=week", null),
      false,
    );
  });

  test("other sorts are not archived", () => {
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/gifs/new/", "", null),
      false,
    );
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/gifs/controversial/", "t=all", null),
      false,
    );
  });

  test("t= is only meaningful on a top listing", () => {
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/gifs/", "t=all", null),
      false,
    );
  });

  test("extra query params disqualify an otherwise-eligible path", () => {
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/gifs/top/", "t=all&limit=100", null),
      false,
    );
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/gifs/", "limit=100", null),
      false,
    );
  });

  test("top listing needs a subreddit", () => {
    assert.strictEqual(
      embedit.archiveMatchesPath("/r/top/", "t=all", null),
      // "/r/top/" is the default-sort shape for a subreddit named "top",
      // not a top listing — and with a t= param it matches nothing.
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Filename parity with the snapshot tool
//
// archive/extension/background.js computes the same filenames when writing
// the bucket's contents that the frontend computes when reading them, from
// two separate copies of the algorithm. Nothing at runtime would catch them
// drifting apart: the frontend would just start requesting names that were
// never uploaded and quietly get 404s. So the two are compared directly.
// ---------------------------------------------------------------------------

// Everything in background.js above fetchOne() is chrome-API-free, so it can
// be evaluated standalone here. Returns null if the marker is gone, which
// the suites below assert on rather than silently skipping their checks.
const EXTENSION_MARKER = "async function fetchOne";

function loadExtensionHelpers() {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "../archive/extension/background.js"),
    "utf8",
  );
  const prelude = source.split(EXTENSION_MARKER)[0];
  if (prelude.length === source.length) return null;
  return new Function(
    prelude +
      "\nreturn { pathToFilename: pathToFilename, listingUrl: listingUrl };",
  )();
}

suite("filename parity with archive/extension/background.js", () => {
  const extension = loadExtensionHelpers();

  test("extension helpers could be loaded", () => {
    // Guards the split above: if background.js is restructured so the marker
    // disappears, this fails loudly instead of silently skipping the parity
    // checks below.
    assert.ok(
      extension,
      "did not find '" + EXTENSION_MARKER + "' in background.js",
    );
  });

  const paths = [
    "/.json",
    "/r/.json",
    "/r/gifs/.json",
    "/r/EarthPorn/.json",
    "/r/gifs/top/.json?t=month",
    "/r/gifs/top/.json?t=year",
    "/r/gifs/top/.json?t=all",
    "/r/celebs+celebnsfw/.json",
    "/r/celebs+celebnsfw/top/.json?t=all",
    "/r/b+a+c+d+e+f+g/top/.json?t=all",
    "/r/gifs/.json?a=1&b=2",
  ];

  paths.forEach((urlPath) => {
    test("agrees on " + urlPath, () => {
      assert.ok(extension, "extension helpers not loaded");
      // The extension prefixes the download folder; the bucket is flat.
      const written = extension
        .pathToFilename(urlPath)
        .replace("redditp-snapshot/", "");
      assert.strictEqual(embedit.archiveFilenameForPath(urlPath), written);
    });
  });
});

// ---------------------------------------------------------------------------
// listingUrl — the human-openable page recorded inside each saved file
//
// Shares the parity suite's loader; declared after it so `extension` exists.
// ---------------------------------------------------------------------------

suite("listingUrl", () => {
  const extension = loadExtensionHelpers();

  test("drops the .json view segment", () => {
    assert.strictEqual(
      extension.listingUrl("/r/gifs/.json"),
      "https://www.reddit.com/r/gifs",
    );
  });

  test("keeps the sort and time window a reader would need", () => {
    assert.strictEqual(
      extension.listingUrl("/r/gifs/top/.json?t=month"),
      "https://www.reddit.com/r/gifs/top?t=month",
    );
  });

  test("normalizes the host, so it does not vary per run", () => {
    // The file's fetch_url records which host actually served the bytes;
    // this one has to mean the same thing regardless of that choice.
    assert.ok(
      extension
        .listingUrl("/r/gifs/.json")
        .startsWith("https://www.reddit.com/"),
    );
  });

  test("site root stays a valid URL", () => {
    assert.strictEqual(
      extension.listingUrl("/.json"),
      "https://www.reddit.com/",
    );
  });

  test("multireddit keeps its raw + form, not the hashed filename form", () => {
    assert.strictEqual(
      extension.listingUrl("/r/celebs+celebnsfw/top/.json?t=all"),
      "https://www.reddit.com/r/celebs+celebnsfw/top?t=all",
    );
  });
});

// ---------------------------------------------------------------------------
// DOM-free blocks of the browser extension's scripts
//
// The content script is one IIFE, but its grid layout math, its media filter
// rules, its feed loading rules and its media URL rules each sit between two
// markers and touch no DOM, so each block can be evaluated here on its own.
// Other scripts in browser-extension/ can mark blocks the same way.
// ---------------------------------------------------------------------------

// Evaluates the block between "// <name>:start" and "// <name>:end" in a
// script of browser-extension/, content.js unless another file is named, and
// returns the named functions and constants. Returns null if the markers are
// gone, which each suite's first test asserts on rather than silently
// skipping its checks.
function loadContentScriptBlock(name, exportNames, file = "content.js") {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "../browser-extension", file),
    "utf8",
  );
  const start = source.indexOf(`// ${name}:start`);
  const end = source.indexOf(`// ${name}:end`);
  if (start < 0 || end < start) return null;
  return new Function(
    '"use strict";\n' +
      source.slice(start, end) +
      `\nreturn { ${exportNames.join(", ")} };`,
  )();
}

suite("browser-extension grid layout", () => {
  const grid = loadContentScriptBlock("redditp-grid-layout", [
    "gridColumnCount",
    "shortestColumn",
    "tileHeightRatio",
    "layoutColumns",
  ]);

  test("grid layout helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      grid,
      "did not find the redditp-grid-layout markers in content.js",
    );
  });

  test("column count follows the width", () => {
    assert.ok(grid, "grid layout helpers not loaded");
    [
      [360, 2],
      [390, 2],
      [393, 2],
      [412, 2],
      [899, 2],
      [900, 3],
      [1280, 4],
      [1920, 6],
      [2400, 8],
      [2560, 8],
      [3840, 8],
    ].forEach(([width, columns]) => {
      assert.strictEqual(grid.gridColumnCount(width), columns, `${width}px`);
    });
  });

  test("an unknown width gets two columns", () => {
    assert.ok(grid, "grid layout helpers not loaded");
    [0, NaN, undefined, Infinity].forEach((width) => {
      assert.strictEqual(grid.gridColumnCount(width), 2, String(width));
    });
  });

  test("ties go to the first shortest column", () => {
    assert.ok(grid, "grid layout helpers not loaded");
    assert.strictEqual(grid.shortestColumn([0, 0, 0]), 0);
    assert.strictEqual(grid.shortestColumn([2, 1, 1]), 1);
    assert.strictEqual(grid.shortestColumn([1.5, 2, 0.75, 0.75]), 2);
    assert.deepStrictEqual(
      grid.layoutColumns([1, 1, 1, 1], 2).columns,
      [0, 1, 0, 1],
    );
  });

  test("each tile goes to the shortest column so far", () => {
    assert.ok(grid, "grid layout helpers not loaded");
    assert.deepStrictEqual(grid.layoutColumns([2, 1, 1, 0.5], 2), {
      columns: [0, 1, 1, 0],
      heights: [2.5, 2],
    });
  });

  test("appending tiles never moves the ones already placed", () => {
    assert.ok(grid, "grid layout helpers not loaded");
    const heights = [1, 0.75, 2, 0.5, 1.3, 1, 0.9, 2, 0.6, 1.1, 0.75, 1.5];
    [2, 3, 4, 6, 8].forEach((columnCount) => {
      for (let count = 0; count < heights.length; count += 1) {
        const before = grid.layoutColumns(heights.slice(0, count), columnCount);
        const after = grid.layoutColumns(
          heights.slice(0, count + 1),
          columnCount,
        );
        assert.deepStrictEqual(
          after.columns.slice(0, count),
          before.columns,
          `${columnCount} columns, tile ${count + 1}`,
        );
      }
    });
  });

  test("tile heights are clamped, and an unknown size starts square", () => {
    assert.ok(grid, "grid layout helpers not loaded");
    assert.strictEqual(grid.tileHeightRatio(800, 600), 0.75);
    assert.strictEqual(grid.tileHeightRatio(600, 900), 1.5);
    assert.strictEqual(grid.tileHeightRatio(100, 1000), 2);
    assert.strictEqual(grid.tileHeightRatio(1000, 100), 0.5);
    [
      [0, 600],
      [800, 0],
      [NaN, 600],
      [800, undefined],
      [undefined, undefined],
      [-5, 10],
    ].forEach(([width, height]) => {
      assert.strictEqual(
        grid.tileHeightRatio(width, height),
        1,
        `${width}x${height}`,
      );
    });
  });
});

suite("browser-extension media filter", () => {
  const filter = loadContentScriptBlock("redditp-media-filter", [
    "mediaCategory",
    "mediaFilterActive",
    "slideMatchesFilter",
    "mediaFilterSummary",
    "shownMediaLabel",
    "nextMediaFilter",
    "lockedMediaType",
  ]);
  const shows = (images, gifs, videos) => ({
    showImages: images,
    showGifs: gifs,
    showVideos: videos,
  });
  const ALL = shows(true, true, true);
  const NONE = shows(false, false, false);
  const IMAGES_ONLY = shows(true, false, false);
  const GIFS_ONLY = shows(false, true, false);
  const VIDEOS_ONLY = shows(false, false, true);
  const NO_IMAGES = shows(false, true, true);
  const NO_GIFS = shows(true, false, true);
  const NO_VIDEOS = shows(true, true, false);

  // Slides the way extractSlides tags them. Reddit's own players are added
  // without postMedia; an embed from the post's link is its own media.
  const image = { kind: "image", media: "image", postMedia: true };
  const gif = { kind: "image", media: "gif", postMedia: true };
  const redditVideo = { kind: "video", media: "video", postMedia: false };
  const gifVideo = { kind: "video", media: "gif", postMedia: true };
  const embed = { kind: "embed", media: "video", postMedia: true };
  const link = { kind: "link", media: "link" };
  const linkPreview = { kind: "image", media: "image", postMedia: false };
  const searchThumbnail = {
    kind: "image",
    media: "image",
    postMedia: false,
    needsEnrichment: true,
    mediaUnknown: true,
  };
  const feedLinkPreview = {
    kind: "image",
    media: "image",
    postMedia: false,
    needsEnrichment: true,
    mediaUnknown: false,
  };

  function assertShown(settings, expected) {
    Object.keys(expected).forEach((name) => {
      const slide = {
        image,
        gif,
        redditVideo,
        gifVideo,
        embed,
        link,
        linkPreview,
        searchThumbnail,
        feedLinkPreview,
      }[name];
      assert.strictEqual(
        filter.slideMatchesFilter(slide, settings),
        expected[name],
        name,
      );
    });
  }

  test("media filter helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      filter,
      "did not find the redditp-media-filter markers in content.js",
    );
  });

  test("each kind of slide gets a media type", () => {
    assert.ok(filter, "media filter helpers not loaded");
    [
      ["image", "https://i.redd.it/a.jpg", false, "image"],
      ["image", "https://i.redd.it/a.gif", false, "gif"],
      ["image", "https://i.redd.it/A.GIF", false, "gif"],
      [
        "image",
        "https://preview.redd.it/a.gif?width=640&format=png8&s=x",
        false,
        "gif",
      ],
      ["image", "https://i.imgur.com/a.gifv", false, "image"],
      ["video", "https://i.imgur.com/a.mp4", true, "gif"],
      [
        "video",
        "https://external-preview.redd.it/a.gif?format=mp4&s=x",
        false,
        "gif",
      ],
      ["video", "https://v.redd.it/a/DASH_480.mp4", false, "video"],
      ["native-video", "https://www.reddit.com/r/a/", undefined, "video"],
      ["pending-native-video", "https://v.redd.it/a", undefined, "video"],
      ["embed", "https://www.youtube.com/embed/a", false, "video"],
      ["link", "https://example.com/story", undefined, "link"],
      ["something-new", "", undefined, "link"],
    ].forEach(([kind, url, fromGif, expected]) => {
      assert.strictEqual(
        filter.mediaCategory(kind, url, fromGif),
        expected,
        `${kind} ${url}`,
      );
    });
  });

  test("the filter is active unless every type is on", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assert.strictEqual(filter.mediaFilterActive(ALL), false);
    [IMAGES_ONLY, NO_GIFS, NO_VIDEOS, NONE].forEach((settings) => {
      assert.strictEqual(filter.mediaFilterActive(settings), true);
    });
  });

  test("every slide shows while every type is on", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assertShown(ALL, {
      image: true,
      gif: true,
      redditVideo: true,
      gifVideo: true,
      embed: true,
      link: true,
      linkPreview: true,
      searchThumbnail: true,
      feedLinkPreview: true,
    });
  });

  test("images only hides GIFs, videos and link posts", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assertShown(IMAGES_ONLY, {
      image: true,
      gif: false,
      redditVideo: false,
      gifVideo: false,
      embed: false,
      link: false,
    });
  });

  test("GIFs include videos converted from a GIF", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assertShown(GIFS_ONLY, {
      image: false,
      gif: true,
      gifVideo: true,
      redditVideo: false,
      embed: false,
    });
  });

  test("Reddit's own players and embeds count as videos", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assertShown(VIDEOS_ONLY, {
      redditVideo: true,
      embed: true,
      image: false,
      gif: false,
      gifVideo: false,
      link: false,
    });
  });

  test("a search thumbnail shows until its post is read", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assertShown(VIDEOS_ONLY, { searchThumbnail: true, feedLinkPreview: false });
    assertShown(IMAGES_ONLY, { searchThumbnail: true, feedLinkPreview: false });
  });

  test("a link post's preview picture is not an image", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assertShown(IMAGES_ONLY, { linkPreview: false, image: true });
    assertShown(NO_VIDEOS, { linkPreview: false });
    assertShown(GIFS_ONLY, { linkPreview: false });
    assert.strictEqual(
      filter.slideMatchesFilter(
        { kind: "image", media: "gif", postMedia: false },
        GIFS_ONLY,
      ),
      false,
    );
    assertShown(ALL, { linkPreview: true });
  });

  test("hiding one type keeps the other two", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assertShown(NO_VIDEOS, {
      image: true,
      gif: true,
      gifVideo: true,
      redditVideo: false,
      embed: false,
      link: false,
    });
    assertShown(NO_IMAGES, { image: false, gif: true, redditVideo: true });
  });

  test("the counter names what the filter shows", () => {
    assert.ok(filter, "media filter helpers not loaded");
    [
      [ALL, ""],
      [NONE, ""],
      [IMAGES_ONLY, "images only"],
      [GIFS_ONLY, "GIFs only"],
      [VIDEOS_ONLY, "videos only"],
      [NO_IMAGES, "no images"],
      [NO_GIFS, "no GIFs"],
      [NO_VIDEOS, "no videos"],
    ].forEach(([settings, summary]) => {
      assert.strictEqual(filter.mediaFilterSummary(settings), summary);
    });
  });

  test("the shown types read as a list", () => {
    assert.ok(filter, "media filter helpers not loaded");
    assert.strictEqual(filter.shownMediaLabel(IMAGES_ONLY, "or"), "images");
    assert.strictEqual(filter.shownMediaLabel(VIDEOS_ONLY, "and"), "videos");
    assert.strictEqual(
      filter.shownMediaLabel(NO_VIDEOS, "or"),
      "images or GIFs",
    );
    assert.strictEqual(
      filter.shownMediaLabel(NO_GIFS, "and"),
      "images and videos",
    );
    assert.strictEqual(
      filter.shownMediaLabel(ALL, "and"),
      "images, GIFs and videos",
    );
  });

  test("O cycles all, images, GIFs, videos and back to all", () => {
    assert.ok(filter, "media filter helpers not loaded");
    let settings = ALL;
    [IMAGES_ONLY, GIFS_ONLY, VIDEOS_ONLY, ALL].forEach((expected) => {
      settings = filter.nextMediaFilter(settings);
      assert.deepStrictEqual(settings, expected);
    });
  });

  test("O from any other mix shows everything", () => {
    assert.ok(filter, "media filter helpers not loaded");
    [NO_IMAGES, NO_GIFS, NO_VIDEOS, NONE].forEach((settings) => {
      assert.deepStrictEqual(filter.nextMediaFilter(settings), ALL);
    });
  });

  test("only the one type left on is locked", () => {
    assert.ok(filter, "media filter helpers not loaded");
    [ALL, NO_IMAGES, NO_GIFS, NO_VIDEOS, NONE].forEach((settings) => {
      assert.strictEqual(
        filter.lockedMediaType(settings),
        "",
        JSON.stringify(settings),
      );
    });
    [
      [IMAGES_ONLY, "showImages"],
      [GIFS_ONLY, "showGifs"],
      [VIDEOS_ONLY, "showVideos"],
    ].forEach(([settings, key]) => {
      assert.strictEqual(filter.lockedMediaType(settings), key, key);
    });
  });
});

suite("browser-extension feed loading", () => {
  const loading = loadContentScriptBlock("redditp-feed-loading", [
    "loadVerdict",
    "LOAD_NUDGE_MS",
    "LOAD_IDLE_MS",
    "FILTERED_MAX_ROUNDS",
    "prefetchWanted",
    "preloadUrls",
    "rememberBounded",
    "PREFETCH_AHEAD",
    "PREFETCH_ROUNDS",
    "PRELOAD_AHEAD",
    "PRELOAD_CACHE_SIZE",
    "sourceVerdict",
  ]);

  test("feed loading helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      loading,
      "did not find the redditp-feed-loading markers in content.js",
    );
  });

  test("a load nudges Reddit every second and waits twelve seconds", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    assert.strictEqual(loading.LOAD_NUDGE_MS, 1000);
    assert.strictEqual(loading.LOAD_IDLE_MS, 12000);
    assert.strictEqual(loading.FILTERED_MAX_ROUNDS, 15);
  });

  test("a post to show ends the load whatever else happened", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    assert.strictEqual(loading.loadVerdict(1, 99, 99999), "matched");
  });

  test("fifteen batches without a match end a filtered load", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    assert.strictEqual(loading.loadVerdict(0, 15, 0), "rounds");
  });

  test("twelve seconds without a new post end the load", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    assert.strictEqual(loading.loadVerdict(0, 0, 12000), "idle");
  });

  test("otherwise the load keeps waiting", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    assert.strictEqual(loading.loadVerdict(0, 14, 11999), "wait");
    assert.strictEqual(loading.loadVerdict(0, 0, 0), "wait");
  });

  test("a load from another source ends at once when it has nothing new", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const verdict = loading.sourceVerdict;
    assert.strictEqual(verdict(1, 0, 0, true), "matched");
    assert.strictEqual(verdict(0, 0, 0, true), "idle");
    assert.strictEqual(verdict(0, 5, 0, false), "idle");
    assert.strictEqual(verdict(0, 5, 15, true), "rounds");
    assert.strictEqual(verdict(0, 5, 14, true), "wait");
  });

  test("the slideshow loads within eight slides, up to four loads in a row", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    assert.strictEqual(loading.PREFETCH_AHEAD, 8);
    assert.strictEqual(loading.PREFETCH_ROUNDS, 4);
    assert.strictEqual(loading.PRELOAD_AHEAD, 3);
    assert.strictEqual(loading.PRELOAD_CACHE_SIZE, 6);
  });

  test("loading starts when fewer than eight slides are left", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const wanted = loading.prefetchWanted;
    assert.strictEqual(wanted(20, 0, false, false), false);
    assert.strictEqual(wanted(20, 11, false, false), false);
    assert.strictEqual(wanted(20, 12, false, false), true);
  });

  test("an ended feed loads again only from its last post", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const wanted = loading.prefetchWanted;
    assert.strictEqual(wanted(20, 12, false, true), false);
    assert.strictEqual(wanted(20, 19, true, true), true);
    assert.strictEqual(wanted(30, 0, true, false), true);
  });

  test("nothing loads ahead of an empty slideshow", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    assert.strictEqual(loading.prefetchWanted(0, 0, false, false), false);
    assert.strictEqual(loading.prefetchWanted(0, 0, true, false), false);
  });

  test("the next three slides' pictures are fetched ahead", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const slides = [
      { kind: "image", url: "https://i.redd.it/current.jpg" },
      { kind: "image", url: "https://i.redd.it/next.jpg" },
      {
        kind: "video",
        url: "https://v.redd.it/clip/DASH_480.mp4",
        poster: "https://external-preview.redd.it/clip.png",
      },
      {
        kind: "pending-native-video",
        url: "https://v.redd.it/live",
        poster: "https://external-preview.redd.it/live.png",
      },
      { kind: "image", url: "https://i.redd.it/fourth-ahead.jpg" },
    ];
    assert.deepStrictEqual(loading.preloadUrls(slides, 0), [
      "https://i.redd.it/next.jpg",
      "https://external-preview.redd.it/clip.png",
      "https://external-preview.redd.it/live.png",
    ]);
    assert.deepStrictEqual(loading.preloadUrls(slides, 1), [
      "https://external-preview.redd.it/clip.png",
      "https://external-preview.redd.it/live.png",
      "https://i.redd.it/fourth-ahead.jpg",
    ]);
  });

  test("players, embeds, cards and unread thumbnails are not fetched", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const slides = [
      { kind: "image", url: "https://i.redd.it/current.jpg" },
      {
        kind: "native-video",
        url: "https://www.reddit.com/r/a/",
        poster: "https://external-preview.redd.it/native.png",
      },
      {
        kind: "embed",
        url: "https://www.youtube.com/embed/a",
        poster: "https://external-preview.redd.it/embed.png",
      },
      { kind: "link", url: "https://example.com/story", poster: "" },
      { kind: "video", url: "https://v.redd.it/b/DASH_480.mp4", poster: "" },
      {
        kind: "image",
        url: "https://external-preview.redd.it/thumb.png",
        needsEnrichment: true,
      },
    ];
    assert.deepStrictEqual(loading.preloadUrls(slides, 0), []);
    assert.deepStrictEqual(loading.preloadUrls(slides, 2), []);
  });

  test("a picture repeated in a gallery is fetched once", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const same = { kind: "image", url: "https://i.redd.it/same.jpg" };
    assert.deepStrictEqual(loading.preloadUrls([same, same, same, same], 0), [
      "https://i.redd.it/same.jpg",
    ]);
  });

  test("the last slide has nothing ahead to fetch", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const slides = [
      { kind: "image", url: "https://i.redd.it/a.jpg" },
      { kind: "image", url: "https://i.redd.it/b.jpg" },
    ];
    assert.deepStrictEqual(loading.preloadUrls(slides, 1), []);
    assert.deepStrictEqual(loading.preloadUrls([], 0), []);
  });

  test("the preload cache keeps the newest entries", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const map = new Map();
    const evicted = [];
    for (let number = 1; number <= 8; number += 1) {
      evicted.push(
        ...loading.rememberBounded(map, `key${number}`, `value${number}`, 6),
      );
    }
    assert.deepStrictEqual(evicted, ["value1", "value2"]);
    assert.deepStrictEqual(
      [...map.keys()],
      ["key3", "key4", "key5", "key6", "key7", "key8"],
    );
  });

  test("storing an entry again refreshes it and drops nothing", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const map = new Map();
    ["a", "b", "c"].forEach((key) => {
      loading.rememberBounded(map, key, key.toUpperCase(), 3);
    });
    assert.deepStrictEqual(loading.rememberBounded(map, "a", "A", 3), []);
    assert.deepStrictEqual([...map.keys()], ["b", "c", "a"]);
  });
});

suite("browser-extension media URLs", () => {
  const urls = loadContentScriptBlock("redditp-media-urls", [
    "IMAGE_URL_RE",
    "VIDEO_URL_RE",
    "isVideoUrl",
    "canonicalMediaKey",
    "externalMedia",
    "embedUrl",
    "youtubeStartSeconds",
  ]);

  test("media URL helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      urls,
      "did not find the redditp-media-urls markers in content.js",
    );
  });

  test("imgur GIFs and GIFVs play as the MP4 the host converts them to", () => {
    assert.ok(urls, "media URL helpers not loaded");
    ["https://i.imgur.com/a1.gifv", "https://i.imgur.com/a1.gif"].forEach(
      (url) => {
        assert.deepStrictEqual(
          urls.externalMedia(url),
          { kind: "video", url: "https://i.imgur.com/a1.mp4", fromGif: true },
          url,
        );
      },
    );
  });

  test("an imgur page stands for its picture", () => {
    assert.ok(urls, "media URL helpers not loaded");
    assert.deepStrictEqual(urls.externalMedia("https://imgur.com/a1"), {
      kind: "image",
      url: "https://i.imgur.com/a1.jpg",
    });
  });

  test("imgur albums and galleries have no single picture", () => {
    assert.ok(urls, "media URL helpers not loaded");
    ["https://imgur.com/a/a1", "https://imgur.com/gallery/a1"].forEach(
      (url) => {
        assert.strictEqual(urls.externalMedia(url), null, url);
      },
    );
  });

  test("YouTube links become the player that answers the sound toggle", () => {
    assert.ok(urls, "media URL helpers not loaded");
    [
      [
        "https://www.youtube.com/watch?v=abc&t=1m5s",
        "https://www.youtube.com/embed/abc?start=65&enablejsapi=1",
      ],
      [
        "https://youtu.be/abc",
        "https://www.youtube.com/embed/abc?enablejsapi=1",
      ],
      [
        "https://m.youtube.com/watch?v=abc",
        "https://www.youtube.com/embed/abc?enablejsapi=1",
      ],
      [
        "https://www.youtube.com/shorts/abc",
        "https://www.youtube.com/embed/abc?enablejsapi=1",
      ],
    ].forEach(([url, embed]) => {
      assert.deepStrictEqual(
        urls.externalMedia(url),
        { kind: "embed", url: embed },
        url,
      );
    });
  });

  test("a /watch/<id> page becomes the same host's /ifr/<id> frame", () => {
    assert.ok(urls, "media URL helpers not loaded");
    assert.deepStrictEqual(
      urls.externalMedia("https://videohost.example/watch/abc-1"),
      { kind: "embed", url: "https://videohost.example/ifr/abc-1" },
    );
  });

  test("other links have no media of their own", () => {
    assert.ok(urls, "media URL helpers not loaded");
    ["https://example.com", "https://example.com/story", "not a url"].forEach(
      (url) => {
        assert.strictEqual(urls.externalMedia(url), null, url);
      },
    );
  });

  test("video files are told from pictures", () => {
    assert.ok(urls, "media URL helpers not loaded");
    [
      "https://v.redd.it/a/DASH_480.mp4",
      "https://i.imgur.com/a1.webm",
      "https://v.redd.it/a/HLSPlaylist.m3u8",
      "https://external-preview.redd.it/a.gif?format=mp4&s=x",
    ].forEach((url) => {
      assert.strictEqual(urls.isVideoUrl(url), true, url);
    });
    ["https://i.redd.it/a.jpg", "not a url"].forEach((url) => {
      assert.strictEqual(urls.isVideoUrl(url), false, url);
    });
    assert.ok(urls.IMAGE_URL_RE.test("https://i.redd.it/a.webp?width=640"));
    assert.ok(!urls.IMAGE_URL_RE.test("https://i.redd.it/a.mp4"));
    assert.ok(urls.VIDEO_URL_RE.test("https://v.redd.it/a/DASH_480.mp4#t=1"));
  });

  test("two URLs of the same file share a key", () => {
    assert.ok(urls, "media URL helpers not loaded");
    assert.strictEqual(
      urls.canonicalMediaKey("https://I.REDD.IT/Some/Photo.JPG?width=640&s=x"),
      "i.redd.it/some/photo.jpg",
    );
    assert.strictEqual(
      urls.canonicalMediaKey("https://i.redd.it/some/photo.jpg"),
      "i.redd.it/some/photo.jpg",
    );
    assert.strictEqual(urls.canonicalMediaKey("not a url"), "not a url");
  });

  test("a player frame is asked to autoplay, muted unless sound is on", () => {
    assert.ok(urls, "media URL helpers not loaded");
    const embed = "https://www.youtube.com/embed/abc?enablejsapi=1";
    assert.strictEqual(
      urls.embedUrl(embed, true),
      `${embed}&autoplay=1&muted=1&mute=1&sound=false`,
    );
    assert.strictEqual(
      urls.embedUrl(embed, false),
      `${embed}&autoplay=1&sound=true`,
    );
  });

  test("YouTube start times read as seconds", () => {
    assert.ok(urls, "media URL helpers not loaded");
    [
      ["90", 90],
      ["1m5s", 65],
      ["1h2m3s", 3723],
      ["", 0],
      [null, 0],
      ["soon", 0],
    ].forEach(([value, seconds]) => {
      assert.strictEqual(urls.youtubeStartSeconds(value), seconds, value);
    });
  });
});

suite("browser-extension dead media", () => {
  const dead = loadContentScriptBlock("redditp-dead-media", [
    "PLACEHOLDER_IMAGES",
    "isPlaceholderImage",
    "dropsWhenDead",
    "countSuffix",
  ]);

  test("dead media helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      dead,
      "did not find the redditp-dead-media markers in content.js",
    );
  });

  test("the hosts' placeholder pictures are told by host and exact size", () => {
    assert.ok(dead, "dead media helpers not loaded");
    [
      ["https://i.redd.it/gone.jpg", 130, 60, true],
      ["https://i.redd.it/gone.jpg", 130, 61, false],
      ["https://i.redd.it/gone.jpg", 131, 60, false],
      ["https://i.imgur.com/gone.jpg", 161, 81, true],
      ["https://imgur.com/gone", 161, 81, true],
      ["https://i.imgur.com/gone.jpg", 161, 80, false],
      ["https://preview.redd.it/gone.jpg", 130, 60, true],
      ["https://external-preview.redd.it/gone.jpg", 130, 60, true],
      ["https://preview.redd.it/gone.jpg", 130, 59, false],
      ["https://example.com/gone.jpg", 130, 60, false],
      ["https://v.redd.it/gone.jpg", 130, 60, false],
      ["https://i.imgur.com/gone.jpg", 130, 60, false],
      ["https://i.redd.it/gone.jpg", 161, 81, false],
      ["not a url", 130, 60, false],
    ].forEach(([url, width, height, expected]) => {
      assert.strictEqual(
        dead.isPlaceholderImage(url, width, height),
        expected,
        `${url} ${width}x${height}`,
      );
    });
  });

  test("only a slide's own picture or video leaves when it fails", () => {
    assert.ok(dead, "dead media helpers not loaded");
    const image = { kind: "image", url: "https://i.redd.it/a.jpg" };
    const video = { kind: "video", url: "https://v.redd.it/a/DASH_480.mp4" };
    assert.strictEqual(dead.dropsWhenDead(image), true, "image");
    assert.strictEqual(dead.dropsWhenDead(video), true, "video");
    [
      ["search thumbnail", { ...image, needsEnrichment: true }],
      ["embed", { kind: "embed", url: "https://www.youtube.com/embed/a" }],
      ["link", { kind: "link", url: "https://example.com/story" }],
      ["native video", { kind: "native-video", url: "https://v.redd.it/a" }],
      [
        "pending native video",
        { kind: "pending-native-video", url: "https://v.redd.it/a" },
      ],
      [
        "stream",
        { kind: "video", url: "https://v.redd.it/a/HLSPlaylist.m3u8" },
      ],
      [
        "stream with a query",
        { kind: "video", url: "https://v.redd.it/a/HLSPlaylist.m3u8?a=1" },
      ],
    ].forEach(([name, slide]) => {
      assert.strictEqual(dead.dropsWhenDead(slide), false, name);
    });
  });

  test("the counter names the filter, then the failures, then the load", () => {
    assert.ok(dead, "dead media helpers not loaded");
    [
      ["", 0, false, ""],
      ["images only", 0, false, " · images only"],
      ["", 1, false, " · 1 unavailable"],
      ["", 0, true, " · loading more"],
      ["images only", 2, false, " · images only · 2 unavailable"],
      ["images only", 0, true, " · images only · loading more"],
      ["", 3, true, " · 3 unavailable · loading more"],
      ["images only", 1, true, " · images only · 1 unavailable · loading more"],
    ].forEach(([summary, unavailable, loading, expected]) => {
      assert.strictEqual(
        dead.countSuffix(summary, unavailable, loading),
        expected,
        JSON.stringify([summary, unavailable, loading]),
      );
    });
  });

  test("two placeholders are known, Reddit's and imgur's", () => {
    assert.ok(dead, "dead media helpers not loaded");
    assert.deepStrictEqual(
      dead.PLACEHOLDER_IMAGES.map(({ width, height }) => [width, height]),
      [
        [130, 60],
        [161, 81],
      ],
    );
  });
});

// Subreddit listings, each with the subreddit it names.
const SUBREDDIT_LISTING_PATHS = [
  ["/r/pics/", "pics"],
  ["/r/pics", "pics"],
  ["/r/Pics/top/", "Pics"],
  ["/r/pics/new/", "pics"],
  ["/r/pics/search/", "pics"],
  ["/r/de/", "de"],
  ["/r/pics_2/", "pics_2"],
];

// Post pages, multireddits, the front pages that gather many subreddits, and
// other pages, none of which names a subreddit.
const NON_SUBREDDIT_PATHS = [
  "/r/pics/comments/abc/title/",
  "/r/pics/comments/abc",
  "/r/a+b/",
  "/r/all/",
  "/r/popular/",
  "/r/Friends/",
  "/r/mod/",
  "/r/random/",
  "/r/x/",
  `/r/${"a".repeat(22)}/`,
  "/user/someone/",
  "/",
  "/search/",
  "",
  undefined,
];

suite("browser-extension subreddit path", () => {
  const paths = loadContentScriptBlock("redditp-subreddit-path", [
    "ARCHIVE_PSEUDO_SUBS",
    "subredditFromPath",
  ]);

  test("subreddit path helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      paths,
      "did not find the redditp-subreddit-path markers in content.js",
    );
  });

  test("a subreddit listing names its subreddit, spelled as in the path", () => {
    assert.ok(paths, "subreddit path helpers not loaded");
    SUBREDDIT_LISTING_PATHS.forEach(([pathname, sub]) => {
      assert.strictEqual(paths.subredditFromPath(pathname), sub, pathname);
    });
  });

  test("post pages, multireddits, front pages and other pages name none", () => {
    assert.ok(paths, "subreddit path helpers not loaded");
    NON_SUBREDDIT_PATHS.forEach((pathname) => {
      assert.strictEqual(
        paths.subredditFromPath(pathname),
        "",
        String(pathname),
      );
    });
  });

  test("a name of up to 21 characters is a subreddit", () => {
    assert.ok(paths, "subreddit path helpers not loaded");
    const longest = "a".repeat(21);
    assert.strictEqual(paths.subredditFromPath(`/r/${longest}/`), longest);
  });

  test("the front pages that gather many subreddits are listed lowercase", () => {
    assert.ok(paths, "subreddit path helpers not loaded");
    assert.deepStrictEqual(paths.ARCHIVE_PSEUDO_SUBS, [
      "all",
      "popular",
      "friends",
      "mod",
      "random",
    ]);
  });
});

// auto-activate.js shows the archive icon from its own copy of the block, so
// the icon must appear exactly where content.js enables the archive button.
suite("subreddit path parity", () => {
  const inContent = loadContentScriptBlock("redditp-subreddit-path", [
    "subredditFromPath",
  ]);
  const inLauncher = loadContentScriptBlock(
    "redditp-subreddit-path",
    ["subredditFromPath"],
    "auto-activate.js",
  );

  test("both copies could be loaded", () => {
    assert.ok(
      inContent,
      "did not find the redditp-subreddit-path markers in content.js",
    );
    assert.ok(
      inLauncher,
      "did not find the redditp-subreddit-path markers in auto-activate.js",
    );
  });

  test("the archive button and the archive icon name the same subreddit", () => {
    assert.ok(inContent && inLauncher, "subreddit path helpers not loaded");
    const longest = "a".repeat(21);
    [
      ...SUBREDDIT_LISTING_PATHS,
      [`/r/${longest}/`, longest],
      ...NON_SUBREDDIT_PATHS.map((pathname) => [pathname, ""]),
    ].forEach(([pathname, sub]) => {
      const fromContent = inContent.subredditFromPath(pathname);
      assert.strictEqual(
        inLauncher.subredditFromPath(pathname),
        fromContent,
        String(pathname),
      );
      assert.strictEqual(fromContent, sub, String(pathname));
    });
  });

  test("auto-activate.js carries the block of content.js word for word", () => {
    const fs = require("fs");
    const path = require("path");
    function block(file) {
      const source = fs
        .readFileSync(
          path.join(__dirname, "../browser-extension", file),
          "utf8",
        )
        .replace(/\r\n/g, "\n");
      return source.slice(
        source.indexOf("// redditp-subreddit-path:start"),
        source.indexOf("// redditp-subreddit-path:end"),
      );
    }
    assert.ok(block("content.js").length > 0, "block not found");
    assert.strictEqual(block("auto-activate.js"), block("content.js"));
  });
});

// ---------------------------------------------------------------------------
// browser-extension/background.js messages
//
// background.js runs whole, against a stand-in for the extension API that
// records what it is asked to do.
// ---------------------------------------------------------------------------

function loadBackground() {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "../browser-extension/background.js"),
    "utf8",
  );
  const calls = { create: [], insertCSS: [], executeScript: [] };
  const listeners = {};
  const record = (name) => (details) => {
    calls[name].push(details);
    return Promise.resolve({ id: 99 });
  };
  const fakeApi = {
    action: {
      onClicked: { addListener: (listener) => (listeners.clicked = listener) },
      setBadgeBackgroundColor: () => Promise.resolve(),
      setBadgeText: () => Promise.resolve(),
      setTitle: () => Promise.resolve(),
    },
    commands: {
      onCommand: { addListener: (listener) => (listeners.command = listener) },
    },
    runtime: {
      getURL: (file) => "chrome-extension://test/" + file,
      onMessage: { addListener: (listener) => (listeners.message = listener) },
    },
    scripting: {
      insertCSS: record("insertCSS"),
      executeScript: record("executeScript"),
    },
    tabs: {
      create: record("create"),
      query: () => Promise.resolve([]),
    },
  };
  // With globalThis shadowed, globalThis.browser is undefined, so the script
  // takes the stand-in as chrome.
  new Function("chrome", "globalThis", source)(fakeApi, {});
  return { calls, listeners };
}

suite("browser-extension background messages", () => {
  let loaded = null;
  try {
    loaded = loadBackground();
  } catch (_error) {
    // The first test reports it.
  }

  test("background.js could be loaded with a stand-in extension API", () => {
    assert.ok(loaded, "background.js threw while loading");
    assert.strictEqual(typeof loaded.listeners.message, "function");
    assert.strictEqual(typeof loaded.listeners.clicked, "function");
    assert.strictEqual(typeof loaded.listeners.command, "function");
  });

  test("open-archive opens the archive page in a new tab next to the asking tab", () => {
    const { calls, listeners } = loadBackground();
    const answer = listeners.message(
      { type: "open-archive", sub: "pics" },
      { tab: { id: 7, index: 2 } },
    );
    assert.strictEqual(answer, undefined);
    assert.deepStrictEqual(calls.create, [
      {
        url: "chrome-extension://test/archive.html#r/pics",
        index: 3,
        openerTabId: 7,
      },
    ]);
    assert.deepStrictEqual(calls.insertCSS, []);
  });

  test("the new tab opens in the window of the asking tab, with the name as sent", () => {
    const { calls, listeners } = loadBackground();
    listeners.message(
      { type: "open-archive", sub: "Pics_2" },
      { tab: { id: 7, index: 0, windowId: 4 } },
    );
    listeners.message({ type: "open-archive", sub: "pics" }, {});
    assert.deepStrictEqual(calls.create, [
      {
        url: "chrome-extension://test/archive.html#r/Pics_2",
        windowId: 4,
        index: 1,
        openerTabId: 7,
      },
      { url: "chrome-extension://test/archive.html#r/pics" },
    ]);
  });

  test("a name that is not a subreddit name opens nothing", () => {
    const { calls, listeners } = loadBackground();
    [
      "a+b",
      "",
      "x",
      "a".repeat(22),
      "pics/new",
      "pics#top",
      "../pics",
      42,
      null,
      undefined,
      ["pics"],
      { toString: () => "pics" },
    ].forEach((sub) => {
      listeners.message(
        { type: "open-archive", sub },
        { tab: { id: 7, index: 2 } },
      );
    });
    assert.deepStrictEqual(calls.create, []);
  });

  test("activate-from-url still starts presentation mode and opens no tab", () => {
    const { calls, listeners } = loadBackground();
    listeners.message(
      { type: "activate-from-url" },
      {
        tab: {
          id: 5,
          index: 0,
          url: "https://www.reddit.com/r/pics/?redditp=1",
        },
      },
    );
    // showPresentation asks for the styles before its first await.
    assert.deepStrictEqual(calls.insertCSS, [
      { target: { tabId: 5 }, files: ["presentation.css"] },
    ]);
    assert.deepStrictEqual(calls.create, []);
  });
});

// ---------------------------------------------------------------------------
// The archive page's DOM-free blocks (browser-extension/archive.js)
// ---------------------------------------------------------------------------

const archiveFixturePosts =
  require("../test-data/reddit.com.json").data.children.map(
    (child) => child.data,
  );
const archiveFixture = Object.fromEntries(
  archiveFixturePosts.map((post) => [post.id, post]),
);

// The gallery-feature fixture's gallery, with the id and date its listing
// leaves out; without them, trimPost rightly stores nothing.
function archiveGalleryPost() {
  const post = JSON.parse(
    JSON.stringify(
      require("../test-data/gallery-feature.json").data.children[1].data,
    ),
  );
  return { ...post, id: "galtest", created_utc: 1700000000 };
}

// The fields a stored record may have.
const ARCHIVE_RECORD_KEYS = [
  "sub",
  "id",
  "name",
  "subreddit",
  "created_utc",
  "score",
  "title",
  "author",
  "permalink",
  "is_self",
  "selftext",
  "over_18",
  "is_video",
  "is_gallery",
  "post_hint",
  "domain",
  "url",
  "media",
  "preview",
  "gallery_data",
  "media_metadata",
  "crosspost_parent_list",
];
// The fields a crosspost's original keeps.
const ARCHIVE_MEDIA_KEYS = [
  "is_video",
  "is_gallery",
  "post_hint",
  "domain",
  "url",
  "media",
  "preview",
  "gallery_data",
  "media_metadata",
];

const decodedPreview = (post) =>
  post.preview.images[0].source.url.replace(/&amp;/g, "&");

suite("browser-extension archive records", () => {
  const records = loadContentScriptBlock(
    "archive-records",
    [
      "REDDIT_ORIGIN",
      "BODY_LIMIT",
      "decodeEntities",
      "decodeUrl",
      "safeUrl",
      "subKey",
      "trimMedia",
      "trimPost",
    ],
    "archive.js",
  );

  test("archive record helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      records,
      "did not find the archive-records markers in archive.js",
    );
  });

  test("text entities are decoded once, &amp; last", () => {
    assert.ok(records, "archive record helpers not loaded");
    assert.strictEqual(
      records.decodeEntities("Tom &amp; Jerry &lt;3"),
      "Tom & Jerry <3",
    );
    assert.strictEqual(records.decodeEntities("&amp;lt;"), "&lt;");
    assert.strictEqual(
      records.decodeEntities("&quot;a&quot; &#39;b&#39; &#x27;c&#x27; &gt;"),
      `"a" 'b' 'c' >`,
    );
    [undefined, null, 5].forEach((value) => {
      assert.strictEqual(records.decodeEntities(value), "", String(value));
    });
  });

  test("URLs lose every &amp;", () => {
    assert.ok(records, "archive record helpers not loaded");
    assert.strictEqual(
      records.decodeUrl("https://a.example/x?a=1&amp;b=2&amp;c=3"),
      "https://a.example/x?a=1&b=2&c=3",
    );
    assert.strictEqual(records.decodeUrl(null), "");
  });

  test("only http(s) URLs are kept, and Reddit's paths become absolute", () => {
    assert.ok(records, "archive record helpers not loaded");
    assert.strictEqual(records.REDDIT_ORIGIN, "https://www.reddit.com");
    assert.strictEqual(records.safeUrl("javascript:alert(1)"), "");
    assert.strictEqual(records.safeUrl("data:text/html,hi"), "");
    assert.strictEqual(
      records.safeUrl("/r/pics/comments/x/"),
      "https://www.reddit.com/r/pics/comments/x/",
    );
    assert.strictEqual(
      records.safeUrl("https://i.redd.it/a.jpg?x=1&amp;y=2"),
      "https://i.redd.it/a.jpg?x=1&y=2",
    );
    ["", "   ", null, undefined, 3].forEach((value) => {
      assert.strictEqual(records.safeUrl(value), "", String(value));
    });
  });

  test("a subreddit's name becomes its lowercase key", () => {
    assert.ok(records, "archive record helpers not loaded");
    [
      ["r/Pics", "pics"],
      ["/r/Pics/", "pics"],
      ["Pics", "pics"],
      ["de", "de"],
      ["pics_2", "pics_2"],
      ["a".repeat(21), "a".repeat(21)],
    ].forEach(([name, key]) => {
      assert.strictEqual(records.subKey(name), key, name);
    });
    ["a+b", "x", "a".repeat(22), "", "r/", "pics/new", null].forEach((name) => {
      assert.strictEqual(records.subKey(name), "", String(name));
    });
  });

  test("removed posts, and posts without an id or a date, are not stored", () => {
    assert.ok(records, "archive record helpers not loaded");
    const post = { id: "abc", created_utc: 1600000000, title: "Post" };
    ["moderator", "reddit", "deleted", "automod_filtered"].forEach(
      (category) => {
        assert.strictEqual(
          records.trimPost({ ...post, removed_by_category: category }, "x"),
          null,
          category,
        );
      },
    );
    [null, "", undefined].forEach((category) => {
      assert.ok(
        records.trimPost({ ...post, removed_by_category: category }, "x"),
        String(category),
      );
    });
    [
      ["no id", { ...post, id: undefined }],
      ["bad id", { ...post, id: "a-b" }],
      ["no date", { ...post, created_utc: null }],
      ["bad date", { ...post, created_utc: "soon" }],
    ].forEach(([name, value]) => {
      assert.strictEqual(records.trimPost(value, "x"), null, name);
    });
    [null, "post", 5, []].forEach((value) => {
      assert.strictEqual(records.trimPost(value, "x"), null, String(value));
    });
  });

  test("dates and scores are always numbers, so every post is indexed", () => {
    assert.ok(records, "archive record helpers not loaded");
    const record = records.trimPost(
      { id: "t3_abc", created_utc: "1600000000.5", score: "12.7" },
      "x",
    );
    assert.strictEqual(record.id, "abc");
    assert.strictEqual(record.name, "t3_abc");
    assert.strictEqual(record.created_utc, 1600000000);
    assert.strictEqual(record.score, 12);
    assert.strictEqual(
      records.trimPost({ id: "abc", created_utc: 1600000000 }, "x").score,
      0,
    );
  });

  test("every fixture post keeps only the fields the archive reads", () => {
    assert.ok(records, "archive record helpers not loaded");
    archiveFixturePosts.forEach((post) => {
      const record = records.trimPost(post, "archivekey");
      assert.ok(record, post.id);
      Object.keys(record).forEach((key) => {
        assert.ok(ARCHIVE_RECORD_KEYS.includes(key), `${post.id}: ${key}`);
      });
      assert.strictEqual(record.sub, "archivekey", post.id);
      assert.strictEqual(record.subreddit, post.subreddit, post.id);
      assert.ok(Number.isInteger(record.created_utc), post.id);
      assert.ok(Number.isInteger(record.score), post.id);
      assert.ok(
        record.permalink.startsWith("https://www.reddit.com/r/"),
        `${post.id}: ${record.permalink}`,
      );
      if (post.preview) {
        assert.deepStrictEqual(
          record.preview,
          {
            images: [
              {
                source: {
                  url: decodedPreview(post),
                  width: post.preview.images[0].source.width,
                  height: post.preview.images[0].source.height,
                },
              },
            ],
          },
          post.id,
        );
      } else {
        assert.strictEqual(record.preview, undefined, post.id);
      }
      const size = JSON.stringify(record).length;
      assert.ok(size < 1500, `${post.id}: ${size} characters`);
    });
  });

  test("a crosspost keeps its original's video, decoded", () => {
    assert.ok(records, "archive record helpers not loaded");
    const post = archiveFixture.kg84kl;
    const record = records.trimPost(post, "x");
    assert.strictEqual(record.media, null);
    assert.strictEqual(record.crosspost_parent_list.length, 1);
    const parent = record.crosspost_parent_list[0];
    Object.keys(parent).forEach((key) => {
      assert.ok(ARCHIVE_MEDIA_KEYS.includes(key), key);
    });
    assert.strictEqual(
      parent.media.reddit_video.fallback_url,
      "https://v.redd.it/clkrb6upg4661/DASH_240.mp4?source=fallback",
    );
    assert.strictEqual(
      parent.preview.images[0].source.url,
      decodedPreview(post.crosspost_parent_list[0]),
    );
    // A post with a video of its own keeps no original.
    assert.strictEqual(
      records.trimPost(archiveFixture.kgepby, "x").crosspost_parent_list,
      undefined,
    );
  });

  test("a gallery keeps each item's largest size only", () => {
    assert.ok(records, "archive record helpers not loaded");
    const post = archiveGalleryPost();
    Object.values(post.media_metadata).forEach((entry) => {
      entry.s.u += "&amp;s=x";
      entry.p = [{ u: entry.s.u, x: 108, y: 108 }];
    });
    const record = records.trimPost(post, "aww");
    assert.deepStrictEqual(record.gallery_data, {
      items: [
        { media_id: "galimg1" },
        { media_id: "galimg2" },
        { media_id: "galimg3" },
      ],
    });
    assert.deepStrictEqual(record.media_metadata.galimg1, {
      status: "valid",
      e: "Image",
      m: "image/png",
      s: {
        u: "https://preview.redd.it/galimg1.png?width=1080&s=x",
        x: 1080,
        y: 1080,
      },
    });
    Object.values(record.media_metadata).forEach((entry) => {
      assert.deepStrictEqual(Object.keys(entry), ["status", "e", "m", "s"]);
    });
    assert.strictEqual(record.is_gallery, true);
  });

  test("a self post's text is decoded and cut to 1000 characters", () => {
    assert.ok(records, "archive record helpers not loaded");
    assert.strictEqual(records.BODY_LIMIT, 1000);
    const long = records.trimPost(
      {
        id: "abc",
        created_utc: 1,
        is_self: true,
        selftext: `a &amp; b ${"x".repeat(2000)}`,
      },
      "x",
    );
    assert.strictEqual(long.selftext.length, 1000);
    assert.ok(long.selftext.startsWith("a & b x"));
    const link = records.trimPost(
      { id: "abc", created_utc: 1, is_self: false, selftext: "Hidden" },
      "x",
    );
    assert.strictEqual(link.selftext, "");
  });

  test("titles are decoded", () => {
    assert.ok(records, "archive record helpers not loaded");
    assert.ok(
      records
        .trimPost(archiveFixture.kgjc2i, "x")
        .title.includes("Westfall & Yarkoni"),
    );
  });
});

suite("browser-extension archive media", () => {
  const media = loadContentScriptBlock(
    "archive-media",
    ["mediaFromPost", "postSlides"],
    "archive.js",
  );
  const records = loadContentScriptBlock(
    "archive-records",
    ["trimPost"],
    "archive.js",
  );
  const urls = loadContentScriptBlock("redditp-media-urls", [
    "IMAGE_URL_RE",
    "VIDEO_URL_RE",
    "isVideoUrl",
    "canonicalMediaKey",
    "externalMedia",
  ]);
  const one = (post) => {
    const items = media.mediaFromPost(post, urls);
    assert.strictEqual(items.length, 1, JSON.stringify(items));
    return items[0];
  };
  const post = (fields) => ({
    id: "syn1",
    created_utc: 1600000000,
    title: "Synthetic",
    subreddit: "pics",
    permalink: "/r/pics/comments/syn1/synthetic/",
    ...fields,
  });

  test("archive media helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(media, "did not find the archive-media markers in archive.js");
    assert.ok(records, "did not find the archive-records markers");
    assert.ok(urls, "did not find the redditp-media-urls markers");
  });

  test("pictures, Reddit videos and crossposted videos", () => {
    assert.ok(media, "archive media helpers not loaded");
    assert.deepStrictEqual(one(archiveFixture.kgl8vc), {
      kind: "image",
      url: "https://i.redd.it/y8nbh6y019661.jpg",
      poster: "",
      postMedia: true,
      fromGif: false,
    });
    assert.deepStrictEqual(one(archiveFixture.kgepby), {
      kind: "video",
      url: "https://v.redd.it/h57x3pgw57661/DASH_360.mp4?source=fallback",
      poster: decodedPreview(archiveFixture.kgepby),
      postMedia: true,
      fromGif: false,
    });
    assert.deepStrictEqual(one(archiveFixture.kg84kl), {
      kind: "video",
      url: "https://v.redd.it/clkrb6upg4661/DASH_240.mp4?source=fallback",
      poster: decodedPreview(archiveFixture.kg84kl.crosspost_parent_list[0]),
      postMedia: true,
      fromGif: false,
    });
  });

  test("imgur GIFVs play as MP4s, and YouTube links as players", () => {
    assert.ok(media, "archive media helpers not loaded");
    assert.deepStrictEqual(one(archiveFixture.kgcs19), {
      kind: "video",
      url: "https://i.imgur.com/RCtmQG7.mp4",
      poster: decodedPreview(archiveFixture.kgcs19),
      postMedia: true,
      fromGif: true,
    });
    assert.strictEqual(
      one(archiveFixture.kgc3gb).url,
      "https://i.imgur.com/oWjg3Wv.mp4",
    );
    assert.strictEqual(one(archiveFixture.kgc3gb).fromGif, true);
    assert.deepStrictEqual(one(archiveFixture.kgifs8), {
      kind: "embed",
      url: "https://www.youtube.com/embed/zb_oMA-v_wI?enablejsapi=1",
      poster: "",
      postMedia: true,
      fromGif: false,
    });
    assert.strictEqual(
      one(archiveFixture.kgjtiu).url,
      "https://www.youtube.com/embed/GXzLx-UjNNg?enablejsapi=1",
    );
  });

  test("a link shows its preview picture, which is not the post's own media", () => {
    assert.ok(media, "archive media helpers not loaded");
    assert.deepStrictEqual(one(archiveFixture.kgkkid), {
      kind: "image",
      url: decodedPreview(archiveFixture.kgkkid),
      poster: "",
      postMedia: false,
      fromGif: false,
    });
  });

  test("links without a picture, and text posts, become link slides", () => {
    assert.ok(media, "archive media helpers not loaded");
    assert.deepStrictEqual(one(archiveFixture.kghink), {
      kind: "link",
      url: "https://en.wikipedia.org/wiki/List_of_longest_prison_sentences",
      poster: "",
      postMedia: false,
      fromGif: false,
    });
    assert.deepStrictEqual(one(archiveFixture.kgfnzg), {
      kind: "link",
      url: archiveFixture.kgfnzg.url,
      poster: "",
      postMedia: false,
      fromGif: false,
    });
    // A text post's preview picture is not shown in place of its text.
    assert.strictEqual(one(archiveFixture.kg9s5v).kind, "link");
    const [slide] = media.postSlides(
      records.trimPost(archiveFixture.kgjlvd, "jokes"),
      urls,
    ).slides;
    assert.strictEqual(slide.body, archiveFixture.kgjlvd.selftext);
    assert.strictEqual(
      media.postSlides(archiveFixture.kgl8vc, urls).slides[0].body,
      "",
    );
  });

  test("a gallery becomes one slide per picture, numbered n of N", () => {
    assert.ok(media, "archive media helpers not loaded");
    const { slides, unavailable } = media.postSlides(
      records.trimPost(archiveGalleryPost(), "aww"),
      urls,
    );
    assert.strictEqual(unavailable, 0);
    assert.deepStrictEqual(
      slides.map((slide) => [
        slide.kind,
        slide.url,
        slide.galleryItem,
        slide.galleryTotal,
        slide.postKey,
        slide.postMedia,
      ]),
      [1, 2, 3].map((number) => [
        "image",
        `https://preview.redd.it/galimg${number}.png?width=1080`,
        number,
        3,
        "t3_galtest",
        true,
      ]),
    );
  });

  test("watch pages, animations, failed items and unsafe links", () => {
    assert.ok(media, "archive media helpers not loaded");
    assert.deepStrictEqual(
      one(post({ url: "https://videohost.example/watch/abc" })),
      {
        kind: "embed",
        url: "https://videohost.example/ifr/abc",
        poster: "",
        postMedia: true,
        fromGif: false,
      },
    );
    const animated = media.mediaFromPost(
      post({
        is_gallery: true,
        gallery_data: {
          items: [
            { media_id: "a1" },
            { media_id: "gone" },
            { media_id: "a2" },
            { media_id: "missing" },
            { media_id: "clip" },
          ],
        },
        media_metadata: {
          a1: {
            status: "valid",
            e: "AnimatedImage",
            s: {
              gif: "https://i.redd.it/a1.gif",
              mp4: "https://i.redd.it/a1.mp4",
            },
          },
          gone: { status: "failed" },
          a2: {
            status: "valid",
            e: "AnimatedImage",
            s: { gif: "https://i.redd.it/a2.gif" },
          },
          clip: { status: "valid", e: "RedditVideo", dashUrl: "x" },
        },
      }),
      urls,
    );
    assert.deepStrictEqual(
      animated.map((item) => [
        item.kind,
        item.url,
        item.fromGif,
        item.galleryItem,
        item.galleryTotal,
      ]),
      [
        ["video", "https://i.redd.it/a1.mp4", true, 1, 2],
        ["image", "https://i.redd.it/a2.gif", true, 2, 2],
      ],
    );
    assert.deepStrictEqual(one(post({ url: "javascript:alert(1)" })), {
      kind: "link",
      url: "https://www.reddit.com/r/pics/comments/syn1/synthetic/",
      poster: "",
      postMedia: false,
      fromGif: false,
    });
  });

  test("trimming never changes the slides", () => {
    assert.ok(media, "archive media helpers not loaded");
    [...archiveFixturePosts, archiveGalleryPost()].forEach((raw) => {
      assert.deepStrictEqual(
        media.mediaFromPost(records.trimPost(raw, "x"), urls),
        media.mediaFromPost(raw, urls),
        raw.id,
      );
    });
  });

  test("dead media is skipped and counted, and galleries keep their numbers", () => {
    assert.ok(media, "archive media helpers not loaded");
    const gallery = records.trimPost(archiveGalleryPost(), "aww");
    const dead = new Set([
      urls.canonicalMediaKey("https://preview.redd.it/galimg2.png?width=1080"),
    ]);
    const { slides, unavailable } = media.postSlides(gallery, urls, dead);
    assert.strictEqual(unavailable, 1);
    assert.deepStrictEqual(
      slides.map((slide) => `${slide.galleryItem}/${slide.galleryTotal}`),
      ["1/3", "3/3"],
    );
    const single = records.trimPost(archiveFixture.kgl8vc, "pics");
    assert.deepStrictEqual(
      media.postSlides(
        single,
        urls,
        new Set([urls.canonicalMediaKey(single.url)]),
      ),
      { slides: [], unavailable: 1 },
    );
  });

  test("slides carry the post's details and where it came from", () => {
    assert.ok(media, "archive media helpers not loaded");
    const record = records.trimPost(archiveFixture.kgl8vc, "pics");
    const [slide] = media.postSlides(record, urls).slides;
    assert.strictEqual(slide.title, archiveFixture.kgl8vc.title);
    assert.strictEqual(slide.author, `u/${archiveFixture.kgl8vc.author}`);
    assert.strictEqual(slide.community, `r/${archiveFixture.kgl8vc.subreddit}`);
    assert.strictEqual(
      slide.commentsUrl,
      `https://www.reddit.com${archiveFixture.kgl8vc.permalink}`,
    );
    assert.strictEqual(slide.sourceUrl, "https://i.redd.it/y8nbh6y019661.jpg");
    assert.strictEqual(slide.postKey, "t3_kgl8vc");
    assert.strictEqual(slide.galleryItem, 0);
    assert.deepStrictEqual(slide.archive, {
      id: "kgl8vc",
      created: archiveFixture.kgl8vc.created_utc,
      score: archiveFixture.kgl8vc.score,
    });
    const deleted = media.postSlides({ ...record, author: "[deleted]" }, urls);
    assert.strictEqual(deleted.slides[0].author, "");
    const untitled = media.postSlides({ ...record, title: "" }, urls);
    assert.strictEqual(untitled.slides[0].title, "Reddit post");
  });
});

suite("browser-extension archive ranking", () => {
  const ranking = loadContentScriptBlock(
    "archive-ranking",
    [
      "WINDOW_SIZE",
      "DAY_SECONDS",
      "SCORE_BLIND_SECONDS",
      "REFRESH_OVERLAP_SECONDS",
      "RANGE_PRESETS",
      "normalView",
      "rangeBounds",
      "viewKey",
      "rankEntries",
      "rankedEntries",
      "mergeRanked",
      "cutWindow",
      "advanceCursor",
      "windowReady",
      "rangeComplete",
      "firstStretch",
      "newStretch",
    ],
    "archive.js",
  );
  const NOW = Date.UTC(2026, 8, 25, 12) / 1000;
  const DAY = 86400;
  const entry = (id, score, ageSeconds) => ({
    id,
    score,
    created: NOW - ageSeconds,
  });

  test("archive ranking helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      ranking,
      "did not find the archive-ranking markers in archive.js",
    );
  });

  test("windows hold 5,000 posts; two days are both left unranked and pulled again", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    assert.strictEqual(ranking.WINDOW_SIZE, 5000);
    assert.strictEqual(ranking.DAY_SECONDS, DAY);
    assert.strictEqual(ranking.SCORE_BLIND_SECONDS, 2 * DAY);
    assert.strictEqual(ranking.REFRESH_OVERLAP_SECONDS, 2 * DAY);
    assert.deepStrictEqual(ranking.RANGE_PRESETS, [
      "all",
      "year",
      "month",
      "custom",
    ]);
  });

  test("posts rank by score, then newest first, then by id", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const entries = [
      entry("low", 5, 10 * DAY),
      entry("old", 50, 20 * DAY),
      entry("new", 50, 3 * DAY),
      entry("b", 50, 5 * DAY),
      entry("a", 50, 5 * DAY),
      entry("top", 90, 30 * DAY),
    ];
    assert.deepStrictEqual(
      ranking.rankEntries(entries, { nowSec: NOW, minScore: 0 }),
      ["top", "new", "a", "b", "old", "low"],
    );
  });

  test("a post exactly 48 hours old ranks; one a second younger does not", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    assert.deepStrictEqual(
      ranking.rankEntries(
        [entry("young", 99, 2 * DAY - 1), entry("ripe", 1, 2 * DAY)],
        { nowSec: NOW, minScore: 0 },
      ),
      ["ripe"],
    );
  });

  test("posts below the minimum score are left out", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const entries = [
      entry("a", 100, 3 * DAY),
      entry("b", 99, 3 * DAY),
      entry("c", 0, 3 * DAY),
      entry("d", -4, 3 * DAY),
    ];
    assert.deepStrictEqual(
      ranking.rankEntries(entries, { nowSec: NOW, minScore: 100 }),
      ["a"],
    );
    assert.deepStrictEqual(
      ranking.rankEntries(entries, { nowSec: NOW, minScore: 0 }),
      ["a", "b", "c"],
    );
  });

  test("a window ends on a whole second", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const entries = [
      { id: "a", created: 100 },
      { id: "b", created: 90 },
      { id: "c", created: 90 },
      { id: "d", created: 90 },
      { id: "e", created: 80 },
    ];
    const window = ranking.cutWindow(entries, 2);
    assert.deepStrictEqual(
      window.taken.map((item) => item.id),
      ["a", "b", "c", "d"],
    );
    assert.strictEqual(window.start, 90);
    assert.strictEqual(window.full, true);
    const exact = ranking.cutWindow(entries, 5);
    assert.strictEqual(exact.taken.length, 5);
    assert.strictEqual(exact.full, true);
    const short = ranking.cutWindow(entries, 6);
    assert.strictEqual(short.taken.length, 5);
    assert.strictEqual(short.start, 80);
    assert.strictEqual(short.full, false);
    assert.deepStrictEqual(ranking.cutWindow([], 3), {
      taken: [],
      start: 0,
      full: false,
    });
  });

  test("the cursor asks for the oldest second again, or moves past a page that is all one second", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    assert.deepStrictEqual(ranking.advanceCursor(2000000, 1500), {
      cursorMs: 1501000,
      bottom: 1501,
    });
    // Every post of the page was created in second 1999.
    assert.deepStrictEqual(ranking.advanceCursor(2000000, 1999), {
      cursorMs: 1999000,
      bottom: 1999,
    });
    assert.deepStrictEqual(ranking.advanceCursor(1999500, 1999), {
      cursorMs: 1999000,
      bottom: 1999,
    });
  });

  test("date ranges: presets from now, custom days inclusive in UTC", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    assert.deepStrictEqual(ranking.rangeBounds({ preset: "all" }, NOW), {
      start: 0,
      end: Infinity,
    });
    assert.deepStrictEqual(ranking.rangeBounds({ preset: "year" }, NOW), {
      start: NOW - 365 * DAY,
      end: Infinity,
    });
    assert.deepStrictEqual(ranking.rangeBounds({ preset: "month" }, NOW), {
      start: NOW - 30 * DAY,
      end: Infinity,
    });
    const jan2020 = Date.UTC(2020, 0, 1) / 1000;
    assert.deepStrictEqual(
      ranking.rangeBounds(
        { preset: "custom", from: "2020-01-01", to: "2020-01-31" },
        NOW,
      ),
      { start: jan2020, end: jan2020 + 31 * DAY },
    );
    assert.deepStrictEqual(
      ranking.rangeBounds(
        { preset: "custom", from: "2020-01-01", to: "2020-01-01" },
        NOW,
      ),
      { start: jan2020, end: jan2020 + DAY },
    );
    // Either end may be left open.
    assert.deepStrictEqual(
      ranking.rangeBounds(
        { preset: "custom", from: "2020-01-01", to: "" },
        NOW,
      ),
      { start: jan2020, end: Infinity },
    );
    assert.deepStrictEqual(
      ranking.rangeBounds(
        { preset: "custom", from: "", to: "2020-01-01" },
        NOW,
      ),
      { start: 0, end: jan2020 + DAY },
    );
    [
      { preset: "custom", from: "2020-02-01", to: "2020-01-01" },
      { preset: "custom", from: "", to: "" },
      { preset: "custom", from: "2020-02-30", to: "" },
      { preset: "decade" },
      null,
    ].forEach((range) => {
      assert.deepStrictEqual(
        ranking.rangeBounds(range, NOW),
        { start: 0, end: Infinity },
        JSON.stringify(range),
      );
    });
  });

  test("views are named by everything that changes what shows", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    assert.strictEqual(ranking.viewKey({}), "windows|all|||0");
    assert.strictEqual(
      ranking.viewKey({
        mode: "top",
        range: { preset: "custom", from: "2020-01-01", to: "2020-12-31" },
        minScore: 100,
      }),
      "top|custom|2020-01-01|2020-12-31|100",
    );
    // Dates only matter to a custom range.
    assert.strictEqual(
      ranking.viewKey({
        mode: "windows",
        range: { preset: "year", from: "2020-01-01", to: "" },
        minScore: 5,
      }),
      "windows|year|||5",
    );
    assert.deepStrictEqual(
      ranking.normalView({
        mode: "sideways",
        range: { preset: "custom", from: "2020-13-01", to: "2021-01-05" },
        minScore: "12.9",
      }),
      {
        mode: "windows",
        range: { preset: "custom", from: "", to: "2021-01-05" },
        minScore: 12,
      },
    );
    [-5, "soon", Infinity, null].forEach((minScore) => {
      assert.strictEqual(
        ranking.normalView({ minScore }).minScore,
        0,
        String(minScore),
      );
    });
  });

  test("a window is ready when full, when the pull passed the range's start, or when the pull is done", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const full = { full: true };
    const partial = { full: false };
    const pulling = { done: false, bottom: 5000 };
    assert.strictEqual(ranking.windowReady(full, pulling, 0), true);
    assert.strictEqual(ranking.windowReady(partial, pulling, 0), false);
    assert.strictEqual(ranking.windowReady(partial, pulling, 5000), true);
    assert.strictEqual(ranking.windowReady(partial, pulling, 6000), true);
    assert.strictEqual(
      ranking.windowReady(partial, { done: true, bottom: 5000 }, 0),
      true,
    );
    assert.strictEqual(
      ranking.windowReady(partial, { done: false, bottom: Infinity }, 0),
      false,
    );
    assert.strictEqual(ranking.rangeComplete(pulling, 0), false);
    assert.strictEqual(ranking.rangeComplete(pulling, 5000), true);
    assert.strictEqual(
      ranking.rangeComplete({ done: true, bottom: 5000 }, 0),
      true,
    );
  });

  test("top of what's stored opens on the range's posts stored in full, up to the newest", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const span = { top: 9000, bottom: 5000 };
    const all = { start: 0, end: Infinity };
    assert.deepStrictEqual(ranking.firstStretch(all, span), {
      start: 5000,
      end: 9001,
    });
    // The pull has passed the start of the range.
    assert.deepStrictEqual(
      ranking.firstStretch({ start: 6000, end: Infinity }, span),
      { start: 6000, end: 9001 },
    );
    // A range that ends below the newest post.
    assert.deepStrictEqual(
      ranking.firstStretch({ start: 0, end: 7000 }, span),
      { start: 5000, end: 7000 },
    );
    // The pull has not reached the range yet: nothing, and what arrives
    // later stays inside the range.
    assert.deepStrictEqual(
      ranking.firstStretch({ start: 1000, end: 3000 }, span),
      { start: 3000, end: 3000 },
    );
    // Nothing stored yet: all of the range is still to come.
    assert.deepStrictEqual(
      ranking.firstStretch(all, { top: 0, bottom: Infinity }),
      { start: Infinity, end: Infinity },
    );
    assert.deepStrictEqual(
      ranking.firstStretch(
        { start: 0, end: 3000 },
        { top: 0, bottom: Infinity },
      ),
      { start: 3000, end: 3000 },
    );
  });

  test("top of what's stored takes in what the pull stored below it since", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    // The pull went on from 5000 down to 4000.
    assert.deepStrictEqual(ranking.newStretch(0, 5000, 4000), {
      start: 4000,
      end: 5000,
    });
    // Down past the start of the range: the rest of the range.
    assert.deepStrictEqual(ranking.newStretch(4500, 5000, 4000), {
      start: 4500,
      end: 5000,
    });
    // Nothing new: the pull has not moved, or the range was complete.
    assert.strictEqual(ranking.newStretch(0, 5000, 5000), null);
    assert.strictEqual(ranking.newStretch(5000, 5000, 4000), null);
    assert.strictEqual(ranking.newStretch(6000, 6000, 4000), null);
    // Nothing stored at all, then a first page.
    assert.strictEqual(ranking.newStretch(0, Infinity, Infinity), null);
    assert.deepStrictEqual(ranking.newStretch(0, Infinity, 4000), {
      start: 4000,
      end: Infinity,
    });
    // A range that the pull had not reached, and now has.
    assert.deepStrictEqual(ranking.newStretch(1000, 3000, 2000), {
      start: 2000,
      end: 3000,
    });
  });

  test("ranked entries keep their dates and scores, in the order of the ranked ids", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const entries = [
      entry("low", 5, 10 * DAY),
      entry("young", 99, DAY),
      entry("top", 90, 30 * DAY),
      entry("below", 1, 3 * DAY),
    ];
    const options = { nowSec: NOW, minScore: 5 };
    const ranked = ranking.rankedEntries(entries, options);
    assert.deepStrictEqual(ranked, [
      entry("top", 90, 30 * DAY),
      entry("low", 5, 10 * DAY),
    ]);
    assert.deepStrictEqual(
      ranked.map((item) => item.id),
      ranking.rankEntries(entries, options),
    );
    // The entries given stay as they were.
    assert.deepStrictEqual(
      entries.map((item) => item.id),
      ["low", "young", "top", "below"],
    );
  });

  test("two ranked lists merge into one, best first", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const a = [
      entry("a90", 90, 3 * DAY),
      entry("a50", 50, 4 * DAY),
      entry("a10", 10, 5 * DAY),
    ];
    const b = [entry("b70", 70, 9 * DAY), entry("b30", 30, 9 * DAY)];
    const ids = (list) => list.map((item) => item.id);
    assert.deepStrictEqual(ids(ranking.mergeRanked(a, b)), [
      "a90",
      "b70",
      "a50",
      "b30",
      "a10",
    ]);
    assert.deepStrictEqual(ids(ranking.mergeRanked(b, a)), [
      "a90",
      "b70",
      "a50",
      "b30",
      "a10",
    ]);
    // Neither list changes.
    assert.deepStrictEqual(ids(a), ["a90", "a50", "a10"]);
    assert.deepStrictEqual(ids(b), ["b70", "b30"]);
  });

  test("a merge breaks equal scores as the ranking does, and keeps a full tie in order", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const ids = (list) => list.map((item) => item.id);
    // Equal scores: the newer post first, then the smaller id.
    assert.deepStrictEqual(
      ids(
        ranking.mergeRanked(
          [entry("m", 50, 5 * DAY), entry("z", 50, 6 * DAY)],
          [entry("new", 50, 3 * DAY), entry("a", 50, 5 * DAY)],
        ),
      ),
      ["new", "a", "m", "z"],
    );
    // Entries that rank alike keep their lists' order, the first list's
    // first, and each list keeps its own order.
    const first = { id: "same", score: 50, created: NOW, from: "a" };
    const second = { id: "same", score: 50, created: NOW, from: "b" };
    assert.deepStrictEqual(
      ranking.mergeRanked([first], [second]).map((item) => item.from),
      ["a", "b"],
    );
    assert.deepStrictEqual(
      ranking.mergeRanked([second], [first]).map((item) => item.from),
      ["b", "a"],
    );
  });

  test("a merge with an empty list is the other list", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const list = [entry("a", 9, 3 * DAY), entry("b", 8, 3 * DAY)];
    assert.deepStrictEqual(ranking.mergeRanked(list, []), list);
    assert.deepStrictEqual(ranking.mergeRanked([], list), list);
    assert.deepStrictEqual(ranking.mergeRanked([], []), []);
    // A new list, never one of the two given.
    assert.notStrictEqual(ranking.mergeRanked(list, []), list);
  });

  test("merging ranked stretches ranks as ranking them together does", () => {
    assert.ok(ranking, "archive ranking helpers not loaded");
    const options = { nowSec: NOW, minScore: 10 };
    // Scores and dates that repeat, so every tie-break is used.
    const entries = Array.from({ length: 120 }, (_, index) =>
      entry(
        `p${(index * 7) % 120}`,
        (index * 37) % 41,
        DAY + (index % 9) * DAY,
      ),
    );
    const older = entries.filter((item) => item.created < NOW - 5 * DAY);
    const newer = entries.filter((item) => item.created >= NOW - 5 * DAY);
    assert.deepStrictEqual(
      ranking.mergeRanked(
        ranking.rankedEntries(newer, options),
        ranking.rankedEntries(older, options),
      ),
      ranking.rankedEntries(entries, options),
    );
  });
});

suite("browser-extension archive pull", () => {
  const pull = loadContentScriptBlock(
    "archive-pull",
    [
      "API_BASE",
      "META_APP",
      "narrowedAfterMs",
      "searchUrl",
      "earliestUrl",
      "pageOutcome",
      "rateLimitDelayMs",
      "backoffMs",
      "MAX_PACE_FACTOR",
      "PACE_RECOVERY_PAGES",
      "nextPace",
    ],
    "archive.js",
  );
  const BEFORE = 1758800000000;
  const DAY_MS = 86400000;
  const KNOWN = ["subreddit", "sort", "before", "after", "limit", "meta-app"];

  test("archive pull helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(pull, "did not find the archive-pull markers in archive.js");
  });

  test("a search asks for one page, newest first, with known parameters only", () => {
    assert.ok(pull, "archive pull helpers not loaded");
    const base = "https://arctic-shift.photon-reddit.com/api/posts/search";
    assert.strictEqual(
      pull.API_BASE,
      "https://arctic-shift.photon-reddit.com/api",
    );
    assert.strictEqual(pull.META_APP, "redditp");
    assert.deepStrictEqual(
      [0, 1, 2, 3].map((level) => pull.searchUrl("pics", BEFORE, level)),
      [
        `${base}?subreddit=pics&sort=desc&before=${BEFORE}&limit=auto&meta-app=redditp`,
        `${base}?subreddit=pics&sort=desc&before=${BEFORE}&limit=100&meta-app=redditp`,
        `${base}?subreddit=pics&sort=desc&before=${BEFORE}&limit=100&after=${BEFORE - 30 * DAY_MS}&meta-app=redditp`,
        `${base}?subreddit=pics&sort=desc&before=${BEFORE}&limit=100&after=${BEFORE - 7 * DAY_MS}&meta-app=redditp`,
      ],
    );
    [0, 1, 2, 3, 9, -1, undefined].forEach((level) => {
      const url = new URL(pull.searchUrl("pics", BEFORE, level));
      Array.from(url.searchParams.keys()).forEach((key) => {
        assert.ok(KNOWN.includes(key), `${level}: ${key}`);
      });
    });
    assert.strictEqual(pull.narrowedAfterMs(BEFORE, 1), 0);
    assert.strictEqual(pull.narrowedAfterMs(BEFORE, 2), BEFORE - 30 * DAY_MS);
  });

  test("the sub's first post has its own request", () => {
    assert.ok(pull, "archive pull helpers not loaded");
    assert.strictEqual(
      pull.earliestUrl("pics"),
      "https://arctic-shift.photon-reddit.com/api/utils/min?subreddit=pics&meta-app=redditp",
    );
  });

  test("answers read as data, empty, timeout, limited or failed", () => {
    assert.ok(pull, "archive pull helpers not loaded");
    [
      [200, { data: [{ id: "a" }] }, "data"],
      [200, { data: [] }, "empty"],
      [200, { data: null, error: "Query timed out" }, "timeout"],
      [500, { data: null, error: "Query timed out" }, "timeout"],
      [422, { error: "query TIMED OUT, try again" }, "timeout"],
      [429, { data: null, error: "Too many requests" }, "limited"],
      [429, null, "limited"],
      [400, { data: null, error: "unknown parameter" }, "failed"],
      [500, { data: null, error: "Internal error" }, "failed"],
      [200, { data: null }, "failed"],
      [200, null, "failed"],
      [200, { data: "x" }, "failed"],
    ].forEach(([status, body, outcome]) => {
      assert.strictEqual(
        pull.pageOutcome(status, body),
        outcome,
        JSON.stringify([status, body]),
      );
    });
  });

  test("a rate limit waits as its headers say, else a minute doubling up to five", () => {
    assert.ok(pull, "archive pull helpers not loaded");
    const now = 1000000;
    assert.strictEqual(pull.rateLimitDelayMs("5", null, now, 0), 5000);
    assert.strictEqual(
      pull.rateLimitDelayMs(null, String(now + 12000), now, 0),
      12000,
    );
    assert.strictEqual(pull.rateLimitDelayMs(null, null, now, 0), 60000);
    assert.strictEqual(pull.rateLimitDelayMs(null, null, now, 1), 120000);
    assert.strictEqual(pull.rateLimitDelayMs(null, null, now, 5), 300000);
    assert.strictEqual(pull.rateLimitDelayMs("", "", now, 0), 60000);
    // Never under a second, never over five minutes.
    assert.strictEqual(pull.rateLimitDelayMs("0", null, now, 0), 1000);
    assert.strictEqual(
      pull.rateLimitDelayMs(null, String(now - 5000), now, 0),
      1000,
    );
    assert.strictEqual(pull.rateLimitDelayMs("900", null, now, 0), 300000);
  });

  test("network errors back off from 5 seconds up to a minute", () => {
    assert.ok(pull, "archive pull helpers not loaded");
    assert.deepStrictEqual(
      [0, 1, 2, 3, 4, 10].map((attempt) => pull.backoffMs(attempt)),
      [5000, 10000, 20000, 40000, 60000, 60000],
    );
  });

  test("a rate limit doubles the pause between requests, up to eight times the usual one", () => {
    assert.ok(pull, "archive pull helpers not loaded");
    assert.strictEqual(pull.MAX_PACE_FACTOR, 8);
    let pace = 1000;
    const paces = [];
    for (let limit = 0; limit < 5; limit += 1) {
      pace = pull.nextPace(pace, 1000, "limited", 0);
      paces.push(pace);
    }
    assert.deepStrictEqual(paces, [2000, 4000, 8000, 8000, 8000]);
    // Capped, not just stopped at a doubling.
    assert.strictEqual(pull.nextPace(5000, 1000, "limited", 0), 8000);
    // With no pause at all, there is nothing to double.
    assert.strictEqual(pull.nextPace(0, 0, "limited", 0), 0);
  });

  test("the pause halves again after every 30 pages in a row with posts, down to the usual one", () => {
    assert.ok(pull, "archive pull helpers not loaded");
    assert.strictEqual(pull.PACE_RECOVERY_PAGES, 30);
    assert.strictEqual(pull.nextPace(8000, 1000, "data", 29), 8000);
    assert.strictEqual(pull.nextPace(8000, 1000, "data", 30), 4000);
    assert.strictEqual(pull.nextPace(4000, 1000, "data", 31), 4000);
    assert.strictEqual(pull.nextPace(4000, 1000, "data", 60), 2000);
    assert.strictEqual(pull.nextPace(2000, 1000, "data", 90), 1000);
    // Never below the usual pause.
    assert.strictEqual(pull.nextPace(1000, 1000, "data", 30), 1000);
    assert.strictEqual(pull.nextPace(1500, 1000, "data", 30), 1000);
    assert.strictEqual(pull.nextPace(8000, 1000, "data", 0), 8000);
  });

  test("other answers leave the pause as it is", () => {
    assert.ok(pull, "archive pull helpers not loaded");
    ["empty", "timeout", "failed"].forEach((outcome) => {
      assert.strictEqual(pull.nextPace(4000, 1000, outcome, 30), 4000, outcome);
      assert.strictEqual(pull.nextPace(1000, 1000, outcome, 0), 1000, outcome);
    });
  });
});

suite("browser-extension archive format", () => {
  const format = loadContentScriptBlock(
    "archive-format",
    [
      "formatCount",
      "formatMonth",
      "formatSpan",
      "formatAgo",
      "formatBytes",
      "pullProgress",
    ],
    "archive.js",
  );

  test("archive format helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(format, "did not find the archive-format markers in archive.js");
  });

  test("counts, months and spans", () => {
    assert.ok(format, "archive format helpers not loaded");
    assert.strictEqual(format.formatCount(12345), "12,345");
    assert.strictEqual(format.formatCount(0), "0");
    assert.strictEqual(format.formatCount(undefined), "0");
    // Months are UTC whatever the local time zone.
    assert.strictEqual(
      format.formatMonth(Date.UTC(2008, 0, 31, 23, 30) / 1000),
      "Jan 2008",
    );
    assert.strictEqual(
      format.formatSpan(
        Date.UTC(2008, 0, 25) / 1000,
        Date.UTC(2026, 8, 25) / 1000,
      ),
      "Jan 2008 – Sep 2026",
    );
    assert.strictEqual(
      format.formatSpan(
        Date.UTC(2026, 8, 1) / 1000,
        Date.UTC(2026, 8, 25) / 1000,
      ),
      "Sep 2026",
    );
    assert.strictEqual(
      format.formatSpan(Infinity, Date.UTC(2026, 8, 25) / 1000),
      "",
    );
    assert.strictEqual(format.formatSpan(0, 0), "");
  });

  test("how long ago, in steps", () => {
    assert.ok(format, "archive format helpers not loaded");
    const now = Date.UTC(2026, 8, 25, 12);
    [
      [now - 30 * 1000, "just now"],
      [now - 60 * 1000, "1 minute ago"],
      [now - 5 * 60 * 1000, "5 minutes ago"],
      [now - 3 * 3600 * 1000, "3 hours ago"],
      [now - 24 * 3600 * 1000, "1 day ago"],
      [now - 3 * 86400 * 1000, "3 days ago"],
      [0, "never"],
      [undefined, "never"],
    ].forEach(([then, text]) => {
      assert.strictEqual(format.formatAgo(then, now), text, String(then));
    });
  });

  test("storage sizes", () => {
    assert.ok(format, "archive format helpers not loaded");
    assert.strictEqual(format.formatBytes(0), "0 bytes");
    assert.strictEqual(format.formatBytes(500), "500 bytes");
    assert.strictEqual(format.formatBytes(512 * 1024), "512 KB");
    assert.strictEqual(format.formatBytes(1.5 * 1024 ** 3), "1.5 GB");
    assert.strictEqual(format.formatBytes(12.4 * 1024 ** 2), "12 MB");
  });

  test("pull progress runs from the newest post down to the first, or to the range", () => {
    assert.ok(format, "archive format helpers not loaded");
    assert.strictEqual(format.pullProgress({ done: true }), 1);
    const record = { done: false, top: 2000, bottom: 1500, earliest: 1000 };
    assert.strictEqual(format.pullProgress(record), 0.5);
    assert.strictEqual(format.pullProgress(record, 1500), 1);
    assert.strictEqual(format.pullProgress(record, 1750), 1);
    assert.strictEqual(format.pullProgress({ ...record, bottom: Infinity }), 0);
    assert.strictEqual(format.pullProgress({ ...record, bottom: 500 }), 1);
    assert.strictEqual(format.pullProgress({ ...record, earliest: 0 }), null);
    assert.strictEqual(format.pullProgress({ ...record, top: 0 }), null);
    assert.strictEqual(format.pullProgress(null), null);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
