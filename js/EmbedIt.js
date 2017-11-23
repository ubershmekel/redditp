embedit = {};

embedit.video = function (webmUrl, mp4Url) {
    // imgur is annoying and when you use the <source> tags
    // it tries to redirect you to the gifv page instead of serving
    // video. We can only circumvent that by putting the src 
    // on the <video> tag :/
    
    var video = $('<video autoplay loop/>');
    video.append($('<source/>').attr('src', webmUrl));
    video.append($('<source/>').attr('src', mp4Url));
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
        detect: /imgur\.com[^\.]+/,
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
        convert: function (url) {
            //embedit.unsupported(url);
            return false;
        }
    },
    {
        name: "gfycat",
        detect: /gfycat\.com.*/,
        convert: function (url, embedFunc) {
            //https://gfycat.com/cajax/get/ScaryGrizzledComet
            var match = url.match(/gfycat.com\/(\w+)/i);
            if(match && match.length > 1)
                var name = match[1];
            else
                return false;
            
            $.ajax({
                url: 'https://gfycat.com/cajax/get/' + name,
                dataType: "jsonp",
                success: function(data) {
                    embedFunc(embedit.video(data.gfyItem.webmUrl, data.gfyItem.mp4Url));
                }
            })
            return true;
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
    for (var key in embedit.convertors) {
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