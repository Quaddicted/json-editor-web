// Checks that every $("id") referenced in js/app.js exists in index.html and
// that every script src referenced in index.html exists on disk.
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var failures = 0;

function ok(cond, message) {
  if (cond) {
    console.log("  ok - " + message);
  } else {
    failures++;
    console.log("  FAIL - " + message);
  }
}

var appSrc = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

var referenced = {};
var re = /\$\("([A-Za-z0-9_-]+)"\)/g;
var m;
while ((m = re.exec(appSrc)) !== null) {
  referenced[m[1]] = true;
}
var referencedIds = Object.keys(referenced);
ok(referencedIds.length >= 25, "found a reasonable number of $() references (" + referencedIds.length + ")");

var htmlIds = {};
var idRe = /id="([^"]+)"/g;
while ((m = idRe.exec(html)) !== null) {
  if (htmlIds[m[1]]) {
    failures++;
    console.log("  FAIL - duplicate id in index.html: " + m[1]);
  }
  htmlIds[m[1]] = true;
}

referencedIds.forEach(function (id) {
  ok(!!htmlIds[id], 'app.js $("' + id + '") exists in index.html');
});

var srcRe = /<script src="([^"]+)"><\/script>/g;
var srcs = [];
while ((m = srcRe.exec(html)) !== null) {
  srcs.push(m[1]);
}
ok(srcs.length >= 6, "index.html loads " + srcs.length + " scripts");
srcs.forEach(function (src) {
  ok(fs.existsSync(path.join(ROOT, src)), "script exists: " + src);
});

["serialize", "tagdata", "validate", "scan", "github", "app"].forEach(function (name) {
  ok(srcs.indexOf("js/" + name + ".js") !== -1, "script order includes js/" + name + ".js");
  var order = srcs.indexOf("js/" + name + ".js");
  if (name !== "serialize" && order !== -1) {
    ok(srcs.indexOf("js/serialize.js") < order, "js/serialize.js loads before js/" + name + ".js");
  }
});

ok(html.indexOf("http-equiv=\"Content-Security-Policy\"") !== -1, "CSP meta present");
ok(html.indexOf("innerHTML") === -1, "no innerHTML in index.html");
ok(appSrc.indexOf(".innerHTML") === -1, "no .innerHTML usage in app.js");

// CSP: nonce for the CodeMirror <style>, no unsafe-inline, no raw.githubusercontent
(function () {
  var m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  ok(m !== null, "CSP meta tag present");
  if (m) {
    var csp = m[1];
    ok(csp.indexOf("unsafe-inline") === -1, "CSP has no unsafe-inline");
    ok(csp.indexOf("nonce-") !== -1, "CSP allows a style nonce");
    ok(csp.indexOf("raw.githubusercontent.com") === -1,
       "CSP connect-src no longer allows raw.githubusercontent.com");
    ok(csp.indexOf("https://api.github.com") !== -1, "CSP still allows api.github.com");
    ok(csp.indexOf("https://www.quaddicted.com") !== -1, "CSP still allows www.quaddicted.com");
  }
})();

if (failures) {
  console.error(failures + " failure(s)");
  process.exit(1);
}
console.log("test_ids: all passed");
