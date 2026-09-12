/* The publishing console's client.
 *
 * Talks to tools/admin.mjs on the same origin. There is no credential here and
 * nothing to authenticate: writes land in the working tree, and pushing is
 * done by the server with this machine's own git credentials.
 *
 * Editing is direct rather than staged — a save is a file write, and the
 * publish panel reads git to show what that added up to. That is the whole
 * point of running locally: the working tree is the staging area.
 *
 * BASE is the random path segment the server prints, taken from the URL so it
 * never has to be written into this file.
 */
(function () {
  "use strict";

  var BASE = location.pathname.replace(/[^/]*$/, "");
  var state = { news: [], ann: [] };

  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  var esc = function (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var attr = function (s) {
    return esc(s).replace(/"/g, "&quot;");
  };

  function say(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    if (kind) el.setAttribute("data-kind", kind);
    else el.removeAttribute("data-kind");
  }

  function api(path, body) {
    return fetch(BASE + "api/" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data && data.error ? data.error : res.statusText);
        return data;
      });
    });
  }

  /* --------------------------------------------------------------- news */

  function loadState() {
    return api("state").then(function (s) {
      state.news = s.news || [];
      try {
        state.ann = JSON.parse(s.announcements).announcements || [];
      } catch (e) {
        state.ann = [];
      }
      var repo = $("[data-repo]");
      if (repo) repo.textContent = s.repo || "本机";
      renderNews();
      renderAnn();
      loadDiff();
    });
  }

  function renderNews() {
    var box = $("[data-news-list]");
    if (!box) return;
    if (!state.news.length) {
      box.innerHTML = '<p class="adm__hint">还没有新闻。</p>';
      return;
    }
    box.innerHTML = state.news
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

  function saveNews() {
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
    var prior = null;
    state.news.forEach(function (p) {
      if (p.slug === slug) prior = p.meta;
    });
    var meta = Object.assign({}, prior || {});
    meta.zh = zh;
    meta.en = $("[data-f-en]").value.trim() || zh;
    meta.date = $("[data-f-date]").value;
    meta.desc = $("[data-f-desc]").value.trim();
    meta.desc_en = $("[data-f-desc-en]").value.trim() || meta.desc;

    var body = $("[data-f-body]").value;
    var text = "<!--" + JSON.stringify(meta) + "-->\n" + body.trim() + "\n";
    api("write", { path: "news/" + slug + ".html", text })
      .then(function (r) {
        say(status, "已写入 " + r.wrote + "\n在下面的「发布」里提交。", "good");
        return loadState();
      })
      .catch(function (err) {
        say(status, "写入失败：" + err.message, "bad");
      });
  }

  function previewNews() {
    var frame = $("[data-news-frame]");
    var box = $("[data-news-preview-box]");
    if (!frame || !box) return;
    var doc =
      '<!DOCTYPE html><html lang="zh-CN" class="theme-instrument"><head>' +
      '<meta charset="utf-8"><link rel="stylesheet" href="' +
      BASE +
      'assets/style.css"><style>body{padding:1.5rem}</style></head><body>' +
      '<div class="prose news__body">' +
      $("[data-f-body]").value +
      "</div></body></html>";
    frame.setAttribute("srcdoc", doc);
    box.removeAttribute("hidden");
  }

  /* ------------------------------------------------------- announcements */

  function annField(label, key, value, opts) {
    opts = opts || {};
    if (opts.options) {
      return (
        '<label class="field"><span class="field__label">' +
        esc(label) +
        '</span><select class="select" data-a="' +
        attr(key) +
        '">' +
        opts.options
          .map(function (o) {
            return (
              '<option value="' + attr(o[0]) + '"' + (o[0] === value ? " selected" : "") + ">" + esc(o[1]) + "</option>"
            );
          })
          .join("") +
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
    if (!state.ann.length) {
      box.innerHTML = '<p class="adm__hint">没有公告，页面上就不会出现公告条。</p>';
      return;
    }
    box.innerHTML = state.ann
      .map(function (a, i) {
        var otherPinned = state.ann.some(function (b, j) {
          return j !== i && b.pinned;
        });
        return (
          '<div class="card" style="margin-top: var(--s3)" data-a-card="' + i + '">' +
          '<div class="adm__row" style="border-bottom: 0; padding-top: 0">' +
          '<div class="adm__row-t"><b>' + esc(a.zh || "(空)") + "</b><span>" +
          esc(a.id || "无 id") + " · " + (a.level === "notice" ? "黄色" : "红色") + " · " +
          (a.mode === "static" ? "静止" : "滚动") +
          (a.pinned ? " · 置顶" : "") + (a.dismissible ? " · 可关闭" : "") +
          "</span></div>" +
          '<button class="adm__x" type="button" data-a-del="' + i + '" title="移除">×</button>' +
          "</div>" +
          annField("标识 id", "id", a.id, { placeholder: "release-delay" }) +
          annField("级别", "level", a.level, {
            options: [["alert", "红色 — 需要立刻知道"], ["notice", "黄色 — 提示"]],
          }) +
          annField("形态", "mode", a.mode, {
            options: [["scroll", "滚动 — 长句"], ["static", "静止 — 短句"]],
          }) +
          annField("文案（中文）", "zh", a.zh) +
          annField("Copy (English)", "en", a.en) +
          annField("链接（可空）", "href", a.href, { placeholder: "https://… 或 /news/…" }) +
          '<div class="field-row">' +
          annField("开始日期（可空）", "from", a.from, { type: "date" }) +
          annField("结束日期（可空）", "to", a.to, { type: "date" }) +
          "</div>" +
          '<label class="check"><input type="checkbox" data-a="pinned" ' + (a.pinned ? "checked" : "") +
          " /> 置顶（随页面滚动常驻）" +
          (otherPinned && a.pinned ? ' <span style="color: var(--alert)">— 已有另一条置顶，只有第一条生效</span>' : "") +
          '</label><label class="check"><input type="checkbox" data-a="dismissible" ' + (a.dismissible ? "checked" : "") +
          " /> 允许访客关闭</label></div>"
        );
      })
      .join("");
  }

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

  function saveAnn() {
    var status = $("[data-ann-status]");
    var list = collectAnn();
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.id) return say(status, "第 " + (i + 1) + " 条缺 id。", "bad");
      if (seen[a.id]) return say(status, "id 重复：" + a.id, "bad");
      seen[a.id] = true;
      if (!a.zh && !a.en) return say(status, "第 " + (i + 1) + " 条没有文案。", "bad");
    }
    var pinned = list.filter(function (a) {
      return a.pinned;
    });
    if (pinned.length > 1) {
      return say(status, "同时只能有一条置顶，现在有 " + pinned.length + " 条。", "bad");
    }
    var doc = {
      _comment:
        "Announcements shown at the top of every page. Edited from tools/admin.mjs, but it is an ordinary file — edit it by hand and re-run tools/docs.gen.mjs if you prefer. Only the first pinned entry is honoured: two pinned bars would both claim the top of the viewport.",
      announcements: list.map(function (a) {
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
      }),
    };
    api("write", { path: "content/announcements.json", text: JSON.stringify(doc, null, 2) + "\n" })
      .then(function () {
        say(status, "已写入 content/announcements.json。", "good");
        return loadState();
      })
      .catch(function (err) {
        say(status, "写入失败：" + err.message, "bad");
      });
  }

  /* ------------------------------------------------------------- publish */

  function loadDiff() {
    var box = $("[data-diff]");
    if (!box) return;
    return api("diff")
      .then(function (d) {
        var lines = [d.status, d.stat].filter(Boolean).join("\n\n");
        box.innerHTML = lines
          ? "<pre>" + esc(lines) + "</pre>"
          : '<p class="adm__hint">工作区干净，没有待发布的改动。</p>';
      })
      .catch(function (err) {
        box.innerHTML = '<p class="adm__hint">读取 git 状态失败：' + esc(err.message) + "</p>";
      });
  }

  function publish() {
    var status = $("[data-publish-status]");
    say(status, "生成并推送中…");
    api("publish", { message: $("[data-message]").value })
      .then(function (r) {
        var head = r.ok ? (r.changed ? "已推送。" : "工作区没有改动，无需推送。") : "在「" + r.step + "」这一步失败。";
        say(status, head + "\n\n" + r.output, r.ok ? "good" : "bad");
        if (r.ok && r.changed) {
          say(status, head + "\nCI 正在让线上生效，约半分钟后可见。\n\n" + r.output, "good");
        }
        return loadState();
      })
      .catch(function (err) {
        say(status, "失败：" + err.message, "bad");
      });
  }

  /* ---------------------------------------------------------------- wire */

  function init() {
    var on = function (sel, ev, fn) {
      var el = $(sel);
      if (el) el.addEventListener(ev, fn);
    };
    on("[data-news-new]", "click", function () {
      openEditor(null);
    });
    on("[data-news-preview]", "click", previewNews);
    on("[data-news-save]", "click", saveNews);
    on("[data-news-cancel]", "click", function () {
      $("[data-news-editor]").setAttribute("hidden", "");
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
      state.ann = list;
      renderAnn();
    });
    on("[data-ann-save]", "click", saveAnn);
    on("[data-refresh]", "click", loadState);
    on("[data-publish]", "click", publish);

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var edit = t.getAttribute("data-news-edit");
      if (edit) {
        state.news.forEach(function (p) {
          if (p.slug === edit) openEditor(p);
        });
        return;
      }
      var del = t.getAttribute("data-news-del");
      if (del && window.confirm("删除 " + del + "？工作区里的文件会被移除，提交后生效。")) {
        api("delete", { path: "news/" + del + ".html" })
          .then(loadState)
          .catch(function (err) {
            say($("[data-news-status]"), "删除失败：" + err.message, "bad");
          });
        return;
      }
      var ad = t.getAttribute("data-a-del");
      if (ad !== null && ad !== undefined && ad !== "") {
        var list = collectAnn();
        list.splice(Number(ad), 1);
        state.ann = list;
        renderAnn();
      }
    });

    loadState();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
