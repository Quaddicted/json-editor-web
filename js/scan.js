(function (root, factory) {
  let deps;
  if (typeof module !== "undefined" && module.exports) {
    deps = { sha256: require("./sha256.js") };
  } else {
    deps = { sha256: root.Sha256 };
  }
  const api = factory(deps, root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Scan = api;
})(typeof self !== "undefined" ? self : globalThis, function (deps, root) {
  "use strict";

  const { hashBytes } = deps.sha256;

  const EMPTY_SHA256 =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const MAX_DEPTH = 4;
  const DEFAULT_MAX_ENTRIES = 200000;
  const DEFAULT_MAX_TOTAL_UNCOMPRESSED = 4 * 1024 * 1024 * 1024;

  const textDecoderLatin1 = new TextDecoder("latin1");

  class BudgetError extends Error {}

  function getStreamZip() {
    if (root.StreamZip) return root.StreamZip;
    if (typeof module !== "undefined" && module.exports) return require("node-stream-zip");
    throw new Error("node-stream-zip is not available (bundle js/browser-entry.js)");
  }

  let tmpCounter = 0;

  function openFdForBytes(bytes) {
    if (root.StreamZipFs) {
      const fd = root.StreamZipFs.register(bytes);
      return { fd, cleanup() { root.StreamZipFs.release(fd); } };
    }
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmp = path.join(os.tmpdir(), "fart-scan-" + process.pid + "-" + tmpCounter++ + ".bin");
    fs.writeFileSync(tmp, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const fd = fs.openSync(tmp, "r");
    return {
      fd,
      cleanup() {
        try { fs.closeSync(fd); } catch (e) {}
        try { fs.unlinkSync(tmp); } catch (e) {}
      },
    };
  }

  function makeReader(src) {
    if (src instanceof Uint8Array) {
      return {
        size: src.length,
        async read(off, len) {
          if (off >= src.length) return new Uint8Array(0);
          return src.subarray(off, Math.min(off + len, src.length));
        },
      };
    }
    if (src instanceof ArrayBuffer) return makeReader(new Uint8Array(src));
    if (typeof Blob !== "undefined" && src instanceof Blob) {
      return {
        size: src.size,
        async read(off, len) {
          if (off >= src.size) return new Uint8Array(0);
          return new Uint8Array(await src.slice(off, Math.min(off + len, src.size)).arrayBuffer());
        },
      };
    }
    throw new TypeError("Unsupported source: expected Blob, Uint8Array or ArrayBuffer");
  }

  function detectMagic(magic) {
    if (magic.length < 4) return null;
    if (magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04) return "zip";
    if (magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x05 && magic[3] === 0x06) return "zip";
    if (magic[0] === 0x50 && magic[1] === 0x41 && magic[2] === 0x43 && magic[3] === 0x4b) return "pak";
    return null;
  }

  function u16(b, off) {
    return b[off] | (b[off + 1] << 8);
  }

  function u32(b, off) {
    return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
  }

  function dosToIso(time, date) {
    if (!date) return null;
    const year = ((date >> 9) & 0x7f) + 1980;
    const month = (date >> 5) & 0x0f;
    const day = date & 0x1f;
    const hour = (time >> 11) & 0x1f;
    const min = (time >> 5) & 0x3f;
    const sec = (time & 0x1f) * 2;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const p = (n) => String(n).padStart(2, "0");
    return year + "-" + p(month) + "-" + p(day) + "T" + p(hour) + ":" + p(min) + ":" + p(sec) + ".000Z";
  }

  function isoFromMs(ms) {
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function makeBudget(opts) {
    return {
      entries: 0,
      total: 0,
      maxEntries: (opts && opts.maxEntries) || DEFAULT_MAX_ENTRIES,
      maxTotal: (opts && opts.maxTotalUncompressed) || DEFAULT_MAX_TOTAL_UNCOMPRESSED,
    };
  }

  function checkBudget(budget, uncompSize) {
    budget.entries++;
    budget.total += uncompSize;
    if (budget.entries > budget.maxEntries) {
      throw new BudgetError("Too many entries (max " + budget.maxEntries + ")");
    }
    if (budget.total > budget.maxTotal) {
      throw new BudgetError("Total uncompressed size exceeds budget (max " + budget.maxTotal + " bytes)");
    }
  }

  function insertEntry(files, path, entry) {
    files[path] = entry;
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") + "/";
      if (!(dir in files)) files[dir] = { bytes: 0, sha256: EMPTY_SHA256 };
    }
  }

  async function fillEntry(entry, data, uncompSize, name, errors, errPrefix, budget, depth) {
    checkBudget(budget, uncompSize);
    if (data.length !== uncompSize) {
      errors[errPrefix + name] = "Uncompressed size mismatch: header says " + uncompSize + ", got " + data.length;
      return false;
    }
    entry.bytes = uncompSize;
    entry.sha256 = await hashBytes(data);
    const kind = detectMagic(data.length >= 4 ? data.subarray(0, 4) : new Uint8Array(0));
    if (kind && depth < MAX_DEPTH) {
      const subFiles = {};
      const subErrors = {};
      try {
        await scanAny(data, kind, subFiles, subErrors, budget, depth + 1);
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        subErrors["(archive)"] = String((e && e.message) || e);
      }
      entry.files = subFiles;
      for (const k of Object.keys(subErrors)) {
        errors[errPrefix + name + "::" + k] = subErrors[k];
      }
    }
    return true;
  }

  async function scanZip(bytes, files, errors, budget, depth, errPrefix) {
    const StreamZip = getStreamZip();
    const { fd, cleanup } = openFdForBytes(bytes);
    let zip = null;
    try {
      zip = new StreamZip.async({ fd, storeEntries: true });
      let entries;
      try {
        entries = await zip.entries();
      } catch (e) {
        throw new Error("Could not read ZIP central directory: " + String((e && e.message) || e));
      }
      for (const rawName of Object.keys(entries)) {
        const meta = entries[rawName];
        const name = rawName.replace(/\\/g, "/");
        const entry = {};
        const ts = isoFromMs(meta.time);
        if (ts) entry.timestamp = ts;
        if (meta.isDirectory) {
          entry.bytes = 0;
          entry.sha256 = EMPTY_SHA256;
          insertEntry(files, name, entry);
          continue;
        }
        try {
          const data = new Uint8Array(await zip.entryData(meta));
          if (await fillEntry(entry, data, meta.size, name, errors, errPrefix, budget, depth)) {
            insertEntry(files, name, entry);
          }
        } catch (e) {
          if (e instanceof BudgetError) throw e;
          errors[errPrefix + name] = String((e && e.message) || e);
        }
      }
    } finally {
      try { if (zip) await zip.close(); } catch (e) {}
      cleanup();
    }
  }

  async function scanPak(bytes, files, errors, budget, depth, errPrefix) {
    const size = bytes.length;
    if (size < 12) throw new Error("File too small to be a PAK archive");
    if (textDecoderLatin1.decode(bytes.subarray(0, 4)) !== "PACK") throw new Error("Bad PAK signature");
    const dirOfs = u32(bytes, 4);
    const dirLen = u32(bytes, 8);
    if (dirLen % 64 !== 0) throw new Error("PAK directory length is not a multiple of 64");
    if (dirOfs + dirLen > size) throw new Error("PAK directory out of bounds");
    const count = dirLen / 64;
    for (let i = 0; i < count; i++) {
      const ent = bytes.subarray(dirOfs + i * 64, dirOfs + i * 64 + 64);
      if (ent.length < 64) throw new Error("Truncated PAK directory entry");
      let nameLen = 0;
      while (nameLen < 56 && ent[nameLen] !== 0) nameLen++;
      const name = textDecoderLatin1.decode(ent.subarray(0, nameLen)).replace(/\\/g, "/");
      const filePos = u32(ent, 56);
      const fileLen = u32(ent, 60);
      if (!name) continue;
      const entry = {};
      if (name.endsWith("/")) {
        entry.bytes = 0;
        entry.sha256 = EMPTY_SHA256;
        insertEntry(files, name, entry);
        continue;
      }
      try {
        if (filePos + fileLen > size) {
          errors[errPrefix + name] = "File data out of bounds";
          continue;
        }
        const data = bytes.subarray(filePos, filePos + fileLen);
        if (await fillEntry(entry, data, fileLen, name, errors, errPrefix, budget, depth)) {
          insertEntry(files, name, entry);
        }
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        errors[errPrefix + name] = String((e && e.message) || e);
      }
    }
  }

  async function scanAny(bytes, kind, files, errors, budget, depth) {
    if (kind === "zip") await scanZip(bytes, files, errors, budget, depth, "");
    else if (kind === "pak") await scanPak(bytes, files, errors, budget, depth, "");
  }

  async function scanArchive(src, opts) {
    const reader = makeReader(src);
    const magic = await reader.read(0, 4);
    const kind = detectMagic(magic);
    if (!kind) return { kind: null, files: {}, errors: {} };
    const bytes = await reader.read(0, reader.size);
    const budget = makeBudget(opts);
    const files = {};
    const errors = {};
    try {
      await scanAny(bytes, kind, files, errors, budget, 0);
    } catch (e) {
      if (e instanceof BudgetError) {
        errors["(archive)"] = e.message;
      } else {
        throw e;
      }
    }
    return { kind, files, errors };
  }

  return {
    EMPTY_SHA256,
    MAX_DEPTH,
    makeReader,
    detectMagic,
    dosToIso,
    insertEntry,
    scanArchive,
    scanZip,
    scanPak,
    BudgetError,
  };
});
