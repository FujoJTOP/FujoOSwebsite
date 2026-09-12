#!/usr/bin/env node
/*
 * Local publishing console.
 *
 *   node tools/admin.mjs        # then open the URL it prints
 *
 * Why this exists rather than a page on the site: a browser cannot run the
 * generator (it needs node:fs), and a browser that can write to the repository
 * has to hold a credential for it. Running locally removes both problems —
 * the generator runs here, and pushing uses the git credentials already on
 * this machine. No token, no GitHub API, no secret in a browser.
 *
 * "Only we few can publish" is therefore not enforced here. It is enforced by
 * GitHub: whoever is a collaborator on the repository can push, and nobody
 * else can. This tool is a convenience for people who already have that.
 *
 * Zero third-party dependencies, like everything else in tools/.
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, ".."));

const NEWS_DIR = join(ROOT, "_docs-src", "news");
const ANN_FILE = join(ROOT, "content", "announcements.json");

/* Every write is confined to these two places. A bug in the UI, or a stray
   request, must not be able to clobber the generator or the built site. */
const WRITABLE = [resolve(NEWS_DIR), resolve(ANN_FILE)];
function writable(target) {
  const p = resolve(target);
  if (p === resolve(ANN_FILE)) return true;
  return p.startsWith(resolve(NEWS_DIR) + sep);
}

/* What a publish is allowed to commit: the two places this tool writes, plus
   everything the generator emits from them. Anything else in the working tree
   belongs to whoever is editing it and is left alone.
 *
 * This is not a nicety. Publishing used to run `git add -A`, and the first
 * time someone else published while I had half-finished work in the tree,
 * their commit swept it up under their name. A publish must commit what the
 * publish did and nothing more. */
const PUBLISH_PATHS = [
  "_docs-src/news",
  "content/announcements.json",
  "docs",
  "news",
  "index.html",
  "fuai",
  "loment",
  "sitemap.xml",
  "robots.txt",
];

const HOST = "127.0.0.1";
/* A random path segment. Without it any page in any browser could POST to
   this server — localhost is reachable from anywhere the browser goes, so a
   console that trusts every caller is a console any website can drive. */
const TOKEN = randomBytes(12).toString("hex");
const PORT = Number(process.env.PORT || 4319);

/* --------------------------------------------------------------- helpers */

const readBody = (req) =>
  new Promise((ok, bad) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 4_000_000) {
        bad(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => ok(data));
    req.on("error", bad);
  });

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
};

function run(cmd, args, opts = {}) {
  return new Promise((ok) => {
    execFile(cmd, args, { cwd: ROOT, maxBuffer: 8 << 20, ...opts }, (err, stdout, stderr) =>
      ok({ code: err ? err.code || 1 : 0, stdout: stdout || "", stderr: stderr || "" })
    );
  });
}

/* --------------------------------------------------------------- the app */

function listNews() {
  const out = [];
  if (!existsSync(NEWS_DIR)) return out;
  for (const f of readdirSync(NEWS_DIR)) {
    if (!f.endsWith(".html")) continue;
    const raw = readFileSync(join(NEWS_DIR, f), "utf8");
    const m = raw.match(/^\s*<!--(\{[\s\S]*?\})-->/);
    let meta = {};
    if (m) {
      try {
        meta = JSON.parse(m[1]);
      } catch {
        meta = {};
      }
    }
    out.push({
      slug: f.replace(/\.html$/, ""),
      meta,
      body: m ? raw.slice(m[0].length).trim() : raw.trim(),
    });
  }
  out.sort((a, b) => {
    const da = a.meta.date || "";
    const db = b.meta.date || "";
    if (da !== db) return da < db ? 1 : -1;
    return a.slug < b.slug ? 1 : -1;
  });
  return out;
}

function fragment(meta, body) {
  return "<!--" + JSON.stringify(meta) + "-->\n" + body.trim() + "\n";
}

