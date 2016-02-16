/* -*- mode: javascript; indent-tabs-mode: nil -*-
  Author: Yuval Greenfield (http://uberpython.wordpress.com) 
 
  You can save the HTML file and use it locally btw like so:
    file:///wherever/index.html?/r/aww
 
  Favicon by Double-J designs http://www.iconfinder.com/icondetails/68600/64/_icon
  HTML based on http://demo.marcofolio.net/fullscreen_image_slider/
  Author of slideshow base :      Marco Kuiper (http://www.marcofolio.net/)
*/

// TODO: refactor all the globals to use the rp object's namespace.
var rp = {};
rp.debug = true;

// Speed of the animation
var animationSpeed = 1000;
var shouldAutoNextSlide = true;
var timeToNextSlide = 6;
var cookieDays = 300;

// Sites that can be enabled when they turn on CORS or support jsonp
rp.use = { eroshare: false, };

rp.api_key = {tumblr: 'sVRWGhAGTVlP042sOgkZ0oaznmUOzD8BRiRwAm5ELlzEaz4kwU',
              imgur:  'f2edd1ef8e66eaf', };

// Variable to store the images we need to set as background
// which also includes some text and url's.
rp.photos = [];

// 0-based index to set which picture to show first
// init to -1 until the first image is loaded
var activeIndex = -1;


// IE doesn't have indexOf, wtf...
if (!Array.indexOf) {
    Array.prototype.indexOf = function (obj) {
        for (var i = 0; i < this.length; i++) {
            if (this[i] == obj) {
                return i;
            }
        }
        return -1;
    };
}

