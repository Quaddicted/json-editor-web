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

require("../js/app.js");

const Serialize = require("../js/serialize.js");

let failures = 0;
function ok(cond, name) {
  if (cond) console.log("ok - " + name);
  else {
    failures++;
    console.error("FAIL - " + name);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  ok(elements["form-pane"].textContent.includes("No package loaded"), "boot shows empty state");
  ok(elements["btn-download"].disabled === true, "download disabled with no package");

  const pkg = {
    bytes: 10,
    sha256: "a".repeat(64),
    json_version: "2025.09.27",
    description: "smoke test",
    tags: ["game=quake", "filename=x.zip"],
    urls: ["https://www.quaddicted.com/filebase/x.zip"],
    files: { "maps/a.bsp": { bytes: 5, sha256: "b".repeat(64) } },
  };
  elements["paste-text"].value = JSON.stringify(pkg);
  elements["btn-paste-load"].click();

  const expectedRaw = Serialize.serializeCanonical(pkg, { sortTags: true });
  ok(elements["raw"].value === expectedRaw, "paste flow syncs raw textarea");
  ok(elements["validation"].textContent.includes("No errors"), "validation clean after paste: " + elements["validation"].textContent);
  ok(elements["btn-download"].disabled === false, "download enabled when valid");
  ok(elements["btn-copy"].disabled === false, "copy enabled when valid");
  ok(elements["btn-pr"].disabled === true, "pr disabled without token");
  ok(elements["modified-badge"].hidden === true, "not modified right after load");
  {
    let foundTag = false;
    const walk = (el) => {
      if (el.value === "filename=x.zip") foundTag = true;
      for (const c of el.children || []) walk(c);
    };
    walk(elements["form-pane"]);
    ok(elements["form-pane"].children.length >= 6, "form pane renders 6 sections");
    ok(foundTag, "form pane renders tag row with filename=x.zip");
  }

  const draft = JSON.parse(storeMap.get("quaddicted-editor-draft"));
  ok(draft && draft.pkg && draft.pkg.sha256 === "a".repeat(64), "draft saved to localStorage");

  elements["inp-pat"].value = "tok123";
  elements["inp-pat"].dispatch("input");
  ok(elements["btn-pr"].disabled === false, "pr enabled with token + valid pkg");
  ok(elements["btn-reload-api"].disabled === false, "reload-api enabled with valid sha256");

  elements["raw"].value = "{not json";
  elements["raw"].dispatch("input");
  await sleep(600);
  ok(elements["validation"].textContent.includes("parse error"), "invalid raw surfaces parse error");

  const pkg2 = Object.assign({}, pkg, { bytes: 20 });
  elements["raw"].value = JSON.stringify(pkg2);
  elements["raw"].dispatch("input");
  await sleep(600);
  ok(elements["validation"].textContent.includes("No errors"), "edited raw revalidates clean");
  ok(elements["raw"].value === Serialize.serializeCanonical(pkg2, { sortTags: true }), "raw rewritten canonically after edit");
  ok(elements["modified-badge"].hidden === false, "modified badge shows after edit");
  ok(elements["btn-download"].disabled === false, "still exportable after edit");

  await sleep(900);
  const draft2 = JSON.parse(storeMap.get("quaddicted-editor-draft"));
  ok(draft2 && draft2.pkg.bytes === 20, "draft updated after debounce");

  const pkg3 = Object.assign({}, pkg2, { install: { extractmapping: {}, extract: "" } });
  elements["raw"].value = JSON.stringify(pkg3);
  elements["raw"].dispatch("input");
  await sleep(600);
  ok(!elements["raw"].value.includes('"install"'), "empty install/extract/extractmapping pruned from raw JSON");
  ok(elements["validation"].textContent.includes("No errors"), "pruned package still validates clean");

  elements["inp-sha"].value = "a".repeat(64);
  elements["btn-discard-draft"].click();
  ok(global.localStorage.getItem("quaddicted-editor-draft") === null, "discard removes draft");
  ok(elements["draft-banner"].hidden === true, "banner hidden after discard");
  ok(elements["raw"].value === "", "raw cleared after discard");
  ok(elements["inp-sha"].value === "", "discard clears the sha256 line");
  ok(elements["btn-reload-api"].disabled === true, "reload-api disabled with no package");

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_ui_smoke: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
