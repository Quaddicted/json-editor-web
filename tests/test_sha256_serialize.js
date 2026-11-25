"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const Sha256Api = require("../js/sha256.js");
const Serialize = require("../js/serialize.js");

const { Sha256, hashBytes, hashBlob } = Sha256Api;
const { serializeCanonical, compareCodePoints, escapeString } = Serialize;

let failures = 0;
function ok(cond, name) {
  if (cond) console.log("ok - " + name);
  else {
    failures++;
    console.error("FAIL - " + name);
  }
}
function eq(a, b, name) {
  ok(a === b, name + (a === b ? "" : "\n  expected: " + JSON.stringify(b) + "\n  actual:   " + JSON.stringify(a)));
}

async function main() {
  const enc = new TextEncoder();

  eq(new Sha256().update(enc.encode("")).digestHex(),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "NIST empty");
  eq(new Sha256().update(enc.encode("abc")).digestHex(),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "NIST abc");
  eq(new Sha256().update(enc.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).digestHex(),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", "NIST 448-bit");
  const million = new Uint8Array(1000000).fill(0x61);
  eq(new Sha256().update(million).digestHex(),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "NIST 1M a");

  const rnd = crypto.randomBytes(5000);
  const oneShot = new Sha256().update(rnd).digestHex();
  const chunked = new Sha256();
  let off = 0;
  while (off < rnd.length) {
    const n = 1 + Math.floor(Math.random() * 200);
    chunked.update(rnd.subarray(off, Math.min(off + n, rnd.length)));
    off += n;
  }
  eq(chunked.digestHex(), oneShot, "chunked vs one-shot");

  const big = crypto.randomBytes(1024 * 1024 + 3);
  const tmp = path.join(os.tmpdir(), "fart-sha-test-" + process.pid + ".bin");
  fs.writeFileSync(tmp, big);
  const sum = execFileSync("sha256sum", [tmp]).toString().split(" ")[0];
  fs.unlinkSync(tmp);
  eq(await hashBytes(new Uint8Array(big)), sum, "hashBytes vs sha256sum");
  eq(await hashBlob(new Blob([big])), sum, "hashBlob vs sha256sum");
  eq(await hashBlob(new Blob([big]), () => {}), sum, "hashBlob with progress cb");
  if (globalThis.crypto && globalThis.crypto.subtle) {
    eq(await Sha256Api.getChecksumSha256(new Blob([big])), sum, "getChecksumSha256 vs sha256sum");
    eq(await Sha256Api.getChecksumSha256(new Blob([])),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "getChecksumSha256 empty blob");
    eq(Sha256Api.toHex(await globalThis.crypto.subtle.digest("SHA-256", enc.encode("abc"))),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "toHex SO-style Array.from/map/padStart hex");
  } else {
    ok(true, "getChecksumSha256 direct test skipped: no global crypto.subtle in this node");
  }

  eq(escapeString('a"b\\c\bd\fe\nf\rg\th\u0001i\u007fj\ud83d\ude00k'),
    '"a\\"b\\\\c\\bd\\fe\\nf\\rg\\th\\u0001i\\u007fj\\ud83d\\ude00k"', "escapeString full range");
  eq(escapeString("plain ~ text"), '"plain ~ text"', "escapeString passthrough");
  eq(escapeString(""), '""', "escapeString empty");

  const k1 = ["\uffff", "\ud800\udc00", "z", "A", "a"];
  const sortedCp = k1.slice().sort(compareCodePoints);
  eq(JSON.stringify(sortedCp), JSON.stringify(["A", "a", "z", "\uffff", "\ud800\udc00"]), "compareCodePoints astral after U+FFFF");

  const fixtures = [
    { name: "nested", obj: { a: { b: { c: [1, 2, { d: null }] } }, e: [] } },
    {
      name: "unicode",
      obj: {
        "z": "café 😀 ‽",
        "a": "\u007f\u0001\u001f",
        "A": 'quote " backslash \\ slash /',
        " ": "\u00a0nbsp",
        "\uffff": "bmp max",
        "\ud800\udc00": "astral key",
        "é": "e-acute key",
      },
    },
    { name: "empty containers", obj: { a: {}, b: [], c: { d: {}, e: [[]] } } },
    { name: "numbers", obj: { a: 0.1, b: 1.5, c: -3, d: 100, e: 9007199254740991, f: 1e21 } },
    { name: "tags sorted", obj: { tags: ["a=1", "b=2", "c=3"], x: 1 } },
    {
      name: "realistic package",
      obj: {
        bytes: 745333,
        description: "Smallish map — with unicode 😀 and \"quotes\".",
        files: { "maps/bioforge.bsp": { bytes: 1816444, sha256: "670074c4a2705332def42ce8d1a9ea8812ff18daac8f13ed5d93e883053d9873", timestamp: "1997-10-25T18:51:44.000Z" } },
        install: { extractmapping: { "/": "{base}/maps/" } },
        json_version: "2025.09.27",
        sha256: "91fa4470a8d24e95ccfe62ef427d36a3b5604c8b2d885dc456b7a9be9a3d4b23",
        tags: ["author=Cullen Wheeler", "filename=bioforge.zip", "game=quake", "title=The Biogenetic Forge"],
        urls: ["https://www.quaddicted.com/filebase/bioforge.zip"],
      },
    },
    { name: "deep nesting", obj: { l1: { l2: { l3: { l4: { l5: [1, [2, [3]]] } } } } } },
  ];

  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "fart-ser-"));
  for (const fx of fixtures) {
    const inPath = path.join(tmpdir, fx.name + ".in.json");
    fs.writeFileSync(inPath, JSON.stringify(fx.obj));
    const expected = execFileSync("python3", ["-c",
      "import json,sys; sys.stdout.write(json.dumps(json.load(open(sys.argv[1])), indent=1, sort_keys=True) + '\\n')",
      inPath,
    ]).toString("utf8");
    const actual = serializeCanonical(fx.obj, { sortTags: true });
    eq(actual, expected, "python parity: " + fx.name);
    const rt = serializeCanonical(JSON.parse(actual), { sortTags: true });
    eq(rt, actual, "round-trip identity: " + fx.name);
  }

  const unsorted = { tags: ["b=1", "A=2", "\ud83d\ude00=3", "\uffff=4"] };
  const sorted = serializeCanonical(unsorted, { sortTags: true });
  eq(JSON.parse(sorted).tags.join("|"), "A=2|b=1|\uffff=4|\ud83d\ude00=3", "sortTags uses code point order");
  const unsortedOut = serializeCanonical(unsorted, { sortTags: false });
  eq(JSON.parse(unsortedOut).tags.join("|"), "b=1|A=2|\ud83d\ude00=3|\uffff=4", "sortTags:false preserves order");

  eq(serializeCanonical({}, {}), "{}\n", "empty object");
  eq(serializeCanonical([], {}), "[]\n", "empty array (root)");
  eq(serializeCanonical({ a: 1 }, {}), '{\n "a": 1\n}\n', "1-space indent shape");

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_sha256_serialize: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
