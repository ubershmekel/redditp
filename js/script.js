/*
  Author: Yuval Greenfield (http://uberpython.wordpress.com) 
 
  You can save the HTML file and use it locally btw like so:
    file:///wherever/index.html?/r/aww
 
  Favicon by Double-J designs http://www.iconfinder.com/icondetails/68600/64/_icon
  HTML based on http://demo.marcofolio.net/fullscreen_image_slider/
  Author of slideshow base :      Marco Kuiper (http://www.marcofolio.net/)
*/

// Speed of the animation
var animationSpeed = 1000;
var shouldAutoNextSlide = true;
var timeToNextSlide = 6 * 1000;
var cookieDays = 300;

// Variable to store the images we need to set as background
// which also includes some text and url's.
var photos = []

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
    }
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
        })
    };
    // this fadeout was really inconvenient on mobile phones
    // and instead the minimize buttons should be used.
    //setupFadeoutOnIdle();

    var nextSlideTimeoutId = null;

    var loadingNextImages = false;

    function nextSlide() {
        if(!nsfw) {
            for(var i = activeIndex + 1; i < photos.length; i++) {
                if (!photos[i].over18) {
                    return startAnimation(i)
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
                if (!photos[i].over18) {
                    return startAnimation(i)
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
        var c_value = escape(value) + ((exdays == null) ? "" : "; expires=" + exdate.toUTCString());
        document.cookie = c_name + "=" + c_value;
    }

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

    var resetNextSlideTimer = function () {
        clearTimeout(nextSlideTimeoutId);
        nextSlideTimeoutId = setTimeout(autoNextSlide, timeToNextSlide);
    }

    shouldAutoNextSlideCookie = "shouldAutoNextSlideCookie";
    var updateAutoNext = function () {
        shouldAutoNextSlide = $("#autoNextSlide").is(':checked')
        setCookie(shouldAutoNextSlideCookie, shouldAutoNextSlide, cookieDays);
        resetNextSlideTimer();
    }

    nsfwCookie = "nsfwCookie";
    var updateNsfw = function () {
        nsfw = $("#nsfw").is(':checked')
        setCookie(nsfwCookie, nsfw, cookieDays);
    }

    var initState = function () {
        var nsfwByCookie = getCookie(nsfwCookie);
        if (nsfwByCookie == undefined) {
            nsfw = true;
        } else {
            nsfw = (nsfwByCookie === "true");
            $("#nsfw").prop("checked", nsfw);
        }
        $('#nsfw').change(updateNsfw);

        var autoByCookie = getCookie(shouldAutoNextSlideCookie);
        if (autoByCookie == undefined) {
            updateAutoNext();
        } else {
            shouldAutoNextSlide = (autoByCookie === "true");
            $("#autoNextSlide").prop("checked", shouldAutoNextSlide);
        }
        $('#autoNextSlide').change(updateAutoNext);

        var updateTimeToNextSlide = function () {
            var val = $('#timeToNextSlide').val()
            timeToNextSlide = parseFloat(val) * 1000;
            setCookie(timeToNextSlideCookie, val, cookieDays);
        }

        var timeToNextSlideCookie = "timeToNextSlideCookie";
        timeByCookie = getCookie(timeToNextSlideCookie);
        if (timeByCookie == undefined) {
            updateTimeToNextSlide();
        } else {
            timeToNextSlide = parseFloat(timeByCookie) * 1000;
            $('#timeToNextSlide').val(timeByCookie);
        }

        $('#timeToNextSlide').keyup(updateTimeToNextSlide);
        
        $('#prevButton').click(prevSlide)
        $('#nextButton').click(nextSlide)
    }

    var addNumberButton = function (numberButton) {
        var navboxUls = $(".navbox ul");
        var thisNavboxUl = navboxUls[navboxUls.length - 1];

        var newListItem = $("<li />").appendTo(thisNavboxUl);
        numberButton.appendTo(newListItem);

        // so li's have a space between them and can word-wrap in the box
        navboxUls.append(document.createTextNode(' '));
    }

    var addImageSlide = function (url, title, commentsLink, over18) {
        var pic = {
            "title": title,
            "cssclass": "clouds",
            "image": url,
            "text": "",
            "url": url,
            "urltext": 'View picture',
            "commentsLink": commentsLink,
            "over18": over18
        }

        preLoadImages(pic.url);
        photos.push(pic);

        var i = photos.length - 1;
        var numberButton = $("<a />").html(i + 1)
            .data("index", i)
            .attr("title", photos[i].title)
            .attr("id", "numberButton" + (i + 1));
        if(over18) {
            numberButton.addClass("over18");
        }
        numberButton.click(function () {
            showImage($(this));
        });
        numberButton.addClass("numberButton");
        addNumberButton(numberButton);
    }

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
    var T_KEY = 84;

    // Register keypress events on the whole document
    $(document).keyup(function (e) {

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
            case PAGEUP:
            case arrow.left:
            case arrow.up:
                return prevSlide()
            case PAGEDOWN:
            case arrow.right:
            case arrow.down:
            case SPACE:
                return nextSlide()
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
            if(imageIndex == photos.length - 1) {
                return true
            } else {
                return false
            }
        } else {
            // look for remaining sfw images
            for(var i = imageIndex + 1; i < photos.length; i++) {
                if(!photos[i].over18) {
                    return false
                }
            }
            return true
        }
    }
    //
    // Starts the animation, based on the image index
    //
    // Variable to store if the animation is playing or not
    var isAnimating = false;
    var startAnimation = function (imageIndex) {
        resetNextSlideTimer();

        // If the same number has been chosen, or the index is outside the
        // photos range, or we're already animating, do nothing
        if (activeIndex == imageIndex || imageIndex > photos.length - 1 || imageIndex < 0 || isAnimating || photos.length == 0) {
            return;
        }

        isAnimating = true;
        animateNavigationBox(imageIndex);
        slideBackgroundPhoto(imageIndex);

        // Set the active index to the used image index
        activeIndex = imageIndex;

        if (isLastImage(activeIndex)) {
            getNextImages();
        }
    };

    var toggleNumberButton = function (imageIndex, turnOn) {
        var numberButton = $('#numberButton' + (imageIndex + 1));
        if (turnOn) {
            numberButton.addClass('active');
        } else {
            numberButton.removeClass('active');
        }
    }

    //
    // Animate the navigation box
    //
    var animateNavigationBox = function (imageIndex) {
        var photo = photos[imageIndex];

        $('#navboxTitle').html(photo.title);
        $('#navboxLink').attr('href', photo.url).attr('title', photo.title);
        $('#navboxCommentsLink').attr('href', photo.commentsLink).attr('title', "Comments on reddit");

        toggleNumberButton(activeIndex, false);
        toggleNumberButton(imageIndex, true);
    };

    //
    // Slides the background photos
    //
    var slideBackgroundPhoto = function (imageIndex) {

        // Retrieve the accompanying photo based on the index
        var photo = photos[imageIndex];

        // Create a new div and apply the CSS
        var cssMap = Object();
        cssMap['display'] = "none";
        cssMap['background-image'] = "url(" + photo.image + ")";
        cssMap['background-repeat'] = "no-repeat";
        cssMap['background-size'] = "contain";
        cssMap['background-position'] = "center";

        //var imgNode = $("<img />").attr("src", photo.image).css({opacity:"0", width: "100%", height:"100%"});
        var divNode = $("<div />").css(cssMap).addClass(photo.cssclass);
        //imgNode.appendTo(divNode);
        divNode.prependTo("#pictureSlider");

        $("#pictureSlider div").fadeIn(animationSpeed);
        var oldDiv = $("#pictureSlider div:not(:first)");
        oldDiv.fadeOut(animationSpeed, function () {
            oldDiv.remove();
            isAnimating = false;
        });
    };

    
    
    var verifyNsfwMakesSense = function() {
        // Cases when you forgot NSFW off but went to /r/nsfw
        // can cause strange bugs, let's help the user when over 80% of the
        // content is NSFW.
        var nsfwImages = 0
        for(var i = 0; i < photos.length; i++) {
            if(photos[i].over18) {
                nsfwImages += 1
            }
        }
        
        if(0.8 < nsfwImages * 1.0 / photos.length) {
            nsfw = true
            $("#nsfw").prop("checked", nsfw)
        }
    }
    
    
    var tryConvertUrl = function (url) {
        if (url.indexOf('imgur.com') >= 0) {
            // special cases with imgur
            
            if (url.indexOf('/a/') >= 0) {
                // albums aren't supported yet
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
    var goodExtensions = ['.jpg', '.jpeg', '.gif', '.bmp', '.png']
    var isImageExtension = function (url) {
        var dotLocation = url.lastIndexOf('.');
        if (dotLocation < 0) {
            log("skipped no dot: " + url);
            return false;
        }
        var extension = url.substring(dotLocation);

        if (goodExtensions.indexOf(extension) >= 0) {
            return true;
        } else {
            //log("skipped bad extension: " + url);
            return false;
        }
    }

    var decodeUrl = function (url) {
        return decodeURIComponent(url.replace(/\+/g, " "))
    }
    var getRestOfUrl = function () {
        var regexS = "(/(?:(?:r)|(?:user)|(?:domain))/[^&#?]*)[?]?(.*)";
        var regex = new RegExp(regexS);
        var results = regex.exec(window.location.href);
        //log(results);
        if (results == null) {
            return ["", ""];
        } else {
            return [results[1], decodeUrl(results[2])];
        }
    }

    var getNextImages = function () {
        //if (noMoreToLoad){
        //    log("No more images to load, will rotate to start.");
        //    return;
        //}

        loadingNextImages = true;

        var jsonUrl = redditBaseUrl + subredditUrl + ".json?jsonp=?" + after + "&" + getVars;
        //log(jsonUrl);
        var failedAjax = function (data) {
            alert("Failed ajax, maybe a bad url? Sorry about that :(");
        };
        var handleData = function (data) {
            //redditData = data //global for debugging data
            // NOTE: if data.data.after is null then this causes us to start
            // from the top on the next getNextImages which is fine.
            after = "&after=" + data.data.after;

            if (data.data.children.length == 0) {
                alert("No data from this url :(");
                return;
            }

            $.each(data.data.children, function (i, item) {
                var imgUrl = item.data.url;
                var title = item.data.title;
                var over18 = item.data.over_18;
                var commentsUrl = "http://www.reddit.com" + item.data.permalink;

                // ignore albums and things that don't seem like image files
                var goodImageUrl = '';
                if (isImageExtension(imgUrl)) {
                    goodImageUrl = imgUrl;
                } else {
                    goodImageUrl = tryConvertUrl(imgUrl);
                }

                if (goodImageUrl != '') {
                    foundOneImage = true;
                    addImageSlide(goodImageUrl, title, commentsUrl, over18);
                }
            });

            verifyNsfwMakesSense()
            
            if (!foundOneImage) {
                log(jsonUrl);
                alert("Sorry, no displayable images found in that url :(")
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


        var doneAjaxReq = function(xhr, data) {
            if (xhr.status == 0) {
                // This is to handle 404's which don't fire the "error" event.
                alert('Ajax completed with a bad status, maybe a bad url?')
            } else {
                //alert('done');
            }
            // else - success
        };
        
        
        // I still haven't been able to catch jsonp 404 events so the timeout
        // is the current solution sadly.
        $.ajax({
            url: jsonUrl,
            dataType: 'json',
            success: handleData,
            error: failedAjax,
            complete: doneAjaxReq,
            404: failedAjax,
            timeout: 5000
        });
    }

    var setupUrls = function() {
        var urlData = getRestOfUrl();
        //log(urlData)
        subredditUrl = urlData[0]
        getVars = urlData[1]
        
        if (getVars.length > 0) {
            getVarsQuestionMark = "?" + getVars;
        } else {
            getVarsQuestionMark = "";
        }

        // Remove .compact as it interferes with .json (we get "/r/all/.compact.json").
        subredditUrl = subredditUrl.replace(/.compact/, "")
        // Consolidate double slashes to avoid r/all/.compact/ -> r/all//
        subredditUrl = subredditUrl.replace(/\/{2,}/, "/")

        var subredditName;
        if (subredditUrl === "") {
            subredditUrl = "/";
            subredditName = "reddit.com" + getVarsQuestionMark;
            //var options = ["/r/aww/", "/r/earthporn/", "/r/foodporn", "/r/pics"];
            //subredditUrl = options[Math.floor(Math.random() * options.length)];
        } else {
            subredditName = subredditUrl + getVarsQuestionMark;
        }
        

        var visitSubredditUrl = redditBaseUrl + subredditUrl + getVarsQuestionMark;
        
        // truncate and display subreddit name in the control box
        var displayedSubredditName = subredditName;
        var capsize = 25
        if(displayedSubredditName.length > capsize) {
            displayedSubredditName = displayedSubredditName.substr(0,capsize) + "&hellip;";
        }
        $('#subredditUrl').html("<a href='" + visitSubredditUrl + "'>" + displayedSubredditName + "</a>");

        document.title = "redditP - " + subredditName;
    }
    
    

    initState();
    
    var redditBaseUrl = "http://www.reddit.com";
    var subredditUrl;
    var getVars;
    var after = "";
    
    setupUrls();

    // if ever found even 1 image, don't show the error
    var foundOneImage = false;

    getNextImages();
});
