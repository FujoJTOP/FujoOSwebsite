#!/usr/bin/env node
/*
 * Local intake for the bug board.
 *
 * Why this is local and not a public endpoint: GitHub Pages serves files and
 * runs nothing, so there is no server anywhere that could accept a report and
 * write it down. This process is the write path, the same way tools/admin.mjs
 * is the write path for news and announcements — it binds to 127.0.0.1 only,
 * so nothing off this machine can reach it, and it needs no credential because
 * the machine is the credential.
 *
 * What lives on the site is the contract (see /bugs/api/), not the service.
 * An agent working on this machine can POST here; an agent working in a
 * browser anywhere can only assemble a report, because there is nowhere to
 * put it.
 *
 *   node tools/bugapi.mjs            # http://127.0.0.1:8788
 *   node tools/bugapi.mjs 9000       # a different port
 *
 * Zero third-party dependencies, like everything else in tools/.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "content", "bugs.json");
const PORT = Number(process.argv[2] || process.env.BUGAPI_PORT || 8788);
const AREAS = ["kernel", "language", "compat", "ai", "site"];

/* The four the board will not work without, plus what each one is for. The
   same four the form asks for and the same four the contract page lists —
   one definition of "a usable report", not three. */
const REQUIRED = [
  ["title", "one line saying what is wrong"],
  ["what", "the sentence on this site the report is about, or its page address"],
  ["cmd", "the command you ran, verbatim"],
  ["out", "what you got, verbatim"],
  ["expect", "what the site says should happen"],
];
const OPTIONAL = ["version", "env", "area", "url"];
const MAX_FIELD = 20000;

function read() {
  if (!existsSync(FILE)) return { bugs: [] };
  return JSON.parse(readFileSync(FILE, "utf8"));
}

/* Ids are handed out in order and never reused. A gap is fine; a repeat is
   not, because the id is the address of a report. */
function nextId(bugs) {
  let top = 0;
  for (const b of bugs) {
    const m = /^FJ-(\d+)$/.exec(String(b.id || ""));
    if (m) top = Math.max(top, Number(m[1]));
  }
  return "FJ-" + String(top + 1).padStart(4, "0");
}

/* Returns a list of problems rather than the first one: a caller that sent
   four bad fields should hear about four. */
function check(body) {
  const errors = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return [{ field: "", code: "bad_json", message: "body must be a JSON object" }];
  }
  for (const [field, why] of REQUIRED) {
    const v = body[field];
    if (typeof v !== "string" || !v.trim()) {
      errors.push({ field, code: "missing_field", message: `${field} is required — ${why}` });
    }
  }
  for (const [key, value] of Object.entries(body)) {
    if (!REQUIRED.some((r) => r[0] === key) && !OPTIONAL.includes(key)) {
      errors.push({ field: key, code: "unknown_field", message: `${key} is not part of the contract` });
    } else if (typeof value === "string" && value.length > MAX_FIELD) {
      errors.push({ field: key, code: "too_long", message: `${key} is over ${MAX_FIELD} characters` });
    }
  }
  if (body.area != null && !AREAS.includes(body.area)) {
    errors.push({ field: "area", code: "bad_area", message: `area must be one of ${AREAS.join(", ")}` });
  }
  return errors;
}

function json(res, code, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/bugs") {
    const data = read();
    return json(res, 200, { ok: true, count: (data.bugs || []).length, bugs: data.bugs || [] });
  }

  if (req.method === "POST" && url.pathname === "/api/bug") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1 << 20) req.destroy();
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch (e) {
        return json(res, 400, {
          ok: false,
          errors: [{ field: "", code: "bad_json", message: "body is not valid JSON" }],
        });
      }
      const errors = check(body);
      if (errors.length) return json(res, 422, { ok: false, errors });

      const data = read();
      data.bugs = data.bugs || [];
      const id = nextId(data.bugs);
      const entry = {
        id,
        /* A submission is a claim like anyone else's. Nobody here has
           reproduced it, so it says so — that is the whole mechanism. */
        official: false,
        state: "open",
        area: body.area || "site",
        version: body.version || "",
        reported: new Date().toISOString().slice(0, 10),
        zh: body.title.trim(),
        en: body.title.trim(),
      };
      if (body.url) entry.url = body.url;
      /* The raw fields are kept with the entry, because the board shows the
         title but whoever reads the report needs the evidence. */
      entry.report = {
        what: body.what.trim(),
        cmd: body.cmd.trim(),
        out: body.out.trim(),
        expect: body.expect.trim(),
      };
      if (body.env) entry.report.env = body.env.trim();
      data.bugs.push(entry);
      writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
      return json(res, 201, {
        ok: true,
        id,
        file: "content/bugs.json",
        next: "node tools/docs.gen.mjs",
        note: "written as an unofficial entry — nobody here has reproduced it yet",
      });
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(
    [
      "FujoOS bug intake — local only.",
      "",
      "  POST /api/bug   { title, what, cmd, out, expect, version?, env?, area?, url? }",
      "  GET  /api/bugs  every entry currently on the board",
      "",
      "The contract is documented at /bugs/api/ on the site.",
      "Nothing off this machine can reach this port.",
      "",
    ].join("\n")
  );
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`bug intake listening on http://127.0.0.1:${PORT}`);
  console.log(`writing to ${FILE.replace(ROOT, "").replace(/\\/g, "/")}`);
  console.log("bound to 127.0.0.1 — nothing off this machine can reach it");
});
