// eslint-disable-next-line no-global-assign,no-native-reassign
embedit = {};

embedit.imageTypes = {
  image: "image",
  gfycat: "gfycat",
  gifv: "gifv",
  redgif: "redgif",
};

embedit.redditBaseUrl = "http://old.reddit.com";

if (typeof window === "undefined") {
  // eslint-disable-next-line no-redeclare
  var window = {};
}

if (window.location && window.location.protocol === "https:") {
  // page is secure
  embedit.redditBaseUrl = "https://old.reddit.com";
}

embedit.video = function (webmUrl, mp4Url) {
  // imgur is annoying and when you use the <source> tags
  // it tries to redirect you to the gifv page instead of serving
  // video. We can only circumvent that by putting the src
  // on the <video> tag :/

  var video = $('<video autoplay playsinline loop controls="true" />');
  if (webmUrl) {
    video.append($("<source/>").attr("src", webmUrl));
  }
  if (mp4Url) {
    video.append($("<source/>").attr("src", mp4Url));
  }
  return video;
  //video.attr("src", urls[0]);
  /*
    var url;
    if(!webmUrl && !mp4Url) {
        console.error("Empty video urls given");
        return;
    }
    
    if(mp4Url)
        url = mp4Url
    else
        url = webmUrl
    
    if (Modernizr.video.webm && webmUrl) {
        // Thank you http://diveintohtml5.info/detect.html
        // try WebM
        url = webmUrl;
    }

    url = url.replace("http://", "https://");
    video.attr("src", url);
    return video;*/
};

embedit.unsupported = function (url) {
  console.log("Omitting unsupported url: '" + url + "'");
};

embedit.redGifConvert = function (url, embedFunc) {
  var name = embedit.redGifUrlToId(url);

  if (!name) {
    console.log("Failed to identify redgif name");
    return false;
  }

  // https://github.com/ubershmekel/redditp/issues/138
  // Redgifs isn't allowing CORS requests to others.
  // access-control-allow-origin: https://www.redgifs.com
  const iframeUrl = "https://www.redgifs.com/ifr/" + name;
  embedFunc(
    $(
      '<iframe src="' +
        iframeUrl +
        '" frameborder="0" scrolling="no" width="100%" height="100%" allowfullscreen="" style="position:absolute;"></iframe>',
    ),
  );
  return true;
};

embedit.convertors = [
  {
    name: "imgurAlbums",
    detect: /imgur\.com\/a\/.*/,
    convert: function (url, embedFunc) {
      embedit.unsupported(url);
      embedFunc(null);
      return true;
    },
  },
  {
    name: "imgurGifv",
    detect: /imgur\.com.*(gif|gifv|mp4|webm)/,
    convert: function (url, embedFunc) {
      var no_extension = url.replace(/\.\w+$/, "");
      var webmUrl = no_extension + ".webm";
      var mp4Url = no_extension + ".mp4";
      embedFunc(embedit.video(webmUrl, mp4Url));
      return true;
    },
  },
  {
    name: "imgurNoExtension",
    detect: /imgur\.com[^.]+/,
    convert: function (url, embedFunc) {
      var newUrl = url + ".jpg";
      var image = $("<img />");
      image.attr("src", newUrl);
      embedFunc(image);
      return true;
    },
  },
  {
    name: "redditPost",
    detect: /reddit\.com\/r\/.*/,
    convert: function (/*url*/) {
      //embedit.unsupported(url);
      return false;
    },
  },
  {
    name: "gfycat",
    detect: /gfycat\.com.*/,
    convert: function (url, embedFunc) {
      var name = embedit.gfyUrlToId(url);
      if (!name) return false;

      $.ajax({
        //url: 'https://gfycat.com/cajax/get/' + name,
        url: "https://api.gfycat.com/v1/gfycats/" + name,
        dataType: "json",
        success: function (data) {
          if (!data || !data.gfyItem || !data.gfyItem.webmUrl) {
            embedFunc(null);
            return;
          }
          embedFunc(embedit.video(data.gfyItem.webmUrl, data.gfyItem.mp4Url));
        },
        error: function () {
          var newUrl = url.replace("gfycat.com/", "redgifs.com/watch/");
          console.log("gfycat failed load, trying redgif", newUrl);
          embedit.redGifConvert(newUrl, embedFunc);
        },
      });
      return true;
    },
  },
  {
    name: "redgifs",
    detect: /redgifs\.com.*/,
    convert: embedit.redGifConvert,
  },
  {
    name: "v.reddit",
    detect: /v\.redd\.it.*/,
    convert: function (url, embedFunc) {
      //var url = url + '/HLSPlaylist.m3u8';
      //var url = url + '/DASH_4_8_M?source=fallback';
      // NOTE - this step relies on the fallback_rul we get from reddit in script.js.
      // For embedit to support v.redd.it URLS on its own there will need to be something more clever here.
      embedFunc(embedit.video(url));
      return true;

      //} else if (pic.url.indexOf('//v.redd.it/') >= 0) {
      //pic.type = imageTypes.gifv;
      //pic.url = pic.url + '/HLSPlaylist.m3u8';
    },
  },
  {
    name: "imageExtension",
    detect: /\.(png|jpg|jpeg|gif|bmp)$/,
    convert: function (url, embedFunc) {
      var newElem = $("<img />", {
        id: "",
        src: url,
        alt: "",
      });
      embedFunc(newElem);
      return true;
    },
  },
  {
    name: "preview.redd.it",
    detect: /preview\.redd\.it.*/,
    convert: function (url, embedFunc) {
      embedFunc(embedit.video(url));
      return true;
    },
  },
];

