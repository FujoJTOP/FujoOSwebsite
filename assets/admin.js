/* FujoOS admin — talks to the GitHub Contents API from the browser.
 *
 * There is no server. The token is a fine-grained PAT scoped to this one
 * repository with Contents read/write, it lives in this browser's storage, and
 * it is sent only to api.github.com. Whatever can read it can write the repo.
 *
 * Edits are staged, not committed as you type: the publish section lists what
 * will be written and deleted, and nothing leaves the browser until you press
 * the button. Each file is one commit — the Contents API has no multi-file
 * commit, and a personal site does not need the extra machinery of the Git
 * Data API to work around that.
 *
 * Deliberately does NOT load site.js: that would rewrite every [data-zh] node
 * and take over document.title, both of which are wrong for a control panel.
 */
(function () {
  "use strict";

  var OWNER = "FujoJTOP";
  var REPO = "FujoOSWebsite";
  var BRANCH = "main";
  var API = "https://api.github.com";
  var TOKEN_KEY = "fujo.admin.token";
  var REPO_URL = "https://github.com/" + OWNER + "/" + REPO;

  var NEWS_DIR = "_docs-src/news";
  var ANN_PATH = "content/announcements.json";

  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ------------------------------------------------------------ storage */

  var token = "";

  function loadToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }
  function saveToken(value, remember) {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, value);
    } catch (e) {
      /* storage unavailable; the token still works for this page */
    }
  }
  function dropToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* nothing to clear */
    }
  }

  /* ------------------------------------------------------------- base64 */
  /* btoa/atob are latin1. News posts are Chinese, so every payload has to go
     through UTF-8 bytes or GitHub stores mojibake. */

  function b64encode(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ----------------------------------------------------------------- api */

  function gh(path, opts) {
    opts = opts || {};
    var headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          data = { message: text };
        }
        if (!res.ok) {
          var err = new Error((data && data.message) || res.statusText);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function contentsPath(path) {
    return "/repos/" + OWNER + "/" + REPO + "/contents/" + path;
  }

  /* A file read, or null when it does not exist yet. */
  function readFile(path) {
    return gh(contentsPath(path) + "?ref=" + BRANCH).then(
      function (d) {
        if (Array.isArray(d)) return null;
        return { text: b64decode(d.content), sha: d.sha };
      },
      function (err) {
        if (err.status === 404) return null;
        throw err;
      }
    );
  }

  function listDir(path) {
    return gh(contentsPath(path) + "?ref=" + BRANCH).then(
      function (d) {
        return Array.isArray(d) ? d : [];
      },
      function (err) {
        if (err.status === 404) return [];
        throw err;
      }
    );
  }

  function putFile(path, text, message, sha) {
    var body = { message: message, content: b64encode(text), branch: BRANCH };
    if (sha) body.sha = sha;
    return gh(contentsPath(path), { method: "PUT", body: body });
  }

  function dropFile(path, message, sha) {
    return gh(contentsPath(path), {
      method: "DELETE",
      body: { message: message, sha: sha, branch: BRANCH },
    });
  }

  /* ------------------------------------------------------------- status */

  function say(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    if (kind) el.setAttribute("data-kind", kind);
    else el.removeAttribute("data-kind");
  }

  /* ------------------------------------------------------------ staging */

  var pending = { writes: {}, deletes: {} };

  function stage(path, text) {
    delete pending.deletes[path];
    pending.writes[path] = text;
    renderPending();
  }
  function stageDelete(path) {
    delete pending.writes[path];
    pending.deletes[path] = true;
    renderPending();
  }
  function clearPending() {
    pending = { writes: {}, deletes: {} };
    renderPending();
  }
  function pendingCount() {
    return Object.keys(pending.writes).length + Object.keys(pending.deletes).length;
  }

  function renderPending() {
    var box = $("[data-pending]");
    if (!box) return;
    var writes = Object.keys(pending.writes);
    var dels = Object.keys(pending.deletes);
    if (!writes.length && !dels.length) {
      box.innerHTML = '<p class="adm__hint">还没有暂存的改动。</p>';
      return;
    }
    var rows = [];
    writes.forEach(function (p) {
      rows.push(
        '<div class="adm__row"><div class="adm__row-t"><b>' +
          esc(p) +
          '</b><span>写入</span></div></div>'
      );
    });
    dels.forEach(function (p) {
      rows.push(
        '<div class="adm__row"><div class="adm__row-t"><b>' +
          esc(p) +
          '</b><span>删除</span></div></div>'
      );
    });
    box.innerHTML = rows.join("");
  }

  var esc = function (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var attr = function (s) {
    return esc(s).replace(/"/g, "&quot;");
  };

  /* ------------------------------------------------------- news fragments */
  /* A fragment is a JSON comment on the first line followed by the body. The
     generator's parser is the authority on that shape; this mirrors it. */

  function parseFragment(raw) {
    var m = raw.match(/^\s*<!--(\{[\s\S]*?\})-->/);
    if (!m) return { meta: {}, body: raw.trim(), hadMeta: false };
    var meta = {};
    try {
      meta = JSON.parse(m[1]);
    } catch (e) {
      meta = {};
    }
    return { meta: meta, body: raw.slice(m[0].length).trim(), hadMeta: true };
  }

  function buildFragment(meta, body) {
    return "<!--" + JSON.stringify(meta) + "-->\n" + body.trim() + "\n";
  }

  /* ------------------------------------------------------------- connect */

  function setConnected(login) {
    $$("[data-needs-auth]").forEach(function (s) {
      if (login) s.removeAttribute("hidden");
      else s.setAttribute("hidden", "");
    });
    $$("[data-conn]").forEach(function (n) {
      n.textContent = login ? login + " · " + OWNER + "/" + REPO : "未连接";
    });
    $$(".adm__dot").forEach(function (n) {
      n.setAttribute("data-state", login ? "ok" : "idle");
    });
  }

  function connect() {
    var status = $("[data-conn-status]");
    var field = $("[data-token]");
    var value = (field && field.value.trim()) || token;
    if (!value) {
      say(status, "先填一个令牌。", "bad");
      return;
    }
    token = value;
    say(status, "验证中…");
    gh("/user")
      .then(function (user) {
        return gh("/repos/" + OWNER + "/" + REPO).then(function (repo) {
          var remember = $("[data-remember]") && $("[data-remember]").checked;
          saveToken(token, remember);
          setConnected(user.login);
          say(
            status,
            "已连接 " +
              user.login +
              "\n仓库 " +
              repo.full_name +
              " · 默认分支 " +
              repo.default_branch +
              (repo.default_branch === BRANCH ? "" : "（本站写的是 " + BRANCH + "，不一致）") +
              "\n令牌权限 " +
              (repo.permissions && repo.permissions.push ? "可写 ✓" : "只读 ✗ — 需要一个有 Contents 写权限的令牌"),
            repo.permissions && repo.permissions.push ? "good" : "bad"
          );
          return loadAll();
        });
      })
      .catch(function (err) {
        setConnected(null);
        say(status, "连接失败：" + err.message, "bad");
      });
  }

  /* ---------------------------------------------------------------- news */

  var newsState = { files: [], editing: null };

  function loadAll() {
    return Promise.all([loadNews(), loadAnnouncements()]);
  }

  function loadNews() {
    var box = $("[data-news-list]");
    if (box) box.innerHTML = '<p class="adm__hint">读取中…</p>';
    return listDir(NEWS_DIR)
      .then(function (entries) {
        var files = entries.filter(function (e) {
          return e.type === "file" && /\.html$/.test(e.name);
        });
        return Promise.all(
          files.map(function (e) {
            var slug = e.name.replace(/\.html$/, "");
            return readFile(NEWS_DIR + "/" + e.name).then(function (f) {
              var parsed = parseFragment(f ? f.text : "");
              return { slug: slug, meta: parsed.meta, body: parsed.body };
            });
          })
        );
      })
      .then(function (posts) {
        posts.sort(function (a, b) {
          var da = a.meta.date || "";
          var db = b.meta.date || "";
          if (da !== db) return da < db ? 1 : -1;
          return a.slug < b.slug ? 1 : -1;
        });
        newsState.files = posts;
        renderNews();
      })
      .catch(function (err) {
        if (box) box.innerHTML = '<p class="adm__hint">读取失败：' + esc(err.message) + "</p>";
      });
  }

  function renderNews() {
    var box = $("[data-news-list]");
    if (!box) return;
    if (!newsState.files.length) {
      box.innerHTML = '<p class="adm__hint">还没有新闻。</p>';
      return;
    }
    box.innerHTML = newsState.files
      .map(function (p) {
        return (
          '<div class="adm__row">' +
          '<div class="adm__row-t"><b>' +
          esc(p.meta.zh || p.slug) +
          "</b><span>" +
          esc(p.meta.date || "无日期") +
          " · " +
          esc(p.slug) +
          "</span></div>" +
          '<div class="adm__row-acts">' +
          '<button class="btn btn--ghost" type="button" data-news-edit="' +
          attr(p.slug) +
          '">编辑</button>' +
          '<button class="adm__x" type="button" data-news-del="' +
          attr(p.slug) +
          '" title="删除">×</button>' +
          "</div></div>"
        );
      })
      .join("");
  }

  function openEditor(post) {
    var ed = $("[data-news-editor]");
    if (!ed) return;
    newsState.editing = post ? post.slug : null;
    ed.removeAttribute("hidden");
    $("[data-editor-title]").textContent = post ? "编辑：" + post.slug : "新建";
    var m = (post && post.meta) || {};
    $("[data-f-slug]").value = (post && post.slug) || "";
    $("[data-f-slug]").disabled = Boolean(post);
    $("[data-f-zh]").value = m.zh || "";
    $("[data-f-en]").value = m.en || "";
    $("[data-f-date]").value = m.date || new Date().toISOString().slice(0, 10);
    $("[data-f-desc]").value = m.desc || "";
    $("[data-f-desc-en]").value = m.desc_en || "";
    $("[data-f-body]").value = (post && post.body) || "";
    say($("[data-news-status]"), "");
    var box = $("[data-news-preview-box]");
    if (box) box.setAttribute("hidden", "");
    ed.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function stageNews() {
    var status = $("[data-news-status]");
    var slug = $("[data-f-slug]").value.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      say(status, "文件名只能用 a–z、0–9 和连字符，且不能以连字符开头。", "bad");
      return;
    }
    var zh = $("[data-f-zh]").value.trim();
    if (!zh) {
      say(status, "标题不能为空。", "bad");
      return;
    }
    /* keep any keys this editor does not show (banner_zh and friends) */
    var prior = null;
    newsState.files.forEach(function (p) {
      if (p.slug === slug) prior = p.meta;
    });
    var meta = Object.assign({}, prior || {});
    meta.zh = zh;
    meta.en = $("[data-f-en]").value.trim() || zh;
    meta.date = $("[data-f-date]").value;
    meta.desc = $("[data-f-desc]").value.trim();
    meta.desc_en = $("[data-f-desc-en]").value.trim() || meta.desc;

    var path = NEWS_DIR + "/" + slug + ".html";
    stage(path, buildFragment(meta, $("[data-f-body]").value));
    say(
      status,
      "已暂存 " + path + "\n（提交后 CI 会重新生成 news/" + slug + "/）",
      "good"
    );
    loadNews();
  }

  function previewNews() {
    var frame = $("[data-news-frame]");
    var box = $("[data-news-preview-box]");
    if (!frame || !box) return;
    var body = $("[data-f-body]").value;
    var doc =
      "<!DOCTYPE html><html lang=\"zh-CN\" class=\"theme-instrument\"><head>" +
      '<meta charset="utf-8"><link rel="stylesheet" href="../assets/style.css">' +
      "<style>body{padding:1.5rem}</style></head><body>" +
      '<div class="prose news__body">' +
      body +
      "</div></body></html>";
    frame.setAttribute("srcdoc", doc);
    box.removeAttribute("hidden");
  }

  /* ------------------------------------------------------- announcements */

  var annState = [];

  function loadAnnouncements() {
    return readFile(ANN_PATH)
      .then(function (f) {
        var data = { announcements: [] };
        if (f) {
          try {
            data = JSON.parse(f.text);
          } catch (e) {
            say($("[data-ann-status]"), "announcements.json 不是合法 JSON：" + e.message, "bad");
          }
        }
        annState = data.announcements || [];
        renderAnn();
      })
      .catch(function (err) {
        say($("[data-ann-status]"), "读取公告失败：" + err.message, "bad");
      });
  }

  function annField(label, key, value, opts) {
    opts = opts || {};
    if (opts.options) {
      var options = opts.options
        .map(function (o) {
          return (
            '<option value="' +
            attr(o[0]) +
            '"' +
            (o[0] === value ? " selected" : "") +
            ">" +
            esc(o[1]) +
            "</option>"
          );
        })
        .join("");
      return (
        '<label class="field"><span class="field__label">' +
        esc(label) +
        '</span><select class="select" data-a="' +
        attr(key) +
        '">' +
        options +
        "</select></label>"
      );
    }
    return (
      '<label class="field"><span class="field__label">' +
      esc(label) +
      '</span><input class="input" type="' +
      (opts.type || "text") +
      '" data-a="' +
      attr(key) +
      '" value="' +
      attr(value == null ? "" : value) +
      '"' +
      (opts.placeholder ? ' placeholder="' + attr(opts.placeholder) + '"' : "") +
      " /></label>"
    );
  }

  function renderAnn() {
    var box = $("[data-ann-list]");
    if (!box) return;
    if (!annState.length) {
      box.innerHTML = '<p class="adm__hint">没有公告，页面上就不会出现公告条。</p>';
      return;
    }
    box.innerHTML = annState
      .map(function (a, i) {
        var pinnedElsewhere = annState.some(function (b, j) {
          return j !== i && b.pinned;
        });
        return (
          '<div class="card" style="margin-top: var(--s3)" data-a-card="' +
          i +
          '">' +
          '<div class="adm__row" style="border-bottom: 0; padding-top: 0">' +
          '<div class="adm__row-t"><b>' +
          esc(a.zh || "(空)") +
          "</b><span>" +
          esc(a.id || "无 id") +
          " · " +
          (a.level === "notice" ? "黄色" : "红色") +
          " · " +
          (a.mode === "static" ? "静止" : "滚动") +
          (a.pinned ? " · 置顶" : "") +
          (a.dismissible ? " · 可关闭" : "") +
          "</span></div>" +
          '<button class="adm__x" type="button" data-a-del="' +
          i +
          '" title="移除">×</button>' +
          "</div>" +
          annField("标识 id", "id", a.id, { placeholder: "release-delay" }) +
          annField("级别", "level", a.level, {
            options: [
              ["alert", "红色 — 需要立刻知道"],
              ["notice", "黄色 — 提示"],
            ],
          }) +
          annField("形态", "mode", a.mode, {
            options: [
              ["scroll", "滚动 — 长句"],
              ["static", "静止 — 短句"],
            ],
          }) +
          annField("文案（中文）", "zh", a.zh) +
          annField("Copy (English)", "en", a.en) +
          annField("链接（可空）", "href", a.href, { placeholder: "https://… 或 /news/…" }) +
          '<div class="field-row">' +
          annField("开始日期（可空）", "from", a.from, { type: "date" }) +
          annField("结束日期（可空）", "to", a.to, { type: "date" }) +
          "</div>" +
          '<label class="check"><input type="checkbox" data-a="pinned" ' +
          (a.pinned ? "checked" : "") +
          " /> 置顶（随页面滚动常驻）" +
          (pinnedElsewhere && a.pinned
            ? ' <span style="color: var(--alert)">— 已有另一条置顶，只有第一条生效</span>'
            : "") +
          "</label>" +
          '<label class="check"><input type="checkbox" data-a="dismissible" ' +
          (a.dismissible ? "checked" : "") +
          " /> 允许访客关闭</label>" +
          "</div>"
        );
      })
      .join("");
  }

  /* read every card back out of the DOM */
  function collectAnn() {
    return $$("[data-a-card]").map(function (card) {
      var out = {};
      $$("[data-a]", card).forEach(function (el) {
        var key = el.getAttribute("data-a");
        out[key] = el.type === "checkbox" ? el.checked : el.value.trim();
      });
      return out;
    });
  }

  function stageAnn() {
    var status = $("[data-ann-status]");
    var list = collectAnn();
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.id) {
        say(status, "第 " + (i + 1) + " 条缺 id。", "bad");
        return;
      }
      if (seen[a.id]) {
        say(status, "id 重复：" + a.id, "bad");
        return;
      }
      seen[a.id] = true;
      if (!a.zh && !a.en) {
        say(status, "第 " + (i + 1) + " 条没有文案。", "bad");
        return;
      }
    }
    var pinned = list.filter(function (a) {
      return a.pinned;
    });
    if (pinned.length > 1) {
      say(status, "同时只能有一条置顶，现在有 " + pinned.length + " 条。", "bad");
      return;
    }
    var cleaned = list.map(function (a) {
      return {
        id: a.id,
        level: a.level,
        mode: a.mode,
        pinned: Boolean(a.pinned),
        dismissible: Boolean(a.dismissible),
        zh: a.zh,
        en: a.en,
        href: a.href || "",
        from: a.from || "",
        to: a.to || "",
      };
    });
    var doc = {
      _comment:
        "Announcements shown at the top of every page. Edited from /admin/, but it is an ordinary file — edit it by hand and re-run tools/docs.gen.mjs if you prefer. Only the first pinned entry is honoured: two pinned bars would both claim the top of the viewport.",
      announcements: cleaned,
    };
    stage(ANN_PATH, JSON.stringify(doc, null, 2) + "\n");
    annState = cleaned;
    renderAnn();
    say(status, "已暂存 " + cleaned.length + " 条公告。", "good");
  }

  /* ------------------------------------------------------------- publish */

  function publish() {
    var status = $("[data-publish-status]");
    if (!pendingCount()) {
      say(status, "没有要提交的改动。", "bad");
      return;
    }
    var writes = Object.keys(pending.writes);
    var dels = Object.keys(pending.deletes);
    say(status, "提交中… 0/" + (writes.length + dels.length));
    var done = 0;
    var total = writes.length + dels.length;

    function step(i) {
      if (i >= total) {
        clearPending();
        say(
          status,
          "已提交 " +
            total +
            " 个文件。\nCI 正在重新生成站点，约半分钟后生效：\n" +
            REPO_URL +
            "/actions",
          "good"
        );
        return loadAll();
      }
      var isWrite = i < writes.length;
      var path = isWrite ? writes[i] : dels[i - writes.length];
      var message = (isWrite ? "admin: update " : "admin: remove ") + path;
      return readFile(path)
        .then(function (cur) {
          if (isWrite) return putFile(path, pending.writes[path], message, cur && cur.sha);
          return cur ? dropFile(path, message, cur.sha) : null;
        })
        .then(function () {
          done++;
          say(status, "提交中… " + done + "/" + total);
          return step(i + 1);
        })
        .catch(function (err) {
          say(
            status,
            "在第 " +
              (i + 1) +
              " 个文件（" +
              path +
              "）失败：" +
              err.message +
              "\n之前的已经提交，剩下的仍在待发布清单里。",
            "bad"
          );
        });
    }
    step(0);
  }

  /* ---------------------------------------------------------------- wire */

  function init() {
    token = loadToken();
    var field = $("[data-token]");
    if (field && token) field.value = token;
    if (token) connect();

    var on = function (sel, ev, fn) {
      var el = $(sel);
      if (el) el.addEventListener(ev, fn);
    };

    on("[data-connect]", "click", connect);
    on("[data-forget]", "click", function () {
      dropToken();
      token = "";
      if (field) field.value = "";
      setConnected(null);
      say($("[data-conn-status]"), "令牌已清除。", "good");
    });

    on("[data-news-new]", "click", function () {
      openEditor(null);
    });
    on("[data-news-preview]", "click", previewNews);
    on("[data-news-stage]", "click", stageNews);
    on("[data-news-cancel]", "click", function () {
      var ed = $("[data-news-editor]");
      if (ed) ed.setAttribute("hidden", "");
    });

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var edit = t.getAttribute("data-news-edit");
      if (edit) {
        newsState.files.forEach(function (p) {
          if (p.slug === edit) openEditor(p);
        });
        return;
      }
      var del = t.getAttribute("data-news-del");
      if (del && window.confirm("删除 " + del + "？会进入待发布清单，提交后生效。")) {
        stageDelete(NEWS_DIR + "/" + del + ".html");
        loadNews();
        return;
      }
      var ad = t.getAttribute("data-a-del");
      if (ad !== null && ad !== undefined && ad !== "") {
        var list = collectAnn();
        list.splice(Number(ad), 1);
        annState = list;
        renderAnn();
        return;
      }
    });

    on("[data-ann-add]", "click", function () {
      var list = collectAnn();
      list.push({
        id: "notice-" + new Date().toISOString().slice(0, 10),
        level: "notice",
        mode: "static",
        pinned: false,
        dismissible: false,
        zh: "",
        en: "",
        href: "",
        from: "",
        to: "",
      });
      annState = list;
      renderAnn();
    });
    on("[data-ann-list]", "input", function () {
      /* typing in the announcement editor is not staged until the button is
         pressed, but the list has to be collected before any re-render */
    });
    on("[data-ann-stage]", "click", stageAnn);
    on("[data-publish]", "click", publish);
    on("[data-discard]", "click", function () {
      if (pendingCount() && window.confirm("丢弃全部暂存改动？")) clearPending();
    });

    setConnected(null);
    renderPending();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* a small handle for driving the page from the console while testing */
  window.FJA = {
    publish: publish,
    stage: stage,
    stageDelete: stageDelete,
    getPending: function () {
      return pending;
    },
  };
})();
