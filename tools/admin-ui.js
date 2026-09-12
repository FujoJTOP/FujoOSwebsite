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

  /* ---------------------------------------------------------- 简洁 markup */
  /* A deliberately tiny subset: blank-line paragraphs, ## and ### headings,
     and three inline forms. It covers everything the existing posts use
     except the interview's Q/A layout — which is exactly why raw mode still
     exists, and why openEditor falls back to it rather than mangling a post
     it cannot represent. */

  function inlineToHtml(s) {
    var h = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    return h;
  }

  function inlineToText(html) {
    return String(html)
      .replace(/<strong>([\s\S]*?)<\/strong>/g, "**$1**")
      .replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
      .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
      .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, "[$2]($1)")
      .replace(/<[^>]+>/g, "");
  }

  /* A hard-wrapped line should join with a space only where two Latin words
     meet; a wrapped Chinese paragraph must not grow stray spaces. */
  function joinLines(lines) {
    return lines.reduce(function (acc, ln) {
      if (!acc) return ln;
      return acc + (/[A-Za-z0-9]$/.test(acc) && /^[A-Za-z0-9]/.test(ln) ? " " : "") + ln;
    }, "");
  }

  function parseDoc(text) {
    return String(text || "")
      .split(/\n\s*\n/)
      .map(function (b) {
        return b.trim();
      })
      .filter(Boolean)
      .map(function (b) {
        var m;
        if ((m = b.match(/^###\s+([\s\S]*)$/))) return { tag: "h3", html: inlineToHtml(joinLines(m[1].split("\n"))) };
        if ((m = b.match(/^##\s+([\s\S]*)$/))) return { tag: "h2", html: inlineToHtml(joinLines(m[1].split("\n"))) };
        return { tag: "p", html: inlineToHtml(joinLines(b.split("\n"))) };
      });
  }

  function docToText(blocks) {
    return blocks
      .map(function (b) {
        var t = inlineToText(b.html);
        return b.tag === "h2" ? "## " + t : b.tag === "h3" ? "### " + t : t;
      })
      .join("\n\n");
  }

  var INDENT = "              ";

  function buildBody(zhText, enText) {
    var zh = parseDoc(zhText);
    var en = enText.trim() ? parseDoc(enText) : [];
    if (!zh.length && !en.length) return "";
    var n = Math.max(zh.length, en.length);
    var out = [];
    for (var i = 0; i < n; i++) {
      var z = zh[i] || en[i];
      var e = en[i] || zh[i];
      /* an element carries either data-zh or data-zh-html, never both, and
         the two languages have to agree on which */
      var suffix = /<[a-z]/.test(z.html) || /<[a-z]/.test(e.html) ? "-html" : "";
      var q = function (s) {
        return s.replace(/"/g, "&quot;");
      };
      /* Block text on its own line, matching how the existing fragments are
         written. Putting it on the tag's line renders identically but rewrites
         every paragraph on every save, and a diff that reformats the whole
         post hides the one sentence that actually changed. */
      out.push(
        INDENT + "<" + z.tag + " data-zh" + suffix + '="' + q(z.html) + '" data-en' + suffix + '="' + q(e.html) + '">\n' +
          INDENT + "  " + z.html + "\n" +
          INDENT + "</" + z.tag + ">"
      );
    }
    return out.join("\n");
  }

  /* The reverse, for editing an existing post. Returns simple:false when the
     fragment contains something this subset cannot express. */
  var SIMPLE = { P: 1, H2: 1, H3: 1 };
  function bodyToDoc(bodyHtml) {
    var d = document.createElement("div");
    d.innerHTML = bodyHtml || "";
    var blocks = [];
    for (var i = 0; i < d.children.length; i++) {
      var el = d.children[i];
      if (!SIMPLE[el.tagName]) return { simple: false, blocks: [] };
      blocks.push({
        tag: el.tagName.toLowerCase(),
        zh: el.getAttribute("data-zh-html") || el.getAttribute("data-zh") || el.innerHTML,
        en: el.getAttribute("data-en-html") || el.getAttribute("data-en") || "",
      });
    }
    return { simple: true, blocks: blocks };
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

  function currentMode() {
    var picked = $$('input[name="bodymode"]').filter(function (r) {
      return r.checked;
    })[0];
    return picked ? picked.value : "text";
  }

  function setMode(mode) {
    $$('input[name="bodymode"]').forEach(function (r) {
      r.checked = r.value === mode;
    });
    $("[data-mode-text]").hidden = mode !== "text";
    $("[data-mode-raw]").hidden = mode !== "raw";
    updateCount();
  }

  function updateCount() {
    var el = $("[data-count-note]");
    if (!el) return;
    if (currentMode() !== "text") {
      el.textContent = "";
      return;
    }
    var z = parseDoc($("[data-f-body-zh]").value).length;
    var e = parseDoc($("[data-f-body-en]").value).length;
    if (!z && !e) {
      el.textContent = "";
    } else if (!e || z === e) {
      el.textContent = "  中文 " + z + " 段，英文 " + e + " 段。";
    } else {
      el.textContent = "  中文 " + z + " 段、英文 " + e + " 段，数目不一致——多出来的段两种语言都会显示中文。";
    }
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

    /* Split an existing fragment back into the two languages. If it uses
       anything the subset cannot express — the interview's Q/A blocks, say —
       fall back to raw HTML rather than quietly reshaping the post. */
    var conv = post ? bodyToDoc(post.body) : { simple: true, blocks: [] };
    if (conv.simple) {
      var pick = function (key) {
        return conv.blocks.map(function (b) {
          return { tag: b.tag, html: b[key] };
        });
      };
      $("[data-f-body-zh]").value = docToText(pick("zh"));
      $("[data-f-body-en]").value = docToText(pick("en"));
      setMode("text");
    } else {
      setMode("raw");
      $("[data-raw-note]").textContent =
        "这篇用了简洁模式表达不了的结构（例如访谈的问答版式），所以按原始 HTML 编辑。改成简洁模式会丢掉版式。";
    }

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

    var body =
      currentMode() === "raw"
        ? $("[data-f-body]").value
        : buildBody($("[data-f-body-zh]").value, $("[data-f-body-en]").value);
    if (!body.trim()) {
      say(status, "正文是空的。", "bad");
      return;
    }
    var text = "<!--" + JSON.stringify(meta) + "-->\n" + body.replace(/\s+$/, "") + "\n";
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
    var body =
      currentMode() === "raw"
        ? $("[data-f-body]").value
        : buildBody($("[data-f-body-zh]").value, $("[data-f-body-en]").value);
    var doc =
      '<!DOCTYPE html><html lang="zh-CN" class="theme-instrument"><head>' +
      '<meta charset="utf-8"><link rel="stylesheet" href="' +
      BASE +
      'assets/style.css"><style>body{padding:1.5rem}</style></head><body>' +
      '<div class="prose news__body">' +
      body +
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
        var parts = [];
        if (d.status || d.stat) {
          parts.push("<pre>" + esc([d.status, d.stat].filter(Boolean).join("\n\n")) + "</pre>");
        } else {
          parts.push('<p class="adm__hint">没有待发布的改动。</p>');
        }
        if (d.other) {
          parts.push(
            '<p class="adm__hint">下面这些<strong>不属于发布范围</strong>，提交时会留在工作区：</p>' +
              "<pre>" + esc(d.other) + "</pre>"
          );
        }
        box.innerHTML = parts.join("");
      })
      .catch(function (err) {
        box.innerHTML = '<p class="adm__hint">读取 git 状态失败：' + esc(err.message) + "</p>";
      });
  }

  function publish() {
    var status = $("[data-publish-status]");
    /* Show what will be committed before committing it. The first version of
       this went straight to the push, and a publish from someone else's
       session carried away work that was not theirs. */
    api("diff")
      .then(function (d) {
        if (!d.status) {
          say(status, "没有待发布的改动。", "bad");
          return;
        }
        var names = d.status
          .split("\n")
          .map(function (l) {
            return "  " + l.slice(3);
          })
          .join("\n");
        if (!window.confirm("将要生成并推送这些文件：\n\n" + names + "\n\n继续？")) return;
        say(status, "生成并推送中…");
        return api("publish", { message: $("[data-message]").value }).then(function (r) {
          var head = r.ok ? (r.changed ? "已推送。" : "没有需要提交的改动。") : "在「" + r.step + "」这一步失败。";
          var tail = r.ok && r.changed ? "\nCI 正在让线上生效，约半分钟后可见。" : "";
          say(status, head + tail + "\n\n" + r.output, r.ok ? "good" : "bad");
          return loadState();
        });
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

    /* the body format switch, and a live count so a mismatch between the two
       languages is visible while writing rather than after publishing */
    $$('input[name="bodymode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        setMode(this.value);
      });
    });
    ["[data-f-body-zh]", "[data-f-body-en]"].forEach(function (sel) {
      var el = $(sel);
      if (el) el.addEventListener("input", updateCount);
    });
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