embedit.embed = function (url, embedFunc) {
  //var embedFunc = function (elem) {
  //    elem.appendTo($("#container"));
  //}
  var keys = Object.keys(embedit.convertors);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var convertor = embedit.convertors[key];
    if (url.match(convertor.detect)) {
      //console.log("Matched: " + url + "\n to - " + convertor.name);
      var handled = convertor.convert(url, embedFunc);
      //console.log(newElem);
      if (handled) return true;
    }
  }
  embedit.unsupported(url);
  embedFunc(null);
};

embedit.gfyUrlToId = function (url) {
  //https://gfycat.com/cajax/get/ScaryGrizzledComet
  var match = url.match(/gfycat.com\/(gifs\/detail\/)?(\w+)/i);
  if (match && match.length > 2) {
    return match[2];
  } else {
    return false;
  }
};

embedit.redGifUrlToId = function (url) {
  //https://redgifs.com/ifr/unhappyfluidgrassspider'
  var matches = url.match(/redgifs.com\/watch\/([\w-]+)\/?/i);
  if (matches && matches.length > 1) {
    return matches[1];
  }

  matches = url.match(/redgifs.com\/ifr\/([\w-]+)\/?/i);
  if (matches && matches.length > 1) {
    return matches[1];
  }

  return false;
};

embedit.processRedditJson = function (data) {
  var result = {
    children: [],
    after: null,
  };

  // handle single page json
  if (data && data.length === 2 && data[0].data.children.length === 1) {
    // this means we're in single post link
    // response consists of two json objects, one for post, one for comments
    data = data[0];
  }

  //redditData = data //global for debugging data
  // NOTE: if data.data.after is null then this causes us to start
  // from the top on the next getRedditImages which is fine.
  if (data && data.data && data.data.after) {
    result.after = data.data.after;
  }

  if (data && data.data && data.data.children) {
    result.children = data.data.children;
  } else {
    // comments of e.g. a photoshopbattles post
    //children = rp.flattenRedditData(data);
    //throw new Error("Comments pages not yet supported");
  }

  if (result.children.length === 0) {
    console.log(
      "What case is this? Does the data have any length? Is this the standard nothing found case? TODO: debug this",
    );
    result.children = data;
  }

  return result;
};

embedit.redditItemToPic = function (item) {
  var pic = {
    url: item.data.url || item.data.link_url,
    title: item.data.title || item.data.link_title,
    over18: item.data.over_18,
    subreddit: item.data.subreddit,
    commentsLink: embedit.redditBaseUrl + item.data.permalink,
    userLink: item.data.author,
    data: item.data,
  };

  if (!embedit.transformRedditData(pic)) {
    return null;
  }

  return pic;
};

function decodeEntities(encodedString) {
  // https://stackoverflow.com/questions/44195322/a-plain-javascript-way-to-decode-html-entities-works-on-both-browsers-and-node
  var translate_re = /&(nbsp|amp|quot|lt|gt);/g;
  var translate = {
    nbsp: " ",
    amp: "&",
    quot: '"',
    lt: "<",
    gt: ">",
  };
  return encodedString
    .replace(translate_re, function (match, entity) {
      return translate[entity];
    })
    .replace(/&#(\d+);/gi, function (match, numStr) {
      var num = parseInt(numStr, 10);
      return String.fromCharCode(num);
    });
}

