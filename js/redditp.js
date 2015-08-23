/*
  Author: Yuval Greenfield (http://uberpython.wordpress.com) 
 
  You can save the HTML file and use it locally btw like so:
    file:///wherever/index.html?/r/aww
 
  Favicon by Double-J designs http://www.iconfinder.com/icondetails/68600/64/_icon
  HTML based on http://demo.marcofolio.net/fullscreen_image_slider/
  Author of slideshow base :      Marco Kuiper (http://www.marcofolio.net/)
*/

var redditp = {};

//// Globals

redditp.settings = {
    debug: false,
    animationSpeed: 1000,
    cookieDays: 300,
    timeToNextSlide: 6,
    goodExtensions: ['.jpg', '.jpeg', '.gif', '.bmp', '.png'],
};

redditp.cookies = {
    getShouldAutoNextSlide: function() {
        return redditp.cookies._getCookie("shouldAutoNextSlideCookie", "true") == "true";
    },
    setShouldAutoNextSlide: function(value) {
        redditp.cookies._setCookie("shouldAutoNextSlideCookie", value);
    },
    getNsfw: function() {
        return redditp.cookies._getCookie("nsfwCookie", "true") == "true";
    },
    setNsfw: function(value) {
        redditp.cookies._setCookie("nsfwCookie", value);
    },
    getTimeToNextSlide: function() {
        return parseFloat(redditp.cookies._getCookie("timeToNextSlideCookie", redditp.settings.timeToNextSlide)) * 1000;
    },
    setTimeToNextSlide: function(value) {
        redditp.cookies._setCookie("timeToNextSlideCookie", value);
    },
    _setCookie: function (c_name, value) {
        var exdate = new Date();
        exdate.setDate(exdate.getDate() + redditp.settings.cookieDays);
        var c_value = escape(value) + ((redditp.settings.cookieDays == null) ? "" : "; expires=" + exdate.toUTCString());
        document.cookie = c_name + "=" + c_value;
    },
    _getCookie: function (c_name, default_value) {
        var i, x, y;
        var cookiesArray = document.cookie.split(";");
        for (i = 0; i < cookiesArray.length; i++) {
            x = cookiesArray[i].substr(0, cookiesArray[i].indexOf("="));
            y = cookiesArray[i].substr(cookiesArray[i].indexOf("=") + 1);
            x = x.replace(/^\s+|\s+$/g, "");
            if (x == c_name) {
                return unescape(y);
            }
        }
        return default_value;
    }
};

redditp.session = {
    // 0-based index to set which picture to show first
    // init to -1 until the first image is loaded
    activeIndex: -1,
    
    // Variable to store if the animation is playing or not
    isAnimating: false,

    // Id of timer
    nextSlideTimeoutId: null,

    // Reddit filter "After"
    after: "",

    foundOneImage: false,
};

redditp.urls = {
    _redditBaseUrl: null,
    redditBaseUrl: function() {
        if (redditp.urls._redditBaseUrl) {
            return redditp.urls._redditBaseUrl;
        }

        var result = "http://www.reddit.com";
        if (location.protocol === 'https:') {
            // page is secure
            result = "https://www.reddit.com";
            // TODO: try "//" instead of specifying the protocol
        }
    
        redditp.urls._redditBaseUrl = result;
        return result;
    },

    _getRestOfUrl: function () {
        // Separate to before the question mark and after
        // Detect predefined reddit url paths. If you modify this be sure to fix
        // .htaccess
        // This is a good idea so we can give a quick 404 page when appropriate.
        var decodeUrl = function (url) {
            return decodeURIComponent(url.replace(/\+/g, " "))
        }
        
        var regexS = "(/(?:(?:r/)|(?:imgur/a/)|(?:user/)|(?:domain/)|(?:search))[^&#?]*)[?]?(.*)";
        var regex = new RegExp(regexS);
        var results = regex.exec(window.location.href);
        //log(results);
        if (results == null) {
            return ["", ""];
        } else {
            return [results[1], decodeUrl(results[2])];
        }
    },

    _subredditUrl: null,
    subredditUrl: function() {
        if (redditp.urls._subredditUrl) {
            return redditp.urls._subredditUrl;
        }
        var result = redditp.urls._getRestOfUrl()[0];
        
        // Remove .compact as it interferes with .json (we got "/r/all/.compact.json" which doesn't work).
        result = result.replace(/.compact/, "");
        // Consolidate double slashes to avoid r/all/.compact/ -> r/all//
        result = result.replace(/\/{2,}/, "/");

        redditp.urls._subredditUrl = result;
        return result;
    },

    _getVars: null,
    getVars: function() {
        if (redditp.urls._getVars) {
            return redditp.urls._getVars;
        }
        redditp.urls._getVars = redditp.urls._getRestOfUrl()[1];
        return redditp.urls._getVars;
    },
}


