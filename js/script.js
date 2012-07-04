/*
 * Author: Yuval Greenfield (http://uberpython.wordpress.com) 
 *
 * Favicon by Double-J designs http://www.iconfinder.com/icondetails/68600/64/_icon
 * HTML based on http://demo.marcofolio.net/fullscreen_image_slider/
 * Author of slideshow base :      Marco Kuiper (http://www.marcofolio.net/)
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

$(function () {
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

    $('.collapser').click(function () {
        var state = $(this).attr("openstate");
        if (state == "open") {
            $(this).attr("class", "collapser arrowRight");
            $(this).parent().animate({
                left: "-425px"
            });
            $(this).attr("openstate", "closed");
        } else {
            $(this).attr("class", "collapser arrowLeft");
            $(this).parent().animate({
                left: "0px"
            });
            $(this).attr("openstate", "open");
        }

    })

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
        }

    var initState = function () {
            var updateAutoNext = function () {
                    // $this will contain a reference to the checkbox   
                    // the checkbox was checked/unchecked
                    shouldAutoNextSlide = $(this).is(':checked')
                    setCookie(shouldAutoNextSlideCookie, shouldAutoNextSlide, cookieDays);
                }

            var shouldAutoNextSlideCookie = "shouldAutoNextSlideCookie";
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
        }
    initState()

    var addImageSlide = function (url, title, commentsLink) {
            var pic = {
                "title": title,
                "cssclass": "clouds",
                "image": url,
                "text": "",
                "url": url,
                "urltext": 'View picture',
                "commentsLink": commentsLink
            }

            preLoadImages(pic.url);
            photos.push(pic);

            var navboxUls = $(".navbox ul");
            var thisNavboxUl = navboxUls[navboxUls.length - 1];

            var i = photos.length - 1;
            var numberButton = $("<a />").html(i + 1).data("index", i).attr("title", photos[i].title).attr("id", "numberButton" + (i + 1)).click(function () {
                showImage($(this));
            });
            var newListItem = $("<li />").appendTo(thisNavboxUl);
            numberButton.appendTo(newListItem);

            // so li's have a space between them and can word-wrap in the box
            navboxUls.append(document.createTextNode(' '));

            // show the first image
            if (activeIndex == -1) {
                activeIndex = 0;
                animateNavigationBox(0);
                slideBackgroundPhoto(0);
                setTimeout(autoNextSlide, timeToNextSlide);
            }
        }

        // Register keypress events on the whole document
        $(document).keyup(function (e) {

            //console.log(e.keyCode, e.which, e.charCode);

            // 37 - left
            // 38 - up
            // 39 - right
            // 40 - down
            // More info: http://stackoverflow.com/questions/302122/jquery-event-keypress-which-key-was-pressed
            // http://stackoverflow.com/questions/1402698/binding-arrow-keys-in-js-jquery
            var imageIndex = undefined;
            var code = (e.keyCode ? e.keyCode : e.which);
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

            switch (code) {
            case PAGEUP:
            case arrow.left:
            case arrow.up:
                imageIndex = activeIndex - 1;
                break;
            case PAGEDOWN:
            case arrow.right:
            case arrow.down:
            case SPACE:
                imageIndex = activeIndex + 1;
                break;
            }

            if (imageIndex === undefined) {
                return;
            }

            if (0 <= imageIndex && imageIndex < photos.length) {
                startAnimation(imageIndex);
            } else {
                console.log('invalid index: ' + imageIndex);
            }
        });

    nextSlide = function () {
            startAnimation(activeIndex + 1);
        }
    prevSlide = function () {
            startAnimation(activeIndex - 1);
        }

    var autoNextSlide = function () {
            setTimeout(autoNextSlide, timeToNextSlide);

            if (shouldAutoNextSlide) {
                nextSlide();
            }
        }


        //
        // Shows an image and plays the animation
        //
    var showImage = function (docElem) {
            // Retrieve the index we need to use
            var imageIndex = docElem.data("index");

            startAnimation(imageIndex);
        };

    //
    // Starts the animation, based on the image index
    //
    // Variable to store if the animation is playing or not
    var isAnimating = false;
    var startAnimation = function (imageIndex) {
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

            if (imageIndex == photos.length - 1) {
                getNextImages();
            }
        };

    var toggleNumberButton = function (imageIndex, turnOn) {
            var numberButton = $('#numberButton' + (imageIndex + 1));
            if (turnOn) {
                numberButton.attr('class', 'active');
            } else {
                numberButton.attr('class', '');
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

            $("<div />").css(cssMap).addClass(photo.cssclass).prependTo("#pictureSlider");

            $("#pictureSlider div").fadeIn(animationSpeed);
            var oldDiv = $("#pictureSlider div:not(:first)");
            oldDiv.fadeOut(animationSpeed, function () {
                oldDiv.remove();
                isAnimating = false;
            });
        };

    var decodeUrl = function(url) {
        return decodeURIComponent(url.replace(/\+/g, " "))
    }
    var getRestOfUrl = function () {
            var regexS = "(/r/[^&#?]*)[?]?(.*)";
            var regex = new RegExp(regexS);
            var results = regex.exec(window.location.href);
            //console.log(results);
            if (results == null) {
                return ["", ""];
            } else {
                return [decodeUrl(results[1]), decodeUrl(results[2])];
            }
        }

    var redditBaseUrl = "http://www.reddit.com";
    var urlData = getRestOfUrl();
    var subredditUrl = urlData[0]
    var getVars = urlData[1]

    if (getVars.length > 0) {
        getVarsQuestionMark = "?" + getVars;
    } else {
        getVarsQuestionMark = "";
    }
    
    var subredditName;
    if (subredditUrl === "") {
        subredditUrl = "/";
        subredditName = "reddit.com" + getVarsQuestionMark;
        //var options = ["/r/aww/", "/r/earthporn/", "/r/foodporn", "/r/pics"];
        //subredditUrl = options[Math.floor(Math.random() * options.length)];
    } else {
        subredditName = subredditUrl + getVarsQuestionMark;
    }
    
    visitSubredditUrl = redditBaseUrl + subredditUrl + getVarsQuestionMark;
    $('#subredditUrl').html("<a href='" + visitSubredditUrl + "'>" + subredditName + "</a>");
    var after = "";
    var redditData = null;

    var getNextImages = function () {
            var jsonUrl = redditBaseUrl + subredditUrl + ".json?jsonp=?" + after + "&" + getVars;
            console.log(jsonUrl);
            var failedAjax = function(data) {
                alert("Failed ajax, maybe a bad url? Sorry about that :(");
            };
            var handleData = function(data) {
                redditData = data
                after = "&after=" + data.data.after;
                
                if (data.data.children.length == 0) {
                    alert("No data from this url :(");
                    return;
                }
                
                $.each(data.data.children, function (i, item) {
                    var imgUrl = item.data.url;
                    var title = item.data.title;
                    var commentsUrl = "http://www.reddit.com" + item.data.permalink;

                    // ignore albums and things that don't seem like image files
                    if (imgUrl.charAt(imgUrl.length - 4) == '.') {
                        addImageSlide(imgUrl, title, commentsUrl);
                    }
                });
            };
            
            
            $.ajax({
                url: jsonUrl,
                dataType: 'json',
                success: handleData,
                error: failedAjax
                });
        }

    getNextImages();
});