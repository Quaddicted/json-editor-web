var fs = require("fs");
var path = require("path");
var assert = require("assert");
var Github = require("../js/github.js");

var FIX = path.join(__dirname, "fixtures");
var failures = 0;

function ok(cond, message) {
  if (cond) {
    console.log("  ok - " + message);
  } else {
    failures++;
    console.log("  FAIL - " + message);
  }
}

console.log("repoPathFor:");
var sha = "0057e13199459fb3e0450484ada072fe2c7c64f6f75e38b8e314ac2808bd0a4d";
ok(Github.repoPathFor(sha) === "json/by-sha256/00/" + sha + ".json", "path layout");

console.log("base64:");
var info = JSON.parse(fs.readFileSync(path.join(FIX, "expected_info.json"), "utf8"));
var encoded = Github.base64EncodeUtf8(info.b64_sample);
ok(encoded === info.b64_expected, "base64 of unicode string matches Python");
var decoded = Buffer.from(encoded, "base64").toString("utf8");
ok(decoded === info.b64_sample, "base64 round-trip");

console.log("PR title/body:");
var pkg = {
  bytes: 123,
  sha256: sha,
  description: "A test map.",
  tags: ["author=Tester", "filename=test.zip", "game=quake", "title=Test Map"],
  urls: ["https://www.quaddicted.com/files/by-sha256/00/" + sha + "/test.zip"]
};
var titleNew = Github.buildPrTitle(pkg, true);
ok(titleNew === "Add package: Test Map (0057e1319945)", "title for new package uses title tag");
var pkgNoTitle = { sha256: sha, tags: ["filename=test.zip"] };
var titleUpdate = Github.buildPrTitle(pkgNoTitle, false);
ok(titleUpdate === "Update package: test.zip (0057e1319945)", "title for update falls back to filename tag");
var body = Github.buildPrBody(pkg, { errors: [], warnings: [{ path: "tags", message: "w" }] }, true);
ok(body.indexOf(sha) !== -1, "body contains sha256");
ok(body.indexOf("A test map.") !== -1, "body contains description");
ok(body.indexOf("`author=Tester`") !== -1, "body contains tags");
ok(body.indexOf("https://www.quaddicted.com/files/by-sha256/00/" + sha + "/test.zip") !== -1, "body contains urls");
ok(body.indexOf("passed, 0 errors, 1 warning(s)") !== -1, "body contains validation result");
ok(body.indexOf("Created with the quaddicted-data web editor.") !== -1, "body contains footer");
var bodyErrors = Github.buildPrBody(pkg, { errors: [{ path: "bytes", message: "m" }], warnings: [] }, false);
ok(bodyErrors.indexOf("1 error(s)") !== -1, "body with errors");

console.log("createPullRequest with mocked fetch:");
(async function () {
  var calls = [];
  var originalFetch = globalThis.fetch;
  globalThis.fetch = async function (url, init) {
    var p = url.replace("https://api.github.com", "");
    calls.push({ path: p, method: init ? init.method : "GET", body: init && init.body ? JSON.parse(init.body) : null });
    function payload() {
      if (p === "/user") { return { login: "testuser" }; }
      if (p === "/repos/testuser/quaddicted-data") { return { full_name: "testuser/quaddicted-data" }; }
      if (p.indexOf("/git/ref/heads%2Fmain") !== -1) { return { object: { sha: "basesha" } }; }
      if (p === "/repos/Quaddicted/quaddicted-data/pulls") { return { html_url: "https://github.com/Quaddicted/quaddicted-data/pull/1" }; }
      if (p.indexOf("/contents/") !== -1 && (init.method || "GET") === "GET") { return { sha: "existingfileblob" }; }
      if (p.indexOf("/merge-upstream") !== -1) { return { merge_type: "none" }; }
      if (p.indexOf("/git/refs") !== -1) { return { ref: "refs/heads/x" }; }
      return {};
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async function () { return JSON.stringify(payload()); }
    };
  };
  var logs = [];
  var result = await Github.createPullRequest({
    token: "faketoken",
    sha256: sha,
    contentText: "{}\n",
    pkg: pkg,
    validation: { errors: [], warnings: [] },
    isNew: false,
    log: function (m) { logs.push(m); }
  });
  globalThis.fetch = originalFetch;

  ok(result.url === "https://github.com/Quaddicted/quaddicted-data/pull/1", "PR url returned");
  ok(result.branch.indexOf("quaddicted-web-editor/0057e1319945-") === 0, "branch name prefix");
  var put = calls.filter(function (c) { return c.method === "PUT"; })[0];
  ok(put && put.path === "/repos/testuser/quaddicted-data/contents/json/by-sha256/00/" + sha + ".json",
     "PUT to correct content path");
  ok(put.body.sha === "existingfileblob", "PUT includes existing blob sha");
  ok(put.body.content === Github.base64EncodeUtf8("{}\n"), "PUT content is base64 of UTF-8");
  ok(put.body.message === "Update package " + sha, "PUT commit message");
  var prPost = calls.filter(function (c) { return c.path === "/repos/Quaddicted/quaddicted-data/pulls"; })[0];
  ok(prPost.body.head === "testuser:" + result.branch, "PR head is login:branch");
  ok(prPost.body.base === "main", "PR base is main");
  ok(prPost.body.maintainer_can_modify === true, "PR maintainer_can_modify");
  ok(logs.length > 0, "progress log used");

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_github: all passed");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
