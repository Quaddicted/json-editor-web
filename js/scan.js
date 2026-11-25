/*!
 * Archive scanning for Quaddicted-style package "files" maps.
 * Supports zip (stored + deflate, nested zips and paks) and Quake pak.
 * Mirrors quaddicted_tools.file_inspection (files_in_zip / files_in_pak).
 * Hashing uses the platform Web Crypto API (crypto.subtle), so the page
 * must be served in a secure context (https:// or localhost).
 * UMD: window.Scan or module.exports.
 */
(function (root, factory) {
  var pako;
  if (typeof module === "object" && module.exports) {
    pako = require("./vendor/pako_inflate.min.js");
    module.exports = factory(pako);
  } else {
    pako = root.pako;
    root.Scan = factory(pako);
  }
})(typeof self !== "undefined" ? self : this, function (pako) {
  "use strict";

  var EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  var JSON_VERSION = "2025.09.27";

  function u16(bytes, off) {
    return bytes[off] | (bytes[off + 1] << 8);
  }
  function u32(bytes, off) {
    return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16)) + bytes[off + 3] * 0x1000000;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function pad4(n) {
    return ("000" + n).slice(-4);
  }

  function dosToIso(dosTime, dosDate) {
    var second = (dosTime & 0x1f) * 2;
    var minute = (dosTime >> 5) & 0x3f;
    var hour = (dosTime >> 11) & 0x1f;
    var day = dosDate & 0x1f;
    var month = (dosDate >> 5) & 0x0f;
    var year = 1980 + ((dosDate >> 9) & 0x7f);
    return pad4(year) + "-" + pad2(month) + "-" + pad2(day) +
      "T" + pad2(hour) + ":" + pad2(minute) + ":" + pad2(second) + ".000Z";
  }

  function utf8Decode(bytes) {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
      var s = "";
      for (var i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i]);
      }
      return s;
    }
  }

  function inflateRaw(data) {
    var out = pako.inflateRaw(data);
    if (out && out.buffer) {
      return new Uint8Array(out);
    }
    return out;
  }

  function webCrypto() {
    var c = (typeof self !== "undefined" && self.crypto) ? self.crypto : globalThis.crypto;
    if (!c || !c.subtle) {
      throw new Error("Web Crypto (crypto.subtle) is not available; serve the page over https:// or localhost.");
    }
    return c;
  }

  async function sha256Hex(bytes) {
    var digest = await webCrypto().subtle.digest("SHA-256", bytes);
    var arr = new Uint8Array(digest);
    var out = "";
    for (var i = 0; i < arr.length; i++) {
      out += ("0" + arr[i].toString(16)).slice(-2);
    }
    return out;
  }

  // zip #####################################################################

  function findEocd(bytes) {
    // Candidates are validated instead of blindly trusting the first
    // "end of central directory" signature, so a fake signature inside an
    // archive comment or in trailing garbage cannot derail the parse.
    var minOffset = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= minOffset; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        if (i + 22 > bytes.length) {
          continue;
        }
        // exact match: EOCD plus its declared comment length reaches EOF
        if (i + 22 + u16(bytes, i + 20) === bytes.length) {
          return i;
        }
        // otherwise the referenced central-directory offset must be plausible
        var cdOffset = u32(bytes, i + 16);
        if (u32(bytes, cdOffset) === 0x02014b50) {
          return i;
        }
      }
    }
    throw new Error("Bad zip file: end of central directory not found.");
  }

  async function zipFiles(bytes, displayPath, errors) {
    var eocd = findEocd(bytes);
    var count = u16(bytes, eocd + 10);
    var cdOffset = u32(bytes, eocd + 16);
    var files = {};

    var off = cdOffset;
    for (var i = 0; i < count; i++) {
      if (u32(bytes, off) !== 0x02014b50) {
        throw new Error("Bad zip file: central directory signature mismatch.");
      }
      var method = u16(bytes, off + 10);
      var dosTime = u16(bytes, off + 12);
      var dosDate = u16(bytes, off + 14);
      var compSize = u32(bytes, off + 20);
      var uncompSize = u32(bytes, off + 24);
      var nameLen = u16(bytes, off + 28);
      var extraLen = u16(bytes, off + 30);
      var commentLen = u16(bytes, off + 32);
      var localOffset = u32(bytes, off + 42);
      var name = utf8Decode(bytes.subarray(off + 46, off + 46 + nameLen));

      var entry = {};
      entry.bytes = uncompSize;
      entry.timestamp = dosToIso(dosTime, dosDate);

      var content = null;
      if (u32(bytes, localOffset) !== 0x04034b50) {
        throw new Error("Bad zip file: local header signature mismatch at offset " + localOffset + ".");
      }
      var lNameLen = u16(bytes, localOffset + 26);
      var lExtraLen = u16(bytes, localOffset + 28);
      var dataStart = localOffset + 30 + lNameLen + lExtraLen;
      var raw = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        content = raw;
      } else if (method === 8) {
        try {
          content = inflateRaw(raw);
        } catch (e) {
          errors[displayPath + "/" + name] = "deflate error: " + (e && e.message ? e.message : String(e));
        }
      } else {
        errors[displayPath + "/" + name] = "unsupported compression method " + method;
      }

      if (content !== null && content !== undefined) {
        entry.sha256 = await sha256Hex(content);
        var lower = name.toLowerCase();
        if (lower.slice(-4) === ".zip") {
          try {
            entry.files = await zipFiles(content, displayPath + "/" + name, errors);
          } catch (e) {
            errors[displayPath + "/" + name] = "bad zip: " + (e && e.message ? e.message : String(e));
          }
        } else if (lower.slice(-4) === ".pak") {
          try {
            entry.files = await pakFiles(content, displayPath + "/" + name, errors);
          } catch (e) {
            errors[displayPath + "/" + name] = "bad pak: " + (e && e.message ? e.message : String(e));
          }
        }
      }

      files[name] = entry;
      off += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  // pak #####################################################################

  async function pakFiles(bytes, displayPath, errors) {
    if (bytes.length < 12 || utf8Decode(bytes.subarray(0, 4)) !== "PACK") {
      throw new Error("Bad pak file: missing PACK header.");
    }
    var dirOffset = u32(bytes, 4);
    var dirLength = u32(bytes, 8);
    if (dirLength % 64 !== 0) {
      throw new Error("Bad pak file: directory length not a multiple of 64.");
    }
    var count = dirLength / 64;
    var files = {};
    for (var i = 0; i < count; i++) {
      var entryOff = dirOffset + i * 64;
      if (entryOff + 64 > bytes.length) {
        throw new Error("Bad pak file: directory out of bounds.");
      }
      var nameBytes = bytes.subarray(entryOff, entryOff + 56);
      var name = "";
      for (var n = 0; n < 56 && nameBytes[n] !== 0; n++) {
        name += String.fromCharCode(nameBytes[n]);
      }
      var offset = u32(bytes, entryOff + 56);
      var size = u32(bytes, entryOff + 60);
      if (offset + size > bytes.length) {
        throw new Error("Bad pak file: entry data out of bounds.");
      }
      var content = bytes.subarray(offset, offset + size);
      var entry = {};
      entry.bytes = size;
      entry.sha256 = await sha256Hex(content);
      files[name] = entry;
    }
    return files;
  }

  // public API ##############################################################

  function toBytes(data) {
    if (data instanceof Uint8Array) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (data && typeof data.length === "number" && typeof data !== "string") {
      return new Uint8Array(data);
    }
    if (data && data.byteLength !== undefined && data.byteLength !== null) {
      return new Uint8Array(data);
    }
    throw new Error("scanArchive expects a Blob, Uint8Array, ArrayBuffer or array of bytes");
  }

  async function scanArchive(data) {
    var bytes;
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      bytes = new Uint8Array(await data.arrayBuffer());
    } else {
      bytes = toBytes(data);
    }
    var errors = {};
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
        (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
      try {
        return { kind: "zip", files: await zipFiles(bytes, "", errors), errors: errors };
      } catch (e) {
        errors[""] = e && e.message ? e.message : String(e);
        return { kind: null, files: null, errors: errors };
      }
    }
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x41 && bytes[2] === 0x43 && bytes[3] === 0x4b) {
      try {
        return { kind: "pak", files: await pakFiles(bytes, "", errors), errors: errors };
      } catch (e) {
        errors[""] = e && e.message ? e.message : String(e);
        return { kind: null, files: null, errors: errors };
      }
    }
    return { kind: null, files: null, errors: errors };
  }

  function buildNewPackage(info) {
    var pkg = {
      bytes: info.bytes,
      json_version: JSON_VERSION,
      sha256: info.sha256,
      tags: ["filename=" + info.filename],
      urls: [
        "https://www.quaddicted.com/files/by-sha256/" +
          info.sha256.slice(0, 2) + "/" + info.sha256 + "/" + info.filename
      ]
    };
    if (info.files) {
      pkg.files = info.files;
    }
    return pkg;
  }

  return {
    scanArchive: scanArchive,
    buildNewPackage: buildNewPackage,
    dosToIso: dosToIso,
    sha256Hex: sha256Hex,
    EMPTY_SHA256: EMPTY_SHA256,
    JSON_VERSION: JSON_VERSION
  };
});
