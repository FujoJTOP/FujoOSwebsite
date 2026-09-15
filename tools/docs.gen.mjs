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
      { slug: "tau", zh: "τ 问题", en: "The τ problem" },
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
      { slug: "freeze", zh: "冻结面", en: "The freeze surface" },
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
   keeps their query strings in step rather than leaving it to memory. The
   publishing console is not one of them: it lives in tools/, is served by
   tools/admin.mjs, and is never part of the built site. */
const HAND_WRITTEN = [
  "index.html",
  "foc/index.html",
  "fuai/index.html",
  "loment/index.html",
  "bugs/index.html",
  "bugs/submit/index.html",
  "bugs/api/index.html",
  "loment/early-use/index.html",
];

/* -------------------------------------------------------------- helpers */

const flat = SECTIONS.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.id })));
const upFrom = (depth) => "../".repeat(depth);

/* Every page is addressed as a directory, not a file: the host resolves
   `…/tau/` to `…/tau/index.html`, so no address ever shows an extension and
   no server rule is needed to make that true. A section's own index keeps the
   plain section directory (`…/ai/`); only named pages get a directory of their
   own. `depth` is how many `../` it takes to reach the site root from a page. */
const AT = {
  home: "",
  foc: "foc/",
  fuai: "fuai/",
  loment: "loment/",
  docs: "docs/",
  news: "news/",
  bugs: "bugs/",
  start: "docs/start/",
};

