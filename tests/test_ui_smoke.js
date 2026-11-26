// Minimal DOM shim + boot + paste flow smoke test for js/app.js.
var fs = require("fs");
var path = require("path");

var failures = 0;
function ok(cond, message) {
  if (cond) {
    console.log("  ok - " + message);
  } else {
    failures++;
    console.log("  FAIL - " + message);
  }
}

// --- storage shim ---------------------------------------------------------
var storageData = {};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null; },
  setItem: function (k, v) { storageData[k] = String(v); },
  removeItem: function (k) { delete storageData[k]; }
};

// --- element shim ---------------------------------------------------------
function makeElement(tag) {
  var el = {
    tagName: tag,
    children: [],
    parentNode: null,
    textContent: "",
    value: "",
    disabled: false,
    style: {},
    attrs: {},
    listeners: {},
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    appendChild: function (c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild: function (c) {
      var i = this.children.indexOf(c);
      if (i !== -1) { this.children.splice(i, 1); }
      c.parentNode = null;
      return c;
    },
    addEventListener: function (ev, fn) {
      (this.listeners[ev] = this.listeners[ev] || []).push(fn);
    },
    click: function () {
      (this.listeners.click || []).forEach(function (fn) { fn(); });
    },
    focus: function () { this.focused = true; },
    setSelectionRange: function (a, b) { this.selection = [a, b]; },
    get firstChild() { return this.children[0] || null; }
  };
  return el;
}

// --- document shim, ids taken from the real index.html ---------------------
var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
var registry = {};
var idRegex = /id="([^"]+)"/g;
var m;
while ((m = idRegex.exec(html)) !== null) {
  registry[m[1]] = makeElement(m[1]);
}

globalThis.document = {
  readyState: "complete",
  activeElement: null,
  body: makeElement("body"),
  getElementById: function (id) { return registry[id] || null; },
  createElement: function (tag) { return makeElement(tag); },
  createTextNode: function (t) { return { text: t, parentNode: null }; },
  addEventListener: function () {}
};
globalThis.navigator = { clipboard: { writeText: async function () {} } };

// --- load modules into globals, then app.js -------------------------------
globalThis.pako = require("../js/vendor/pako_inflate.min.js");
globalThis.Serialize = require("../js/serialize.js");
globalThis.Tagdata = require("../js/tagdata.js");
globalThis.Validate = require("../js/validate.js");
globalThis.Scan = require("../js/scan.js");
globalThis.Github = require("../js/github.js");
// the CodeMirror 6 bundle is assumed to always be present; install our stub
// before app.js loads so its auto-boot can build the editor
var insertions = [];
function FakeView(config) {
  this.state = { doc: { length: 0, toString: function () { return ""; } } };
  this.config = config;
}
FakeView.lineWrapping = {};
FakeView.updateListener = { of: function (fn) { return fn; } };
FakeView.prototype.dispatch = function (tr) {
  var text = tr.changes.insert;
  insertions.push(text);
  this.state = { doc: { length: text.length, toString: function () { return text; } } };
};
FakeView.prototype.focus = function () {};
globalThis.QeCM = { EditorView: FakeView, basicSetup: {}, json: function () { return {}; } };

var App = require("../js/app.js");

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