// Variable to store the images we need to set as background
// which also includes some text and url's.
redditp.photos = [];

// maybe checkout http://engineeredweb.com/blog/09/12/preloading-images-jquery-and-javascript/ for implementing the old precache
redditp.cache = [];


//// Methods

//
// Animate the navigation box
//
redditp.animateNavigationBox = function (imageIndex) {
    var toggleNumberButton = function (imageIndex, turnOn) {
        var numberButton = $('#numberButton' + (imageIndex + 1));
        if (turnOn) {
            numberButton.addClass('active');
        } else {
            numberButton.removeClass('active');
        }
    }

    var photo = redditp.photos[imageIndex];
    var subreddit = '/r/' + photo.subreddit;

    $('#navboxTitle').html(photo.title);
    $('#navboxSubreddit').attr('href', redditp.session.redditBaseUrl + subreddit).html(subreddit);
    $('#navboxLink').attr('href', photo.url).attr('title', photo.title);
    $('#navboxCommentsLink').attr('href', photo.commentsLink).attr('title', "Comments on reddit");

    toggleNumberButton(redditp.session.activeIndex, false);
    toggleNumberButton(imageIndex, true);
};


redditp.resetNextSlideTimer = function () {
    clearTimeout(redditp.session.nextSlideTimeoutId);
    redditp.session.nextSlideTimeoutId = setTimeout(redditp.autoNextSlide, redditp.cookies.getTimeToNextSlide());
};

redditp.clearTimeout = function (){
    clearTimeout(redditp.session.nextSlideTimeoutId);
}

redditp.autoNextSlide = function () {
    if (redditp.cookies.getShouldAutoNextSlide()) {
        // startAnimation takes care of the setTimeout
        redditp.nextSlide();
    }
}

//
// Starts the animation, based on the image index
//
redditp.startAnimation = function (imageIndex) {
    redditp.resetNextSlideTimer();

    // If the same number has been chosen, or the index is outside the
    // photos range, or we're already animating, do nothing
    if (redditp.session.activeIndex == imageIndex 
        || imageIndex > redditp.photos.length - 1 
        || imageIndex < 0 
        || redditp.session.isAnimating 
        || redditp.photos.length == 0) {
        return;
    }

    redditp.session.isAnimating = true;
    redditp.animateNavigationBox(imageIndex);
    redditp._slideBackgroundPhoto(imageIndex);

    // Set the active index to the used image index
    redditp.session.activeIndex = imageIndex;

    if (redditp._isLastImage(redditp.session.activeIndex) 
        && redditp.urls.subredditUrl().indexOf('/imgur') != 0) {
        redditp.getRedditImages();
    }
};

redditp.nextSlide = function() {
    if(!redditp.cookies.getNswf) {
        for(var i = redditp.session.activeIndex + 1; i < redditp.photos.length; i++) {
            if (!redditp.photos[i].over18) {
                return redditp.startAnimation(i);
            }
        }
    }
    if (redditp._isLastImage(redditp.session.activeIndex) && !loadingNextImages) {
        // the only reason we got here and there aren't more pictures yet
        // is because there are no more images to load, start over
        return redditp.startAnimation(0);
    }
    redditp.startAnimation(redditp.session.activeIndex + 1);
};

redditp.prevSlide = function() {
    if(!redditp.cookies.getNswf) {
        for(var i = redditp.session.activeIndex - 1; i > 0; i--) {
            if (!redditp.photos[i].over18) {
                return redditp.startAnimation(i);
            }
        }
    }
    redditp.startAnimation(redditp.session.activeIndex - 1);
};

