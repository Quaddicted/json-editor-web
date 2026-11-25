(function (root, factory) {
  let deps;
  if (typeof module !== "undefined" && module.exports) {
    deps = { tagdata: require("./tagdata.js"), serialize: require("./serialize.js") };
  } else {
    deps = { tagdata: root.TagData, serialize: root.Serialize };
  }
  const api = factory(deps);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Validate = api;
})(typeof self !== "undefined" ? self : globalThis, function (deps) {
  "use strict";

  const { KNOWN_KEYS, SINGLE_KEYS, mainKeyOf } = deps.tagdata;
  const { compareCodePoints } = deps.serialize;

  const EMPTY_SHA256 =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const KNOWN_KEYS_SET = new Set(KNOWN_KEYS);

  function isPySpaceCp(cp) {
    return (
      cp === 0x09 || cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x0d ||
      cp === 0x20 || (cp >= 0x1c && cp <= 0x1f) || cp === 0x85 || cp === 0xa0 ||
      cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 ||
      cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000
    );
  }

  function isValidBytes(value) {
    let n;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      n = Math.trunc(value);
    } else if (typeof value === "boolean") {
      n = value ? 1 : 0;
    } else if (typeof value === "string") {
      const chars = Array.from(value);
      let start = 0;
      let end = chars.length;
      while (start < end && isPySpaceCp(chars[start].codePointAt(0))) start++;
      while (end > start && isPySpaceCp(chars[end - 1].codePointAt(0))) end--;
      const t = chars.slice(start, end).join("");
      if (!/^[+-]?[0-9](_?[0-9])*$/.test(t)) return false;
      let bn;
      try {
        bn = BigInt(t.replace(/_/g, ""));
      } catch (e) {
        return false;
      }
      return bn >= 1n;
    } else {
      return false;
    }
    return n >= 1;
  }

  function isValidSha256(s) {
    return typeof s === "string" && /^[a-z0-9]{64}$/.test(s);
  }

  function isValidUrl(string) {
    if (typeof string !== "string") return false;
    let s = string.replace(/[\t\r\n]/g, "");
    s = s.replace(/^[\x00-\x20]+/, "");
    const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(s);
    if (!m) return false;
    const rest = s.slice(m[0].length);
    if (!rest.startsWith("//")) return false;
    let netloc = rest.slice(2);
    const cut = netloc.search(/[/?#]/);
    if (cut !== -1) netloc = netloc.slice(0, cut);
    if (netloc.length === 0) return false;
    if (netloc.includes("[") !== netloc.includes("]")) return false;
    return true;
  }

  function isPrintablePlusSpace(string) {
    if (typeof string !== "string" || string.length === 0) return false;
    const chars = Array.from(string);
    const first = chars[0].codePointAt(0);
    const last = chars[chars.length - 1].codePointAt(0);
    if (isPySpaceCp(first) || isPySpaceCp(last)) return false;
    for (const ch of chars) {
      const cp = ch.codePointAt(0);
      if (isPySpaceCp(cp) && cp !== 0x20) return false;
    }
    return true;
  }

  function isPrintableLowercaseAscii(string) {
    return typeof string === "string" && /^[\x21-\x7e]+$/.test(string);
  }

  function isPrintableLowercaseAsciiOrSpace(string) {
    return typeof string === "string" && /^[\x20-\x7e]+$/.test(string);
  }

  const WINDOWS_DEVICES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
  ]);

  function isValidFilenameAnywhere(name) {
    if (typeof name !== "string") return false;
    if (name === "" || name === "." || name === "..") return false;
    if (name.includes("/") || name.includes("\0")) return false;
    const posixOk = !name.includes("/") && !name.includes("\0");
    const winOk =
      !/[\x00-\x1f<>:"/\\|?*]/.test(name) &&
      !/[ .]$/.test(name) &&
      !WINDOWS_DEVICES.has(name.split(".")[0].toUpperCase());
    return posixOk || winOk;
  }

  function isValidReleaseDate(s) {
    return typeof s === "string" && /^(?:\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(s);
  }

  function isValidCommandline(s) {
    return typeof s === "string" && /^[a-zA-Z0-9 ._+-/]+$/.test(s);
  }

  function isValidLink(s) {
    if (typeof s !== "string") return false;
    const m = /^\[(.*)\]\((.*)\)$/.exec(s);
    let title = null;
    let url = s;
    if (m) {
      title = m[1];
      url = m[2];
    }
    if (title) {
      if (!isPrintablePlusSpace(title)) return false;
    }
    return isValidUrl(url);
  }

  const TAG_VALUE_VALIDATORS = {
    author: isPrintablePlusSpace,
    title: isPrintablePlusSpace,
    alternative_title: isPrintablePlusSpace,
    filename: isValidFilenameAnywhere,
    game: isPrintableLowercaseAscii,
    game_mode: isPrintableLowercaseAscii,
    type: isPrintableLowercaseAscii,
    theme: isPrintableLowercaseAscii,
    startmap: isPrintableLowercaseAscii,
    release_date: isValidReleaseDate,
    commandline: isValidCommandline,
    link: isValidLink,
  };

  function isStructurallyValidKey(s) {
    if (s.endsWith(":")) return false;
    return /^[a-z]+[a-z0-9_:]*$/.test(s);
  }

  function isStructurallyValidKeyWithoutQualifiers(s) {
    return /^[a-z]+[a-z0-9_]*$/.test(s);
  }

  function isStructurallyValidQualifier(s) {
    return /^[a-z]+[a-z0-9_]*$/.test(s);
  }

  function isStructurallyValidTag(string) {
    if (typeof string !== "string") return false;
    if (string.length < 3) return false;
    if (string.length === 3 && string[1] !== "=") return false;
    return string.includes("=");
  }

  function parseTag(tag) {
    if (typeof tag !== "string") return { ok: false, error: "Tag is not a string." };
    if (!tag.includes("=")) return { ok: false, error: "Tag does not contain a '='." };
    if (tag.length < 3) return { ok: false, error: "Tag cannot be shorter than 3 characters ('k=v')." };
    let eqCount = 0;
    for (let i = 0; i < tag.length; i++) if (tag[i] === "=") eqCount++;
    if (tag.startsWith("=") || (eqCount === 1 && tag.endsWith("="))) {
      return { ok: false, error: "Tag must contain key and value, separated by a '='." };
    }
    const sep = tag.indexOf("=");
    const keyString = tag.slice(0, sep);
    const value = tag.slice(sep + 1);
    const parts = keyString.split(":");
    const key = parts[0];
    const qualifiers = parts.slice(1);
    if (!isStructurallyValidKeyWithoutQualifiers(key)) {
      return { ok: false, error: "Tag does not contain a valid key." };
    }
    for (const q of qualifiers) {
      if (!isStructurallyValidQualifier(q)) {
        return { ok: false, error: "Tag key contains an invalid qualifier." };
      }
    }
    if (!isPrintablePlusSpace(value)) {
      return { ok: false, error: "Tag value contains disallowed characters." };
    }
    return { ok: true, key, qualifiers, value, string: tag };
  }

  function validateFilesTree(files, path, errors, warnings, depth) {
    const err = (p, m) => errors.push({ path: p, message: m });
    const warn = (p, m) => warnings.push({ path: p, message: m });
    if (files === null || typeof files !== "object" || Array.isArray(files)) {
      err(path, "'files' must be an object mapping paths to entries.");
      return;
    }
    for (const key of Object.keys(files)) {
      const p = path + "[" + JSON.stringify(key) + "]";
      const entry = files[key];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        err(p, "Entry must be an object.");
        continue;
      }
      if (key.endsWith("/")) {
        if (entry.bytes !== 0) warn(p, "Directory entry should have bytes = 0.");
        if (entry.sha256 !== EMPTY_SHA256) warn(p, "Directory entry should have the sha256 of empty input.");
      } else {
        if (!("bytes" in entry)) err(p, "Missing 'bytes' value.");
        else if (!isValidBytes(entry.bytes)) err(p, "Malformed 'bytes' value.");
        if (!("sha256" in entry)) err(p, "Missing 'sha256' value.");
        else if (!isValidSha256(entry.sha256)) err(p, "Malformed 'sha256' value.");
      }
      if ("timestamp" in entry) {
        if (typeof entry.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(entry.timestamp)) {
          warn(p, "'timestamp' should be ISO format YYYY-MM-DDTHH:MM:SS.000Z.");
        }
      }
      if ("files" in entry) {
        if (depth >= 4) {
          warn(p, "Nested archives deeper than 4 levels are not scanned.");
        } else {
          validateFilesTree(entry.files, p + ".files", errors, warnings, depth + 1);
        }
      }
    }
  }

  function validateInstall(install, errors, warnings) {
    const err = (p, m) => errors.push({ path: p, message: m });
    const warn = (p, m) => warnings.push({ path: p, message: m });
    if (install === null || typeof install !== "object" || Array.isArray(install)) {
      err("install", "'install' must be an object.");
      return;
    }
    if ("extractmapping" in install) {
      const em = install.extractmapping;
      if (em === null || typeof em !== "object" || Array.isArray(em)) {
        err("install.extractmapping", "'extractmapping' must be an object mapping source to target.");
      } else {
        for (const k of Object.keys(em)) {
          if (!k.startsWith("/")) warn("install.extractmapping", "Source path should start with '/': " + JSON.stringify(k));
          if (typeof em[k] !== "string" || !em[k].startsWith("/")) {
            warn("install.extractmapping", "Target path should start with '/': " + JSON.stringify(em[k]));
          }
        }
      }
    }
    if ("extract" in install) {
      warn("install.extract", "Legacy 'install.extract' is deprecated, prefer 'install.extractmapping'.");
    }
  }

  function validatePackage(pkg, opts) {
    const o = opts || {};
    const errors = [];
    const warnings = [];
    const err = (path, message) => errors.push({ path, message });
    const warn = (path, message) => warnings.push({ path, message });

    if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) {
      err("(root)", "Package must be a JSON object.");
      return { errors, warnings };
    }

    if (!("bytes" in pkg)) err("bytes", "Missing 'bytes' value.");
    else if (!isValidBytes(pkg.bytes)) err("bytes", "Malformed 'bytes' value.");

    if (!("sha256" in pkg)) err("sha256", "Missing 'sha256' value.");
    else if (!isValidSha256(pkg.sha256)) err("sha256", "Malformed 'sha256' value.");

    const unknown = Object.keys(pkg).filter((k) => !KNOWN_KEYS_SET.has(k));
    if (unknown.length > 0) err("(top-level)", "Unknown top-level keys: " + unknown.sort(compareCodePoints).join(", "));

    if (o.expectedSha256 !== undefined && o.expectedSha256 !== null) {
      if (pkg.sha256 !== o.expectedSha256) {
        err("sha256", "SHA256 mismatch between file path and file contents");
      }
    }

    if ("urls" in pkg) {
      if (!Array.isArray(pkg.urls)) err("urls", "'urls' must be a list.");
      else {
        pkg.urls.forEach((u, i) => {
          if (!isValidUrl(u)) err("urls[" + i + "]", "Invalid URL: " + JSON.stringify(u));
        });
      }
    }

    if ("tags" in pkg) {
      if (!Array.isArray(pkg.tags)) {
        err("tags", "'tags' must be a list of strings.");
      } else {
        const counts = {};
        pkg.tags.forEach((t, i) => {
          const p = parseTag(t);
          if (!p.ok) {
            err("tags[" + i + "]", "Invalid tag " + JSON.stringify(t) + ": " + p.error);
            return;
          }
          counts[p.key] = (counts[p.key] || 0) + 1;
          const v = TAG_VALUE_VALIDATORS[p.key];
          if (v) {
            if (v(p.value) === false) {
              err("tags[" + i + "]", "Invalid value for tag key '" + p.key + "': " + JSON.stringify(p.value));
            }
          } else {
            warn("tags[" + i + "]", "No validation function found for tag key '" + p.key + "', considering it valid.");
          }
          if (p.key === "zipbasedir") {
            warn("tags[" + i + "]", "Legacy tag 'zipbasedir' is deprecated, prefer 'install.extractmapping'.");
          }
        });
        for (const k of SINGLE_KEYS) {
          if ((counts[k] || 0) > 1) {
            warn("tags", "Tag key '" + k + "' should appear at most once (found " + counts[k] + ").");
          }
        }
        const sorted = pkg.tags.slice().sort(compareCodePoints);
        for (let i = 0; i < sorted.length; i++) {
          if (pkg.tags[i] !== sorted[i]) {
            warn("tags", "'tags' is not sorted alphabetically (repo convention).");
            break;
          }
        }
      }
    }

    if ("description" in pkg && typeof pkg.description !== "string") {
      err("description", "'description' must be a string.");
    }
    if ("notes" in pkg) {
      if (!Array.isArray(pkg.notes) || pkg.notes.some((n) => typeof n !== "string")) {
        err("notes", "'notes' must be a list of strings.");
      }
    }
    if ("json_version" in pkg && typeof pkg.json_version !== "string") {
      err("json_version", "'json_version' must be a string.");
    }
    if ("files" in pkg) validateFilesTree(pkg.files, "files", errors, warnings, 0);
    if ("install" in pkg) validateInstall(pkg.install, errors, warnings);

    return { errors, warnings };
  }

  return {
    EMPTY_SHA256,
    isPySpaceCp,
    isValidBytes,
    isValidSha256,
    isValidUrl,
    isPrintablePlusSpace,
    isPrintableLowercaseAscii,
    isPrintableLowercaseAsciiOrSpace,
    isValidFilenameAnywhere,
    isValidReleaseDate,
    isValidCommandline,
    isValidLink,
    isStructurallyValidKey,
    isStructurallyValidKeyWithoutQualifiers,
    isStructurallyValidQualifier,
    isStructurallyValidTag,
    parseTag,
    TAG_VALUE_VALIDATORS,
    mainKeyOf,
    validatePackage,
  };
});
