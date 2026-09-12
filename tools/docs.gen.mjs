#!/usr/bin/env node
/*
 * Generates docs/**\/*.html from _docs-src/**\/*.html.
 *
 * Why a generator: the chrome (banner, top nav, sidebar, breadcrumbs,
 * prev/next, footer) is identical on every page. Writing it by hand 48 times
 * is the exact duplication this project lists as its first pain point, and it
 * drifts. Content lives once in _docs-src/; this script emits the site.
 *
 * The generated HTML is committed, so visitors still get a static, zero-build
 * site — the generator is a development tool, not a runtime dependency.
 *
 *   node tools/docs.gen.mjs          # write docs/
 *   node tools/docs.gen.mjs --check  # fail if output would change
 *
 * Zero third-party dependencies, on purpose.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "_docs-src");
const OUT = join(ROOT, "docs");

/* ------------------------------------------------------------------ nav */

const SECTIONS = [
  {
    id: "start",
    zh: "开始",
    en: "Start",
    pages: [
      { slug: "index", zh: "导览", en: "Overview" },
      { slug: "requirements", zh: "环境要求", en: "Requirements" },
      { slug: "build", zh: "构建内核", en: "Building" },
      { slug: "run", zh: "启动与运行", en: "Running" },
      { slug: "verify", zh: "回归、ISO 与 CI", en: "Regression, ISO and CI" },
    ],
  },
  {
    id: "architecture",
    zh: "架构",
    en: "Architecture",
    pages: [
      { slug: "index", zh: "总览", en: "Overview" },
      { slug: "layers", zh: "分层与内核形态", en: "Layers and kernel shape" },
      { slug: "syscall-gate", zh: "系统调用闸门", en: "The syscall gate" },
      { slug: "memory", zh: "内存与地址空间", en: "Memory and address space" },
      { slug: "process", zh: "进程与隔离", en: "Processes and isolation" },
      { slug: "storage", zh: "存储与 FJFS", en: "Storage and FJFS" },
      { slug: "graphics", zh: "图形与窗口系统", en: "Graphics and windows" },
      { slug: "network", zh: "网络栈", en: "Network stack" },
      { slug: "security", zh: "安全模型", en: "Security model" },
    ],
  },
  {
    id: "ai",
    zh: "AI 层 · FUAI",
    en: "AI layer · FUAI",
    pages: [
      { slug: "index", zh: "总览", en: "Overview" },
      { slug: "proposition", zh: "命题与 S1/S2/S3", en: "Proposition and S1/S2/S3" },
      { slug: "axioms", zh: "A1–A4 公理", en: "Axioms A1–A4" },
      { slug: "capability", zh: "能力域与审计环", en: "Capability domains and audit" },
      { slug: "model-card", zh: "模型卡", en: "Model cards" },
      { slug: "duties", zh: "模型五职责", en: "The five duties" },
      { slug: "trust", zh: "信任自适应域宽", en: "Trust-adaptive width" },
      { slug: "runtime", zh: "运行时与证据链", en: "Runtime and evidence chain" },
      { slug: "box-bridge", zh: "盒桥", en: "Box bridge" },
    ],
  },
  {
    id: "language",
    zh: "语言",
    en: "Language",
    pages: [
      { slug: "quickstart", zh: "快速上手 (Beta)", en: "Quickstart (Beta)" },
      { slug: "index", zh: "总览", en: "Overview" },
      { slug: "loment", zh: "Loment 语言", en: "The Loment language" },
      { slug: "l0", zh: "L0 单一真源", en: "L0 source of truth" },
      { slug: "capability", zh: "能力域即语言构造", en: "Capability as a construct" },
      { slug: "toolchain", zh: "工具链", en: "Toolchain" },
      { slug: "selfhost", zh: "自举", en: "Self-hosting" },
      { slug: "potato", zh: "Potato 形式对象", en: "The Potato object" },
      { slug: "measurement", zh: "波 C 测量", en: "Wave-C measurement" },
    ],
  },
  {
    id: "compat",
    zh: "兼容",
    en: "Compatibility",
    pages: [
      { slug: "index", zh: "总览与口径", en: "Overview and definitions" },
      { slug: "loaders", zh: "四套加载器", en: "Four loaders" },
      { slug: "linux-abi", zh: "Linux ABI", en: "Linux ABI" },
      { slug: "windows", zh: "Windows 垫片", en: "Windows shims" },
      { slug: "fujr", zh: "FUJR 容器", en: "FUJR containers" },
      { slug: "plan", zh: "C01–C15 规划", en: "The C01–C15 plan" },
    ],
  },
  {
    id: "reference",
    zh: "参考",
    en: "Reference",
    pages: [
      { slug: "index", zh: "总览", en: "Overview" },
      { slug: "syscalls", zh: "系统调用", en: "Syscalls" },
      { slug: "opcodes", zh: "FUAI 操作码", en: "FUAI opcodes" },
      { slug: "fui", zh: "FUI 与 .fuc", en: "FUI and .fuc" },
      { slug: "repo", zh: "仓库结构", en: "Repository layout" },
    ],
  },
  {
    id: "project",
    zh: "项目",
    en: "Project",
    pages: [
      { slug: "index", zh: "总览", en: "Overview" },
      { slug: "branches", zh: "开发分支", en: "Development branches" },
      { slug: "network-line", zh: "网络线", en: "The network line" },
      { slug: "roadmap", zh: "路线图", en: "Roadmap" },
      { slug: "verification", zh: "可复现性纪律", en: "Reproducibility discipline" },
      { slug: "limitations", zh: "已知边界", en: "Known limits" },
    ],
  },
];

