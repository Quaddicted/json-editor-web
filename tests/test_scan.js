"use strict";

const fs = require("fs");
const path = require("path");

const Scan = require("../js/scan.js");
const Serialize = require("../js/serialize.js");
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
function eq(a, b, name) {
  ok(a === b, name + (a === b ? "" : "\n  expected: " + JSON.stringify(b) + "\n  actual:   " + JSON.stringify(a)));
}

async function main() {
  const zipBuf = new Uint8Array(fs.readFileSync(path.join(FIX, "test.zip")));
  const pakBuf = new Uint8Array(fs.readFileSync(path.join(FIX, "test.pak")));
  const binBuf = new Uint8Array(fs.readFileSync(path.join(FIX, "notarchive.bin")));

  eq(Scan.detectMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), "zip", "detect zip");
  eq(Scan.detectMagic(new Uint8Array([0x50, 0x4b, 0x05, 0x06])), "zip", "detect empty zip");
  eq(Scan.detectMagic(new TextEncoder().encode("PACK")), "pak", "detect pak");
  eq(Scan.detectMagic(binBuf.subarray(0, 4)), null, "detect non-archive");

  eq(Scan.dosToIso(0, 0), null, "dosToIso null on date 0");
  {
    const date = ((2021 - 1980) << 9) | (3 << 5) | 14;
    const time = (15 << 11) | (9 << 5) | (52 >> 1);
    eq(Scan.dosToIso(time, date), "2021-03-14T15:09:52.000Z", "dosToIso roundtrip");
    const badMonth = (41 << 9) | (13 << 5) | 14;
    eq(Scan.dosToIso(time, badMonth), null, "dosToIso invalid month");
    const badDay = (41 << 9) | (3 << 5) | 0;
    eq(Scan.dosToIso(time, badDay), null, "dosToIso invalid day");
  }

  const zipRes = await Scan.scanArchive(zipBuf);
  eq(zipRes.kind, "zip", "scan zip kind");
  const expectedZip = fs.readFileSync(path.join(FIX, "expected_zip_files.json"), "utf8");
  eq(Serialize.serializeCanonical(zipRes.files, {}), expectedZip, "zip files tree byte-parity vs python");
  eq(Object.keys(zipRes.errors).length, 0, "zip scan no errors");
  ok(zipRes.files["maps/"] && zipRes.files["maps/"].sha256 === Scan.EMPTY_SHA256 && zipRes.files["maps/"].bytes === 0, "explicit dir entry");
  eq(zipRes.files["maps/"].timestamp, "2021-03-14T15:09:26.000Z", "dir timestamp");
  ok(zipRes.files["gfx/"] && !("timestamp" in zipRes.files["gfx/"]), "implicit parent dir without timestamp");
  ok(zipRes.files["inner.zip"] && zipRes.files["inner.zip"].files && zipRes.files["inner.zip"].files["deep.txt"], "nested zip files");
  eq(zipRes.files["inner.zip"].files["sub/inner2.txt"].bytes, (Buffer.from("nested deflated payload ").length) * 10, "nested deflate size");

  const pakRes = await Scan.scanArchive(pakBuf);
  eq(pakRes.kind, "pak", "scan pak kind");
  const expectedPak = fs.readFileSync(path.join(FIX, "expected_pak_files.json"), "utf8");
  eq(Serialize.serializeCanonical(pakRes.files, {}), expectedPak, "pak files tree byte-parity vs python");
  ok(pakRes.files["inner.zip"].files["deep.txt"], "pak nested zip");
  ok(!("timestamp" in pakRes.files["maps/start.bsp"]), "pak entries have no timestamp");

  const binRes = await Scan.scanArchive(binBuf);
  eq(binRes.kind, null, "non-archive kind null");
  eq(Object.keys(binRes.files).length, 0, "non-archive empty files");

  const blobRes = await Scan.scanArchive(new Blob([zipBuf]));
  eq(Serialize.serializeCanonical(blobRes.files, {}), expectedZip, "Blob reader path parity");

  const abRes = await Scan.scanArchive(zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.length));
  eq(Serialize.serializeCanonical(abRes.files, {}), expectedZip, "ArrayBuffer reader path parity");

  {
    const corrupt = new Uint8Array(zipBuf);
    const needle = new TextEncoder().encode("maps/e1m1.bsp");
    let nameIdx = -1;
    for (let i = 0; i + needle.length <= corrupt.length; i++) {
      let match = true;
      for (let j = 0; j < needle.length; j++) if (corrupt[i + j] !== needle[j]) { match = false; break; }
      if (match) { nameIdx = i; break; }
    }
    const sigPos = nameIdx - 30;
    ok(sigPos > 0 && corrupt[sigPos] === 0x50 && corrupt[sigPos + 1] === 0x4b, "located local header of maps/e1m1.bsp");
    corrupt[sigPos] = 0x00;
    const res = await Scan.scanArchive(corrupt);
    ok(res.kind === "zip", "corrupt local header still scans");
    ok(Object.keys(res.errors).some((k) => k.includes("maps/e1m1.bsp")), "corrupt local header -> per-file error: " + JSON.stringify(res.errors));
    ok(res.files["readme.txt"], "other entries still scanned");
  }

  {
    const destroyed = new Uint8Array(zipBuf);
    destroyed.fill(0, destroyed.length - 22);
    let threw = false;
    try {
      await Scan.scanArchive(destroyed);
    } catch (e) {
      threw = true;
      ok(/central directory/i.test(e.message), "destroyed EOCD error message: " + e.message);
    }
    ok(threw, "destroyed EOCD rejects");
  }

  {
    const res = await Scan.scanArchive(zipBuf, { maxEntries: 2 });
    ok(Object.keys(res.errors).some((k) => res.errors[k].includes("Too many entries")), "entry budget -> error not crash");
  }

  eq(await hashBytes(new Uint8Array(0)), Scan.EMPTY_SHA256, "EMPTY_SHA256 constant matches hash of empty");

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_scan: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
