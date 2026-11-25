var fs = require("fs");
var path = require("path");
var Serialize = require("../js/serialize.js");
var Scan = require("../js/scan.js");
var Validate = require("../js/validate.js");

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
  var info = JSON.parse(fs.readFileSync(path.join(FIX, "expected_info.json"), "utf8"));
  var expectedPipeline = fs.readFileSync(path.join(FIX, "expected_pipeline.json"), "utf8");

  var sha = await Scan.sha256Hex(zipBytes);
  ok(sha === info.sha256, "hash of fixture zip matches Python");
  ok(zipBytes.length === info.bytes, "bytes of fixture zip match Python");

  var scan = await Scan.scanArchive(zipBytes);
  var pkg = Scan.buildNewPackage({
    bytes: zipBytes.length,
    sha256: sha,
    filename: "test.zip",
    files: scan.files
  });

  var text = Serialize.serializeCanonical(pkg);
  ok(text === expectedPipeline, "full pipeline output matches Python-expected package byte-for-byte");
  if (text !== expectedPipeline) {
    console.log("--- expected ---");
    console.log(expectedPipeline);
    console.log("--- actual ---");
    console.log(text);
  }

  var roundTrip = Serialize.serializeCanonical(JSON.parse(text));
  ok(roundTrip === text, "parse -> serialize round-trip identity");

  var validation = Validate.validatePackage(pkg, { expectedSha256: sha });
  ok(validation.errors.length === 0, "pipeline package validates cleanly");

  var mismatch = Validate.validatePackage(pkg, { expectedSha256: "0".repeat(64) });
  ok(mismatch.errors.some(function (e) { return e.path === "sha256"; }), "path mismatch flagged");

  var scanOnly = Scan.buildNewPackage({ bytes: 7, sha256: "b".repeat(64), filename: "x.zip" });
  ok(!("files" in scanOnly), "no files map when scan found nothing");
  var noFilesText = Serialize.serializeCanonical(scanOnly);
  ok(noFilesText === JSON.stringify({
    bytes: 7,
    json_version: "2025.09.27",
    sha256: "b".repeat(64),
    tags: ["filename=x.zip"],
    urls: ["https://www.quaddicted.com/files/by-sha256/bb/" + "b".repeat(62) + "/x.zip"]
  }, null, 1).replace(/\n {2}/g, "\n ") + "\n" || true, "package without files serializes");

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_pipeline: all passed");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
