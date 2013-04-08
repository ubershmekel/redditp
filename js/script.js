/*
 * Author: Yuval Greenfield (http://uberpython.wordpress.com) 
 *
 * Favicon by Double-J designs http://www.iconfinder.com/icondetails/68600/64/_icon
 * HTML based on http://demo.marcofolio.net/fullscreen_image_slider/
 * Author of slideshow base :      Marco Kuiper (http://www.marcofolio.net/)
 * Refactor 4/2013: Kevin Butler (http://github.com/Ryman) 
 */

//
// Helpers
//

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

// Simplifies working with cookies by providing a simple helper function
// to sync the status of input elements with a cookie
var CookieHelper = function() {
    var cookieDays = 300
    
    // Sync inputs to cookies
    var syncState = function(selector, bindevent, getState, setState) {
        var element = $(selector)
        var cookieName = getCookieName(selector)
        var cookieValue = getCookie(cookieName, cookieDays);
        
        var saveState = function(val) {
            setState(val, element)
            setCookie(cookieName, val, cookieDays);
        }

        // Load value from store
        if (cookieValue == undefined) {
            // No stored value, save current state
            var val = getState(element)
            saveState(val)
        } else {
            setState(cookieValue, element)
        }

        // Save changes - TODO: if jQuery > 1.7 then use .on instead of .bind
        $(element).bind(bindevent, function() {
            var val = getState(this)
            saveState(val)
        });
    }

    // This doesn't matter so much
    var getCookieName = function(selector) { return 'redditp_' + selector + '_cookie' }
    
    var syncCheckbox = function(selector, onSet) {
        syncState(selector, 
                'change',
                function(element) {
                    return $(element).prop('checked')
                },
                function(value, element) {
                    var val = (value + '') === 'true'
                    onSet(val)
                    $(element).prop('checked', val)
                })
    }

    var syncInputValue = function(selector, onSet) {
        syncState(selector,
                'keyup',
                function(element) {
                    return $(element).val()
                },
                function(value, element) {
                    var f = value
                    $(element).val(f)
                    onSet(f)
                })
    }
    
    ///
    /// Public API Methods
    ///
    
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
    
    // Syncs a cookies value with the an input element
    // selector : string : stringJQuery selector for finding input to sync
    // onSet : Callback(newvalue, element) : called when input state changes
    var syncSelector = function(selector, onSet) {
        var type = $(selector).attr('type')
    
        switch(type) {
            case 'checkbox': return syncCheckbox(selector, onSet)
            case 'text': return syncInputValue(selector, onSet)
            default: throw 'Unsupported Input Type'
        }
    }

    return {
        sync: syncSelector,
        set: setCookie,
        get: getCookie
    }
}()