// IE doesn't have console.log and fails, wtf...
// usage: log('inside coolFunc',this,arguments);
// http://paulirish.com/2009/log-a-lightweight-wrapper-for-consolelog/
window.log = function () {
    log.history = log.history || []; // store logs to an array for reference
    log.history.push(arguments);
    if (this.console) {
        console.log(Array.prototype.slice.call(arguments));
    }
};

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

    var nextSlideTimeoutId = null;

    var loadingNextImages = false;

    function nextSlide() {
        if(!nsfw) {
            for(var i = activeIndex + 1; i < rp.photos.length; i++) {
                if (!rp.photos[i].over18) {
                    return startAnimation(i);
                }
            }
        }
        if (isLastImage(activeIndex) && !loadingNextImages) {
            // the only reason we got here and there aren't more pictures yet
            // is because there are no more images to load, start over
            return startAnimation(0);
        }
        startAnimation(activeIndex + 1);
    }
    function prevSlide() {
        if(!nsfw) {
            for(var i = activeIndex - 1; i > 0; i--) {
                if (!rp.photos[i].over18) {
                    return startAnimation(i);
                }
            }
        }
        startAnimation(activeIndex - 1);
    }


    var autoNextSlide = function () {
        if (shouldAutoNextSlide) {
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

    var hostnameOf = function(url) {
        return $('<a>').prop('href', url).prop('hostname');
    }
    var pathnameOf = function(url) {
        return $('<a>').prop('href', url).prop('pathname');
    }

    $("#pictureSlider").touchwipe({
        // wipeLeft means the user moved his finger from right to left.
        wipeLeft: function () {
            nextSlide();
        },
        wipeRight: function () {
            prevSlide();
        },
        wipeUp: function () {
            nextSlide();
        },
        wipeDown: function () {
            prevSlide();
        },
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

    // maybe checkout http://engineeredweb.com/blog/09/12/preloading-images-jquery-and-javascript/ for implementing the old precache
    var cache = [];
    // Arguments are image paths relative to the current page.
    var preLoadImages = function () {
        var args_len = arguments.length;
        for (var i = args_len; i--;) {
            var cacheImage = document.createElement('img');
            cacheImage.src = arguments[i];
            cache.push(cacheImage);
        }
    };

    var setCookie = function (c_name, value, exdays) {
        var exdate = new Date();
        exdate.setDate(exdate.getDate() + exdays);
        var c_value = escape(value) + ((exdays === null) ? "" : "; expires=" + exdate.toUTCString());
        document.cookie = c_name + "=" + c_value;
    };

    var getCookie = function (c_name) {
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
    };

    var resetNextSlideTimer = function (timeout) {
        if (timeout === undefined) {
            timeout = timeToNextSlide;
        }
        timeout *= 1000;
        if (rp.debug) {
            console.log('set timeout (ms): ' + timeout);
        }
        clearTimeout(nextSlideTimeoutId);
        nextSlideTimeoutId = setTimeout(autoNextSlide, timeout);
    };

    shouldAutoNextSlideCookie = "shouldAutoNextSlideCookie";
    var updateAutoNext = function () {
        shouldAutoNextSlide = $("#autoNextSlide").is(':checked');
        if (shouldAutoNextSlide)
            $('#controlsDiv .collapser').css({color: 'red'});
        else
            $('#controlsDiv .collapser').css({color: ""});
        setCookie(shouldAutoNextSlideCookie, shouldAutoNextSlide, cookieDays);
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

    var isVideoMuted = function() {
        return $("#mute").is(':checked');
    }

    var updateVideoMute = function() {
        var vid = $('#gfyvid');
        var videoMuted = isVideoMuted();
        if (vid !== undefined)
            if (videoMuted)
                vid.prop('muted', true);
            else
                vid.prop('muted', false);
    };

    nsfwCookie = "nsfwCookie";
    var updateNsfw = function () {
        nsfw = $("#nsfw").is(':checked');
        setCookie(nsfwCookie, nsfw, cookieDays);
    };

    var initState = function () {
        var nsfwByCookie = getCookie(nsfwCookie);
        if (nsfwByCookie == undefined) {
            nsfw = true;
        } else {
            nsfw = (nsfwByCookie === "true");
            $("#nsfw").prop("checked", nsfw);
        }
        $('#nsfw').change(updateNsfw);

        updateVideoMute();
        $('#mute').change(updateVideoMute);

        var autoByCookie = getCookie(shouldAutoNextSlideCookie);
        if (autoByCookie !== undefined) {
            shouldAutoNextSlide = (autoByCookie === "true");
            $("#autoNextSlide").prop("checked", shouldAutoNextSlide);
        }
        updateAutoNext();
        $('#autoNextSlide').change(updateAutoNext);

        var updateTimeToNextSlide = function () {
            var val = $('#timeToNextSlide').val();
            timeToNextSlide = parseFloat(val);
            setCookie(timeToNextSlideCookie, val, cookieDays);
        };

        var timeToNextSlideCookie = "timeToNextSlideCookie";
        timeByCookie = getCookie(timeToNextSlideCookie);
        if (timeByCookie == undefined) {
            updateTimeToNextSlide();
        } else {
            timeToNextSlide = parseFloat(timeByCookie);
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
            "isVideo": video,
            subreddit: optional,
            author: optional,
            extra: optional,
        }
        */
        pic.isVideo = false;
        hostname = hostnameOf(pic.url);

        if (isImageExtension(pic.url)) {
            // simple image
        } else if (isVideoExtension(pic.url) ||
                   hostname.indexOf('gfycat.com') >= 0 ||
                   hostname.indexOf('streamable.com') >= 0 ||
                   hostname.indexOf('vid.me') >= 0 ||
                   hostname.indexOf('tumblr.com') >= 0 ||
                   (hostname.indexOf('eroshare.com') >= 0 && rp.use.eroshare) ||
                   pic.url.indexOf('webm.land/w/') >= 0
                   ) {
            pic.isVideo = true;

        } else {
            var betterUrl = tryConvertPic(pic);
            if(betterUrl !== '') {
                pic.url = betterUrl;
            } else {
                if (rp.debug) {
                    console.log('failed: ' + pic.url);
                }
                return;
            }
        }

        rp.foundOneImage = true;

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
                // Retrieve the index we need to use
                var imageIndex = $(this).data("index");

                startAnimation(imageIndex);
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
    var M_KEY = 77;
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
            case SPACE:
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
            case M_KEY:
                $('#mute').click();
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
                return nextSlide();
        }
    });

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
    var isAnimating = false;
    var startAnimation = function (imageIndex) {
        resetNextSlideTimer();

        // If the same number has been chosen, or the index is outside the
        // rp.photos range, or we're already animating, do nothing
        if (activeIndex == imageIndex || imageIndex > rp.photos.length - 1 || imageIndex < 0 || isAnimating || rp.photos.length == 0) {
            return;
        }

        isAnimating = true;
        animateNavigationBox(imageIndex);
        slideBackgroundPhoto(imageIndex);

        // Set the active index to the used image index
        activeIndex = imageIndex;

        if (isLastImage(activeIndex) && rp.subredditUrl.indexOf('/imgur') != 0) {
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
        var author = '/u/' + photo.author;

        $('#navboxTitle').html(photo.title);
        if (photo.subreddit !== undefined && photo.subreddit !== null) {
            $('#navboxSubreddit').attr('href', rp.redditBaseUrl + subreddit).html(subreddit);
            $('#navboxSubredditP').attr('href', subreddit).text('[P]');
        }
        if (photo.author !== undefined) {
            $('#navboxAuthor').attr('href', rp.redditBaseUrl + author).html(author);
            $('#navboxAuthorP').attr('href', '/user/'+photo.author+'/submitted').text('[P]');
        }
        $('#navboxExtra').html((photo.extra !== undefined) ?photo.extra :"");
        $('#navboxLink').attr('href', photo.url).attr('title', photo.title);
        $('#navboxCommentsLink').attr('href', photo.commentsLink).attr('title', "Comments on reddit");

        toggleNumberButton(activeIndex, false);
        toggleNumberButton(imageIndex, true);
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

    var failedAjax = function (xhr, ajaxOptions, thrownError) {
        console.log(xhr);
        console.log(ajaxOptions);
        console.log(thrownError);
        alert("Failed ajax, maybe a bad url? Sorry about that :(\n" + xhr.responseText + "\n");
        failCleanup();
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

        var showImage = function(url) {
            cssMap['background-image'] = "url(" + url + ")";
            cssMap['background-repeat'] = "no-repeat";
            cssMap['background-size'] = "contain";
            cssMap['background-position'] = "center";

            var divNode = $("<div />").css(cssMap).addClass("clouds");

            divNode.prependTo("#pictureSlider");
            $("#pictureSlider div").fadeIn(animationSpeed);

            var oldDiv = $("#pictureSlider div:not(:first)");
            oldDiv.fadeOut(animationSpeed, function () {
                    oldDiv.remove();
                    isAnimating = false;
                });
        }

        if (!photo.isVideo) {
            showImage(photo.url);
            return
        }

        clearTimeout(nextSlideTimeoutId);

        var shortid;

        // chomp off last char if it ends in '/'
        if (photo.url.charAt(photo.url.length-1) == '/') {
            surl = photo.url.substr(0, photo.url.length-1);
            shortid = surl.substr(1 + surl.lastIndexOf('/'));

        } else
            shortid = photo.url.substr(1 + photo.url.lastIndexOf('/'));

        if (shortid.indexOf('#') != -1)
            shortid = shortid.substr(0, shortid.indexOf('#'));

        // Called with showVideo({'thumbnail': jpgurl, 'mp4': mp4url, 'webm': webmurl})
        var showVideo = function(data) {
            var divNode = $("<div />").css(cssMap).addClass("clouds");
            
            divNode.html('<video id="gfyvid" class="gfyVid" preload="auto" '+
                         ((data.thumbnail !== undefined) ?'poster="'+data.thumbnail+'" ' :'')+
                         ((isVideoMuted()) ?'muted="muted" ' :'')+
                         'loop="" autoplay="" style="width: 100%; height: 100%;"> '+
                         ((data.webm !== undefined) ?'<source type="video/webm" src="'+data.webm+'"></source>' :'') +
                         ((data.mp4 !== undefined) ?'<source type="video/mp4" src="'+data.mp4+'"></source>' :'') +
                         '</video>');
            
            var video = divNode.children('video')[0];
            $(video).bind("loadeddata", function(e) {
                    var duration = e.target.duration;
                    if (rp.debug)
                        console.log("video metadata.duration: "+duration);
                    duration += 0.5;
                    if (shouldAutoNextSlide && duration > timeToNextSlide)
                        resetNextSlideTimer(duration.toFixed());
                    else
                        resetNextSlideTimer(timeToNextSlide);
                });

            divNode.prependTo("#pictureSlider");
            $("#pictureSlider div").fadeIn(animationSpeed);
            $('#gfyvid').load();

            var oldDiv = $("#pictureSlider div:not(:first)");
            oldDiv.fadeOut(animationSpeed, function () {
                    oldDiv.remove();
                    isAnimating = false;
                });
        };

        var jsonUrl;
        var dataType = 'json';
        var handleData;
        var hostname = hostnameOf(photo.url);
        if (hostname.indexOf('gfycat.com') >= 0) {

            jsonUrl = "https://gfycat.com/cajax/get/" + shortid;

            handleData = function (data) {
                if (typeof data.gfyItem != "undefined")
                    showVideo({'thumbnail': 'http://thumbs.gfycat.com/'+shortid+'-poster.jpg',
                                'webm': data.gfyItem.webmUrl,
                                'mp4':  data.gfyItem.mp4Url});
                else {
                    showImage(photo.thumbnail);
                    resetNextSlideTimer();
                }
            };

        } else if (hostname.indexOf('vid.me') >= 0) {
            jsonUrl = 'https://api.vid.me/videoByUrl/' + shortid;
            handleData = function (data) {
                if (data.video.state == 'success')
                    showVideo({'thumbnail': data.video.thumbnail_url,
                                'mp4':  data.video.complete_url });
                else {
                    log("vid.me failed to load "+shortid+". state:"+data.video.state);
                    showImage(data.video.thumbnail_url);
                    resetNextSlideTimer();
                }
            };

        } else if (hostname.indexOf('eroshare.com') > 0 && rp.use.eroshare) {

            jsonUrl = "https://c1.eroshare.com/api/v1/albums/" + shortid + ".json";

            handleData = function (data) {
                if (data.type == "Image") {
                    showImage(result.items[0].url_full_protocol);
                    resetNextSlideTimer();                        
                } else if (data.type == "Video")
                    showVideo({'thumbnail': result.items[0].url_thumb,
                                'mp4':  result.items[0].url_mp4 });
                if (data.items > 1)
                    $('#navboxExtra').html('<a href="/eroshare/'+shortid+'">[ALBUM]</a>');
            }

        } else if (hostname.indexOf('streamable.com') >= 0) {

            jsonUrl = "https://api.streamable.com/videos/" + shortid;

            handleData = function(data) {
                var viddata = {'thumbnail': data.thumnail_url };
                if (data.files.mp4 !== undefined)
                    viddata.mp4 = data.files.mp4.url;
                if (data.files.webm !== undefined)
                    viddata.webm = data.files.webm.url;
                showVideo(viddata);
            };

        } else if (photo.url.indexOf('webm.land/w/') >= 0) {
            showVideo({'webm': 'http://webm.land/media/'+shortid+".webm"});
            return;

        } else if (isVideoExtension(photo.url)) {
            var extention = photo.url.substr(1 + photo.url.lastIndexOf('.'));
            var vid = {};
            vid[extention] = photo.url;
            showVideo(vid);
            return;

        } else if (hostname.indexOf('tumblr.com') >= 0) {
            var a = photo.url.split('/');
            if (a[-1] == "")
                a.pop();

            a.pop(); // remove "pretty" name of post
            shortid = a.pop();

            jsonUrl = 'https://api.tumblr.com/v2/blog/'+hostname+'/posts?api_key='+rp.api_key.tumblr+'&id='+shortid;
            dataType = 'jsonp';

            handleData = function(data) {
                var post = data.response.posts[0];

                if (post.type == "photo") {
                    // if (post.photos.length > 1) 
                    // $('#navboxExtra').html('<a href="/tumblr/'+hostname+'/'+shortid+'">[ALBUM]</a>');

                    showImage(post.photos[0].original_size.url);
                    resetNextSlideTimer();
                } else if (post.type == 'video') {
                    var vid = { thumbnail: post.thumbnail_url };
                    if (post.video_url.indexOf('.mp4') > 0)
                        vid.mp4 = post.video_url;
                    else if (post.video_url.indexOf('.webm') > 0)
                        vid.webm = post.video_url;
                    showVideo(vid);
                }
            } 

        } else {
            console.log('Unknown video site ', hostname);
            return;
        }

        $.ajax({
            url: jsonUrl,
                 dataType: dataType,
                 success: handleData,
                 error: failedAjax,
                 404: failedAjax,
                 timeout: 5000,
                 crossDomain: true
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


    var tryConvertPic = function (pic) {
        var url = pic.url;
        var hostname = hostnameOf(url);

        /** IMGUR **/
        if (hostname.indexOf('imgur.com') >= 0) {
            if (url.indexOf('gifv') >= 0) {
                if (hostname.indexOf('i.') !== 0) {
                    url = url.replace('imgur.com', 'i.imgur.com');
                }
                return url.replace('.gifv', '.gif');
            }

            if (url.indexOf('/a/') > 0 ||
                url.indexOf('/gallery/') > 0) {

                var shortid;
                var jsonUrl;
                var result;

                if (! rp.api_key.imgur) {
                    return '';
                }

                if (url.indexOf('/a/') > 0) {
                    shortid = pathnameOf(url).split("/")[2];
                    jsonUrl = "https://api.imgur.com/3/album/" + shortid;

                } else if (url.indexOf('/gallery/') > 0) {
                    //console.log('Unsupported gallery: ' + url);
                    return '';
                }

                $.ajax({
                    url: jsonUrl,
                    headers: { Authorization: "Client-ID "+ rp.api_key.imgur },
                    dataType: 'json',
                    success: function (data) { result = data },
                    error: failedAjax,
                    404: failedAjax,
                    jsonp: false,
                    timeout: 5000,
                    crossDomain: true,
                    async: false
                    });

                if (result.data.images_count > 1)
                    pic.extra = '<a href="/imgur/a/'+shortid+'">[ALBUM]</a>';

                // If this is animated it will return the animated gif
                if (result.data.cover !== null)
                    return "http://i.imgur.com/"+result.data.cover+".jpg";
                else
                    return result.data.images[0].link;
            }

            // imgur is really nice and serves the image with whatever extension
            // you give it. '.jpg' is arbitrary
            // regexp removes /r/<sub>/ prefix if it exists
            // E.g. http://imgur.com/r/aww/x9q6yW9
            if (hostname.indexOf('i.') !== 0)
                url = url.replace('imgur.com', 'i.imgur.com');

            if (url.indexOf("/r/") >= 0)
                return url.replace(/r\/[^ \/]+\/(\w+)/, '$1') + '.jpg';
            else
                return url+".jpg";
        }
        //log("Not understood url: "+url);

        return '';
    };
    var goodImageExtensions = ['.jpg', '.jpeg', '.gif', '.bmp', '.png'];
    var isImageExtension = function (url) {
        var dotLocation = url.lastIndexOf('.');
        if (dotLocation < 0) {
            log("skipped no dot: " + url);
            return false;
        }
        var extension = url.substring(dotLocation);

        if (goodImageExtensions.indexOf(extension) >= 0) {
            return true;
        } else {
            //log("skipped bad extension: " + url);
            return false;
        }
    };

    var goodVideoExtensions = ['.webm', '.mp4'];
    var isVideoExtension = function (url) {
        var dotLocation = url.lastIndexOf('.');
        if (dotLocation < 0) {
            log("skipped no dot: " + url);
            return false;
        }
        var extension = url.substring(dotLocation);

        if (goodVideoExtensions.indexOf(extension) >= 0) {
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

        var regexS = "(/(?:(?:r/)|(?:v/)|(?:imgur/a/)|(?:user/)|(?:domain/)|(?:search)|(?:me))[^&#?]*)[?]?(.*)";
        var regex = new RegExp(regexS);
        var results = regex.exec(window.location.href);
        //log(results);
        if (results === null) {
            return ["", ""];
        } else {
            return [results[1], decodeUrl(results[2])];
        }
    };

    var getRedditImages = function () {
        //if (noMoreToLoad){
        //    log("No more images to load, will rotate to start.");
        //    return;
        //}

        loadingNextImages = true;

        var jsonUrl = rp.redditBaseUrl + rp.subredditUrl + ".json?" + getVars + after;
        console.log(jsonUrl);
        //log(jsonUrl);
         var handleData = function (data) {
            //redditData = data //global for debugging data
            // NOTE: if data.data.after is null then this causes us to start
            // from the top on the next getRedditImages which is fine.
            after = "&after=" + data.data.after;

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
                    author: item.data.author,
                    thumbnail: item.data.thumbnail,
                    commentsLink: rp.redditBaseUrl + item.data.permalink
                    });
                });

            verifyNsfwMakesSense();

            if (!rp.foundOneImage) {
                // Note: the jsonp url may seem malformed but jquery fixes it.
                //log(jsonUrl);
                alert("Sorry, no displayable images found in that url :(");
            }

            // show the first image
            if (activeIndex == -1) {
                startAnimation(0);
            }

            if (data.data.after == null) {
                log("No more pages to load from this subreddit, reloading the start");

                // Show the user we're starting from the top
                var numberButton = $("<span />").addClass("numberButton").text("-");
                addNumberButton(numberButton);
            }
            loadingNextImages = false;

        };

        // I still haven't been able to catch jsonp 404 events so the timeout
        // is the current solution sadly.
        $.ajax({
            url: jsonUrl,
            dataType: 'json',
            success: handleData,
            error: failedAjax,
            404: failedAjax,
            jsonp: false,
            timeout: 5000,
            crossDomain: true
        });
    };

    var getImgurAlbum = function (url) {
        var albumID = url.match(/.*\/(.+?$)/)[1];
        var jsonUrl = 'https://api.imgur.com/3/album/' + albumID;
        //log(jsonUrl);

        var handleData = function (data) {

            //console.log(data);

            if (data.data.images.length === 0) {
                alert("No data from this url :(");
                return;
            }

            $.each(data.data.images, function (i, item) {
                addImageSlide({
                    url: (item.animated) ?item.gifv :item.link,
                    title: (item.title !== undefined) ?item.title :"",
                    over18: item.nsfw,
                    commentsLink: data.data.link,
                    subreddit: data.data.section,
                    isVideo: item.animated,
                    /* author: data.data.account_url, */
                    extra: (data.data.account_url !== null) 
                            ?'<a href="http://imgur.com/user/'+data.data.account_url+
                            '">/user/'+data.data.account_url+'</a>'
                            :undefined,
                });
            });

            verifyNsfwMakesSense();

            if (!rp.foundOneImage) {
                log(jsonUrl);
                alert("Sorry, no displayable images found in that url :(");
            }

            // show the first image
            if (activeIndex == -1) {
                startAnimation(0);
            }

            //log("No more pages to load from this subreddit, reloading the start");

            // Show the user we're starting from the top
            //var numberButton = $("<span />").addClass("numberButton").text("-");
            //addNumberButton(numberButton);

            loadingNextImages = false;
        };

        $.ajax({
            url: jsonUrl,
            dataType: 'json',
            success: handleData,
            error: failedAjax,
            404: failedAjax,
            timeout: 5000,
            headers: { Authorization: 'Client-ID ' + rp.api_key.imgur },
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
    var after = "";

    initState();
    setupUrls();

    // if ever found even 1 image, don't show the error
    rp.foundOneImage = false;

    if(rp.subredditUrl.indexOf('/imgur') == 0)
        getImgurAlbum(rp.subredditUrl);
    else
        getRedditImages();
    });
