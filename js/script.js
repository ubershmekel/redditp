/*
  Author: Yuval Greenfield (http://uberpython.wordpress.com) 
 
  You can save the HTML file and use it locally btw like so:
    file:///wherever/index.html?/r/aww
 
  Favicon by Double-J designs http://www.iconfinder.com/icondetails/68600/64/_icon
  HTML based on http://demo.marcofolio.net/fullscreen_image_slider/
  Author of slideshow base :      Marco Kuiper (http://www.marcofolio.net/)
*/

// TODO: refactor all the globals to use the rp object's namespace.
var rp = {};

rp.settings = {
    debug: true,
    // Speed of the animation
    animationSpeed: 1000,
    shouldAutoNextSlide: true,
    timeToNextSlide: 6 * 1000,
    cookieDays: 300,
    goodExtensions: ['.jpg', '.jpeg', '.gif', '.bmp', '.png']
};

rp.session = {
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

    loadingNextImages: false
};

// Variable to store the images we need to set as background
// which also includes some text and url's.
rp.photos = [];

// maybe checkout http://engineeredweb.com/blog/09/12/preloading-images-jquery-and-javascript/ for implementing the old precache
rp.cache = [];


$(function () {

    $("#subredditUrl").text("Loading Reddit Slideshow");
    $("#navboxTitle").text("Loading Reddit Slideshow");

    fadeoutWhenIdle = true;
    var setupFadeoutOnIdle = function () {
        $('.fadeOnIdle').fadeTo('fast', 0);
        var navboxVisible = false;
        var fadeoutTimer = null;
        var fadeoutFunction = function () {
            navboxVisible = false;
            if (fadeoutWhenIdle) {
                $('.fadeOnIdle').fadeTo('slow', 0);
            }
        };
        $("body").mousemove(function () {
            if (navboxVisible) {
                clearTimeout(fadeoutTimer);
                fadeoutTimer = setTimeout(fadeoutFunction, 2000);
                return;
            }
            navboxVisible = true;
            $('.fadeOnIdle').fadeTo('fast', 1);
            fadeoutTimer = setTimeout(fadeoutFunction, 2000);
        });
    };
    // this fadeout was really inconvenient on mobile phones
    // and instead the minimize buttons should be used.
    //setupFadeoutOnIdle();

    function nextSlide() {
        if(!nsfw) {
            for(var i = rp.session.activeIndex + 1; i < rp.photos.length; i++) {
                if (!rp.photos[i].over18) {
                    return startAnimation(i);
                }
            }
        }
        if (isLastImage(rp.session.activeIndex) && !rp.session.loadingNextImages) {
            // the only reason we got here and there aren't more pictures yet
            // is because there are no more images to load, start over
            return startAnimation(0);
        }
        startAnimation(rp.session.activeIndex + 1);
    }
    function prevSlide() {
        if(!nsfw) {
            for(var i = rp.session.activeIndex - 1; i > 0; i--) {
                if (!rp.photos[i].over18) {
                    return startAnimation(i);
                }
            }
        }
        startAnimation(rp.session.activeIndex - 1);
    }

    
    var autoNextSlide = function () {
        if (rp.settings.shouldAutoNextSlide) {
            // startAnimation takes care of the setTimeout
            nextSlide();
        }
    };
    
    function open_in_background(selector){
        // as per https://developer.mozilla.org/en-US/docs/Web/API/event.initMouseEvent
        // works on latest chrome, safari and opera
        var link = $(selector)[0];
        
        // Simulating a ctrl key won't trigger a background tab on IE and Firefox ( https://bugzilla.mozilla.org/show_bug.cgi?id=812202 )
        // so we need to open a new window
        if ( navigator.userAgent.match(/msie/i) || navigator.userAgent.match(/trident/i)  || navigator.userAgent.match(/firefox/i) ){
            window.open(link.href,'_blank');
        } else {
            var mev = document.createEvent("MouseEvents");
            mev.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, true, false, false, true, 0, null);
            link.dispatchEvent(mev);
        }
    }

    $("#pictureSlider").touchwipe({
        // wipeLeft means the user moved his finger from right to left.
        wipeLeft: nextSlide,
        wipeRight: prevSlide,
        wipeUp: nextSlide,
        wipeDown: prevSlide,
        min_move_x: 20,
        min_move_y: 20,
        preventDefaultEvents: false
    });

    var OPENSTATE_ATTR = "data-openstate";
    $('.collapser').click(function () {
        var state = $(this).attr(OPENSTATE_ATTR);
        if (state == "open") {
            // close it
            $(this).text("+");
            // move to the left just enough so the collapser arrow is visible
            var arrowLeftPoint = $(this).position().left;
            $(this).parent().animate({
                left: "-" + arrowLeftPoint + "px"
            });
            $(this).attr(OPENSTATE_ATTR, "closed");
        } else {
            // open it
            $(this).text("-");
            $(this).parent().animate({
                left: "0px"
            });
            $(this).attr(OPENSTATE_ATTR, "open");
        }
    });

    // Arguments are image paths relative to the current page.
    var preLoadImages = function () {
        var args_len = arguments.length;
        for (var i = args_len; i--;) {
            var cacheImage = document.createElement('img');
            cacheImage.src = arguments[i];
            rp.cache.push(cacheImage);
        }
    };

    var setCookie = function (c_name, value) {
        Cookies.set(c_name, value, { expires: rp.settings.cookieDays });
    };

    
    var getCookie = function (c_name) {
        // undefined in case nothing found
        return Cookies.get(c_name);
    };

    var resetNextSlideTimer = function () {
        clearTimeout(rp.session.nextSlideTimeoutId);
        rp.session.nextSlideTimeoutId = setTimeout(autoNextSlide, rp.settings.timeToNextSlide);
    };

    shouldAutoNextSlideCookie = "shouldAutoNextSlideCookie";
    var updateAutoNext = function () {
        rp.settings.shouldAutoNextSlide = $("#autoNextSlide").is(':checked');
        setCookie(shouldAutoNextSlideCookie, rp.settings.shouldAutoNextSlide);
        resetNextSlideTimer();
    };

    var toggleFullScreen = function() {
        var elem = document.getElementById('page');
        if (document.fullscreenElement || // alternative standard method
            document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement) { // current working methods
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } else {
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
                elem.mozRequestFullScreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
            }
        }
    };

    nsfwCookie = "nsfwCookie";
    var updateNsfw = function () {
        nsfw = $("#nsfw").is(':checked');
        setCookie(nsfwCookie, nsfw);
    };

    var initState = function () {
        var nsfwByCookie = getCookie(nsfwCookie);
        if (nsfwByCookie === undefined) {
            nsfw = true;
        } else {
            nsfw = (nsfwByCookie === "true");
            $("#nsfw").prop("checked", nsfw);
        }
        $('#nsfw').change(updateNsfw);

        var autoByCookie = getCookie(shouldAutoNextSlideCookie);
        if (autoByCookie === undefined) {
            updateAutoNext();
        } else {
            rp.settings.shouldAutoNextSlide = (autoByCookie === "true");
            $("#autoNextSlide").prop("checked", rp.settings.shouldAutoNextSlide);
        }
        $('#autoNextSlide').change(updateAutoNext);

        var updateTimeToNextSlide = function () {
            var val = $('#timeToNextSlide').val();
            rp.settings.timeToNextSlide = parseFloat(val) * 1000;
            setCookie(timeToNextSlideCookie, val);
        };

        var timeToNextSlideCookie = "timeToNextSlideCookie";
        timeByCookie = getCookie(timeToNextSlideCookie);
        if (timeByCookie === undefined) {
            updateTimeToNextSlide();
        } else {
            rp.settings.timeToNextSlide = parseFloat(timeByCookie) * 1000;
            $('#timeToNextSlide').val(timeByCookie);
        }
        
        $('#fullScreenButton').click(toggleFullScreen);

        $('#timeToNextSlide').keyup(updateTimeToNextSlide);
        
        $('#prevButton').click(prevSlide);
        $('#nextButton').click(nextSlide);
    };

    var addNumberButton = function (numberButton) {
        var navboxUls = $(".navbox ul");
        var thisNavboxUl = navboxUls[navboxUls.length - 1];

        var newListItem = $("<li />").appendTo(thisNavboxUl);
        numberButton.appendTo(newListItem);

        // so li's have a space between them and can word-wrap in the box
        navboxUls.append(document.createTextNode(' '));
    };

    var addImageSlide = function (pic) {
        /*
        var pic = {
            "title": title,
            "url": url,
            "commentsLink": commentsLink,
            "over18": over18,
            "isVideo": video
        }
        */
        pic.isVideo = false;
        if (pic.url.indexOf('gfycat.com') >= 0){
            pic.isVideo = true;
        } else if (isImageExtension(pic.url)) {
            // simple image
        } else {
            var betterUrl = tryConvertUrl(pic.url);
            if(betterUrl !== '') {
                pic.url = betterUrl;
            } else {
                if (rp.settings.debug) {
                    log('failed: ' + pic.url);
                }
                return;
            }
        }

        rp.session.foundOneImage = true;
        
        preLoadImages(pic.url);
        rp.photos.push(pic);

        var i = rp.photos.length - 1;
        var numberButton = $("<a />").html(i + 1)
            .data("index", i)
            .attr("title", rp.photos[i].title)
            .attr("id", "numberButton" + (i + 1));
        if(pic.over18) {
            numberButton.addClass("over18");
        }
        numberButton.click(function () {
            showImage($(this));
        });
        numberButton.addClass("numberButton");
        addNumberButton(numberButton);
    };

    var arrow = {
        left: 37,
        up: 38,
        right: 39,
        down: 40
    };
    var ONE_KEY = 49;
    var NINE_KEY = 57;
    var SPACE = 32;
    var PAGEUP = 33;
    var PAGEDOWN = 34;
    var ENTER = 13;
    var A_KEY = 65;
    var C_KEY = 67;
    var F_KEY = 70;
    var I_KEY = 73;
    var R_KEY = 82;
    var T_KEY = 84;

    
    // Register keyboard events on the whole document
    $(document).keyup(function (e) {
        if(e.ctrlKey) {
            // ctrl key is pressed so we're most likely switching tabs or doing something
            // unrelated to redditp UI
            return;
        }

        //log(e.keyCode, e.which, e.charCode);

        // 37 - left
        // 38 - up
        // 39 - right
        // 40 - down
        // More info: http://stackoverflow.com/questions/302122/jquery-event-keypress-which-key-was-pressed
        // http://stackoverflow.com/questions/1402698/binding-arrow-keys-in-js-jquery
        var code = (e.keyCode ? e.keyCode : e.which);

        switch (code) {
            case C_KEY:
                $('#controlsDiv .collapser').click();
                break;
            case T_KEY:
                $('#titleDiv .collapser').click();
                break;
            case A_KEY:
                $("#autoNextSlide").prop("checked", !$("#autoNextSlide").is(':checked'));
                updateAutoNext();
                break;
            case I_KEY:
                open_in_background("#navboxLink");
                break;
            case R_KEY:
                open_in_background("#navboxCommentsLink");
                break;
            case F_KEY:
                toggleFullScreen();
                break;
            case PAGEUP:
            case arrow.left:
            case arrow.up:
                return prevSlide();
            case PAGEDOWN:
            case arrow.right:
            case arrow.down:
            case SPACE:
                return nextSlide();
        }
    });


    //
    // Shows an image and plays the animation
    //
    var showImage = function (docElem) {
        // Retrieve the index we need to use
        var imageIndex = docElem.data("index");

        startAnimation(imageIndex);
    };

    var isLastImage = function(imageIndex) {
        if(nsfw) {
            if(imageIndex == rp.photos.length - 1) {
                return true;
            } else {
                return false;
            }
        } else {
            // look for remaining sfw images
            for(var i = imageIndex + 1; i < rp.photos.length; i++) {
                if(!rp.photos[i].over18) {
                    return false;
                }
            }
            return true;
        }
    };
    //
    // Starts the animation, based on the image index
    //
    // Variable to store if the animation is playing or not
    var startAnimation = function (imageIndex) {
        resetNextSlideTimer();

        // If the same number has been chosen, or the index is outside the
        // rp.photos range, or we're already animating, do nothing
        if (rp.session.activeIndex == imageIndex || imageIndex > rp.photos.length - 1 || imageIndex < 0 || rp.session.isAnimating || rp.photos.length == 0) {
            return;
        }

        rp.session.isAnimating = true;
        animateNavigationBox(imageIndex);
        slideBackgroundPhoto(imageIndex);

        // Set the active index to the used image index
        rp.session.activeIndex = imageIndex;

        if (isLastImage(rp.session.activeIndex) && rp.subredditUrl.indexOf('/imgur') != 0) {
            getRedditImages();
        }
    };

    var toggleNumberButton = function (imageIndex, turnOn) {
        var numberButton = $('#numberButton' + (imageIndex + 1));
        if (turnOn) {
            numberButton.addClass('active');
        } else {
            numberButton.removeClass('active');
        }
    };

    //
    // Animate the navigation box
    //
    var animateNavigationBox = function (imageIndex) {
        var photo = rp.photos[imageIndex];
        var subreddit = '/r/' + photo.subreddit;

        $('#navboxTitle').html(photo.title);
        $('#navboxSubreddit').attr('href', rp.redditBaseUrl + subreddit).html(subreddit);
        $('#navboxLink').attr('href', photo.url).attr('title', photo.title);
        $('#navboxCommentsLink').attr('href', photo.commentsLink).attr('title', "Comments on reddit");

        toggleNumberButton(rp.session.activeIndex, false);
        toggleNumberButton(imageIndex, true);
    };

    //
    // Slides the background photos
    //
    var slideBackgroundPhoto = function (imageIndex) {

        // Retrieve the accompanying photo based on the index
        var photo = rp.photos[imageIndex];

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
            clearTimeout(rp.session.nextSlideTimeoutId);
            var gfyid = photo.url.substr(1 + photo.url.lastIndexOf('/'));
            if(gfyid.indexOf('#') != -1)
                gfyid = gfyid.substr(0, gfyid.indexOf('#'));
            divNode.html('<img class="gfyitem" data-id="'+gfyid+'" data-controls="false"/>');
        }

        //imgNode.appendTo(divNode);
        divNode.prependTo("#pictureSlider");

        $("#pictureSlider div").fadeIn(rp.settings.animationSpeed);
        if(photo.isVideo){
            gfyCollection.init();
            //ToDo: find a better solution!
            $(divNode).bind("DOMNodeInserted", function(e) {
                if(e.target.tagName.toLowerCase() == "video") {
                    var vid = $('.gfyitem > div').width('100%').height('100%');
                    vid.find('.gfyPreLoadCanvas').remove();
                    var v = vid.find('video').width('100%').height('100%');
                    vid.find('.gfyPreLoadCanvas').remove();
                    if (rp.settings.shouldAutoNextSlide)
                        v.removeAttr('loop');
                    v[0].onended = function (e) {
                        if (rp.settings.shouldAutoNextSlide)
                            nextSlide();
                    };
                }
            });
        }

        var oldDiv = $("#pictureSlider div:not(:first)");
        oldDiv.fadeOut(rp.settings.animationSpeed, function () {
            oldDiv.remove();
            rp.session.isAnimating = false;
        });
    };

    
    
    var verifyNsfwMakesSense = function() {
        // Cases when you forgot NSFW off but went to /r/nsfw
        // can cause strange bugs, let's help the user when over 80% of the
        // content is NSFW.
        var nsfwImages = 0;
        for(var i = 0; i < rp.photos.length; i++) {
            if(rp.photos[i].over18) {
                nsfwImages += 1;
            }
        }
        
        if(0.8 < nsfwImages * 1.0 / rp.photos.length) {
            nsfw = true;
            $("#nsfw").prop("checked", nsfw);
        }
    };
    
    
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
            return url.replace(/r\/[^ \/]+\/(\w+)/, '$1') + '.jpg';
        }

        return '';
    };
    var isImageExtension = function (url) {
        var dotLocation = url.lastIndexOf('.');
        if (dotLocation < 0) {
            log("skipped no dot: " + url);
            return false;
        }
        var extension = url.substring(dotLocation);

        if (rp.settings.goodExtensions.indexOf(extension) >= 0) {
            return true;
        } else {
            //log("skipped bad extension: " + url);
            return false;
        }
    };

    var decodeUrl = function (url) {
        return decodeURIComponent(url.replace(/\+/g, " "));
    };
    rp.getRestOfUrl = function () {
        // Separate to before the question mark and after
        // Detect predefined reddit url paths. If you modify this be sure to fix
        // .htaccess
        // This is a good idea so we can give a quick 404 page when appropriate.
        
        var regexS = "(/(?:(?:r/)|(?:imgur/a/)|(?:user/)|(?:domain/)|(?:search))[^&#?]*)[?]?(.*)";
        var regex = new RegExp(regexS);
        var results = regex.exec(window.location.href);
        //log(results);
        if (results === null) {
            return ["", ""];
        } else {
            return [results[1], decodeUrl(results[2])];
        }
    };

    var failCleanup = function() {
        if (rp.photos.length > 0) {
            // already loaded images, don't ruin the existing experience
            return;
        }
        
        // remove "loading" title
        $('#navboxTitle').text('');
        
        // display alternate recommendations
        $('#recommend').css({'display':'block'});
    };
    
    var getRedditImages = function () {
        //if (noMoreToLoad){
        //    log("No more images to load, will rotate to start.");
        //    return;
        //}

        rp.session.loadingNextImages = true;

        var jsonUrl = rp.redditBaseUrl + rp.subredditUrl + ".json?jsonp=?" + rp.session.after + "&" + getVars;
        log(jsonUrl);
        //log(jsonUrl);
        var failedAjax = function (data) {
            alert("Failed ajax, maybe a bad url? Sorry about that :(");
            failCleanup();
        };
        var handleData = function (data) {
            //redditData = data //global for debugging data
            // NOTE: if data.data.after is null then this causes us to start
            // from the top on the next getRedditImages which is fine.
            rp.session.after = "&after=" + data.data.after;

            if (data.data.children.length === 0) {
                alert("No data from this url :(");
                return;
            }

            $.each(data.data.children, function (i, item) {
                addImageSlide({
                    url: item.data.url,
                    title: item.data.title,
                    over18: item.data.over_18,
                    subreddit: item.data.subreddit,
                    commentsLink: rp.redditBaseUrl + item.data.permalink
                });
            });

            verifyNsfwMakesSense();
            
            if (!rp.session.foundOneImage) {
                // Note: the jsonp url may seem malformed but jquery fixes it.
                //log(jsonUrl);
                alert("Sorry, no displayable images found in that url :(");
            }

            // show the first image
            if (rp.session.activeIndex == -1) {
                startAnimation(0);
            }

            if (data.data.after == null) {
                log("No more pages to load from this subreddit, reloading the start");

                // Show the user we're starting from the top
                var numberButton = $("<span />").addClass("numberButton").text("-");
                addNumberButton(numberButton);
            }
            rp.session.loadingNextImages = false;
            
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
    };

    var getImgurAlbum = function (url) {
        var albumID = url.match(/.*\/(.+?$)/)[1];
        var jsonUrl = 'https://api.imgur.com/3/album/' + albumID;
        //log(jsonUrl);
        var failedAjax = function (data) {
            alert("Failed ajax, maybe a bad url? Sorry about that :(");
            failCleanup();
        };
        var handleData = function (data) {

            //log(data);

            if (data.data.images.length === 0) {
                alert("No data from this url :(");
                return;
            }

            $.each(data.data.images, function (i, item) {
                addImageSlide({
                    url: item.link,
                    title: item.title,
                    over18: item.nsfw,
                    commentsLink: ""
                });                
            });

            verifyNsfwMakesSense();

            if (!rp.session.foundOneImage) {
                log(jsonUrl);
                alert("Sorry, no displayable images found in that url :(");
            }

            // show the first image
            if (rp.session.activeIndex == -1) {
                startAnimation(0);
            }

            //log("No more pages to load from this subreddit, reloading the start");

            // Show the user we're starting from the top
            //var numberButton = $("<span />").addClass("numberButton").text("-");
            //addNumberButton(numberButton);

            rp.session.loadingNextImages = false;
        };

        $.ajax({
            url: jsonUrl,
            dataType: 'json',
            success: handleData,
            error: failedAjax,
            404: failedAjax,
            timeout: 5000,
            beforeSend : function(xhr) {
                xhr.setRequestHeader('Authorization',
                    'Client-ID ' + 'f2edd1ef8e66eaf');}
        });
    };

    var setupUrls = function() {
        rp.urlData = rp.getRestOfUrl();
        //log(rp.urlData)
        rp.subredditUrl = rp.urlData[0];
        getVars = rp.urlData[1];
        
        if (getVars.length > 0) {
            getVarsQuestionMark = "?" + getVars;
        } else {
            getVarsQuestionMark = "";
        }

        // Remove .compact as it interferes with .json (we got "/r/all/.compact.json" which doesn't work).
        rp.subredditUrl = rp.subredditUrl.replace(/.compact/, "");
        // Consolidate double slashes to avoid r/all/.compact/ -> r/all//
        rp.subredditUrl = rp.subredditUrl.replace(/\/{2,}/, "/");

        var subredditName;
        if (rp.subredditUrl === "") {
            rp.subredditUrl = "/";
            subredditName = "reddit.com" + getVarsQuestionMark;
            //var options = ["/r/aww/", "/r/earthporn/", "/r/foodporn", "/r/pics"];
            //rp.subredditUrl = options[Math.floor(Math.random() * options.length)];
        } else {
            subredditName = rp.subredditUrl + getVarsQuestionMark;
        }
        

        var visitSubredditUrl = rp.redditBaseUrl + rp.subredditUrl + getVarsQuestionMark;
        
        // truncate and display subreddit name in the control box
        var displayedSubredditName = subredditName;
        // empirically tested capsize, TODO: make css rules to verify this is enough.
        // it would make the "nsfw" checkbox be on its own line :(
        var capsize = 19;
        if(displayedSubredditName.length > capsize) {
            displayedSubredditName = displayedSubredditName.substr(0,capsize) + "&hellip;";
        }
        $('#subredditUrl').html("<a href='" + visitSubredditUrl + "'>" + displayedSubredditName + "</a>");

        document.title = "redditP - " + subredditName;
    };
    
    

    
    rp.redditBaseUrl = "http://www.reddit.com";
    if (location.protocol === 'https:') {
        // page is secure
        rp.redditBaseUrl = "https://www.reddit.com";
        // TODO: try "//" instead of specifying the protocol
    }

    var getVars;
    
    initState();
    setupUrls();

    // if ever found even 1 image, don't show the error
    rp.session.foundOneImage = false;

    if(rp.subredditUrl.indexOf('/imgur') == 0)
        getImgurAlbum(rp.subredditUrl);
    else
        getRedditImages();
});