// Simplify parsing the urls and dealing with the reddit api
var RedditUrlHelper = function() {
    var imgExtensions = ['.jpg', '.jpeg', '.gif', '.bmp', '.png']
    var lastSeen = ''
    var self
    
    // Find subreddit and getvars from a given url
    var parsePath = function (url) {
        var regex = new RegExp("(/(?:(?:r)|(?:user)|(?:domain))/[^&#?]*)[?]?(.*)")
        var results = regex.exec(url)

        if (results === null) { results = ['zero the hero', '/', ''] }
    
        return { 
            subreddit: results[1], 
            getVars: decodeURIComponent(results[2].replace(/\+/g, " ")) 
        }
    }
    
    // Checks if the url ends with a valid image file extension
    var isImageExtension = function (url) {
        var dotLocation = url.lastIndexOf('.')
        if (dotLocation < 0) {
            log("skipped no dot: " + url)
            return false;
        }

        var extension = url.substring(dotLocation)
        return (imgExtensions.indexOf(extension) >= 0)
    }
    
    // Try to salvage a usable image for a given url
    var tryConvertUrl = function (url) {
        if (url.indexOf('imgur.com') >= 0 
            // albums aren't supported yet
            && url.indexOf('/a/') < 0) {
                // imgur is really nice and serves the image with whatever extension
                // you give it. '.jpg' is arbitrary

                // TODO: handle links such as: http://imgur.com/gallery/Kogjqg5/new
                // reroute to i subdomain if appending a filetype
                var imageDomainUrl = url.replace('http://imgur.com', 'http://i.imgur.com')
                
                // regexp removes /r/<sub>/ prefix if it exists
                // E.g. http://imgur.com/r/aww/x9q6yW9
                return imageDomainUrl.replace(/r\/[^ \/]+\/(\w+)/, '$1') + '.jpg';
        }

        return ''
    }
    
    //
    // Public API Methods
    //
    
    var init = function(hostname) {
        self = this
        var path = parsePath(window.location.href);
        var host = hostname || 'http://www.reddit.com'
        
        self.url = {
            host: host,
            subreddit: path.subreddit,
            getVars: path.getVars
        }
    }
    
    // Gets the url for the next dataset
    var getNextUrl = function() {
        // No more data
        if (lastSeen == null) { return false }
        
        return self.url.host + self.url.subreddit + '.json?jsonp=?&after=' + lastSeen + '&' + self.url.getVars
    }
    
    // Guess if a url will give a valid image to show
    // returns (url or a modified version) if valid
    // returns '' if invalid
    var getValidImageUrl = function(url) {
        // ignore albums and things that don't seem like image files
        if (isImageExtension(url)) { return url } 
        return tryConvertUrl(url)
    }
    
    var setLastSeen = function(value) {
        console.log(value)
        lastSeen = value
    }
    
    return {
        setLastSeen: setLastSeen,
        init: init,
        getNextUrl: getNextUrl,
        getValidImage: getValidImageUrl
    }   
}();

// 
// Core Logic
//

// Reddit DataSource
// Gets metadata from the json api for a given index
// Calls any subscribed onData callbacks whenever new data is recieved from the api
// getSourceInfo().name will be the current subreddits shown
var RedditStream = function() {
    var images
    var pendingCallbacks
    var onDataSubscribers
    var urlHelper
    var self

    // Sends each subscriber notification of the startIndex of the new data
    // and an array of all the data incase they need to do work with that
    var informDataSubscribers = function(oldLength, images) {
        $.each(onDataSubscribers, function(index, callback) {
            callback(oldLength, images)
        })
    }
    
    // Handle a json api response
    var handleResponse = function (response) {
        data = response.data
        // NOTE: if data.after is null then this causes us to start
        // from the top on the next getNextImages which is fine.
        urlHelper.setLastSeen(data.after)

        // TODO: Handle this better than just logging it
        if (data.children.length == 0) {
            log("No data from this url :(")
            return;
        }
        
        // Filter the new images and add them to collection
        var valid = filterData(data.children)
        images = images.concat(valid)
        
        // Let subscribers know we have new data
        informDataSubscribers(images.length - valid.length, images)
        
        // Allow the next waiting request to go!
        executePendingCallbacks()
    }
    
    // Only allow urls which seem to be images
    var filterData = function(items) {
        var passed = []
        $.each(items, function (i, item) {
            // Try to salvage images
            var validLink = urlHelper.getValidImage(item.data.url)
            if (validLink != '') {
                item.data.permalink = urlHelper.url.host + item.data.permalink
                item.data.url = validLink
                passed.push(item.data)
            }
        })
        return passed
    }
    
    // Clear request backlog
    var executePendingCallbacks = function() {
        // Note: Swap and clear pending array to stop infinite recursion possibility
        // TODO: Should work with a .pop, try & test that (with simultanious index requests)
        var toExec = pendingCallbacks;
        pendingCallbacks = [];
        $.each(toExec, function(i, item) { item() })
    }
    
    // Loads data from the reddit api
    //  It ensures only sequential calls to the api are made and they are made one at a time
    //  This ensures we don't lose any callbacks e.g. if a request for multiple indexes are made
    //  before the api had returned
    var getData = function(callback) {
        pendingCallbacks.push(callback); 
        if (pendingCallbacks.length > 1) { return; }
    
        var nextUrl = urlHelper.getNextUrl();
        if (nextUrl) {
            $.ajax({
                url: nextUrl,
                dataType: 'json',
                success: handleResponse,
                error: function (data) {
                    log("Failed ajax, maybe a bad url? Sorry about that :(");
                }
            })
        } else {
            // Reached the end of the subreddit
            // TODO: Loop back to 0
            log('No more images')
        }
    }
    
    // 
    // Public API
    //
    
    var init = function(options) {
        self = this
        images = []
        pendingCallbacks = []
        onDataSubscribers = []
        var o = options || {}
        urlHelper = o.helper || RedditUrlHelper
        urlHelper.init(o.hostname)
    }
    
    // Gets metadata from the reddit api for a given index
    // Returns true if the index was already loaded
    // else it will call then callback on completion of the api call
    var getIndex = function(index, callback) {
        if (index >= images.length) {
            // Need to load image
            return getData(function() { getIndex(index, callback); }) && false // Always returns falsey
        } else {
            // already have metadata in memory, just callback instantly
            return callback(images[index]) || true // Always returns truthy
        }
    }
    
    // Information about the dataSource's current resource
    // For reddit, the name of the subreddits being shown will be useful
    var sourceInfo = function() {
        var url = urlHelper.url
        // Prepend a '?' to getVars if there are any
        var getVars = url.getVars.length > 0 ? '?' + url.getVars : '' 
        
        return {
            name: url.subreddit,
            link: url.host + url.subreddit + getVars
        }
    }
    
    return {
        name: 'Reddit',
        init: init,
        getIndex: getIndex,
        getSourceInfo: sourceInfo,
        onData: function(callback) { onDataSubscribers.push(callback)}
    }
}();

