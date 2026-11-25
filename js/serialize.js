/*!
 * Canonical JSON serializer matching Python's
 *   json.dump(obj, f, indent=1, sort_keys=True, ensure_ascii=False)
 * plus a trailing newline, as used by Quaddicted/quaddicted-data.
 * UMD: window.Serialize or module.exports.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Serialize = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function indentStr(level) {
    var out = "";
    for (var i = 0; i < level; i++) {
      out += " ";
    }
    return out;
  }

  function escapeString(s) {
    return JSON.stringify(s);
  }

  function serializeValue(value, level) {
    if (value === null) {
      return "null";
    }
    var t = typeof value;
    if (t === "boolean" || t === "number" || t === "string") {
      return JSON.stringify(value);
    }
    if (t === "undefined") {
      return "null";
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "[]";
      }
      var items = [];
      for (var i = 0; i < value.length; i++) {
        items.push(indentStr(level + 1) + serializeValue(value[i], level + 1));
      }
      return "[\n" + items.join(",\n") + "\n" + indentStr(level) + "]";
    }
    if (t === "object") {
      var keys = Object.keys(value).sort();
      if (keys.length === 0) {
        return "{}";
      }
      var entries = [];
      for (var k = 0; k < keys.length; k++) {
        entries.push(
          indentStr(level + 1) + escapeString(keys[k]) + ": " +
          serializeValue(value[keys[k]], level + 1)
        );
      }
      return "{\n" + entries.join(",\n") + "\n" + indentStr(level) + "}";
    }
    throw new Error("Cannot serialize value of type " + t);
  }

  function serializeCanonical(obj, opts) {
    var options = opts || {};
    var sortTags = options.sortTags !== false;
    var work = obj;
    if (sortTags && obj && Array.isArray(obj.tags)) {
      work = {};
      var keys = Object.keys(obj);
      for (var i = 0; i < keys.length; i++) {
        work[keys[i]] = obj[keys[i]];
      }
      work.tags = obj.tags.slice().sort();
    }
    return serializeValue(work, 0) + "\n";
  }

  return {
    serializeCanonical: serializeCanonical,
    serializeValue: serializeValue,
    escapeString: escapeString
  };
});
