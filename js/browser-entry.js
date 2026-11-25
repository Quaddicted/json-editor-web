"use strict";

const root = typeof self !== "undefined" ? self : globalThis;

root.StreamZip = require("node-stream-zip");
const fsShim = require("./shims/fs.js");
root.StreamZipFs = { register: fsShim.register, release: fsShim.release };

require("./sha256.js");
require("./serialize.js");
require("./tagdata.js");
require("./validate.js");
require("./scan.js");
require("./github.js");
require("./app.js");
