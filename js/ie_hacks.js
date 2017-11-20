
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
if (!window.console) {
    window.console = {};
}
if(!window.console.log) {
    window.log = function () {
        log.history = log.history || []; // store logs to an array for reference
        log.history.push(arguments);
        if (this.console) {
            console.log(Array.prototype.slice.call(arguments));
        }
    };
    window.console.log = window.log;
} else {
    // Chrome users don't need to suffer
    window.log = console.log;
}