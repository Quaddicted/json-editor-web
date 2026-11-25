var fs = require("fs");
var path = require("path");
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

console.log("serialize:");
var serializerSamples = JSON.parse(fs.readFileSync(path.join(FIX, "expected_serialize.json"), "utf8"));
serializerSamples.forEach(function (sample) {
  var actual = Serialize.serializeCanonical(sample.input);
  ok(actual === sample.expected, "canonical serialization: " + sample.name);
  var roundTrip = Serialize.serializeCanonical(JSON.parse(actual));
  ok(roundTrip === actual, "round-trip identity: " + sample.name);
});

console.log("escaping (ensure_ascii=False):");
ok(Serialize.escapeString("caf\u00e9") === "\"caf\u00e9\"", "non-ascii stays raw");
ok(Serialize.escapeString("a\"b\\c") === "\"a\\\"b\\\\c\"", "quotes and backslashes escaped");
ok(Serialize.escapeString("x\ny") === "\"x\\ny\"", "control chars escaped");

console.log("tags sorting:");
var pkg = { tags: ["b=x", "a=y", "c=z"], sha256: "a".repeat(64), bytes: 1 };
var text = Serialize.serializeCanonical(pkg);
ok(text.indexOf('"a=y"') < text.indexOf('"b=x"') &&
   text.indexOf('"b=x"') < text.indexOf('"c=z"'), "tags sorted alphabetically");
ok(pkg.tags[0] === "b=x", "input tags array not mutated");

if (failures) {
  console.error(failures + " failure(s)");
  process.exit(1);
}
console.log("test_serialize: all passed");