const routes = {
  "GET /api/state": () => ({
    news: listNews(),
    announcements: existsSync(ANN_FILE) ? readFileSync(ANN_FILE, "utf8") : '{"announcements":[]}',
    repo: ROOT,
  }),

  /* staged writes land in the working tree; git decides what happens next */
  "POST /api/write": async ({ path, text }) => {
    if (typeof path !== "string" || typeof text !== "string") throw new Error("path and text required");
    if (path.startsWith("news/")) {
      const slug = path.slice(5).replace(/\.html$/, "");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("bad slug: " + slug);
      const target = join(NEWS_DIR, slug + ".html");
      if (!writable(target)) throw new Error("refused: outside the writable area");
      mkdirSync(NEWS_DIR, { recursive: true });
      writeFileSync(target, text);
      return { wrote: relative(ROOT, target).split(sep).join("/") };
    }
    if (path === "content/announcements.json") {
      JSON.parse(text); // refuse to write something the generator cannot read
      writeFileSync(ANN_FILE, text);
      return { wrote: "content/announcements.json" };
    }
    throw new Error("refused: " + path + " is not a path this tool writes");
  },

  "POST /api/delete": async ({ path }) => {
    if (typeof path !== "string" || !path.startsWith("news/")) {
      throw new Error("only news posts can be deleted from here");
    }
    const slug = path.slice(5).replace(/\.html$/, "");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("bad slug: " + slug);
    const target = join(NEWS_DIR, slug + ".html");
    if (!writable(target)) throw new Error("refused: outside the writable area");
    if (existsSync(target)) unlinkSync(target);
    return { deleted: "news/" + slug };
  },

  /* Two lists on purpose: what a publish would carry, and what it would leave
     alone. Seeing them apart is how you notice that you are about to publish
     somebody else's unfinished work — which is exactly what went wrong the
     first time this ran. */
  "GET /api/diff": async () => {
    const mine = await run("git", ["status", "--short", "--", ...PUBLISH_PATHS]);
    const others = await run("git", [
      "status",
      "--short",
      "--",
      ".",
      ...PUBLISH_PATHS.map((p) => ":(exclude)" + p),
    ]);
    const df = await run("git", ["diff", "--stat", "--", ...PUBLISH_PATHS]);
    return { status: mine.stdout.trim(), stat: df.stdout.trim(), other: others.stdout.trim() };
  },

  /* Regenerate, then commit and push with whatever credentials this machine
     already uses for git. Nothing here authenticates anything itself. */
  "POST /api/publish": async ({ message }) => {
    const gen = await run(process.execPath, [join(HERE, "docs.gen.mjs")]);
    if (gen.code !== 0) {
      return { ok: false, step: "generate", output: (gen.stdout + gen.stderr).trim() };
    }
    const staged = await run("git", ["add", "-A", "--", ...PUBLISH_PATHS]);
    if (staged.code !== 0) return { ok: false, step: "add", output: staged.stderr };

    /* anything staged now is a consequence of this publish; anything else in
       the tree is somebody else's and stays out of the commit */
    const mine = await run("git", ["status", "--short", "--", ...PUBLISH_PATHS]);
    if (!mine.stdout.trim()) {
      return { ok: true, changed: false, output: gen.stdout.trim() };
    }
    const theirs = await run("git", ["status", "--short", "--", ".", ...PUBLISH_PATHS.map((p) => ":(exclude)" + p)]);
    const msg = (message || "").trim() || "Publish from the local console";
    const commit = await run("git", ["commit", "-m", msg, "--", ...PUBLISH_PATHS]);
    if (commit.code !== 0) {
      return { ok: false, step: "commit", output: (commit.stdout + commit.stderr).trim() };
    }
    const push = await run("git", ["push"]);
    const left = theirs.stdout.trim();
    return {
      ok: push.code === 0,
      changed: true,
      step: push.code === 0 ? "done" : "push",
      output:
        (commit.stdout + "\n" + push.stdout + push.stderr).trim() +
        (left ? "\n\n未提交的改动（不属于本次发布，已留在工作区）：\n" + left : ""),
    };
  },
};

/* ------------------------------------------------------------- UI + static */
/* The console is served from tools/ and is deliberately NOT part of the built
   site: the generator never copies it, and nothing on the site links here. */

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveFile(res, file) {
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": CONTENT_TYPES[file.slice(file.lastIndexOf("."))] || "application/octet-stream" });
  res.end(readFileSync(file));
}

/* ---------------------------------------------------------------- server */

const server = createServer(async (req, res) => {
  /* DNS rebinding: a hostile hostname can resolve to 127.0.0.1, so the Host
     header has to be checked as well as the bind address. */
  const host = (req.headers.host || "").split(":")[0];
  if (host !== HOST && host !== "localhost") {
    res.writeHead(403).end("forbidden host");
    return;
  }

  const url = new URL(req.url, "http://" + HOST);
  const parts = url.pathname.split("/").filter(Boolean);

  /* the random segment is the first path component of everything */
  if (parts[0] !== TOKEN) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const path = "/" + parts.slice(1).join("/");

  try {
    /* ---- api ---- */
    const key = req.method + " " + path;
    if (routes[key]) {
      const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};
      const out = await routes[key](body);
      json(res, 200, out === undefined ? { ok: true } : out);
      return;
    }

    /* ---- the console itself ---- */
    if (path === "/" || path === "/index.html") return serveFile(res, join(HERE, "admin-ui.html"));
    if (path === "/admin-ui.js") return serveFile(res, join(HERE, "admin-ui.js"));
    if (path === "/admin-ui.css") return serveFile(res, join(HERE, "admin-ui.css"));
    if (path.startsWith("/assets/")) return serveFile(res, join(ROOT, path.slice(1)));
    if (path === "/favicon.ico") return serveFile(res, join(ROOT, "favicon.ico"));

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (err) {
    json(res, 400, { error: String(err && err.message ? err.message : err) });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("");
    console.error(`  Port ${PORT} is already in use — probably an earlier run of this tool.`);
    console.error(`  Close it, or start this one on another port:`);
    console.error("");
    console.error(`      PORT=4320 node tools/admin.mjs`);
    console.error("");
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/${TOKEN}/`;
  console.log("");
  console.log("  FujoOS publishing console");
  console.log("  " + url);
  console.log("");
  console.log("  The random segment in that URL is this run's only credential: it");
  console.log("  stops other pages in your browser from driving this server. It");
  console.log("  changes every time you start the tool, so bookmark nothing.");
  console.log("");
  console.log("  Publishing here uses this machine's own git credentials. Whoever");
  console.log("  can push to the repository is who can publish — that is set in");
  console.log("  GitHub's collaborator settings, not here.");
  console.log("");
});
