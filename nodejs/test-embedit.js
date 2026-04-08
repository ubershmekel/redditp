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
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
