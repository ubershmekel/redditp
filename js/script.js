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

var CookieHelper = function() {
	var cookieDays = 300
	
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
	
	// Sync inputs to cookies
	var syncState = function(element, cookieName, bindevent, getState, setState) {
		var saveState = function(val) {
			setState(val, element)
			setCookie(cookieName, val, cookieDays);
		}

		// Load value from store
		var cookieValue = getCookie(cookieName, cookieDays);
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
		syncState(
			$(selector), 
			getCookieName(selector),
			'change',
			function(element) {
				return $(element).prop('checked')
			},
			function(value, element) {
				var val = (value + '') === 'true'
				onSet(val)
				$(element).prop('checked', val)
			}
		)
	}

	var syncInput = function(selector, onSet) {
		syncState(
			$(selector),
			getCookieName(selector),
			'keyup',
			function(element) {
				return $(element).val()
			},
			function(value, element) {
				var f = value
				$(element).val(f)
				onSet(f)
			}
		)
	}

	return {
		// Syncs a cookies value with the an input element
		// selector : string : stringJQuery selector for finding input to sync
		// onSet : Callback(newvalue, element) : called when input state changes
		sync: function(selector, onSet) {
			var type = $(selector).attr('type')
		
			switch(type) {
				case 'checkbox': return syncCheckbox(selector, onSet)
				case 'text': return syncInput(selector, onSet)
				default: throw 'unsupported input type'
			}
		}
	}
}()

var RedditUrlHelper = function() {
	var urlString = ''
	var imgExtensions = ['.jpg', '.jpeg', '.gif', '.bmp', '.png']
	var self
	
	var init = function(hostname) {
		self = this
		var path = parsePath(window.location.href);
		self.host = hostname || 'http://www.reddit.com'
			
		urlString = self.host + path.subreddit + '.json?jsonp=?&after=#$#REPLACE#$#&' + path.getVars
	}
	
	var getNextUrl = function() {
		return urlString.replace('#$#REPLACE#$#', self.lastSeen)
	}

	var isImageExtension = function (url) {
	    var dotLocation = url.lastIndexOf('.')
	    if (dotLocation < 0) {
	        log("skipped no dot: " + url)
	        return false;
	    }

	    var extension = url.substring(dotLocation)
	    return (imgExtensions.indexOf(extension) >= 0)
	}

	var parsePath = function (url) {
	    var regex = new RegExp("(/(?:(?:r)|(?:user)|(?:domain))/[^&#?]*)[?]?(.*)")
	    var results = regex.exec(url)

	    if (results === null) { results = ['zero the hero', '/', ''] }
	
		return { 
			subreddit: results[1], 
			getVars: decodeURIComponent(results[2].replace(/\+/g, " ")) 
		}
	}
	
	var getValidImageUrl = function(url) {
		// ignore albums and things that don't seem like image files
  		if (isImageExtension(url)) { return url } 
		return tryConvertUrl(url)
	}
	
	var tryConvertUrl = function (url) {
		// albums aren't supported yet
   		if (url.indexOf('imgur.com') >= 0 && url.indexOf('/a/') < 0) {
	        	// imgur is really nice and serves the image with whatever extension
	        	// you give it. '.jpg' is arbitrary
				// TODO: If the subreddit is gif related then assume this is .gif
	        	return url + '.jpg'
	    }

	    return ''
	}
	
	return {
		lastSeen: '',
		init: init,
		host: '',
		nextUrl: getNextUrl,
		getValidImage: getValidImageUrl
	}	
}();

// 
// Core Logic
//

