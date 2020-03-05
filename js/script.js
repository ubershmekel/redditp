/*
  You can save the HTML file and use it locally btw like so:
    file:///wherever/index.html?/r/aww

  Check out the source at:
  https://github.com/ubershmekel/redditp
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
    goodExtensions: ['.jpg', '.jpeg', '.gif', '.bmp', '.png'],
    nsfw: true,
    sound: false
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
rp.cache = {};

function reportError(errMessage) {
    if (window.errorHandler && window.errorHandler.report) {
        window.errorHandler.report(new Error(errMessage));
    } else {
        console.log('No error handler yet:' + errMessage);
    }
    toastr.error(errMessage + ', please alert ubershmekel on <a href="https://github.com/ubershmekel/redditp/issues">github</a>');
}


$(function () {

    var pictureSliderId = "#pictureSlider";

    $("#subredditUrl").text("Loading Reddit Slideshow");
    $("#navboxTitle").text("Loading Reddit Slideshow");

    /*var fadeoutWhenIdle = true;
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
    };*/
    // this fadeout was really inconvenient on mobile phones
    // and instead the minimize buttons should be used.
    //setupFadeoutOnIdle();

    var getNextSlideIndex = function (currentIndex) {
        if (!rp.settings.nsfw) {
            // Skip any nsfw if you should
            for (var i = currentIndex + 1; i < rp.photos.length; i++) {
                if (!rp.photos[i].over18) {
                    return i;
                }
            }
            return 0;
        }
        if (isLastImage(getNextSlideIndex) && !rp.session.loadingNextImages) {
            // The only reason we got here and there aren't more pictures yet
            // is because there are no more images to load, start over
            return 0;
        }
        // Just go to the next slide, this should be the common case
        return currentIndex + 1;
    };

    function nextSlide() {
        var next = getNextSlideIndex(rp.session.activeIndex);
        startAnimation(next);
    }

    function prevSlide() {
        if (!rp.settings.nsfw) {
            for (var i = rp.session.activeIndex - 1; i > 0; i--) {
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

    function open_in_background(selector) {
        // as per https://developer.mozilla.org/en-US/docs/Web/API/event.initMouseEvent
        // works on latest chrome, safari and opera
        var link = $(selector)[0];

        // Simulating a ctrl key won't trigger a background tab on IE and Firefox ( https://bugzilla.mozilla.org/show_bug.cgi?id=812202 )
        // so we need to open a new window
        if (navigator.userAgent.match(/msie/i) || navigator.userAgent.match(/trident/i) || navigator.userAgent.match(/firefox/i)) {
            window.open(link.href, '_blank');
        } else {
            var mev = document.createEvent("MouseEvents");
            mev.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, true, false, false, true, 0, null);
            link.dispatchEvent(mev);
        }
    }

    $(pictureSliderId).touchwipe({
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
        if (state === "open") {
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
            // Chrome makes the web request without keeping a copy of the image.
            //rp.cache.push(cacheImage);
        }
    };

    var cookieNames = {
        nsfwCookie: "nsfwCookie",
        shouldAutoNextSlideCookie: "shouldAutoNextSlideCookie",
        timeToNextSlideCookie: "timeToNextSlideCookie",
        soundCookie: "soundCookie"
    };

    var setCookie = function (c_name, value) {
        Cookies.set(c_name, value, {expires: rp.settings.cookieDays});
    };


    var getCookie = function (c_name) {
        // undefined in case nothing found
        return Cookies.get(c_name);
    };

    var updateSound = function () {
        rp.settings.sound = $('#sound').is(':checked');
        setCookie(cookieNames.soundCookie, rp.settings.sound);
        var videoTags = document.getElementsByTagName('video');
        if (videoTags.length === 1) {
            videoTags[0].muted = !rp.settings.sound;
        }
        var audioTags = document.getElementsByTagName('audio');
        if (audioTags.length === 1) {
            audioTags[0].muted = !rp.settings.sound;
        } else {
            console.log(audioTags);
        }
    };

    var resetNextSlideTimer = function () {
        clearTimeout(rp.session.nextSlideTimeoutId);
        rp.session.nextSlideTimeoutId = setTimeout(autoNextSlide, rp.settings.timeToNextSlide);
    };

    var updateAutoNext = function () {
        rp.settings.shouldAutoNextSlide = $("#autoNextSlide").is(':checked');
        setCookie(cookieNames.shouldAutoNextSlideCookie, rp.settings.shouldAutoNextSlide);
        resetNextSlideTimer();
    };

    var toggleSound = function() {
        $("#sound").each(function(){
            this.checked = !this.checked;
            console.log(this.checked);
            $(this).trigger('change');
        });
    };

    var toggleFullScreen = function () {
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
                elem.webkitRequestFullscreen();
            }
        }
    };

    var updateNsfw = function () {
        rp.settings.nsfw = $("#nsfw").is(':checked');
        setCookie(cookieNames.nsfwCookie, rp.settings.nsfw);
    };

    var initState = function () {
        var nsfwByCookie = getCookie(cookieNames.nsfwCookie);
        if (nsfwByCookie === undefined) {
            rp.settings.nsfw = true;
        } else {
            rp.settings.nsfw = (nsfwByCookie === "true");
            $("#nsfw").prop("checked", rp.settings.nsfw);
        }
        $('#nsfw').change(updateNsfw);

        // Fix sound cookie
        var soundByCookie = getCookie(cookieNames.soundCookie);
        if (soundByCookie === undefined) {
            rp.settings.sound = false;
        } else {
            rp.settings.sound = (soundByCookie === "true");
            $("#sound").prop("checked", rp.settings.sound);
        }
        $('#sound').change(updateSound);

        var autoByCookie = getCookie(cookieNames.shouldAutoNextSlideCookie);
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
            setCookie(cookieNames.timeToNextSlideCookie, val);
        };

        var timeByCookie = getCookie(cookieNames.timeToNextSlideCookie);
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


    var imageTypes = {
        image: 'image',
        gfycat: 'gfycat',
        gifv: 'gifv'
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
        pic.type = imageTypes.image;
        // Replace HTTP with HTTPS on gfycat and imgur to avoid this:
        //      Mixed Content: The page at 'https://redditp.com/r/gifs' was loaded over HTTPS, but requested an insecure video 'http://i.imgur.com/LzsnbNU.webm'. This content should also be served over HTTPS.
        var http_prefix = 'http://';
        var https_prefix = 'https://';
        if (pic.url.indexOf('gfycat.com') >= 0) {
            pic.type = imageTypes.gfycat;
            pic.url = pic.url.replace(http_prefix, https_prefix);
        } else if (pic.url.indexOf('//v.redd.it/') >= 0) {
            // NOTE DO NOT ADD DOMAINS HERE - MODIFY EMBEDIT.JS instead
            // NOTE DO NOT ADD DOMAINS HERE - MODIFY EMBEDIT.JS instead
            // NOTE DO NOT ADD DOMAINS HERE - MODIFY EMBEDIT.JS instead
            // Sadly, we have to add domains here or they get dropped in the "cannot display url" error below.
            // Need to redesign this redditp thing.
            if (pic.data.media) {
                pic.type = imageTypes.gifv;
                pic.url = pic.data.media.reddit_video.fallback_url;
            } else if (pic.data.crosspost_parent_list && pic.data.crosspost_parent_list[0].media) {
                pic.type = imageTypes.gifv;
                pic.url = pic.data.crosspost_parent_list[0].media.reddit_video.fallback_url;
            } else {
                // some crossposts don't have a pic.data.media obj?
                return;
            }
            pic.sound = pic.url.substring(0, pic.url.lastIndexOf('/')) + "/audio";
        } else if (pic.url.search(/^http.*imgur.*gifv?$/) > -1) {
            pic.type = imageTypes.gifv;
            pic.url = pic.url.replace(http_prefix, https_prefix);
        } else if (isImageExtension(pic.url)) {
            // simple image
        } else {
            var betterUrl = tryConvertUrl(pic.url);
            if (betterUrl !== '') {
                pic.url = betterUrl;
            } else {
                if (rp.settings.debug) {
                    console.log('cannot display url as image: ' + pic.url);
                }
                return;
            }
        }

        rp.session.foundOneImage = true;

        for (i = 0; i < rp.photos.length; i += 1) {
            if (pic.url === rp.photos[i].url) {
                return;
            }
        }


        // Do not preload all images, this is just not performant.
        // Especially in gif or high-res subreddits where each image can be 50 MB.
        // My high-end desktop browser was unresponsive at times.
        //preLoadImages(pic.url);
        rp.photos.push(pic);

        var i = rp.photos.length - 1;
        var numberButton = $("<a />").html(i + 1)
            .data("index", i)
            .attr("title", rp.photos[i].title)
            .attr("id", "numberButton" + (i + 1));
        if (pic.over18) {
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
    //var ONE_KEY = 49;
    //var NINE_KEY = 57;
    var SPACE = 32;
    var PAGEUP = 33;
    var PAGEDOWN = 34;
    //var ENTER = 13;
    var A_KEY = 65;
    var C_KEY = 67;
    var M_KEY = 77;
    var F_KEY = 70;
    var I_KEY = 73;
    var R_KEY = 82;
    var T_KEY = 84;


    // Register keyboard events on the whole document
    $(document).keyup(function (e) {
        if (e.ctrlKey) {
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
                var $ans = $("#autoNextSlide");
                $ans.prop("checked", !$ans.is(':checked'));
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
            case M_KEY:
                toggleSound();
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

    var isLastImage = function (imageIndex) {
        if (rp.settings.nsfw) {
            return imageIndex === rp.photos.length - 1;
        } else {
            // look for remaining sfw images
            for (var i = imageIndex + 1; i < rp.photos.length; i++) {
                if (!rp.photos[i].over18) {
                    return false;
                }
            }
            return true;
        }
    };

    var preloadNextImage = function (imageIndex) {
        var next = getNextSlideIndex(imageIndex);
        // Always clear cache - no need for memory bloat.
        // We only keep the next image preloaded.
        rp.cache = {};
        if (next < rp.photos.length)
            rp.cache[next] = createDiv(next);
    };

    //
    // Starts the animation, based on the image index
    //
    // Variable to store if the animation is playing or not
    var startAnimation = function (imageIndex) {
        resetNextSlideTimer();

        // If the same number has been chosen, or the index is outside the
        // rp.photos range, or we're already animating, do nothing
        if (rp.session.activeIndex === imageIndex || imageIndex > rp.photos.length - 1 || imageIndex < 0 || rp.session.isAnimating || rp.photos.length === 0) {
            return;
        }

        rp.session.isAnimating = true;
        animateNavigationBox(imageIndex);
        slideBackgroundPhoto(imageIndex);
        preloadNextImage(imageIndex);

        // Set the active index to the used image index
        rp.session.activeIndex = imageIndex;

        if (isLastImage(rp.session.activeIndex) && rp.subredditUrl.indexOf('/imgur') !== 0) {
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

        document.title = photo.title + " - " + subreddit + " - redditP";

        toggleNumberButton(rp.session.activeIndex, false);
        toggleNumberButton(imageIndex, true);
    };

    var playButton = $('<img id="playButton" src="/images/play.svg" />');
    playButton.click(function () {
        if ($('video')[0]) {
            $('video')[0].play();
        } else {
            // serious bug, why did we show the play button but have no video there?
            reportError('Play button pressed but no video there');
        }
        playButton.hide();
    });
    $(pictureSliderId).append(playButton);
    playButton.hide();

    var startPlayingVideo = function (vid_jq) {
        // Loop or auto next slide
        // TODO: make this update every time you check/uncheck auto-play
        if (rp.settings.shouldAutoNextSlide) {
            clearTimeout(rp.session.nextSlideTimeoutId);
            vid_jq.removeAttr('loop');
        }

        // sound cookie setting
        vid_jq[0].muted = !rp.settings.sound;

        var onEndFunc = function (/*e*/) {
            if (rp.settings.shouldAutoNextSlide)
                nextSlide();
        };
        vid_jq.one('ended', onEndFunc);
        // Tested on Firefox 43, gfycats that were preloaded do not autoplay when shown so
        // this is the workaround. We also prefer the play to start after the fadein finishes.
        var playPromise = vid_jq[0].play();
        if (playPromise && playPromise.catch) {
            // playPromise is `undefined` in firefox 46-48 it seems
            playPromise.catch(function (e) {
                // a trick to get around: DOMException: play() can only be initiated by a user gesture.
                // We show a play button that the user can press
                if (e.name === "NotAllowedError") {
                    //code: 0
                    //message: "play() can only be initiated by a user gesture."
                    //name: "NotAllowedError"
                    playButton.show();
                    //setTimeout(function() {vid_jq[0].play();}, 100);
                } else {
                    // AbortError can happen I think with e.g. a 404, user clicking next before loading finishes,
                    // In that case, we don't want the play button to show. Here is a recorded example from 
                    // https://redditp.com/r/eyebleach/top?t=month
                    //code: 20,
                    //message: "The play() request was interrupted by a call to pause().",
                    //name: "AbortError",
                }
                console.log(e);
            });
        }
    };

    //
    // Slides the background photos
    //
    var slideBackgroundPhoto = function (imageIndex) {
        var divNode;
        if (rp.cache[imageIndex] === undefined) {
            divNode = createDiv(imageIndex);
        } else {
            divNode = rp.cache[imageIndex];
        }

        divNode.prependTo(pictureSliderId);
        $(pictureSliderId + " div").fadeIn(rp.settings.animationSpeed);
        var oldDiv = $(pictureSliderId + " div:not(:first)");
        oldDiv.fadeOut(rp.settings.animationSpeed, function () {
            oldDiv.remove();
            rp.session.isAnimating = false;

            var maybeVid = $('video');
            if (maybeVid.length > 0) {
                startPlayingVideo(maybeVid);
            }
        });
    };

    var createDiv = function (imageIndex) {
        // Retrieve the accompanying photo based on the index
        var photo = rp.photos[imageIndex];
        //log("Creating div for " + imageIndex + " - " + photo.url);

        // Create a new div and apply the CSS
        var divNode = $("<div />");
        if (photo.type === imageTypes.image) {

            // TODO: REFACTOR BOTH IMAGES AND VIDEOS TO WORK WITH ONE FRAMEWORK - EMBEDIT

            // An actual image. Not a video/gif.
            // `preLoadImages` because making a div with a background css does not cause chrome
            // to preload it :/
            preLoadImages(photo.url);
            var cssMap = Object();
            cssMap['display'] = "none";
            cssMap['background-image'] = "url(" + photo.url + ")";
            cssMap['background-repeat'] = "no-repeat";
            cssMap['background-size'] = "contain";
            cssMap['background-position'] = "center";

            divNode.css(cssMap).addClass("clouds");

        } else { //if(photo.type === imageTypes.gfycat || photo.type === imageTypes.gifv) {
            embedit.embed(photo.url, function (elem) {
                if (!elem) {
                    reportError('Failed to handle url');
                    return divNode;
                }
                divNode.append(elem);
                $(elem).attr({
                    playsinline: '',
                });
                if (photo.sound) {
                    // this case is for videos from v.redd.it domain only
                    $("<audio autoplay " + (rp.settings.sound ? '' : 'muted') + "><source src='" + photo.sound + "' type='audio/aac'/></audio>").appendTo($(elem));

                    var $audioTag = $("audio", elem).get(0);
                    var $videoTag = $("video", divNode).get(0);

                    // sync reddit audio and video tracks
                    $audioTag.currentTime = $videoTag.currentTime;
                    $videoTag.onplay = function () {
                        $audioTag.play();
                    };
                    $videoTag.onpause = function () {
                        $audioTag.pause();
                    };
                }
                elem.width('100%').height('100%');
                // We start paused and play after the fade in.
                // This is to avoid cached or preloaded videos from playing.
                elem[0].pause();
            });
        }// else {
        //    reportError('Unhandled image type');
        //}

        return divNode;
    };


    var verifyNsfwMakesSense = function () {
        // Cases when you forgot NSFW off but went to /r/nsfw
        // can cause strange bugs, let's help the user when over 80% of the
        // content is NSFW.
        var nsfwImages = 0;
        for (var i = 0; i < rp.photos.length; i++) {
            if (rp.photos[i].over18) {
                nsfwImages += 1;
            }
        }

        if (0.8 < nsfwImages * 1.0 / rp.photos.length) {
            rp.settings.nsfw = true;
            $("#nsfw").prop("checked", rp.settings.nsfw);
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
            return url.replace(/r\/[^ /]+\/(\w+)/, '$1') + '.jpg';
        }

        return '';
    };
    var isImageExtension = function (url) {
        var dotLocation = url.lastIndexOf('.');
        if (dotLocation < 0) {
            console.log("skipped no dot: " + url);
            return false;
        }
        var extension = url.substring(dotLocation);

        return rp.settings.goodExtensions.indexOf(extension) >= 0;
    };

    var decodeUrl = function (url) {
        return decodeURIComponent(url.replace(/\+/g, " "));
    };
    rp.getRestOfUrl = function () {
        // Separate to before the question mark and after
        // Detect predefined reddit url paths. If you modify this be sure to fix
        // .htaccess
        // This is a good idea so we can give a quick 404 page when appropriate.

        var regexS = "(/(?:(?:r/)|(?:imgur/a/)|(?:u(?:ser)?/)|(?:domain/)|(?:search))[^&#?]*)[?]?(.*)";
        var regex = new RegExp(regexS);
        var results = regex.exec(window.location.href);
        //log(results);
        if (results === null) {
            return ["", ""];
        } else {
            return [results[1], decodeUrl(results[2])];
        }
    };

    var failCleanup = function () {
        if (rp.photos.length > 0) {
            // already loaded images, don't ruin the existing experience
            return;
        }

        // remove "loading" title
        $('#navboxTitle').text('');

        // display alternate recommendations
        $('#recommend').css({'display': 'block'});
    };

    var parseQuery = function (queryString) {
        var query = {};
        var pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split('=');
            query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
        }
        return query;
    };

    var shuffle = function (arr) {
        var j, x, i;
        for (i = arr.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            x = arr[i];
            arr[i] = arr[j];
            arr[j] = x;
        }
        return arr;
    };

    var isShuffleOn = function () {
        var query = parseQuery(window.location.search);
        return !!query.shuffle;
    };

    var startShow = function () {
        startAnimation(0);
    };

    var getStackTrace = function () {
        var err = new Error();
        return err.stack;
    };

    var getRedditImages = function () {
        //if (noMoreToLoad){
        //    log("No more images to load, will rotate to start.");
        //    return;
        //}

        rp.session.loadingNextImages = true;

        // Note that JSONP requests require `".json?jsonp=?"` here.
        var jsonUrl = rp.redditBaseUrl + rp.subredditUrl + ".json?" + (rp.session.after ? rp.session.after + "&" : "") + getVars;

        var failedAjax = function (/*data*/) {
            var message = "Failed ajax, maybe a bad url? Sorry about that :(";
            var isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
            if (isFirefox) {
                message = "Failed ajax, Firefox try to disable tracking protection from the shield in the URL bar";
            }
            reportError(message);
            failCleanup();
        };

        var handleData = function (data) {
            // handle single page json
            if (data && data.length === 2 && data[0].data.children.length === 1) {
                // this means we're in single post link
                // response consists of two json objects, one for post, one for comments
                data = data[0];
                rp.session.loadingNextImages = false;
            }

            //redditData = data //global for debugging data
            // NOTE: if data.data.after is null then this causes us to start
            // from the top on the next getRedditImages which is fine.
            if (data && data.data && data.data.after) {
                rp.session.after = "&after=" + data.data.after;
            }

            var children = [];
            if (data && data.data && data.data.children) {
                children = data.data.children;
            } else {
                // comments of e.g. a photoshopbattles post
                //children = rp.flattenRedditData(data);
                //throw new Error("Comments pages not yet supported");
            }

            if (children.length === 0) {
                children = data;
            }

            if (children.length === 0) {
                reportError("No data from this url :(");
                return;
            }

            if (isShuffleOn()) {
                shuffle(children)
            }

            $.each(children, function (i, item) {
                // `item.data.link_url` seems to be an item for reddit images
                // or maybe the api change for user pages?
                // First saw it at `https://redditp.com/u/doherty99` in the permalink:
                // "https://www.reddit.com/r/gonewild/comments/7h7srj/pull_my_hair_and_fuck_me_from_behind/"
                if (!item || !item.data) {
                    reportError('invald data item');
                    return;
                }
                addImageSlide({
                    url: item.data.url || item.data.link_url,
                    title: item.data.title || item.data.link_title,
                    over18: item.data.over_18,
                    subreddit: item.data.subreddit,
                    commentsLink: rp.redditBaseUrl + item.data.permalink,
                    data: item.data,
                });
            });

            verifyNsfwMakesSense();

            if (!rp.session.foundOneImage) {
                // Note: the jsonp url may seem malformed but jquery fixes it.
                //log(jsonUrl);
                reportError("Sorry, no displayable images found in that url :(");
            }

            // show the first image
            if (rp.session.activeIndex === -1) {
                startShow();
            }

            if (data.data.after == null) {
                console.log("No more pages to load from this subreddit, reloading the start");

                // Show the user we're starting from the top
                var numberButton = $("<span />").addClass("numberButton").text("-");
                addNumberButton(numberButton);
            }
            rp.session.loadingNextImages = false;

        };

        if (rp.settings.debug)
            console.log('Ajax requesting: ' + jsonUrl);

        // Note we're still using `jsonp` despite potential issues because
        // `http://www.redditp.com/r/randnsfw` wasn't working with CORS for some reason.
        // https://github.com/ubershmekel/redditp/issues/104
        // TODO: Fix the loading of the next set of items from /r/random and /r/randnsfw using
        // the currently loaded subreedit. Currently it just fails because the `&after=`
        // doesn't work with /r/random.
        var useJsonP = jsonUrl.indexOf('\/comments\/') !== -1
            || jsonUrl.indexOf('\/r\/randnsfw') !== -1
            || jsonUrl.indexOf('\/r\/random') !== -1;
        if (useJsonP) {
            jsonUrl += '&jsonp=?';
        }

        // I still haven't been able to catch jsonp 404 events so the timeout
        // is the current solution sadly.
        $.ajax({
            url: jsonUrl,
            dataType: useJsonP ? 'jsonp' : 'json',
            jsonp: useJsonP,
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
        var failedAjax = function (/*data*/) {
            reportError("Failed ajax, maybe a bad url? Sorry about that :(");
            failCleanup();
        };
        var handleData = function (data) {

            //log(data);

            var children = data.data.images;
            if (children.length === 0) {
                reportError("No data from this url :(");
                return;
            }

            if (isShuffleOn()) {
                shuffle(children)
            }

            $.each(children, function (i, item) {
                addImageSlide({
                    url: item.link,
                    title: item.title,
                    over18: item.nsfw,
                    commentsLink: ""
                });
            });

            verifyNsfwMakesSense();

            if (!rp.session.foundOneImage) {
                console.log(jsonUrl);
                reportError("Sorry, no displayable images found in that url :(");
            }

            // show the first image
            if (rp.session.activeIndex === -1) {
                startShow();
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
            beforeSend: function (xhr) {
                xhr.setRequestHeader('Authorization',
                    'Client-ID ' + 'f2edd1ef8e66eaf');
            }
        });
    };

    var setupUrls = function () {
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
        if (displayedSubredditName.length > capsize) {
            displayedSubredditName = displayedSubredditName.substr(0, capsize) + "&hellip;";
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
    var getVarsQuestionMark;

    initState();
    setupUrls();

    // if ever found even 1 image, don't show the error
    rp.session.foundOneImage = false;

    if (rp.subredditUrl.indexOf('/imgur') === 0) {
        getImgurAlbum(rp.subredditUrl);
    } else {
        getRedditImages();
    }
});

/*rp.flattenRedditData = function(data) {
    // Parse comments, get all links
    // https://www.reddit.com/r/photoshopbattles/comments/7i5ipw/psbattle_this_hyped_up_mannequin/.json?jsonp=?&

    var queue = [];
    var urls = [];
    if (data && data.data && data.data.children) {
        children = data.data.children;
    } else {
        // comments of e.g. a photoshopbattles post
        if (data.length > 0) {
            for (var i = 0; i < data.length; i++) {
                children = flattenRedditData(data[i]);
                Array.prototype.push.apply(children, newChildren);
            }
        }
    }

    var urlChildren = [];
    for (var i = 0; i < children.length; i++) {
        var item = children[i];
        if (item.data && (item.data.url || item.data.link_url)) {
            // great
            urlChildren.push(item);
            continue;
        }

        // keep digging for more urls, remove this one
        if (item.data) {
            var newChildren = rp.flattenRedditData(item.data.replies);
            Array.prototype.push.apply(urlChildren, newChildren);
            var newChildren = flattenRedditData(item.data.children);
            Array.prototype.push.apply(urlChildren, newChildren);
            if (item.data.body) {
                // this is a comment
                console.log('body', item.body);
            }
            continue;
        }
    }

    return urls;
}*/


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

browserNodeExport(rp, 'rp');