const PAPER = "https://zenodo.org/records/22352904";
const SITE = "https://fujojtop.github.io/FujoOSwebsite/";
const SITE_NAME = "FujoOS";
const DESC_FALLBACK =
  "FujoOS：从零写起的 x86_64 操作系统内核，以及一套把大语言模型放进内核强制、可撤销信封里的安全体系。";

/* Asset versions are content hashes. A manual number gets forgotten — one
   page shipped asking for v=3 while every other page asked for v=4, which is
   exactly the stale-cache case the version exists to prevent. Hashing the file
   means it cannot be forgotten and cannot disagree between pages. */
function assetVersion(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
}
const CSS_V = assetVersion(join(ROOT, "assets", "style.css"));
const JS_V = assetVersion(join(ROOT, "assets", "site.js"));

/* Pages that are written by hand but reference those assets. The generator
   keeps their query strings in step rather than leaving it to memory. */
const HAND_WRITTEN = ["index.html", "fuai.html", "loment.html"];

/* -------------------------------------------------------------- helpers */

const flat = SECTIONS.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.id })));
const upFrom = (depth) => "../".repeat(depth);

function docHref(fromSection, fromDepth, toSection, toSlug) {
  const up = upFrom(fromDepth);
  return `${up}docs/${toSection}/${toSlug}.html`;
}

function sectionOf(id) {
  return SECTIONS.find((s) => s.id === id);
}

/* Fragment metadata is a JSON comment on the first line:
   <!--{"zh":"...","en":"...","desc":"...","banner_zh":"...","banner_en":"..."}--> */
