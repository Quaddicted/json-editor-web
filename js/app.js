/*!
 * quaddicted-data web editor - UI application.
 * Plain IIFE, no build step required. All DOM data is rendered via
 * textContent/setAttribute only; no innerHTML is used anywhere.
 */
(function (root) {
  "use strict";

    var Serialize = root.Serialize;
  var Tagdata = root.Tagdata;
  var Validate = root.Validate;
  var Scan = root.Scan;
  var Github = root.Github;

  var DRAFT_KEY = "quaddicted-web-editor:draft";
  var PAT_KEY = "quaddicted-web-editor:pat";
  var API_BASE = "https://www.quaddicted.com/api/v1/";
  var API_FIELDS = "sha256,tags,urls,notes,bytes,description,install,files,json_version";

  var state = {
    pkg: null,
    origin: null,
    originText: "",
    scanErrors: {},
    validation: null,
    rawParseError: null,
    collapsedDirs: null
  };

  var rawTimer = null;
  var draftTimer = null;
  var updateTimer = null;
  var previewTimer = null;
  var pendingFocusTagIndex = null;
  var QD_ENDPOINT = "https://www.quaddicted.com/db/json_upload";
  var QD_USER_KEY = "quaddicted-web-editor:qd-username";
  var qdTitleDirty = false;
  var TAGS_CACHE_KEY = "quaddicted-web-editor:tagstats";
  var tagStats = null;

  function loadTagStatsCache() {
    try {
      var raw = root.localStorage.getItem(TAGS_CACHE_KEY);
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.fetchedAt === "number" &&
          Array.isArray(parsed.tags)) {
        return parsed;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  async function fetchCommonTags() {
    setStatus("Fetching common tags from the Quaddicted API...");
    var pairCounts = {};
    var start = 0;
    var rows = 500;
    var total = 0;
    for (var page = 0; page < 40; page++) {
      var url = API_BASE + "?q=" + encodeURIComponent("*") +
        "&fl=" + encodeURIComponent("sha256,tags") +
        "&rows=" + rows + "&start=" + start +
        "&sort=" + encodeURIComponent("sha256 ASC");
      var res = await fetch(url);
      if (!res.ok) {
        throw new Error("API returned HTTP " + res.status);
      }
      var docs = await res.json();
      if (!Array.isArray(docs) || docs.length === 0) {
        break;
      }
      for (var i = 0; i < docs.length; i++) {
        var pkgTags = docs[i].tags;
        if (!Array.isArray(pkgTags)) {
          continue;
        }
        var seenInPkg = {};
        for (var t = 0; t < pkgTags.length; t++) {
          var tag = String(pkgTags[t]);
          var eq = tag.indexOf("=");
          if (eq < 1) {
            continue;
          }
          if (!seenInPkg[tag]) {
            seenInPkg[tag] = true;
            pairCounts[tag] = (pairCounts[tag] || 0) + 1;
          }
        }
      }
      total += docs.length;
      start += docs.length;
      setStatus("Fetching common tags from the Quaddicted API... " + total + " packages");
      if (docs.length < rows) {
        break;
      }
    }
    var flatTags = [];
    Object.keys(pairCounts).forEach(function (pair) {
      flatTags.push({ tag: pair, count: pairCounts[pair] });
    });
    flatTags.sort(function (a, b) {
      return b.count - a.count || (a.tag < b.tag ? -1 : 1);
    });
    flatTags = flatTags.slice(0, 500);
    tagStats = { fetchedAt: Date.now(), tags: flatTags };
    try {
      root.localStorage.setItem(TAGS_CACHE_KEY, JSON.stringify(tagStats));
    } catch (e) {
      /* ignore */
    }
    renderForm();
    updateAll();
    setStatus("Tag suggestions loaded from " + total + " packages (" +
      flatTags.length + " common tags). Continue typing a tag to see them.");
  }

  function focusAtEnd(input) {
    try {
      if (typeof input.focus === "function") {
        input.focus();
      }
      if (typeof input.setSelectionRange === "function") {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    } catch (e) {
      /* focus not available */
    }
  }

  function scheduleUpdateAll() {
    if (updateTimer) {
      clearTimeout(updateTimer);
    }
    updateTimer = setTimeout(function () {
      updateTimer = null;
      updateAll();
    }, 250);
  }
  var reloadMetaBtn = null;
  var rawEditor = null;
  var syncingFromRaw = false;

  function setupRawEditor() {
    // the vendored CodeMirror 6 bundle is always available
    var host = $("raw-cm");
    var CM = root.QeCM;
    var suppress = false;
    var view = new CM.EditorView({
      doc: "",
      parent: host,
      extensions: [
        CM.basicSetup,
        CM.json(),
        CM.EditorView.lineWrapping,
        CM.EditorView.updateListener.of(function (update) {
          if (update.docChanged && !suppress) {
            onRawInput();
          }
        })
      ]
    });
    rawEditor = {
      getValue: function () { return view.state.doc.toString(); },
      setValue: function (v) {
        suppress = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: String(v) }
        });
        suppress = false;
      },
      focus: function () { view.focus(); }
    };
  }

  function collapsedDirs() {
    if (!state.collapsedDirs) {
      state.collapsedDirs = new Set();
    }
    return state.collapsedDirs;
  }

  var STYLE_NONCE = "editorstyle2417";

  // CodeMirror 6 injects its stylesheet as an at-runtime <style> element;
  // the CSP meta allows exactly that via this nonce, which we stamp onto
  // every <style> created after this point (instead of 'unsafe-inline').
  (function installStyleNonce() {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return;
    }
    if (document.__styleNonceInstalled) {
      return;
    }
    document.__styleNonceInstalled = true;
    var orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      var el = orig(tag);
      if (String(tag).toLowerCase() === "style") {
        el.setAttribute("nonce", STYLE_NONCE);
      }
      return el;
    };
  })();

  function $(id) {
    return document.getElementById(id);
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = attrs[key];
        if (value === undefined || value === null) {
          continue;
        }
        if (key === "text") {
          el.textContent = value;
        } else if (key === "class") {
          el.setAttribute("class", value);
        } else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") {
          el[key] = value;
        } else if (key.indexOf("on") === 0) {
          el.addEventListener(key.slice(2), value);
        } else {
          el.setAttribute(key, value);
        }
      }
    }
    for (var k = 0; k < kids.length; k++) {
      var kid = kids[k];
      if (kid === null || kid === undefined) {
        continue;
      }
      if (typeof kid === "string") {
        el.appendChild(document.createTextNode(kid));
      } else {
        el.appendChild(kid);
      }
    }
    return el;
  }

  function setStatus(message) {
    var el = $("status");
    if (el) {
      el.textContent = message || "";
    }
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  // ---------------------------------------------------------------- draft

  function saveDraft() {
    if (!state.pkg) {
      return;
    }
    try {
      root.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        pkg: state.pkg,
        origin: state.origin,
        originText: state.originText
      }));
      var banner = $("draft-banner");
      if (banner) {
        banner.setAttribute("data-visible", "true");
      }
    } catch (e) {
      /* storage unavailable */
    }
  }

  function scheduleDraftSave() {
    if (draftTimer) {
      clearTimeout(draftTimer);
    }
    draftTimer = setTimeout(saveDraft, 800);
  }

  function loadDraft() {
    try {
      var raw = root.localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        return false;
      }
      var draft = JSON.parse(raw);
      if (!draft || !draft.pkg || !Validate.isValidSha256(draft.pkg.sha256)) {
        return false;
      }
      state.pkg = draft.pkg;
      state.origin = draft.origin || { type: "paste", expectedSha256: null, filename: null };
      state.originText = draft.originText || "";
      return true;
    } catch (e) {
      return false;
    }
  }

  function resetAll() {
    state.pkg = null;
    state.origin = null;
    state.originText = "";
    state.validation = null;
    state.scanErrors = {};
    state.rawParseError = null;
    state.collapsedDirs = new Set();
    try {
      root.localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* ignore */
    }
    updateRaw();
    var pane = $("form-pane");
    if (pane) {
      clear(pane);
    }
    var prLog = $("pr-log");
    if (prLog) {
      prLog.textContent = "";
    }
    var prLink = $("pr-link");
    if (prLink) {
      clear(prLink);
    }
    var banner = $("draft-banner");
    if (banner) {
      banner.setAttribute("data-visible", "false");
    }
    renderValidation();
    updateButtons();
    setStatus("Cleared. Load or create a package to begin (saved PAT is kept).");
  }

  function discardDraft() {
    try {
      root.localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* ignore */
    }
    var banner = $("draft-banner");
    if (banner) {
      banner.setAttribute("data-visible", "false");
    }
    setStatus("Draft discarded.");
  }

  // ------------------------------------------------------------- canonical

  function canonicalText() {
    return state.pkg ? Serialize.serializeCanonical(state.pkg) : "";
  }

  function updateRaw() {
    if (!rawEditor) {
      return;
    }
    var text = canonicalText();
    if (!syncingFromRaw && rawEditor.getValue() !== text) {
      rawEditor.setValue(text);
    }
  }

  // ------------------------------------------------------------ validation

  function validate() {
    if (!state.pkg) {
      state.validation = null;
      return;
    }
    var expected = state.origin && state.origin.expectedSha256 ? state.origin.expectedSha256 : null;
    state.validation = Validate.validatePackage(state.pkg, { expectedSha256: expected });
  }

  function renderValidation() {
    var box = $("validation");
    if (!box) {
      return;
    }
    clear(box);
    if (state.rawParseError) {
      box.appendChild(h("div", { class: "val-errors", text: "JSON parse error: " + state.rawParseError }));
      return;
    }
    if (!state.validation) {
      box.appendChild(h("div", { class: "val-empty", text: "No package loaded." }));
      return;
    }
    var v = state.validation;
    if (v.errors.length === 0) {
      box.appendChild(h("div", {
        class: "val-ok",
        text: "Valid package (0 errors, " + v.warnings.length + " warning" +
          (v.warnings.length === 1 ? "" : "s") + ")."
      }));
    } else {
      var errBox = h("div", { class: "val-errors" });
      errBox.appendChild(h("div", { text: v.errors.length + " error(s):" }));
      for (var i = 0; i < v.errors.length; i++) {
        errBox.appendChild(h("div", {
          class: "val-error",
          text: (v.errors[i].path ? v.errors[i].path + ": " : "") + v.errors[i].message
        }));
      }
      box.appendChild(errBox);
    }
    if (v.warnings.length) {
      var warnBox = h("div", { class: "val-warnings" });
      warnBox.appendChild(h("div", { text: v.warnings.length + " warning(s):" }));
      for (var w = 0; w < v.warnings.length; w++) {
        warnBox.appendChild(h("div", {
          class: "val-warning",
          text: (v.warnings[w].path ? v.warnings[w].path + ": " : "") + v.warnings[w].message
        }));
      }
      box.appendChild(warnBox);
    }
    if (state.scanErrors && Object.keys(state.scanErrors).length) {
      var scanBox = h("div", { class: "val-warnings" });
      scanBox.appendChild(h("div", { text: "Archive scan errors:" }));
      var paths = Object.keys(state.scanErrors);
      for (var s = 0; s < paths.length; s++) {
        scanBox.appendChild(h("div", {
          class: "val-warning",
          text: (paths[s] ? paths[s] + ": " : "") + state.scanErrors[paths[s]]
        }));
      }
      box.appendChild(scanBox);
    }
  }

  function qdTitleValue(pkg) {
    var tags = (pkg && Array.isArray(pkg.tags)) ? pkg.tags : [];
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].indexOf("title=") === 0) {
        return tags[i].slice(6);
      }
    }
    for (var j = 0; j < tags.length; j++) {
      if (tags[j].indexOf("filename=") === 0) {
        return tags[j].slice(9);
      }
    }
    return "package";
  }

  function qdAutoTitle() {
    var p = state.pkg;
    if (!p || !Validate.isValidSha256(p.sha256)) {
      return "";
    }
    return "Add package: " + qdTitleValue(p) + " (" + p.sha256.slice(0, 12) + ")";
  }

  function setQdResult(link, message) {
    var box = $("qd-result");
    if (!box) {
      return;
    }
    clear(box);
    var row = h("div", { class: "hint" });
    row.appendChild(document.createTextNode(message + " "));
    if (link) {
      row.appendChild(h("a", {
        href: link,
        target: "_blank",
        rel: "noopener noreferrer",
        text: link
      }));
    }
    box.appendChild(row);
  }

  async function submitToQuaddicted() {
    if (!state.pkg || !state.validation || state.validation.errors.length !== 0) {
      setStatus("Quaddicted submission: fix the validation errors first.");
      return;
    }
    var titleIn = $("inp-qd-title");
    var userIn = $("inp-qd-user");
    var btn = $("btn-qd");
    var title = ((titleIn && titleIn.value) || "").trim() || qdAutoTitle();
    var username = ((userIn && userIn.value) || "").trim() || "Anonymous";
    if (btn) {
      btn.disabled = true;
    }
    setStatus("Submitting package to Quaddicted (json_upload)...");
    try {
      var body = JSON.stringify({
        title: title,
        username: username,
        packages: [state.pkg]
      });
      var res = await fetch(QD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body
      });
      var text = await res.text();
      var data = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = null;
      }
      if (!res.ok) {
        throw new Error("HTTP " + res.status + " " + String(text).slice(0, 200));
      }
      var link = null;
      if (data && typeof data === "object") {
        link = data.url || data.pr_url || data.pr || data.html_url ||
          data.pull_request_url || data.link || null;
      }
      if (!link) {
        var m = /https?:\/\/[^\s"'<>]+/.exec(String(text));
        if (m) {
          link = m[0];
        }
      }
      if (link && !/^https?:\//.test(link)) {
        link = null;
      }
      setQdResult(link, "Submitted!");
      setStatus(link ? "Submitted via Quaddicted: " + link
        : "Submitted to Quaddicted.");
    } catch (e) {
      setQdResult(null, "Submission failed: " + e.message);
      setStatus("Quaddicted submission failed: " + e.message);
    } finally {
      updateButtons();
    }
  }

  function updateButtons() {
    var ok = !!(state.pkg && state.validation && state.validation.errors.length === 0 &&
      Validate.isValidSha256(state.pkg.sha256));
    var ids = ["btn-pr", "btn-qd"];
    var qdTitle = $("inp-qd-title");
    if (qdTitle && !qdTitleDirty) {
      qdTitle.value = qdAutoTitle();
    }
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) {
        el.disabled = !ok;
      }
    }
    var badge = $("modified-badge");
    if (badge) {
      var modified = !!(state.pkg && canonicalText() !== state.originText);
      badge.setAttribute("data-visible", modified ? "true" : "false");
    }
    if (reloadMetaBtn) {
      reloadMetaBtn.disabled = !(state.pkg && Validate.isValidSha256(state.pkg.sha256));
    }
  }

  function updateAll() {
    validate();
    renderValidation();
    updateRaw();
    updateButtons();
    scheduleDraftSave();
  }

  // ------------------------------------------------------------ raw editor

  function onRawInput() {
    if (rawTimer) {
      clearTimeout(rawTimer);
    }
    rawTimer = setTimeout(function () {
      if (!rawEditor) {
        return;
      }
      var text = rawEditor.getValue();
      if (!text.trim()) {
        state.rawParseError = null;
        state.pkg = null;
        state.validation = null;
        syncingFromRaw = true;
        updateAll();
        syncingFromRaw = false;
        return;
      }
      try {
        var parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          state.rawParseError = "Top-level value must be a JSON object.";
        } else {
          state.rawParseError = null;
          state.pkg = parsed;
          renderForm();
        }
      } catch (e) {
        state.rawParseError = e.message;
      }
      syncingFromRaw = true;
      updateAll();
      syncingFromRaw = false;
    }, 400);
  }

  // ------------------------------------------------------------- API fetch

  async function fetchMetadata(sha256) {
    var url = API_BASE + "?q=" + encodeURIComponent('+sha256:"' + sha256 + '"') +
      "&fl=" + encodeURIComponent(API_FIELDS) + "&rows=2";
    var res = await fetch(url);
    if (!res.ok) {
      throw new Error("Quaddicted API returned HTTP " + res.status + ".");
    }
    var docs = await res.json();
    if (!Array.isArray(docs) || docs.length === 0) {
      return null;
    }
    return pkgFromApiDoc(docs[0]);
  }

  function pkgFromApiDoc(doc) {
    var keys = ["bytes", "sha256", "description", "files", "install", "json_version", "notes", "tags", "urls"];
    var pkg = {};
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (doc[key] !== undefined && doc[key] !== null) {
        pkg[key] = doc[key];
      }
    }
    return pkg;
  }

  function shaFromUrlHash() {
    try {
      var hash = root.location && root.location.hash ? root.location.hash : "";
      var m = /(?:^#|&)sha256=([a-f0-9]{64})/i.exec(hash);

      // clear URL, so that the user does not lose data if they edit and refresh/bookmark
      if (root.history && typeof root.history.pushState === "function") {
        root.history.pushState("", document.title, root.location.pathname + root.location.search);
      }

      return m ? m[1].toLowerCase() : null;
    } catch (e) {
      return null;
    }
  }

  async function loadFromUrlHash() {
    var sha = shaFromUrlHash();
    if (sha) {
      await openBySha256(sha);
      return true;
    }
    return false;
  }

  function sizeWithUnits(bytes) {
    var n = typeof bytes === "number" ? bytes : parseInt(bytes, 10);
    if (!isFinite(n) || isNaN(n) || n < 1024) {
      return "";
    }
    var units = [["GB", 1024 * 1024 * 1024], ["MB", 1024 * 1024], ["KB", 1024]];
    for (var i = 0; i < units.length; i++) {
      if (n >= units[i][1]) {
        return " (" + (Math.round(n / units[i][1] * 10) / 10) + " " + units[i][0] + ")";
      }
    }
    return "";
  }

  function pkgBytesText(bytes) {
    if (bytes === undefined || bytes === null) {
      return "\u2014";
    }
    return String(bytes) + sizeWithUnits(bytes);
  }

  function askSha256(message) {
    var v = null;
    try {
      if (typeof root.prompt === "function") {
        v = root.prompt(message, "");
      }
    } catch (e) {
      return undefined;
    }
    if (v === null) {
      return undefined;
    }
    var m = /[a-f0-9]{64}/i.exec(String(v).trim());
    return m ? m[0].toLowerCase() : null;
  }

  async function openBySha256(sha256) {
    setStatus("Fetching metadata for " + sha256.slice(0, 12) + "...");
    try {
      var doc = await fetchMetadata(sha256);
    } catch (e) {
      setStatus("Could not fetch metadata: " + e.message);
      return;
    }
    if (!doc) {
      setStatus("No metadata found in the Quaddicted API for this sha256.");
      return;
    }
    state.pkg = doc;
    state.origin = { type: "api", expectedSha256: sha256, filename: null };
    state.originText = canonicalText();
    state.rawParseError = null;
    state.scanErrors = {};
    renderForm();
    updateAll();
    setStatus("Loaded metadata for " + sha256.slice(0, 12) + " from the Quaddicted API.");
  }

  async function reloadMetadata() {
    if (!state.pkg || !Validate.isValidSha256(state.pkg.sha256)) {
      return;
    }
    var sha = state.pkg.sha256;
    setStatus("Reloading metadata for " + sha.slice(0, 12) + "...");
    try {
      var doc = await fetchMetadata(sha);
    } catch (e) {
      setStatus("Could not reload metadata: " + e.message);
      return;
    }
    if (!doc) {
      setStatus("No metadata found in the Quaddicted API for this sha256.");
      return;
    }
    var fresh = doc;
    var metaKeys = ["description", "files", "install", "json_version", "notes", "tags", "urls"];
    for (var i = 0; i < metaKeys.length; i++) {
      if (fresh[metaKeys[i]] !== undefined) {
        state.pkg[metaKeys[i]] = fresh[metaKeys[i]];
      } else {
        delete state.pkg[metaKeys[i]];
      }
    }
    state.pkg.sha256 = sha;
    state.rawParseError = null;
    renderForm();
    updateAll();
    setStatus("Reloaded metadata for " + sha.slice(0, 12) + ".");
  }

  // ----------------------------------------------------------------- flows

  async function hashBlob(blob, onProgress) {
    var chunkSize = 4 * 1024 * 1024;
    var chunks = [];
    var offset = 0;
    while (offset < blob.size) {
      var slice = blob.slice(offset, Math.min(offset + chunkSize, blob.size));
      chunks.push(new Uint8Array(await slice.arrayBuffer()));
      offset += chunkSize;
      if (onProgress) {
        onProgress(Math.min(offset / blob.size, 1));
      }
    }
    var total = new Uint8Array(blob.size);
    var pos = 0;
    for (var i = 0; i < chunks.length; i++) {
      total.set(chunks[i], pos);
      pos += chunks[i].length;
    }
    return await Scan.sha256Hex(total);
  }

  async function newFromFile(file) {
    setStatus("Hashing " + file.name + "...");
    var sha256;
    try {
      sha256 = await hashBlob(file, function (frac) {
        setStatus("Hashing " + file.name + "... " + Math.round(frac * 100) + "%");
      });
    } catch (e) {
      setStatus("Could not read file: " + e.message);
      return;
    }
    setStatus("Scanning archive...");
    var bytes = new Uint8Array(await file.arrayBuffer());
    var scan = await Scan.scanArchive(bytes);

    // A file with archive magic that does not scan is corrupt: abort and reset.
    var looksLikeZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
      (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
    var looksLikePak = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x41 &&
      bytes[2] === 0x43 && bytes[3] === 0x4b;
    if ((looksLikeZip || looksLikePak) && scan.kind === null) {
      var reason = scan.errors && scan.errors[""] ? scan.errors[""] : "unknown error";
      resetAll();
      setStatus("Not loaded: " + file.name + " looks like a " +
        (looksLikeZip ? "zip" : "pak") + " archive but is corrupt (" + reason + "). " +
        "The editor was reset; nothing from this file was kept.");
      return;
    }

    // Always check the API for existing metadata for this sha256.
    setStatus("Checking the Quaddicted API for existing metadata...");
    var existing = null;
    var apiProblem = null;
    try {
      existing = await fetchMetadata(sha256);
    } catch (e) {
      apiProblem = e.message;
    }

    if (existing) {
        state.pkg = existing;
      state.origin = { type: "api", expectedSha256: sha256, filename: file.name };
      state.scanErrors = {};
      state.originText = canonicalText();
      state.rawParseError = null;
      renderForm();
      updateAll();
      setStatus("Found existing metadata for this file in the Quaddicted API and loaded it.");
      return;
    }

    state.scanErrors = scan.errors || {};
    var pkg = Scan.buildNewPackage({
      bytes: file.size,
      sha256: sha256,
      filename: file.name,
      files: scan.files
    });
    if (!scan.files) {
      delete pkg.files;
    }
    state.pkg = pkg;
    state.origin = { type: "new", expectedSha256: sha256, filename: file.name };
    state.originText = canonicalText();
    state.rawParseError = null;
    renderForm();
    updateAll();
    var kindMsg = scan.kind ? scan.kind : "not an archive (no files map added)";
    var msg = "New package for " + file.name + " (" + kindMsg + ").";
    if (apiProblem) {
      msg += " (Could not check the API for existing metadata: " + apiProblem + ")";
    }
    setStatus(msg);
  }

  async function openJsonFile(file) {
    var text = await file.text();
    loadPackageFromText(text, {
      type: "json",
      expectedSha256: /^[a-f0-9]{64}\.json$/.test(file.name) ? file.name.slice(0, 64) : null,
      filename: file.name
    });
    setStatus("Loaded " + file.name + ".");
  }

  function loadPackageFromText(text, origin) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setStatus("Invalid JSON: " + e.message);
      return false;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setStatus("Top-level JSON value must be an object.");
      return false;
    }
    state.pkg = parsed;
    qdTitleDirty = false;
    state.origin = origin || { type: "paste", expectedSha256: null, filename: null };
    state.originText = canonicalText();
    state.rawParseError = null;
    state.scanErrors = {};
    renderForm();
    updateAll();
    return true;
  }

  // ----------------------------------------------------------- form render

  function numberInput(value, onchange) {
    var input = h("input", { type: "number", value: value === undefined || value === null ? "" : String(value) });
    input.addEventListener("input", function () {
      var n = parseInt(input.value, 10);
      onchange(isNaN(n) ? null : n);
    });
    return input;
  }

  function textInput(value, onchange) {
    var input = h("input", { type: "text", value: value === undefined || value === null ? "" : String(value) });
    input.addEventListener("input", function () {
      onchange(input.value);
    });
    return input;
  }

  function textArea(value, onchange) {
    var ta = h("textarea", { rows: "3" });
    ta.value = value === undefined || value === null ? "" : String(value);
    ta.addEventListener("input", function () {
      onchange(ta.value);
    });
    return ta;
  }

  function markdownInline(text) {
    var span = h("span", {});
    var re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        span.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      var tok = m[0];
      if (tok.slice(0, 2) === "**") {
        span.appendChild(h("strong", { text: tok.slice(2, -2) }));
      } else if (tok[0] === "*") {
        span.appendChild(h("em", { text: tok.slice(1, -1) }));
      } else if (tok[0] === "`") {
        span.appendChild(h("code", { text: tok.slice(1, -1) }));
      } else {
        var linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
        span.appendChild(h("a", { href: linkMatch[2], rel: "noopener noreferrer", text: linkMatch[1] }));
      }
      last = re.lastIndex;
    }
    if (last < text.length) {
      span.appendChild(document.createTextNode(text.slice(last)));
    }
    return span;
  }

  function renderMarkdown(container, text) {
    clear(container);
    var lines = String(text || "").split(/\r?\n/);
    var list = null;
    var any = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) {
        list = null;
        continue;
      }
      any = true;
      if (/^\s*[-*]\s+/.test(line)) {
        if (!list) {
          list = h("ul", {});
          container.appendChild(list);
        }
        list.appendChild(h("li", {}, markdownInline(line.replace(/^\s*[-*]\s+/, ""))));
        continue;
      }
      list = null;
      container.appendChild(h("p", {}, markdownInline(line)));
    }
    if (!any) {
      container.appendChild(h("div", { class: "hint", text: "(no description)" }));
    }
  }

  function openLink(label, url, enabled) {
    var attrs = { class: "button-link", text: label };
    if (enabled) {
      attrs.href = url;
      attrs.target = "_blank";
      attrs.rel = "noopener noreferrer";
    } else {
      attrs["class"] = "button-link disabled";
      attrs.title = "Enter a valid sha256 first";
    }
    return h("a", attrs);
  }

  function section(title) {
    var sec = h("section", { class: "form-section" });
    sec.appendChild(h("h2", { text: title }));
    return sec;
  }

  function setPkg(key, value) {
    if (value === null || value === undefined || value === "") {
      delete state.pkg[key];
    } else {
      state.pkg[key] = value;
    }
    scheduleUpdateAll();
  }

  function renderForm() {
    var pane = $("form-pane");
    if (!pane || !state.pkg) {
      return;
    }
    clear(pane);
    var pkg = state.pkg;

    // Package ------------------------------------------------------------
    var secPkg = section("Package");
    var bytesRow = h("div", { class: "row" });
    bytesRow.appendChild(h("label", { text: "bytes" }));
    bytesRow.appendChild(h("code", {
      class: "readonly-value",
      text: pkgBytesText(pkg.bytes)
    }));
    secPkg.appendChild(bytesRow);
    var shaRow = h("div", { class: "row" });
    shaRow.appendChild(h("label", { text: "sha256" }));
    shaRow.appendChild(h("code", {
      class: "readonly-value",
      text: pkg.sha256 || "\u2014"
    }));
    reloadMetaBtn = h("button", {
      type: "button",
      id: "btn-reload-meta",
      text: "Reload metadata from API",
      onclick: reloadMetadata
    });
    shaRow.appendChild(reloadMetaBtn);
    secPkg.appendChild(shaRow);
    var shaOk = Validate.isValidSha256(pkg.sha256);
    var sha = shaOk ? pkg.sha256 : "";
    var linksRow = h("div", { class: "row open-links-row" });
    linksRow.appendChild(openLink(
      "Open at the Quaddicted API",
      "https://www.quaddicted.com/api/v1/?q=" +
        encodeURIComponent('+sha256:"' + sha + '"'),
      shaOk
    ));
    linksRow.appendChild(openLink(
      "Open in quaddicted-data repo",
      "https://github.com/Quaddicted/quaddicted-data/blob/main/json/by-sha256/" +
        sha.slice(0, 2) + "/" + sha + ".json",
      shaOk
    ));
    linksRow.appendChild(openLink(
      "Open in the Quaddicted Database",
      "https://www.quaddicted.com/db/canonical/" + sha,
      shaOk
    ));
    secPkg.appendChild(linksRow);
    var descRow = h("div", { class: "row" });
    descRow.appendChild(h("label", { text: "description" }));
    var descPreview = h("div", { class: "md-preview" });
    descRow.appendChild(textArea(pkg.description, function (v) {
      setPkg("description", v || null);
      if (previewTimer) {
        clearTimeout(previewTimer);
      }
      previewTimer = setTimeout(function () {
        previewTimer = null;
        renderMarkdown(descPreview, v);
      }, 200);
    }));
    secPkg.appendChild(descRow);
    secPkg.appendChild(h("div", { class: "hint", text: "Markdown preview:" }));
    secPkg.appendChild(descPreview);
    renderMarkdown(descPreview, pkg.description);
    pane.appendChild(secPkg);

    // Tags ---------------------------------------------------------------
    var secTags = section("Tags");
    var tags = Array.isArray(pkg.tags) ? pkg.tags.slice() : [];
    var tagsList = h("div", { class: "tag-list" });
    for (var t = 0; t < tags.length; t++) {
      tagsList.appendChild(tagRow(tags[t], t));
    }
    secTags.appendChild(tagsList);
    var addRow = h("div", { class: "row" });
    addRow.appendChild(h("button", {
      type: "button",
      text: "Add tag",
      onclick: function () {
        if (!Array.isArray(state.pkg.tags)) {
          state.pkg.tags = [];
        }
        state.pkg.tags.push("");
        pendingFocusTagIndex = state.pkg.tags.length - 1;
        renderForm();
        updateAll();
      }
    }));
    secTags.appendChild(addRow);
    var commonRow = h("div", { class: "row" });
    commonRow.appendChild(h("button", {
      type: "button",
      text: "Add common tags (game=quake, game_mode=, type=)",
      onclick: function () {
        if (!Array.isArray(state.pkg.tags)) {
          state.pkg.tags = [];
        }
        var common = ["game=quake", "game_mode=", "type="];
        var added = 0;
        for (var i = 0; i < common.length; i++) {
          if (state.pkg.tags.indexOf(common[i]) === -1) {
            state.pkg.tags.push(common[i]);
            added++;
          }
        }
        renderForm();
        updateAll();
        setStatus(added > 0
          ? "Added " + added + " common tag(s); fill in the empty values."
          : "All common tags are already present.");
      }
    }));
    secTags.appendChild(commonRow);
    var fetchRow = h("div", { class: "row" });
    fetchRow.appendChild(h("button", {
      type: "button",
      text: "Fetch common tag suggestions from the API",
      title: "Downloads the tags of all packages once and caches counts for autocompletion",
      onclick: function () {
        fetchCommonTags().catch(function (e) {
          setStatus("Could not fetch tag suggestions: " + e.message);
        });
      }
    }));
    secTags.appendChild(fetchRow);
    var copyRow = h("div", { class: "row" });
    copyRow.appendChild(h("button", {
      type: "button",
      text: "Copy tags from sha256",
      onclick: function () {
        var sha = askSha256("Enter the sha256 of the package to copy the tags from:");
        if (sha === undefined) {
          return;
        }
        if (sha === null) {
          setStatus("Enter a 64-hex sha256 to copy tags from.");
          return;
        }
        copyTagsFromSha(sha);
      }
    }));
    secTags.appendChild(copyRow);
    pane.appendChild(secTags);

    // URLs ---------------------------------------------------------------
    var secUrls = section("URLs");
    var urls = Array.isArray(pkg.urls) ? pkg.urls.slice() : [];
    var urlsList = h("div", { class: "url-list" });
    for (var u = 0; u < urls.length; u++) {
      (function (index) {
        var row = h("div", { class: "row url-row" });
        row.appendChild(h("button", {
          type: "button",
          class: "remove-x",
          text: "X",
          title: "Remove URL",
          onclick: function () {
            state.pkg.urls.splice(index, 1);
            renderForm();
            updateAll();
          }
        }));
        row.appendChild(textInput(urls[index], function (v) {
          if (!Array.isArray(state.pkg.urls)) {
            state.pkg.urls = [];
          }
          if (v) {
            state.pkg.urls[index] = v;
            scheduleUpdateAll();
          } else {
            state.pkg.urls.splice(index, 1);
            renderForm();
            updateAll();
          }
        }));
        urlsList.appendChild(row);
      })(u);
    }
    secUrls.appendChild(urlsList);
    var urlBtns = h("div", { class: "row" });
    urlBtns.appendChild(h("button", {
      type: "button",
      text: "Add URL",
      onclick: function () {
        if (!Array.isArray(state.pkg.urls)) {
          state.pkg.urls = [];
        }
        state.pkg.urls.push("https://");
        renderForm();
        updateAll();
      }
    }));
    urlBtns.appendChild(h("button", {
      type: "button",
      text: "Add by-sha256 URL",
      onclick: function () {
        if (!Array.isArray(state.pkg.urls)) {
          state.pkg.urls = [];
        }
        var sha = state.pkg.sha256 || "";
        var name = filenameTagValue() || "file.zip";
        state.pkg.urls.push("https://www.quaddicted.com/files/by-sha256/" +
          sha.slice(0, 2) + "/" + sha + "/" + name);
        renderForm();
        updateAll();
      }
    }));
    secUrls.appendChild(urlBtns);
    pane.appendChild(secUrls);

    // Files --------------------------------------------------------------
    var secFiles = section("Files");
    secFiles.appendChild(h("div", {
      class: "hint",
      text: "Read-only view. The files map is generated by scanning an archive; edit it via the raw JSON if really needed."
    }));
    if (pkg.files && typeof pkg.files === "object" && !Array.isArray(pkg.files)) {
      var filesBox = h("div", { class: "files-tree" });
      renderFilesTree(filesBox, buildFilesTree(pkg.files));
      secFiles.appendChild(filesBox);
    } else {
      secFiles.appendChild(h("div", { class: "hint", text: "No files map. Scan an uploaded archive to add one." }));
    }
    var scanRow = h("div", { class: "row" });
    var scanFile = h("input", { type: "file", id: "file-scan" });
    scanFile.addEventListener("change", function () {
      if (scanFile.files && scanFile.files[0]) {
        scanUploadedArchive(scanFile.files[0]);
      }
    });
    scanRow.appendChild(scanFile);
    scanRow.appendChild(h("button", {
      type: "button",
      text: "Scan uploaded archive",
      onclick: function () {
        scanFile.click();
      }
    }));
    secFiles.appendChild(scanRow);
    pane.appendChild(secFiles);

    // Install ------------------------------------------------------------
    var secInstall = section("Install");
    var install = pkg.install && typeof pkg.install === "object" && !Array.isArray(pkg.install) ? pkg.install : null;
    if (install && install.extractmapping && typeof install.extractmapping === "object" && !Array.isArray(install.extractmapping)) {
      var mapKeys = Object.keys(install.extractmapping);
      var mapList = h("div", { class: "mapping-list" });
      for (var m = 0; m < mapKeys.length; m++) {
        (function (src) {
          var row = h("div", { class: "row mapping-row" });
          var srcInput = h("input", { type: "text", value: src });
          srcInput.addEventListener("change", function () {
            var v = srcInput.value;
            if (!v || v === src) {
              return;
            }
            var mapping = state.pkg.install.extractmapping;
            var target = mapping[src];
            delete mapping[src];
            mapping[v] = target;
            renderForm();
            updateAll();
          });
          row.appendChild(srcInput);
          row.appendChild(h("span", { text: " \u2192 " }));
          row.appendChild(textInput(install.extractmapping[src], function (v) {
            state.pkg.install.extractmapping[src] = v;
            scheduleUpdateAll();
          }));
          row.appendChild(h("button", {
            type: "button",
            text: "Remove",
            onclick: function () {
              delete state.pkg.install.extractmapping[src];
              renderForm();
              updateAll();
            }
          }));
          mapList.appendChild(row);
        })(mapKeys[m]);
      }
      secInstall.appendChild(mapList);
    }
    var mapAdd = h("div", { class: "row" });
    mapAdd.appendChild(h("button", {
      type: "button",
      text: "Add extractmapping",
      onclick: function () {
        if (!state.pkg.install || typeof state.pkg.install !== "object" || Array.isArray(state.pkg.install)) {
          state.pkg.install = {};
        }
        if (!state.pkg.install.extractmapping || typeof state.pkg.install.extractmapping !== "object" || Array.isArray(state.pkg.install.extractmapping)) {
          state.pkg.install.extractmapping = {};
        }
        state.pkg.install.extractmapping["/source/path"] = "/target/path";
        renderForm();
        updateAll();
      }
    }));
    secInstall.appendChild(mapAdd);
    if (install && "extract" in install) {
      var exRow = h("div", { class: "row" });
      exRow.appendChild(h("label", { text: "extract (legacy)" }));
      exRow.appendChild(textInput(install.extract, function (v) { setPkgInstall("extract", v || null); }));
      exRow.appendChild(h("span", { class: "hint", text: "legacy; prefer extractmapping" }));
      secInstall.appendChild(exRow);
    }
    pane.appendChild(secInstall);

    // Notes --------------------------------------------------------------
    var secNotes = section("Notes");
    var notes = Array.isArray(pkg.notes) ? pkg.notes : (pkg.notes ? [String(pkg.notes)] : []);
    var notesList = h("div", { class: "notes-list" });
    for (var n = 0; n < notes.length; n++) {
      (function (index) {
        var row = h("div", { class: "row note-row" });
        row.appendChild(textArea(notes[index], function (v) {
          if (!Array.isArray(state.pkg.notes)) {
            state.pkg.notes = [];
          }
          // an empty note stays an empty note while typing; only the Remove
          // button deletes a row
          state.pkg.notes[index] = v;
          scheduleUpdateAll();
        }));
        row.appendChild(h("button", {
          type: "button",
          text: "Remove",
          onclick: function () {
            state.pkg.notes.splice(index, 1);
            renderForm();
            updateAll();
          }
        }));
        notesList.appendChild(row);
      })(n);
    }
    secNotes.appendChild(notesList);
    secNotes.appendChild(h("button", {
      type: "button",
      text: "Add note",
      onclick: function () {
        if (!Array.isArray(state.pkg.notes)) {
          state.pkg.notes = [];
        }
        state.pkg.notes.push("");
        renderForm();
        updateAll();
      }
    }));
    pane.appendChild(secNotes);
  }

  function setPkgInstall(key, value) {
    if (!state.pkg.install || typeof state.pkg.install !== "object" || Array.isArray(state.pkg.install)) {
      state.pkg.install = {};
    }
    if (value === null) {
      delete state.pkg.install[key];
    } else {
      state.pkg.install[key] = value;
    }
    updateAll();
  }

  async function copyTagsFromSha(input) {
    var m = /[a-f0-9]{64}/i.exec(String(input || "").trim());
    if (!m) {
      setStatus("Enter a 64-hex sha256 to copy tags from.");
      return;
    }
    var sha = m[0].toLowerCase();
    if (sha === state.pkg.sha256) {
      setStatus("That is the sha256 of the current package.");
      return;
    }
    setStatus("Fetching tags for " + sha.slice(0, 12) + "...");
    try {
      var source = await fetchMetadata(sha);
    } catch (e) {
      setStatus("Could not fetch tags: " + e.message);
      return;
    }
    if (!source) {
      setStatus("No metadata found in the Quaddicted API for this sha256.");
      return;
    }
    var sourceTags = Array.isArray(source.tags) ? source.tags : [];
    if (!Array.isArray(state.pkg.tags)) {
      state.pkg.tags = [];
    }
    var added = 0;
    for (var i = 0; i < sourceTags.length; i++) {
      var tag = sourceTags[i];
      if (tag.indexOf("filename=") === 0) {
        continue;
      }
      if (state.pkg.tags.indexOf(tag) === -1) {
        state.pkg.tags.push(tag);
        added++;
      }
    }
    renderForm();
    updateAll();
    setStatus("Copied " + added + " tag(s) from " + sha.slice(0, 12) +
      " (filename tag and duplicates skipped).");
  }

  function fillTagSuggestions(value, box, onPick) {
    clear(box);
    var v = String(value || "");
    if (!v) {
      box.setAttribute("class", "suggest-box hidden");
      return;
    }
    var lowerV = v.toLowerCase();
    var matches = [];
    var seen = {};
    if (tagStats && Array.isArray(tagStats.tags)) {
      for (var i = 0; i < tagStats.tags.length && matches.length < 12; i++) {
        var s = tagStats.tags[i];
        if (s.tag.toLowerCase().indexOf(lowerV) === 0 && !seen[s.tag]) {
          seen[s.tag] = true;
          matches.push({ tag: s.tag, count: s.count });
        }
      }
    }
    for (var d = 0; d < Tagdata.KNOWN_TAGS.length && matches.length < 12; d++) {
      var ex = Tagdata.KNOWN_TAGS[d].example;
      if (ex.toLowerCase().indexOf(lowerV) === 0 && !seen[ex]) {
        seen[ex] = true;
        matches.push({ tag: ex, count: null });
      }
    }
    if (!matches.length) {
      box.setAttribute("class", "suggest-box hidden");
      return;
    }
    box.setAttribute("class", "suggest-box");
    for (var m = 0; m < matches.length; m++) {
      (function (entry) {
        box.appendChild(h("button", {
          type: "button",
          class: "suggest-item",
          text: entry.count === null || entry.count === undefined
            ? entry.tag
            : entry.tag + " \u2014 " + entry.count + " packages",
          onclick: function () {
            onPick(entry.tag);
          }
        }));
      })(matches[m]);
    }
  }

  function tagRow(tagString, index) {
    var row = h("div", { class: "tag-row" });
    var input = h("input", { type: "text", value: String(tagString) });
    var hint = h("div", { class: "tag-hint" });
    var suggestBox = h("div", { class: "suggest-box hidden" });
    function hideSuggestions() {
      clear(suggestBox);
      suggestBox.setAttribute("class", "suggest-box hidden");
    }
    function refreshHint() {
      clear(hint);
      try {
        var parsed = Validate.parseTag(input.value);
        var info = Tagdata.infoFor(parsed.key);
        if (info) {
          hint.appendChild(document.createTextNode(info.hint));
        } else {
          hint.appendChild(document.createTextNode("Unknown key '" + parsed.key + "'."));
        }
      } catch (e) {
        hint.appendChild(document.createTextNode(e.message));
      }
    }
    input.addEventListener("input", function () {
      if (Array.isArray(state.pkg.tags)) {
        state.pkg.tags[index] = input.value;
      }
      refreshHint();
      scheduleUpdateAll();
      fillTagSuggestions(input.value, suggestBox, function (chosen) {
        input.value = chosen;
        if (Array.isArray(state.pkg.tags)) {
          state.pkg.tags[index] = chosen;
        }
        hideSuggestions();
        refreshHint();
        scheduleUpdateAll();
        if (typeof input.focus === "function") {
          input.focus();
        }
      });
    });
    input.addEventListener("keydown", function (e) {
      if (e && e.key === "Escape") {
        hideSuggestions();
      }
    });
    if (index === pendingFocusTagIndex) {
      pendingFocusTagIndex = null;
      focusAtEnd(input);
    }
    refreshHint();
    var inputRow = h("div", { class: "row tag-input-row" });
    inputRow.appendChild(h("button", {
      type: "button",
      class: "remove-x",
      text: "X",
      title: "Remove tag",
      onclick: function () {
        state.pkg.tags.splice(index, 1);
        renderForm();
        updateAll();
      }
    }));
    inputRow.appendChild(input);
    row.appendChild(inputRow);
    row.appendChild(hint);
    row.appendChild(suggestBox);
    return row;
  }

  function filenameTagValue() {
    var tags = state.pkg && Array.isArray(state.pkg.tags) ? state.pkg.tags : [];
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].indexOf("filename=") === 0) {
        return tags[i].slice(9);
      }
    }
    return null;
  }

  function buildFilesTree(filesObj) {
    var root = { dirs: {}, files: [] };
    var names = Object.keys(filesObj).sort();
    for (var i = 0; i < names.length; i++) {
      var key = names[i];
      var entry = filesObj[key];
      var segs = key.split("/");
      var node = root;
      var dirPath = "";
      for (var s = 0; s < segs.length - 1; s++) {
        dirPath += segs[s] + "/";
        if (!node.dirs[segs[s]]) {
          node.dirs[segs[s]] = { dirs: {}, files: [], path: dirPath };
        }
        node = node.dirs[segs[s]];
      }
      var leafName = segs[segs.length - 1];
      if (leafName === "") {
        node.entry = entry;
      } else {
        var leaf = { name: leafName, entry: entry };
        if (entry.files && typeof entry.files === "object" && !Array.isArray(entry.files)) {
          leaf.subtree = entry.files;
        }
        node.files.push(leaf);
      }
    }
    return root;
  }

  function filesTreeMeta(entry) {
    var parts = [];
    if (entry && entry.bytes !== undefined && entry.bytes !== null) {
      parts.push(entry.bytes + " B" + sizeWithUnits(entry.bytes));
    }
    if (entry && entry.sha256) {
      parts.push(entry.sha256.slice(0, 12) + "\u2026");
    }
    if (entry && entry.timestamp) {
      parts.push(entry.timestamp);
    }
    return parts.join(" \u00b7 ");
  }

  function renderFilesTree(container, node) {
    var dirNames = Object.keys(node.dirs);
    for (var d = 0; d < dirNames.length; d++) {
      (function (dirName) {
        var child = node.dirs[dirName];
        var isCollapsed = collapsedDirs().has(child.path);
        var row = h("div", { class: "tree-row dir-row" });
        var toggle = h("button", {
          type: "button",
          class: "tree-toggle",
          text: isCollapsed ? "+" : "-"
        });
        toggle.addEventListener("click", function () {
          if (collapsedDirs().has(child.path)) {
            collapsedDirs().delete(child.path);
          } else {
            collapsedDirs().add(child.path);
          }
          renderForm();
          updateAll();
        });
        row.appendChild(toggle);
        row.appendChild(h("span", { class: "tree-name dir", text: dirName + "/" }));
        container.appendChild(row);
        var meta = filesTreeMeta(child.entry);
        if (meta) {
          container.appendChild(h("div", { class: "tree-meta-row", text: meta }));
        }
        if (!isCollapsed) {
          var childBox = h("div", { class: "files-tree nested" });
          renderFilesTree(childBox, child);
          container.appendChild(childBox);
        }
      })(dirNames[d]);
    }
    for (var f = 0; f < node.files.length; f++) {
      (function (leaf) {
        var row = h("div", { class: "tree-row file-row" });
        row.appendChild(h("span", { class: "tree-toggle-spacer", text: "\u00b7" }));
        row.appendChild(h("span", { class: "tree-name", text: leaf.name }));
        container.appendChild(row);
        var leafMeta = filesTreeMeta(leaf.entry);
        if (leafMeta) {
          container.appendChild(h("div", { class: "tree-meta-row", text: leafMeta }));
        }
        if (leaf.subtree) {
          var subBox = h("div", { class: "files-tree nested archive" });
          renderFilesTree(subBox, buildFilesTree(leaf.subtree));
          container.appendChild(subBox);
        }
      })(node.files[f]);
    }
  }

  async function scanUploadedArchive(file) {
    setStatus("Scanning " + file.name + "...");
    var bytes = new Uint8Array(await file.arrayBuffer());
    var scan = await Scan.scanArchive(bytes);
    if (!scan.files) {
      var looksLikeArchive = bytes.length >= 4 && bytes[0] === 0x50 &&
        ((bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) ||
         (bytes[1] === 0x41 && bytes[2] === 0x43 && bytes[3] === 0x4b));
      if (looksLikeArchive) {
        setStatus("Archive not scanned: " + file.name + " looks like an archive but is corrupt (" +
          (scan.errors && scan.errors[""] ? scan.errors[""] : "unknown error") + "). " +
          "The existing files map was left unchanged.");
      } else {
        setStatus("Not a zip or pak archive: " + file.name + ". The existing files map was left unchanged.");
      }
      return;
    }
    state.scanErrors = scan.errors || {};
    state.pkg.files = scan.files;
    renderForm();
    updateAll();
    setStatus("Scanned " + file.name + " (" + scan.kind + ", " +
      Object.keys(scan.files).length + " entries).");
  }

  // --------------------------------------------------------------- export

  function exportFilename() {
    return state.pkg && Validate.isValidSha256(state.pkg.sha256) ? state.pkg.sha256 + ".json" : "package.json";
  }

  function download() {
    if (!state.pkg) {
      return;
    }
    var blob = new Blob([canonicalText()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: exportFilename() });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    setStatus("Downloaded " + exportFilename() + ".");
  }

  async function copyToClipboard() {
    if (!state.pkg) {
      return;
    }
    var text = canonicalText();
    try {
      await root.navigator.clipboard.writeText(text);
      setStatus("Copied canonical JSON to clipboard.");
    } catch (e) {
      setStatus("Clipboard copy failed: " + e.message);
    }
  }

  // ------------------------------------------------------------------- PR

  function appendPrLog(message) {
    var logBox = $("pr-log");
    if (!logBox) {
      return;
    }
    logBox.textContent += message + "\n";
  }

  async function createPr() {
    if (!state.pkg || !state.validation || state.validation.errors.length) {
      return;
    }
    var patInput = $("inp-pat");
    var token = patInput ? patInput.value.trim() : "";
    if (!token) {
      setStatus("Enter a GitHub PAT first.");
      return;
    }
    var logBox = $("pr-log");
    if (logBox) {
      logBox.textContent = "";
    }
    var linkBox = $("pr-link");
    if (linkBox) {
      clear(linkBox);
    }
    setStatus("Creating pull request...");
    try {
      var result = await Github.createPullRequest({
        token: token,
        sha256: state.pkg.sha256,
        contentText: canonicalText(),
        pkg: state.pkg,
        validation: state.validation,
        isNew: state.origin ? state.origin.type === "new" : undefined,
        log: appendPrLog
      });
      setStatus("Pull request created.");
      if (linkBox && /^https:\/\/github\.com\//.test(result.url)) {
        clear(linkBox);
        linkBox.appendChild(h("a", {
          href: result.url,
          rel: "noopener noreferrer",
          text: result.url
        }));
      }
    } catch (e) {
      setStatus("PR creation failed: " + e.message);
      appendPrLog("Error: " + e.message);
    }
  }

  function savePat() {
    var patInput = $("inp-pat");
    if (!patInput) {
      return;
    }
    try {
      root.localStorage.setItem(PAT_KEY, patInput.value);
      setStatus("PAT saved in this browser's localStorage.");
    } catch (e) {
      setStatus("Could not save PAT: " + e.message);
    }
  }

  function forgetPat() {
    try {
      root.localStorage.removeItem(PAT_KEY);
    } catch (e) {
      /* ignore */
    }
    var patInput = $("inp-pat");
    if (patInput) {
      patInput.value = "";
    }
    setStatus("PAT removed from localStorage.");
  }

  // ------------------------------------------------------------------ boot

  function wire() {
    var fileNew = $("file-new");
    if (fileNew) {
      fileNew.addEventListener("change", function () {
        if (fileNew.files && fileNew.files[0]) {
          newFromFile(fileNew.files[0]);
        }
      });
    }
    var btnNew = $("btn-new");
    if (btnNew) {
      btnNew.addEventListener("click", function () {
        if (fileNew) {
          fileNew.click();
        }
      });
    }
    var btnOpenSha = $("btn-open-sha");
    if (btnOpenSha) {
      btnOpenSha.addEventListener("click", function () {
        var sha = askSha256("Enter the sha256 of the package to open:");
        if (sha === undefined) {
          return;
        }
        if (sha === null) {
          setStatus("Enter a 64-hex sha256 to open.");
          return;
        }
        openBySha256(sha);
      });
    }
    var fileJson = $("file-json");
    if (fileJson) {
      fileJson.addEventListener("change", function () {
        if (fileJson.files && fileJson.files[0]) {
          openJsonFile(fileJson.files[0]);
        }
      });
    }
    var btnOpenJson = $("btn-open-json");
    if (btnOpenJson) {
      btnOpenJson.addEventListener("click", function () {
        if (fileJson) {
          fileJson.click();
        }
      });
    }
    var btnReset = $("btn-reset");
    if (btnReset) {
      btnReset.addEventListener("click", resetAll);
    }
    var btnDiscard = $("btn-discard-draft");
    if (btnDiscard) {
      btnDiscard.addEventListener("click", discardDraft);
    }
    var btnLoadDraft = $("btn-load-draft");
    if (btnLoadDraft) {
      btnLoadDraft.addEventListener("click", function () {
        if (loadDraft()) {
          renderForm();
          updateAll();
          setStatus("Draft restored.");
        } else {
          setStatus("No valid draft found.");
        }
      });
    }
    var btnDownload = $("btn-download");
    if (btnDownload) {
      btnDownload.addEventListener("click", download);
    }
    var btnCopy = $("btn-copy");
    if (btnCopy) {
      btnCopy.addEventListener("click", copyToClipboard);
    }
    var btnPr = $("btn-pr");
    if (btnPr) {
      btnPr.addEventListener("click", createPr);
    }
    var btnSavePat = $("btn-save-pat");
    if (btnSavePat) {
      btnSavePat.addEventListener("click", savePat);
    }
    var btnForgetPat = $("btn-forget-pat");
    if (btnForgetPat) {
      btnForgetPat.addEventListener("click", forgetPat);
    }
    var qdTitleIn = $("inp-qd-title");
    if (qdTitleIn) {
      qdTitleIn.addEventListener("input", function () {
        qdTitleDirty = true;
      });
    }
    var qdUserIn = $("inp-qd-user");
    if (qdUserIn) {
      qdUserIn.addEventListener("input", function () {
        try {
          root.localStorage.setItem(QD_USER_KEY, qdUserIn.value);
        } catch (e) {
          /* storage unavailable */
        }
      });
    }
    var btnQd = $("btn-qd");
    if (btnQd) {
      btnQd.addEventListener("click", submitToQuaddicted);
    }
  }

  function boot() {
    tagStats = loadTagStatsCache();
    wire();
    try {
      var qdUser = root.localStorage.getItem(QD_USER_KEY);
      if (qdUser && $("inp-qd-user")) {
        $("inp-qd-user").value = qdUser;
      }
    } catch (e) {
      /* storage unavailable */
    }
    try {
      var pat = root.localStorage.getItem(PAT_KEY);
      if (pat && $("inp-pat")) {
        $("inp-pat").value = pat;
      }
      if (root.localStorage.getItem(DRAFT_KEY)) {
        var banner = $("draft-banner");
        if (banner) {
          banner.setAttribute("data-visible", "true");
        }
      }
    } catch (e) {
      /* storage unavailable */
    }
    setupRawEditor();
    renderValidation();
    updateButtons();
    updateRaw();
    loadFromUrlHash();
  }

  if (typeof document !== "undefined") {
    if (typeof document.readyState === "string" && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }

  // Node test hooks
  if (typeof module === "object" && module.exports) {
    module.exports = {
      boot: boot,
      state: state,
      copyTagsFromSha: copyTagsFromSha,
      newFromFile: newFromFile,
      loadPackageFromText: loadPackageFromText,
      updateAll: updateAll,
      renderForm: renderForm,
      renderValidation: renderValidation,
      canonicalText: canonicalText,
      setupRawEditor: setupRawEditor,
      loadFromUrlHash: loadFromUrlHash,
      shaFromUrlHash: shaFromUrlHash,
      fetchCommonTags: fetchCommonTags,
      getRawEditor: function () { return rawEditor; },
      onRawInput: onRawInput,
      submitToQuaddicted: submitToQuaddicted,
      qdAutoTitle: qdAutoTitle
    };
  }

  root.QeApp = { boot: boot, state: state };
})(typeof self !== "undefined" ? self : globalThis);
