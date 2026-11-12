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
// returns the named functions and constants. A list of names evaluates those
// blocks together, for a block that reads another. Returns null if the
// markers are gone, which each suite's first test asserts on rather than
// silently skipping its checks.
function loadContentScriptBlock(name, exportNames, file = "content.js") {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "../browser-extension", file),
    "utf8",
  );
  const blocks = [];
  for (const blockName of Array.isArray(name) ? name : [name]) {
    const start = source.indexOf(`// ${blockName}:start`);
    const end = source.indexOf(`// ${blockName}:end`);
    if (start < 0 || end < start) return null;
    blocks.push(source.slice(start, end));
  }
  return new Function(
    '"use strict";\n' +
      blocks.join("\n") +
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

// Which of Reddit's smaller copies of a picture a grid tile loads. content.js
// and archive.js carry this block word for word.
suite("browser-extension grid renditions", () => {
  const names = ["GRID_THUMB_WIDTH", "gridRendition", "isStillCopy"];
  const inContent = loadContentScriptBlock("redditp-grid-rendition", names);
  const inArchive = loadContentScriptBlock(
    "redditp-grid-rendition",
    names,
    "archive.js",
  );
  const copies = (...widths) =>
    widths.map((width) => ({
      url: `https://preview.redd.it/pic.jpg?width=${width}&s=x`,
      width,
      height: Math.round(width * 0.75),
    }));

  test("grid rendition helpers could be loaded", () => {
    // Guards the slices above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      inContent,
      "did not find the redditp-grid-rendition markers in content.js",
    );
    assert.ok(
      inArchive,
      "did not find the redditp-grid-rendition markers in archive.js",
    );
  });

  test("a tile loads the narrowest copy at least 640 pixels wide", () => {
    assert.ok(inContent, "grid rendition helpers not loaded");
    assert.strictEqual(inContent.GRID_THUMB_WIDTH, 640);
    const list = copies(108, 216, 320, 640, 960, 1080);
    assert.strictEqual(inContent.gridRendition(list), list[3]);
    assert.strictEqual(inContent.gridRendition(list, true), list[3]);
    // Whatever the order.
    assert.strictEqual(inContent.gridRendition([...list].reverse()), list[3]);
    assert.strictEqual(
      inContent.gridRendition(copies(108, 1080, 960)).width,
      960,
    );
  });

  test("a picture with no copy that wide loads itself, and a GIF the widest copy", () => {
    assert.ok(inContent, "grid rendition helpers not loaded");
    const small = copies(108, 320, 216);
    assert.strictEqual(inContent.gridRendition(small), null);
    assert.strictEqual(inContent.gridRendition(small, true), small[1]);
    [[], null, undefined, "copies"].forEach((value) => {
      assert.strictEqual(inContent.gridRendition(value), null, String(value));
      assert.strictEqual(
        inContent.gridRendition(value, true),
        null,
        String(value),
      );
    });
  });

  test("copies without a URL or a width are passed over", () => {
    assert.ok(inContent, "grid rendition helpers not loaded");
    const broken = [
      null,
      "https://preview.redd.it/pic.jpg",
      { url: "", width: 700 },
      { url: 5, width: 700 },
      { width: 700 },
      { url: "https://preview.redd.it/pic.jpg?width=wide", width: "wide" },
      { url: "https://preview.redd.it/pic.jpg?width=0", width: 0 },
      { url: "https://preview.redd.it/pic.jpg?width=-9", width: -900 },
    ];
    assert.strictEqual(inContent.gridRendition(broken, true), null);
    // A numeric string counts, as older records may store one.
    const numeric = { url: "https://preview.redd.it/pic.jpg", width: "800" };
    assert.strictEqual(inContent.gridRendition([...broken, numeric]), numeric);
  });

  test("a copy of a GIF is a still only when its format says so", () => {
    assert.ok(inContent, "grid rendition helpers not loaded");
    [
      "https://preview.redd.it/pic.jpg?width=640&s=x",
      "https://external-preview.redd.it/pic.png",
      "https://preview.redd.it/anim.gif?width=640&format=png8&s=x",
      "https://preview.redd.it/anim.gif?width=640&amp;format=png8&amp;s=x",
      "https://preview.redd.it/anim.gif?format=png&s=x",
      "https://preview.redd.it/anim.gif?format=jpg&s=x",
      "https://preview.redd.it/anim.GIF?format=pjpg&s=x",
    ].forEach((url) => {
      assert.strictEqual(inContent.isStillCopy(url), true, url);
    });
    [
      "https://preview.redd.it/anim.gif?width=640&s=x",
      "https://i.redd.it/anim.gif",
      "https://preview.redd.it/anim.gif?format=mp4&s=x",
      "https://preview.redd.it/anim.gif?format=gif",
      "anim.gif?format=png",
      null,
      5,
    ].forEach((url) => {
      assert.strictEqual(inContent.isStillCopy(url), false, String(url));
    });
  });

  test("archive.js carries the block of content.js word for word", () => {
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
        source.indexOf("// redditp-grid-rendition:start"),
        source.indexOf("// redditp-grid-rendition:end"),
      );
    }
    assert.ok(block("content.js").length > 0, "block not found");
    assert.strictEqual(block("archive.js"), block("content.js"));
  });
});

// A small stand-in for the browser's DOMParser, for the manifests below: an
// element tree with the few DOM members that dashVideoRenditions reads
// (getElementsByTagName, getAttribute, parentNode and textContent). The
// Playwright specs have the browser's own parser read manifests too.
function parseXml(text) {
  const root = xmlElement("#document", {}, null);
  let current = root;
  const tokens =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let match;
  while ((match = tokens.exec(text))) {
    const [, closing, name, attributes, selfClosing, textPart] = match;
    if (textPart !== undefined) {
      current.children.push({ text: textPart });
    } else if (name && closing) {
      current = current.parentNode;
    } else if (name) {
      const values = {};
      attributes.replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_, key, value) => {
        values[key] = value;
      });
      const child = xmlElement(name, values, current);
      current.children.push(child);
      if (!selfClosing) current = child;
    }
  }
  return root;
}

function xmlElement(tagName, attributes, parentNode) {
  const node = {
    tagName,
    parentNode,
    children: [],
    getAttribute: (name) =>
      Object.prototype.hasOwnProperty.call(attributes, name)
        ? attributes[name]
        : null,
    getElementsByTagName(name) {
      const found = [];
      const walk = (parent) =>
        parent.children.forEach((child) => {
          if (!child.tagName) return;
          if (child.tagName === name) found.push(child);
          walk(child);
        });
      walk(node);
      return found;
    },
    get textContent() {
      const text = (parent) =>
        parent.children
          .map((child) => (child.tagName ? text(child) : child.text))
          .join("");
      return text(node);
    },
  };
  return node;
}

// Real v.redd.it manifests, trimmed of the attributes that nothing reads.
// Reddit's newest name each rendition after its short side and say what an
// adaptation set holds; older ones say it on each rendition, drop the
// extension, or name renditions after their bitrate. DASH_MP4_MANIFEST's
// clip is silent; its audio set is made up, to show a set that says what
// its renditions are for them.
const CMAF_MANIFEST = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT3M26.133331S" type="static">
  <Period duration="PT3M26.133331S" id="0">
    <AdaptationSet contentType="video" id="1" maxHeight="1750" maxWidth="1080" par="8:13">
      <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:TransferCharacteristics" value="1" />
      <Representation bandwidth="265470" codecs="avc1.4d401e" height="356" id="6" mimeType="video/mp4" width="220">
        <BaseURL>CMAF_220.mp4</BaseURL>
        <SegmentBase indexRange="894-1549" timescale="15360"><Initialization range="0-893" /></SegmentBase>
      </Representation>
      <Representation bandwidth="490640" codecs="avc1.4d401e" height="438" id="7" mimeType="video/mp4" width="270">
        <BaseURL>CMAF_270.mp4</BaseURL>
      </Representation>
      <Representation bandwidth="872400" codecs="avc1.4d401e" height="584" id="8" mimeType="video/mp4" width="360">
        <BaseURL>CMAF_360.mp4</BaseURL>
      </Representation>
      <Representation bandwidth="1289724" codecs="avc1.4d401f" height="778" id="9" mimeType="video/mp4" width="480">
        <BaseURL>CMAF_480.mp4</BaseURL>
      </Representation>
      <Representation bandwidth="2502886" codecs="avc1.4d401f" height="1168" id="10" mimeType="video/mp4" width="720">
        <BaseURL>CMAF_720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" id="2">
      <Representation audioSamplingRate="48000" bandwidth="67797" codecs="mp4a.40.2" id="12" mimeType="audio/mp4">
        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2" />
        <BaseURL>CMAF_AUDIO_64.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
const DASH_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT9S" type="static">
    <Period duration="PT9S">
        <AdaptationSet segmentAlignment="true">
            <Representation bandwidth="780991" codecs="avc1.4d401e" height="360" id="VIDEO-1" mimeType="video/mp4" width="480">
                <BaseURL>DASH_360</BaseURL>
            </Representation>
            <Representation bandwidth="599657" codecs="avc1.4d401e" height="240" id="VIDEO-2" mimeType="video/mp4" width="320">
                <BaseURL>DASH_240</BaseURL>
            </Representation>
        </AdaptationSet>
    </Period>
</MPD>`;
const DASH_MP4_MANIFEST = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period>
    <AdaptationSet contentType="video" group="1" maxHeight="240" maxWidth="426" mimeType="video/mp4">
      <Representation bandwidth="237028" height="220" id="video_237028" width="392"><BaseURL>DASH_220.mp4</BaseURL></Representation>
      <Representation bandwidth="441877" height="240" id="video_441877" width="426"><BaseURL>DASH_240.mp4</BaseURL></Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation bandwidth="129999" id="audio_129999"><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
const BITRATE_MANIFEST = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT19.1S" type="static">
    <Period duration="PT19.1S">
        <AdaptationSet segmentAlignment="true">
            <Representation bandwidth="2043309" codecs="avc1.4d401f" height="480" id="VIDEO-1" mimeType="video/mp4" width="854"><BaseURL>DASH_2_4_M</BaseURL></Representation>
            <Representation bandwidth="1125256" codecs="avc1.4d401e" height="360" id="VIDEO-2" mimeType="video/mp4" width="640"><BaseURL>DASH_1_2_M</BaseURL></Representation>
            <Representation bandwidth="3582712" codecs="avc1.4d401f" height="720" id="VIDEO-3" mimeType="video/mp4" width="1280"><BaseURL>DASH_4_8_M</BaseURL></Representation>
            <Representation bandwidth="601168" codecs="avc1.4d401e" height="240" id="VIDEO-5" mimeType="video/mp4" width="426"><BaseURL>DASH_600_K</BaseURL></Representation>
        </AdaptationSet>
        <AdaptationSet>
            <Representation audioSamplingRate="48000" bandwidth="130046" codecs="mp4a.40.2" id="AUDIO-1" mimeType="audio/mp4"><BaseURL>audio</BaseURL></Representation>
        </AdaptationSet>
    </Period>
</MPD>`;

