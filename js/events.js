/*
  Author: Yuval Greenfield (http://uberpython.wordpress.com) 
 
  You can save the HTML file and use it locally btw like so:
    file:///wherever/index.html?/r/aww
 
  Favicon by Double-J designs http://www.iconfinder.com/icondetails/68600/64/_icon
  HTML based on http://demo.marcofolio.net/fullscreen_image_slider/
  Author of slideshow base :      Marco Kuiper (http://www.marcofolio.net/)
*/

var updateNsfw = function () {
    var val = $("#nsfw").is(':checked');
    redditp.cookies.setNsfw(val);
};

var updateAutoNext = function () {
    var val = $("#autoNextSlide").is(':checked');
    redditp.cookies.setShouldAutoNextSlide(val);
    redditp.resetNextSlideTimer();
};

var updateTimeToNextSlide = function () {
    var val = $('#timeToNextSlide').val();
    redditp.cookies.setTimeToNextSlide(val);
};

var toggleFullScreen = function() {
    var elem = document.getElementById('page')
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