// Preparers: keyed by domain string. Values are either a single prepare function
// (when no further URL inspection is needed) or an array of {detect?, prepare}
// objects tried in order (most specific first).
// URLs that match no domain fall through to an image-extension check in transformRedditData.
embedit.preparers = {
  "gfycat.com": function (pic) {
    pic.type = embedit.imageTypes.gfycat;
    pic.url = pic.url.replace("http://", "https://");
    return true;
  },
  "redgifs.com": function (pic) {
    pic.type = embedit.imageTypes.redgif;
    pic.url = pic.url.replace("http://", "https://");
    return true;
  },
  // Note that this `DASH_audio.mp4` is now `DASH_AUDIO_128.mp4`.
  // You can find it in the `.mpd` file, but I don't want to parse that.
  // Instead - we'll use `dash.min.js` to create the video element.
  "v.redd.it": function (pic) {
    var media =
      pic.data.media ||
      (pic.data.crosspost_parent_list &&
        pic.data.crosspost_parent_list[0] &&
        pic.data.crosspost_parent_list[0].media);
    if (!media) {
      // some crossposts don't have a media obj
      return false;
    }
    pic.type = embedit.imageTypes.gifv;
    pic.url = media.reddit_video.fallback_url;
    pic.sound =
      pic.url.substring(0, pic.url.lastIndexOf("/")) + "/DASH_audio.mp4";
    // DASH manifest URL for adaptive streaming via dash.js (may be absent on some posts)
    if (pic.data.secure_media && pic.data.secure_media.reddit_video) {
      pic.dashUrl = pic.data.secure_media.reddit_video.dash_url;
    }
    return true;
  },
  // URLs ending in .gif or .gifv are served as video (webm/mp4).
  // All other imgur URLs get .jpg appended (imgur serves any extension).
  // The replace removes an /r/<sub>/ prefix if present, e.g. imgur.com/r/aww/x9q6yW9.
  "imgur.com": function (pic) {
    if (/gifv?$/.test(pic.url)) {
      pic.type = embedit.imageTypes.gifv;
      pic.url = pic.url.replace("http://", "https://");
      return true;
    }
    if (pic.url.indexOf("/a/") > 0 || pic.url.indexOf("/gallery/") > 0) {
      return false; // albums not supported
    }
    pic.url = pic.url.replace(/r\/[^ /]+\/(\w+)/, "$1") + ".jpg";
    pic.type = embedit.imageTypes.image;
    return true;
  },
  "reddit.com": function (pic) {
    if (pic.url.indexOf("/gallery/") < 0) return false;
    var dataSource = pic.data;
    if (!dataSource.gallery_data || !dataSource.gallery_data.items) {
      if (
        pic.data.crosspost_parent_list &&
        pic.data.crosspost_parent_list[0] &&
        pic.data.crosspost_parent_list[0].gallery_data &&
        pic.data.crosspost_parent_list[0].gallery_data.items
      ) {
        dataSource = pic.data.crosspost_parent_list[0];
      } else {
        return false;
      }
    }
    var firstItemId = dataSource.gallery_data.items[0].media_id;
    var encodedUrl = dataSource.media_metadata[firstItemId]["s"]["u"];
    pic.type = embedit.imageTypes.image;
    if (encodedUrl === undefined) {
      // some posts don't have the u key, but have gif and mp4 keys
      encodedUrl = dataSource.media_metadata[firstItemId]["s"]["mp4"];
      pic.type = embedit.imageTypes.gifv;
    }
    pic.url = decodeEntities(encodedUrl);
    return true;
  },
};

embedit.transformRedditData = function (pic) {
  pic.type = embedit.imageTypes.image;
  var hostname;
  try {
    hostname = new URL(pic.url).hostname;
  } catch (e) {
    hostname = "";
  }
  // Walk up subdomain levels: "i.imgur.com" → "imgur.com", etc.
  while (hostname) {
    var prepare = embedit.preparers[hostname];
    if (prepare) return prepare(pic);
    var dot = hostname.indexOf(".");
    if (dot < 0) break;
    hostname = hostname.slice(dot + 1);
  }

  // No domain matched — fall back to bare image extension
  if (/\.(png|jpg|jpeg|gif|bmp)$/i.test(pic.url)) {
    pic.type = embedit.imageTypes.image;
    return true;
  }

  if (window.debug) {
    console.log("cannot display url as image: " + pic.url);
  }
  return false;
};

