"use strict";

const G = require("../js/github.js");

let failures = 0;
function ok(cond, name) {
  if (cond) console.log("ok - " + name);
  else {
    failures++;
    console.error("FAIL - " + name);
  }
}

const sha = "ab".repeat(32);

ok(G.repoPathFor(sha) === "json/by-sha256/ab/" + sha + ".json", "repoPathFor");

const samples = ["hello", "café 😀 \u007f \"quoted\" \\ slash", "x".repeat(100000), "line1\nline2\ttab"];
for (const s of samples) {
  const b64 = G.base64EncodeUtf8(s);
  const back = Buffer.from(b64, "base64").toString("utf8");
  ok(back === s, "base64 utf8 round-trip len=" + s.length);
}
ok(G.base64EncodeUtf8("") === "", "base64 empty");

const pkg = {
  bytes: 123,
  sha256: sha,
  description: "desc",
  tags: ["filename=foo.zip", "title=Foo Map", "game=quake"],
  urls: ["https://www.quaddicted.com/filebase/foo.zip"],
};
ok(G.buildPrTitle(pkg, sha, true) === "Add package: Foo Map (" + sha.slice(0, 12) + ")", "pr title uses title tag");
const pkgNoTitle = { tags: ["filename=foo.zip"] };
ok(G.buildPrTitle(pkgNoTitle, sha, false) === "Update package: foo.zip (" + sha.slice(0, 12) + ")", "pr title falls back to filename, update");
ok(G.buildPrTitle({}, sha, true) === "Add package: " + sha.slice(0, 12) + " (" + sha.slice(0, 12) + ")", "pr title falls back to sha");

const body = G.buildPrBody(pkg, sha, { errors: [], warnings: [{ path: "tags", message: "w" }] }, true);
ok(body.includes(sha) && body.includes("Foo Map") && body.includes("quake") && body.includes("123") && body.includes("passed") && body.includes("web editor"), "pr body contents");
const bodyErr = G.buildPrBody(pkg, sha, { errors: [{ path: "bytes", message: "m" }] }, false);
ok(bodyErr.includes("1 error(s)"), "pr body validation errors");

const e = new G.GhError(404, "Not Found", "/repos/x/y");
ok(e.status === 404 && e.path === "/repos/x/y" && /404/.test(e.message), "GhError fields");

if (failures) {
  console.error(failures + " failure(s)");
  process.exit(1);
}
console.log("test_github: all passed");