redditp.getRedditImages = function () {
    //if (noMoreToLoad){
    //    log("No more images to load, will rotate to start.");
    //    return;
    //}

    loadingNextImages = true;

    var jsonUrl = redditp.urls.redditBaseUrl() 
                + redditp.urls.subredditUrl() 
                + ".json?jsonp=?" 
                + redditp.session.after 
                + "&" 
                + redditp.urls.getVars();
    console.log(jsonUrl);
    //log(jsonUrl);
    var failedAjax = function (data) {
        alert("Failed ajax, maybe a bad url? Sorry about that :(");
        redditp.failCleanup();
    };
    var handleData = function (data) {
        //redditData = data //global for debugging data
        // NOTE: if data.data.after is null then this causes us to start
        // from the top on the next getRedditImages which is fine.
        redditp.session.after = "&after=" + data.data.after;

        if (data.data.children.length == 0) {
            alert("No data from this url :(");
            return;
        }

        $.each(data.data.children, function (i, item) {
            redditp.addImageSlide({
                url: item.data.url,
                title: item.data.title,
                over18: item.data.over_18,
                subreddit: item.data.subreddit,
                commentsLink: redditp.urls.redditBaseUrl() + item.data.permalink
            });
        });

        redditp.verifyNsfwMakesSense();
        
        if (!redditp.session.foundOneImage) {
            // Note: the jsonp url may seem malformed but jquery fixes it.
            //log(jsonUrl);
            alert("Sorry, no displayable images found in that url :(")
        }

        // show the first image
        if (redditp.session.activeIndex == -1) {
            redditp.startAnimation(0);
        }

        if (data.data.after == null) {
            log("No more pages to load from this subreddit, reloading the start");

            // Show the user we're starting from the top
            var numberButton = $("<span />").addClass("numberButton").text("-");
            redditp.addNumberButton(numberButton);
        }
        loadingNextImages = false;
       
    };

    // I still haven't been able to catch jsonp 404 events so the timeout
    // is the current solution sadly.
    $.ajax({
        url: jsonUrl,
        dataType: 'jsonp',
        success: handleData,
        error: failedAjax,
        404: failedAjax,
        timeout: 5000
    });
}

redditp.addImageSlide = function (pic) {
    /*
    var pic = {
        "title": title,
        "url": url,
        "commentsLink": commentsLink,
        "over18": over18,
        "isVideo": video
    }
    */

    var isImageExtension = function (url) {
        var dotLocation = url.lastIndexOf('.');
        if (dotLocation < 0) {
            log("skipped no dot: " + url);
            return false;
        }
        var extension = url.substring(dotLocation);

        if (redditp.settings.goodExtensions.indexOf(extension) >= 0) {
            return true;
        } else {
            //log("skipped bad extension: " + url);
            return false;
        }
    }

    pic.isVideo = false;
    if (pic.url.indexOf('gfycat.com') >= 0){
        pic.isVideo = true;
    } else if (isImageExtension(pic.url)) {
        // simple image
    } else {
        var betterUrl = redditp._tryConvertUrl(pic.url);
        if(betterUrl != '') {
            pic.url = betterUrl;
        } else {
            if (redditp.settings.debug) {
                console.log('failed: ' + pic.url);
            }
            return;
        }
    }

    redditp.session.foundOneImage = true;
    
    redditp.preLoadImages(pic.url);
    redditp.photos.push(pic);

    var i = redditp.photos.length - 1;
    var numberButton = $("<a />").html(i + 1)
        .data("index", i)
        .attr("title", redditp.photos[i].title)
        .attr("id", "numberButton" + (i + 1));
    if(pic.over18) {
        numberButton.addClass("over18");
    }
    numberButton.click(function () {
        redditp._showImage($(this));
    });
    numberButton.addClass("numberButton");
    redditp.addNumberButton(numberButton);
}

redditp.verifyNsfwMakesSense = function() {
    // Cases when you forgot NSFW off but went to /r/nsfw
    // can cause strange bugs, let's help the user when over 80% of the
    // content is NSFW.
    var nsfwImages = 0
    for(var i = 0; i < redditp.photos.length; i++) {
        if(redditp.photos[i].over18) {
            nsfwImages += 1
        }
    }
    
    if(0.8 < nsfwImages * 1.0 / redditp.photos.length) {
        redditp.cookies.setNsfw(true);
        $("#nsfw").prop("checked", nsfw);
    }
}

// Arguments are image paths relative to the current page.
redditp.preLoadImages = function () {
    var args_len = arguments.length;
    for (var i = args_len; i--;) {
        var cacheImage = document.createElement('img');
        cacheImage.src = arguments[i];
        redditp.cache.push(cacheImage);
    }
};

