"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

let failures = 0;
function ok(cond, name) {
  if (cond) console.log("ok - " + name);
  else {
    failures++;
    console.error("FAIL - " + name);
  }
}

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...appJs.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));

for (const id of usedIds) {
  ok(htmlIds.has(id), 'app.js $("' + id + '") exists in index.html');
}

const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
ok(scripts.length === 1, "single bundle script tag, got " + scripts.length);
ok(JSON.stringify(scripts) === JSON.stringify(["js/bundle.js"]), "script is js/bundle.js: " + scripts.join(","));
for (const s of scripts) {
  ok(fs.existsSync(path.join(root, s)), "script exists: " + s);
}
ok(/<link rel="stylesheet" href="style\.css">/.test(html) && fs.existsSync(path.join(root, "style.css")), "stylesheet exists");
ok(/http-equiv="Content-Security-Policy"/.test(html), "CSP meta present");
ok(/connect-src[^"]*https:\/\/www\.quaddicted\.com/.test(html), "CSP connect-src allows quaddicted API");
ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), "no inline scripts");
ok(!/style="/.test(html), "no inline styles");
ok(!/innerHTML/.test(appJs), "app.js never uses innerHTML");

if (failures) {
  console.error(failures + " failure(s)");
  process.exit(1);
}
console.log("test_ids: all passed (" + usedIds.size + " ids checked)");
