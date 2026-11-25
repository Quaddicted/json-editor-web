import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, "js/browser-entry.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  outfile: path.join(here, "js/bundle.js"),
  alias: {
    fs: path.join(here, "js/shims/fs.js"),
    os: path.join(here, "js/shims/os.js"),
    zlib: path.join(here, "js/shims/zlib.js"),
    util: path.join(here, "js/shims/util.js"),
    stream: "readable-stream",
    events: "events",
    path: "path-browserify",
  },
  inject: [path.join(here, "js/shims/buffer-inject.js")],
  logLevel: "warning",
});

console.log("built js/bundle.js");