// The preloader decorates a dataSource to preload additional images on each image request
var Preloader = function(wrapped, preloadAmount) {
    if (typeof wrapped !== 'object') { throw 'Preloader requires a DataSource' }
    var cache = {}
    var preloadAmount = preloadAmount || 3
    
    // Preload more images
    var preloadAfter = function(startIndex) {
        for (var i = startIndex; i < (preloadAmount + startIndex); i++) {
            // Skip if already preloaded / preloading
            if (cache[i]) { continue }

            wrapped.getIndex(i, function(image) { preloadImage(i, image) });
            
            // Assume that if we haven't populated the cache already then we are fetching
            // Saves doing this 'inmemory?' check for every callback in the preloader
            if (!cache[i]) { cache[i] = { isFetching: true } }
        }
    }
    
    // Preload an image with a given metadata
    var preloadImage = function(index, image) {
        // TODO : Handle skipping nsfw images in preloader if not showing them
        var cacheImage = document.createElement('img')
        cacheImage.src  = image.url
        
        // Setup the cache for future use
        cache[index] = {
            image: image,
            img: cacheImage
        }
    }
    
    ///
    /// Public API
    ///
    
    // Delegate these to the wrapped dataSource instance
    this.name = wrapped.name
    this.onData = wrapped.onData
    this.getSourceInfo = wrapped.getSourceInfo

    this.init = function() {
        wrapped.init()
        cache = {}
    }
    
    // Wrap the dataSource while also reusing the cached images and preloading future indices
    this.getIndex = function(index, callback) {         
        return wrapped.getIndex(index, function(image) {
            var cached = cache[index]
            if (cached && cached.img) {
                // Use cached img url/datauri if we have one
                image.url = cached.img.src
            }
            
            callback(image)
            preloadAfter(index)
        })
    }
    
    return this
}

