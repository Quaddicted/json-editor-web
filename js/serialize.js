(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Serialize = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  function escapeString(s) {
    let out = '"';
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (ch === '"') { out += '\\"'; continue; }
      if (ch === "\\") { out += "\\\\"; continue; }
      if (ch === "\b") { out += "\\b"; continue; }
      if (ch === "\f") { out += "\\f"; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      if (cp < 0x20) {
        out += "\\u" + cp.toString(16).padStart(4, "0");
      } else if (cp <= 0x7e) {
        out += ch;
      } else if (cp < 0x10000) {
        out += "\\u" + cp.toString(16).padStart(4, "0");
      } else {
        const n = cp - 0x10000;
        const s1 = 0xd800 + (n >> 10);
        const s2 = 0xdc00 + (n & 0x3ff);
        out += "\\u" + s1.toString(16).padStart(4, "0") + "\\u" + s2.toString(16).padStart(4, "0");
      }
    }
    return out + '"';
  }

  function compareCodePoints(a, b) {
    const A = Array.from(a);
    const B = Array.from(b);
    const n = Math.min(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const ca = A[i].codePointAt(0);
      const cb = B[i].codePointAt(0);
      if (ca !== cb) return ca < cb ? -1 : 1;
    }
    return A.length - B.length;
  }

  function serializeNumber(n) {
    if (!Number.isFinite(n)) return n > 0 ? "Infinity" : n < 0 ? "-Infinity" : "NaN";
    if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
    return JSON.stringify(n);
  }

  function serializeValue(v, level, indent) {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "boolean") return v ? "true" : "false";
    if (t === "number") return serializeNumber(v);
    if (t === "string") return escapeString(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      const pad = indent.repeat(level + 1);
      const items = v.map((x) => pad + serializeValue(x, level + 1, indent));
      return "[\n" + items.join(",\n") + "\n" + indent.repeat(level) + "]";
    }
    if (t === "object") {
      const keys = Object.keys(v).sort(compareCodePoints);
      if (keys.length === 0) return "{}";
      const pad = indent.repeat(level + 1);
      const items = keys.map(
        (k) => pad + escapeString(k) + ": " + serializeValue(v[k], level + 1, indent)
      );
      return "{\n" + items.join(",\n") + "\n" + indent.repeat(level) + "}";
    }
    throw new TypeError("Cannot serialize value of type " + t);
  }

  function serializeCanonical(obj, opts) {
    const o = opts || {};
    const indent = " ";
    let rootObj = obj;
    if (
      o.sortTags &&
      obj !== null &&
      typeof obj === "object" &&
      !Array.isArray(obj) &&
      Array.isArray(obj.tags)
    ) {
      rootObj = Object.assign({}, obj);
      rootObj.tags = obj.tags.slice().sort(compareCodePoints);
    }
    return serializeValue(rootObj, 0, indent) + "\n";
  }

  return { serializeCanonical, compareCodePoints, escapeString, serializeValue };
});
