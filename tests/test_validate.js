"use strict";

const V = require("../js/validate.js");

let failures = 0;
function ok(cond, name) {
  if (cond) console.log("ok - " + name);
  else {
    failures++;
    console.error("FAIL - " + name);
  }
}
function valid(arr, fn, name) {
  for (const x of arr) ok(fn(x) === true, name + " valid: " + JSON.stringify(x));
}
function invalid(arr, fn, name) {
  for (const x of arr) ok(fn(x) === false, name + " invalid: " + JSON.stringify(x));
}

const SHA = "a".repeat(64);

valid(
  ["http://example.com", "https://example.com", "ftp://example.com", "xyz://www.quaddicated.null",
   "https://www.example.com/foo bar!§$%&/()=?`", "a+b-c.://h", "HTTPS://X", " https://x", "ht\tps://x",
   "https://exa mple.com", "https://[::1]/x"],
  V.isValidUrl, "url");
invalid(["foo", "", " ", "https:/x", "https://", "a:", "a://", "a://?q", "://x", "1a://x", "https://x.com]()", 42, null],
  V.isValidUrl, "url");

valid(["czg", 'Foo "baz" BaR', "<[666]/`\\*@‽>", "😇^", "❤️", "a b c", "x"],
  V.isPrintablePlusSpace, "printable+space");
invalid(["", " ", "\n", "\t", "foo\n", "foo\t", "\nbar", "\tbar", "foo\nbar", "foo\tbar", "a ", " a", "a b", "a\x1cb", "a\x85b"],
  V.isPrintablePlusSpace, "printable+space");

valid(["czg", "<[666]/`\\*@>", "ABC", "quake"], V.isPrintableLowercaseAscii, "ascii printable");
invalid(["", " ", "\n", "\t", "foo\n", "foo\t", "Foo Bar", "😇^", "❤️", "a b"],
  V.isPrintableLowercaseAscii, "ascii printable");

valid(["foo.zip", "Ba4.eXe", "\\%€:@\\*", "CON", " Space in front and end ", ".dots.", "com1.txt", "aux.tar.gz", "x".repeat(255), "x".repeat(256), "é".repeat(128), "😀".repeat(300)],
  V.isValidFilenameAnywhere, "filename");
invalid(["", ".", "..", "/", "a/b", "a\0b"],
  V.isValidFilenameAnywhere, "filename");

valid(["1234", "1998", "2000-04", "2021-12-31", "2050"], V.isValidReleaseDate, "release_date");
invalid(["98", "01-2003", "01-02", "01-02-03", "01-02-2003", "1/2/34", "12/3/4", "01.02.1998", "01/02/1998", "1234-5", "12345"],
  V.isValidReleaseDate, "release_date");

valid(["-hipnotic", "-game ctf +map e1m1", "abcXYZ019 ._+-/"], V.isValidCommandline, "commandline");
invalid(["", "-hipnotic;rm -rf /", "a|b", "a&b", "a<b>c", "a$b"], V.isValidCommandline, "commandline");

valid(["https://x.com", "[Quaddicted](https://www.quaddicted.com)", "[](https://x.com)", "[a b](https://x.com)"],
  V.isValidLink, "link");
invalid(["notaurl", "[t](https:/x)", "[a\tb](https://x.com)", "[t](foo)", "[unclosed](https://x.com"],
  V.isValidLink, "link");

valid([1, 3.7, "12", " 12 ", "+5", "1_0", "12\n", 1e30, true], V.isValidBytes, "bytes");
invalid([0, -1, 0.5, "abc", "1e5", "0x10", "1__0", "_1", "1_", "", null, [], NaN, Infinity, "0", "00", "١٢٣"],
  V.isValidBytes, "bytes");

ok(V.isValidSha256(SHA) && !V.isValidSha256(SHA.toUpperCase()) && !V.isValidSha256("a".repeat(63)), "sha256 regex");

const tagOk = ["a=b", "foo=bar", "baz=123", "author:music=foo", "sources:maps:license=WTFPL",
  "general_group:some_qualifier:extra_qualifier=foo", "foo=bar=", "a=b c"];
