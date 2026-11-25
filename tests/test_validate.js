var Validate = require("../js/validate.js");
var failures = 0;

function ok(cond, message) {
  if (cond) {
    console.log("  ok - " + message);
  } else {
    failures++;
    console.log("  FAIL - " + message);
  }
}

function checkList(name, fn, validList, invalidList) {
  validList.forEach(function (v) {
    ok(fn(v) === true, name + " valid: " + JSON.stringify(v));
  });
  invalidList.forEach(function (v) {
    ok(fn(v) === false, name + " invalid: " + JSON.stringify(v));
  });
}

console.log("urls:");
checkList("isValidUrl", Validate.isValidUrl,
  ["http://example.com", "https://example.com", "ftp://example.com",
   "xyz://www.quaddicted.null", "https://www.example.com/foo bar!\u00a7$%&/()=?"],
  ["foo", "", " ", "https:/www.quaddicted.com", "http://"]);

console.log("printable + space:");
checkList("isPrintablePlusSpace", Validate.isPrintablePlusSpace,
  ["czg", 'Foo "baz" BaR', "<[666]/`\\*@\u203d>", "\ud83d\ude07^", "\u2764\ufe0f"],
  ["", " ", "\n", "\t", "foo\n", "foo\t", "\nbar", "\tbar", "foo\nbar", "foo\tbar"]);

console.log("printable ascii no space:");
checkList("isPrintableAsciiNoSpace", Validate.isPrintableAsciiNoSpace,
  ["czg", "<[666]/`\\*@>"],
  ["", " ", "\n", "\t", "foo\n", "foo\t", "\nbar", "\tbar", "foo\nbar", "foo\tbar",
   "\ud83d\ude07^", "\u2764\ufe0f", 'Foo "baz" BaR']);

console.log("structural tags:");
checkList("structurallyValidTag", Validate.structurallyValidTag,
  ["a=b", "foo=bar", "baz=123", "_=\ud83d\udc4d", "===", "author:music=foo",
   "sources:maps:license=WTFPL", "general_group:some_qualifier:extra_qualifier=foo"],
  ["", "a", "=", "a=", "=b"]);

console.log("keys:");
checkList("isValidKeyWithoutQualifiers", Validate.isValidKeyWithoutQualifiers,
  ["a", "a0", "author", "sources"],
  ["", " ", "_", ":", "\n", "\t", "A", "1", "12", "-", "FOO", "\u00e4", "\u2764\ufe0f", "foo bar", "a:b"]);

console.log("parseTag:");
function parseOk(tag, expected) {
  try {
    var parsed = Validate.parseTag(tag);
    ok(parsed.key === expected.key &&
       JSON.stringify(parsed.qualifiers) === JSON.stringify(expected.qualifiers) &&
       parsed.value === expected.value,
       "parseTag(" + JSON.stringify(tag) + ")");
  } catch (e) {
    failures++;
    console.log("  FAIL - parseTag(" + JSON.stringify(tag) + ") threw: " + e.message);
  }
}
function parseErr(tag, message) {
  try {
    Validate.parseTag(tag);
    failures++;
    console.log("  FAIL - parseTag(" + JSON.stringify(tag) + ") should throw");
  } catch (e) {
    ok(e.message === message, "parseTag(" + JSON.stringify(tag) + ") error '" + e.message + "'");
  }
}
parseOk("foo=bar", { key: "foo", qualifiers: [], value: "bar" });
parseOk("foo:bar=baz", { key: "foo", qualifiers: ["bar"], value: "baz" });
parseOk("foo:bar=baz=qux", { key: "foo", qualifiers: ["bar"], value: "baz=qux" });
parseOk("foo=bar=", { key: "foo", qualifiers: [], value: "bar=" });
parseErr("foo", "Tag does not contain a '='.");
parseErr("=foo", "Tag must contain key and value, separated by a '='.");
parseErr("foo=", "Tag must contain key and value, separated by a '='.");
parseErr("ab", "Tag does not contain a '='.");
parseErr("a", "Tag does not contain a '='.");
parseErr("=", "Tag cannot be shorter than 3 characters ('k=v').");
parseErr("_=x", "Tag does not contain a valid key.");
parseErr("1foo=x", "Tag does not contain a valid key.");
parseErr("foo:1bar=x", "Tag key contains an invalid qualifier.");
parseErr("foo:bar:=x", "Tag key contains an invalid qualifier.");
parseErr("foo= bar", "Tag value contains disallowed characters.");
parseErr("foo=bar ", "Tag value contains disallowed characters.");
parseErr("foo=bar\n", "Tag value contains disallowed characters.");

