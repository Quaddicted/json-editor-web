var fs = require("fs");
var path = require("path");
var Scan = require("../js/scan.js");
var Serialize = require("../js/serialize.js");

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

(async function () {
  var zipBytes = new Uint8Array(fs.readFileSync(path.join(FIX, "test.zip")));
  var expectedScan = fs.readFileSync(path.join(FIX, "expected_scan.json"), "utf8");

  var scan = await Scan.scanArchive(zipBytes);
  ok(scan.kind === "zip", "test.zip detected as zip");
  ok(Object.keys(scan.errors).length === 0, "no scan errors");
  var actual = Serialize.serializeCanonical(scan.files);
  ok(actual === expectedScan, "scan tree matches Python-expected tree byte-for-byte");
  if (actual !== expectedScan) {
    console.log("--- expected ---");
    console.log(expectedScan);
    console.log("--- actual ---");
    console.log(actual);
  }

  ok(scan.files["dir/"].bytes === 0, "dir entry has bytes 0");
  ok(scan.files["dir/"].sha256 === Scan.EMPTY_SHA256, "dir entry has empty sha256");
  ok(scan.files["dir/"].timestamp === "2021-01-01T00:00:02.000Z", "dir entry timestamp");
  ok(scan.files["readme.txt"].timestamp === "2021-07-12T17:54:58.000Z", "deflate entry timestamp");
  ok(typeof scan.files["inner.zip"].files === "object", "nested zip scanned");
  ok(scan.files["inner.zip"].files["inner.txt"].bytes === 14, "nested zip entry bytes");
  ok(typeof scan.files["pak0.pak"].files === "object", "nested pak scanned");
  ok(scan.files["pak0.pak"].files["maps/test.bsp"].bytes === 45, "pak entry bytes");
  ok(!("timestamp" in scan.files["pak0.pak"].files["maps/test.bsp"]), "pak entries have no timestamp");

  var notArchive = await Scan.scanArchive(new Uint8Array(fs.readFileSync(path.join(FIX, "notarchive.bin"))));
  ok(notArchive.kind === null && notArchive.files === null, "notarchive.bin not detected as archive");

  var blobLike = await Scan.scanArchive(zipBytes.buffer);
  ok(blobLike.kind === "zip", "ArrayBuffer input accepted");

  // EOCD robustness: a fake end-of-central-directory signature in trailing
  // garbage must not derail the parse
  var trailing = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 1, 2, 3, 4
  ]);
  var padded = new Uint8Array(zipBytes.length + trailing.length);
  padded.set(zipBytes, 0);
  padded.set(trailing, zipBytes.length);
  var paddedScan = await Scan.scanArchive(padded);
  ok(paddedScan.kind === "zip", "zip with trailing garbage still detected");
  ok(paddedScan.files["test.txt"] !== undefined ||
     Object.keys(paddedScan.files).length === Object.keys(scan.files).length,
     "entries parsed correctly despite the fake EOCD in the garbage");

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_scan: all passed");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
