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

  test("subreddit name casing is preserved verbatim", () => {
    // Reddit paths are case-insensitive but bucket object names are not, so
    // the snapshot's casing is the only one that resolves.
    assert.strictEqual(
      embedit.archiveFilenameForPath("/r/EarthPorn/.json"),
      "r-EarthPorn.json",
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
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
