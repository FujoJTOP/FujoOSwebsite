/* FujoOS site — nav, language, hero sequence. No dependencies. */
(function () {
  "use strict";

  var FJ = (window.FJ = window.FJ || {});
  var STORE = "fujo.lang";
  var DEFAULT_LANG = "zh";

  FJ.saved = function () {
    try {
      var v = localStorage.getItem(STORE);
      if (v === "zh" || v === "en") return v;
    } catch (e) {
      /* storage unavailable */
    }
    return DEFAULT_LANG;
  };

  FJ.applyLang = function (lang) {
    if (lang !== "en") lang = "zh";
    var root = document.documentElement;
    root.setAttribute("data-lang", lang);
    root.setAttribute("lang", lang === "en" ? "en" : "zh-CN");

    var nodes = document.querySelectorAll("[data-zh]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = el.getAttribute(lang === "en" ? "data-en" : "data-zh");
      if (text != null && el.textContent !== text) el.textContent = text;
    }
    var rich = document.querySelectorAll("[data-zh-html]");
    for (var j = 0; j < rich.length; j++) {
      var r = rich[j];
      var html = r.getAttribute(lang === "en" ? "data-en-html" : "data-zh-html");
      if (html != null && r.innerHTML !== html) r.innerHTML = html;
    }
    var attrs = document.querySelectorAll("[data-zh-aria]");
    for (var k = 0; k < attrs.length; k++) {
      var a = attrs[k];
      var val = a.getAttribute(lang === "en" ? "data-en-aria" : "data-zh-aria");
      if (val != null) a.setAttribute("aria-label", val);
    }

    var alts = document.querySelectorAll("[data-zh-alt]");
    for (var n = 0; n < alts.length; n++) {
      var im = alts[n];
      var av = im.getAttribute(lang === "en" ? "data-en-alt" : "data-zh-alt");
      if (av != null) im.setAttribute("alt", av);
    }

    var titleZh = root.getAttribute("data-title-zh");
    if (titleZh) {
      var titleEn = root.getAttribute("data-title-en") || titleZh;
      document.title = lang === "en" ? titleEn : titleZh;
    }

    var toggles = document.querySelectorAll(".lang button");
    for (var m = 0; m < toggles.length; m++) {
      var pressed = toggles[m].getAttribute("data-lang") === lang;
      toggles[m].setAttribute("aria-pressed", pressed ? "true" : "false");
    }
  };

  FJ.setLang = function (lang) {
    try {
      localStorage.setItem(STORE, lang);
    } catch (e) {
      /* ignore */
    }
    FJ.applyLang(lang);
  };

  /* ---- language toggle ---- */
  var langBtns = document.querySelectorAll(".lang button");
  for (var b = 0; b < langBtns.length; b++) {
    langBtns[b].addEventListener("click", function () {
      FJ.setLang(this.getAttribute("data-lang"));
    });
  }

  /* ---- mobile drawer ---- */
  var toggle = document.querySelector(".nav__toggle");
  var drawer = document.querySelector(".nav__drawer");
  if (toggle && drawer) {
    toggle.addEventListener("click", function () {
      var open = drawer.getAttribute("data-open") === "true";
      drawer.setAttribute("data-open", open ? "false" : "true");
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
    });
  }

  /* ---- copy code ---- */
  var copyBtns = document.querySelectorAll(".code__copy");
  for (var c = 0; c < copyBtns.length; c++) {
    copyBtns[c].addEventListener("click", function () {
      var block = this.closest(".code");
      var pre = block && block.querySelector("pre");
      if (!pre) return;
      var btn = this;
      var done = function () {
        var prev = btn.textContent;
        btn.textContent = btn.getAttribute("data-copied") || "copied";
        setTimeout(function () {
          btn.textContent = prev;
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pre.innerText).then(done, done);
      } else {
        done();
      }
    });
  }

  /* ---- modal dialogs ---- */
  var openers = document.querySelectorAll("[data-modal-open]");
  for (var oi = 0; oi < openers.length; oi++) {
    openers[oi].addEventListener("click", function () {
      var dlg = document.getElementById(this.getAttribute("data-modal-open"));
      if (!dlg) return;
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
    });
  }
  var closers = document.querySelectorAll("[data-modal-close]");
  for (var ci = 0; ci < closers.length; ci++) {
    closers[ci].addEventListener("click", function () {
      var dlg = this.closest("dialog");
      if (!dlg) return;
      if (typeof dlg.close === "function") dlg.close();
      else dlg.removeAttribute("open");
    });
  }
  var modals = document.querySelectorAll("dialog.modal");
  for (var di = 0; di < modals.length; di++) {
    modals[di].addEventListener("click", function (e) {
      if (e.target === this) this.close();
    });
  }

  /* ---- entrance sequences: one orchestrated moment per page ---- */
  /* tells the head timeout that scripting is alive, so it must not reveal */
  document.documentElement.setAttribute("data-motion-on", "");

  var scopes = document.querySelectorAll("[data-motion]");
  /* dash lengths are measured, not guessed, so each stroke draws exactly once */
  for (var si = 0; si < scopes.length; si++) {
    var marks = scopes[si].querySelectorAll(".draw");
    for (var d = 0; d < marks.length; d++) {
      var len = 1200;
      try {
        len = Math.ceil(marks[d].getTotalLength()) || 1200;
      } catch (e) {
        /* geometry unavailable; the fallback keeps the whole stroke visible */
      }
      marks[d].style.setProperty("--len", len);
    }
  }
  function reveal(el) {
    if (!el.classList.contains("is-loaded")) el.classList.add("is-loaded");
  }

  /* A scope above the fold plays immediately; one further down waits until it
     is actually on screen, so the sequence is seen rather than spent unseen. */
  if (scopes.length) {
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(
        function (entries) {
          for (var ei = 0; ei < entries.length; ei++) {
            if (entries[ei].isIntersecting) {
              reveal(entries[ei].target);
              io.unobserve(entries[ei].target);
            }
          }
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0 }
      );
      for (var oi = 0; oi < scopes.length; oi++) io.observe(scopes[oi]);
    } else {
      for (var fi = 0; fi < scopes.length; fi++) reveal(scopes[fi]);
    }

    /* Backstop: observers do not deliver in a background tab, so anything
       on screen by now is revealed outright. Below-fold scopes are left to
       the observer; nothing on this site can end up stuck invisible. */
    setTimeout(function () {
      for (var bi = 0; bi < scopes.length; bi++) {
        var r = scopes[bi].getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) reveal(scopes[bi]);
      }
    }, 1000);
  }

  /* ---- stamp ---- */
  var years = document.querySelectorAll("[data-year]");
  for (var y = 0; y < years.length; y++) years[y].textContent = new Date().getFullYear();

  /* apply saved language now that content above is parsed */
  FJ.applyLang(FJ.saved());
})();
