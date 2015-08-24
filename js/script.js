/*
  Author: Yuval Greenfield (http://uberpython.wordpress.com) 
 
  You can save the HTML file and use it locally btw like so:
    file:///wherever/index.html?/r/aww
 
  Favicon by Double-J designs http://www.iconfinder.com/icondetails/68600/64/_icon
  HTML based on http://demo.marcofolio.net/fullscreen_image_slider/
  Author of slideshow base :      Marco Kuiper (http://www.marcofolio.net/)
*/

// override debug setting
redditp.settings.debug = true;

$(function () {

    $("#subredditUrl").text("Loading Reddit Slideshow");
    $("#navboxTitle").text("Loading Reddit Slideshow");

    var fadeoutWhenIdle = true;
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
        wipeLeft: function () {
            redditp.nextSlide();
        },
        wipeRight: function () {
            redditp.prevSlide();
        },
        wipeUp: function () {
            redditp.nextSlide();
        },
        wipeDown: function () {
            redditp.prevSlide();
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

    var initState = function () {
        var nsfwValue = redditp.cookies.getNsfw();
        $("#nsfw").prop("checked", nsfwValue);
        $('#nsfw').change(updateNsfw);

        var autoNextSlideValue = redditp.cookies.getShouldAutoNextSlide();
        $("#autoNextSlide").prop("checked", autoNextSlideValue);
        $('#autoNextSlide').change(updateAutoNext);

        var timeToNextSlideValue = redditp.cookies.getTimeToNextSlide() / 1000;
        $('#timeToNextSlide').val(timeToNextSlideValue);
        
        $('#fullScreenButton').click(toggleFullScreen);

        $('#timeToNextSlide').keyup(updateTimeToNextSlide);
        
        $('#prevButton').click(redditp.prevSlide);
        $('#nextButton').click(redditp.nextSlide);
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
                return redditp.prevSlide();
            case PAGEDOWN:
            case arrow.right:
            case arrow.down:
            case SPACE:
                return redditp.nextSlide();
        }
    });

    var getImgurAlbum = function (url) {
        var albumID = url.match(/.*\/(.+?$)/)[1];
        var jsonUrl = 'https://api.imgur.com/3/album/' + albumID;
        //log(jsonUrl);
        var failedAjax = function (data) {
            alert("Failed ajax, maybe a bad url? Sorry about that :(");
            redditp.failCleanup();
        };
        var handleData = function (data) {

            //console.log(data);

            if (data.data.images.length === 0) {
                alert("No data from this url :(");
                return;
            }

            $.each(data.data.images, function (i, item) {
                redditp.addImageSlide({
                    url: item.link,
                    title: item.title,
                    over18: item.nsfw,
                    commentsLink: ""
                });                
            });

            redditp.verifyNsfwMakesSense();

            if (!redditp.session.foundOneImage) {
                log(jsonUrl);
                alert("Sorry, no displayable images found in that url :(");
            }

            // show the first image
            if (redditp.session.activeIndex == -1) {
                redditp.startAnimation(0);
            }

            //log("No more pages to load from this subreddit, reloading the start");

            // Show the user we're starting from the top
            //var numberButton = $("<span />").addClass("numberButton").text("-");
            //addNumberButton(numberButton);

            redditp.session.loadingNextImages = false;
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

    var updateSubredditName = function() {
        var getVarsQuestionMark;
        if (redditp.urls.getVars().length > 0) {
            getVarsQuestionMark = "?" + redditp.urls.getVars();
        } else {
            getVarsQuestionMark = "";
        }

        var subredditName;
        if (redditp.urls.getSubredditUrl() === "") {
            redditp.urls.setSubredditUrl("/");
            subredditName = "reddit.com" + getVarsQuestionMark;
            //var options = ["/r/aww/", "/r/earthporn/", "/r/foodporn", "/r/pics"];
            //subredditUrl = options[Math.floor(Math.random() * options.length)];
        } else {
            subredditName = redditp.urls.getSubredditUrl() + getVarsQuestionMark;
        }
        

        var visitSubredditUrl = redditp.urls.getRedditBaseUrl() + redditp.urls.getSubredditUrl() + getVarsQuestionMark;
        
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
 
    initState();
    updateSubredditName();

    // if ever found even 1 image, don't show the error
    redditp.session.foundOneImage = false;

    if(redditp.urls.getSubredditUrl().indexOf('/imgur') === 0)
        getImgurAlbum(redditp.urls.getSubredditUrl());
    else
        redditp.getRedditImages();
});