function parseFragment(raw) {
  const m = raw.match(/^\s*<!--(\{[\s\S]*?\})-->/);
  if (!m) throw new Error("fragment is missing its <!--{...}--> metadata comment");
  return { meta: JSON.parse(m[1]), body: raw.slice(m[0].length).trim() };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* The red announcement bar. Generated rather than hand-written for the reason
   the rest of the chrome is: one message, sixty-ish pages, and a date that
   will move again. Retiring the notice means deleting this function, not
   chasing the markup across the site. */
const NOTICE = {
  zh: "FujoOS公布日延期，以仓库发布为准",
  en: "FujoOS release date postponed — the repository is authoritative",
};

function ticker(indent = "    ") {
  const i = indent;
  const item = (hidden) =>
    `${i}      <span class="ticker__item"${hidden ? ' aria-hidden="true"' : ""} data-zh="${esc(
      NOTICE.zh
    )}" data-en="${esc(NOTICE.en)}">${esc(NOTICE.zh)}</span>`;
  return `${i}<div class="ticker" role="note" data-ticker data-paused="false">
${i}  <p class="ticker__tag"><span class="ticker__pip" aria-hidden="true"></span><span data-zh="公告" data-en="Notice">公告</span></p>
${i}  <div class="ticker__view">
${i}    <div class="ticker__track">
${item(false)}
${item(true)}
${i}    </div>
${i}  </div>
${i}  <button class="ticker__toggle" type="button" data-ticker-toggle aria-pressed="false">
${i}    <span class="ticker__ico" aria-hidden="true"></span>
${i}    <span class="ticker__lbl ticker__lbl--pause" data-zh="暂停" data-en="Pause">暂停</span>
${i}    <span class="ticker__lbl ticker__lbl--play" data-zh="继续" data-en="Play">继续</span>
${i}  </button>
${i}</div>`;
}

/* Top nav. `current` is the href of the page being rendered, so the marker
   lands on the right item instead of being hard-coded to Docs. */
function navLinks(up, current) {
  const items = [
    [`${up}index.html`, "首页", "Home"],
    [`${up}fuai.html`, "FUAI 安全体系", "FUAI safety"],
    [`${up}loment.html`, "Loment · Potato", "Loment · Potato"],
    [`${up}docs/index.html`, "文档", "Docs"],
    [`${up}news/index.html`, "新闻", "News"],
  ];
  const links = items.map(([href, zh, en]) => {
    const here = href === current ? ' aria-current="page"' : "";
    return `          <a class="nav__link" href="${href}"${here} data-zh="${zh}" data-en="${en}">${zh}</a>`;
  });
  links.push(
    `          <a class="nav__link" href="${PAPER}" rel="noopener" data-zh="论文 ↗" data-en="Paper ↗">论文 ↗</a>`
  );
  return links.join("\n");
}

/* Content lint. Markdown emphasis written into an attribute is invisible until
   it renders as literal asterisks in the browser. */
function lintFragment(where, body) {
  const problems = [];
  for (const m of body.matchAll(/\sdata-(zh|en)(-html|-aria|-alt)?="([^"]*)"/g)) {
    if (m[3].includes("**")) {
      problems.push(`${where}: data-${m[1]}${m[2] || ""} contains markdown ** — write <strong>`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------ rendering */

function sidebar(sec, slug, depth) {
  const parts = [];
  for (const s of SECTIONS) {
    const active = s.id === sec ? " docs-side__group--active" : "";
    parts.push(`              <div class="docs-side__group${active}">`);
    parts.push(
      `                <a class="docs-side__h" href="${docHref(sec, depth, s.id, "index")}"` +
        ` data-zh="${esc(s.zh)}" data-en="${esc(s.en)}">${esc(s.zh)}</a>`
    );
    parts.push(`                <div class="docs-side__links">`);
    for (const p of s.pages) {
      const here = s.id === sec && p.slug === slug ? ' aria-current="page"' : "";
      parts.push(
        `                  <a href="${docHref(sec, depth, s.id, p.slug)}"${here}` +
          ` data-zh="${esc(p.zh)}" data-en="${esc(p.en)}">${esc(p.zh)}</a>`
      );
    }
    parts.push(`                </div>`);
    parts.push(`              </div>`);
  }
  return parts.join("\n");
}

function prevNext(sec, slug, depth) {
  const i = flat.findIndex((p) => p.section === sec && p.slug === slug);
  if (i < 0) return "";
  const prev = i > 0 ? flat[i - 1] : null;
  const next = i < flat.length - 1 ? flat[i + 1] : null;
  const cell = (p, side) => {
    if (!p) return `            <span class="pager__spacer"></span>`;
    const dir = side === "prev" ? "上一步" : "下一步";
    const dirEn = side === "prev" ? "Previous" : "Next";
    return (
      `            <a class="pager__link pager__link--${side}" href="${docHref(sec, depth, p.section, p.slug)}">\n` +
      `              <span class="pager__dir" data-zh="${dir}" data-en="${dirEn}">${dir}</span>\n` +
      `              <span class="pager__t" data-zh="${esc(p.zh)}" data-en="${esc(p.en)}">${esc(p.zh)}</span>\n` +
      `            </a>`
    );
  };
  return `          <nav class="pager" aria-label="文档翻页" data-zh-aria="文档翻页" data-en-aria="Documentation paging">\n${cell(
    prev,
    "prev"
  )}\n${cell(next, "next")}\n          </nav>`;
}

function crumbs(sec, slug, depth) {
  const s = sectionOf(sec);
  const p = s.pages.find((x) => x.slug === slug);
  const out = [
    `              <a href="${upFrom(depth)}docs/index.html" data-zh="文档" data-en="Docs">文档</a>`,
    `              <span class="sep">/</span>`,
    `              <a href="${docHref(sec, depth, sec, "index")}" data-zh="${esc(s.zh)}" data-en="${esc(s.en)}">${esc(
      s.zh
    )}</a>`,
  ];
  if (slug !== "index") {
    out.push(`              <span class="sep">/</span>`);
    out.push(`              <span data-zh="${esc(p.zh)}" data-en="${esc(p.en)}">${esc(p.zh)}</span>`);
  }
  return out.join("\n");
}

/* The head is identical on every generated page, so it lives here once. */
function headBlock({ titleZh, desc, pagePath, up, type = "website" }) {
  return `  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(titleZh)}</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${SITE}${pagePath}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:locale" content="zh_CN" />
    <meta property="og:locale:alternate" content="en" />
    <meta property="og:title" content="${esc(titleZh)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${SITE}${pagePath}" />
    <meta property="og:image" content="${SITE}assets/og-card.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="FujoOS — Mount Fuji mark" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="${up}assets/style.css?v=${CSS_V}" />
    <link rel="icon" href="${up}favicon.ico" sizes="48x48" />
    <link rel="icon" type="image/svg+xml" href="${up}assets/favicon.svg" sizes="any" />
    <link rel="icon" type="image/png" href="${up}assets/favicon-32.png" sizes="32x32" />
    <link rel="apple-touch-icon" href="${up}assets/apple-touch-icon.png" />
    <script>
      document.documentElement.classList.add("js");
      /* If site.js never runs, reveal everything instead of leaving it hidden. */
      setTimeout(function () {
        var r = document.documentElement;
        if (!r.hasAttribute("data-motion-on")) r.classList.add("no-motion");
      }, 1200);
    </script>
  </head>`;
}

function shell({ sec, slug, depth, meta, body, hub }) {
  const s = hub ? null : sectionOf(sec);
  const page = hub ? null : s.pages.find((x) => x.slug === slug);
  const up = upFrom(depth);
  /* path from the site root, for canonical and og:url */
  const pagePath = hub ? "docs/index.html" : `docs/${sec}/${slug}.html`;
  let titleZh, titleEn, bannerZh, bannerEn;
  if (hub) {
    titleZh = "文档 — FujoOS";
    titleEn = "Documentation — FujoOS";
    bannerZh = meta.banner_zh || "文档总览";
    bannerEn = meta.banner_en || "Documentation overview";
  } else {
    titleZh = slug === "index" ? `${s.zh} — FujoOS 文档` : `${page.zh} — ${s.zh} — FujoOS 文档`;
    titleEn = slug === "index" ? `${s.en} — FujoOS documentation` : `${page.en} — ${s.en} — FujoOS documentation`;
    bannerZh = meta.banner_zh || page.zh;
    bannerEn = meta.banner_en || page.en;
  }
  const crumbBlock = hub
    ? ""
    : `              <p class="crumbs">\n${crumbs(sec, slug, depth)}\n              </p>\n`;
  const pagerBlock = hub ? "" : `\n${prevNext(sec, slug, depth)}`;

  return `<!DOCTYPE html>
<!-- GENERATED by tools/docs.gen.mjs — edit _docs-src/${sec}/${slug}.html instead. -->
<html
  lang="zh-CN"
  class="theme-datasheet"
  data-title-zh="${esc(meta.zh || page.zh)}"
  data-title-en="${esc(meta.en || page.en)}"
>
${headBlock({ titleZh, desc: meta.desc || "", pagePath, up })}
  <body>
    <a class="skip" href="#main" data-zh="跳到主要内容" data-en="Skip to content">跳到主要内容</a>

${ticker()}

    <div class="banner" role="note">
      <div class="banner__inner">
        <b>FujoOS docs</b>
        <span class="sep">|</span>
        <span data-zh="${esc(bannerZh)}" data-en="${esc(bannerEn)}">${esc(bannerZh)}</span>
        <span class="cadence"
          ><span class="dot" aria-hidden="true"></span
          ><span data-zh="任何“完成”都要给出可重放的命令与输出" data-en="any “done” must come with a replayable command and its output">任何“完成”都要给出可重放的命令与输出</span></span
        >
      </div>
    </div>

    <header class="nav">
      <div class="wrap nav__inner">
        <a class="nav__brand" href="${up}index.html">
          <svg viewBox="0 14 64 46" aria-hidden="true">
            <path d="M3,58 Q11,38 26,16 Q32,19 38,16 Q53,38 61,58 Z" fill="var(--mark-rock)" />
            <path
              d="M15.9,32 Q18,22 26,16 Q32,19 38,16 Q46,22 48.1,32 Q32,38 15.9,32 Z"
              fill="var(--mark-snow)"
            />
          </svg>
          FujoOS
        </a>
        <nav class="nav__links" aria-label="主导航" data-zh-aria="主导航" data-en-aria="Primary">
${navLinks(up, `${up}docs/index.html`)}
          <div class="lang" role="group" aria-label="语言" data-zh-aria="语言" data-en-aria="Language">
            <button type="button" data-lang="zh" aria-pressed="true">ZH</button>
            <button type="button" data-lang="en" aria-pressed="false">EN</button>
          </div>
        </nav>
        <button class="nav__toggle" type="button" aria-expanded="false" data-zh="菜单" data-en="Menu">菜单</button>
      </div>
      <div class="wrap">
        <div class="nav__drawer" data-open="false">
          <a href="${up}index.html" data-zh="首页" data-en="Home">首页</a>
          <a href="${up}fuai.html" data-zh="FUAI 安全体系" data-en="FUAI safety system">FUAI 安全体系</a>
          <a href="${up}loment.html" data-zh="Loment · Potato 语言" data-en="Loment · Potato language">Loment · Potato 语言</a>
          <a href="${up}docs/index.html" data-zh="文档" data-en="Documentation">文档</a>
          <a href="${up}docs/start/index.html" data-zh="构建与运行" data-en="Build and run">构建与运行</a>
        </div>
      </div>
    </header>

    <main id="main">
      <section class="section section--flush" style="padding-top: var(--s5)">
        <div class="wrap">
          <div class="docs-shell">
            <aside class="docs-side" aria-label="文档导航" data-zh-aria="文档导航" data-en-aria="Documentation">
${sidebar(sec, slug, depth)}
            </aside>

            <div class="docs-body">
${crumbBlock}${body}
${pagerBlock}
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="foot">
      <div class="wrap">
        <div class="foot__end" style="border-top: 0; margin-top: 0">
          <span>© <span data-year>2026</span> Yuxuan Jiang · MIT</span>
          <span data-zh="文档与仓库同步 · 以脚本输出为准" data-en="Docs in sync with the repository · scripts are authoritative">文档与仓库同步 · 以脚本输出为准</span>
        </div>
      </div>
    </footer>

    <script src="${up}assets/site.js?v=${JS_V}"></script>
  </body>
</html>
`;
}

/* ------------------------------------------------------------------ run */

const check = process.argv.includes("--check");
let written = 0;
const problems = [];

for (const s of SECTIONS) {
  for (const p of s.pages) {
    const srcFile = join(SRC, s.id, `${p.slug}.html`);
    if (!existsSync(srcFile)) {
      problems.push(`missing source: _docs-src/${s.id}/${p.slug}.html`);
      continue;
    }
    const { meta, body } = parseFragment(readFileSync(srcFile, "utf8"));
    problems.push(...lintFragment(`_docs-src/${s.id}/${p.slug}.html`, body));
    const depth = 2; // docs/<section>/<page>.html
    const html = shell({ sec: s.id, slug: p.slug, depth, meta, body });
    const outDir = join(OUT, s.id);
    const outFile = join(outDir, `${p.slug}.html`);
    if (check) {
      if (!existsSync(outFile) || readFileSync(outFile, "utf8") !== html) {
        problems.push(`stale: docs/${s.id}/${p.slug}.html`);
      }
    } else {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(outFile, html);
      written++;
    }
  }
}

/* the hub lives at docs/index.html, one level higher than the sections */
{
  const srcFile = join(SRC, "_hub.html");
  if (!existsSync(srcFile)) {
    problems.push("missing source: _docs-src/_hub.html");
  } else {
    const { meta, body } = parseFragment(readFileSync(srcFile, "utf8"));
    problems.push(...lintFragment("_docs-src/_hub.html", body));
    const html = shell({ hub: true, depth: 1, meta, body });
    const outFile = join(OUT, "index.html");
    if (check) {
      if (!existsSync(outFile) || readFileSync(outFile, "utf8") !== html) {
        problems.push("stale: docs/index.html");
      }
    } else {
      writeFileSync(outFile, html);
      written++;
    }
  }
}

/* ------------------------------------------------------------------ news */

const NEWS_SRC = join(SRC, "news");
const NEWS_OUT = join(ROOT, "news");

/* Posts are discovered, not listed: adding a file is the whole workflow, and
   the index cannot fall out of sync with what exists. */
function loadPosts() {
  if (!existsSync(NEWS_SRC)) return [];
  return readdirSync(NEWS_SRC)
    .filter((f) => f.endsWith(".html"))
    .map((f) => {
      const { meta, body } = parseFragment(readFileSync(join(NEWS_SRC, f), "utf8"));
      return { slug: f.replace(/\.html$/, ""), meta, body, date: meta.date || "" };
    })
    /* Newest first. Posts sharing a date break on slug descending, which puts
       sequentially named slugs (talk-2 before talk-1) in the right order. */
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? 1 : -1));
}

function newsChrome({ titleZh, titleEn, desc, pagePath, up, current, inner }) {
  return `<!DOCTYPE html>
<!-- GENERATED by tools/docs.gen.mjs — edit _docs-src/news/ instead. -->
<html
  lang="zh-CN"
  class="theme-instrument"
  data-title-zh="${esc(titleZh)}"
  data-title-en="${esc(titleEn)}"
>
${headBlock({ titleZh, desc, pagePath, up, type: "article" })}
  <body>
    <a class="skip" href="#main" data-zh="跳到主要内容" data-en="Skip to content">跳到主要内容</a>

${ticker()}

    <header class="nav">
      <div class="wrap nav__inner">
        <a class="nav__brand" href="${up}index.html">
          <svg viewBox="0 14 64 46" aria-hidden="true">
            <path d="M3,58 Q11,38 26,16 Q32,19 38,16 Q53,38 61,58 Z" fill="var(--mark-rock)" />
            <path d="M15.9,32 Q18,22 26,16 Q32,19 38,16 Q46,22 48.1,32 Q32,38 15.9,32 Z" fill="var(--mark-snow)" />
          </svg>
          FujoOS
        </a>
        <nav class="nav__links" aria-label="主导航" data-zh-aria="主导航" data-en-aria="Primary">
${navLinks(up, current)}
          <div class="lang" role="group" aria-label="语言" data-zh-aria="语言" data-en-aria="Language">
            <button type="button" data-lang="zh" aria-pressed="true">ZH</button>
            <button type="button" data-lang="en" aria-pressed="false">EN</button>
          </div>
        </nav>
        <button class="nav__toggle" type="button" aria-expanded="false" data-zh="菜单" data-en="Menu">菜单</button>
      </div>
      <div class="wrap">
        <div class="nav__drawer" data-open="false">
          <a href="${up}index.html" data-zh="首页" data-en="Home">首页</a>
          <a href="${up}fuai.html" data-zh="FUAI 安全体系" data-en="FUAI safety system">FUAI 安全体系</a>
          <a href="${up}loment.html" data-zh="Loment · Potato 语言" data-en="Loment · Potato language">Loment · Potato 语言</a>
          <a href="${up}docs/index.html" data-zh="文档" data-en="Documentation">文档</a>
          <a href="${up}news/index.html" data-zh="新闻" data-en="News">新闻</a>
        </div>
      </div>
    </header>

    <main id="main">
${inner}
    </main>

    <footer class="foot">
      <div class="wrap">
        <div class="foot__end" style="border-top: 0; margin-top: 0">
          <span>© <span data-year>2026</span> Yuxuan Jiang · MIT</span>
          <span data-zh="新闻按发布时间倒序 · 以仓库为准" data-en="Newest first · the repository is authoritative">新闻按发布时间倒序 · 以仓库为准</span>
        </div>
      </div>
    </footer>

    <script src="${up}assets/site.js?v=${JS_V}"></script>
  </body>
</html>
`;
}

const POSTS = loadPosts();
{
  const posts = POSTS;
  if (posts.length) {
    mkdirSync(NEWS_OUT, { recursive: true });
  }

  for (const [i, p] of posts.entries()) {
    problems.push(...lintFragment(`_docs-src/news/${p.slug}.html`, p.body));
    const older = posts[i + 1];
    const inner = `      <article class="news">
        <div class="wrap">
          <p class="crumbs">
            <a href="index.html" data-zh="新闻" data-en="News">新闻</a>
            <span class="sep">/</span>
            <time datetime="${esc(p.date)}">${esc(p.date)}</time>
          </p>
          <h1 class="display news__title" data-zh="${esc(p.meta.zh)}" data-en="${esc(p.meta.en || p.meta.zh)}">${esc(p.meta.zh)}</h1>
          <div class="prose news__body">
${p.body}
          </div>
          <nav class="pager news__pager" aria-label="新闻翻页" data-zh-aria="新闻翻页" data-en-aria="News paging">
            <a class="pager__link pager__link--prev" href="index.html">
              <span class="pager__dir" data-zh="全部新闻" data-en="All news">全部新闻</span>
              <span class="pager__t" data-zh="新闻列表" data-en="The news list">新闻列表</span>
            </a>
${older ? `            <a class="pager__link pager__link--next" href="${esc(older.slug)}.html">
              <span class="pager__dir" data-zh="上一篇" data-en="Older">上一篇</span>
              <span class="pager__t" data-zh="${esc(older.meta.zh)}" data-en="${esc(older.meta.en || older.meta.zh)}">${esc(older.meta.zh)}</span>
            </a>` : ""}
          </nav>
        </div>
      </article>`;
    const html = newsChrome({
      titleZh: p.meta.zh,
      titleEn: p.meta.en || p.meta.zh,
      desc: p.meta.desc || "",
      pagePath: `news/${p.slug}.html`,
      up: "../",
      current: "../news/index.html",
      inner,
    });
    const outFile = join(NEWS_OUT, `${p.slug}.html`);
    if (check) {
      if (!existsSync(outFile) || readFileSync(outFile, "utf8") !== html)
        problems.push(`stale: news/${p.slug}.html`);
    } else {
      writeFileSync(outFile, html);
      written++;
    }
  }

  if (posts.length) {
    const items = posts
      .map(
        (p) => `        <li>
          <time datetime="${esc(p.date)}">${esc(p.date)}</time>
          <a href="${esc(p.slug)}.html" data-zh="${esc(p.meta.zh)}" data-en="${esc(p.meta.en || p.meta.zh)}">${esc(p.meta.zh)}</a>
          <p data-zh="${esc(p.meta.desc || "")}" data-en="${esc(p.meta.desc_en || p.meta.desc || "")}">${esc(p.meta.desc || "")}</p>
        </li>`
      )
      .join("\n");
    const inner = `      <section class="section section--flush news-index">
        <div class="wrap">
          <h1 class="display news__title" data-zh="新闻" data-en="News">新闻</h1>
          <p class="lede" style="margin-top: var(--s3)" data-zh="关于 FujoOS 的进展、发布与思考。" data-en="Progress, releases and notes on FujoOS.">关于 FujoOS 的进展、发布与思考。</p>
          <ul class="news-list">
${items}
          </ul>
        </div>
      </section>`;
    const html = newsChrome({
      titleZh: "新闻 — FujoOS",
      titleEn: "News — FujoOS",
      desc: "FujoOS 的进展、发布与思考。",
      pagePath: "news/index.html",
      up: "../",
      current: "../news/index.html",
      inner,
    });
    const outFile = join(NEWS_OUT, "index.html");
    if (check) {
      if (!existsSync(outFile) || readFileSync(outFile, "utf8") !== html)
        problems.push("stale: news/index.html");
    } else {
      writeFileSync(outFile, html);
      written++;
    }
  }
}

/* Keep the hand-written pages' asset query strings in step with the hashes.
   Touching only the version token, so nothing else in those files moves. */
{
  const TICKER_MARKERS = /([ \t]*)<!-- ticker:start -->[\s\S]*?<!-- ticker:end -->/;
  for (const name of HAND_WRITTEN) {
    const f = join(ROOT, name);
    const s = readFileSync(f, "utf8");
    /* Delimited rather than pattern-matched: the notice is chrome, so it is
       written once above and spliced in here, and the anchors make removing it
       later a one-line change. A page that quietly lost its markers would
       silently lose the notice, so that is a build failure, not a no-op. */
    if (!TICKER_MARKERS.test(s)) {
      problems.push(`${name}: missing <!-- ticker:start --> / <!-- ticker:end --> markers`);
      continue;
    }
    const next = s
      .replace(/(assets\/style\.css\?v=)[0-9a-f]+/g, `$1${CSS_V}`)
      .replace(/(assets\/site\.js\?v=)[0-9a-f]+/g, `$1${JS_V}`)
      .replace(TICKER_MARKERS, (m, indent) =>
        `${indent}<!-- ticker:start -->\n${ticker(indent)}\n${indent}<!-- ticker:end -->`
      );
    if (next !== s) {
      if (check) problems.push(`${name}: asset version or ticker out of date`);
      else writeFileSync(f, next);
    }
  }
}

/* sitemap + robots, generated from the same tree so they cannot drift */
{
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    "index.html",
    "fuai.html",
    "loment.html",
    "docs/index.html",
    ...flat.map((p) => `docs/${p.section}/${p.slug}.html`),
    ...(POSTS.length ? ["news/index.html", ...POSTS.map((p) => `news/${p.slug}.html`)] : []),
  ];
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>${SITE}${u}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`
      )
      .join("\n") +
    `\n</urlset>\n`;

  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`;

  for (const [file, content] of [
    [join(ROOT, "sitemap.xml"), sitemap],
    [join(ROOT, "robots.txt"), robots],
  ]) {
    if (check) {
      if (!existsSync(file) || readFileSync(file, "utf8") !== content) {
        problems.push(`stale: ${file.replace(ROOT, "").replace(/\\/g, "/")}`);
      }
    } else {
      writeFileSync(file, content);
      written++;
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(check ? `ok — ${flat.length} pages up to date` : `generated ${written} pages`);
