"use strict";

const { Transform } = require("readable-stream");
const pako = require("pako");

function createInflateRaw() {
  const inf = new pako.Inflate({ raw: true });
  const pending = [];
  inf.onData = (chunk) => pending.push(chunk);
  const drain = (self) => {
    const out = pending.splice(0, pending.length);
    for (const c of out) self.push(c);
  };
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        inf.push(chunk, pako.Z_NO_FLUSH);
        drain(this);
        cb();
      } catch (e) {
        cb(e);
      }
    },
    flush(cb) {
      try {
        inf.push(new Uint8Array(0), pako.Z_FINISH);
        drain(this);
        cb();
      } catch (e) {
        cb(e);
      }
    },
  });
}

function inflateRawSync(data) {
  return pako.inflateRaw(data);
}

module.exports = {
  createInflateRaw,
  inflateRawSync,
  constants: { Z_NO_FLUSH: pako.Z_NO_FLUSH, Z_FINISH: pako.Z_FINISH },
};
