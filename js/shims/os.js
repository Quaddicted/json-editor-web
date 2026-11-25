"use strict";

module.exports = {
  tmpdir() {
    throw new Error("os.tmpdir is not available in the browser bundle");
  },
};