redditp.addNumberButton = function (numberButton) {
    var navboxUls = $(".navbox ul");
    var thisNavboxUl = navboxUls[navboxUls.length - 1];

    var newListItem = $("<li />").appendTo(thisNavboxUl);
    numberButton.appendTo(newListItem);

    // so li's have a space between them and can word-wrap in the box
    navboxUls.append(document.createTextNode(' '));
}


redditp.failCleanup = function() {
    if (redditp.photos.length > 0) {
        // already loaded images, don't ruin the existing experience
        return;
    }
    
    // remove "loading" title
    $('#navboxTitle').text('');
    
    // display alternate recommendations
    $('#recommend').css({'display':'block'});
}

redditp._tryConvertUrl = function (url) {
    if (url.indexOf('imgur.com') > 0 || url.indexOf('/gallery/') > 0) {
        // special cases with imgur

        if (url.indexOf('gifv') >= 0) {
            if (url.indexOf('i.') == 0) {
                url = url.replace('imgur.com', 'i.imgur.com')
            }
            return url.replace('.gifv', '.gif');
        }

        if (url.indexOf('/a/') > 0 || url.indexOf('/gallery/') > 0) {
            // albums aren't supported yet
            //console.log('Unsupported gallery: ' + url);
            return '';
        }
        
        // imgur is really nice and serves the image with whatever extension
        // you give it. '.jpg' is arbitrary
        // regexp removes /r/<sub>/ prefix if it exists
        // E.g. http://imgur.com/r/aww/x9q6yW9
        return url.replace(/r\/[^ \/]+\/(\w+)/, '$1') + '.jpg';
    }

    return '';
}

//
// Slides the background photos
//
redditp._slideBackgroundPhoto = function (imageIndex) {

    // Retrieve the accompanying photo based on the index
    var photo = redditp.photos[imageIndex];

    // Create a new div and apply the CSS
    var cssMap = Object();
    cssMap['display'] = "none";
    if(!photo.isVideo) {
        cssMap['background-image'] = "url(" + photo.url + ")";
        cssMap['background-repeat'] = "no-repeat";
        cssMap['background-size'] = "contain";
        cssMap['background-position'] = "center";
    }

    //var imgNode = $("<img />").attr("src", photo.image).css({opacity:"0", width: "100%", height:"100%"});
    var divNode = $("<div />").css(cssMap).addClass("clouds");
    if(photo.isVideo) {
        clearTimeout(nextSlideTimeoutId);
        var gfyid = photo.url.substr(1 + photo.url.lastIndexOf('/'));
        if(gfyid.indexOf('#') != -1)
            gfyid = gfyid.substr(0, gfyid.indexOf('#'));
        divNode.html('<img class="gfyitem" data-id="'+gfyid+'" data-controls="false"/>');
    }

    //imgNode.appendTo(divNode);
    divNode.prependTo("#pictureSlider");

    $("#pictureSlider div").fadeIn(redditp.settings.animationSpeed);
    if(photo.isVideo){
        gfyCollection.init();
        //ToDo: find a better solution!
        $(divNode).bind("DOMNodeInserted", function(e) {
            if(e.target.tagName.toLowerCase() == "video") {
                var vid = $('.gfyitem > div').width('100%').height('100%');
                vid.find('.gfyPreLoadCanvas').remove();
                var v = vid.find('video').width('100%').height('100%');
                vid.find('.gfyPreLoadCanvas').remove();
                if (redditp.getShouldAutoNextSlide()) {
                    v.removeAttr('loop');
                }
                v[0].onended = function (e) {
                    if (redditp.getShouldAutoNextSlide()) {                       
                        redditp.nextSlide();
                    }
                };
            }
        });
    }

    var oldDiv = $("#pictureSlider div:not(:first)");
    oldDiv.fadeOut(redditp.settings.animationSpeed, function () {
        oldDiv.remove();
        redditp.session.isAnimating = false;
    });
};

//
// Shows an image and plays the animation
//
redditp._showImage = function (docElem) {
    // Retrieve the index we need to use
    var imageIndex = docElem.data("index");

    redditp.startAnimation(imageIndex);
};

redditp._isLastImage = function(imageIndex) {
    if(redditp.cookies.getNsfw()) {
        if(imageIndex == redditp.photos.length - 1) {
            return true;
        } else {
            return false;
        }
    } else {
        // look for remaining sfw images
        for(var i = imageIndex + 1; i < redditp.photos.length; i++) {
            if(!redditp.photos[i].over18) {
                return false;
            }
        }
        return true;
    }
}