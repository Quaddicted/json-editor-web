"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this._text = "";
    this.className = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.files = [];
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  append(...nodes) {
    for (const n of nodes) this.children.push(n);
  }
  appendChild(n) {
    this.children.push(n);
    return n;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === "value") this.value = String(v);
  }
  getAttribute(k) {
    return k in this.attributes ? this.attributes[k] : null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  dispatch(type, ev) {
    for (const fn of this.listeners[type] || []) fn(ev || { target: this, key: undefined });
  }
  click() {
    this.dispatch("click", { target: this });
  }
  remove() {}
  focus() {
    document.activeElement = this;
  }
  select() {}
}

const elements = {};
for (const m of html.matchAll(/id="([^"]+)"/g)) elements[m[1]] = new El("div");

global.document = {
  activeElement: null,
  body: new El("body"),
  getElementById: (id) => elements[id] || null,
  createElement: (tag) => new El(tag),
  createTextNode: (s) => ({ nodeType: 3, textContent: String(s) }),
};
const storeMap = new Map();
global.localStorage = {
  getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
  setItem: (k, v) => storeMap.set(k, String(v)),
  removeItem: (k) => storeMap.delete(k),
};
global.self = globalThis;

require("../js/bundle.js");

const Scan = globalThis.Scan;
const Serialize = globalThis.Serialize;

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
  ok(globalThis.StreamZip, "bundle exposes StreamZip (node-stream-zip)");
  ok(globalThis.StreamZipFs && typeof globalThis.StreamZipFs.register === "function", "bundle exposes StreamZipFs shim");
  ok(Scan && typeof Scan.scanArchive === "function", "bundle exposes Scan");
  ok(elements["form-pane"].textContent.includes("No package loaded"), "bundled app boots into empty state");

  const zipBuf = new Uint8Array(fs.readFileSync(path.join(FIX, "test.zip")));
  const pakBuf = new Uint8Array(fs.readFileSync(path.join(FIX, "test.pak")));

  const zipRes = await Scan.scanArchive(zipBuf);
  eq(zipRes.kind, "zip", "bundle: zip kind via node-stream-zip + fs shim");
  const expectedZip = fs.readFileSync(path.join(FIX, "expected_zip_files.json"), "utf8");
  eq(Serialize.serializeCanonical(zipRes.files, {}), expectedZip, "bundle: zip files tree byte-parity vs python");
  eq(Object.keys(zipRes.errors).length, 0, "bundle: zip scan no errors");
  ok(zipRes.files["inner.zip"] && zipRes.files["inner.zip"].files["deep.txt"], "bundle: nested zip recursed");
  eq(zipRes.files["maps/"].timestamp, "2021-03-14T15:09:26.000Z", "bundle: dir timestamp from central directory");

  const pakRes = await Scan.scanArchive(pakBuf);
  eq(pakRes.kind, "pak", "bundle: pak kind");
  const expectedPak = fs.readFileSync(path.join(FIX, "expected_pak_files.json"), "utf8");
  eq(Serialize.serializeCanonical(pakRes.files, {}), expectedPak, "bundle: pak files tree byte-parity vs python");

  const blobRes = await Scan.scanArchive(new Blob([zipBuf]));
  eq(Serialize.serializeCanonical(blobRes.files, {}), expectedZip, "bundle: Blob source parity");

  const destroyed = new Uint8Array(zipBuf);
  destroyed.fill(0, destroyed.length - 22);
  let threw = false;
  try {
    await Scan.scanArchive(destroyed);
  } catch (e) {
    threw = true;
    ok(/central directory/i.test(e.message), "bundle: destroyed EOCD message: " + e.message);
  }
  ok(threw, "bundle: destroyed EOCD rejects");

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
    corrupt[sigPos] = 0x00;
    const res = await Scan.scanArchive(corrupt);
    ok(Object.keys(res.errors).some((k) => k.includes("maps/e1m1.bsp")), "bundle: corrupt local header -> per-file error");
    ok(res.files["readme.txt"], "bundle: other entries still scanned");
  }

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_bundle: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
