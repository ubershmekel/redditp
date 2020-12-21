// eslint-disable-next-line no-global-assign,no-native-reassign
embedit = {};

embedit.imageTypes = {
    image: 'image',
    gfycat: 'gfycat',
    gifv: 'gifv',
    redgif: 'redgif'
};


embedit.redditBaseUrl = "http://www.reddit.com";
if (location && location.protocol === 'https:') {
    // page is secure
    embedit.redditBaseUrl = "https://www.reddit.com";
}

embedit.video = function (webmUrl, mp4Url) {
    // imgur is annoying and when you use the <source> tags
    // it tries to redirect you to the gifv page instead of serving
    // video. We can only circumvent that by putting the src 
    // on the <video> tag :/
    
    var video = $('<video autoplay playsinline loop />');
    if (webmUrl) {
        video.append($('<source/>').attr('src', webmUrl));
    }
    if (mp4Url) {
        video.append($('<source/>').attr('src', mp4Url));
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
}

embedit.unsupported = function(url) {
    console.log("Omitting unsupported url: '" + url + "'");
}

embedit.redGifConvert = function (url, embedFunc) {
    var name = embedit.redGifUrlToId(url);

    if(!name) {
        console.log("Failed to identify redgif name");
        return false;
    }

    $.ajax({
        url: 'https://api.redgifs.com/v1/gfycats/' + name,
        dataType: "json",
        success: function(data) {
            if (!data || !data.gfyItem || !data.gfyItem.webmUrl) {
                embedFunc(null);
                return;
            }
            embedFunc(embedit.video(data.gfyItem.webmUrl, data.gfyItem.mp4Url));
        }
    })
    return true;
}

embedit.convertors = [
    {
        name: "imgurAlbums",
        detect: /imgur\.com\/a\/.*/,
        convert: function (url, embedFunc) {
            embedit.unsupported(url);
            embedFunc(null);
            return true;
        }
    },
    {
        name: "imgurGifv",
        detect: /imgur\.com.*(gif|gifv|mp4|webm)/,
        convert: function (url, embedFunc) {
            var no_extension = url.replace(/\.\w+$/, '')
            var webmUrl = no_extension + '.webm'
            var mp4Url = no_extension + '.mp4';
            embedFunc(embedit.video(webmUrl, mp4Url));
            return true;
        }
    },
    {
        name: "imgurNoExtension",
        detect: /imgur\.com[^.]+/,
        convert: function (url, embedFunc) {
            var newUrl = url + '.jpg';
            var image = $('<img />');
            image.attr("src", newUrl);
            embedFunc(image);
            return true;
        }
    },
    {
        name: "redditPost",
        detect: /reddit\.com\/r\/.*/,
        convert: function (/*url*/) {
            //embedit.unsupported(url);
            return false;
        }
    },
    {
        name: "gfycat",
        detect: /gfycat\.com.*/,
        convert: function (url, embedFunc) {
            var name = embedit.gfyUrlToId(url);
            if(!name)
                return false;

            $.ajax({
                //url: 'https://gfycat.com/cajax/get/' + name,
                url: 'https://api.gfycat.com/v1/gfycats/' + name,
                dataType: "json",
                success: function(data) {
                    if (!data || !data.gfyItem || !data.gfyItem.webmUrl) {
                        embedFunc(null);
                        return;
                    }
                    embedFunc(embedit.video(data.gfyItem.webmUrl, data.gfyItem.mp4Url));
                },
                error: function() {
                    var newUrl = url.replace("gfycat.com/", "redgifs.com/watch/");
                    console.log("gfycat failed load, trying redgif", newUrl);
                    embedit.redGifConvert(newUrl, embedFunc);
                }
            })
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
            var newElem = $('<img />', {
                id: '',
                src: url,
                alt: ''
            });
            embedFunc(newElem);
            return true;
        }
    },

]

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
            if (handled)
                return true;
        }
    }
    embedit.unsupported(url);
    embedFunc(null);
}

embedit.gfyUrlToId = function(url) {
    //https://gfycat.com/cajax/get/ScaryGrizzledComet
    var match = url.match(/gfycat.com\/(gifs\/detail\/)?(\w+)/i);
    if(match && match.length > 2) {
        return match[2];
    } else {
        return false;
    }
}

embedit.redGifUrlToId = function(url) {
    var matches = url.match(/redgifs.com\/watch\/([\w-]+)\/?/i);

    if (matches && matches.length > 1) {
        return matches[1];
    } else { 
        return false;
    }
}

