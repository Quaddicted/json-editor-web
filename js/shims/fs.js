"use strict";

const registry = new Map();
let nextFd = 1000;

function register(bytes) {
  const fd = nextFd++;
  registry.set(fd, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return fd;
}

function release(fd) {
  registry.delete(fd);
}

function fail(cb, code) {
  const e = new Error(code);
  e.code = code;
  if (cb) queueMicrotask(() => cb(e));
  else throw e;
}

module.exports = {
  register,
  release,
  open(_path, _mode, cb) {
    fail(cb, "ENOENT");
  },
  fstat(fd, cb) {
    const d = registry.get(fd);
    if (!d) return fail(cb, "EBADF");
    queueMicrotask(() => cb(null, { size: d.length }));
  },
  read(fd, buffer, offset, length, position, cb) {
    const d = registry.get(fd);
    if (!d) return fail(cb, "EBADF");
    const pos = position == null ? 0 : position;
    const n = Math.max(0, Math.min(length, d.length - pos));
    for (let i = 0; i < n; i++) buffer[offset + i] = d[pos + i];
    queueMicrotask(() => cb(null, n, buffer));
  },
  readSync(fd, buffer, offset, length, position) {
    const d = registry.get(fd);
    if (!d) {
      const e = new Error("EBADF");
      e.code = "EBADF";
      throw e;
    }
    const pos = position == null ? 0 : position;
    const n = Math.max(0, Math.min(length, d.length - pos));
    for (let i = 0; i < n; i++) buffer[offset + i] = d[pos + i];
    return n;
  },
  close(fd, cb) {
    registry.delete(fd);
    if (cb) queueMicrotask(() => cb(null));
  },
  createWriteStream() {
    throw new Error("fs.createWriteStream is not supported in the browser bundle");
  },
  mkdir(_p, _opts, cb) {
    if (cb) queueMicrotask(() => cb(null));
  },
  stat(_p, cb) {
    fail(cb, "ENOENT");
  },
};