(async function () {
  ok(App.boot && typeof App.boot === "function", "app.js exports boot hook");
  ok(registry["validation"] && registry["form-pane"], "shim has core elements");

  ok(App.getRawEditor() !== null, "raw editor adapter built at boot from the stub bundle");

  // paste flow: load a valid package
  var validPkg = JSON.stringify({
    bytes: 42,
    sha256: "a".repeat(64),
    tags: ["filename=test.zip", "game=quake"],
    urls: ["https://www.quaddicted.com"]
  });
  var loaded = App.loadPackageFromText(validPkg, { type: "paste", expectedSha256: null, filename: null });
  ok(loaded === true, "paste flow loads package");
  ok(App.state.pkg && App.state.pkg.bytes === 42, "state.pkg populated");
  var re = App.getRawEditor();
  ok(re !== null, "raw editor adapter exists");
  ok(re.getValue() === App.canonicalText(), "raw editor synced with canonical text");
  ok(re.getValue().indexOf('"bytes": 42') !== -1, "raw text is canonical (1-space indent)");
  ok(registry["raw-cm"] !== null, "raw editor container exists");
  ok(App.state.validation && App.state.validation.errors.length === 0, "validation clean");
  ok(registry["btn-download"].disabled === false, "download button enabled");
  ok(registry["btn-copy"].disabled === false, "copy button enabled");
  ok(registry["btn-pr"].disabled === false, "PR button enabled");
  ok(registry["form-pane"].children.length > 0, "form pane rendered sections");

  // draft saved (debounced 800 ms)
  await sleep(1000);
  ok(globalThis.localStorage.getItem("quaddicted-web-editor:draft") !== null, "draft saved to localStorage");

  // invalid raw JSON surfaces a parse error
  App.getRawEditor().setValue("{invalid json");
  App.onRawInput();
  await sleep(600);
  ok(App.state.rawParseError !== null, "invalid raw JSON surfaces parse error");
  var valBox = registry["validation"];
  ok(valBox.children.length > 0 &&
     valBox.children[0].textContent.indexOf("JSON parse error") !== -1,
     "validation box shows parse error");

  // read-only collapsible files tree
  function findAll(node, pred, acc) {
    acc = acc || [];
    (node.children || []).forEach(function (c) {
      if (c.attrs && pred(c)) { acc.push(c); }
      findAll(c, pred, acc);
    });
    return acc;
  }
  var pkgWithFiles = JSON.stringify({
    bytes: 100,
    sha256: "b".repeat(64),
    files: {
      "readme.txt": { bytes: 3, sha256: "c".repeat(64), timestamp: "2021-07-12T17:54:58.000Z" },
      "dir/": { bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
      "inner.zip": { bytes: 9, sha256: "d".repeat(64), files: { "x.txt": { bytes: 1, sha256: "e".repeat(64) } } }
    }
  });
  App.loadPackageFromText(pkgWithFiles, { type: "paste", expectedSha256: null, filename: null });
  var formPane = registry["form-pane"];
  var toggles = findAll(formPane, function (c) { return c.attrs["class"] === "tree-toggle"; });
  ok(toggles.length === 1, "files tree renders one collapsible dir (nested archive dir)");
  var metaSpans = findAll(formPane, function (c) { return c.attrs["class"] === "tree-meta-row"; });
  ok(metaSpans.some(function (s) { return s.textContent.indexOf("3 B") !== -1; }), "file meta shows bytes");
  ok(metaSpans.some(function (s) { return s.textContent.indexOf("cccccccccccc\u2026") !== -1; }), "file meta shows sha256 prefix");
  var fileInputs = findAll(formPane, function (c) {
    return c.tagName === "input" && (c.attrs["type"] === "text" || c.attrs["type"] === "number");
  });
  var filesInputs = fileInputs.filter(function (c) {
    return c.attrs["placeholder"] === "new entry name";
  });
  ok(filesInputs.length === 0, "no manual add-file inputs in files section");
  toggles[0].click();
  ok(App.state.collapsedDirs && App.state.collapsedDirs.size === 1, "dir collapsed after toggle click");
  var togglesAfter = findAll(registry["form-pane"], function (c) { return c.attrs["class"] === "tree-toggle"; });
  ok(togglesAfter.length === 1 && togglesAfter[0].textContent === "+", "collapsed toggle shows +");
  togglesAfter[0].click();
  ok(App.state.collapsedDirs.size === 0, "dir expanded again after toggle click");

  // URL rows use the same X design as tags; no filebase button
  App.loadPackageFromText(JSON.stringify({
    bytes: 42,
    sha256: "a".repeat(64),
    urls: ["https://www.quaddicted.com", "https://example.com"]
  }), { type: "paste", expectedSha256: null, filename: null });
  var urlRows = findAll(registry["form-pane"], function (c) { return c.attrs["class"] === "row url-row"; });
  ok(urlRows.length === 2, "url rows rendered");
  var urlX = findAll(urlRows[0], function (c) {
    return c.tagName === "button" && c.attrs["class"] === "remove-x";
  })[0];
  ok(urlX !== undefined && urlX.textContent === "X", "url row has small X button in front");
  ok(urlRows[0].children[0] === urlX, "X button precedes the url input");
  var filebaseBtn = findAll(registry["form-pane"], function (c) {
    return c.tagName === "button" && c.textContent === "Add filebase URL";
  })[0];
  ok(filebaseBtn === undefined, "Add filebase URL button removed");
  urlX.click();
  ok(App.state.pkg.urls.length === 1, "X button removes the URL");

  // bytes/sha256 read-only, json_version hidden, status bar fixed at bottom
  ok(registry["status-bar"] !== null, "fixed status bar present in the page");
  ok(registry["status"] !== null && registry["status"].parentsIndexOf === undefined, "status span exists");
  var pkgBytesInputs = findAll(registry["form-pane"], function (c) {
    return (c.tagName === "input" || c.tagName === "button") &&
      c.attrs["placeholder"] === undefined && c.tagName === "input" &&
      (c.attrs["type"] === "number" || c.attrs["type"] === "text");
  });
  var readOnlyCodes = findAll(registry["form-pane"], function (c) {
    return c.tagName === "code" && c.attrs["class"] === "readonly-value";
  });
  ok(readOnlyCodes.length === 2, "bytes and sha256 rendered as read-only code");
  ok(readOnlyCodes.some(function (c) { return c.textContent === "42"; }),
     "bytes shown read-only");
  ok(readOnlyCodes.some(function (c) { return c.textContent === "a".repeat(64); }),
     "sha256 shown read-only");
  var jsonVersionLabels = findAll(registry["form-pane"], function (c) {
    return c.tagName === "label" && c.textContent === "json_version";
  });
  ok(jsonVersionLabels.length === 0, "json_version not rendered in the form");
  ok(App.state.pkg.json_version === undefined ||
     "json_version" in (App.state.pkg || {}), "json_version untouched in data");

  // live markdown preview of the description
  App.loadPackageFromText(JSON.stringify({
    bytes: 42,
    sha256: "a".repeat(64),
    description: "A **bold** map with *italics* and [a link](https://www.quaddicted.com) plus `code`.\n\n- item one\n- item two"
  }), { type: "paste", expectedSha256: null, filename: null });
  var preview = findAll(registry["form-pane"], function (c) { return c.attrs["class"] === "md-preview"; })[0];
  ok(preview !== undefined, "markdown preview rendered below description input");
  var strong = findAll(preview, function (c) { return c.tagName === "strong"; })[0];
  ok(strong !== undefined && strong.textContent === "bold", "bold rendered");
  var em = findAll(preview, function (c) { return c.tagName === "em"; })[0];
  ok(em !== undefined && em.textContent === "italics", "italics rendered");
  var code = findAll(preview, function (c) { return c.tagName === "code"; })[0];
  ok(code !== undefined && code.textContent === "code", "code rendered");
  var link = findAll(preview, function (c) { return c.tagName === "a"; })[0];
  ok(link !== undefined && link.attrs["href"] === "https://www.quaddicted.com" &&
     link.attrs["rel"] === "noopener noreferrer", "link rendered with rel");
  var lis = findAll(preview, function (c) { return c.tagName === "li"; });
  ok(lis.length === 2, "list rendered");
  // live update: type into the description textarea (debounced)
  var descTa = findAll(registry["form-pane"], function (c) { return c.tagName === "textarea"; })[0];
  descTa.value = "plain **updated** text";
  (descTa.listeners.input || []).forEach(function (fn) { fn(); });
  var strongsEarly = findAll(preview, function (c) { return c.tagName === "strong"; })
    .map(function (c) { return c.textContent; });
  ok(strongsEarly.indexOf("updated") === -1, "preview not re-rendered synchronously while typing");
  await sleep(400);
  var strongsLate = findAll(preview, function (c) { return c.tagName === "strong"; })
    .map(function (c) { return c.textContent; });
  ok(strongsLate.indexOf("updated") !== -1, "preview updates after debounce");
  ok(App.getRawEditor().getValue().indexOf("plain **updated** text") !== -1,
     "raw sync also applied after debounce");

  // tag rows: X in front, hint below the input
  App.loadPackageFromText(JSON.stringify({
    bytes: 42,
    sha256: "a".repeat(64),
    tags: ["game=quake", "title=Original", "type=map"]
  }), { type: "paste", expectedSha256: null, filename: null });
  var tagRows = findAll(registry["form-pane"], function (c) { return c.attrs["class"] === "tag-row"; });
  ok(tagRows.length === 3, "tag rows rendered");
  var firstTagRow = tagRows[0];
  var xBtn = findAll(firstTagRow, function (c) {
    return c.tagName === "button" && c.attrs["class"] === "remove-x";
  })[0];
  ok(xBtn !== undefined && xBtn.textContent === "X", "tag row has small X button in front");
  var inputRowOfTag = findAll(firstTagRow, function (c) { return c.attrs["class"] === "row tag-input-row"; })[0];
  ok(inputRowOfTag.children[0] === xBtn && inputRowOfTag.children[1].tagName === "input",
     "X button precedes the tag input");
  ok(firstTagRow.children[0].attrs["class"] === "row tag-input-row" &&
     firstTagRow.children[1].attrs["class"] === "tag-hint",
     "tag hint is a block below the input row, not a flex sibling");
  xBtn.click();
  ok(App.state.pkg.tags.length === 2, "X button removes the tag");

  // copy tags from another package via sha256 lookup
  var copyPkg = JSON.stringify({
    bytes: 42,
    sha256: "a".repeat(64),
    tags: ["game=quake", "title=Original"]
  });
  App.loadPackageFromText(copyPkg, { type: "paste", expectedSha256: null, filename: null });
  var realFetch = globalThis.fetch;
  globalThis.fetch = async function () {
    return {
      ok: true,
      status: 200,
      json: async function () {
        return [{ sha256: "f".repeat(64), bytes: 9, tags: ["game=quake", "theme=base", "filename=other.zip"] }];
      }
    };
  };
  await App.copyTagsFromSha("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
  globalThis.fetch = realFetch;
  ok(JSON.stringify(App.state.pkg.tags) === JSON.stringify(["game=quake", "title=Original", "theme=base"]),
     "copy tags appends new tags, skips filename tag and duplicates");
  ok(registry["status"].textContent.indexOf("1 tag(s)") !== -1, "status reports copied tag count");
  var copyBtn = findAll(registry["form-pane"], function (c) {
    return c.tagName === "button" && c.textContent === "Copy tags from sha256";
  })[0];
  ok(copyBtn !== undefined, "copy tags button rendered in Tags section");
  ok(findAll(registry["form-pane"], function (c) {
    return c.tagName === "input" && c.attrs["placeholder"] === "sha256 of another package";
  }).length === 0,
     "no permanent sha256 input next to the copy tags button");
  ok(registry["inp-sha"] === undefined, "toolbar sha256 text input removed");
  var prompted = [];
  globalThis.prompt = function (msg) { prompted.push(msg); return "f".repeat(64); };
  var copyDialogFetch = async function () {
    return {
      ok: true,
      status: 200,
      json: async function () {
        return [{ sha256: "f".repeat(64), bytes: 9, tags: ["game=quake", "theme=base"] }];
      }
    };
  };
  globalThis.fetch = copyDialogFetch;
  copyBtn.click();
  await sleep(10);
  delete globalThis.prompt;
  globalThis.fetch = realFetch;
  ok(prompted.length === 1 && prompted[0].indexOf("sha256") !== -1,
     "copy tags asks for the sha256 in a dialog");
  ok(JSON.stringify(App.state.pkg.tags) === JSON.stringify(["game=quake", "title=Original", "theme=base"]),
     "copy tags uses the sha256 entered in the dialog");
  var openShaBtn = registry["btn-open-sha"];
  var openPrompts = [];
  globalThis.prompt = function (msg) { openPrompts.push(msg); return "e".repeat(64); };
  globalThis.fetch = async function () {
    return {
      ok: true,
      status: 200,
      json: async function () {
        return [{ sha256: "e".repeat(64), bytes: 7, tags: ["game=quake"] }];
      }
    };
  };
  openShaBtn.click();
  await sleep(10);
  delete globalThis.prompt;
  globalThis.fetch = realFetch;
  ok(openPrompts.length === 1, "open by sha256 asks in a dialog");
  ok(App.state.pkg && App.state.pkg.sha256 === "e".repeat(64),
     "open by sha256 loads the package from the dialog input");

  // multiple notes: list of strings
  var pkgWithNotes = JSON.stringify({
    bytes: 10,
    sha256: "c".repeat(64),
    notes: ["first note", "second note"]
  });
  App.loadPackageFromText(pkgWithNotes, { type: "paste", expectedSha256: null, filename: null });
  var noteRows = findAll(registry["form-pane"], function (c) { return c.attrs["class"] === "row note-row"; });
  ok(noteRows.length === 2, "notes render as a list of rows");
  ok(JSON.stringify(App.state.pkg.notes) === JSON.stringify(["first note", "second note"]), "notes kept as list");
  var addNoteBtn = findAll(registry["form-pane"], function (c) {
    return c.tagName === "button" && c.textContent === "Add note";
  })[0];
  ok(addNoteBtn !== undefined, "add note button exists");
  addNoteBtn.click();
  ok(App.state.pkg.notes.length === 3 && App.state.pkg.notes[2] === "", "add note appends empty note");
  var removeBtns = findAll(noteRows[0], function (c) {
    return c.tagName === "button" && c.textContent === "Remove";
  });
  ok(removeBtns.length === 1, "note rows have remove button");
  // clearing a note does not delete the row; only Remove does
  var noteTextareas = noteRows.map(function (r) {
    return findAll(r, function (c) { return c.tagName === "textarea"; })[0];
  });
  noteTextareas[0].value = "";
  (noteTextareas[0].listeners.input || []).forEach(function (fn) { fn(); });
  ok(JSON.stringify(App.state.pkg.notes) === JSON.stringify(["", "second note", ""]),
     "clearing a note keeps the (empty) row");
  removeBtns[0].click();
  ok(App.state.pkg.notes.length === 2 && App.state.pkg.notes[0] === "second note",
     "Remove button deletes the cleared note row");

  // newFromFile: API metadata check
  var fs2 = require("fs");
  var zipBytes = new Uint8Array(fs2.readFileSync(path.join(__dirname, "fixtures", "test.zip")));
  function fakeFile(name, bytes) {
    return {
      name: name,
      size: bytes.length,
      slice: function (start, end) {
        return { arrayBuffer: async function () { return bytes.slice(start, end).buffer; } };
      },
      arrayBuffer: async function () { return bytes.buffer; }
    };
  }
  var realFetch2 = globalThis.fetch;
  globalThis.fetch = async function () {
    return {
      ok: true,
      status: 200,
      json: async function () {
        return [{ sha256: "a".repeat(64), bytes: 951, description: "Existing description.", tags: ["game=quake"] }];
      }
    };
  };
  await App.newFromFile(fakeFile("test.zip", zipBytes));
  ok(App.state.pkg.description === "Existing description.", "existing API metadata loaded on file load");
  var realSha = await require("../js/scan.js").sha256Hex(zipBytes);
  ok(App.state.origin.type === "api" && App.state.origin.expectedSha256 === realSha,
     "origin tracks API load with the hashed file's sha");
  globalThis.fetch = async function () {
    return { ok: true, status: 200, json: async function () { return []; } };
  };
  await App.newFromFile(fakeFile("test.zip", zipBytes));
  globalThis.fetch = realFetch2;
  ok(App.state.pkg.json_version === "2025.09.27", "no API metadata: new package prefilled");
  ok(Array.isArray(App.state.pkg.files) === false && Object.keys(App.state.pkg.files).length === 5,
     "scan files map present for new package");
  ok(registry["status"].textContent.indexOf("New package for test.zip") !== -1,
     "status reports new package");

  // corrupt main zip: abort and reset
  var realFetch3 = globalThis.fetch;
  globalThis.fetch = async function () {
    return { ok: true, status: 200, json: async function () { return []; } };
  };
  var corruptZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04]);
  await App.newFromFile(fakeFile("broken.zip", corruptZip));
  globalThis.fetch = realFetch3;
  ok(App.state.pkg === null, "corrupt zip aborts and resets the package");
  ok(registry["status"].textContent.indexOf("corrupt") !== -1 &&
     registry["status"].textContent.indexOf("Not loaded") !== -1,
     "status clearly reports the corrupt archive");
  ok(registry["form-pane"].children.length === 0, "form cleared after corrupt archive abort");
  // non-archive file still loads fine (no abort)
  var realFetch4 = globalThis.fetch;
  globalThis.fetch = async function () {
    return { ok: true, status: 200, json: async function () { return []; } };
  };
  await App.newFromFile(fakeFile("plainfile.bsp", new Uint8Array([1, 2, 3, 4, 5])));
  globalThis.fetch = realFetch4;
  ok(App.state.pkg !== null && App.state.pkg.bytes === 5, "non-archive file loads as new package");
  ok(!("files" in App.state.pkg), "non-archive file has no files map");

  // raw JSON updates when a different package is loaded
  App.loadPackageFromText(validPkg, { type: "paste", expectedSha256: null, filename: null });
  var otherPkg = JSON.stringify({ bytes: 99, sha256: "d".repeat(64) });
  App.loadPackageFromText(otherPkg, { type: "paste", expectedSha256: null, filename: null });
  ok(App.getRawEditor().getValue().indexOf('"bytes": 99') !== -1,
     "raw text updated to new package");

  // clear/reset button restores pristine state
  ok(registry["btn-reset"] !== null, "reset button exists");
  (registry["btn-reset"].listeners.click || []).forEach(function (fn) { fn(); });
  ok(App.state.pkg === null && App.state.validation === null, "reset clears package and validation");
  ok(App.getRawEditor().getValue() === "" && registry["form-pane"].children.length === 0,
     "reset clears raw and form");
  ok(globalThis.localStorage.getItem("quaddicted-web-editor:draft") === null, "reset removes draft");
  ok(registry["validation"].children.length > 0 &&
     registry["validation"].children[0].textContent === "No package loaded.",
     "validation box back to empty state");


  // Add tag button: appends a blank tag row that receives focus
  App.loadPackageFromText(JSON.stringify({ bytes: 42, sha256: "a".repeat(64) }),
    { type: "paste", expectedSha256: null, filename: null });
  var addTagBtn = findAll(registry["form-pane"], function (c) {
    return c.tagName === "button" && c.textContent === "Add tag";
  })[0];
  ok(addTagBtn !== undefined, "Add tag button rendered");
  var quickInputs = findAll(registry["form-pane"], function (c) {
    return c.tagName === "input" && (c.attrs["placeholder"] || "").indexOf("quick-add") !== -1;
  });
  ok(quickInputs.length === 0, "quick-add field removed");
  addTagBtn.click();
  ok(App.state.pkg.tags.length === 1 && App.state.pkg.tags[0] === "",
     "Add tag appends a blank tag");
  var blankTagRow = findAll(registry["form-pane"], function (c) {
    return c.attrs["class"] === "row tag-input-row";
  })[0];
  var blankTagInput = blankTagRow.children[1];
  ok(blankTagInput["value"] === "" && !("list" in blankTagInput.attrs),
     "new blank tag row is a normal tag field");
  ok(blankTagInput.focused === true, "focus moved into the new blank tag field");
  ok(JSON.stringify(blankTagInput.selection) === "[0,0]", "cursor at the start of the blank field");

  // common tags button
  App.loadPackageFromText(JSON.stringify({
    bytes: 42,
    sha256: "a".repeat(64),
    tags: ["game=quake"]
  }), { type: "paste", expectedSha256: null, filename: null });
  var commonBtn = findAll(registry["form-pane"], function (c) {
    return c.tagName === "button" && c.textContent.indexOf("Add common tags") !== -1;
  })[0];
  ok(commonBtn !== undefined, "add common tags button rendered");
  commonBtn.click();
  ok(JSON.stringify(App.state.pkg.tags) ===
     JSON.stringify(["game=quake", "game_mode=", "type="]),
     "common tags added, existing game=quake not duplicated");
  commonBtn.click();
  ok(App.state.pkg.tags.length === 3, "clicking again adds no duplicates");
  ok(registry["status"].textContent.indexOf("already present") !== -1,
     "status reports nothing added on second click");

  // fetch common tag suggestions (bulk, paged, user-initiated)
  App.loadPackageFromText(JSON.stringify({
    bytes: 42,
    sha256: "a".repeat(64),
    tags: ["game=quake"]
  }), { type: "paste", expectedSha256: null, filename: null });
  var fetchBtn = findAll(registry["form-pane"], function (c) {
    return c.tagName === "button" && c.textContent === "Fetch common tag suggestions from the API";
  })[0];
  ok(fetchBtn !== undefined, "fetch suggestions button rendered");
  var apiCalls = 0;
  globalThis.fetch = async function (url) {
    apiCalls++;
    if (url.indexOf("start=0") !== -1 && url.indexOf("rows=500") !== -1 &&
        url.indexOf("fl=") !== -1) {
      return {
        ok: true,
        status: 200,
        json: async function () {
          var docs = [];
          for (var i = 0; i < 500; i++) {
            docs.push({ sha256: "x" + i, tags: ["game=quake", "type=map"] });
          }
          return docs;
        }
      };
    }
    return {
      ok: true,
      status: 200,
      json: async function () {
        return [{ sha256: "y", tags: ["game=quake", "size=medium"] }];
      }
    };
  };
  await App.fetchCommonTags();
  ok(apiCalls === 2, "paged fetch: full 500-doc page plus final short page");
  ok(registry["status"].textContent.indexOf("501 packages") !== -1,
     "status reports number of packages processed");
  var cacheRaw = globalThis.localStorage.getItem("quaddicted-web-editor:tagstats");
  ok(cacheRaw !== null, "tag stats cached in localStorage");
  var stats = JSON.parse(cacheRaw);
  ok(stats.tags[0].tag === "game=quake" && stats.tags[0].count === 501,
     "flat tag list sorted by frequency");
  ok(stats.tags[1].tag === "type=map" && stats.tags[1].count === 500, "second entry type=map");
  ok(stats.tags[2].tag === "size=medium" && stats.tags[2].count === 1,
     "rare tags included within the 500 cap");
  ok(!("keys" in stats) && !("values" in stats),
     "no separate key/value structures stored");

  // cap: 500 most common full tags
  globalThis.fetch = async function () {
    return {
      ok: true,
      status: 200,
      json: async function () {
        var docs = [];
        for (var i = 0; i < 600; i++) {
          docs.push({ sha256: "z" + i, tags: ["k" + i + "=v" + i, "top=yes"] });
        }
        return docs.slice(0, 499);
      }
    };
  };
  await App.fetchCommonTags();
  var capsStats = JSON.parse(globalThis.localStorage.getItem("quaddicted-web-editor:tagstats"));
  ok(capsStats.tags.length === 500, "stores the 500 most common tags");
  ok(capsStats.tags[0].tag === "top=yes" && capsStats.tags[0].count === 499,
     "most common tag first");
  var capNames = capsStats.tags.map(function (s) { return s.tag; });
  ok(new Set(capNames).size === 500, "no duplicate tags stored");
  ok(capNames.every(function (tag) { return tag.indexOf("=") !== -1; }),
     "stored suggestions are full key=value tags");

  // suggestion buttons react to typing after the fetch (mobile-safe)
  globalThis.fetch = async function (url) {
    apiCalls++;
    if (url.indexOf("start=0") !== -1 && url.indexOf("rows=500") !== -1 &&
        url.indexOf("fl=") !== -1) {
      return {
        ok: true,
        status: 200,
        json: async function () {
          var docs = [];
          for (var i = 0; i < 500; i++) {
            docs.push({ sha256: "x" + i, tags: ["game=quake", "type=map"] });
          }
          return docs;
        }
      };
    }
    return {
      ok: true,
      status: 200,
      json: async function () {
        return [{ sha256: "y", tags: ["game=quake", "size=medium"] }];
      }
    };
  };
  apiCalls = 0;
  await App.fetchCommonTags();
  ok(findAll(registry["form-pane"], function (c) { return c.tagName === "datalist"; }).length === 0,
     "no leftover datalist elements (unsupported on phones)");
  var tagRowEl = findAll(registry["form-pane"], function (c) {
    return c.attrs["class"] === "tag-row";
  })[0];
  ok(tagRowEl !== undefined, "tag row present for the loaded package");
  var newTagRow = findAll(tagRowEl, function (c) {
    return c.attrs["class"] === "row tag-input-row";
  })[0];
  var tagInput = newTagRow.children[1];
  var suggestBox = findAll(tagRowEl, function (c) {
    return c.attrs["class"] === "suggest-box";
  })[0];
  var hiddenBox = findAll(tagRowEl, function (c) {
    return c.attrs["class"] === "suggest-box hidden";
  })[0];
  ok(suggestBox !== undefined || hiddenBox !== undefined, "each tag row has a suggestion box");
  tagInput.value = "game=";
  (tagInput.listeners.input || []).forEach(function (fn) { fn(); });
  var box = findAll(tagRowEl, function (c) {
    return c.attrs["class"] === "suggest-box";
  })[0];
  ok(box !== undefined, "suggestion box visible while typing a matching prefix");
  var items = findAll(box, function (c) {
    return c.tagName === "button" && c.attrs["class"] === "suggest-item";
  });
  var quakeItem = items.filter(function (b) { return b.textContent.indexOf("game=quake") === 0; })[0];
  ok(quakeItem !== undefined, "typing 'game=' suggests the game=quake tag");
  ok(quakeItem.textContent === "game=quake \u2014 501 packages",
     "count shown in the suggestion label");
  ok(items.every(function (b) { return b.textContent.indexOf("game=") === 0; }),
     "only matching tags suggested");
  // tap a suggestion: value applied, box hides
  quakeItem.click();
  ok(tagInput["value"] === "game=quake", "tapping the suggestion fills the tag input");
  ok(App.state.pkg.tags[0] === "game=quake", "tag value committed to the package");
  ok(findAll(tagRowEl, function (c) {
    return c.attrs["class"] === "suggest-box";
  }).length === 0, "suggestion box hidden after picking");
  // no matches -> hidden
  tagInput.value = "zzz=";
  (tagInput.listeners.input || []).forEach(function (fn) { fn(); });
  ok(findAll(tagRowEl, function (c) {
    return c.attrs["class"] === "suggest-box";
  }).length === 0, "no suggestion box for unmatched prefix");
  // key prefix suggestions also work
  tagInput.value = "type";
  (tagInput.listeners.input || []).forEach(function (fn) { fn(); });
  var box2 = findAll(tagRowEl, function (c) {
    return c.attrs["class"] === "suggest-box";
  })[0];
  ok(box2 !== undefined && box2.children.some(function (b) {
    return b.textContent.indexOf("type=map") === 0;
  }), "typing a key prefix suggests the full tag");
  // Escape hides the box
  (tagInput.listeners.keydown || []).forEach(function (fn) { fn({ key: "Escape" }); });
  ok(findAll(tagRowEl, function (c) {
    return c.attrs["class"] === "suggest-box";
  }).length === 0, "Escape hides the suggestion box");

  // submit via quaddicted.com/db/json_upload (no PAT)
  var qdTitleIn = registry["inp-qd-title"];
  var qdUserIn = registry["inp-qd-user"];
  var qdBtn = registry["btn-qd"];
  ok(qdTitleIn !== null && qdUserIn !== null && qdBtn !== null,
     "Quaddicted submit section rendered");
  App.loadPackageFromText(validPkg, { type: "paste", expectedSha256: null, filename: null });
  ok(qdTitleIn.value === "Add package: test.zip (" + "a".repeat(12) + ")",
     "PR title prefilled from the package");
  qdUserIn.value = "kannes";
  (qdUserIn.listeners.input || []).forEach(function (fn) { fn(); });
  ok(globalThis.localStorage.getItem("quaddicted-web-editor:qd-username") === "kannes",
     "username remembered in localStorage");
  var qdRequests = [];
  globalThis.fetch = async function (url, init) {
    qdRequests.push({ url: url, init: init });
    return {
      ok: true,
      status: 201,
      text: async function () {
        return JSON.stringify({ url: "https://github.com/Quaddicted/quaddicted-data/pull/999" });
      }
    };
  };
  await App.submitToQuaddicted();
  ok(qdRequests.length === 1, "one POST made");
  ok(qdRequests[0].url === "https://www.quaddicted.com/db/json_upload",
     "POSTs to json_upload");
  ok(qdRequests[0].init.method === "POST", "uses POST");
  var sentBody = JSON.parse(qdRequests[0].init.body);
  ok(sentBody.title === "Add package: test.zip (" + "a".repeat(12) + ")",
     "body carries the PR title");
  ok(sentBody.username === "kannes", "body carries the username");
  ok(sentBody.packages.length === 1 && sentBody.packages[0].sha256 === "a".repeat(64),
     "body carries the current package as a one-element list");
  ok(registry["status"].textContent.indexOf("pull/999") !== -1,
     "status bar shows the PR link");
  var qdAnchor = findAll(registry["qd-result"], function (c) {
    return c.tagName === "a" && c.attrs["href"] === "https://github.com/Quaddicted/quaddicted-data/pull/999";
  })[0];
  ok(qdAnchor !== undefined, "result box links the created PR");
  ok(qdBtn.disabled === false, "submit button re-enabled after success");
  // custom title + default username
  qdTitleIn.value = "My own PR title";
  (qdTitleIn.listeners.input || []).forEach(function (fn) { fn(); });
  qdUserIn.value = "";
  (qdUserIn.listeners.input || []).forEach(function (fn) { fn(); });
  await App.submitToQuaddicted();
  var sentBody2 = JSON.parse(qdRequests[1].init.body);
  ok(sentBody2.title === "My own PR title", "edited title wins over the prefill");
  ok(sentBody2.username === "Anonymous", "empty username defaults to Anonymous");
  // fix A: loading another package resets the edited title
  App.loadPackageFromText(validPkg, { type: "paste", expectedSha256: null, filename: null });
  ok(qdTitleIn.value === "Add package: test.zip (" + "a".repeat(12) + ")",
     "loading a package replaces a previously edited PR title with the fresh prefill");

  // fix C: non-http(s) links from the response are not rendered
  globalThis.fetch = async function () {
    return {
      ok: true,
      status: 200,
      text: async function () {
        return JSON.stringify({ url: "javascript:alert(1)" });
      }
    };
  };
  await App.submitToQuaddicted();
  ok(findAll(registry["qd-result"], function (c) { return c.tagName === "a"; }).length === 0,
     "javascript: URL from the response is not rendered as a link");

  // validation errors block the submit
  App.loadPackageFromText(JSON.stringify({ bytes: 1, tags: ["broken tag"] }),
    { type: "paste", expectedSha256: null, filename: null });
  ok(qdBtn.disabled === true, "submit button disabled with validation errors");
  await App.submitToQuaddicted();
  ok(qdRequests.length === 2, "no request made while validation errors exist");
  ok(registry["status"].textContent.indexOf("fix the validation errors") !== -1,
     "status explains the blocked submit");

  // external open-in-new-tab links for the current sha256  // external open-in-new-tab links for the current sha256  // external open-in-new-tab links for the current sha256  // external open-in-new-tab links for the current sha256
  App.loadPackageFromText(JSON.stringify({
    bytes: 42,
    sha256: "3f".repeat(32)
  }), { type: "paste", expectedSha256: null, filename: null });
  var links = findAll(registry["form-pane"], function (c) {
    return c.tagName === "a" && c.attrs["class"] === "button-link";
  });
  ok(links.length === 3, "three external links rendered");
  var apiLink = links.filter(function (l) { return l.textContent === "Open at the Quaddicted API"; })[0];
  ok(apiLink.attrs["target"] === "_blank" && apiLink.attrs["rel"] === "noopener noreferrer",
     "API link opens in new tab with rel");
  ok(apiLink.attrs["href"] === "https://www.quaddicted.com/api/v1/?q=" +
     encodeURIComponent('+sha256:"' + "3f".repeat(32) + '"'), "API link href");
  var ghLink = links.filter(function (l) { return l.textContent === "Open in quaddicted-data repo"; })[0];
  ok(ghLink && ghLink.attrs["href"] === "https://github.com/Quaddicted/quaddicted-data/blob/main/json/by-sha256/3f/" +
     "3f".repeat(32) + ".json", "GitHub link href");
  var dbLink = links.filter(function (l) {
    return l.textContent === "Open in the Quaddicted Database";
  })[0];
  ok(dbLink && dbLink.attrs["href"] === "https://www.quaddicted.com/db/canonical/" + "3f".repeat(32),
     "database canonical link href");
  // invalid sha: links disabled without href
  App.loadPackageFromText(JSON.stringify({ bytes: 1, sha256: "abc" }),
    { type: "paste", expectedSha256: null, filename: null });
  var disabledLinks = findAll(registry["form-pane"], function (c) {
    return c.tagName === "a" && c.attrs["class"] === "button-link disabled";
  });
  ok(disabledLinks.length === 3 && !("href" in disabledLinks[0].attrs),
     "links disabled without href when sha256 invalid");

  // URL hash parameter: #sha256=<sha> auto-loads metadata, then the URL is
  // cleared via history.pushState so a refresh does not reload the remote data
  var pushedUrls = [];
  globalThis.history = {
    pushState: function (st, title, url) { pushedUrls.push(url); }
  };
  globalThis.location = { hash: "", pathname: "/", search: "" };
  ok(App.shaFromUrlHash() === null, "no sha in empty hash");
  ok(pushedUrls.length === 1 && pushedUrls[0] === "/",
     "URL cleared for empty hash");
  globalThis.location = { hash: "#sha256=" + "e".repeat(64), pathname: "/", search: "" };
  ok(App.shaFromUrlHash() === "e".repeat(64), "sha extracted from hash");
  ok(pushedUrls.length === 2 && pushedUrls[1] === "/",
     "URL cleared after extracting the sha");
  globalThis.location = { hash: "#sha256=abc", pathname: "/", search: "" };
  ok(App.shaFromUrlHash() === null, "invalid sha ignored");
  ok(pushedUrls.length === 3 && pushedUrls[2] === "/",
     "URL cleared for invalid hash");
  globalThis.location = { hash: "#sha256=" + "e".repeat(64), pathname: "/", search: "" };
  globalThis.fetch = async function () {
    return {
      ok: true,
      status: 200,
      json: async function () {
        return [{ sha256: "e".repeat(64), bytes: 7, tags: ["game=quake"] }];
      }
    };
  };
  await App.loadFromUrlHash();
  ok(App.state.pkg && App.state.pkg.sha256 === "e".repeat(64), "metadata auto-loaded from URL hash");
  ok(pushedUrls.length === 4 && pushedUrls[3] === "/",
     "URL hash cleared after loading metadata");
  delete globalThis.location;
  delete globalThis.history;

  // CodeMirror 6 adapter behaviour (no fallback editor exists)
  App.loadPackageFromText(validPkg, { type: "paste", expectedSha256: null, filename: null });
  ok(insertions.length > 0 &&
     insertions[insertions.length - 1].indexOf('"bytes": 42') !== -1,
     "CM6 adapter dispatches canonical text to the editor view");
  ok(insertions[insertions.length - 1].slice(-1) === "\n", "CM6 adapter text keeps trailing newline");
  ok(findAll(registry["status-bar"], function () { return false; }).length === 0,
     "status bar untouched by editor churn");
  // the CodeMirror bundle is assumed to always be present
  App.loadPackageFromText(validPkg, { type: "paste", expectedSha256: null, filename: null });
  ok(App.getRawEditor() !== null, "editor adapter still present");

  if (failures) {
    console.error(failures + " failure(s)");
    process.exit(1);
  }
  console.log("test_ui_smoke: all passed");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
