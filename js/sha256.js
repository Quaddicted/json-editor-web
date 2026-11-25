(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Sha256 = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  const W = new Uint32Array(64);

  class Sha256 {
    constructor() {
      this.h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
      ]);
      this.buf = new Uint8Array(64);
      this.bufLen = 0;
      this.totalLen = 0;
    }

    update(data) {
      if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
      this.totalLen += data.length;
      let off = 0;
      if (this.bufLen > 0) {
        const take = Math.min(64 - this.bufLen, data.length);
        this.buf.set(data.subarray(0, take), this.bufLen);
        this.bufLen += take;
        off += take;
        if (this.bufLen === 64) {
          this._block(this.h, this.buf, 0);
          this.bufLen = 0;
        }
      }
      while (off + 64 <= data.length) {
        this._block(this.h, data, off);
        off += 64;
      }
      if (off < data.length) {
        this.buf.set(data.subarray(off), 0);
        this.bufLen = data.length - off;
      }
      return this;
    }

    _block(state, data, off) {
      for (let t = 0; t < 16; t++) {
        const i = off + 4 * t;
        W[t] = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
      }
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      let a = state[0], b = state[1], c = state[2], d = state[3];
      let e = state[4], f = state[5], g = state[6], h = state[7];
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      state[0] = (state[0] + a) >>> 0;
      state[1] = (state[1] + b) >>> 0;
      state[2] = (state[2] + c) >>> 0;
      state[3] = (state[3] + d) >>> 0;
      state[4] = (state[4] + e) >>> 0;
      state[5] = (state[5] + f) >>> 0;
      state[6] = (state[6] + g) >>> 0;
      state[7] = (state[7] + h) >>> 0;
    }

    digestHex() {
      const state = new Uint32Array(this.h);
      const buf = new Uint8Array(64);
      buf.set(this.buf.subarray(0, this.bufLen), 0);
      let len = this.bufLen;
      buf[len++] = 0x80;
      if (len > 56) {
        buf.fill(0, len, 64);
        this._block(state, buf, 0);
        len = 0;
      }
      buf.fill(0, len, 56);
      const bitLen = this.totalLen * 8;
      const hi = Math.floor(bitLen / 0x100000000);
      const lo = bitLen % 0x100000000;
      buf[56] = (hi >>> 24) & 0xff;
      buf[57] = (hi >>> 16) & 0xff;
      buf[58] = (hi >>> 8) & 0xff;
      buf[59] = hi & 0xff;
      buf[60] = (lo >>> 24) & 0xff;
      buf[61] = (lo >>> 16) & 0xff;
      buf[62] = (lo >>> 8) & 0xff;
      buf[63] = lo & 0xff;
      this._block(state, buf, 0);
      let out = "";
      for (let i = 0; i < 8; i++) out += state[i].toString(16).padStart(8, "0");
      return out;
    }
  }

  function subtle() {
    if (typeof crypto !== "undefined" && crypto.subtle) return crypto.subtle;
    if (root.crypto && root.crypto.subtle) return root.crypto.subtle;
    return null;
  }

  function toHex(hashBuffer) {
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((h) => h.toString(16).padStart(2, "0")).join("");
  }

  async function getChecksumSha256(blob) {
    const uint8Array = new Uint8Array(await blob.arrayBuffer());
    const hashBuffer = await crypto.subtle.digest("SHA-256", uint8Array);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((h) => h.toString(16).padStart(2, "0")).join("");
  }

  async function hashBytes(data) {
    const s = subtle();
    if (s) {
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      return toHex(await s.digest("SHA-256", u8));
    }
    return new Sha256().update(data).digestHex();
  }

  async function hashBlob(blob, onProgress) {
    if (subtle()) return getChecksumSha256(blob);
    const sha = new Sha256();
    const reader = blob.stream().getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sha.update(value);
      received += value.length;
      if (onProgress) onProgress(received, blob.size);
    }
    return sha.digestHex();
  }

  return { Sha256, hashBytes, hashBlob, getChecksumSha256, toHex };
});