// A still for a live player's tile from Reddit's data for its post, the loop
// that a GIF player's tile plays, and the rendition that a Reddit video's
// tile loops. The block reads the grid rendition and media URL blocks, so the
// three are evaluated together.
suite("browser-extension grid media", () => {
  const media = loadContentScriptBlock(
    ["redditp-grid-rendition", "redditp-media-urls", "redditp-grid-media"],
    [
      "postFullname",
      "postStill",
      "gifPlayerLoop",
      "GRID_LOOP_SHORT_SIDE",
      "redditVideoId",
      "dashManifestUrl",
      "redditVideoFile",
      "redditPlayerLoop",
      "dashVideoRenditions",
      "videoLoopRendition",
      "packagedVideoLoop",
      "postLoop",
      "gridLoopUrl",
    ],
  );
  const preview = "https://external-preview.redd.it/redgifs-still.jpg";
  // Reddit's copies of a picture, as /api/info.json lists them without
  // raw_json: &amp; for &.
  const copies = (base, ...widths) =>
    widths.map((width) => ({
      url: `${base}?width=${width}&amp;crop=smart&amp;auto=webp&amp;s=w${width}`,
      width,
      height: (width * 3) / 4,
    }));
  const copy = (base, width) =>
    `${base}?width=${width}&crop=smart&auto=webp&s=w${width}`;

  test("grid media helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      media,
      "did not find the redditp-grid-media markers, or the blocks it reads, in content.js",
    );
  });

  test("a post's fullname comes from its key, or else its comments URL", () => {
    assert.ok(media, "grid media helpers not loaded");
    const comments =
      "https://www.reddit.com/r/NSFW_GIF/comments/1wsat28/audrey_hollander/";
    assert.strictEqual(media.postFullname("t3_1wsat28", ""), "t3_1wsat28");
    assert.strictEqual(media.postFullname("", comments), "t3_1wsat28");
    // Old Reddit's data-fullname and a tracked post id look the same; a key
    // that is something else falls back to the comments URL.
    assert.strictEqual(media.postFullname("1wsat28", comments), "t3_1wsat28");
    assert.strictEqual(media.postFullname("t1_abc", comments), "t3_1wsat28");
    assert.strictEqual(
      media.postFullname("t3_a,t3_b", "/r/x/comments/abc9/"),
      "t3_abc9",
    );
    [
      ["", ""],
      ["t3_", "https://www.reddit.com/r/pics/"],
      [undefined, undefined],
      [null, "https://www.reddit.com/r/x/comments/bad-id!/"],
    ].forEach(([key, url]) => {
      assert.strictEqual(media.postFullname(key, url), "", `${key} ${url}`);
    });
  });

  test("a player's still is Reddit's preview, and its tile loads the 640 pixel copy", () => {
    assert.ok(media, "grid media helpers not loaded");
    const post = {
      name: "t3_1wsat28",
      domain: "redgifs.com",
      preview: {
        images: [
          {
            source: {
              url: `${preview}?auto=webp&amp;s=full`,
              width: 1280,
              height: 960,
            },
            resolutions: copies(preview, 108, 216, 320, 640, 960, 1080),
          },
        ],
      },
      secure_media: {
        oembed: {
          thumbnail_url: "https://thumbs.example/other.jpg",
          thumbnail_width: 600,
          thumbnail_height: 450,
        },
      },
    };
    assert.deepStrictEqual(media.postStill(post), {
      url: `${preview}?auto=webp&s=full`,
      thumb: copy(preview, 640),
      width: 1280,
      height: 960,
    });
    // A still no wider than a tile needs no copy.
    const small = {
      preview: {
        images: [
          {
            source: { url: `${preview}?s=small`, width: 320, height: 240 },
            resolutions: copies(preview, 108, 216, 320),
          },
        ],
      },
    };
    assert.deepStrictEqual(media.postStill(small), {
      url: `${preview}?s=small`,
      thumb: "",
      width: 320,
      height: 240,
    });
  });

  test("an NSFW post's blurred copies are never read", () => {
    assert.ok(media, "grid media helpers not loaded");
    const blurred = (width) =>
      `${preview}?width=${width}&amp;blur=40&amp;format=pjpg&amp;s=b${width}`;
    const post = {
      over_18: true,
      thumbnail: "nsfw",
      preview: {
        images: [
          {
            // Without a source of its own, the widest real copy stands in.
            resolutions: [
              { url: blurred(1080), width: 1080, height: 810 },
              ...copies(preview, 108, 320, 640, 960),
            ],
            variants: {
              obfuscated: {
                source: { url: blurred(1280), width: 1280, height: 960 },
                resolutions: [{ url: blurred(640), width: 640, height: 480 }],
              },
              nsfw: {
                source: { url: blurred(1280), width: 1280, height: 960 },
                resolutions: [{ url: blurred(640), width: 640, height: 480 }],
              },
            },
          },
        ],
      },
    };
    const still = media.postStill(post);
    assert.deepStrictEqual(still, {
      url: copy(preview, 960),
      thumb: copy(preview, 640),
      width: 960,
      height: 720,
    });
    assert.ok(!JSON.stringify(still).includes("blur"));
    // A post with only blurred pictures has no still.
    assert.strictEqual(
      media.postStill({
        preview: {
          images: [
            {
              source: { url: blurred(1280), width: 1280, height: 960 },
              resolutions: [],
              variants: post.preview.images[0].variants,
            },
          ],
        },
      }),
      null,
    );
  });

  test("without a preview, the player's oEmbed thumbnail stands in", () => {
    assert.ok(media, "grid media helpers not loaded");
    const oembed = {
      thumbnail_url:
        "https://thumbs2.redgifs.com/CumbersomeShorttermKinglet-mobile.jpg?a=1&amp;b=2",
      thumbnail_width: 640,
      thumbnail_height: 480,
    };
    const expected = {
      thumb: "",
      url: "https://thumbs2.redgifs.com/CumbersomeShorttermKinglet-mobile.jpg?a=1&b=2",
      width: 640,
      height: 480,
    };
    assert.deepStrictEqual(
      media.postStill({ secure_media: { oembed } }),
      expected,
    );
    assert.deepStrictEqual(media.postStill({ media: { oembed } }), expected);
    assert.deepStrictEqual(
      media.postStill({
        preview: { images: [{ source: {}, resolutions: [] }] },
        media: { oembed: { thumbnail_url: oembed.thumbnail_url } },
      }),
      Object.assign({}, expected, { width: 0, height: 0 }),
    );
  });

  test("only http(s) stills count, and a GIF is no still", () => {
    assert.ok(media, "grid media helpers not loaded");
    [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "/relative/still.jpg",
      "https://preview.redd.it/anim.gif?width=640&s=x",
      "https://i.giphy.com/media/abc/giphy.gif",
      "",
      5,
    ].forEach((url) => {
      assert.strictEqual(
        media.postStill({
          preview: { images: [{ source: { url, width: 640, height: 480 } }] },
          secure_media: { oembed: { thumbnail_url: url } },
        }),
        null,
        String(url),
      );
    });
    [null, undefined, "post", 5, {}, { preview: {} }].forEach((post) => {
      assert.strictEqual(media.postStill(post), null, String(post));
    });
  });

  test("a GIF player's tile loops the narrowest MP4 wide enough, as signed", () => {
    assert.ok(media, "grid media helpers not loaded");
    // An uploaded GIF's player names one MP4, which stays as it is.
    const upload =
      "https://preview.redd.it/mqm32x4ox9sh1.gif?width=1100&format=mp4&s=ca0442188ad7d663c0a2912e69a0c8973d235928";
    assert.strictEqual(media.gifPlayerLoop(upload, null), upload);
    const bare = "https://preview.redd.it/abc.gif?format=mp4&s=x";
    assert.strictEqual(media.gifPlayerLoop(bare, ""), bare);
    // A video posted as a GIF names its MP4s in packaged-media-json.
    const permutation = (height, width) => ({
      source: {
        url: `https://packaged-media.redd.it/dvf13m3fhorh1/pb/m2-res_${height}p.mp4?m=DASHPlaylist.mpd&v=1&e=1790665200&s=${height}`,
        dimensions: { width, height },
        videoCodec: "H264",
      },
    });
    const sizes = [
      [220, 294],
      [270, 360],
      [360, 480],
      [480, 640],
      [720, 960],
      [1080, 1440],
    ];
    const packaged = JSON.stringify({
      playbackMp4s: {
        duration: 4,
        permutations: sizes.map(([height, width]) =>
          permutation(height, width),
        ),
      },
    });
    const hls =
      "https://v.redd.it/dvf13m3fhorh1/HLSPlaylist.m3u8?f=hd%2CsubsAll&v=1";
    assert.strictEqual(
      media.gifPlayerLoop(hls, packaged),
      permutation(480, 640).source.url,
    );
    // With every MP4 narrower, the widest.
    const narrow = JSON.stringify({
      playbackMp4s: {
        permutations: [permutation(220, 294), permutation(360, 480)],
      },
    });
    assert.strictEqual(
      media.gifPlayerLoop(hls, narrow),
      permutation(360, 480).source.url,
    );
    // A wide upload's MP4 makes way for a packaged one that is wide enough.
    assert.strictEqual(
      media.gifPlayerLoop(upload, packaged),
      permutation(480, 640).source.url,
    );
    // Nothing to loop.
    [
      [hls, null],
      [hls, "{not json"],
      [hls, JSON.stringify({ playbackMp4s: { permutations: "none" } })],
      [
        "",
        JSON.stringify({
          playbackMp4s: {
            permutations: [{ source: { url: "javascript:alert(1)" } }],
          },
        }),
      ],
      [undefined, undefined],
    ].forEach(([src, json]) => {
      assert.strictEqual(media.gifPlayerLoop(src, json), "", String(json));
    });
  });

  test("a video on v.redd.it is known by its id, and its files from its playlists", () => {
    assert.ok(media, "grid media helpers not loaded");
    [
      ["https://v.redd.it/6xn27aws6erh1", "6xn27aws6erh1"],
      [
        "https://v.redd.it/6xn27aws6erh1/CMAF_720.mp4?source=fallback",
        "6xn27aws6erh1",
      ],
      [
        "https://v.redd.it/dvf13m3fhorh1/HLSPlaylist.m3u8?f=hd&v=1",
        "dvf13m3fhorh1",
      ],
      ["http://v.redd.it/6xn27aws6erh1/CMAF_720.mp4", ""],
      ["https://packaged-media.redd.it/dvf13m3fhorh1/pb/m2-res_480p.mp4", ""],
      ["https://v.redd.it.example/6xn27aws6erh1/CMAF_720.mp4", ""],
      ["https://preview.redd.it/abc.gif?format=mp4", ""],
      [undefined, ""],
    ].forEach(([url, id]) => {
      assert.strictEqual(media.redditVideoId(url), id, String(url));
    });
    assert.strictEqual(
      media.dashManifestUrl("6xn27aws6erh1"),
      "https://v.redd.it/6xn27aws6erh1/DASHPlaylist.mpd",
    );
    [
      "https://v.redd.it/6xn27aws6erh1/CMAF_720.mp4?source=fallback",
      "https://v.redd.it/phsmtigw12841/DASH_360",
      "https://v.redd.it/3uu88suatgj11/DASH_2_4_M",
    ].forEach((url) => {
      assert.strictEqual(media.redditVideoFile(url), true, url);
    });
    [
      "https://v.redd.it/6xn27aws6erh1",
      "https://v.redd.it/6xn27aws6erh1/",
      "https://v.redd.it/6xn27aws6erh1/DASHPlaylist.mpd",
      "https://v.redd.it/6xn27aws6erh1/HLSPlaylist.m3u8?a=1",
      "https://v.redd.it/6xn27aws6erh1/CMAF_96.mp4",
      "https://v.redd.it/phsmtigw12841/DASH_96",
      "https://preview.redd.it/abc.gif?format=mp4",
    ].forEach((url) => {
      assert.strictEqual(media.redditVideoFile(url), false, url);
    });
  });

  test("a Reddit player's tile loops its video's file, or else reads the manifest alone", () => {
    assert.ok(media, "grid media helpers not loaded");
    const hls =
      "https://v.redd.it/rj3ydp3xqlih1/HLSPlaylist.m3u8?f=hd%2ChlsTrimLow&v=1&a=1793239893";
    const seek = "https://v.redd.it/rj3ydp3xqlih1/CMAF_96.mp4";
    const file = "https://v.redd.it/rj3ydp3xqlih1/CMAF_480.mp4";
    // The file among the player's URLs is what the tile falls back to.
    assert.strictEqual(media.redditPlayerLoop([hls, file, seek]), file);
    // A feed's player names only its playlist and the seek copy.
    assert.strictEqual(
      media.redditPlayerLoop([hls, seek, "https://v.redd.it/rj3ydp3xqlih1"]),
      "https://v.redd.it/rj3ydp3xqlih1/DASHPlaylist.mpd",
    );
    // Another video's file is no fallback.
    assert.strictEqual(
      media.redditPlayerLoop([hls, "https://v.redd.it/other/CMAF_480.mp4"]),
      "https://v.redd.it/rj3ydp3xqlih1/DASHPlaylist.mpd",
    );
    [
      [],
      ["https://videohost.example/clip.mp4", "javascript:alert(1)"],
      ["https://packaged-media.redd.it/rj3ydp3xqlih1/pb/m2-res_480p.mp4"],
      [null, undefined, ""],
      "not a list",
    ].forEach((urls) => {
      assert.strictEqual(media.redditPlayerLoop(urls), "", String(urls));
    });
  });

  test("a manifest's renditions come from its own names, never its audio", () => {
    assert.ok(media, "grid media helpers not loaded");
    const renditions = (id, text) =>
      media.dashVideoRenditions(
        parseXml(text),
        `https://v.redd.it/${id}/DASHPlaylist.mpd`,
      );
    const cmaf = "https://v.redd.it/nflcmaf1/";
    assert.deepStrictEqual(renditions("nflcmaf1", CMAF_MANIFEST), [
      {
        url: `${cmaf}CMAF_220.mp4`,
        width: 220,
        height: 356,
        bandwidth: 265470,
      },
      {
        url: `${cmaf}CMAF_270.mp4`,
        width: 270,
        height: 438,
        bandwidth: 490640,
      },
      {
        url: `${cmaf}CMAF_360.mp4`,
        width: 360,
        height: 584,
        bandwidth: 872400,
      },
      {
        url: `${cmaf}CMAF_480.mp4`,
        width: 480,
        height: 778,
        bandwidth: 1289724,
      },
      {
        url: `${cmaf}CMAF_720.mp4`,
        width: 720,
        height: 1168,
        bandwidth: 2502886,
      },
    ]);
    // Without an extension, as the renditions of 2019 have it.
    assert.deepStrictEqual(renditions("phsmtigw12841", DASH_MANIFEST), [
      {
        url: "https://v.redd.it/phsmtigw12841/DASH_360",
        width: 480,
        height: 360,
        bandwidth: 780991,
      },
      {
        url: "https://v.redd.it/phsmtigw12841/DASH_240",
        width: 320,
        height: 240,
        bandwidth: 599657,
      },
    ]);
    // What the renditions are is said on their set.
    assert.deepStrictEqual(
      renditions("533gopqyxa9a1", DASH_MP4_MANIFEST).map((item) => item.url),
      [
        "https://v.redd.it/533gopqyxa9a1/DASH_220.mp4",
        "https://v.redd.it/533gopqyxa9a1/DASH_240.mp4",
      ],
    );
    // Named after their bitrate, and not in order of size.
    assert.deepStrictEqual(
      renditions("3uu88suatgj11", BITRATE_MANIFEST).map((item) => [
        item.url,
        item.width,
        item.height,
      ]),
      [
        ["https://v.redd.it/3uu88suatgj11/DASH_2_4_M", 854, 480],
        ["https://v.redd.it/3uu88suatgj11/DASH_1_2_M", 640, 360],
        ["https://v.redd.it/3uu88suatgj11/DASH_4_8_M", 1280, 720],
        ["https://v.redd.it/3uu88suatgj11/DASH_600_K", 426, 240],
      ],
    );
  });

  test("a manifest names nothing outside its video's folder, and nothing without a size", () => {
    assert.ok(media, "grid media helpers not loaded");
    const manifest = (representations) =>
      parseXml(
        `<MPD><Period><AdaptationSet contentType="video">${representations}</AdaptationSet></Period></MPD>`,
      );
    const representation = (base, size = 'width="640" height="360"') =>
      `<Representation bandwidth="1" ${size} mimeType="video/mp4"><BaseURL>${base}</BaseURL></Representation>`;
    const url = "https://v.redd.it/clip1/DASHPlaylist.mpd";
    assert.deepStrictEqual(
      media
        .dashVideoRenditions(
          manifest(
            [
              representation("https://videohost.example/clip.mp4"),
              representation("../other1/CMAF_360.mp4"),
              representation("//v.redd.it/other1/CMAF_360.mp4"),
              representation("CMAF_360.mp4", 'width="640"'),
              representation(""),
              representation("CMAF_480.mp4"),
            ].join(""),
          ),
          url,
        )
        .map((item) => item.url),
      ["https://v.redd.it/clip1/CMAF_480.mp4"],
    );
    // Only a manifest on v.redd.it counts, and a page that failed to parse
    // names nothing.
    assert.deepStrictEqual(
      media.dashVideoRenditions(
        manifest(representation("CMAF_360.mp4")),
        "https://videohost.example/clip1/DASHPlaylist.mpd",
      ),
      [],
    );
    [null, undefined, {}, parseXml("<parsererror>bad</parsererror>")].forEach(
      (doc) => {
        assert.deepStrictEqual(
          media.dashVideoRenditions(doc, url),
          [],
          String(doc),
        );
      },
    );
  });

  test("a video's tile loops its smallest rendition 360 pixels across, or else its largest", () => {
    assert.ok(media, "grid media helpers not loaded");
    assert.strictEqual(media.GRID_LOOP_SHORT_SIDE, 360);
    const pick = (id, text) =>
      media.videoLoopRendition(
        media.dashVideoRenditions(
          parseXml(text),
          `https://v.redd.it/${id}/DASHPlaylist.mpd`,
        ),
      )?.url;
    // A portrait clip's 360 is its width.
    assert.strictEqual(
      pick("nflcmaf1", CMAF_MANIFEST),
      "https://v.redd.it/nflcmaf1/CMAF_360.mp4",
    );
    assert.strictEqual(
      pick("phsmtigw12841", DASH_MANIFEST),
      "https://v.redd.it/phsmtigw12841/DASH_360",
    );
    assert.strictEqual(
      pick("3uu88suatgj11", BITRATE_MANIFEST),
      "https://v.redd.it/3uu88suatgj11/DASH_1_2_M",
    );
    // A clip smaller than that loops its largest.
    assert.strictEqual(
      pick("533gopqyxa9a1", DASH_MP4_MANIFEST),
      "https://v.redd.it/533gopqyxa9a1/DASH_240.mp4",
    );
    const rendition = (url, width, height, bandwidth = 0) => ({
      url,
      width,
      height,
      bandwidth,
    });
    // Without a 360, the smallest above it.
    assert.strictEqual(
      media.videoLoopRendition([
        rendition("a", 426, 240),
        rendition("c", 1280, 720),
        rendition("b", 854, 480),
      ]).url,
      "b",
    );
    // Of two the same size, the lighter; renditions without a size or a URL
    // are passed over.
    assert.strictEqual(
      media.videoLoopRendition([
        rendition("heavy", 640, 360, 900000),
        rendition("light", 640, 360, 600000),
        rendition("unsized", 0, 0),
        rendition("", 480, 360),
        null,
      ]).url,
      "light",
    );
    assert.strictEqual(media.videoLoopRendition([]), null);
    assert.strictEqual(media.videoLoopRendition(undefined), null);
  });

  test("a Reddit player that names its MP4s with their sizes needs no manifest", () => {
    assert.ok(media, "grid media helpers not loaded");
    const permutation = (height, width) => ({
      source: {
        url: `https://packaged-media.redd.it/ighybi90b5sh1/pb/m2-res_${height}p.mp4?m=DASHPlaylist.mpd&v=1&e=1790665200&s=${height}`,
        dimensions: { width, height },
      },
    });
    const packaged = (...sizes) =>
      JSON.stringify({
        playbackMp4s: {
          permutations: sizes.map(([height, width]) =>
            permutation(height, width),
          ),
        },
      });
    assert.strictEqual(
      media.packagedVideoLoop(
        packaged([220, 392], [270, 480], [360, 640], [480, 854], [720, 1280]),
      ),
      permutation(360, 640).source.url,
    );
    assert.strictEqual(
      media.packagedVideoLoop(packaged([220, 392], [270, 480])),
      permutation(270, 480).source.url,
    );
    // MP4s without sizes leave the choice to the manifest.
    [
      JSON.stringify({
        playbackMp4s: {
          permutations: [{ source: { url: permutation(360, 640).source.url } }],
        },
      }),
      "{not json",
      null,
    ].forEach((json) => {
      assert.strictEqual(media.packagedVideoLoop(json), "", String(json));
    });
  });

  test("a post's data names Reddit's copy of its clip, or its own video", () => {
    assert.ok(media, "grid media helpers not loaded");
    const copy = "https://v.redd.it/kyuaevw0lcsh1/CMAF_1080.mp4";
    assert.strictEqual(
      media.postLoop({
        domain: "redgifs.com",
        preview: {
          images: [],
          reddit_video_preview: {
            fallback_url: copy,
            dash_url: "https://v.redd.it/kyuaevw0lcsh1/DASHPlaylist.mpd",
            is_gif: true,
          },
        },
      }),
      copy,
    );
    assert.strictEqual(
      media.postLoop({
        secure_media: {
          reddit_video: {
            fallback_url:
              "https://v.redd.it/6xn27aws6erh1/CMAF_720.mp4?source=fallback",
          },
        },
      }),
      "https://v.redd.it/6xn27aws6erh1/CMAF_720.mp4?source=fallback",
    );
    [
      null,
      "post",
      {},
      {
        preview: {
          reddit_video_preview: {
            fallback_url: "http://v.redd.it/a/DASH_360.mp4",
          },
        },
      },
      {
        preview: {
          reddit_video_preview: {
            fallback_url: "https://thumbs.example/a.mp4",
          },
        },
      },
      {
        media: {
          reddit_video: {
            fallback_url: "https://v.redd.it/a/HLSPlaylist.m3u8",
          },
        },
      },
      { media: { oembed: { thumbnail_url: "https://thumbs.example/a.jpg" } } },
    ].forEach((post) => {
      assert.strictEqual(media.postLoop(post), "", JSON.stringify(post));
    });
  });

  test("another source's loop plays only from Reddit's media hosts, over https", () => {
    assert.ok(media, "grid media helpers not loaded");
    [
      "https://v.redd.it/kyuaevw0lcsh1/CMAF_1080.mp4",
      "https://preview.redd.it/anim.gif?width=640&format=mp4&s=x",
      "https://i.redd.it/anim.gif?format=mp4",
      "https://external-preview.redd.it/clip.gif?format=mp4&s=x",
    ].forEach((url) => {
      assert.strictEqual(media.gridLoopUrl(url), url, url);
    });
    [
      "http://v.redd.it/kyuaevw0lcsh1/CMAF_1080.mp4",
      "https://packaged-media.redd.it/a/pb/m2-res_480p.mp4",
      "https://i.imgur.com/RCtmQG7.mp4",
      "https://v.redd.it.example/a/CMAF_360.mp4",
      "https://media.redgifs.com/Clip.mp4",
      "javascript:alert(1)",
      "/relative.mp4",
      "",
      null,
      undefined,
    ].forEach((url) => {
      assert.strictEqual(media.gridLoopUrl(url), "", String(url));
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

suite("browser-extension hidden list", () => {
  // The Hidden list lives in the media filter's block, since the filter
  // applies it.
  const hidden = loadContentScriptBlock("redditp-media-filter", [
    "HIDDEN_MAX_ENTRIES",
    "normalizeHiddenEntry",
    "normalizedHiddenList",
    "addToHiddenList",
    "removeFromHiddenList",
    "slideIsHidden",
    "slideMatchesFilter",
    "mediaFilterActive",
    "filterSummary",
  ]);
  const ALL = { showImages: true, showGifs: true, showVideos: true };
  const IMAGES_ONLY = { showImages: true, showGifs: false, showVideos: false };
  // A Reddit image post by u/Alice in r/pics, linking the picture.
  function post(fields = {}) {
    return {
      kind: "image",
      media: "image",
      postMedia: true,
      author: "u/Alice",
      community: "r/pics",
      url: "https://i.redd.it/abc.jpg",
      sourceUrl: "https://i.redd.it/abc.jpg",
      ...fields,
    };
  }

  test("hidden list helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      hidden,
      "did not find the redditp-media-filter markers in content.js",
    );
  });

  test("an entry names a user, a subreddit or a site", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    [
      ["u/Alice", "u/Alice"],
      ["/u/Alice", "u/Alice"],
      ["U/Alice", "u/Alice"],
      ["user/Alice", "u/Alice"],
      ["/user/Alice/", "u/Alice"],
      ["  u/Alice  ", "u/Alice"],
      // A word without a dot is a user: Reddit's usernames have none.
      ["Alice", "u/Alice"],
      ["some_user-42", "u/some_user-42"],
      ["redgifs", "u/redgifs"],
      ["a".repeat(20), `u/${"a".repeat(20)}`],
      ["r/Pics", "r/Pics"],
      ["/r/pics/", "r/pics"],
      ["R/pics", "r/pics"],
      ["r/de", "r/de"],
      ["r/u_alice", "r/u_alice"],
      // Anything with a dot is a site, lowercase, without "www.".
      ["redgifs.com", "redgifs.com"],
      ["RedGifs.COM", "redgifs.com"],
      ["www.redgifs.com", "redgifs.com"],
      ["redgifs.com.", "redgifs.com"],
      ["v3.redgifs.com", "v3.redgifs.com"],
      ["https://www.redgifs.com/watch/clip", "redgifs.com"],
      ["redgifs.com/watch/clip", "redgifs.com"],
      ["http://i.imgur.com:8080/a.jpg", "i.imgur.com"],
      ["reddit.com", "reddit.com"],
      // A Reddit address of a user or a subreddit names them.
      ["https://www.reddit.com/user/Alice/", "u/Alice"],
      ["https://old.reddit.com/u/Alice", "u/Alice"],
      ["www.reddit.com/r/pics/top/", "r/pics"],
    ].forEach(([input, expected]) => {
      assert.strictEqual(
        hidden.normalizeHiddenEntry(input),
        expected,
        JSON.stringify(input),
      );
    });
  });

  test("anything else is no entry", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    [
      "",
      "   ",
      "/",
      "u/",
      "r/",
      "user/",
      "u/[deleted]",
      "[deleted]",
      "u/some.name",
      "r/a",
      "r/with-dash",
      `r/${"a".repeat(22)}`,
      "a".repeat(21),
      "two words",
      "u/alice/extra",
      ".com",
      "a..b",
      "-bad.com",
      "javascript:alert(1)",
      `${"a".repeat(3000)}.com`,
      null,
      undefined,
      42,
      ["u/alice"],
    ].forEach((input) => {
      assert.strictEqual(
        hidden.normalizeHiddenEntry(input),
        "",
        JSON.stringify(input),
      );
    });
  });

  test("a saved list keeps entries only, each once, up to the cap", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    [null, undefined, "u/alice", { 0: "u/alice" }, 7].forEach((value) => {
      assert.deepStrictEqual(hidden.normalizedHiddenList(value), []);
    });
    assert.deepStrictEqual(
      hidden.normalizedHiddenList([
        "u/Alice",
        "U/alice",
        "alice",
        42,
        null,
        { entry: "u/bob" },
        "r/pics",
        "/r/PICS/",
        "nonsense entry",
        "www.RedGifs.com",
        "redgifs.com",
      ]),
      ["u/Alice", "r/pics", "redgifs.com"],
    );
    const many = Array.from(
      { length: hidden.HIDDEN_MAX_ENTRIES + 5 },
      (_, index) => `u/user${index}`,
    );
    const capped = hidden.normalizedHiddenList(many);
    assert.strictEqual(capped.length, hidden.HIDDEN_MAX_ENTRIES);
    assert.deepStrictEqual(capped, many.slice(0, hidden.HIDDEN_MAX_ENTRIES));
  });

  test("adding says what happened and never changes the list it is given", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    const list = Object.freeze(["u/Alice"]);
    assert.deepStrictEqual(hidden.addToHiddenList(list, "r/pics"), {
      list: ["u/Alice", "r/pics"],
      entry: "r/pics",
      status: "added",
    });
    assert.deepStrictEqual(hidden.addToHiddenList(list, "/u/ALICE"), {
      list,
      entry: "u/Alice",
      status: "duplicate",
    });
    assert.strictEqual(
      hidden.addToHiddenList(list, "not valid").status,
      "invalid",
    );
    assert.strictEqual(hidden.addToHiddenList(list, "").status, "invalid");
    const full = Array.from(
      { length: hidden.HIDDEN_MAX_ENTRIES },
      (_, index) => `u/user${index}`,
    );
    const result = hidden.addToHiddenList(full, "u/onemore");
    assert.strictEqual(result.status, "full");
    assert.strictEqual(result.list, full);
    assert.deepStrictEqual(list, ["u/Alice"]);
  });

  test("removing an entry goes by any case", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    const list = ["u/Alice", "r/pics", "redgifs.com"];
    assert.deepStrictEqual(hidden.removeFromHiddenList(list, "u/alice"), [
      "r/pics",
      "redgifs.com",
    ]);
    assert.deepStrictEqual(hidden.removeFromHiddenList(list, "R/PICS"), [
      "u/Alice",
      "redgifs.com",
    ]);
    assert.deepStrictEqual(hidden.removeFromHiddenList(list, "u/nobody"), list);
    assert.deepStrictEqual(list, ["u/Alice", "r/pics", "redgifs.com"]);
  });

  test("a user or a subreddit matches in any case", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    assert.strictEqual(hidden.slideIsHidden(post(), ["u/alice"]), true);
    assert.strictEqual(hidden.slideIsHidden(post(), ["U/ALICE"]), true);
    assert.strictEqual(hidden.slideIsHidden(post(), ["r/PICS"]), true);
    assert.strictEqual(hidden.slideIsHidden(post(), ["u/alicex"]), false);
    assert.strictEqual(hidden.slideIsHidden(post(), ["u/pics"]), false);
    assert.strictEqual(hidden.slideIsHidden(post(), ["r/alice"]), false);
    // Another source may leave out the prefix.
    assert.strictEqual(
      hidden.slideIsHidden(post({ author: "Alice", community: "" }), [
        "u/alice",
      ]),
      true,
    );
    assert.strictEqual(
      hidden.slideIsHidden(post({ author: "", community: "pics" }), ["r/pics"]),
      true,
    );
    // No list, or an empty one, hides nothing.
    [undefined, null, []].forEach((list) => {
      assert.strictEqual(hidden.slideIsHidden(post(), list), false);
    });
  });

  test("a site matches its own host and its subdomains, and nothing else", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    const linking = (sourceUrl) => post({ sourceUrl, url: "" });
    [
      ["https://redgifs.com/watch/a", true],
      ["https://www.redgifs.com/watch/a", true],
      ["https://v3.redgifs.com/watch/a", true],
      ["https://WWW.RedGifs.com/watch/a", true],
      ["https://notredgifs.com/watch/a", false],
      ["https://redgifs.com.example/watch/a", false],
      ["https://redgifs.co/watch/a", false],
      ["https://example.com/?u=redgifs.com", false],
    ].forEach(([url, expected]) => {
      assert.strictEqual(
        hidden.slideIsHidden(linking(url), ["redgifs.com"]),
        expected,
        url,
      );
    });
    // A subdomain's entry leaves its parent alone.
    assert.strictEqual(
      hidden.slideIsHidden(linking("https://redgifs.com/a"), [
        "v3.redgifs.com",
      ]),
      false,
    );
    // Without a link of its own, the slide's media counts.
    assert.strictEqual(
      hidden.slideIsHidden(
        post({ sourceUrl: "", url: "https://media.redgifs.com/a.mp4" }),
        ["redgifs.com"],
      ),
      true,
    );
    assert.strictEqual(
      hidden.slideIsHidden(
        post({ sourceUrl: "not a url", url: "https://i.redd.it/a.jpg" }),
        ["redd.it"],
      ),
      true,
    );
    // A search thumbnail does not know its post's link yet, but does know
    // its author.
    const thumbnail = post({
      mediaUnknown: true,
      sourceUrl: "https://www.redgifs.com/watch/a",
    });
    assert.strictEqual(hidden.slideIsHidden(thumbnail, ["redgifs.com"]), false);
    assert.strictEqual(hidden.slideIsHidden(thumbnail, ["u/alice"]), true);
  });

  test("a slide's new link is read afresh", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    const slide = post({ sourceUrl: "https://example.com/a" });
    assert.strictEqual(hidden.slideIsHidden(slide, ["redgifs.com"]), false);
    slide.sourceUrl = "https://www.redgifs.com/watch/a";
    assert.strictEqual(hidden.slideIsHidden(slide, ["redgifs.com"]), true);
  });

  test("the Hidden list leaves posts out whether or not the Show filter is on", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    const video = post({
      kind: "video",
      media: "video",
      url: "https://v.redd.it/a/DASH_480.mp4",
      sourceUrl: "https://v.redd.it/a",
      author: "u/Bob",
    });
    const bobs = post({ author: "u/Bob" });
    const withList = (settings) =>
      Object.assign({}, settings, { hidden: ["u/alice"] });
    // The list alone is no Show filter.
    assert.strictEqual(hidden.mediaFilterActive(withList(ALL)), false);
    assert.strictEqual(hidden.slideMatchesFilter(post(), withList(ALL)), false);
    assert.strictEqual(hidden.slideMatchesFilter(bobs, withList(ALL)), true);
    assert.strictEqual(hidden.slideMatchesFilter(video, withList(ALL)), true);
    assert.strictEqual(
      hidden.slideMatchesFilter(post(), withList(IMAGES_ONLY)),
      false,
    );
    assert.strictEqual(
      hidden.slideMatchesFilter(bobs, withList(IMAGES_ONLY)),
      true,
    );
    assert.strictEqual(
      hidden.slideMatchesFilter(video, withList(IMAGES_ONLY)),
      false,
    );
    // Settings saved before the list existed have none.
    assert.strictEqual(hidden.slideMatchesFilter(post(), ALL), true);
    // A link post shows with every type on, unless the list hides it.
    const link = post({ kind: "link", media: "link", author: "u/Alice" });
    assert.strictEqual(hidden.slideMatchesFilter(link, ALL), true);
    assert.strictEqual(hidden.slideMatchesFilter(link, withList(ALL)), false);
  });

  test("the counter names the Show filter, then how many posts are hidden", () => {
    assert.ok(hidden, "hidden list helpers not loaded");
    assert.strictEqual(hidden.filterSummary(ALL, 0), "");
    assert.strictEqual(hidden.filterSummary(ALL, 1), "1 hidden");
    assert.strictEqual(hidden.filterSummary(IMAGES_ONLY, 0), "images only");
    assert.strictEqual(
      hidden.filterSummary(IMAGES_ONLY, 12),
      "images only · 12 hidden",
    );
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
    "warmVideoUrls",
    "WARM_VIDEOS_AHEAD",
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
  });

  test("the next six pictures load ahead, twelve stay, and two videos warm", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    assert.strictEqual(loading.PRELOAD_AHEAD, 6);
    assert.strictEqual(loading.PRELOAD_CACHE_SIZE, 12);
    assert.strictEqual(loading.WARM_VIDEOS_AHEAD, 2);
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

  test("the next six slides' pictures are fetched ahead", () => {
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
      { kind: "image", url: "https://i.redd.it/fifth-ahead.jpg" },
      { kind: "image", url: "https://i.redd.it/sixth-ahead.jpg" },
      { kind: "image", url: "https://i.redd.it/seventh-ahead.jpg" },
    ];
    assert.deepStrictEqual(loading.preloadUrls(slides, 0), [
      "https://i.redd.it/next.jpg",
      "https://external-preview.redd.it/clip.png",
      "https://external-preview.redd.it/live.png",
      "https://i.redd.it/fourth-ahead.jpg",
      "https://i.redd.it/fifth-ahead.jpg",
      "https://i.redd.it/sixth-ahead.jpg",
    ]);
    assert.deepStrictEqual(loading.preloadUrls(slides, 1), [
      "https://external-preview.redd.it/clip.png",
      "https://external-preview.redd.it/live.png",
      "https://i.redd.it/fourth-ahead.jpg",
      "https://i.redd.it/fifth-ahead.jpg",
      "https://i.redd.it/sixth-ahead.jpg",
      "https://i.redd.it/seventh-ahead.jpg",
    ]);
  });

  test("the next two Reddit videos within six slides are read in ahead", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const video = (url) => ({ kind: "video", url, poster: "" });
    const slides = [
      video("https://v.redd.it/current/CMAF_1080.mp4?source=fallback"),
      { kind: "image", url: "https://i.redd.it/next.jpg" },
      video("https://v.redd.it/first/CMAF_1080.mp4?source=fallback"),
      video("https://preview.redd.it/second.gif?format=mp4&s=a"),
      video("https://packaged-media.redd.it/third/pb/m2-res_1080p.mp4?s=b"),
    ];
    assert.deepStrictEqual(loading.warmVideoUrls(slides, 0), [
      "https://v.redd.it/first/CMAF_1080.mp4?source=fallback",
      "https://preview.redd.it/second.gif?format=mp4&s=a",
    ]);
    assert.deepStrictEqual(loading.warmVideoUrls(slides, 3), [
      "https://packaged-media.redd.it/third/pb/m2-res_1080p.mp4?s=b",
    ]);
    assert.deepStrictEqual(loading.warmVideoUrls(slides, 4), []);
  });

  test("players, other hosts, playlists and videos beyond six slides are not read in", () => {
    assert.ok(loading, "feed loading helpers not loaded");
    const picture = { kind: "image", url: "https://i.redd.it/a.jpg" };
    const slides = [
      picture,
      {
        kind: "pending-native-video",
        url: "https://v.redd.it/live",
        poster: "https://external-preview.redd.it/live.png",
      },
      { kind: "native-video", url: "https://www.reddit.com/r/a/" },
      { kind: "video", url: "https://i.imgur.com/loop.mp4" },
      { kind: "video", url: "http://v.redd.it/plain/DASH_480.mp4" },
      { kind: "video", url: "https://v.redd.it/stream/HLSPlaylist.m3u8" },
      { kind: "embed", url: "https://www.youtube.com/embed/a" },
      { kind: "video", url: "https://v.redd.it/far/DASH_480.mp4" },
    ];
    assert.deepStrictEqual(loading.warmVideoUrls(slides, 0), []);
    assert.deepStrictEqual(loading.warmVideoUrls(slides, 1), [
      "https://v.redd.it/far/DASH_480.mp4",
    ]);
    // A video repeated, as in a crosspost, is read in once.
    const same = { kind: "video", url: "https://v.redd.it/same/DASH_480.mp4" };
    assert.deepStrictEqual(loading.warmVideoUrls([picture, same, same], 0), [
      "https://v.redd.it/same/DASH_480.mp4",
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

suite("browser-extension grid ahead", () => {
  const ahead = loadContentScriptBlock("redditp-grid-ahead", [
    "GRID_LOAD_MARGIN",
    "GRID_LOAD_ROUNDS",
    "GRID_PICTURE_MARGIN",
    "GRID_STILL_MARGIN",
    "GRID_LOOP_MARGIN",
    "GRID_MAX_PLAYING_LOOPS",
    "GRID_MAX_BUFFERING_LOOPS",
    "GRID_MANIFEST_CONCURRENCY",
    "GRID_STILL_BATCH",
    "GRID_STILL_CONCURRENCY",
    "gridLoopPlan",
    "gridLoopReadIn",
    "gridLoadWanted",
  ]);
  const layout = loadContentScriptBlock("redditp-grid-layout", [
    "gridColumnCount",
    "tileHeightRatio",
  ]);
  // A loop off the view, `distance` pixels away, that was never asked to
  // read ahead; fields override.
  const away = (distance, fields = {}) => ({
    visible: false,
    distance,
    ready: false,
    buffer: "",
    ...fields,
  });
  // A loop in view, its tile starting `top` pixels down, that can play or
  // not yet; fields override.
  const inView = (ready, top = 0, fields = {}) => ({
    visible: true,
    top,
    distance: 0,
    ready,
    buffer: "reading",
    ...fields,
  });

  test("grid ahead helpers could be loaded", () => {
    // Guards the slice above: if the markers move or disappear, this fails
    // loudly instead of silently skipping the checks below.
    assert.ok(
      ahead,
      "did not find the redditp-grid-ahead markers in content.js",
    );
    assert.ok(layout, "did not find the redditp-grid-layout markers");
  });

  test("pictures, stills and manifests reach two screens up and six down", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    assert.strictEqual(ahead.GRID_PICTURE_MARGIN, "200% 0px 600% 0px");
    assert.strictEqual(ahead.GRID_STILL_MARGIN, ahead.GRID_PICTURE_MARGIN);
  });

  test("Reddit's data comes 100 posts a request, two at a time, and manifests twelve at a time", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    assert.strictEqual(ahead.GRID_STILL_BATCH, 100);
    assert.strictEqual(ahead.GRID_STILL_CONCURRENCY, 2);
    assert.strictEqual(ahead.GRID_MANIFEST_CONCURRENCY, 12);
  });

  test("loops come half a screen up and a screen down, six reading at once", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    assert.strictEqual(ahead.GRID_LOOP_MARGIN, "50% 0px 100% 0px");
    assert.strictEqual(ahead.GRID_MAX_BUFFERING_LOOPS, 6);
  });

  test("every tile that fits in view at 2560x1440 may loop at once", () => {
    assert.ok(ahead && layout, "grid ahead helpers not loaded");
    // The grid's padding and gaps, as presentation.css sets them.
    const width = 2560 - 2 * 8;
    const columns = layout.gridColumnCount(2560);
    const tileWidth = (width - (columns - 1) * 8) / columns;
    const shortest = tileWidth * layout.tileHeightRatio(2, 1);
    // A column shows as many tiles as start within the view, and one more
    // cut off at its top.
    const perColumn = Math.ceil(1440 / (shortest + 8)) + 1;
    assert.strictEqual(columns, 8);
    assert.ok(
      ahead.GRID_MAX_PLAYING_LOOPS >= columns * perColumn,
      `${ahead.GRID_MAX_PLAYING_LOOPS} < ${columns * perColumn}`,
    );
  });

  test("the grid loads from eight screens before its end, six loads in a row", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    assert.strictEqual(ahead.GRID_LOAD_MARGIN, "800% 0px");
    assert.strictEqual(ahead.GRID_LOAD_ROUNDS, 6);
  });

  test("after six loads in a row the grid waits for half a screen of scrolling", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    const wanted = ahead.gridLoadWanted;
    assert.strictEqual(wanted(0, 0, 1000), true);
    assert.strictEqual(wanted(5, 0, 1000), true);
    assert.strictEqual(wanted(6, 0, 1000), false);
    assert.strictEqual(wanted(6, 499, 1000), false);
    assert.strictEqual(wanted(6, 500, 1000), true);
    assert.strictEqual(wanted(60, -500, 1000), true);
  });

  test("loops in view play from the top of the view down, up to the most that play", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    const max = ahead.GRID_MAX_PLAYING_LOOPS;
    // Arrived bottom first.
    const loops = [
      away(100),
      ...Array.from({ length: max + 2 }, (_, index) =>
        inView(true, 1000 - index),
      ),
    ];
    const plan = ahead.gridLoopPlan(loops);
    assert.strictEqual(plan.filter((action) => action === "play").length, max);
    assert.deepStrictEqual(plan.slice(1, 3), ["cap", "cap"]);
    assert.strictEqual(plan[plan.length - 1], "play");
  });

  test("every loop in view starts at once, whether it can play yet or not", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    const loops = [500, 100, 300, 0, 400, 200].map((top) => inView(false, top));
    assert.deepStrictEqual(
      ahead.gridLoopPlan(loops),
      loops.map(() => "play"),
    );
  });

  test("nothing reads ahead until every loop in view that plays can", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    const loops = [inView(true, 0), inView(false, 10), away(10), away(20)];
    assert.deepStrictEqual(ahead.gridLoopPlan(loops), [
      "play",
      "play",
      "wait",
      "wait",
    ]);
    loops[1].ready = true;
    assert.deepStrictEqual(ahead.gridLoopPlan(loops), [
      "play",
      "play",
      "buffer",
      "buffer",
    ]);
    // A loop in view beyond those that play waits, and holds nothing up.
    const capped = Array.from({ length: ahead.GRID_MAX_PLAYING_LOOPS }, () =>
      inView(true),
    );
    capped.push(inView(false, 10, { buffer: "" }), away(5));
    assert.deepStrictEqual(ahead.gridLoopPlan(capped).slice(-2), [
      "cap",
      "buffer",
    ]);
  });

  test("the nearest loops read ahead first, six at a time", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    const distances = [900, 50, 700, 10, 300, 20, 600, 40, 800];
    const plan = ahead.gridLoopPlan(
      distances.map((distance) => away(distance)),
    );
    assert.deepStrictEqual(
      distances.filter((_distance, index) => plan[index] === "buffer"),
      [50, 10, 300, 20, 600, 40],
    );
    assert.deepStrictEqual(
      distances.filter((_distance, index) => plan[index] === "wait"),
      [900, 700, 800],
    );
  });

  test("loops that read keep a place, and those that have read free theirs", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    const reading = Array.from({ length: 6 }, () =>
      away(500, { buffer: "reading" }),
    );
    const plan = ahead.gridLoopPlan([...reading, away(1)]);
    assert.deepStrictEqual(plan, [
      "buffer",
      "buffer",
      "buffer",
      "buffer",
      "buffer",
      "buffer",
      "wait",
    ]);
    reading[0].buffer = "read";
    assert.strictEqual(ahead.gridLoopPlan([...reading, away(1)])[6], "buffer");
    // A loop that played in view and scrolled away keeps what it read,
    // paused.
    assert.deepStrictEqual(
      ahead.gridLoopPlan([away(0, { buffer: "read" }), inView(true)]),
      ["buffer", "play"],
    );
  });

  test("an empty grid plans nothing", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    assert.deepStrictEqual(ahead.gridLoopPlan([]), []);
  });

  test("a loop has read itself in once it holds all of itself or five seconds on", () => {
    assert.ok(ahead, "grid ahead helpers not loaded");
    const readIn = ahead.gridLoopReadIn;
    // A short loop, whole or not.
    assert.strictEqual(readIn([[0, 3]], 0, 3), true);
    assert.strictEqual(readIn([[0, 2.5]], 0, 3), false);
    // A long one, five seconds past where it is.
    assert.strictEqual(readIn([[0, 5]], 0, 60), true);
    assert.strictEqual(readIn([[0, 4]], 0, 60), false);
    assert.strictEqual(readIn([[0, 8]], 4, 60), false);
    const twoSpans = [
      [0, 4],
      [10, 20],
    ];
    assert.strictEqual(readIn(twoSpans, 12, 60), true);
    // What it holds elsewhere does not count, nor does a loop of unknown
    // length.
    assert.strictEqual(readIn([[1, 20]], 0, 60), false);
    assert.strictEqual(readIn([], 0, 60), false);
    assert.strictEqual(readIn([[0, 5]], 0, NaN), false);
  });
});

