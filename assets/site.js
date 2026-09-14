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

  /* ---- marquees ---- */
  /* A loop only closes without a visible gap when the track covers its window
     twice over, and how many copies that takes depends on the reader's
     viewport — nothing the build can know. So the copies are measured in here,
     and the duration is derived from the distance travelled, so a strip moves
     at one speed everywhere instead of one speed per screen.

     Two strips use this: the notice bar, which repeats a text span, and the
     tooling band, which repeats a whole list. Hence `unit`: what gets cloned. */
  var crawlOK = !(
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  function marquee(root, opts) {
    var view = opts.view ? root.querySelector(opts.view) : root;
    var track = root.querySelector(opts.track);
    var unit = track && track.querySelector(opts.unit);
    if (!crawlOK || !view || !track || !unit) return;
    var originals = track.children.length;

    function build() {
      /* back to what the markup ships, so a rebuild after a resize cannot stack
         clones on top of clones */
      while (track.children.length > originals) track.removeChild(track.lastChild);
      /* -50% only lands on a copy boundary when the copy count is even */
      if (track.children.length % 2) {
        var pad = unit.cloneNode(true);
        pad.setAttribute("aria-hidden", "true");
        track.appendChild(pad);
      }
      var need = view.clientWidth * 2;
      var guard = 0;
      do {
        var before = track.scrollWidth;
        var a = unit.cloneNode(true);
        var b = unit.cloneNode(true);
        a.setAttribute("aria-hidden", "true");
        b.setAttribute("aria-hidden", "true");
        track.appendChild(a);
        track.appendChild(b);
        var added = track.scrollWidth - before;
        guard++;
        /* copies are added in pairs so the -50% translation always lands
           exactly on a copy boundary; `added` is the width of that pair */
      } while (track.scrollWidth - added < need && guard < 24);
      var distance = track.scrollWidth / 2;
      if (distance > 0) {
        track.style.setProperty(opts.durVar, (distance / opts.speed).toFixed(1) + "s");
      }
    }
    /* Watching the element itself, not the window. A page can reach this code
       with the strip at zero width — an unlaid-out container, a background tab,
       a pane that has not been sized — and a build measured against zero
       under-copies and leaves a gap in the loop. The observer fires the moment
       it has a real width, and again on rotation or resize.

       The clones live inside an overflow-hidden track, so building cannot
       change the observed element's own size and this cannot loop. */
    if ("ResizeObserver" in window) {
      new ResizeObserver(function () {
        build();
      }).observe(view);
    } else {
      window.addEventListener("resize", build);
    }
    build();
  }

  var noticeNodes = document.querySelectorAll("[data-notice]");
  for (var ti = 0; ti < noticeNodes.length; ti++) {
    (function (root) {
      marquee(root, {
        view: ".notice__view",
        track: ".notice__track",
        unit: ".notice__item",
        speed: 52,
        durVar: "--notice-dur",
      });
      var toggle = root.querySelector("[data-ticker-toggle]");
      if (toggle) {
        toggle.addEventListener("click", function () {
          var paused = root.getAttribute("data-paused") === "true";
          root.setAttribute("data-paused", paused ? "false" : "true");
          toggle.setAttribute("aria-pressed", paused ? "false" : "true");
        });
      }
    })(noticeNodes[ti]);
  }

  /* The band runs slower than the notice: it is there to be noticed in passing,
     and a logo strip that hurries reads as an advertisement. Slow enough to
     look unhurried, not so slow that it looks stopped — at 30px/s a set of six
     names passes in about half a minute. */
  var bands = document.querySelectorAll("[data-marquee]");
  for (var bi = 0; bi < bands.length; bi++) {
    marquee(bands[bi], {
      track: ".built__track",
      unit: ".built__list",
      speed: 30,
      durVar: "--built-dur",
    });
  }

  /* ---- dismissing a notice ---- */
  /* The bar is restored-before-paint by an inline script the generator emits
     next to it; this only records the decision and takes the bar away. */
  var closeBtns = document.querySelectorAll("[data-notice-close]");
  for (var ni = 0; ni < closeBtns.length; ni++) {
    closeBtns[ni].addEventListener("click", function () {
      var bar = this.closest("[data-notice-id]");
      if (!bar) return;
      var id = bar.getAttribute("data-notice-id");
      try {
        var gone = JSON.parse(localStorage.getItem("fujo.notice") || "[]");
        if (gone.indexOf(id) < 0) gone.push(id);
        localStorage.setItem("fujo.notice", JSON.stringify(gone));
      } catch (e) {
        /* storage unavailable: the bar still goes away for this page */
      }
      bar.remove();
    });
  }

  /* ---- bug board ---- */
  /* Filtering is client-side because there is no server to filter on, and the
     list is small enough to ship whole. Rows carry what they match against in
     a single lowercased attribute, so this does not have to know the table's
     shape — adding a column does not touch this code. */
  var board = document.querySelector("[data-board]");
  if (board) {
    var rows = board.querySelectorAll("[data-board-row]");
    var chips = board.querySelectorAll("[data-board-state]");
    var box = board.querySelector("[data-board-search]");
    var table = board.querySelector("[data-board-table]");
    var blank = board.querySelector("[data-board-blank]");
    var state = "all";

    var applyBoard = function () {
      var q = box ? box.value.trim().toLowerCase() : "";
      var shown = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var byState = state === "all" || row.getAttribute("data-state") === state;
        var byText = !q || (row.getAttribute("data-search") || "").indexOf(q) > -1;
        var show = byState && byText;
        row.hidden = !show;
        if (show) shown++;
      }
      if (blank) blank.hidden = shown > 0;
      if (table) table.hidden = rows.length > 0 && shown === 0;
    };

    for (var ci = 0; ci < chips.length; ci++) {
      chips[ci].addEventListener("click", function () {
        state = this.getAttribute("data-board-state");
        for (var k = 0; k < chips.length; k++) {
          chips[k].setAttribute("aria-pressed", chips[k] === this ? "true" : "false");
        }
        applyBoard();
      });
    }
    if (box) box.addEventListener("input", applyBoard);
    applyBoard();
  }

  /* ---- bug report form ---- */
  /* There is no server to post to, so this assembles the report and stops.
     Saying so on the page is the point: a submit button that quietly did
     nothing would be worse than no button at all. */
  var bugForm = document.querySelector("[data-bug-form]");
  if (bugForm) {
    var bugResult = document.querySelector("[data-bug-result]");
    var bugPre = document.querySelector("[data-bug-text]");
    var bugMissing = document.querySelector("[data-bug-missing]");
    var REQUIRED = [
      ["f-what", "哪一句", "which sentence"],
      ["f-cmd", "命令", "the command"],
      ["f-out", "输出", "the output"],
      ["f-expect", "预期", "what you expected"],
    ];
    var valueOf = function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : "";
    };

    bugForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var en = document.documentElement.getAttribute("data-lang") === "en";
      var gap = [];
      for (var fi = 0; fi < REQUIRED.length; fi++) {
        if (!valueOf(REQUIRED[fi][0])) gap.push(REQUIRED[fi][en ? 2 : 1]);
      }
      if (gap.length) {
        if (bugMissing) {
          bugMissing.hidden = false;
          bugMissing.textContent =
            (en ? "Still missing: " : "还差：") +
            gap.join(en ? ", " : "、") +
            (en
              ? ". Without these the report cannot be acted on."
              : "。没有这几样，这条报告没法处理。");
        }
        if (bugResult) bugResult.hidden = true;
        return;
      }
      if (bugMissing) bugMissing.hidden = true;
      var none = en ? "(not given)" : "（未填）";
      var text = [
        (en ? "[which sentence] " : "【哪一句】") + valueOf("f-what"),
        en ? "[command]" : "【命令】",
        valueOf("f-cmd"),
        en ? "[output]" : "【输出】",
        valueOf("f-out"),
        en ? "[expected]" : "【预期】",
        valueOf("f-expect"),
        (en ? "[version] " : "【版本】") + (valueOf("f-version") || none),
        (en ? "[environment] " : "【环境】") + (valueOf("f-env") || none),
      ].join("\n");
      if (bugPre) bugPre.textContent = text;
      if (bugResult) {
        bugResult.hidden = false;
        bugResult.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });
  }

  /* apply saved language now that content above is parsed */
  FJ.applyLang(FJ.saved());
})();