var RedditStream = function() {
	var photos = []
	var pendingCallbacks = []
	var onData
	var urlHelper
	var self
	
	// Returns true if the index was already loaded
	var getIndex = function(index, callback) {
		if (index >= photos.length) {
			// Need to load image
			getData(function() { getIndex(index, callback); });
			return false;
		} else {
			callback(photos[index])
			return true;
		}
	}
	
	var getData = function(callback) {
		pendingCallbacks.push(callback); 
		if (pendingCallbacks.length > 1) { return; }
		
	    var handleData = function (response) {
	        data = response.data
	        // NOTE: if data.after is null then this causes us to start
	        // from the top on the next getNextImages which is fine.
			urlHelper.lastSeen = data.after;

	        if (data.children.length == 0) {
	            log("No data from this url :(");
	            return;
	        }
			
			// Save all the data and call the bufferCallback if given
			var oldLength = photos.length;
	        $.each(data.children, function (i, item) {
				// Try to salvage images
				item.data.url = urlHelper.getValidImage(item.data.url)
	            if (item.data.url != '') {
					item.data.permalink = urlHelper.host + item.data.permalink
					photos.push(item.data)
				}
	        });
	
			if(onData) { onData(oldLength, photos) }
			
			// Allow the next waiting request to go!
			var toExec = pendingCallbacks;
			pendingCallbacks = [];
			$.each(toExec, function(i, item) { item(); });
	    };
	
		$.ajax({
		    url: urlHelper.nextUrl(),
		    dataType: 'json',
		    success: handleData,
		    error: function (data) {
	        	log("Failed ajax, maybe a bad url? Sorry about that :(");
	    	}
	    });
	}
	
	var init = function(options) {
		var o = options || {}
		self = this
		onData = o.ondata;
		urlHelper = o.helper || RedditUrlHelper;
		urlHelper.init(o.hostname);
	}
	
	return {
		name: 'Reddit',
		init: init,
		getIndex: getIndex
	}
}();

var Presentation = function() {
	var current = {}
	var dataSource
	var onProgress
	var allowNSFW = false
	var autoMove = {
		waitTime: -3000,
		timeout: 0
	}
	var self
	
	var init = function(source, onprogress) {
		self = this
		dataSource = source
		onProgress = onprogress
		
		if (typeof onProgress !== 'function') {
			throw 'Must supply function arguments to presentation'
		}
		
		// Go to initial image
		move(0)
	}
	
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
	
	var transitionTo = function(index, reverse) {
		// If it's NaN then default to zero, and account for negative indices
		var i = Math.max(index || 0, 0)
		if (i == current.index) { return }
		
		var isInMemory = dataSource.getIndex(i, function(photo) {
			// set current, else if you keep going below zero it's infinite callstack eventually
			current.index = i
			
			if (!allowNSFW && photo.over_18) {
				var nextTry = reverse ? i - 1 : i + 1

				return transitionTo(nextTry, reverse)
			}
			
			currentPhoto = photo
			onProgress(current.index, photo.title, photo)
		});
		
		if (!isInMemory) {
			onProgress(current.index, 'Fetching data from ' + dataSource.name)
		}
	
		// TODO: Preload X more images
	
		tryAutoMove()
	}
	
	/*
		TODO:
		// maybe checkout http://engineeredweb.com/blog/09/12/preloading-images-jquery-and-javascript/ for implementing the old precache
		// Arguments are image paths relative to the current page.
		var preLoadImages = function () {
		    var args_len = arguments.length;
		    for (var i = args_len; i--;) {
		        var cacheImage = document.createElement('img');
		        cacheImage.src = arguments[i];
		        cache.push(cacheImage);
		    }
		};
	*/
	
	var setAutoMoveEnabled = function(enabled) {
		var sign = enabled ? 1 : -1
		autoMove.waitTime = sign * Math.abs(autoMove.waitTime)
		
		tryAutoMove()
	}
	
	// Delaytime in ms
	var setAutoMoveWaitTime = function(val) {
		if (autoMove.waitTime > 0) {
			autoMove.waitTime = Math.abs(val)
		} else {
			autoMove.waitTime = -Math.abs(val)	
		}
		
		tryAutoMove()
	}
	
	var tryAutoMove = function() {
		// always clear the timeouts on any change/retrigger
		clearTimeout(autoMove.timeout)
		
		// do nothing if disabled or above 5fps (sane limit)
		if (autoMove.waitTime < 200) { return; }
		
		// TODO: when gif duration gets added
		//var waitTime = autoMoveWaitTime;
		//if (currentPhoto && currentPhoto.gifduration) {
		//	waitTime += currentPhoto.gifduration
		//}
		
		autoMove.timeout = setTimeout(function(){ move('+')}, 
										autoMove.waitTime);
	}
	
	var setAllowNSFW = function(allowed) {
		allowNSFW = allowed
		
		if (!allowNSFW && current.photo && current.photo.over_18) {
			move('+')
		}
	}
		
	return {
		init: init,
		move: move, // Takes either a number or +1 / -1 // + / -
		setAutoMoveEnabled: setAutoMoveEnabled,
		setAutoMoveWaitTime: setAutoMoveWaitTime,
		setAllowNSFW: setAllowNSFW,
		preloadCount: 3,
	}
}();

