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
      ["https://preview.redd.it/gone.jpg", 130, 60, false],
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

  test("two placeholders are known, one per host", () => {
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
    [
      ["/r/pics/", "pics"],
      ["/r/pics", "pics"],
      ["/r/Pics/top/", "Pics"],
      ["/r/pics/new/", "pics"],
      ["/r/pics/search/", "pics"],
      ["/r/de/", "de"],
      ["/r/pics_2/", "pics_2"],
    ].forEach(([pathname, sub]) => {
      assert.strictEqual(paths.subredditFromPath(pathname), sub, pathname);
    });
  });

  test("post pages, multireddits, front pages and other pages name none", () => {
    assert.ok(paths, "subreddit path helpers not loaded");
    [
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
    ].forEach((pathname) => {
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

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