suite("browser-extension media URLs", () => {
  const urls = loadContentScriptBlock("redditp-media-urls", [
    "IMAGE_URL_RE",
    "VIDEO_URL_RE",
    "isVideoUrl",
    "canonicalMediaKey",
    "externalMedia",
    "embedStill",
    "embedUrl",
    "youtubeStartSeconds",
    "redditUpload",
    "sameRedditUpload",
    "redditOriginalUrl",
    "isRedditGifMp4",
    "srcsetCandidates",
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

  test("an imgur video file is a video, not a picture", () => {
    assert.ok(urls, "media URL helpers not loaded");
    ["mp4", "webm"].forEach((extension) => {
      assert.deepStrictEqual(
        urls.externalMedia(`https://i.imgur.com/a1.${extension}`),
        { kind: "video", url: `https://i.imgur.com/a1.${extension}` },
        extension,
      );
    });
  });

  test("a YouTube player's still is YouTube's own; other players have none", () => {
    assert.ok(urls, "media URL helpers not loaded");
    assert.strictEqual(
      urls.embedStill(
        "https://www.youtube.com/embed/ab-C_1?start=65&enablejsapi=1",
      ),
      "https://i.ytimg.com/vi/ab-C_1/hqdefault.jpg",
    );
    [
      "https://videohost.example/ifr/abc",
      "https://www.redgifs.com/ifr/someclip",
      "https://www.youtube.com/watch?v=abc",
      "https://evil.example/embed/abc",
      "not a url",
    ].forEach((url) => {
      assert.strictEqual(urls.embedStill(url), "", url);
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

  test("Reddit's copies of an upload are told by the upload's id", () => {
    assert.ok(urls, "media URL helpers not loaded");
    assert.deepStrictEqual(urls.redditUpload("https://i.redd.it/abc123.jpeg"), {
      host: "i.redd.it",
      id: "abc123",
      extension: "jpeg",
      format: "",
    });
    assert.deepStrictEqual(
      urls.redditUpload(
        "https://preview.redd.it/my-cat-v0-abc123.jpeg?width=640&format=pjpg&auto=webp&s=x",
      ),
      {
        host: "preview.redd.it",
        id: "abc123",
        extension: "jpeg",
        format: "pjpg",
      },
    );
    [
      "https://external-preview.redd.it/abc123.jpeg",
      "https://i.imgur.com/abc123.jpeg",
      "https://preview.redd.it/folder/abc123.jpeg",
      "https://preview.redd.it/abc123",
      "not a url",
    ].forEach((url) => {
      assert.strictEqual(urls.redditUpload(url), null, url);
    });
    [
      [
        "https://i.redd.it/abc123.jpeg",
        "https://preview.redd.it/my-cat-v0-ABC123.jpeg?width=640&s=x",
      ],
      [
        "https://i.redd.it/anim.gif",
        "https://preview.redd.it/anim.gif?format=mp4",
      ],
    ].forEach(([first, second]) => {
      assert.strictEqual(urls.sameRedditUpload(first, second), true, second);
    });
    [
      ["https://i.redd.it/abc123.jpeg", "https://preview.redd.it/other1.jpeg"],
      [
        "https://i.imgur.com/abc123.jpeg",
        "https://preview.redd.it/abc123.jpeg",
      ],
      ["not a url", "not a url"],
    ].forEach(([first, second]) => {
      assert.strictEqual(urls.sameRedditUpload(first, second), false, first);
    });
  });

  test("a full-size transcode of a JPEG or WebP loads from its upload", () => {
    assert.ok(urls, "media URL helpers not loaded");
    [
      [
        "https://preview.redd.it/abc123.jpg?width=4032&format=pjpg&auto=webp&s=x",
        "https://i.redd.it/abc123.jpg",
      ],
      [
        "https://preview.redd.it/my-cat-v0-abc123.jpeg?width=3024&format=pjpg&auto=webp&s=x",
        "https://i.redd.it/abc123.jpeg",
      ],
      [
        "https://preview.redd.it/abc123.webp?width=2000&format=pjpg&s=x",
        "https://i.redd.it/abc123.webp",
      ],
    ].forEach(([url, original]) => {
      assert.strictEqual(urls.redditOriginalUrl(url), original, url);
    });
    [
      // A PNG's original can weigh many times its transcode.
      "https://preview.redd.it/abc123.png?width=1080&format=pjpg&s=x",
      // A downscaled copy is no transcode of the whole picture.
      "https://preview.redd.it/abc123.jpg?width=1080&crop=smart&auto=webp&s=x",
      "https://external-preview.redd.it/abc123.jpg?format=pjpg&s=x",
      "https://i.redd.it/abc123.jpg",
      "https://preview.redd.it/folder/abc123.jpg?format=pjpg",
      "not a url",
    ].forEach((url) => {
      assert.strictEqual(urls.redditOriginalUrl(url), "", url);
    });
  });

  test("Reddit's MP4 of a GIF is told from the GIF and its stills", () => {
    assert.ok(urls, "media URL helpers not loaded");
    [
      "https://preview.redd.it/anim.gif?format=mp4&s=x",
      "https://i.redd.it/anim.gif?format=mp4",
      "https://external-preview.redd.it/anim.gif?width=640&format=mp4&s=x",
    ].forEach((url) => {
      assert.strictEqual(urls.isRedditGifMp4(url), true, url);
    });
    [
      "https://i.redd.it/anim.gif",
      "https://preview.redd.it/anim.gif?format=png8&s=x",
      "https://preview.redd.it/clip.jpg?format=mp4",
      "https://v.redd.it/clip/DASH_480.mp4",
      "https://i.imgur.com/anim.gif?format=mp4",
      "https://i.imgur.com/anim.mp4",
      "not a url",
    ].forEach((url) => {
      assert.strictEqual(urls.isRedditGifMp4(url), false, url);
    });
  });

  test("a srcset's candidates carry their widths", () => {
    assert.ok(urls, "media URL helpers not loaded");
    assert.deepStrictEqual(
      urls.srcsetCandidates(
        "https://preview.redd.it/a.jpg?width=320&amp;s=1 320w,  https://preview.redd.it/a.jpg?width=640&s=2 640w,https://preview.redd.it/a.jpg 2x, https://preview.redd.it/b.jpg",
      ),
      [
        { url: "https://preview.redd.it/a.jpg?width=320&s=1", width: 320 },
        { url: "https://preview.redd.it/a.jpg?width=640&s=2", width: 640 },
        { url: "https://preview.redd.it/a.jpg", width: 0 },
        { url: "https://preview.redd.it/b.jpg", width: 0 },
      ],
    );
    ["", " , ", null, undefined].forEach((value) => {
      assert.deepStrictEqual(urls.srcsetCandidates(value), [], String(value));
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

function loadBackground(options = {}) {
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
      onConnect: { addListener: (listener) => (listeners.connect = listener) },
      lastError: undefined,
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
  if (options.connectNative) {
    fakeApi.runtime.connectNative = options.connectNative;
  }
  // With globalThis shadowed, globalThis.browser is undefined, so the script
  // takes the stand-in as chrome.
  new Function("chrome", "globalThis", source)(fakeApi, {});
  return { calls, listeners, runtime: fakeApi.runtime };
}

// A stand-in for a runtime port: what each side posted, and a way to fire
// the other side's events.
function fakePort(name) {
  const handlers = { message: [], disconnect: [] };
  const port = {
    name,
    posted: [],
    disconnected: false,
    onMessage: { addListener: (fn) => handlers.message.push(fn) },
    onDisconnect: { addListener: (fn) => handlers.disconnect.push(fn) },
    postMessage: (message) => port.posted.push(message),
    disconnect: () => {
      port.disconnected = true;
    },
    emit: (message) => handlers.message.forEach((fn) => fn(message)),
    drop: () => handlers.disconnect.forEach((fn) => fn()),
  };
  return port;
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

// The smaller copy of a post's preview picture that is `width` wide, its URL
// decoded.
const previewCopy = (post, width) =>
  post.preview.images[0].resolutions
    .find((copy) => copy.width === width)
    .url.replace(/&amp;/g, "&");

// What a grid tile shows of an item without a picture of its own.
const NO_GRID_PICTURE = { thumb: "", thumbVideo: "", width: 0, height: 0 };

// The one smaller copy that a record keeps of a list of Reddit's copies, as
// a one-item list: the narrowest at least 640 pixels wide, else the widest,
// its URL decoded. undefined for no copies.
function keptCopyOf(copies) {
  if (!Array.isArray(copies) || !copies.length) return undefined;
  const byWidth = [...copies].sort((a, b) => a.width - b.width);
  const copy =
    byWidth.find((candidate) => candidate.width >= 640) ||
    byWidth[byWidth.length - 1];
  return [
    {
      url: copy.url.replace(/&amp;/g, "&"),
      width: copy.width,
      height: copy.height,
    },
  ];
}

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
        const image = {
          source: {
            url: decodedPreview(post),
            width: post.preview.images[0].source.width,
            height: post.preview.images[0].source.height,
          },
        };
        // Of the smaller copies, only the one a grid tile loads.
        const still = keptCopyOf(post.preview.images[0].resolutions);
        if (still) image.resolutions = still;
        // A GIF's MP4 is kept too, with one of its smaller copies, and
        // nothing else of the variants.
        const mp4 = post.preview.images[0].variants?.mp4;
        if (mp4?.source?.url) {
          image.variants = {
            mp4: { source: { url: mp4.source.url.replace(/&amp;/g, "&") } },
          };
          const loop = keptCopyOf(mp4.resolutions);
          if (loop) image.variants.mp4.resolutions = loop;
        }
        const expected = { images: [image] };
        // Of Reddit's copy of a linked clip, only its file and size.
        const clip = post.preview.reddit_video_preview;
        if (clip) {
          expected.reddit_video_preview = {
            fallback_url: clip.fallback_url,
            width: clip.width,
            height: clip.height,
          };
        }
        assert.deepStrictEqual(record.preview, expected, post.id);
      } else {
        assert.strictEqual(record.preview, undefined, post.id);
      }
      // The largest, a crosspost, keeps a preview copy of its own and one
      // of its original's.
      const size = JSON.stringify(record).length;
      assert.ok(size < 1800, `${post.id}: ${size} characters`);
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

  test("a gallery keeps each item's largest size, and one smaller copy", () => {
    assert.ok(records, "archive record helpers not loaded");
    const post = archiveGalleryPost();
    Object.values(post.media_metadata).forEach((entry) => {
      entry.s.u += "&amp;s=x";
      entry.p = [108, 640, 960, 320].map((width) => ({
        u: `${entry.s.u.replace("1080", String(width))}&amp;p=1`,
        x: width,
        y: width,
      }));
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
      p: [
        {
          u: "https://preview.redd.it/galimg1.png?width=640&s=x&p=1",
          x: 640,
          y: 640,
        },
      ],
    });
    Object.values(record.media_metadata).forEach((entry) => {
      assert.deepStrictEqual(Object.keys(entry), [
        "status",
        "e",
        "m",
        "s",
        "p",
      ]);
    });
    assert.strictEqual(record.is_gallery, true);
    // With no copy 640 wide, the widest is kept, for an animation's still.
    const small = archiveGalleryPost();
    small.media_metadata.galimg1.p = [
      { u: "https://preview.redd.it/galimg1.png?width=108", x: 108, y: 108 },
      { u: "https://preview.redd.it/galimg1.png?width=320", x: 320, y: 320 },
    ];
    assert.deepStrictEqual(
      records.trimPost(small, "aww").media_metadata.galimg1.p,
      [{ u: "https://preview.redd.it/galimg1.png?width=320", x: 320, y: 320 }],
    );
    // An item without copies keeps none.
    assert.strictEqual(
      records.trimPost(small, "aww").media_metadata.galimg2.p,
      undefined,
    );
  });

  test("a preview keeps one smaller copy of its picture and of a GIF's MP4", () => {
    assert.ok(records, "archive record helpers not loaded");
    const copies = (base, widths) =>
      widths.map((width) => ({
        url: `${base}?width=${width}&amp;s=${width}`,
        width,
        height: width / 2,
      }));
    const record = records.trimPost(
      {
        id: "gif1",
        created_utc: 1600000000,
        url: "https://i.redd.it/anim.gif",
        preview: {
          images: [
            {
              source: {
                url: "https://preview.redd.it/anim.gif?format=png8&amp;s=a",
                width: 1200,
                height: 600,
              },
              resolutions: copies(
                "https://preview.redd.it/anim.gif",
                [108, 216, 320, 640, 960, 1080],
              ),
              variants: {
                gif: { source: { url: "https://preview.redd.it/anim.gif" } },
                mp4: {
                  source: {
                    url: "https://preview.redd.it/anim.gif?format=mp4&amp;s=b",
                  },
                  resolutions: copies(
                    "https://preview.redd.it/anim.gif",
                    [108, 216, 320],
                  ),
                },
              },
            },
          ],
        },
      },
      "gifs",
    );
    assert.deepStrictEqual(record.preview, {
      images: [
        {
          source: {
            url: "https://preview.redd.it/anim.gif?format=png8&s=a",
            width: 1200,
            height: 600,
          },
          resolutions: [
            {
              url: "https://preview.redd.it/anim.gif?width=640&s=640",
              width: 640,
              height: 320,
            },
          ],
          variants: {
            mp4: {
              source: {
                url: "https://preview.redd.it/anim.gif?format=mp4&s=b",
              },
              // No copy is 640 wide, so the widest.
              resolutions: [
                {
                  url: "https://preview.redd.it/anim.gif?width=320&s=320",
                  width: 320,
                  height: 160,
                },
              ],
            },
          },
        },
      ],
    });
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
    "embedStill",
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
  // An i.redd.it GIF with Reddit's preview of it: a still picture, the GIF
  // again, and an MP4, their URLs escaped as older records have them.
  const GIF_POSTER = "https://preview.redd.it/anim.gif?format=png8&s=a";
  const GIF_MP4 = "https://preview.redd.it/anim.gif?format=mp4&s=b";
  const gifPost = (fields) =>
    post({
      url: "https://i.redd.it/anim.GIF",
      domain: "i.redd.it",
      post_hint: "image",
      preview: {
        images: [
          {
            source: {
              url: GIF_POSTER.replace("&", "&amp;"),
              width: 400,
              height: 300,
            },
            variants: {
              gif: {
                source: { url: "https://preview.redd.it/anim.gif?s=g" },
              },
              mp4: {
                source: {
                  url: GIF_MP4.replace("&", "&amp;"),
                  width: 400,
                  height: 300,
                },
              },
            },
          },
        ],
      },
      ...fields,
    });
  // A crosspost of that GIF, without a preview of its own.
  const gifCrosspost = () =>
    post({
      id: "syn2",
      url: "https://i.redd.it/anim.GIF",
      crosspost_parent_list: [gifPost()],
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
    // A grid tile loads the preview's 640 pixel copy of the picture, or of
    // the video's poster, and a video's tile loops the video, which the
    // viewer trades for a smaller rendition.
    assert.deepStrictEqual(one(archiveFixture.kgl8vc), {
      kind: "image",
      url: "https://i.redd.it/y8nbh6y019661.jpg",
      poster: "",
      postMedia: true,
      fromGif: false,
      thumb: previewCopy(archiveFixture.kgl8vc, 640),
      thumbVideo: "",
      width: 2992,
      height: 2992,
    });
    assert.deepStrictEqual(one(archiveFixture.kgepby), {
      kind: "video",
      url: "https://v.redd.it/h57x3pgw57661/DASH_360.mp4?source=fallback",
      poster: decodedPreview(archiveFixture.kgepby),
      postMedia: true,
      fromGif: false,
      thumb: previewCopy(archiveFixture.kgepby, 640),
      thumbVideo:
        "https://v.redd.it/h57x3pgw57661/DASH_360.mp4?source=fallback",
      width: 640,
      height: 800,
    });
    const original = archiveFixture.kg84kl.crosspost_parent_list[0];
    assert.deepStrictEqual(one(archiveFixture.kg84kl), {
      kind: "video",
      url: "https://v.redd.it/clkrb6upg4661/DASH_240.mp4?source=fallback",
      poster: decodedPreview(original),
      postMedia: true,
      fromGif: false,
      thumb: previewCopy(original, 640),
      thumbVideo:
        "https://v.redd.it/clkrb6upg4661/DASH_240.mp4?source=fallback",
      width: 640,
      height: 360,
    });
  });

  test("a GIF plays as the MP4 that Reddit made of it, where there is one", () => {
    assert.ok(media, "archive media helpers not loaded");
    // Its tile loops that MP4, as the preview has no smaller one.
    const played = {
      kind: "video",
      url: GIF_MP4,
      poster: GIF_POSTER,
      postMedia: true,
      fromGif: true,
      thumb: "",
      thumbVideo: GIF_MP4,
      width: 400,
      height: 300,
    };
    assert.deepStrictEqual(one(gifPost()), played);
    assert.deepStrictEqual(
      one(gifPost({ url: "https://i.redd.it/anim.gif?width=640" })),
      played,
    );
    // A crosspost plays its original's.
    assert.deepStrictEqual(one(gifCrosspost()), played);
    // Without an MP4, the GIF itself shows, and nothing loops.
    const still = gifPost();
    delete still.preview.images[0].variants.mp4;
    assert.deepStrictEqual(one(still), {
      kind: "image",
      url: "https://i.redd.it/anim.GIF",
      poster: "",
      postMedia: true,
      fromGif: false,
      thumb: "",
      thumbVideo: "",
      width: 400,
      height: 300,
    });
    // Only a link to a GIF plays so.
    assert.deepStrictEqual(
      one(gifPost({ url: "https://i.redd.it/still.jpg" })),
      {
        kind: "image",
        url: "https://i.redd.it/still.jpg",
        poster: "",
        postMedia: true,
        fromGif: false,
        thumb: "",
        thumbVideo: "",
        width: 400,
        height: 300,
      },
    );
    // imgur's own MP4 still comes first for its GIFs.
    assert.strictEqual(
      one(gifPost({ url: "https://i.imgur.com/anim.gif" })).url,
      "https://i.imgur.com/anim.mp4",
    );
  });

  test("a stored GIF keeps its MP4, decoded, and nothing else of the variants", () => {
    assert.ok(records, "archive record helpers not loaded");
    assert.deepStrictEqual(records.trimPost(gifPost(), "pics").preview, {
      images: [
        {
          source: { url: GIF_POSTER, width: 400, height: 300 },
          variants: { mp4: { source: { url: GIF_MP4 } } },
        },
      ],
    });
    const crosspost = records.trimPost(gifCrosspost(), "pics");
    assert.strictEqual(crosspost.preview, undefined);
    assert.deepStrictEqual(
      crosspost.crosspost_parent_list[0].preview.images[0].variants,
      { mp4: { source: { url: GIF_MP4 } } },
    );
  });

  test("imgur GIFVs play as MP4s, and YouTube links as players", () => {
    assert.ok(media, "archive media helpers not loaded");
    // An imgur MP4 can weigh megabytes, so its tile loops Reddit's copy of
    // the clip on v.redd.it instead.
    assert.deepStrictEqual(one(archiveFixture.kgcs19), {
      kind: "video",
      url: "https://i.imgur.com/RCtmQG7.mp4",
      poster: decodedPreview(archiveFixture.kgcs19),
      postMedia: true,
      fromGif: true,
      thumb: previewCopy(archiveFixture.kgcs19, 640),
      thumbVideo: "https://v.redd.it/wrbm17kvo6661/DASH_480.mp4",
      width: 960,
      height: 538,
    });
    // Even where Reddit's preview has an MP4 of its own.
    assert.ok(archiveFixture.kgc3gb.preview.images[0].variants.mp4);
    assert.strictEqual(
      one(archiveFixture.kgc3gb).url,
      "https://i.imgur.com/oWjg3Wv.mp4",
    );
    assert.strictEqual(one(archiveFixture.kgc3gb).fromGif, true);
    assert.strictEqual(
      one(archiveFixture.kgc3gb).thumbVideo,
      "https://v.redd.it/v5eg5gm6j6661/DASH_360.mp4",
    );
    // Stored, the copy keeps its file and size, and still loops.
    assert.strictEqual(
      one(records.trimPost(archiveFixture.kgc3gb, "pics")).thumbVideo,
      "https://v.redd.it/v5eg5gm6j6661/DASH_360.mp4",
    );
    // Without a copy, the tile keeps to its still.
    const bareImgur = JSON.parse(JSON.stringify(archiveFixture.kgc3gb));
    delete bareImgur.preview.reddit_video_preview;
    assert.strictEqual(one(bareImgur).thumbVideo, "");
    // The grid loads no player, so a player's tile shows Reddit's preview of
    // it, which has no copy 640 pixels wide here.
    assert.deepStrictEqual(one(archiveFixture.kgifs8), {
      kind: "embed",
      url: "https://www.youtube.com/embed/zb_oMA-v_wI?enablejsapi=1",
      poster: decodedPreview(archiveFixture.kgifs8),
      postMedia: true,
      fromGif: false,
      thumb: "",
      thumbVideo: "",
      width: 480,
      height: 360,
    });
    assert.strictEqual(
      one(archiveFixture.kgjtiu).url,
      "https://www.youtube.com/embed/GXzLx-UjNNg?enablejsapi=1",
    );
    // Without a preview or an oEmbed still, a YouTube player's tile shows
    // YouTube's own still.
    const {
      preview: _preview,
      media: _media,
      secure_media: _secureMedia,
      ...bare
    } = archiveFixture.kgjtiu;
    assert.deepStrictEqual(one(bare), {
      kind: "embed",
      url: "https://www.youtube.com/embed/GXzLx-UjNNg?enablejsapi=1",
      poster: "https://i.ytimg.com/vi/GXzLx-UjNNg/hqdefault.jpg",
      postMedia: true,
      fromGif: false,
      ...NO_GRID_PICTURE,
    });
  });

  test("a player's tile shows the real frame, never the blurred copies", () => {
    assert.ok(media, "archive media helpers not loaded");
    const frame = (width) => ({
      url: `https://external-preview.redd.it/clip.jpg?width=${width}&amp;s=real`,
      width,
      height: width * 1.5,
    });
    const blurred = (width) => ({
      url: `https://external-preview.redd.it/clip.jpg?width=${width}&amp;blur=40&amp;s=blur`,
      width,
      height: width * 1.5,
    });
    const blurredImage = {
      source: blurred(720),
      resolutions: [blurred(320), blurred(640)],
    };
    const stored = records.trimPost(
      post({
        url: "https://www.redgifs.com/watch/someclip",
        over_18: true,
        preview: {
          images: [
            {
              source: frame(720),
              resolutions: [frame(320), frame(640)],
              variants: { obfuscated: blurredImage, nsfw: blurredImage },
            },
          ],
        },
      }),
      "pics",
    );
    assert.deepStrictEqual(one(stored), {
      kind: "embed",
      url: "https://www.redgifs.com/ifr/someclip",
      poster: "https://external-preview.redd.it/clip.jpg?width=720&s=real",
      postMedia: true,
      fromGif: false,
      thumb: "https://external-preview.redd.it/clip.jpg?width=640&s=real",
      thumbVideo: "",
      width: 720,
      height: 1080,
    });
  });

  test("a RedGIFs clip's tile loops Reddit's copy of it, stored as only its file and size", () => {
    assert.ok(media, "archive media helpers not loaded");
    // Reddit's copy of the clip, as its data names it.
    const copy = {
      bitrate_kbps: 5000,
      fallback_url: "https://v.redd.it/kyuaevw0lcsh1/CMAF_1080.mp4",
      has_audio: false,
      height: 1920,
      width: 1080,
      scrubber_media_url: "https://v.redd.it/kyuaevw0lcsh1/CMAF_96.mp4",
      dash_url: "https://v.redd.it/kyuaevw0lcsh1/DASHPlaylist.mpd",
      duration: 33,
      hls_url: "https://v.redd.it/kyuaevw0lcsh1/HLSPlaylist.m3u8",
      is_gif: true,
      transcoding_status: "completed",
    };
    const raw = post({
      url: "https://www.redgifs.com/watch/someclip",
      domain: "redgifs.com",
      preview: {
        images: [
          {
            source: {
              url: "https://external-preview.redd.it/clip.jpg?s=a",
              width: 1080,
              height: 1920,
            },
          },
        ],
        reddit_video_preview: copy,
        enabled: false,
      },
    });
    const stored = records.trimPost(raw, "pics");
    assert.deepStrictEqual(stored.preview.reddit_video_preview, {
      fallback_url: copy.fallback_url,
      width: 1080,
      height: 1920,
    });
    // The slideshow still loads the player, and the Show filter still
    // counts the clip as a video.
    assert.deepStrictEqual(one(stored), {
      kind: "embed",
      url: "https://www.redgifs.com/ifr/someclip",
      poster: "https://external-preview.redd.it/clip.jpg?s=a",
      postMedia: true,
      fromGif: false,
      thumb: "",
      thumbVideo: copy.fallback_url,
      width: 1080,
      height: 1920,
    });
    // A copy without a preview picture is kept all the same.
    const bare = JSON.parse(JSON.stringify(raw));
    delete bare.preview.images;
    const storedBare = records.trimPost(bare, "pics");
    assert.deepStrictEqual(Object.keys(storedBare.preview), [
      "reddit_video_preview",
    ]);
    assert.strictEqual(one(storedBare).thumbVideo, copy.fallback_url);
    // A crosspost loops its original's copy.
    const crosspost = records.trimPost(
      post({
        id: "syn3",
        url: "https://www.redgifs.com/watch/someclip",
        crosspost_parent_list: [raw],
      }),
      "pics",
    );
    assert.strictEqual(one(crosspost).thumbVideo, copy.fallback_url);
    // Only a copy on v.redd.it, over https, loops.
    [
      "http://v.redd.it/kyuaevw0lcsh1/CMAF_1080.mp4",
      "https://thumbs.example/someclip.mp4",
      "javascript:alert(1)",
      "",
    ].forEach((fallback) => {
      const other = JSON.parse(JSON.stringify(raw));
      other.preview.reddit_video_preview.fallback_url = fallback;
      assert.strictEqual(one(other).thumbVideo, "", fallback);
    });
    // A YouTube player's tile never loops.
    assert.strictEqual(one(archiveFixture.kgifs8).thumbVideo, "");
    assert.strictEqual(
      one(records.trimPost(archiveFixture.kgifs8, "pics")).thumbVideo,
      "",
    );
  });

  test("a player without a preview shows its oEmbed still, the one part of the oEmbed kept", () => {
    assert.ok(media, "archive media helpers not loaded");
    const poster = "https://media.redgifs.com/SomeClip-poster.jpg";
    const oembed = {
      type: "video",
      provider_name: "RedGIFs",
      thumbnail_url: poster,
      thumbnail_width: 1080,
      thumbnail_height: 1920,
      html: '<iframe src="https://www.redgifs.com/ifr/someclip"></iframe>',
    };
    const raw = post({
      url: "https://www.redgifs.com/watch/someclip",
      media: { type: "redgifs.com", oembed },
      secure_media: { type: "redgifs.com", oembed },
    });
    const stored = records.trimPost(raw, "pics");
    assert.deepStrictEqual(stored.media, {
      oembed: { thumbnail_url: poster },
    });
    assert.deepStrictEqual(one(stored), {
      kind: "embed",
      url: "https://www.redgifs.com/ifr/someclip",
      poster,
      postMedia: true,
      fromGif: false,
      ...NO_GRID_PICTURE,
    });
    // With a preview, the preview decides, and nothing of the oEmbed stays.
    const previewed = records.trimPost(
      {
        ...raw,
        preview: {
          images: [
            {
              source: {
                url: "https://external-preview.redd.it/clip.jpg?s=a",
                width: 480,
                height: 854,
              },
            },
          ],
        },
      },
      "pics",
    );
    assert.strictEqual(previewed.media, null);
    assert.strictEqual(
      one(previewed).poster,
      "https://external-preview.redd.it/clip.jpg?s=a",
    );
  });

  test("an imgur link to a video file plays as a video", () => {
    assert.ok(media, "archive media helpers not loaded");
    const item = one(
      post({
        url: "https://i.imgur.com/clip1.mp4",
        preview: {
          images: [
            {
              source: {
                url: "https://external-preview.redd.it/clip1.jpg?s=a",
                width: 640,
                height: 360,
              },
            },
          ],
        },
      }),
    );
    assert.strictEqual(item.kind, "video");
    assert.strictEqual(item.url, "https://i.imgur.com/clip1.mp4");
    assert.strictEqual(
      item.poster,
      "https://external-preview.redd.it/clip1.jpg?s=a",
    );
    assert.strictEqual(item.fromGif, false);
  });

  test("a link shows its preview picture, which is not the post's own media", () => {
    assert.ok(media, "archive media helpers not loaded");
    assert.deepStrictEqual(one(archiveFixture.kgkkid), {
      kind: "image",
      url: decodedPreview(archiveFixture.kgkkid),
      poster: "",
      postMedia: false,
      fromGif: false,
      thumb: previewCopy(archiveFixture.kgkkid, 640),
      thumbVideo: "",
      width: 1600,
      height: 900,
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
      ...NO_GRID_PICTURE,
    });
    assert.deepStrictEqual(one(archiveFixture.kgfnzg), {
      kind: "link",
      url: archiveFixture.kgfnzg.url,
      poster: "",
      postMedia: false,
      fromGif: false,
      ...NO_GRID_PICTURE,
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
        ...NO_GRID_PICTURE,
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
      ...NO_GRID_PICTURE,
    });
  });

  // Reddit's smaller copies: stills for pictures and posters, and MP4s for
  // a GIF, each from 108 pixels wide up to `widest`, their URLs escaped as
  // older records have them.
  const copiesOf = (base, widest, query = "") =>
    [108, 216, 320, 640, 960, 1080]
      .filter((width) => width <= widest)
      .map((width) => ({
        url: `${base}?width=${width}${query}&amp;s=${width}`,
        width,
        height: Math.round(width * 0.75),
      }));
  const copyUrl = (base, width, query = "") =>
    `${base}?width=${width}${query}&s=${width}`;
  // A GIF with Reddit's stills of it, its MP4 and the MP4's smaller copies.
  const LOOP_BASE = "https://preview.redd.it/loop.gif";
  const loopPost = (stillWidest, mp4Widest, fields) =>
    post({
      id: "loop1",
      url: "https://i.redd.it/loop.gif",
      preview: {
        images: [
          {
            source: {
              url: `${LOOP_BASE}?format=png8&amp;s=still`,
              width: 1200,
              height: 900,
            },
            resolutions: copiesOf(LOOP_BASE, stillWidest, "&amp;format=png8"),
            variants: {
              mp4: {
                source: { url: `${LOOP_BASE}?format=mp4&amp;s=motion` },
                resolutions: copiesOf(LOOP_BASE, mp4Widest, "&amp;format=mp4"),
              },
            },
          },
        ],
      },
      ...fields,
    });
  // A gallery of one item per metadata entry, in order.
  const galleryPost = (metadata) =>
    post({
      id: "gal2",
      is_gallery: true,
      gallery_data: {
        items: Object.keys(metadata).map((id) => ({ media_id: id })),
      },
      media_metadata: metadata,
    });
  const galleryCopies = (id, extension, widest, query = "") =>
    copiesOf(`https://preview.redd.it/${id}.${extension}`, widest, query).map(
      (copy) => ({ u: copy.url, x: copy.width, y: copy.height }),
    );

  test("a GIF's tile shows a still and loops the smallest MP4 wide enough", () => {
    assert.ok(media, "archive media helpers not loaded");
    const played = one(loopPost(1080, 1080));
    assert.deepStrictEqual(played, {
      kind: "video",
      url: `${LOOP_BASE}?format=mp4&s=motion`,
      poster: `${LOOP_BASE}?format=png8&s=still`,
      postMedia: true,
      fromGif: true,
      thumb: copyUrl(LOOP_BASE, 640, "&format=png8"),
      thumbVideo: copyUrl(LOOP_BASE, 640, "&format=mp4"),
      width: 1200,
      height: 900,
    });
    // With no copy 640 wide, the widest; a GIF weighs more than any copy.
    const small = one(loopPost(320, 216));
    assert.strictEqual(small.thumb, copyUrl(LOOP_BASE, 320, "&format=png8"));
    assert.strictEqual(
      small.thumbVideo,
      copyUrl(LOOP_BASE, 216, "&format=mp4"),
    );
    // Without smaller MP4s, the MP4 itself loops.
    assert.strictEqual(
      one(loopPost(1080, 0)).thumbVideo,
      `${LOOP_BASE}?format=mp4&s=motion`,
    );
    // A crosspost shows its original's.
    const crosspost = post({
      id: "loop2",
      url: "https://i.redd.it/loop.gif",
      crosspost_parent_list: [loopPost(1080, 1080)],
    });
    assert.deepStrictEqual(one(crosspost), played);
    // A GIF without an MP4 shows as a still, and loops nothing.
    const gifOnly = loopPost(1080, 1080);
    delete gifOnly.preview.images[0].variants;
    assert.deepStrictEqual(one(gifOnly), {
      kind: "image",
      url: "https://i.redd.it/loop.gif",
      poster: "",
      postMedia: true,
      fromGif: false,
      thumb: copyUrl(LOOP_BASE, 640, "&format=png8"),
      thumbVideo: "",
      width: 1200,
      height: 900,
    });
  });

  test("a copy of a GIF that is itself a GIF is no still", () => {
    assert.ok(media, "archive media helpers not loaded");
    const animated = loopPost(1080, 1080);
    animated.preview.images[0].resolutions = copiesOf(LOOP_BASE, 1080);
    assert.strictEqual(one(animated).thumb, "");
    assert.strictEqual(
      one(animated).thumbVideo,
      copyUrl(LOOP_BASE, 640, "&format=mp4"),
    );
  });

  test("a picture with no copy 640 wide shows itself in the grid", () => {
    assert.ok(media, "archive media helpers not loaded");
    // kg4tn5's preview stops at 320 pixels.
    assert.deepStrictEqual(one(archiveFixture.kg4tn5), {
      kind: "image",
      url: "https://i.redd.it/hn1k1c6i44661.jpg",
      poster: "",
      postMedia: true,
      fromGif: false,
      thumb: "",
      thumbVideo: "",
      width: 634,
      height: 530,
    });
    // And so does kgj40u's original, whose copy is exactly 640 wide.
    assert.strictEqual(
      one(archiveFixture.kgj40u).thumb,
      previewCopy(archiveFixture.kgj40u, 640),
    );
  });

  test("a record stored before copies were kept shows its original, in shape", () => {
    assert.ok(media, "archive media helpers not loaded");
    const record = records.trimPost(archiveFixture.kgl8vc, "pics");
    delete record.preview.images[0].resolutions;
    const [slide] = media.postSlides(record, urls).slides;
    assert.strictEqual(slide.url, "https://i.redd.it/y8nbh6y019661.jpg");
    assert.strictEqual(slide.thumb, "");
    assert.strictEqual(slide.thumbVideo, "");
    assert.strictEqual(slide.width, 2992);
    assert.strictEqual(slide.height, 2992);
    const gif = records.trimPost(loopPost(1080, 1080), "gifs");
    delete gif.preview.images[0].resolutions;
    delete gif.preview.images[0].variants.mp4.resolutions;
    const [loop] = media.postSlides(gif, urls).slides;
    assert.strictEqual(loop.thumb, "");
    assert.strictEqual(loop.thumbVideo, `${LOOP_BASE}?format=mp4&s=motion`);
  });

  test("an external picture's tile shows Reddit's copy of it", () => {
    assert.ok(media, "archive media helpers not loaded");
    const imgur = post({
      url: "https://imgur.com/pic1",
      preview: {
        images: [
          {
            source: {
              url: "https://external-preview.redd.it/pic1.jpg?s=a",
              width: 2000,
              height: 1000,
            },
            resolutions: copiesOf(
              "https://external-preview.redd.it/pic1.jpg",
              1080,
            ),
          },
        ],
      },
    });
    assert.deepStrictEqual(one(imgur), {
      kind: "image",
      url: "https://i.imgur.com/pic1.jpg",
      poster: "",
      postMedia: true,
      fromGif: false,
      thumb: copyUrl("https://external-preview.redd.it/pic1.jpg", 640),
      thumbVideo: "",
      width: 2000,
      height: 1000,
    });
  });

  test("a gallery's JPEGs and WebPs load from i.redd.it, and its PNGs from their transcode", () => {
    assert.ok(media, "archive media helpers not loaded");
    const size = (id, extension) => ({
      u: `https://preview.redd.it/${id}.${extension}?width=3000&amp;format=pjpg&amp;auto=webp&amp;s=${id}`,
      x: 3000,
      y: 2000,
    });
    const items = media.mediaFromPost(
      galleryPost({
        jpg1: {
          status: "valid",
          e: "Image",
          m: "image/jpg",
          s: size("jpg1", "jpg"),
          p: galleryCopies("jpg1", "jpg", 1080),
        },
        jpeg2: {
          status: "valid",
          e: "Image",
          m: "image/jpeg",
          s: size("jpeg2", "jpeg"),
        },
        webp3: {
          status: "valid",
          e: "Image",
          m: "image/WEBP",
          s: size("webp3", "webp"),
        },
        png4: {
          status: "valid",
          e: "Image",
          m: "image/png",
          s: size("png4", "png"),
          p: galleryCopies("png4", "png", 320),
        },
        bare5: { status: "valid", e: "Image", s: size("bare5", "jpg") },
      }),
      urls,
    );
    assert.deepStrictEqual(
      items.map((item) => [item.url, item.formerUrl, item.thumb]),
      [
        [
          "https://i.redd.it/jpg1.jpg",
          "https://preview.redd.it/jpg1.jpg?width=3000&format=pjpg&auto=webp&s=jpg1",
          copyUrl("https://preview.redd.it/jpg1.jpg", 640),
        ],
        [
          "https://i.redd.it/jpeg2.jpeg",
          "https://preview.redd.it/jpeg2.jpeg?width=3000&format=pjpg&auto=webp&s=jpeg2",
          "",
        ],
        [
          "https://i.redd.it/webp3.webp",
          "https://preview.redd.it/webp3.webp?width=3000&format=pjpg&auto=webp&s=webp3",
          "",
        ],
        // A PNG's original can weigh many times its transcode; a picture
        // with no copy 640 wide shows itself.
        [
          "https://preview.redd.it/png4.png?width=3000&format=pjpg&auto=webp&s=png4",
          undefined,
          "",
        ],
        // Without a type, the transcode.
        [
          "https://preview.redd.it/bare5.jpg?width=3000&format=pjpg&auto=webp&s=bare5",
          undefined,
          "",
        ],
      ],
    );
    items.forEach((item) => {
      assert.strictEqual(item.width, 3000, item.url);
      assert.strictEqual(item.height, 2000, item.url);
      assert.strictEqual(item.thumbVideo, "", item.url);
    });
    // A media id that is not a plain id keeps the transcode.
    const odd = media.mediaFromPost(
      galleryPost({
        "a/b": {
          status: "valid",
          e: "Image",
          m: "image/jpg",
          s: size("ab", "jpg"),
        },
      }),
      urls,
    );
    assert.strictEqual(
      odd[0].url,
      "https://preview.redd.it/ab.jpg?width=3000&format=pjpg&auto=webp&s=ab",
    );
  });

  test("a gallery's animations loop their MP4 over a still", () => {
    assert.ok(media, "archive media helpers not loaded");
    const items = media.mediaFromPost(
      galleryPost({
        anim1: {
          status: "valid",
          e: "AnimatedImage",
          m: "image/gif",
          s: {
            gif: "https://i.redd.it/anim1.gif",
            mp4: "https://preview.redd.it/anim1.gif?format=mp4&amp;s=m",
            x: 500,
            y: 400,
          },
          p: galleryCopies("anim1", "gif", 320, "&amp;format=png8"),
        },
        anim2: {
          status: "valid",
          e: "AnimatedImage",
          m: "image/gif",
          s: { gif: "https://i.redd.it/anim2.gif", x: 800, y: 600 },
          p: galleryCopies("anim2", "gif", 1080, "&amp;format=png8"),
        },
        // A copy without a still format is the GIF again.
        anim3: {
          status: "valid",
          e: "AnimatedImage",
          m: "image/gif",
          s: { gif: "https://i.redd.it/anim3.gif", x: 800, y: 600 },
          p: galleryCopies("anim3", "gif", 1080),
        },
      }),
      urls,
    );
    assert.deepStrictEqual(
      items.map((item) => [
        item.kind,
        item.url,
        item.thumb,
        item.thumbVideo,
        item.width,
        item.height,
      ]),
      [
        [
          "video",
          "https://preview.redd.it/anim1.gif?format=mp4&s=m",
          copyUrl("https://preview.redd.it/anim1.gif", 320, "&format=png8"),
          "https://preview.redd.it/anim1.gif?format=mp4&s=m",
          500,
          400,
        ],
        [
          "image",
          "https://i.redd.it/anim2.gif",
          copyUrl("https://preview.redd.it/anim2.gif", 640, "&format=png8"),
          "",
          800,
          600,
        ],
        ["image", "https://i.redd.it/anim3.gif", "", "", 800, 600],
      ],
    );
  });

  test("trimming never changes the slides", () => {
    assert.ok(media, "archive media helpers not loaded");
    const jpegGallery = archiveGalleryPost();
    Object.entries(jpegGallery.media_metadata).forEach(([id, entry]) => {
      entry.m = "image/jpg";
      entry.p = galleryCopies(id, "png", 1080);
    });
    // A player frame without a preview, which shows its oEmbed's still.
    const oembed = {
      thumbnail_url: "https://media.redgifs.com/SomeClip-poster.jpg",
      html: "<iframe></iframe>",
    };
    const bareFrame = post({
      id: "frame1",
      url: "https://www.redgifs.com/watch/someclip",
      secure_media: { type: "redgifs.com", oembed },
    });
    [
      ...archiveFixturePosts,
      archiveGalleryPost(),
      jpegGallery,
      gifPost(),
      gifCrosspost(),
      loopPost(1080, 1080),
      loopPost(320, 216),
      bareFrame,
    ].forEach((raw) => {
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

  test("a gallery JPEG recorded dead under either of its URLs stays skipped", () => {
    assert.ok(media, "archive media helpers not loaded");
    const gallery = archiveGalleryPost();
    Object.entries(gallery.media_metadata).forEach(([id, entry]) => {
      entry.m = "image/jpg";
      entry.s.u = `https://preview.redd.it/${id}.jpg?width=1080&format=pjpg&s=x`;
    });
    const record = records.trimPost(gallery, "aww");
    assert.deepStrictEqual(
      media.postSlides(record, urls).slides.map((slide) => slide.url),
      [1, 2, 3].map((number) => `https://i.redd.it/galimg${number}.jpg`),
    );
    // Before 2026-09, a dead item was recorded under its transcode's key;
    // now it is recorded under its i.redd.it key.
    const dead = new Set([
      urls.canonicalMediaKey(
        "https://preview.redd.it/galimg1.jpg?width=1080&format=pjpg&s=x",
      ),
      urls.canonicalMediaKey("https://i.redd.it/galimg3.jpg"),
    ]);
    const { slides, unavailable } = media.postSlides(record, urls, dead);
    assert.strictEqual(unavailable, 2);
    assert.deepStrictEqual(
      slides.map((slide) => [slide.url, slide.galleryItem]),
      [["https://i.redd.it/galimg2.jpg", 2]],
    );
    // The slide does not carry the former URL.
    assert.strictEqual(slides[0].formerUrl, undefined);
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
    // What its grid tile shows.
    assert.strictEqual(slide.thumb, previewCopy(archiveFixture.kgl8vc, 640));
    assert.strictEqual(slide.thumbVideo, "");
    assert.strictEqual(slide.width, 2992);
    assert.strictEqual(slide.height, 2992);
    assert.deepStrictEqual(slide.archive, {
      id: "kgl8vc",
      created: archiveFixture.kgl8vc.created_utc,
      score: archiveFixture.kgl8vc.score,
      over18: false,
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
// Save to gallery (browser-extension/content.js, background.js)
// ---------------------------------------------------------------------------

suite("browser-extension save to gallery", () => {
  const save = loadContentScriptBlock(
    ["redditp-media-urls", "redditp-media-save"],
    [
      "SAVE_HOSTS",
      "SAVE_MESSAGES",
      "saveDest",
      "savePostId",
      "saveMediaUrl",
      "saveFactsFromAttributes",
      "buildSaveRequest",
      "saveOutcome",
      "createSaveTracker",
      "saveIconState",
      "sendSaveRequest",
    ],
  );

  function slide(overrides) {
    return {
      kind: "image",
      url: "https://i.redd.it/abc123.jpg",
      title: "A cat",
      author: "u/someone",
      community: "r/aww",
      commentsUrl: "https://www.reddit.com/r/aww/comments/1abc2d/a_cat/",
      sourceUrl: "https://i.redd.it/abc123.jpg",
      postKey: "t3_1abc2d",
      fromGif: false,
      galleryItem: 0,
      galleryTotal: 0,
      ...overrides,
    };
  }

  test("save helpers could be loaded", () => {
    assert.ok(
      save,
      "did not find the redditp-media-save markers in content.js",
    );
  });

  test("an i.redd.it picture saves as itself with every metadata key", () => {
    assert.ok(save, "save helpers not loaded");
    const built = save.buildSaveRequest(slide(), {
      score: 12,
      createdUtc: 1700000000,
      over18: false,
    });
    assert.strictEqual(built.ok, true);
    assert.strictEqual(built.itemId, "1abc2d");
    assert.deepStrictEqual(built.request, {
      op: "sync",
      dest: "aww",
      items: [
        {
          id: "1abc2d",
          url: "https://i.redd.it/abc123.jpg",
          metadata: {
            source: "reddit",
            postId: "1abc2d",
            subreddit: "aww",
            title: "A cat",
            author: "someone",
            permalink: "https://www.reddit.com/r/aww/comments/1abc2d/a_cat/",
            postUrl: "https://i.redd.it/abc123.jpg",
            createdUtc: 1700000000,
            score: 12,
            over18: false,
            mediaType: "image",
            galleryIndex: null,
            galleryCount: null,
            fileName: "abc123.jpg",
          },
        },
      ],
    });
  });

  test("unknown facts are null and every key is still present", () => {
    assert.ok(save, "save helpers not loaded");
    const built = save.buildSaveRequest(slide({ author: "", sourceUrl: "" }));
    const metadata = built.request.items[0].metadata;
    assert.strictEqual(Object.keys(metadata).length, 14);
    assert.strictEqual(metadata.author, null);
    assert.strictEqual(metadata.postUrl, null);
    assert.strictEqual(metadata.createdUtc, null);
    assert.strictEqual(metadata.score, null);
    assert.strictEqual(metadata.over18, null);
  });

  test("an archive slide's own score, date and rating win", () => {
    assert.ok(save, "save helpers not loaded");
    const built = save.buildSaveRequest(
      slide({
        postKey: "",
        commentsUrl: "",
        archive: { id: "9xyz", created: 1600000000, score: 5, over18: true },
      }),
      { score: 99, createdUtc: 1, over18: false },
    );
    const metadata = built.request.items[0].metadata;
    assert.strictEqual(built.itemId, "9xyz");
    assert.strictEqual(metadata.createdUtc, 1600000000);
    assert.strictEqual(metadata.score, 5);
    assert.strictEqual(metadata.over18, true);
    // No comments address to carry: the permalink is built.
    assert.strictEqual(
      metadata.permalink,
      "https://www.reddit.com/r/aww/comments/9xyz/",
    );
  });

  test("a gallery post saves the media shown, with a numbered id", () => {
    assert.ok(save, "save helpers not loaded");
    const built = save.buildSaveRequest(
      slide({ galleryItem: 2, galleryTotal: 3 }),
    );
    assert.strictEqual(built.itemId, "1abc2d_2");
    const item = built.request.items[0];
    assert.strictEqual(item.id, "1abc2d_2");
    assert.strictEqual(item.metadata.postId, "1abc2d");
    assert.strictEqual(item.metadata.galleryIndex, 2);
    assert.strictEqual(item.metadata.galleryCount, 3);
  });

  test("&amp; in a preview.redd.it URL is decoded", () => {
    assert.ok(save, "save helpers not loaded");
    // A video keeps the preview host and its query.
    assert.strictEqual(
      save.saveMediaUrl(
        slide({
          kind: "video",
          url: "https://preview.redd.it/abc123.gif?format=mp4&amp;s=sig",
          fromGif: true,
        }),
      ),
      "https://preview.redd.it/abc123.gif?format=mp4&s=sig",
    );
    assert.strictEqual(
      save.saveMediaUrl(
        slide({
          url: "https://external-preview.redd.it/x.jpg?width=640&amp;s=sig",
        }),
      ),
      "https://external-preview.redd.it/x.jpg?width=640&s=sig",
    );
  });

  test("a picture on preview.redd.it saves from the upload on i.redd.it", () => {
    assert.ok(save, "save helpers not loaded");
    assert.strictEqual(
      save.saveMediaUrl(
        slide({
          url: "https://preview.redd.it/a-cat-v0-abc123.jpg?width=640&amp;format=pjpg&amp;s=sig",
        }),
      ),
      "https://i.redd.it/abc123.jpg",
    );
  });

  test("v.redd.it saves the fallback MP4, never a playlist", () => {
    assert.ok(save, "save helpers not loaded");
    assert.strictEqual(
      save.saveMediaUrl(
        slide({
          kind: "video",
          url: "https://v.redd.it/vid1/DASH_720.mp4?source=fallback",
        }),
      ),
      "https://v.redd.it/vid1/DASH_720.mp4?source=fallback",
    );
    assert.strictEqual(
      save.saveMediaUrl(
        slide({
          kind: "video",
          url: "https://v.redd.it/vid1/HLSPlaylist.m3u8",
        }),
      ),
      "",
    );
    const built = save.buildSaveRequest(
      slide({
        kind: "video",
        url: "https://v.redd.it/vid1/DASH_720.mp4?source=fallback",
      }),
    );
    assert.strictEqual(built.request.items[0].metadata.mediaType, "video");
    assert.strictEqual(
      built.request.items[0].metadata.fileName,
      "DASH_720.mp4",
    );
  });

  test("a GIF is typed gif, whether a .gif picture or a converted video", () => {
    assert.ok(save, "save helpers not loaded");
    const picture = save.buildSaveRequest(
      slide({ url: "https://i.redd.it/loop1.gif" }),
    );
    assert.strictEqual(picture.request.items[0].metadata.mediaType, "gif");
    const video = save.buildSaveRequest(
      slide({
        kind: "video",
        url: "https://i.imgur.com/loop2.mp4",
        fromGif: true,
      }),
    );
    assert.strictEqual(video.request.items[0].metadata.mediaType, "gif");
  });

  test("hosts off the list, embeds, links and plain http are not savable", () => {
    assert.ok(save, "save helpers not loaded");
    [
      slide({ url: "https://example.com/a.jpg" }),
      slide({ url: "https://i.redd.it.example.com/a.jpg" }),
      slide({ url: "http://i.redd.it/a.jpg" }),
      slide({ url: "not a url" }),
      slide({ url: "" }),
      slide({ kind: "embed", url: "https://www.youtube.com/embed/abc" }),
      slide({ kind: "link", url: "https://i.redd.it/a.jpg" }),
      slide({ kind: "native-video", url: "https://i.redd.it/a.jpg" }),
    ].forEach((candidate) => {
      assert.deepStrictEqual(
        save.buildSaveRequest(candidate),
        { ok: false, reason: "unsavable" },
        candidate.url + candidate.kind,
      );
    });
    save.SAVE_HOSTS.forEach((host) => {
      const url = host === "v.redd.it" ? "/v/DASH_1.mp4" : "/a.jpg";
      assert.ok(
        save.saveMediaUrl(slide({ url: `https://${host}${url}` })),
        host,
      );
    });
  });

  test("a subreddit name the helper would refuse is not sent", () => {
    assert.ok(save, "save helpers not loaded");
    [
      "r/bad name",
      "r/a/b",
      "r/..",
      `r/${"a".repeat(65)}`,
      "r/pics.new",
    ].forEach((community) => {
      assert.deepStrictEqual(
        save.buildSaveRequest(slide({ community, commentsUrl: "" })),
        { ok: false, reason: "no-post" },
        community,
      );
    });
    assert.strictEqual(save.saveDest(slide({ community: "r/pics" })), "pics");
    assert.strictEqual(save.saveDest(slide({ community: "pics" })), "pics");
    assert.strictEqual(
      save.saveDest(slide({ community: "u/someone" })),
      "u_someone",
    );
    assert.strictEqual(
      save.saveDest(
        slide({
          community: "",
          commentsUrl: "https://www.reddit.com/r/aww/comments/1abc2d/x/",
        }),
      ),
      "aww",
    );
  });

  test("a post id that does not read as one is not sent", () => {
    assert.ok(save, "save helpers not loaded");
    assert.deepStrictEqual(
      save.buildSaveRequest(slide({ postKey: "", commentsUrl: "" })),
      { ok: false, reason: "no-post" },
    );
    assert.strictEqual(
      save.savePostId(slide({ postKey: "thing_t3_9abc" })),
      "9abc",
    );
    assert.strictEqual(
      save.savePostId(slide({ postKey: "t3_../x" })),
      "1abc2d",
    );
    assert.strictEqual(
      save.savePostId(
        slide({
          postKey: "",
          commentsUrl: "https://old.reddit.com/r/aww/comments/zz9/x/",
        }),
      ),
      "zz9",
    );
  });

  test("a post element's attributes give the score, date and rating", () => {
    assert.ok(save, "save helpers not loaded");
    const from = (attributes) =>
      save.saveFactsFromAttributes((name) =>
        name in attributes ? attributes[name] : null,
      );
    assert.deepStrictEqual(
      from({
        score: "41",
        "created-timestamp": "2023-11-14T22:13:20.000+0000",
        nsfw: "",
      }),
      { score: 41, createdUtc: 1700000000, over18: true },
    );
    assert.deepStrictEqual(
      from({
        "data-score": "7",
        "data-timestamp": "1700000000000",
        "data-nsfw": "false",
      }),
      { score: 7, createdUtc: 1700000000, over18: false },
    );
    assert.deepStrictEqual(from({}), {
      score: null,
      createdUtc: null,
      over18: null,
    });
    assert.strictEqual(from({ nsfw: "false" }).over18, false);
  });

  test("helper replies map to short messages", () => {
    assert.ok(save, "save helpers not loaded");
    const text = (message, id) => save.saveOutcome(message, id)?.text;
    assert.strictEqual(
      text({ type: "progress", id: "a", status: "ok" }),
      "Saved",
    );
    assert.strictEqual(
      text({ type: "progress", id: "a", status: "skipped" }),
      "Already saved",
    );
    assert.strictEqual(
      text({ type: "done", ok: 1, skipped: 0, failed: 0 }),
      "Saved",
    );
    assert.strictEqual(
      text({ type: "done", ok: 0, skipped: 1, failed: 0 }),
      "Already saved",
    );
    assert.strictEqual(
      text({ type: "progress", id: "a", status: "failed", error: "http 404" }),
      "Save failed: http 404",
    );
    assert.strictEqual(
      text({ type: "done", ok: 0, skipped: 0, failed: 1 }),
      "Save failed: the helper saved nothing",
    );
    assert.strictEqual(
      text({ type: "error", code: "bad", message: "vault not mounted" }),
      "Mount the vault (V:) first",
    );
    assert.strictEqual(
      text({
        type: "progress",
        id: "a",
        status: "failed",
        error: "Vault not mounted: V:",
      }),
      "Mount the vault (V:) first",
    );
    ["host_missing", "host_forbidden"].forEach((code) => {
      assert.strictEqual(
        text({ type: "error", code, message: "x" }),
        "Helper not installed — run install.ps1 in civitai-collector",
      );
    });
    assert.strictEqual(
      text({ type: "error", code: "unavailable" }),
      "Saving to the gallery isn't available in this browser",
    );
    assert.strictEqual(
      text({ type: "error", code: "host_crashed", message: "helper exited" }),
      "Save failed: helper exited",
    );
    const long = text({ type: "error", code: "x", message: "w ".repeat(100) });
    assert.ok(long.length <= "Save failed: ".length + 80, long);
    // Messages that settle nothing.
    assert.strictEqual(
      save.saveOutcome({ type: "progress", id: "b", status: "ok" }, "a"),
      null,
    );
    assert.strictEqual(save.saveOutcome({ type: "hello" }), null);
    assert.strictEqual(save.saveOutcome(null), null);
    assert.strictEqual(save.saveOutcome("ok"), null);
  });

  test("a second press while a save is out sends nothing", () => {
    assert.ok(save, "save helpers not loaded");
    const tracker = save.createSaveTracker();
    assert.strictEqual(tracker.begin("a"), "go");
    assert.strictEqual(tracker.begin("a"), "pending");
    assert.strictEqual(tracker.isPending("a"), true);
    assert.strictEqual(tracker.begin("b"), "go");
    tracker.end("a", "saved");
    assert.strictEqual(tracker.isSaved("a"), true);
    assert.strictEqual(tracker.begin("a"), "saved");
    // A failure frees the item to be tried again.
    tracker.end("b", "failed");
    assert.strictEqual(tracker.isSaved("b"), false);
    assert.strictEqual(tracker.begin("b"), "go");
    tracker.end("b", "already");
    assert.strictEqual(tracker.begin("b"), "saved");
  });

  test("the hover icon follows the tracker and hides what cannot be saved", () => {
    assert.ok(save, "save helpers not loaded");
    const tracker = save.createSaveTracker();
    const built = save.buildSaveRequest(slide());
    assert.strictEqual(save.saveIconState(built, tracker, true), "idle");
    assert.strictEqual(save.saveIconState(built, tracker, false), "hidden");
    tracker.begin(built.itemId);
    assert.strictEqual(save.saveIconState(built, tracker, true), "pending");
    tracker.end(built.itemId, "failed");
    assert.strictEqual(save.saveIconState(built, tracker, true), "idle");
    tracker.begin(built.itemId);
    tracker.end(built.itemId, "saved");
    assert.strictEqual(save.saveIconState(built, tracker, true), "saved");
    const unsavable = save.buildSaveRequest(
      slide({ url: "https://example.com/x.html", sourceUrl: "" }),
    );
    assert.strictEqual(unsavable.ok, false);
    assert.strictEqual(save.saveIconState(unsavable, tracker, true), "hidden");
    assert.strictEqual(save.saveIconState(null, tracker, true), "hidden");
  });

  test("the request goes out on one media-sync port and settles on the first outcome", async () => {
    assert.ok(save, "save helpers not loaded");
    const port = fakePort("media-sync");
    const opened = [];
    const runtime = {
      connect: (info) => {
        opened.push(info);
        return port;
      },
    };
    const request = { op: "sync", dest: "aww", items: [] };
    const pending = save.sendSaveRequest(runtime, request, "a");
    assert.deepStrictEqual(opened, [{ name: "media-sync" }]);
    assert.deepStrictEqual(port.posted, [request]);
    port.emit({ type: "progress", id: "a", status: "ok" });
    port.emit({ type: "done", ok: 1, skipped: 0, failed: 0 });
    port.drop();
    assert.deepStrictEqual(await pending, { status: "saved", text: "Saved" });
    assert.strictEqual(port.disconnected, true);
  });

  test("a port that drops or a runtime that throws is a failed save, not an exception", async () => {
    assert.ok(save, "save helpers not loaded");
    const port = fakePort("media-sync");
    const dropped = save.sendSaveRequest({ connect: () => port }, {}, "a");
    port.drop();
    assert.strictEqual((await dropped).status, "failed");
    const thrown = await save.sendSaveRequest(
      {
        connect: () => {
          throw new Error("Extension context invalidated.");
        },
      },
      {},
      "a",
    );
    assert.strictEqual(thrown.status, "failed");
    const quiet = fakePort("media-sync");
    const timedOut = await save.sendSaveRequest(
      { connect: () => quiet },
      {},
      "a",
      5,
    );
    assert.strictEqual(timedOut.text, "Save failed: no reply");
    assert.strictEqual(quiet.disconnected, true);
  });
});

suite("browser-extension save relay", () => {
  function fakeNative() {
    const native = fakePort("native");
    return native;
  }

  test("a media-sync port is relayed to the helper and its replies come back", () => {
    const native = fakeNative();
    const asked = [];
    const { listeners } = loadBackground({
      connectNative: (name) => {
        asked.push(name);
        return native;
      },
    });
    const port = fakePort("media-sync");
    listeners.connect(port);
    const request = { op: "sync", dest: "aww", items: [] };
    port.emit(request);
    port.emit({ op: "sync", dest: "second", items: [] });
    assert.deepStrictEqual(asked, ["com.edo.media_sync"]);
    assert.deepStrictEqual(native.posted, [request]);
    native.emit({ type: "progress", id: "a", status: "ok" });
    native.emit({ type: "done", ok: 1, skipped: 0, failed: 0 });
    assert.deepStrictEqual(port.posted, [
      { type: "progress", id: "a", status: "ok" },
      { type: "done", ok: 1, skipped: 0, failed: 0 },
    ]);
    assert.strictEqual(native.disconnected, true);
    assert.strictEqual(port.disconnected, true);
  });

  test("other ports are left alone", () => {
    const { listeners } = loadBackground({
      connectNative: () => {
        throw new Error("should not connect");
      },
    });
    const port = fakePort("something-else");
    listeners.connect(port);
    port.emit({ op: "sync" });
    assert.deepStrictEqual(port.posted, []);
  });

  test("a helper that cannot be reached becomes an error code", () => {
    [
      ["Specified native messaging host not found.", "host_missing"],
      [
        "Access to the specified native messaging host is forbidden.",
        "host_forbidden",
      ],
      ["Native host has exited.", "host_crashed"],
      ["", "host_crashed"],
    ].forEach(([reason, code]) => {
      const native = fakeNative();
      const { listeners, runtime } = loadBackground({
        connectNative: () => native,
      });
      const port = fakePort("media-sync");
      listeners.connect(port);
      port.emit({ op: "sync" });
      runtime.lastError = reason ? { message: reason } : undefined;
      native.drop();
      assert.strictEqual(port.posted.length, 1, reason);
      assert.strictEqual(port.posted[0].type, "error");
      assert.strictEqual(port.posted[0].code, code, reason);
    });
  });

  test("without native messaging the relay says so instead of throwing", () => {
    const { listeners } = loadBackground();
    const port = fakePort("media-sync");
    listeners.connect(port);
    port.emit({ op: "sync" });
    assert.strictEqual(port.posted[0].type, "error");
    assert.strictEqual(port.posted[0].code, "unavailable");
    const thrower = loadBackground({
      connectNative: () => {
        throw new Error("boom");
      },
    });
    const second = fakePort("media-sync");
    thrower.listeners.connect(second);
    second.emit({ op: "sync" });
    assert.strictEqual(second.posted[0].code, "host_crashed");
  });

  test("the page going away closes the helper's connection", () => {
    const native = fakeNative();
    const { listeners } = loadBackground({ connectNative: () => native });
    const port = fakePort("media-sync");
    listeners.connect(port);
    port.emit({ op: "sync" });
    port.drop();
    assert.strictEqual(native.disconnected, true);
  });

  test("the Firefox package drops the native messaging permission, Chrome keeps it", () => {
    const { targets, readManifest } = require("./package-extension");
    const manifest = readManifest();
    assert.ok(manifest.permissions.includes("nativeMessaging"));
    assert.ok(!manifest.permissions.includes("key"));
    assert.strictEqual(manifest.key, undefined);
    assert.ok(
      targets.chrome
        .patchManifest(manifest)
        .permissions.includes("nativeMessaging"),
    );
    const firefox = targets.firefox.patchManifest(manifest);
    assert.ok(!firefox.permissions.includes("nativeMessaging"));
    assert.ok(firefox.permissions.includes("storage"));
    // The source manifest is not changed by patching.
    assert.ok(manifest.permissions.includes("nativeMessaging"));
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