// 
// Core UI Logic
//
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
	
	var init = function(options) {
		setup(options || {})
	}
	
	var setup = function(options) {
		var dataSource = options.dataSource || RedditStream
		var syncHelper = options.helper || CookieHelper
		presentation = options.presentationLogic || Presentation
		
		dataSource.init({ ondata: handleData });
		presentation.init(dataSource, onSlideChange);
		bindInputs()
		setupCookies(syncHelper)
	}
	
	var onSlideChange = function(index, text, photo) {
		if (photo) {
			changeImage(index, photo)
		} else {
			setDescription(text)
		}
	}
	
	var handleData = function(startIndex, data) {
		// Check if the nsfw flag makes sense
		ensureNsfwFilterMakesSense(data)
		
		// Add number buttons for each of the new images
		$.each(data.slice(startIndex), function(i, photo) { 
			addNumberButton(startIndex + i, photo) 
		})
	}
	
	var ensureNsfwFilterMakesSense = function(photos) {
		// Cases when you forgot NSFW off but went to /r/nsfw can cause strange bugs,
	    // let's help the user when over 80% of the content is NSFW.
	    var nsfwCount = ($(photos).filter(function(index, photo) {
			return photo.over_18
		}).length * 1.0)
   
	    if(nsfwCount / photos.length > 0.8) { setNSFWAllowed(true) }
	}
	
	var changeImage = function(index, photo) {
		updateNavigationTexts(index, photo);
		updateImage(index, photo);
	}

	var setDescription = function(text) { $('#navboxTitle').html(text); }

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
		// 		Adding data-move to any div available at document.ready will make it a button :3
		$('div[data-move]').click(function() { 
			changeSlide($(this).data('move')); 
		});
	
		// Bind all number buttons
		//		If using jQuery > 1.7 update this to .on('click', 'li a', function(){...})
		// 		This will be more efficient than adding an event handler to every link
		$('div.numberButtonList').delegate('li a', 'click', function() {
			changeSlide($(this).data('index'));
		});
		
		bindKeyboard();
		bindSwipeControls();
		setupCollapsers();
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

	var addNumberButton = function (index, photo) {
		var numberButton = $("<a />").html(index + 1)
					        	.data("index", index)
					        	.attr("title", photo.title)
								.addClass("numberButton")
								.toggleClass('over18', photo.over_18)

	    var navboxUls = $(".navbox ul");
	    var thisNavboxUl = navboxUls[navboxUls.length - 1];

	    var newListItem = $("<li />").appendTo(thisNavboxUl);
	    numberButton.appendTo(newListItem);

	    // so li's have a space between them and can word-wrap in the box
	    navboxUls.append(document.createTextNode(' '));
	}

	// Update UI with new relevant texts
	var updateNavigationTexts = function (index, photo) {
	    setDescription(photo.title)
	    $('#navboxLink').attr({
			'href': photo.url,
			'title': photo.title
		});
	
		$('#navboxCommentsLink').attr({ 
			'href': photo.permalink,
			'title': "Comments on reddit"
		});
	
		updateActiveButton(index);
	};

	// Update which button is active, uses data-index value
	var updateActiveButton = function(index) {
		$('div.numberButtonList li a')
			// Ensure we only have one active at a time
			.removeClass('active')
			// Find the button with the index and addClass only for it
			.filter(function() { return $(this).data('index') == index })
			.addClass('active')
	}

	// Setup the new image, will remove all old images and fadein a new one
	var updateImage = function (index, photo) {
	    // Create a new div and apply the CSS
	    var cssMap = {
	    	'display': "none",
	    	'background-image': "url(" + photo.url + ")",
		}

	    // Fade out old div
		$("#pictureSlider div").fadeOut(animationSpeed, function () {
	        $(this).remove();
	        isAnimating = false;
	    });

		// Fade in new one
		$("<div />").css(cssMap)
			// TODO: Remove? This doesn't seem to be actually used...
			//.addClass('clouds')//photo.cssclass)
			.prependTo("#pictureSlider")
			.fadeIn(animationSpeed);
	};
	
	return { init: init }
}()

//
// Load presentation when document is ready
//
$(RedditPresentation.init);

/* 
	TODO
	test swipe support after refactor
	preloading X next images
	gif duration
	
	reverse number order in navbox? (more likely to actually see what number you're at)
	f for fullscreen?
	
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
	
	TODO::
	// setup subreddit link and page title
	visitSubredditUrl = redditBaseUrl + subredditUrl + getVarsQuestionMark;
    $('#subredditUrl').html("<a href='" + visitSubredditUrl + "'>" + subredditName + "</a>");
  
    document.title = "redditP - " + subredditName;
*/