function isImageExtension(url) {
    var goodExtensions = ['.jpg', '.jpeg', '.gif', '.bmp', '.png'];
    var dotLocation = url.lastIndexOf('.');
    if (dotLocation < 0) {
        console.log("skipped no dot: " + url);
        return false;
    }
    var extension = url.substring(dotLocation);

    return goodExtensions.indexOf(extension) >= 0;
}

embedit.redditItemToPic = function(item) {
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
}

embedit.transformRedditData = function(pic) {
    // TODO: convert this to a more functional style

    pic.type = embedit.imageTypes.image;
    // Replace HTTP with HTTPS on gfycat and imgur to avoid this:
    //      Mixed Content: The page at 'https://redditp.com/r/gifs' was loaded over HTTPS, but requested an insecure video 'http://i.imgur.com/LzsnbNU.webm'. This content should also be served over HTTPS.
    var http_prefix = 'http://';
    var https_prefix = 'https://';
    if (pic.url.indexOf('gfycat.com') >= 0) {
        pic.type = embedit.imageTypes.gfycat;
        pic.url = pic.url.replace(http_prefix, https_prefix);
    } else if (pic.url.indexOf('redgifs.com') >= 0) {
        pic.type = embedit.imageTypes.redgif;
        pic.url = pic.url.replace(http_prefix, https_prefix);
    } else if (pic.url.indexOf('//v.redd.it/') >= 0) {
        // NOTE DO NOT ADD DOMAINS HERE - MODIFY EMBEDIT.JS instead
        // NOTE DO NOT ADD DOMAINS HERE - MODIFY EMBEDIT.JS instead
        // NOTE DO NOT ADD DOMAINS HERE - MODIFY EMBEDIT.JS instead
        // Sadly, we have to add domains here or they get dropped in the "cannot display url" error below.
        // Need to redesign this redditp thing.
        if (pic.data.media) {
            pic.type = embedit.imageTypes.gifv;
            pic.url = pic.data.media.reddit_video.fallback_url;
        } else if (pic.data.crosspost_parent_list && pic.data.crosspost_parent_list[0].media) {
            pic.type = embedit.imageTypes.gifv;
            pic.url = pic.data.crosspost_parent_list[0].media.reddit_video.fallback_url;
        } else {
            // some crossposts don't have a pic.data.media obj?
            return false;
        }
        pic.sound = pic.url.substring(0, pic.url.lastIndexOf('/')) + "/audio";
    } else if (pic.url.search(/^http.*imgur.*gifv?$/) > -1) {
        pic.type = embedit.imageTypes.gifv;
        pic.url = pic.url.replace(http_prefix, https_prefix);
    } else if (isImageExtension(pic.url)) {
        // simple image
    } else {
        var betterUrl = tryConvertUrl(pic.url);
        if (betterUrl !== '') {
            pic.url = betterUrl;
        } else {
            if (window.debug) {
                console.log('cannot display url as image: ' + pic.url);
            }
            return false;
        }
    }

    return true;
}

var tryConvertUrl = function (url) {
    if (url.indexOf('imgur.com') > 0 || url.indexOf('/gallery/') > 0) {
        // special cases with imgur

        if (url.indexOf('gifv') >= 0) {
            if (url.indexOf('i.') === 0) {
                url = url.replace('imgur.com', 'i.imgur.com');
            }
            return url.replace('.gifv', '.gif');
        }

        if (url.indexOf('/a/') > 0 || url.indexOf('/gallery/') > 0) {
            // albums aren't supported yet
            //log('Unsupported gallery: ' + url);
            return '';
        }

        // imgur is really nice and serves the image with whatever extension
        // you give it. '.jpg' is arbitrary
        // regexp removes /r/<sub>/ prefix if it exists
        // E.g. http://imgur.com/r/aww/x9q6yW9
        return url.replace(/r\/[^ /]+\/(\w+)/, '$1') + '.jpg';
    }

    return '';
};

//////////////////////////////////////////////////////////
// Exports
//////////////////////////////////////////////////////////

function browserNodeExport(exported, name) {
    // based off of http://www.matteoagosti.com/blog/2013/02/24/writing-javascript-modules-for-both-browser-and-node/
    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        /* global module */
        module.exports = exported;
    } else {
        if (typeof define === 'function' && define.amd) {
            /* global define */
            define([], function () {
                return exported;
            });
        } else {
            window[name] = exported;
        }
    }
}

browserNodeExport(embedit, 'embedit');