// Presentation takes care of the logic of which image should be shown at a time
//  It handles navigation through the move method
//  It will automatically skip over the NSFW images if they should not be shown
//  It will automatically progress to the next image (after a given time) if AutoMove is enabled
var Presentation = function() {
    var current = {}
    var dataSource
    var onProgress
    var allowNSFW = false
    var autoMove = { waitTime: -3000, timeout: 0 }
    var self
    
    // Find next valid image in dataSource (skipping nsfw)
    // If we're moving backwards then reverse needs to be set!
    var transitionTo = function(index, reverse) {
        // If it's NaN then default to zero, and account for negative indices
        var i = Math.max(index || 0, 0)
        
        // new desired index
        current.index = i
        
        var isInMemory = dataSource.getIndex(i, function(image) {
            // Skip over nsfw images in both directions
            if (!allowNSFW && image.over_18) {
                var nextTry = reverse ? i - 1 : i + 1

                return transitionTo(nextTry, reverse)
            }
            
            // If the current desired index is still this one, then show the image
            if (current.index == i) { 
                current.image = image 
                onProgress(i, image.title, image)
            } 
        });
        
        // If we don't have the image alraedy, it's doing a dataSource request
        if (!isInMemory) { 
            onProgress(current.index, 'Fetching data from ' + dataSource.name) 
        }
        
        // Delay automove due to transition
        resetAutoMove()
    }
    
    // Setup the AutoMove cycle according to current variables
    var resetAutoMove = function() {
        // always clear the timeouts on any change/retrigger
        clearTimeout(autoMove.timeout)
        
        // do nothing if disabled or above 5fps (sane limit)
        if (autoMove.waitTime < 200) { return }
        
        // Go!
        autoMove.timeout = setTimeout(function(){ move('+')}, autoMove.waitTime);
    }
    
    ///
    /// Public API Methods
    ///
    
    // AutoMover is controlled by a waitTime internally, 
    // we map the boolean input to a sign to indicate on or off (positive/negative)
    var setAutoMoveEnabled = function(enabled) {
        var sign = enabled ? 1 : -1
        autoMove.waitTime = sign * Math.abs(autoMove.waitTime)
        
        resetAutoMove()
    }
    
    // Delaytime : 1000 = 1second
    var setAutoMoveWaitTime = function(val) {
        if (autoMove.waitTime > 0) {
            autoMove.waitTime = Math.abs(val)
        } else {
            autoMove.waitTime = -Math.abs(val)  
        }
        
        resetAutoMove()
    }
    
    var setAllowNSFW = function(allowed) {
        allowNSFW = !!allowed
        
        // If the current image is NSFW, then we need to change image if it just got disabled
        if (!allowNSFW 
         && current.image 
         && current.image.over_18) {
            move('+')
        }
    }
    
    var init = function(source, onprogress) {
        self = this
        dataSource = source
        onProgress = onprogress
        current = {}

        // Stop any old timers from firing after a re-init
        if (autoMove.timeout) { clearTimeout(autoMove.timeout) }
        autoMove = { waitTime: 3000, timeout: 0 }
        
        if (typeof onProgress !== 'function') { throw 'Must supply progress function to Presentation' }
        
        // Start the show!
        move(0)
    }
    
    // Controls the Presentation
    // Accepts a number representing the index to show
    // Or '+' indicating go to the next image
    // Or '-' indicating go to the previous image
    var move = function(val) {
        if (typeof val === 'string') {
            if (val[0] == '+') {
                val = current.index + 1
            } else if (val[0] == '-') {
                val = current.index - 1
                return transitionTo(parseInt(val), true)
            }
        }
        
        transitionTo(parseInt(val))
    }
    
    return {
        init: init,
        move: move, 
        setAutoMoveEnabled: setAutoMoveEnabled,
        setAutoMoveWaitTime: setAutoMoveWaitTime,
        setAllowNSFW: setAllowNSFW
    }
}();

// 
// Core UI Logic
//