for (const t of tagOk) ok(V.parseTag(t).ok === true, "parseTag ok: " + JSON.stringify(t));
const tagBad = [
  ["foo", "does not contain a '='"],
  ["", "does not contain a '='"],
  ["=", "shorter than 3"],
  ["=b", "shorter than 3"],
  ["a=", "shorter than 3"],
  ["===", "key and value"],
  ["=foo=bar", "key and value"],
  ["foo=", "key and value"],
  ["_=👍", "valid key"],
  ["1a=b", "valid key"],
  ["FOO=bar", "valid key"],
  ["foo bar=baz", "valid key"],
  ["foo:=b", "invalid qualifier"],
  ["foo:Bar=b", "invalid qualifier"],
  ["foo::bar=b", "invalid qualifier"],
  ["a= ", "disallowed characters"],
  ["a= b", "disallowed characters"],
  ["a=b\tc", "disallowed characters"],
];
for (const [t, frag] of tagBad) {
  const p = V.parseTag(t);
  ok(p.ok === false && p.error.includes(frag), "parseTag bad: " + JSON.stringify(t) + " -> " + (p.error || ""));
}
{
  const p = V.parseTag("foo:bar=baz=qux");
  ok(p.ok && p.key === "foo" && p.qualifiers.join(",") === "bar" && p.value === "baz=qux", "explode leftmost =");
}

function pkg(extra) {
  return Object.assign({ bytes: 10, sha256: SHA }, extra);
}

{
  const r = V.validatePackage(pkg({ tags: ["title=Foo", "title=Bar"] }));
  ok(r.errors.length === 0 && r.warnings.some((w) => w.message.includes("at most once")), "cardinality warning for title");
}
{
  const r = V.validatePackage(pkg({ tags: ["mystery=foo", "zipbasedir=maps/"] }));
  ok(r.errors.length === 0 && r.warnings.some((w) => w.message.includes("No validation function")), "unknown tag key warning only");
  ok(r.warnings.some((w) => w.message.includes("zipbasedir")), "zipbasedir legacy warning");
}
{
  const r = V.validatePackage({});
  ok(r.errors.some((e) => e.path === "bytes") && r.errors.some((e) => e.path === "sha256"), "missing bytes/sha256");
}
{
  const r = V.validatePackage(pkg({ bytes: 0, sha256: "XYZ" }));
  ok(r.errors.some((e) => e.path === "bytes") && r.errors.some((e) => e.path === "sha256"), "malformed bytes/sha256");
}
{
  const r = V.validatePackage(pkg({ bogus_key: 1 }));
  ok(r.errors.some((e) => e.message.includes("Unknown top-level keys") && e.message.includes("bogus_key")), "unknown top-level key error");
}
{
  const r = V.validatePackage(pkg({ urls: ["https://ok.com", "notaurl"] }));
  ok(r.errors.length === 1 && r.errors[0].path === "urls[1]", "bad url error");
}
{
  const r = V.validatePackage(pkg({}), { expectedSha256: "0".repeat(64) });
  ok(r.errors.some((e) => e.message.includes("mismatch")), "path/sha256 mismatch");
  const r2 = V.validatePackage(pkg({}), { expectedSha256: SHA });
  ok(r2.errors.length === 0, "matching expectedSha256 passes");
}
{
  const r = V.validatePackage(pkg({ tags: ["b=2", "a=1"] }));
  ok(r.warnings.some((w) => w.message.includes("not sorted")), "unsorted tags warning");
}
{
  const r = V.validatePackage(pkg({ tags: ["filename=CON", "game=Quake", "release_date=1998-01-22", "commandline=-hipnotic", "link=[Q](https://q.com)"] }));
  ok(r.errors.length === 0, "per-key validators pass: " + JSON.stringify(r.errors));
  const r2 = V.validatePackage(pkg({ tags: ["filename=a/b", "game=a b", "release_date=98", "commandline=a;b", "link=nope"] }));
  ok(r2.errors.length === 5, "per-key validators fail count: " + JSON.stringify(r2.errors));
}
{
  const files = {
    "maps/": { bytes: 5, sha256: SHA },
    "maps/a.bsp": { bytes: 10 },
    "b.txt": { bytes: 3, sha256: "zz", timestamp: "yesterday" },
    "c.zip": { bytes: 9, sha256: SHA, files: { "in.txt": { bytes: 1, sha256: SHA } } },
  };
  const r = V.validatePackage(pkg({ files }));
  ok(r.warnings.some((w) => w.message.includes("bytes = 0")), "dir bytes warning");
  ok(r.errors.some((e) => e.message.includes("sha256")), "missing entry sha256 error");
  ok(r.errors.some((e) => e.message.includes("Malformed 'sha256'")), "bad entry sha256 error");
  ok(r.warnings.some((w) => w.message.includes("timestamp")), "bad timestamp warning");
}
{
  const r = V.validatePackage(pkg({ install: { extractmapping: { "noSlash": "alsoNo" }, extract: "{base}/maps/" } }));
  ok(r.warnings.filter((w) => w.path.startsWith("install")).length >= 3, "install warnings: " + JSON.stringify(r.warnings));
}
{
  const r = V.validatePackage([1, 2]);
  ok(r.errors.length === 1 && r.errors[0].path === "(root)", "root must be object");
}

if (failures) {
  console.error(failures + " failure(s)");
  process.exit(1);
}
console.log("test_validate: all passed");