console.log("author:");
checkList("isValidAuthor", Validate.isValidAuthor,
  ["czg", 'Foo "baz" BaR', "<[666]/`\\*@\u203d>", "\ud83d\ude07^", '"a', "b'", "a\"'b"],
  ["a ", " a", " "]);

console.log("filename:");
checkList("isValidFilenameAnywhere", Validate.isValidFilenameAnywhere,
  ["foo.zip", "Ba4.eXe", "\\%\u20ac:@\\*", "CON", " Space in front and end ", ".dots."],
  ["", ".", "..", "/"]);

console.log("release_date:");
checkList("isValidReleaseDate", Validate.isValidReleaseDate,
  ["1234", "1998", "2000-04", "2021-12-31", "2050"],
  ["98", "01-2003", "01-02", "01-02-03", "01-02-2003", "1/2/34", "12/3/4",
   "01.02.1998", "01/02/1998"]);

console.log("game/game_mode/type/theme/startmap:");
["isValidGame", "isValidGameMode", "isValidType", "isValidTheme", "isValidStartmap"].forEach(function (fnName) {
  ok(Validate[fnName]("quake") === true, fnName + " valid: quake");
  ok(Validate[fnName]("singleplayer") === true, fnName + " valid: singleplayer");
  ok(Validate[fnName]("Foo Bar") === false, fnName + " invalid: 'Foo Bar'");
  ok(Validate[fnName]("") === false, fnName + " invalid: empty");
  ok(Validate[fnName]("\n") === false, fnName + " invalid: newline");
});

console.log("commandline:");
checkList("isValidCommandline", Validate.isValidCommandline,
  ["-game cotd", "+map start", "progs.dat", "A-b_c.d/e+f"],
  ["-game cotd;rm -rf /", "foo|bar", "a&b", "<x>", 'q"uote']);

console.log("link:");
ok(Validate.isValidLink("https://www.quaddicted.com") === true, "link valid: plain URL");
ok(Validate.isValidLink("[Thread](https://www.quaddicted.com/forum/)") === true, "link valid: markdown");
ok(Validate.isValidLink("[Thread](notaurl)") === false, "link invalid: bad URL in markdown");
ok(Validate.isValidLink("[ leading space ](https://x.com)") === false, "link invalid: bad title");
ok(Validate.isValidLink("foo") === false, "link invalid: not a URL");

console.log("bytes:");
ok(Validate.isValidBytes(1) === true, "bytes valid: 1");
ok(Validate.isValidBytes(123456) === true, "bytes valid: 123456");
ok(Validate.isValidBytes(0) === false, "bytes invalid: 0");
ok(Validate.isValidBytes(-1) === false, "bytes invalid: -1");
ok(Validate.isValidBytes("5") === true, "bytes valid: string '5'");
ok(Validate.isValidBytes("5.5") === false, "bytes invalid: string '5.5'");
ok(Validate.isValidBytes(5.5) === true, "bytes valid: float 5.5 (Python int() truncates)");
ok(Validate.isValidBytes("abc") === false, "bytes invalid: 'abc'");
ok(Validate.isValidBytes(null) === false, "bytes invalid: null");

console.log("sha256:");
ok(Validate.isValidSha256("a".repeat(64)) === true, "sha256 valid");
ok(Validate.isValidSha256("A".repeat(64)) === false, "sha256 invalid: uppercase");
ok(Validate.isValidSha256("abc") === false, "sha256 invalid: too short");

console.log("package level:");
function pkgErrors(pkg, opts) {
  return Validate.validatePackage(pkg, opts || {});
}
var base = { bytes: 10, sha256: "a".repeat(64) };

ok(pkgErrors(base).errors.length === 0, "minimal package passes");
ok(pkgErrors({ sha256: "a".repeat(64) }).errors.length === 1 &&
   pkgErrors({ sha256: "a".repeat(64) }).errors[0].path === "bytes", "missing bytes flagged");
