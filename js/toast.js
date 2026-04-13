window.toastr = (function () {
  function getContainer() {
    var c = document.getElementById("toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "toast-container";
      document.body.appendChild(c);
    }
    return c;
  }

  function show(level, message, title, opts) {
    opts = opts || {};
    var el = document.createElement("div");
    el.className = "toast toast-" + level;
    if (title) {
      var t = document.createElement("div");
      t.className = "toast-title";
      t.textContent = title;
      el.appendChild(t);
    }
    var body = document.createElement("div");
    body.innerHTML = message;
    el.appendChild(body);

    var closeBtn = document.createElement("button");
    closeBtn.className = "toast-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close");
    el.appendChild(closeBtn);

    var timeout = opts.timeOut !== undefined ? opts.timeOut : 15000;
    var timer;

    function dismiss() {
      clearTimeout(timer);
      el.classList.add("fade-out");
      el.addEventListener("transitionend", function () {
        el.remove();
      });
    }

    el.addEventListener("click", dismiss);
    getContainer().appendChild(el);
    if (timeout > 0) timer = setTimeout(dismiss, timeout);
  }

  return {
    info: function (msg, title, opts) {
      show("info", msg, title, opts);
    },
    warning: function (msg, title, opts) {
      show("warning", msg, title, opts);
    },
    error: function (msg, title, opts) {
      show("error", msg, title, opts);
    },
  };
})();
