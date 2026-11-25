(function () {
  "use strict";

  const root = typeof self !== "undefined" ? self : globalThis;
  const isNode = typeof module !== "undefined" && module.exports;
  const Sha256 = isNode ? require("./sha256.js") : root.Sha256;
  const Serialize = isNode ? require("./serialize.js") : root.Serialize;
  const TagData = isNode ? require("./tagdata.js") : root.TagData;
  const Validate = isNode ? require("./validate.js") : root.Validate;
  const Scan = isNode ? require("./scan.js") : root.Scan;
  const Github = isNode ? require("./github.js") : root.Github;

  const DRAFT_KEY = "quaddicted-editor-draft";
  const PAT_KEY = "quaddicted-editor-pat";
  const JSON_VERSION = "2025.09.27";
  const QUADDICTED_API = "https://www.quaddicted.com";

  const memoryStore = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  })();
  const store = typeof localStorage !== "undefined" ? localStorage : memoryStore;

  const state = {
    pkg: null,
    origin: null,
    originText: "",
    isNew: false,
    scanErrors: {},
    validation: { errors: [], warnings: [] },
    parseError: null,
    modified: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "text") el.textContent = v;
        else if (k === "class") el.className = v;
        else if (k === "value") el.value = v;
        else if (k === "hidden") el.hidden = !!v;
        else if (k === "disabled") el.disabled = !!v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids) {
      if (kid === null || kid === undefined) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function setStatus(msg) {
    $("status").textContent = msg;
  }

  function prLog(msg) {
    const el = $("pr-log");
    el.hidden = false;
    el.textContent += msg + "\n";
  }

  function scheduleDraftSave() {
    clearTimeout(scheduleDraftSave.timer);
    scheduleDraftSave.timer = setTimeout(saveDraft, 800);
  }

  function saveDraft() {
    if (!state.pkg) return;
    try {
      store.setItem(DRAFT_KEY, JSON.stringify({ pkg: state.pkg, origin: state.origin, savedAt: Date.now() }));
    } catch (e) {}
  }

  function loadPackage(pkg, expectedSha, isNew) {
    state.pkg = pkg;
    state.origin = expectedSha || null;
    state.isNew = !!isNew;
    state.scanErrors = {};
    state.parseError = null;
    state.originText = Serialize.serializeCanonical(pkg, { sortTags: true });
    $("raw").value = state.originText;
    renderForm();
    updateAll();
    saveDraft();
  }

  async function newFromFile(file) {
    if (!file) return;
    setStatus("Hashing " + file.name + "...");
    const sha = await Sha256.hashBlob(file, (done, total) => {
      setStatus("Hashing " + file.name + "... " + Math.floor((done / total) * 100) + "%");
    });
    setStatus("Scanning archive...");
    const scan = await Scan.scanArchive(file);
    const pkg = {
      bytes: file.size,
      json_version: JSON_VERSION,
      sha256: sha,
      tags: ["filename=" + file.name],
      urls: ["https://www.quaddicted.com/files/by-sha256/" + sha.slice(0, 2) + "/" + sha + "/" + file.name],
    };
    if (scan.kind && Object.keys(scan.files).length > 0) pkg.files = scan.files;
    state.scanErrors = scan.errors || {};
    if (scan.kind) {
      const nErr = Object.keys(state.scanErrors).length;
      setStatus("Scanned " + scan.kind + ": " + Object.keys(scan.files).length + " entries" + (nErr ? ", " + nErr + " error(s)" : ""));
    } else {
      setStatus("Not a ZIP/PAK archive; created package without files tree.");
    }
    loadPackage(pkg, sha, true);
    reloadFromApi();
  }

  async function openBySha256(input) {
    const m = /[a-f0-9]{64}/.exec(String(input || "").toLowerCase());
    if (!m) {
      setStatus("No 64-character hex sha256 found in the input.");
      return;
    }
    const sha = m[0];
    setStatus("Fetching " + sha + "...");
    try {
      const res = await fetch(
        "https://raw.githubusercontent.com/Quaddicted/quaddicted-data/main/" + Github.repoPathFor(sha)
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      const pkg = JSON.parse(text);
      loadPackage(pkg, sha, false);
      setStatus("Loaded package " + sha.slice(0, 12) + ".");
      reloadFromApi();
    } catch (e) {
      setStatus("Failed to load package: " + ((e && e.message) || e));
    }
  }

  async function openJsonFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      const m = /^([a-f0-9]{64})\.json$/i.exec(file.name);
      loadPackage(pkg, m ? m[1].toLowerCase() : null, false);
      setStatus("Loaded " + file.name + ".");
      if (Validate.isValidSha256(pkg.sha256)) reloadFromApi();
    } catch (e) {
      setStatus("Could not load " + file.name + ": " + ((e && e.message) || e));
    }
  }

  function loadPasted(text) {
    try {
      const pkg = JSON.parse(text);
      loadPackage(pkg, null, false);
      $("paste-panel").hidden = true;
      setStatus("Pasted JSON loaded.");
    } catch (e) {
      setStatus("Invalid JSON: " + ((e && e.message) || e));
    }
  }

  function filenameTagValue() {
    if (state.pkg && Array.isArray(state.pkg.tags)) {
      for (const t of state.pkg.tags) {
        if (TagData.mainKeyOf(t) === "filename") return t.slice(t.indexOf("=") + 1);
      }
    }
    return null;
  }

  function collapsible(summaryText, ...kids) {
    return h("details", { class: "collapsible", open: true }, h("summary", { text: summaryText }), ...kids);
  }

  function prunePackage(pkg) {
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return;
    const inst = pkg.install;
    if (inst && typeof inst === "object" && !Array.isArray(inst)) {
      if (
        inst.extractmapping &&
        typeof inst.extractmapping === "object" &&
        !Array.isArray(inst.extractmapping) &&
        Object.keys(inst.extractmapping).length === 0
      ) {
        delete inst.extractmapping;
      }
      if (typeof inst.extract === "string" && inst.extract === "") delete inst.extract;
      if (Object.keys(inst).length === 0) delete pkg.install;
    }
  }

  function ensureArray(pkg, key) {
    if (!Array.isArray(pkg[key])) pkg[key] = [];
    return pkg[key];
  }

  function hasTag(pkg, tag) {
    return Array.isArray(pkg.tags) && pkg.tags.includes(tag);
  }

  function addTagIfValid(pkg, tag) {
    const p = Validate.parseTag(tag);
    if (!p.ok) return false;
    if (hasTag(pkg, tag)) return false;
    ensureArray(pkg, "tags").push(tag);
    return true;
  }

  function applyPackageDoc(pkg, src) {
    let n = 0;
    if (!src || typeof src !== "object" || Array.isArray(src)) return 0;
    if (typeof src.description === "string" && src.description && pkg.description === undefined) {
      pkg.description = src.description;
      n++;
    }
    if (Array.isArray(src.notes) && pkg.notes === undefined) {
      pkg.notes = src.notes.slice();
      n++;
    }
    if (Array.isArray(src.tags)) {
      for (const t of src.tags) if (typeof t === "string" && addTagIfValid(pkg, t)) n++;
    }
    if (Array.isArray(src.urls)) {
      for (const u of src.urls) {
        if (typeof u !== "string" || !u || !Validate.isValidUrl(u)) continue;
        const arr = ensureArray(pkg, "urls");
        if (!arr.includes(u)) {
          arr.push(u);
          n++;
        }
      }
    }
    if (
      src.install &&
      typeof src.install === "object" &&
      !Array.isArray(src.install) &&
      Object.keys(src.install).length > 0 &&
      pkg.install === undefined
    ) {
      pkg.install = src.install;
      n++;
    }
    if (typeof src.bytes === "number" && !("bytes" in pkg)) {
      pkg.bytes = src.bytes;
      n++;
    }
    return n;
  }

  function extractApiDoc(j, sha) {
    if (Array.isArray(j)) {
      return j.find((d) => d && d.sha256 === sha) || j[0] || null;
    }
    if (j && typeof j === "object" && j.response && Array.isArray(j.response.docs)) {
      const docs = j.response.docs;
      return docs.find((d) => d && d.sha256 === sha) || docs[0] || null;
    }
    if (j && typeof j === "object" && !Array.isArray(j)) return j;
    return null;
  }

  async function fetchQuaddictedMetadata(sha) {
    const q = encodeURIComponent("+sha256:" + sha);
    const r = await fetch(
      QUADDICTED_API + "/api/v1/?q=" + q + "&fl=sha256,tags,urls,notes,bytes,description,install&rows=5",
      { headers: { Accept: "application/json" } }
    );
    if (!r.ok) throw new Error("HTTP " + r.status);
    return extractApiDoc(await r.json(), sha);
  }

  async function reloadFromApi() {
    if (!state.pkg || !Validate.isValidSha256(state.pkg.sha256)) {
      setStatus("No valid sha256 to query.");
      return;
    }
    const sha = state.pkg.sha256;
    $("btn-reload-api").disabled = true;
    setStatus("Querying quaddicted API for " + sha.slice(0, 12) + "...");
    try {
      const doc = await fetchQuaddictedMetadata(sha);
      const n = applyPackageDoc(state.pkg, doc);
      renderForm();
      updateAll();
      setStatus(n > 0 ? "Filled " + n + " field(s) from quaddicted API." : "No additional metadata found for " + sha.slice(0, 12) + ".");
    } catch (e) {
      setStatus("quaddicted API query failed: " + ((e && e.message) || e));
    } finally {
      updateAll();
    }
  }

  function field(labelText, inputEl) {
    return h("label", { class: "field" }, h("span", { text: labelText }), inputEl);
  }

  function renderPackageSection() {
    const pkg = state.pkg;
    const bytes = h("input", {
      type: "text",
      value: "bytes" in pkg ? String(pkg.bytes) : "",
      spellcheck: "false",
      oninput: (e) => {
        const v = e.target.value;
        if (v === "") delete pkg.bytes;
        else if (/^-?\d+$/.test(v)) pkg.bytes = parseInt(v, 10);
        else pkg.bytes = v;
        updateAll();
      },
    });
    const sha = h("input", {
      type: "text",
      value: typeof pkg.sha256 === "string" ? pkg.sha256 : "",
      spellcheck: "false",
      oninput: (e) => {
        pkg.sha256 = e.target.value;
        updateAll();
      },
    });
    const description = h("textarea", {
      rows: "3",
      oninput: (e) => {
        if (e.target.value === "") delete pkg.description;
        else pkg.description = e.target.value;
        updateAll();
      },
    });
    description.value = typeof pkg.description === "string" ? pkg.description : "";
    const jsonVersion = h("input", {
      type: "text",
      value: typeof pkg.json_version === "string" ? pkg.json_version : "",
      spellcheck: "false",
      oninput: (e) => {
        if (e.target.value === "") delete pkg.json_version;
        else pkg.json_version = e.target.value;
        updateAll();
      },
    });
    return h(
      "section",
      {},
      h("h2", { text: "Package" }),
      field("bytes", bytes),
      field("sha256", sha),
      field("description", description),
      field("json_version (never auto-changed when editing; prefilled for new packages)", jsonVersion)
    );
  }

  function renderTagsSection() {
    const pkg = state.pkg;
    const tags = Array.isArray(pkg.tags) ? pkg.tags : [];
    const ensureTags = () => {
      if (!Array.isArray(pkg.tags)) pkg.tags = [];
      return pkg.tags;
    };
    const sec = h("section", {}, h("h2", { text: "Tags" }));
    const dl = h(
      "datalist",
      { id: "known-tag-keys" },
      ...TagData.KNOWN_TAGS.map((t) => h("option", { value: t.key }))
    );
    const rows = [];
    tags.forEach((tag, i) => {
      const hint = h("span", { class: "tag-hint" });
      const refreshHint = () => {
        const p = Validate.parseTag(tag);
        hint.textContent = p.ok ? "ok" : p.error;
      };
      refreshHint();
      const input = h("input", {
        type: "text",
        value: tag,
        list: "known-tag-keys",
        spellcheck: "false",
        oninput: (e) => {
          tags[i] = e.target.value;
          const p = Validate.parseTag(tags[i]);
          hint.textContent = p.ok ? "ok" : p.error;
          updateAll();
        },
      });
      const del = h("button", {
        type: "button",
        text: "✕",
        title: "Remove tag",
        onclick: () => {
          ensureTags().splice(i, 1);
          renderForm();
          updateAll();
        },
      });
      rows.push(h("div", { class: "tag-row" }, input, del, hint));
    });
    sec.append(collapsible("tag rows (" + tags.length + ")", ...rows));
    const quickKey = h("input", { type: "text", list: "known-tag-keys", placeholder: "key", spellcheck: "false" });
    const addBtn = h("button", {
      type: "button",
      text: "Quick-add key=",
      onclick: () => {
        const k = quickKey.value.trim();
        if (!k) return;
        const arr = ensureTags();
        if (!arr.some((t) => t === k + "=")) arr.push(k + "=");
        renderForm();
        updateAll();
      },
    });
    const addEmpty = h("button", {
      type: "button",
      text: "Add empty tag",
      onclick: () => {
        ensureTags().push("a=b");
        renderForm();
        updateAll();
      },
    });
    sec.append(dl, h("div", { class: "tag-row" }, quickKey, addBtn, addEmpty));
    return sec;
  }

  function renderUrlsSection() {
    const pkg = state.pkg;
    const urls = Array.isArray(pkg.urls) ? pkg.urls : [];
    const ensureUrls = () => {
      if (!Array.isArray(pkg.urls)) pkg.urls = [];
      return pkg.urls;
    };
    const sec = h("section", {}, h("h2", { text: "URLs" }));
    const rows = [];
    urls.forEach((u, i) => {
      const input = h("input", {
        type: "text",
        value: u,
        spellcheck: "false",
        oninput: (e) => {
          urls[i] = e.target.value;
          updateAll();
        },
      });
      const del = h("button", {
        type: "button",
        text: "✕",
        onclick: () => {
          ensureUrls().splice(i, 1);
          renderForm();
          updateAll();
        },
      });
      rows.push(h("div", { class: "url-row" }, input, del));
    });
    sec.append(collapsible("url rows (" + urls.length + ")", ...rows));
    const addUrl = h("button", {
      type: "button",
      text: "Add URL",
      onclick: () => {
        ensureUrls().push("https://");
        renderForm();
        updateAll();
      },
    });
    const addBySha = h("button", {
      type: "button",
      text: "Add by-sha256 URL",
      onclick: () => {
        if (!Validate.isValidSha256(pkg.sha256)) {
          setStatus("sha256 is not valid yet.");
          return;
        }
        const fname = filenameTagValue();
        ensureUrls().push(
          "https://www.quaddicted.com/files/by-sha256/" +
            pkg.sha256.slice(0, 2) +
            "/" +
            pkg.sha256 +
            (fname ? "/" + fname : "")
        );
        renderForm();
        updateAll();
      },
    });
    const addFilebase = h("button", {
      type: "button",
      text: "Add filebase URL",
      onclick: () => {
        const fname = filenameTagValue();
        if (!fname) {
          setStatus("Add a filename= tag first.");
          return;
        }
        ensureUrls().push("https://www.quaddicted.com/filebase/" + fname);
        renderForm();
        updateAll();
      },
    });
    sec.append(h("div", { class: "tag-row" }, addUrl, addBySha, addFilebase));
    return sec;
  }

  function entryField(label, entry, key, isBytes) {
    const input = h("input", {
      type: "text",
      value: key in entry ? String(entry[key]) : "",
      spellcheck: "false",
      oninput: (e) => {
        const v = e.target.value;
        if (v === "") delete entry[key];
        else if (isBytes && /^-?\d+$/.test(v)) entry[key] = parseInt(v, 10);
        else entry[key] = v;
        updateAll();
      },
    });
    return h("label", {}, label + " ", input);
  }

  function renderFilesTree(files, container, pathPrefix) {
    const keys = Object.keys(files).sort(Serialize.compareCodePoints);
    for (const key of keys) {
      const entry = files[key];
      const display = pathPrefix ? key : key;
      const node = h("div", { class: "files-entry" });
      if (key.endsWith("/")) {
        const del = h("button", {
          type: "button",
          text: "✕",
          onclick: () => {
            delete files[key];
            renderForm();
            updateAll();
          },
        });
        node.append(h("div", { class: "entry-head" }, h("strong", { text: display }), h("span", { class: "tag-hint", text: "dir" }), del));
      } else {
        const del = h("button", {
          type: "button",
          text: "✕",
          onclick: () => {
            delete files[key];
            renderForm();
            updateAll();
          },
        });
        node.append(
          h("div", { class: "entry-head" }, h("strong", { text: display }), del),
          h(
            "div",
            { class: "entry-fields" },
            entryField("bytes", entry, "bytes", true),
            entryField("sha256", entry, "sha256", false),
            entryField("timestamp", entry, "timestamp", false)
          )
        );
        if (entry.files && typeof entry.files === "object") {
          const nested = collapsible("nested archive " + key + " (" + Object.keys(entry.files).length + " entries)");
          const inner = h("div", { class: "files-node" });
          renderFilesTree(entry.files, inner, key + "/");
          nested.append(inner);
          node.append(nested);
        }
      }
      container.append(node);
    }
  }

  function renderFilesSection() {
    const pkg = state.pkg;
    const sec = h("section", {}, h("h2", { text: "Files" }));
    const files = pkg.files && typeof pkg.files === "object" && !Array.isArray(pkg.files) ? pkg.files : null;
    const ensureFiles = () => {
      if (!pkg.files || typeof pkg.files !== "object" || Array.isArray(pkg.files)) pkg.files = {};
      return pkg.files;
    };
    const tree = h("div", { class: "files-tree" });
    if (files) renderFilesTree(files, tree, "");
    sec.append(collapsible("files tree (" + (files ? Object.keys(files).length : 0) + " top-level entries)", tree));
    const pathInput = h("input", { type: "text", placeholder: "path inside archive, e.g. maps/e1m1.bsp", spellcheck: "false" });
    const addFile = h("button", {
      type: "button",
      text: "Add file",
      onclick: () => {
        const p = pathInput.value.trim();
        if (!p) return;
        ensureFiles()[p] = { bytes: 0, sha256: "" };
        renderForm();
        updateAll();
      },
    });
    const addDir = h("button", {
      type: "button",
      text: "Add dir",
      onclick: () => {
        let p = pathInput.value.trim();
        if (!p) return;
        if (!p.endsWith("/")) p += "/";
        ensureFiles()[p] = { bytes: 0, sha256: Scan.EMPTY_SHA256 };
        renderForm();
        updateAll();
      },
    });
    const scanInput = h("input", { type: "file", hidden: true });
    const scanBtn = h("button", {
      type: "button",
      text: "Scan uploaded archive into files",
      onclick: () => scanInput.click(),
    });
    scanInput.addEventListener("change", async () => {
      const f = scanInput.files && scanInput.files[0];
      if (!f) return;
      setStatus("Scanning " + f.name + "...");
      const scan = await Scan.scanArchive(f);
      if (!scan.kind) {
        setStatus(f.name + " is not a ZIP/PAK archive.");
        return;
      }
      pkg.files = scan.files;
      state.scanErrors = scan.errors || {};
      renderForm();
      updateAll();
      const nErr = Object.keys(state.scanErrors).length;
      setStatus("Scanned " + scan.kind + ": " + Object.keys(scan.files).length + " entries" + (nErr ? ", " + nErr + " error(s)" : ""));
    });
    sec.append(h("div", { class: "tag-row" }, pathInput, addFile, addDir, scanBtn, scanInput));
    return sec;
  }

  function renderInstallSection() {
    const pkg = state.pkg;
    const sec = h("section", {}, h("h2", { text: "Install" }));
    const install = pkg.install && typeof pkg.install === "object" && !Array.isArray(pkg.install) ? pkg.install : null;
    if (!install || Object.keys(install).length === 0) {
      sec.append(
        h("p", { class: "tag-hint", text: "No install rules. Empty install sections are omitted from the JSON." }),
        h("div", { class: "tag-row" },
          h("button", {
            type: "button",
            text: "Add extractmapping rule",
            onclick: () => {
              pkg.install = { extractmapping: { "/": "/" } };
              renderForm();
              updateAll();
            },
          }),
          h("button", {
            type: "button",
            text: "Add legacy extract",
            onclick: () => {
              pkg.install = { extract: "{base}/" };
              renderForm();
              updateAll();
            },
          }))
      );
      return sec;
    }
    if (install.extractmapping && typeof install.extractmapping === "object" && !Array.isArray(install.extractmapping)) {
      const em = install.extractmapping;
      const rows = Object.keys(em).map((from) => {
        const fromInput = h("input", {
          type: "text",
          value: from,
          spellcheck: "false",
          oninput: (e) => {
            const v = e.target.value;
            if (v !== from && v !== "") {
              const val = em[from];
              delete em[from];
              em[v] = val;
            }
            updateAll();
          },
        });
        const toInput = h("input", {
          type: "text",
          value: typeof em[from] === "string" ? em[from] : "",
          spellcheck: "false",
          oninput: (e) => {
            em[from] = e.target.value;
            updateAll();
          },
        });
        const del = h("button", {
          type: "button",
          text: "✕",
          onclick: () => {
            delete em[from];
            renderForm();
            updateAll();
          },
        });
        return h("div", { class: "map-row" }, h("span", { text: "from" }), fromInput, h("span", { text: "to" }), toInput, del);
      });
      sec.append(collapsible("extractmapping (" + rows.length + " rules)", ...rows));
    }
    const addMap = h("button", {
      type: "button",
      text: "Add extractmapping entry",
      onclick: () => {
        if (!pkg.install || typeof pkg.install !== "object" || Array.isArray(pkg.install)) pkg.install = {};
        if (!pkg.install.extractmapping || typeof pkg.install.extractmapping !== "object" || Array.isArray(pkg.install.extractmapping)) {
          pkg.install.extractmapping = {};
        }
        pkg.install.extractmapping["/"] = "/";
        renderForm();
        updateAll();
      },
    });
    const extractInput = h("input", {
      type: "text",
      value: typeof install.extract === "string" ? install.extract : "",
      placeholder: "legacy install.extract, e.g. {base}/maps/",
      spellcheck: "false",
      oninput: (e) => {
        if (e.target.value === "") delete install.extract;
        else install.extract = e.target.value;
        updateAll();
      },
    });
    sec.append(h("div", { class: "tag-row" }, addMap), field("legacy extract (empty = omitted)", extractInput));
    return sec;
  }

  function renderNotesSection() {
    const pkg = state.pkg;
    const sec = h("section", {}, h("h2", { text: "Notes" }));
    const ta = h("textarea", {
      rows: "3",
      oninput: (e) => {
        const lines = e.target.value.split("\n");
        if (lines.every((l) => l === "")) delete pkg.notes;
        else pkg.notes = lines;
        updateAll();
      },
    });
    ta.value = Array.isArray(pkg.notes) ? pkg.notes.join("\n") : "";
    sec.append(collapsible("notes (" + (Array.isArray(pkg.notes) ? pkg.notes.length : 0) + " lines)", field("notes (one per line)", ta)));
    return sec;
  }

  function renderForm() {
    const pane = $("form-pane");
    pane.textContent = "";
    if (!state.pkg) {
      pane.append(
        h("section", {},
          h("p", {
            class: "tag-hint",
            text: "No package loaded. Create a new package from a ZIP/PAK file, open one by sha256, open a JSON file, or paste JSON — use the toolbar above.",
          }))
      );
      return;
    }
    pane.append(
      renderPackageSection(),
      renderTagsSection(),
      renderUrlsSection(),
      renderFilesSection(),
      renderInstallSection(),
      renderNotesSection()
    );
  }

  function renderValidation() {
    const el = $("validation");
    el.textContent = "";
    const v = state.validation;
    const scanKeys = Object.keys(state.scanErrors || {});
    if (!state.pkg) {
      el.append(h("p", { class: "tag-hint", text: "No package loaded." }));
      return;
    }
    if (state.parseError) {
      el.append(h("p", { class: "err", text: "Raw JSON parse error: " + state.parseError }));
    }
    for (const e of v.errors) {
      el.append(h("div", { class: "err", text: "ERROR " + e.path + ": " + e.message }));
    }
    for (const w of v.warnings) {
      el.append(h("div", { class: "warn", text: "warning " + w.path + ": " + w.message }));
    }
    for (const k of scanKeys) {
      el.append(h("div", { class: "warn", text: "warning scan " + k + ": " + state.scanErrors[k] }));
    }
    if (v.errors.length === 0 && !state.parseError) {
      el.append(h("p", { class: "pass", text: "No errors — the package passes validation." }));
    }
  }

  function canExport() {
    return (
      !!state.pkg &&
      !state.parseError &&
      state.validation.errors.length === 0 &&
      Validate.isValidSha256(state.pkg.sha256)
    );
  }

  function hasToken() {
    return !!($("inp-pat").value || store.getItem(PAT_KEY));
  }

  function updateAll(opts) {
    const o = opts || {};
    if (state.pkg) {
      prunePackage(state.pkg);
      state.validation = Validate.validatePackage(state.pkg, { expectedSha256: state.origin });
    } else {
      state.validation = { errors: [], warnings: [] };
    }
    renderValidation();
    const raw = $("raw");
    const text = state.pkg ? Serialize.serializeCanonical(state.pkg, { sortTags: true }) : "";
    if (document.activeElement !== raw) raw.value = text;
    state.modified = !!state.pkg && text !== state.originText;
    $("modified-badge").hidden = !state.modified;
    const ok = canExport();
    $("btn-download").disabled = !ok;
    $("btn-copy").disabled = !ok;
    $("btn-pr").disabled = !ok || !hasToken();
    $("btn-reload-api").disabled = !(state.pkg && Validate.isValidSha256(state.pkg.sha256));
    scheduleDraftSave();
    if (o.rerenderForm) renderForm();
  }

  function downloadJson() {
    if (!state.pkg || !canExport()) return;
    const text = Serialize.serializeCanonical(state.pkg, { sortTags: true });
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: state.pkg.sha256 + ".json" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Downloaded " + state.pkg.sha256 + ".json");
  }

  async function copyJson() {
    if (!state.pkg || !canExport()) return;
    const text = Serialize.serializeCanonical(state.pkg, { sortTags: true });
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied JSON to clipboard.");
    } catch (e) {
      const raw = $("raw");
      raw.value = text;
      raw.focus();
      raw.select();
      document.execCommand("copy");
      setStatus("Copied JSON to clipboard (fallback).");
    }
  }

  async function runPr() {
    const token = $("inp-pat").value || store.getItem(PAT_KEY) || "";
    if (!token) {
      setStatus("Enter or save a personal access token first.");
      return;
    }
    if (!state.pkg || !canExport()) return;
    const sha = state.pkg.sha256;
    const contentText = Serialize.serializeCanonical(state.pkg, { sortTags: true });
    $("btn-pr").disabled = true;
    $("pr-log").hidden = false;
    $("pr-log").textContent = "";
    prLog("Starting pull request flow for " + sha + "...");
    try {
      const res = await Github.createPullRequest({
        token,
        sha256: sha,
        contentText,
        pkg: state.pkg,
        validation: state.validation,
        isNew: state.isNew,
        log: prLog,
      });
      prLog("Done.");
      if (res.prUrl && /^https:\/\/github\.com\//.test(res.prUrl)) {
        $("pr-log").append(
          document.createTextNode("Pull request: "),
          h("a", { href: res.prUrl, text: res.prUrl, target: "_blank", rel: "noopener noreferrer" })
        );
      }
      setStatus("Pull request ready: " + res.prUrl);
    } catch (e) {
      prLog("Error: " + ((e && e.message) || e));
      setStatus("Pull request failed: " + ((e && e.message) || e));
    } finally {
      updateAll();
    }
  }

  let rawTimer = null;

  function init() {
    $("btn-new").addEventListener("click", () => $("file-new").click());
    $("file-new").addEventListener("change", () => {
      const f = $("file-new").files && $("file-new").files[0];
      if (f) newFromFile(f);
      $("file-new").value = "";
    });
    $("btn-open-sha").addEventListener("click", () => openBySha256($("inp-sha").value));
    $("btn-reload-api").addEventListener("click", reloadFromApi);
    $("inp-sha").addEventListener("keydown", (e) => {
      if (e.key === "Enter") openBySha256($("inp-sha").value);
    });
    $("btn-open-json").addEventListener("click", () => $("file-json").click());
    $("file-json").addEventListener("change", () => {
      const f = $("file-json").files && $("file-json").files[0];
      if (f) openJsonFile(f);
      $("file-json").value = "";
    });
    $("btn-paste").addEventListener("click", () => {
      $("paste-panel").hidden = !$("paste-panel").hidden;
    });
    $("btn-paste-load").addEventListener("click", () => loadPasted($("paste-text").value));
    $("btn-discard-draft").addEventListener("click", () => {
      store.removeItem(DRAFT_KEY);
      $("draft-banner").hidden = true;
      state.pkg = null;
      state.origin = null;
      state.originText = "";
      state.isNew = false;
      state.scanErrors = {};
      state.parseError = null;
      $("raw").value = "";
      $("inp-sha").value = "";
      renderForm();
      updateAll();
      setStatus("Draft discarded.");
    });
    $("raw").addEventListener("input", () => {
      clearTimeout(rawTimer);
      rawTimer = setTimeout(() => {
        const text = $("raw").value;
        try {
          const pkg = JSON.parse(text);
          state.parseError = null;
          state.pkg = pkg;
          renderForm();
          updateAll();
          setStatus("Raw JSON parsed.");
        } catch (e) {
          state.parseError = String((e && e.message) || e);
          renderValidation();
          setStatus("Raw JSON is not valid JSON.");
        }
      }, 400);
    });
    $("btn-download").addEventListener("click", downloadJson);
    $("btn-copy").addEventListener("click", copyJson);
    $("btn-save-pat").addEventListener("click", () => {
      const v = $("inp-pat").value;
      if (!v) {
        setStatus("Enter a token first.");
        return;
      }
      store.setItem(PAT_KEY, v);
      setStatus("Token saved to localStorage.");
      updateAll();
    });
    $("btn-forget-pat").addEventListener("click", () => {
      store.removeItem(PAT_KEY);
      $("inp-pat").value = "";
      setStatus("Token forgotten.");
      updateAll();
    });
    $("inp-pat").addEventListener("input", updateAll);
    $("btn-pr").addEventListener("click", runPr);

    let draft = null;
    try {
      draft = JSON.parse(store.getItem(DRAFT_KEY) || "null");
    } catch (e) {
      draft = null;
    }
    if (draft && draft.pkg) {
      $("draft-banner").hidden = false;
      loadPackage(draft.pkg, draft.origin || null, false);
      setStatus("Restored draft from localStorage.");
    } else {
      renderForm();
      updateAll();
    }
    if (store.getItem(PAT_KEY)) {
      $("inp-pat").placeholder = "token saved in localStorage";
    }
  }

  if (typeof document !== "undefined" && document.getElementById) init();
})();