ok(pkgErrors({ bytes: 10 }).errors[0].path === "sha256", "missing sha256 flagged");
ok(pkgErrors({ bytes: 0, sha256: "a".repeat(64) }).errors[0].path === "bytes", "malformed bytes flagged");
ok(pkgErrors({ bytes: 10, sha256: "xyz" }).errors[0].path === "sha256", "malformed sha256 flagged");
ok(pkgErrors({ bytes: 10, sha256: "a".repeat(64), urls: ["foo"] }).errors[0].path === "urls[0]", "bad url flagged");
ok(pkgErrors({ bytes: 10, sha256: "a".repeat(64), urls: ["https://x.com"] }).errors.length === 0, "good url passes");
ok(pkgErrors({ bytes: 10, sha256: "a".repeat(64), wat: 1 }).errors[0].path === "wat", "unknown top-level key error");
var withUnknownTag = { bytes: 10, sha256: "a".repeat(64), tags: ["game=quake", "madeup_key=x"] };
ok(pkgErrors(withUnknownTag).errors.length === 0, "unknown tag key passes CI (warning only)");
ok(pkgErrors(withUnknownTag).warnings.length === 1, "unknown tag key produces warning");
var badTag = { bytes: 10, sha256: "a".repeat(64), tags: ["game=quake", "release_date=21-12"] };
ok(pkgErrors(badTag).errors.length === 1, "invalid per-key tag value flagged");
var tagStructure = { bytes: 10, sha256: "a".repeat(64), tags: ["game=quake", "noequals"] };
ok(pkgErrors(tagStructure).errors.length === 1, "malformed tag string flagged");
ok(pkgErrors({ bytes: 10, sha256: "a".repeat(64), tags: ["title=A", "title=B"] }).warnings.some(function (w) {
  return w.path === "tags" && w.message.indexOf("title") !== -1;
}), "title cardinality warning");
ok(pkgErrors({ bytes: 10, sha256: "a".repeat(64), tags: ["release_date=2021", "release_date=2022"] }).warnings.some(function (w) {
  return w.message.indexOf("release_date") !== -1;
}), "release_date cardinality warning");
ok(pkgErrors({ bytes: 10, sha256: "a".repeat(64), tags: ["version=1", "version=2"] }).warnings.some(function (w) {
  return w.message.indexOf("version") !== -1;
}), "version cardinality warning");

console.log("expectedSha256:");
var mismatch = pkgErrors(base, { expectedSha256: "b".repeat(64) });
ok(mismatch.errors.some(function (e) { return e.path === "sha256"; }), "path mismatch flagged");
var match = pkgErrors(base, { expectedSha256: "a".repeat(64) });
ok(match.errors.length === 0, "matching path passes");

console.log("files tree:");
var goodFiles = { bytes: 10, sha256: "a".repeat(64), files: {
  "readme.txt": { bytes: 3, sha256: "c".repeat(64), timestamp: "2021-07-12T17:54:58.000Z" },
  "dir/": { bytes: 0, sha256: Validate.EMPTY_SHA256 }
} };
ok(pkgErrors(goodFiles).warnings.length === 0, "good files tree: no warnings");
var badFiles = { bytes: 10, sha256: "a".repeat(64), files: {
  "dir/": { bytes: 5, sha256: "c".repeat(64) },
  "x.txt": { sha256: "c".repeat(64), timestamp: "nope" },
  "nested.zip": { bytes: 1, sha256: "c".repeat(64), files: { "y": { bytes: -1 } } }
} };
var warnPaths = pkgErrors(badFiles).warnings.map(function (w) { return w.path; });
ok(warnPaths.some(function (p) { return p.indexOf("dir/") !== -1 && p.indexOf("bytes") !== -1; }), "dir bytes!=0 warned");
ok(warnPaths.some(function (p) { return p.indexOf("x.txt") !== -1 && p.indexOf("bytes") !== -1; }), "missing entry bytes warned");
ok(warnPaths.some(function (p) { return p.indexOf("timestamp") !== -1; }), "bad timestamp warned");
ok(warnPaths.some(function (p) { return p.indexOf("nested") !== -1; }), "nested tree warned");

console.log("install:");
var extractmapping = { bytes: 10, sha256: "a".repeat(64), install: {
  extractmapping: { "/source.txt": "/target.txt", "no-slash": "/ok" }
} };
var mapWarns = pkgErrors(extractmapping).warnings.map(function (w) { return w.message; });
ok(mapWarns.some(function (m) { return m.indexOf("leading") !== -1; }), "missing leading slash warned");
var legacy = { bytes: 10, sha256: "a".repeat(64), install: { extract: "{base}/id1/maps/" } };
ok(pkgErrors(legacy).warnings.some(function (w) { return w.message.indexOf("extractmapping") !== -1; }), "legacy extract warned");
var zipbasedir = { bytes: 10, sha256: "a".repeat(64), tags: ["zipbasedir=id1/maps/"] };
ok(pkgErrors(zipbasedir).warnings.some(function (w) { return w.message.indexOf("zipbasedir") !== -1; }), "zipbasedir legacy warned");

if (failures) {
  console.error(failures + " failure(s)");
  process.exit(1);
}
console.log("test_validate: all passed");
