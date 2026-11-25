/*!
 * Validators ported from Quaddicted/tools
 * (quaddicted_tools/package_validation/*, quaddicted_tools/classes/tag.py).
 * UMD: window.Validate or module.exports.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Validate = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // generic validators #####################################################

  function isValidBytes(value) {
    // mirrors Python: int(value) >= 1
    if (typeof value === "number") {
      return isFinite(value) && Math.trunc(value) >= 1;
    }
    if (typeof value === "string") {
      if (!/^\s*[+-]?\d+\s*$/.test(value)) {
        return false;
      }
      return parseInt(value, 10) >= 1;
    }
    return false;
  }

  function isValidSha256(string) {
    return typeof string === "string" && /^[a-z0-9]{64}$/.test(string);
  }

  function isValidUrl(string) {
    // mimics urllib.parse.urlparse: needs a scheme and a non-empty netloc
    if (typeof string !== "string") {
      return false;
    }
    var m = /^([A-Za-z][A-Za-z0-9+.\-]*):([\s\S]*)$/.exec(string);
    if (!m) {
      return false;
    }
    var rest = m[2];
    if (rest.slice(0, 2) !== "//") {
      return false;
    }
    var netloc = rest.slice(2);
    var end = netloc.search(/[\/?#]/);
    if (end !== -1) {
      netloc = netloc.slice(0, end);
    }
    return netloc.length > 0;
  }

  function isPrintablePlusSpace(string) {
    if (typeof string !== "string") {
      return false;
    }
    if (/^\s/.test(string) || /\s$/.test(string)) {
      return false;
    }
    return /^[\S ]+$/.test(string);
  }

  function isPrintableAsciiNoSpace(string) {
    return typeof string === "string" && /^[\x21-\x7e]+$/.test(string);
  }

  // tag structure ##########################################################

  function structurallyValidTag(string) {
    if (typeof string !== "string") {
      return false;
    }
    if (string.length < 3) {
      return false;
    }
    if (string.length === 3 && string[1] !== "=") {
      return false;
    }
    if (string.indexOf("=") === -1) {
      return false;
    }
    return true;
  }

  function isValidKeyWithoutQualifiers(string) {
    return /^[a-z]+[a-z0-9_]*$/.test(string);
  }

  function isValidQualifier(string) {
    return /^[a-z]+[a-z0-9_]*$/.test(string);
  }

  function explodeTag(tag) {
    if (tag.indexOf("=") === -1 || tag[0] === "=" ||
        (tag.split("=").length - 1 === 1 && tag[tag.length - 1] === "=")) {
      throw new Error("Tag must contain key and value, separated by a '='.");
    }
    var separatorIndex = tag.indexOf("=");
    var keyString = tag.slice(0, separatorIndex);
    var value = tag.slice(separatorIndex + 1);
    var keyParts = keyString.split(":");
    return { key: keyParts[0], qualifiers: keyParts.slice(1), value: value };
  }

  function parseTag(string) {
    // mirrors quaddicted_tools.classes.tag.Tag.__init__ (error order and messages)
    if (typeof string !== "string") {
      throw new Error("Tag must be a string.");
    }
    if (string.indexOf("=") === -1) {
      throw new Error("Tag does not contain a '='.");
    }
    if (string.length < 3) {
      throw new Error("Tag cannot be shorter than 3 characters ('k=v').");
    }
    var parts = explodeTag(string);
    if (!isValidKeyWithoutQualifiers(parts.key)) {
      throw new Error("Tag does not contain a valid key.");
    }
    for (var i = 0; i < parts.qualifiers.length; i++) {
      if (!isValidQualifier(parts.qualifiers[i])) {
        throw new Error("Tag key contains an invalid qualifier.");
      }
    }
    if (!isPrintablePlusSpace(parts.value)) {
      throw new Error("Tag value contains disallowed characters.");
    }
    return parts;
  }

  // per-key tag value validators ###########################################

  function isValidAuthor(string) {
    return isPrintablePlusSpace(string);
  }

  var WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  var WINDOWS_INVALID_CHARS = /[\x00-\x1f<>:"\/\\|?*]/;

  function isValidFilenameAnywhere(string) {
    // mirrors string_is_valid_filename: valid on ANY of Linux/macOS/POSIX/Windows
    if (typeof string !== "string") {
      return false;
    }
    if (string === "." || string === "..") {
      return false;
    }
    if (string === "") {
      return false;
    }
    if (utf8ByteLength(string) > 255) {
      return false;
    }
    // Linux/macOS/POSIX: only NUL and "/" are invalid
    if (string.indexOf("\x00") === -1 && string.indexOf("/") === -1) {
      return true;
    }
    // Windows
    if (WINDOWS_INVALID_CHARS.test(string)) {
      return false;
    }
    if (/[ .]$/.test(string)) {
      return false;
    }
    var stem = string.split(".")[0];
    if (WINDOWS_RESERVED.test(stem)) {
      return false;
    }
    return true;
  }

  function utf8ByteLength(string) {
    var bytes = 0;
    for (var i = 0; i < string.length; i++) {
      var c = string.charCodeAt(i);
      if (c < 0x80) {
        bytes += 1;
      } else if (c < 0x800) {
        bytes += 2;
      } else if (c >= 0xd800 && c <= 0xdbff) {
        bytes += 2;
        i++;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function isValidGame(string) {
    return isPrintableAsciiNoSpace(string);
  }

  function isValidGameMode(string) {
    return isPrintableAsciiNoSpace(string);
  }

  function isValidType(string) {
    return isPrintableAsciiNoSpace(string);
  }

  function isValidTheme(string) {
    return isPrintableAsciiNoSpace(string);
  }

  function isValidStartmap(string) {
    return isPrintableAsciiNoSpace(string);
  }

  function isValidTitle(string) {
    return isPrintablePlusSpace(string);
  }

  function isValidAlternativeTitle(string) {
    return isPrintablePlusSpace(string);
  }

  function isValidReleaseDate(string) {
    if (typeof string !== "string") {
      return false;
    }
    return (
      /^\d{4}$/.test(string) ||
      /^\d{4}-\d{2}$/.test(string) ||
      /^\d{4}-\d{2}-\d{2}$/.test(string)
    );
  }

  function isValidCommandline(string) {
    return typeof string === "string" && /^[a-zA-Z0-9 ._+-\/]+$/.test(string);
  }

  function isValidLink(string) {
    if (typeof string !== "string") {
      return false;
    }
    var match = /^\[(.*)\]\((.*)\)$/.exec(string);
    var title = null;
    var url;
    if (match) {
      title = match[1];
      url = match[2];
    } else {
      url = string;
    }
    if (title) {
      if (!isPrintablePlusSpace(title)) {
        return false;
      }
    }
    return isValidUrl(url);
  }

  var KEY_VALIDATORS = {
    author: isValidAuthor,
    title: isValidTitle,
    alternative_title: isValidAlternativeTitle,
    filename: isValidFilenameAnywhere,
    game: isValidGame,
    game_mode: isValidGameMode,
    type: isValidType,
    theme: isValidTheme,
    startmap: isValidStartmap,
    release_date: isValidReleaseDate,
    commandline: isValidCommandline,
    link: isValidLink
  };

  var SINGLE_KEYS = ["title", "release_date", "version"];
  var KNOWN_TOP_LEVEL_KEYS = [
    "bytes", "sha256", "description", "files", "install",
    "json_version", "notes", "tags", "urls"
  ];
  var EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  var ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  // package validation #####################################################

  function validatePackage(pkg, opts) {
    var options = opts || {};
    var errors = [];
    var warnings = [];

    function err(path, message) {
      errors.push({ path: path, message: message });
    }
    function warn(path, message) {
      warnings.push({ path: path, message: message });
    }

    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
      return { errors: [{ path: "", message: "Package is not a JSON object." }], warnings: warnings };
    }

    // "bytes" is mandatory
    if (!("bytes" in pkg)) {
      err("bytes", "Missing 'bytes' value.");
    } else if (!isValidBytes(pkg.bytes)) {
      err("bytes", "Malformed 'bytes' value.");
    }

    // "sha256" is mandatory
    if (!("sha256" in pkg)) {
      err("sha256", "Missing 'sha256' value.");
    } else if (!isValidSha256(pkg.sha256)) {
      err("sha256", "Malformed 'sha256' value.");
    }

    if (options.expectedSha256 !== undefined && options.expectedSha256 !== null) {
      if (options.expectedSha256 !== pkg.sha256) {
        err("sha256", "SHA256 mismatch between file path and file contents");
      }
    }

    // urls
    if ("urls" in pkg && pkg.urls !== undefined && pkg.urls !== null) {
      if (!Array.isArray(pkg.urls)) {
        err("urls", "'urls' must be a list.");
      } else {
        for (var u = 0; u < pkg.urls.length; u++) {
          if (!isValidUrl(pkg.urls[u])) {
            err("urls[" + u + "]", "Invalid URL: " + String(pkg.urls[u]));
          }
        }
      }
    }

    // unknown top-level keys -> fail
    var keys = Object.keys(pkg);
    for (var k = 0; k < keys.length; k++) {
      if (KNOWN_TOP_LEVEL_KEYS.indexOf(keys[k]) === -1) {
        err(keys[k], "Unknown top-level key.");
      }
    }

    // tags
    if ("tags" in pkg && pkg.tags !== undefined && pkg.tags !== null) {
      if (!Array.isArray(pkg.tags)) {
        err("tags", "'tags' must be a list.");
      } else {
        var keyCounts = {};
        for (var t = 0; t < pkg.tags.length; t++) {
          var tagString = pkg.tags[t];
          var parsed;
          try {
            parsed = parseTag(tagString);
          } catch (e) {
            err("tags[" + t + "]", e.message);
            continue;
          }
          if (parsed.key === "zipbasedir") {
            warn("tags[" + t + "]", "Legacy tag 'zipbasedir' is superseded by install->extractmapping.");
          }
          var validator = KEY_VALIDATORS[parsed.key];
          if (!validator) {
            warn("tags[" + t + "]", "Unknown tag key '" + parsed.key + "', no CI validator exists (considered valid).");
          } else if (!validator(parsed.value)) {
            err("tags[" + t + "]", "Invalid value for tag key '" + parsed.key + "': " + parsed.value);
          }
          keyCounts[parsed.key] = (keyCounts[parsed.key] || 0) + 1;
        }
        for (var s = 0; s < SINGLE_KEYS.length; s++) {
          if ((keyCounts[SINGLE_KEYS[s]] || 0) > 1) {
            warn("tags", "Tag key '" + SINGLE_KEYS[s] + "' should appear at most once.");
          }
        }
      }
    }

    // files tree (warnings; CI does not validate 'files' yet)
    if ("files" in pkg && pkg.files !== undefined && pkg.files !== null) {
      if (typeof pkg.files !== "object" || Array.isArray(pkg.files)) {
        err("files", "'files' must be an object.");
      } else {
        validateFilesTree(pkg.files, "files", warn);
      }
    }

    // install (warnings)
    if ("install" in pkg && pkg.install !== undefined && pkg.install !== null) {
      if (typeof pkg.install !== "object" || Array.isArray(pkg.install)) {
        err("install", "'install' must be an object.");
      } else {
        if ("extractmapping" in pkg.install && pkg.install.extractmapping != null) {
          var mapping = pkg.install.extractmapping;
          if (typeof mapping !== "object" || Array.isArray(mapping)) {
            warn("install.extractmapping", "'extractmapping' must be an object.");
          } else {
            var mapKeys = Object.keys(mapping);
            for (var mk = 0; mk < mapKeys.length; mk++) {
              if (mapKeys[mk][0] !== "/") {
                warn("install.extractmapping", "Key should have a leading '/': " + mapKeys[mk]);
              }
              if (typeof mapping[mapKeys[mk]] !== "string" || mapping[mapKeys[mk]][0] !== "/") {
                warn("install.extractmapping", "Value for '" + mapKeys[mk] + "' should have a leading '/'.");
              }
            }
          }
        }
        if ("extract" in pkg.install) {
          warn("install.extract", "Legacy 'install->extract' is superseded by 'install->extractmapping'.");
        }
      }
    }

    return { errors: errors, warnings: warnings };
  }

  function validateFilesTree(files, path, warn) {
    var keys = Object.keys(files);
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      var entry = files[name];
      var entryPath = path + "[" + JSON.stringify(name) + "]";
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        warn(entryPath, "Entry must be an object.");
        continue;
      }
      var isDir = name.slice(-1) === "/";
      if (isDir && entry.bytes !== 0) {
        warn(entryPath + ".bytes", "Directory entries should have 'bytes': 0.");
      }
      if (!("bytes" in entry)) {
        warn(entryPath + ".bytes", "Missing 'bytes' value.");
      } else if (typeof entry.bytes !== "number" || entry.bytes < 0) {
        warn(entryPath + ".bytes", "Malformed 'bytes' value.");
      }
      if (!("sha256" in entry)) {
        warn(entryPath + ".sha256", "Missing 'sha256' value.");
      } else if (!isValidSha256(entry.sha256)) {
        warn(entryPath + ".sha256", "Malformed 'sha256' value.");
      } else if (isDir && entry.sha256 !== EMPTY_SHA256) {
        warn(entryPath + ".sha256", "Directory entries should use the empty-input sha256.");
      }
      if ("timestamp" in entry && entry.timestamp != null) {
        if (typeof entry.timestamp !== "string" || !ISO_TIMESTAMP.test(entry.timestamp)) {
          warn(entryPath + ".timestamp", "Timestamp should be ISO 'YYYY-MM-DDTHH:MM:SS.000Z'.");
        }
      }
      if ("files" in entry && entry.files != null) {
        if (typeof entry.files !== "object" || Array.isArray(entry.files)) {
          warn(entryPath + ".files", "'files' must be an object.");
        } else {
          validateFilesTree(entry.files, entryPath + ".files", warn);
        }
      }
    }
  }

  return {
    // generic
    isValidBytes: isValidBytes,
    isValidSha256: isValidSha256,
    isValidUrl: isValidUrl,
    isPrintablePlusSpace: isPrintablePlusSpace,
    isPrintableAsciiNoSpace: isPrintableAsciiNoSpace,
    // tag structure
    structurallyValidTag: structurallyValidTag,
    isValidKeyWithoutQualifiers: isValidKeyWithoutQualifiers,
    isValidQualifier: isValidQualifier,
    explodeTag: explodeTag,
    parseTag: parseTag,
    // per-key
    isValidAuthor: isValidAuthor,
    isValidFilenameAnywhere: isValidFilenameAnywhere,
    isValidGame: isValidGame,
    isValidGameMode: isValidGameMode,
    isValidType: isValidType,
    isValidTheme: isValidTheme,
    isValidStartmap: isValidStartmap,
    isValidTitle: isValidTitle,
    isValidAlternativeTitle: isValidAlternativeTitle,
    isValidReleaseDate: isValidReleaseDate,
    isValidCommandline: isValidCommandline,
    isValidLink: isValidLink,
    KEY_VALIDATORS: KEY_VALIDATORS,
    SINGLE_KEYS: SINGLE_KEYS,
    KNOWN_TOP_LEVEL_KEYS: KNOWN_TOP_LEVEL_KEYS,
    EMPTY_SHA256: EMPTY_SHA256,
    // package level
    validatePackage: validatePackage,
    validateFilesTree: validateFilesTree
  };
});