// Convert a reddit gallery item (is_gallery: true) into an ordered array of
// pic objects, one per image in the gallery.
embedit.redditGalleryToPics = function (item) {
  var pics = [];
  var total = item.data.gallery_data.items.length;
  $.each(item.data.gallery_data.items, function (j, image) {
    var mediaId = image.media_id;
    var mime = item.data.media_metadata[mediaId].m; // e.g. "image/jpeg"
    var extension = mime.split("/")[1]; // "jpeg"
    var mimePrefix = mime.split("/")[0]; // "image" or "video"
    pics.push({
      title: item.data.title,
      url: "https://i.redd.it/" + mediaId + "." + extension,
      data: item.data,
      commentsLink: item.data.url,
      over18: item.data.over_18,
      subreddit: item.data.subreddit,
      galleryItem: j + 1,
      galleryTotal: total,
      userLink: item.data.author,
      type: mimePrefix,
    });
  });
  return pics;
};

// Try to fetch subredditUrl as a self-contained album (imgur, etc.).
// Returns true and calls onPics(pics) if the URL is a recognised album type.
// Returns false without calling anything if it is not — the caller should then
// fall back to fetching a reddit listing.
embedit.tryFetchAlbum = function (subredditUrl, onPics, onError) {
  if (subredditUrl.indexOf("/imgur") === 0) {
    embedit._fetchImgurAlbum(subredditUrl, onPics, onError);
    return true;
  }
  return false;
};

embedit._fetchImgurAlbum = function (subredditUrl, onPics, onError) {
  var albumID = subredditUrl.match(/.*\/(.+?)$/)[1];
  $.ajax({
    url: "https://api.imgur.com/3/album/" + albumID,
    dataType: "json",
    success: function (data) {
      var pics = [];
      $.each(data.data.images, function (_i, img) {
        var pic = {
          url: img.link,
          title: img.title || "",
          over18: !!img.nsfw,
          commentsLink: "",
          userLink: "",
          subreddit: "",
          data: {},
        };
        if (embedit.transformRedditData(pic)) {
          pics.push(pic);
        }
      });
      onPics(pics);
    },
    error: onError,
    404: onError,
    timeout: 5000,
    beforeSend: function (xhr) {
      xhr.setRequestHeader("Authorization", "Client-ID f2edd1ef8e66eaf");
    },
  });
};

// Render a pic into divNode.  Handles plain images (CSS background-image) and
// all embedded media (video, iframe, etc.) in one place so callers need no
// knowledge of pic.type or domain-specific URL patterns.
embedit.render = function (photo, divNode, onError) {
  if (photo.type === embedit.imageTypes.image) {
    // Trigger a browser fetch so the image is warm in cache; CSS background-image
    // alone does not preload in Chrome.
    if (typeof Image !== "undefined") {
      var img = new Image();
      img.src = photo.url;
    }
    divNode.css({
      display: "none",
      "background-image": "url(" + photo.url + ")",
      "background-repeat": "no-repeat",
      "background-size": "contain",
      "background-position": "center",
    });
    return;
  }

  embedit.embed(photo.url, function (elem) {
    if (!elem) {
      if (onError) onError();
      return;
    }
    // v.redd.it: embedit produces a plain <video src="fallback"> but DASH.js
    // must own the element.  Use a bare video placeholder; embedit.initDash()
    // initialises the DASH player after the div reaches the DOM.
    if (photo.url.match(/\/\/v\.redd\.it\//)) {
      elem = $('<video autoplay playsinline loop controls="true" />');
    }
    divNode.append(elem);
    elem.attr({ playsinline: "" });
    elem.width("100%").height("100%");
    if (elem[0] && elem[0].pause) {
      elem[0].pause();
    }
  });
};

// Initialise the DASH.js player for a v.redd.it slide.  Must be called after
// the divNode containing the <video> element has been inserted into the DOM.
embedit.initDash = function (photo) {
  if (!photo.dashUrl) return;
  if (typeof dashjs === "undefined") return;
  var player = dashjs.MediaPlayer().create();
  player.initialize(document.querySelector("video"), photo.dashUrl, true);
};

//////////////////////////////////////////////////////////
// Exports
//////////////////////////////////////////////////////////

function browserNodeExport(exported, name) {
  // based off of http://www.matteoagosti.com/blog/2013/02/24/writing-javascript-modules-for-both-browser-and-node/
  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    /* global module */
    module.exports = exported;
  } else {
    if (typeof define === "function" && define.amd) {
      /* global define */
      define([], function () {
        return exported;
      });
    } else {
      window[name] = exported;
    }
  }
}

browserNodeExport(embedit, "embedit");