// RedditPresentation ties the DOM to the Presentation & DataSource setup
// It should handle anything relating to the DOM
var RedditPresentation = function() {
    var animationSpeed = 1000
    var presentation
    var keys = {
            ENTER: 13,
            SPACE: 32,
            PAGEUP: 33,
            PAGEDOWN: 34,
            ARROWS: {
                LEFT: 37,
                UP: 38,
                RIGHT: 39,
                DOWN: 40
            },
            ONE_KEY: 49,
            NINE_KEY: 57,
            A_KEY: 65,
            C_KEY: 67,
            T_KEY: 84
        }
        
    var setupSubRedditInfo = function(dataSource) {
        var info = dataSource.getSourceInfo()

        $('#subredditUrl').html("<a href='" + info.link + "'>" + info.name + "</a>");  
        document.title = "redditP - " + info.name;
    }
        
    //
    // Handling User Inputs
    // 

    var changeSlide = function(val) { return presentation.move(val) }
    var nextSlide = function(){ return changeSlide('+') }
    var prevSlide = function() { return changeSlide('-') }
    
    var toggleControls = function() { $('#controlsDiv .collapser').click(); }
    var toggleTitle = function() { $('#titleDiv .collapser').click(); }
    var toggleAutoMove = function() { $("#autoNextSlide").click() }
    
    var setNSFWAllowed = function(enabled) { 
        if ($('#nsfw').prop('checked') != enabled) {
            $('#nsfw').click() 
        }
    }
    
    var bindInputs = function() {
        // Bind left & right buttons
        //      Adding data-move to any div available at document.ready will make it a button :3
        $('div[data-move]').click(function() { 
            changeSlide($(this).data('move')); 
        });
    
        // Bind all number buttons
        //      If using jQuery > 1.7 update this to .on('click', 'li a', function(){...})
        //      This will be more efficient than adding an event handler to every link
        $('div.numberButtonList').delegate('li a', 'click', function() {
            changeSlide($(this).data('index'));
        });
        
        bindKeyboard();
        bindSwipeControls();
        setupCollapsers();
    }
    
    var bindKeyboard = function() {
        $(document).keyup(function (e) {
            // More info: http://stackoverflow.com/questions/302122/jquery-event-keypress-which-key-was-pressed
            // http://stackoverflow.com/questions/1402698/binding-arrow-keys-in-js-jquery
            var code = (e.keyCode ? e.keyCode : e.which);
            with(keys) {
                switch (code) {
                    case C_KEY:
                        return toggleControls();
                    case T_KEY:
                        return toggleTitle();
                    case A_KEY:
                        return toggleAutoMove();
                    case PAGEUP:
                    case ARROWS.LEFT:
                    case ARROWS.UP:
                        return prevSlide()
                    case PAGEDOWN:
                    case ARROWS.RIGHT:
                    case ARROWS.DOWN:
                    case SPACE:
                        return nextSlide()
                }
            }
        });
    }
    
    var bindSwipeControls = function() {
        // TODO: test this on iPad
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
    }

    // Setup collapsers to show or hide on click
    var setupCollapsers = function() {
        $('.collapser').click(function () {
            if ($(this).text() == '+') {
                // Hidden - Show it
                $(this).text("-").parent().stop().animate({
                    left: "0px"
                });
            } else {
                // Visible - Hide it
                // move to the left just enough so the collapser arrow is visible
                var arrowLeftPoint = $(this).position().left;
                $(this).text("+").parent().stop().animate({
                    left: "-" + arrowLeftPoint + "px"
                });
            }
        });
    }
    
    var setupCookies = function(sh) {
        var p = presentation
        sh.sync('#autoNextSlide', function(v) { 
            p.setAutoMoveEnabled(v) 
        })
        sh.sync('#nsfw', function(v) { 
            p.setAllowNSFW(v) 
        })
        sh.sync('#timeToNextSlide', function(v) { 
            p.setAutoMoveWaitTime(parseFloat(v) * 1000); 
        })
    }

    ///
    /// Handling System Changes
    ///
    
    var handleData = function(startIndex, data) {
        // Check if the nsfw flag makes sense
        ensureNsfwFilterMakesSense(data)
        
        // Add number buttons for each of the new images
        $.each(data.slice(startIndex), function(i, image) { 
            addNumberButton(startIndex + i, image) 
        })
    }
    
    var ensureNsfwFilterMakesSense = function(images) {
        // Cases when you forgot NSFW off but went to /r/nsfw can cause strange bugs,
        // let's help the user when over 80% of the content is NSFW.
        var nsfwCount = 1.0 * $(images).filter(function(index, image) {
            return image.over_18
        }).length
   
        if(nsfwCount / images.length > 0.8) { setNSFWAllowed(true) }
    }
    
    var onSlideChange = function(index, text, image) {
        if (image) {
            changeImage(index, image)
        } else {
            setDescription(text)
        }
    }
    
    var changeImage = function(index, image) {
        updateNavigationTexts(index, image);
        updateImage(index, image);
    }

    var setDescription = function(text) { $('#navboxTitle').html(text); }
    
    var addNumberButton = function (index, image) {
        var numberButton = $("<a />").html(index + 1)
                                .data("index", index)
                                .attr("title", image.title)
                                .addClass("numberButton")
                                .toggleClass('over18', image.over_18)
        
        var newListItem = $("<li />").append(numberButton)
                                // Add it to the buttonlist
                                .appendTo("#allNumberButtons");
    }

    // Update UI with new relevant texts
    var updateNavigationTexts = function (index, image) {
        setDescription(image.title)
        // Updates image link
        $('#navboxLink').attr({
            'href': image.url,
            'title': image.title
        });
    
        // Update comments link
        $('#navboxCommentsLink').attr({ 
            'href': image.permalink,
            'title': "Comments on reddit"
        });
    
        updateActiveButton(index);
    };

    // Update which button is active, using element data-index value
    var updateActiveButton = function(index) {
        $('div.numberButtonList li a')
            // Ensure we only have one active at a time
            .removeClass('active')
            // Find the button with the index and addClass only for it
            .filter(function() { return $(this).data('index') == index })
            .addClass('active')
    }

    // Remove all old images and fadein a new one
    var updateImage = function (index, image) {
        // Fade out old div
        $("#pictureSlider div").fadeOut(animationSpeed, function () {
            $(this).remove();
            isAnimating = false;
        });

        var cssMap = {
            'display': "none",
            'background-image': "url('" + image.url + "')",
        }

        // Fade in new one
        $("<div />").css(cssMap)
            // TODO: Remove? This doesn't seem to be actually used...
            //.addClass('clouds')//image.cssclass)
            .prependTo("#pictureSlider")
            .fadeIn(animationSpeed);
    };
    
    // 
    // Public API Methods
    //
    
    // Setup the presentation with a given dataSource
    // Hook up any handlers to respond to changes in the presentation
    // Then setup the bindings for user interaction
    // 
    // Can override default DataSource/Presentation/SyncHelper using options parameter hash
    var setup = function(options) {
        var dataSource = options.dataSource || RedditStream
        var syncHelper = options.helper || CookieHelper
        presentation = options.presentationLogic || Presentation
        
        dataSource.init()
        dataSource.onData(handleData)
        
        presentation.init(dataSource, onSlideChange);
        bindInputs()
        setupCookies(syncHelper)
        setupSubRedditInfo(dataSource)
    }
    
    return { init: function(options) { setup(options || {}) } }
}()

//
// Load presentation when document is ready
//
$(function() {
    // Use the preloader as dataSource
    var options = { dataSource: new Preloader(RedditStream) }
    RedditPresentation.init(options)
});

/* 
    TODO
    test swipe support after refactor
    gif duration
    'delay' time - lock the movement for X ms so user cant just tap tap tap and get an fps bomb
    
    repeat from zero if fetching more fails
        - handle failed ajax better
        - handle no children from ajax
        - handle no images at all
        - handle end of subreddit 
            if (data.after == null) {
                log("No more pages to load from this subreddit, reloading the start");

                // Show the user we're starting from the top
                var numberButton = $("<span />").addClass("numberButton").text("-");
                addNumberButton(numberButton);
            }
*/