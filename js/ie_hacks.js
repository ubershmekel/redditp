// https://stackoverflow.com/questions/7742781/why-does-javascript-only-work-after-opening-developer-tools-in-ie-once
// IE doesn't have console.log and fails, wtf...
// I used to use the log history thing, but all browsers have consoles nowadays...
// http://paulirish.com/2009/log-a-lightweight-wrapper-for-consolelog/
// Avoid `console` errors in browsers that lack a console.
(function() {
    var method;
    // eslint-disable-next-line no-empty-function
    var noop = function () {};
    var methods = [
        'assert', 'clear', 'count', 'debug', 'dir', 'dirxml', 'error',
        'exception', 'group', 'groupCollapsed', 'groupEnd', 'info', 'log',
        'markTimeline', 'profile', 'profileEnd', 'table', 'time', 'timeEnd',
        'timeStamp', 'trace', 'warn'
    ];
    var length = methods.length;
    window.console = window.console || {};
    var console = window.console;

    while (length > 0) {
        length -= 1;
        method = methods[length];

        // Only stub undefined methods.
        if (!console[method]) {
            console[method] = noop;
        }
    }
}());


// IE doesn't have indexOf...
if (!Array.indexOf) {
    // eslint-disable-next-line no-extend-native
    Array.prototype.indexOf = function (obj) {
        for (var i = 0; i < this.length; i++) {
            if (this[i] == obj) {
                return i;
            }
        }
        return -1;
    };
}

