"use strict";

const fs = require("fs");
const path = require("path");

const Scan = require("../js/scan.js");
const Serialize = require("../js/serialize.js");
const Validate = require("../js/validate.js");
const { hashBytes } = require("../js/sha256.js");

const FIX = path.join(__dirname, "fixtures");

let failures = 0;
function ok(cond, name) {
  if (cond) console.log("ok - " + name);
  else {
    failures++;
    console.error("FAIL - " + name);
  }
}

async function main() {
  const buf = new Uint8Array(fs.readFileSync(path.join(FIX, "test.zip")));
  const sha = await hashBytes(buf);
  {
    const expectedSha = fs.readFileSync(path.join(FIX, "test.zip.sha256"), "utf8").trim();
    ok(sha === expectedSha, "pipeline sha256 matches python");
  }

  const scan = await Scan.scanArchive(buf);
  const pkg = {
    bytes: buf.length,
    json_version: "2025.09.27",
    sha256: sha,
    tags: ["filename=test.zip"],
    urls: ["https://www.quaddicted.com/files/by-sha256/" + sha.slice(0, 2) + "/" + sha + "/test.zip"],
  };
  if (scan.kind && Object.keys(scan.files).length > 0) pkg.files = scan.files;

  const serialized = Serialize.serializeCanonical(pkg, { sortTags: true });
  const expected = fs.readFileSync(path.join(FIX, "expected_package.json"), "utf8");
  ok(serialized === expected, "full pipeline serialization byte-parity vs python json.dump");
  if (serialized !== expected) {
    const a = serialized.split("\n");
    const b = expected.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error("first diff at line " + (i + 1) + ":\n  js:     " + JSON.stringify(a[i]) + "\n  python: " + JSON.stringify(b[i]));
        break;
      }
    }
  }

  const roundTrip = Serialize.serializeCanonical(JSON.parse(serialized), { sortTags: true });
  ok(roundTrip === serialized, "parse->serialize identity");

  const v = Validate.validatePackage(JSON.parse(serialized), { expectedSha256: sha });
  ok(v.errors.length === 0, "pipeline package validates clean: " + JSON.stringify(v.errors));
  ok(v.warnings.length === 0, "pipeline package no warnings: " + JSON.stringify(v.warnings));

  const vBad = Validate.validatePackage(JSON.parse(serialized), { expectedSha256: "0".repeat(64) });
  ok(vBad.errors.some((e) => e.message.includes("mismatch")), "path mismatch flagged");

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_pipeline: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