function docHref(fromDepth, toSection, toSlug) {
  const tail = toSlug === "index" ? `${toSection}/` : `${toSection}/${toSlug}/`;
  return `${upFrom(fromDepth)}docs/${tail}`;
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

/* ------------------------------------------------------- announcements */
/* Read from content/announcements.json rather than hard-coded: the notice
   changes often, and the admin page edits that file. Chrome, so it is written
   once here and spliced into the hand-written pages between markers. */
const LEVEL_CLASS = { alert: "notice--alert", notice: "notice--notice" };

function loadAnnouncements() {
  const file = join(ROOT, "content", "announcements.json");
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  let pinnedTaken = false;
  return (parsed.announcements || [])
    .filter((a) => {
      if (!a.zh && !a.en) return false; // nothing to say
      if (a.from && today < a.from) return false; // not yet
      if (a.to && today > a.to) return false; // expired
      return true;
    })
    .map((a) => {
      /* Only the first pinned bar is honoured: two of them would both claim
         top: 0 and overlap. The admin page refuses to author the second. */
      const pinned = Boolean(a.pinned) && !pinnedTaken;
      if (pinned) pinnedTaken = true;
      return { ...a, pinned };
    });
}

const ANNOUNCEMENTS = loadAnnouncements();

function announcement(a, indent) {
  const i = indent;
  const zh = a.zh || a.en;
  const en = a.en || zh;
  const level = LEVEL_CLASS[a.level] || LEVEL_CLASS.alert;
  const scroll = a.mode === "scroll";
  const cls = ["notice", level, scroll ? "notice--scroll" : "notice--static"];
  if (a.pinned) cls.push("notice--pinned");

  const item = (hidden) => {
    const attrs = `${hidden ? ' aria-hidden="true"' : ""} data-zh="${esc(zh)}" data-en="${esc(en)}"`;
    const inner = a.href
      ? `<a href="${esc(a.href)}">${esc(zh)}</a>`
      : esc(zh);
    return `${i}      <span class="notice__item"${attrs}>${inner}</span>`;
  };

  const body = scroll
    ? `${i}  <div class="notice__view">
${i}    <div class="notice__track">
${item(false)}
${item(true)}
${i}    </div>
${i}  </div>
${i}  <button class="notice__toggle" type="button" data-ticker-toggle aria-pressed="false">
${i}    <span class="notice__ico" aria-hidden="true"></span>
${i}    <span class="notice__lbl notice__lbl--pause" data-zh="暂停" data-en="Pause">暂停</span>
${i}    <span class="notice__lbl notice__lbl--play" data-zh="继续" data-en="Play">继续</span>
${i}  </button>`
    : `${i}  <p class="notice__view notice__view--static"><span class="notice__item">${
        a.href ? `<a href="${esc(a.href)}">${esc(zh)}</a>` : esc(zh)
      }</span></p>`;

  const close = a.dismissible
    ? `\n${i}  <button class="notice__close" type="button" data-notice-close aria-label="关闭公告" data-zh-aria="关闭公告" data-en-aria="Dismiss this notice">×</button>`
    : "";

  return `${i}<div class="${cls.join(" ")}" role="note" data-notice data-notice-id="${esc(
    a.id || ""
  )}"${scroll ? ' data-paused="false"' : ""}>
${i}  <p class="notice__tag"><span class="notice__pip" aria-hidden="true"></span><span data-zh="公告" data-en="Notice">公告</span></p>
${body}${close}
${i}</div>`;
}

/* Every active announcement, in declared order.

   The restore script is emitted inline, right after the bars and before the
   rest of the document: a dismissed notice has to be gone before the first
   paint, and site.js does not run until the end of <body>. Removing it there
   would show the bar for a frame first. */
function noticeBlock(indent = "    ") {
  if (!ANNOUNCEMENTS.length) return "";
  const bars = ANNOUNCEMENTS.map((a) => announcement(a, indent)).join("\n");
  if (!ANNOUNCEMENTS.some((a) => a.dismissible)) return bars;
  return `${bars}
${indent}<script>
${indent}  (function () {
${indent}    var gone = [];
${indent}    try { gone = JSON.parse(localStorage.getItem("fujo.notice") || "[]"); } catch (e) {}
${indent}    if (!gone.length) return;
${indent}    var bars = document.querySelectorAll("[data-notice-id]");
${indent}    for (var i = 0; i < bars.length; i++) {
${indent}      if (gone.indexOf(bars[i].getAttribute("data-notice-id")) > -1) bars[i].remove();
${indent}    }
${indent}  })();
${indent}</script>`;
}

/* ------------------------------------------------------------- bug board */
/* /bugs/ is data, not markup, for the same reason the notice is: it changes
   whenever a report is understood, and it is spliced into the hand-written
   page between markers. A page that lost its markers would silently stop
   updating, so that is a build failure rather than a no-op.

   An entry is what a report becomes *after* it has been read. The board is the
   record, not the inbox — reports arrive by mail, because this site has no
   server to receive them and no third-party script is allowed on this origin. */
/* Deliberately no accent colour here. A bug's state is a workflow, not a trust
   state, and the two accents are only allowed to name the latter — see the
   design system's rule. The states are told apart by weight instead, the same
   way the docs rail marks where you are. */
const BUG_STATES = {
  open: ["待确认", "Open"],
  unfixed: ["未修", "Unfixed"],
  fixed: ["已修", "Fixed"],
  duplicate: ["重复", "Duplicate"],
  invalid: ["无效", "Invalid"],
  wontfix: ["不予处理", "Won't fix"],
};
const BUG_STATE_ORDER = ["open", "unfixed", "fixed", "duplicate", "invalid", "wontfix"];
/* The two that are still live. Everything else has been closed, and a closed
   bug with no reason written down is the thing this board exists to avoid. */
const BUG_OPEN_STATES = ["open", "unfixed"];
/* Provenance, and the anti-noise mechanism. Anything anyone sends is kept and
   shown as 非官方 — a claim, reproduced by its reporter and by nobody here.
   Only what this project has itself reproduced or judged becomes 官方. That
   split is what stops a bad report from ever reading as our own conclusion:
   the mark is on the row, not in someone's memory of a decision. */
const BUG_ORGS = {
  official: ["官方", "Official"],
  unofficial: ["非官方", "Unofficial"],
};
const BUG_AREAS = {
  kernel: ["内核", "Kernel"],
  language: ["语言", "Language"],
  compat: ["兼容", "Compatibility"],
  ai: ["AI 层", "AI layer"],
  site: ["本站", "This site"],
};

/* Parsed and validated once per run. Both the report link and the board read
   it, and without this the same complaint would be printed twice. */
let BUGS_CACHE = null;
function loadBugs() {
  if (BUGS_CACHE) return BUGS_CACHE;
  const file = join(ROOT, "content", "bugs.json");
  if (!existsSync(file)) return (BUGS_CACHE = { reportTo: "", bugs: [] });
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const bugs = (parsed.bugs || []).filter((b) => b && b.id && (b.zh || b.en));
  const seen = new Set();
  for (const b of bugs) {
    /* An id is the address of a report. Two of them, or one that gets
       renumbered, sends every link anyone kept to the wrong place. */
    if (seen.has(b.id)) problems.push(`content/bugs.json: duplicate id ${b.id}`);
    seen.add(b.id);
    if (!BUG_STATES[b.state]) problems.push(`content/bugs.json: ${b.id} has unknown state "${b.state}"`);
    if (!BUG_AREAS[b.area]) problems.push(`content/bugs.json: ${b.id} has unknown area "${b.area}"`);
    if (typeof b.official !== "boolean")
      problems.push(`content/bugs.json: ${b.id} must say official: true or false`);
    /* Half a record is worse than no record: a closed bug with no reason is
       the thing this board exists to avoid. Only official entries can be
       closed at all — nobody here has the standing to close someone else's
       unverified claim. */
    if (b.official && !BUG_OPEN_STATES.includes(b.state) && !b.res_zh && !b.res_en)
      problems.push(`content/bugs.json: ${b.id} is "${b.state}" with no resolution written`);
    if (!b.official && b.state !== "open")
      problems.push(`content/bugs.json: ${b.id} is unofficial, so its state can only be "open"`);
  }
  return (BUGS_CACHE = { reportTo: parsed.report_to || "", bugs });
}

/* The way in. A page rather than a mailto: this site has no server and no
   third-party script may run on this origin, so the form has to be part of
   the site itself. What it can do without a backend is assemble the report —
   see /bugs/submit/. */
function reportBlock(indent = "                ") {
  return `${indent}<a
${indent}  class="btn btn--primary"
${indent}  href="submit/"
${indent}  data-zh="提交一条 bug"
${indent}  data-en="Report a bug"
${indent}  >提交一条 bug</a
${indent}>`;
}

/* The Early Use sign-up — the one thing on this site that has to send mail.
   A static page cannot, so the form posts to a form-to-email service with a
   plain HTML form: nothing is loaded from anywhere, which is what the origin
   rule actually forbids. The endpoint lives in content/ so that swapping the
   published address for the service's alias is one line rather than a hunt
   through markup — and an address in a public repository is worth removing
   the moment there is something to replace it with. */
function earlyBlock(indent = "          ") {
  const file = join(ROOT, "content", "early-use.json");
  let cfg = {};
  if (existsSync(file)) cfg = JSON.parse(readFileSync(file, "utf8"));
  const endpoint = String(cfg.endpoint || "").trim();
  const i = indent;
  if (!endpoint) {
    return `${i}<p class="muted" data-zh="报名还没开放。" data-en="Sign-ups are not open yet.">报名还没开放。</p>`;
  }
  const next = `${SITE}${AT.loment}early-use/?sent=1`;
  return `${i}<form class="bugform" action="${esc(endpoint)}" method="POST">
${i}  <input type="hidden" name="_subject" value="${esc(cfg.subject || "Loment Early Use")}" />
${i}  <input type="hidden" name="_template" value="table" />
${i}  <input type="hidden" name="_captcha" value="false" />
${i}  <input type="hidden" name="_next" value="${esc(next)}" />
${i}  <input type="text" name="_honey" style="display: none" tabindex="-1" autocomplete="off" aria-hidden="true" />

${i}    <div class="bugform__field">
${i}      <label for="e-name" data-zh="怎么称呼" data-en="What to call you">怎么称呼</label>
${i}      <input id="e-name" name="称呼" type="text" autocomplete="name" required />
${i}    </div>
${i}    <div class="bugform__field">
${i}      <label for="e-mail" data-zh="邮箱" data-en="Email">邮箱</label>
${i}      <p class="bugform__hint" data-zh="报名就是寄一封信给你，所以这个要有。它不会出现在站上任何地方。" data-en="Signing up means a letter to you, so this is the one that has to be right. It is not published anywhere on this site.">报名就是寄一封信给你，所以这个要有。它不会出现在站上任何地方。</p>
${i}      <input id="e-mail" name="邮箱" type="email" autocomplete="email" required />
${i}    </div>
${i}    <div class="bugform__field">
${i}      <label for="e-use" data-zh="想拿它做什么" data-en="What you want to do with it">想拿它做什么</label>
${i}      <p class="bugform__hint" data-zh="一两句就够。这一栏决定的是「早期使用者」这个名单还有没有意义。" data-en="A sentence or two is enough. This is the field that decides whether an “early user” list means anything at all.">一两句就够。这一栏决定的是「早期使用者」这个名单还有没有意义。</p>
${i}      <textarea id="e-use" name="用途" rows="4" required></textarea>
${i}    </div>
${i}    <div class="bugform__field">
${i}      <label for="e-os" data-zh="平时用什么系统" data-en="What you work on">平时用什么系统</label>
${i}      <p class="bugform__hint" data-zh="可选。Windows / Linux / macOS——只影响我提前告诉你哪些坑。" data-en="Optional. Windows / Linux / macOS — it only changes which rough edges I warn you about.">可选。Windows / Linux / macOS——只影响我提前告诉你哪些坑。</p>
${i}      <input id="e-os" name="系统" type="text" autocomplete="off" />
${i}    </div>

${i}    <div class="bugform__actions">
${i}      <button class="btn btn--primary" type="submit" data-zh="提交报名" data-en="Sign up">提交报名</button>
${i}      <button class="btn btn--ghost" type="reset" data-zh="清空" data-en="Clear">清空</button>
${i}    </div>
${i}</form>`;
}

function boardBlock(indent = "        ") {
  const { reportTo, bugs } = loadBugs();
  const i = indent;
  const i2 = i + "  ";

  if (!bugs.length) {
    return `${i}<div class="board" data-board>
${i2}<p class="board__blank" data-zh="还没有条目。" data-en="Nothing on the board yet.">还没有条目。</p>
${i2}<p class="muted small" style="margin-top: var(--s2)" data-zh-html="报进来的东西被读明白之后才会写在这里——这块板子是记录，不是收件箱。怎么报见上面。" data-en-html="A report is written here once it has been read and understood — this board is the record, not the inbox. How to report is above.">报进来的东西被读明白之后才会写在这里——这块板子是记录，不是收件箱。怎么报见上面。</p>
${i}</div>`;
  }

  const count = (s) => bugs.filter((b) => b.state === s).length;
  /* The label carries a count, so it is markup rather than text — which means
     the -html attribute form, where only & and " are escaped and the tags stay
     tags. esc() would turn them into visible angle brackets. */
  const attrHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const chip = (key, zh, en, n, on) => {
    const inner = `<span class="board__n">${n}</span>`;
    return `${i2}  <button type="button" class="board__chip" data-board-state="${key}" aria-pressed="${on}" data-zh-html="${attrHtml(zh + " " + inner)}" data-en-html="${attrHtml(en + " " + inner)}">${esc(zh)} ${inner}</button>`;
  };
  const chips = [
    chip("all", "全部", "All", bugs.length, "true"),
    ...BUG_STATE_ORDER.filter((s) => count(s)).map((s) =>
      chip(s, BUG_STATES[s][0], BUG_STATES[s][1], count(s), "false")
    ),
  ].join("\n");

  const rows = bugs
    .map((b) => {
      const [szh, sen] = BUG_STATES[b.state];
      const [azh, aen] = BUG_AREAS[b.area];
      const org = b.official ? "official" : "unofficial";
      const [ozh, oen] = BUG_ORGS[org];
      const hay = [b.id, b.zh, b.en, b.version, szh, sen, azh, aen, ozh, oen, b.report && b.report.what]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      /* The evidence travels with the report, so it is shown rather than
         merely filed — a title on its own is a claim with the working taken
         out. The labels are the contract's own field names: language-neutral,
         and the same words an agent posts to the API. */
      const proofBody = b.report
        ? ["what", "cmd", "out", "expect", "env"]
            .filter((k) => b.report[k])
            .map((k) => `${k}:\n${b.report[k]}`)
            .join("\n\n")
        : "";
      const proof = proofBody
        ? `<details class="board__proof"><summary data-zh="证据" data-en="Evidence">证据</summary><pre>${esc(
            proofBody
          )}</pre></details>`
        : "";
      const version = b.version
        ? `<span class="board__meta" data-zh="${esc(b.version)}" data-en="${esc(b.version)}">${esc(b.version)}</span>`
        : "";
      const res = b.res_zh || b.res_en
        ? `<span class="board__meta" data-zh="${esc(b.res_zh || b.res_en)}" data-en="${esc(b.res_en || b.res_zh)}">${esc(b.res_zh || b.res_en)}</span>`
        : "";
      const link = b.url ? ` href="${esc(b.url)}"` : "";
      const title = `<a class="board__t"${link} data-zh="${esc(b.zh || b.en)}" data-en="${esc(b.en || b.zh)}">${esc(b.zh || b.en)}</a>`;
      return `${i2}  <tr id="${esc(b.id)}" data-board-row data-state="${esc(b.state)}" data-search="${esc(hay)}">
${i2}    <td class="num board__id">${esc(b.id)}</td>
${i2}    <td>${title}${version}${res}${proof}</td>
${i2}    <td data-zh="${esc(azh)}" data-en="${esc(aen)}">${esc(azh)}</td>
${i2}    <td><span class="tag board__org board__org--${org}" data-zh="${esc(ozh)}" data-en="${esc(oen)}">${esc(ozh)}</span></td>
${i2}    <td><span class="tag board__st board__st--${esc(b.state)}" data-zh="${esc(szh)}" data-en="${esc(sen)}">${esc(szh)}</span></td>
${i2}    <td class="num">${esc(b.reported || "")}</td>
${i2}  </tr>`;
    })
    .join("\n");

  return `${i}<div class="board" data-board>
${i2}<div class="board__bar">
${chips}
${i2}  <label class="board__search">
${i2}    <span data-zh="搜索" data-en="Search">搜索</span>
${i2}    <input type="search" data-board-search autocomplete="off" aria-label="搜索编号或标题" data-zh-aria="搜索编号或标题" data-en-aria="Search by id or title" />
${i2}  </label>
${i2}</div>
${i2}<p class="board__blank" data-board-blank hidden data-zh="没有匹配的条目。" data-en="Nothing matches.">没有匹配的条目。</p>
${i2}<div class="table-wrap" data-board-table>
${i2}  <table>
${i2}    <thead>
${i2}      <tr>
${i2}        <th scope="col" data-zh="编号" data-en="Id">编号</th>
${i2}        <th scope="col" data-zh="标题" data-en="Title">标题</th>
${i2}        <th scope="col" data-zh="线" data-en="Line">线</th>
${i2}        <th scope="col" data-zh="来源" data-en="Source">来源</th>
${i2}        <th scope="col" data-zh="状态" data-en="State">状态</th>
${i2}        <th scope="col" data-zh="报于" data-en="Reported">报于</th>
${i2}      </tr>
${i2}    </thead>
${i2}    <tbody>
${rows}
${i2}    </tbody>
${i2}  </table>
${i2}</div>
${i}</div>`;
}

/* Top nav. `current` is the href of the page being rendered, so the marker
   lands on the right item instead of being hard-coded to Docs. */
function navLinks(up, current) {
  const items = [
    [`${up || "./"}`, "首页", "Home"],
    [`${up}${AT.foc}`, "FOC 内核", "FOC kernel"],
    [`${up}${AT.fuai}`, "FUAI 安全体系", "FUAI safety"],
    [`${up}${AT.loment}`, "Loment · Potato", "Loment · Potato"],
    [`${up}${AT.docs}`, "文档", "Docs"],
    [`${up}${AT.news}`, "新闻", "News"],
    [`${up}${AT.bugs}`, "Bug 社区", "Bug reports"],
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
      `                <a class="docs-side__h" href="${docHref(depth, s.id, "index")}"` +
        ` data-zh="${esc(s.zh)}" data-en="${esc(s.en)}">${esc(s.zh)}</a>`
    );
    parts.push(`                <div class="docs-side__links">`);
    for (const p of s.pages) {
      const here = s.id === sec && p.slug === slug ? ' aria-current="page"' : "";
      parts.push(
        `                  <a href="${docHref(depth, s.id, p.slug)}"${here}` +
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
      `            <a class="pager__link pager__link--${side}" href="${docHref(depth, p.section, p.slug)}">\n` +
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
    `              <a href="${upFrom(depth)}${AT.docs}" data-zh="文档" data-en="Docs">文档</a>`,
    `              <span class="sep" aria-hidden="true">/</span>`,
    `              <a href="${docHref(depth, sec, "index")}" data-zh="${esc(s.zh)}" data-en="${esc(s.en)}">${esc(
      s.zh
    )}</a>`,
  ];
  if (slug !== "index") {
    out.push(`              <span class="sep" aria-hidden="true">/</span>`);
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
      href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500&display=swap"
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
  const pagePath = hub ? AT.docs : slug === "index" ? `docs/${sec}/` : `docs/${sec}/${slug}/`;
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

${noticeBlock()}

    <div class="banner" role="note">
      <div class="banner__inner">
        <b>FujoOS docs</b>
        <span class="sep" aria-hidden="true">|</span>
        <span data-zh="${esc(bannerZh)}" data-en="${esc(bannerEn)}">${esc(bannerZh)}</span>
        <span class="cadence"
          ><span class="dot" aria-hidden="true"></span
          ><span data-zh="任何“完成”都要给出可重放的命令与输出" data-en="any “done” must come with a replayable command and its output">任何“完成”都要给出可重放的命令与输出</span></span
        >
      </div>
    </div>

    <header class="nav">
      <div class="wrap nav__inner">
        <a class="nav__brand" href="${up || "./"}">
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
${navLinks(up, `${up}${AT.docs}`)}
          <div class="lang" role="group" aria-label="语言" data-zh-aria="语言" data-en-aria="Language">
            <button type="button" data-lang="zh" aria-pressed="true">ZH</button>
            <button type="button" data-lang="en" aria-pressed="false">EN</button>
          </div>
        </nav>
        <button class="nav__toggle" type="button" aria-expanded="false" data-zh="菜单" data-en="Menu">菜单</button>
      </div>
      <div class="wrap">
        <div class="nav__drawer" data-open="false">
          <a href="${up || "./"}" data-zh="首页" data-en="Home">首页</a>
          <a href="${up}${AT.foc}" data-zh="FOC 内核" data-en="FOC kernel">FOC 内核</a>
          <a href="${up}${AT.fuai}" data-zh="FUAI 安全体系" data-en="FUAI safety system">FUAI 安全体系</a>
          <a href="${up}${AT.loment}" data-zh="Loment · Potato 语言" data-en="Loment · Potato language">Loment · Potato 语言</a>
          <a href="${up}${AT.docs}" data-zh="文档" data-en="Documentation">文档</a>
          <a href="${up}${AT.start}" data-zh="构建与运行" data-en="Build and run">构建与运行</a>
          <a href="${up}${AT.bugs}" data-zh="Bug 社区" data-en="Bug reports">Bug 社区</a>
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
    /* A section's own index stays at docs/<section>/index.html so its address
       is the plain section directory; a named page moves into a directory of
       its own. That is one level deeper, which is why the depth splits. */
    const isIndex = p.slug === "index";
    const depth = isIndex ? 2 : 3;
    const html = shell({ sec: s.id, slug: p.slug, depth, meta, body });
    const outDir = isIndex ? join(OUT, s.id) : join(OUT, s.id, p.slug);
    const outRel = isIndex ? `docs/${s.id}/` : `docs/${s.id}/${p.slug}/`;
    const outFile = join(outDir, "index.html");
    if (check) {
      if (!existsSync(outFile) || readFileSync(outFile, "utf8") !== html) {
        problems.push(`stale: ${outRel}`);
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
        problems.push("stale: docs/");
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

${noticeBlock()}

    <header class="nav">
      <div class="wrap nav__inner">
        <a class="nav__brand" href="${up || "./"}">
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
          <a href="${up || "./"}" data-zh="首页" data-en="Home">首页</a>
          <a href="${up}${AT.foc}" data-zh="FOC 内核" data-en="FOC kernel">FOC 内核</a>
          <a href="${up}${AT.fuai}" data-zh="FUAI 安全体系" data-en="FUAI safety system">FUAI 安全体系</a>
          <a href="${up}${AT.loment}" data-zh="Loment · Potato 语言" data-en="Loment · Potato language">Loment · Potato 语言</a>
          <a href="${up}${AT.docs}" data-zh="文档" data-en="Documentation">文档</a>
          <a href="${up}${AT.news}" data-zh="新闻" data-en="News">新闻</a>
          <a href="${up}${AT.bugs}" data-zh="Bug 社区" data-en="Bug reports">Bug 社区</a>
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
            <a href="../" data-zh="新闻" data-en="News">新闻</a>
            <span class="sep" aria-hidden="true">/</span>
            <time datetime="${esc(p.date)}">${esc(p.date)}</time>
          </p>
          <h1 class="display news__title" data-zh="${esc(p.meta.zh)}" data-en="${esc(p.meta.en || p.meta.zh)}">${esc(p.meta.zh)}</h1>
          <div class="prose news__body">
${p.body}
          </div>
          <nav class="pager news__pager" aria-label="新闻翻页" data-zh-aria="新闻翻页" data-en-aria="News paging">
            <a class="pager__link pager__link--prev" href="../">
              <span class="pager__dir" data-zh="全部新闻" data-en="All news">全部新闻</span>
              <span class="pager__t" data-zh="新闻列表" data-en="The news list">新闻列表</span>
            </a>
${older ? `            <a class="pager__link pager__link--next" href="../${esc(older.slug)}/">
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
      pagePath: `news/${p.slug}/`,
      up: "../../",
      current: `../../news/`,
      inner,
    });
    /* posts move one level down, so their address is news/<slug>/ */
    const postDir = join(NEWS_OUT, p.slug);
    const outFile = join(postDir, "index.html");
    if (check) {
      if (!existsSync(outFile) || readFileSync(outFile, "utf8") !== html)
        problems.push(`stale: news/${p.slug}/`);
    } else {
      mkdirSync(postDir, { recursive: true });
      writeFileSync(outFile, html);
      written++;
    }
  }

  if (posts.length) {
    const items = posts
      .map(
        (p) => `        <li>
          <time datetime="${esc(p.date)}">${esc(p.date)}</time>
          <a href="${esc(p.slug)}/" data-zh="${esc(p.meta.zh)}" data-en="${esc(p.meta.en || p.meta.zh)}">${esc(p.meta.zh)}</a>
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
      pagePath: AT.news,
      up: "../",
      current: `../news/`,
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
  const BOARD_MARKERS = /([ \t]*)<!-- board:start -->[\s\S]*?<!-- board:end -->/;
  const REPORT_MARKERS = /([ \t]*)<!-- report:start -->[\s\S]*?<!-- report:end -->/;
  const EARLY_MARKERS = /([ \t]*)<!-- early:start -->[\s\S]*?<!-- early:end -->/;
  for (const name of HAND_WRITTEN) {
    const f = join(ROOT, name);
    if (!existsSync(f)) {
      problems.push(`missing hand-written page: ${name}`);
      continue;
    }
    const s = readFileSync(f, "utf8");
    /* Delimited rather than pattern-matched: the notice is chrome, so it is
       written once above and spliced in here, and the anchors make removing
       it later a one-line change. A page that quietly lost its markers would
       silently lose the notice, so that is a build failure, not a no-op. */
    if (!TICKER_MARKERS.test(s)) {
      problems.push(`${name}: missing <!-- ticker:start --> / <!-- ticker:end --> markers`);
      continue;
    }
    /* The board lives on one page only, and it is the same contract as the
       notice: markers or a build failure, never a page that quietly stops
       updating. */
    const hasBoard = BOARD_MARKERS.test(s);
    if (name === "bugs/index.html" && !hasBoard) {
      problems.push(`${name}: missing <!-- board:start --> / <!-- board:end --> markers`);
      continue;
    }
    let next = s
      .replace(/(assets\/style\.css\?v=)[0-9a-f]+/g, `$1${CSS_V}`)
      .replace(/(assets\/site\.js\?v=)[0-9a-f]+/g, `$1${JS_V}`)
      .replace(
        TICKER_MARKERS,
        (m, indent) =>
          `${indent}<!-- ticker:start -->\n${noticeBlock(indent)}\n${indent}<!-- ticker:end -->`
      );
    if (hasBoard) {
      next = next.replace(
        BOARD_MARKERS,
        (m, indent) => `${indent}<!-- board:start -->\n${boardBlock(indent + "  ")}\n${indent}<!-- board:end -->`
      );
      next = next.replace(
        REPORT_MARKERS,
        (m, indent) => `${indent}<!-- report:start -->\n${reportBlock(indent + "  ")}\n${indent}<!-- report:end -->`
      );
    }
    if (EARLY_MARKERS.test(next)) {
      next = next.replace(
        EARLY_MARKERS,
        (m, indent) => `${indent}<!-- early:start -->\n${earlyBlock(indent + "  ")}\n${indent}<!-- early:end -->`
      );
    }
    if (next !== s) {
      if (check) problems.push(`${name}: asset version or notice out of date`);
      else writeFileSync(f, next);
    }
  }
}

/* sitemap + robots, generated from the same tree so they cannot drift */
{
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    "", // the root serves index.html
    AT.foc,
    AT.fuai,
    AT.loment,
    `${AT.loment}early-use/`,
    AT.bugs,
    `${AT.bugs}submit/`,
    `${AT.bugs}api/`,
    AT.docs,
    ...flat.map((p) => (p.slug === "index" ? `docs/${p.section}/` : `docs/${p.section}/${p.slug}/`)),
    ...(POSTS.length ? [AT.news, ...POSTS.map((p) => `news/${p.slug}/`)] : []),
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

  /* tools/ holds the generator and the local publishing console. Pages serves
     it because the whole repository is the site, but it is not part of the
     site: nothing links to it and it should not be indexed. The real console
     runs on 127.0.0.1 and is never published at all. */
  const robots = `User-agent: *\nAllow: /\nDisallow: /tools/\n\nSitemap: ${SITE}sitemap.xml\n`;

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
