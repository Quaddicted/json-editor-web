# quaddicted-data web editor

A single-page, fully client-side web app to **create and edit JSON package files** for
[`Quaddicted/quaddicted-data`](https://github.com/Quaddicted/quaddicted-data) — the data behind
[quaddicted.com](https://www.quaddicted.com). See the wiki pages "The JSON format", "Tags" and
"WIP: Installation-extraction-instructions" for the format this editor targets.

## Run it

No server-side state. The app is bundled with esbuild; ZIP handling uses
[node-stream-zip](https://www.npmjs.com/package/node-stream-zip), bundled for the browser
with small Node-builtin shims (`js/shims/`):

```sh
npm install
npm run build            # writes js/bundle.js (gitignored)
python3 -m http.server   # then open http://localhost:8000/
```

`index.html` loads the single generated `js/bundle.js`. Drafts and the optional GitHub
token live **only in `localStorage`** of your browser.

## What it does

- **New from file**: pick a `.zip`/`.pak` (or any file). The file is hashed (SHA-256 via the
  Web Crypto API, `crypto.subtle.digest`, with a pure-JS fallback), scanned (ZIP via
  `node-stream-zip`, PAK via a small built-in parser, nested archives recursed up to depth 4 with
  entry/size budgets), and turned into a package skeleton:
  `{bytes, files?, json_version: "2025.09.27", sha256, tags: [filename=...], urls: [by-sha256 URL]}`.
  `json_version` is prefilled only for brand-new packages and is never auto-changed when editing.
- **Open by sha256**: fetches `json/by-sha256/<xx>/<sha>.json` from the upstream repo
  (`raw.githubusercontent.com`) and loads it for editing.
- **Open JSON file / paste JSON**: load an existing package file.
- **quaddicted API metadata**: when a file is loaded (and via the "Reload metadata from quaddicted API"
  button), the editor queries the [Quaddicted API v1](https://discuss.quaddicted.com/t/the-quaddicted-api-v1/8136)
  (`https://www.quaddicted.com/api/v1/?q=+sha256:<sha>&fl=sha256,tags,urls,notes,bytes,description,install` —
  one or no result) and fills in any fields the package is missing (tags incl. title/authors/game,
  urls, description, notes, install, bytes) — existing values are never overwritten. Requires CORS
  enabled on quaddicted.com for the API; there is no fallback source.
- **Collapsible lists/mappings**: the tags, urls, files tree (incl. nested archives), extractmapping
  and notes lists are `<details>` blocks the user can collapse/expand. Empty `install.extract`,
  `install.extractmapping` and `install` are pruned automatically, so no empty install section is
  ever written to the JSON.
- **Form editor** with sections for package fields, tags (with known-key datalist, quick-add and
  per-row parse hints), URLs (incl. one-click by-sha256 / filebase URLs), the recursive `files`
  tree (bytes/sha256/timestamp per entry, add file/dir, delete, scan an uploaded archive into it),
  `install.extractmapping` (+ legacy `install.extract`) and notes. A raw JSON textarea stays in
  two-way sync with the form (400 ms debounce).
- **Live validation** mirroring the CI (`Quaddicted/tools` `validate_dir_of_jsons.py`): required
  `bytes`/`sha256`, unknown top-level keys, URL shape (urlparse-style), tag structure and per-key
  value validators, path↔sha256 match, `files` tree sanity, legacy warnings, tag cardinality and
  sorting conventions. Export (download `<sha256>.json`, copy) and the PR button are enabled only
  when there are no errors and `sha256` is well-formed.
- **Create a pull request** against `Quaddicted/quaddicted-data` with a GitHub PAT: forks your
  account if needed, creates a branch, commits the canonical JSON, and opens the PR (or reuses an
  existing open one). Classic PAT with `repo` scope, or fine-grained PAT with Contents:write and
  Pull requests:write. The token is stored only in `localStorage` and can be forgotten with one click.

## Canonical JSON format

Exactly Python `json.dump(obj, f, indent=1, sort_keys=True)` + a single trailing newline:
1-space indent, keys sorted by Unicode code point, `ensure_ascii` escaping (lowercase `\uXXXX`,
surrogate pairs for astral characters, short forms `\b \f \n \r \t`), object names always quoted.
The top-level `tags` array is additionally sorted by code point (repo convention). The serializer is
verified byte-for-byte against real `json.dump` in the tests.

## Files

```
index.html        single page; CSP meta; loads the generated js/bundle.js
style.css
js/sha256.js      SHA-256 via WebCrypto: getChecksumSha256(blob) = blob.arrayBuffer() + crypto.subtle.digest("SHA-256") + Array.from(...).map(h => h.toString(16).padStart(2,"0")).join(""); pure-JS class only as fallback when WebCrypto is unavailable
js/serialize.js   python-exact canonical serializer; compareCodePoints; escapeString
js/tagdata.js     known tags/keys metadata for the UI
js/validate.js    port of the CI validators (Quaddicted/tools)
js/scan.js        archive scanner: ZIP via node-stream-zip, PAK parser, magic sniff, nested archives, budgets
js/github.js      PAT-based fork/branch/commit/PR flow against api.github.com
js/app.js         UI: state, form<->raw sync, renderers, draft, export, PR panel
js/browser-entry.js  esbuild entry point (js/bundle.js is the generated bundle, gitignored)
js/shims/         browser shims for the Node builtins node-stream-zip uses (fs over in-memory bytes, zlib via pako, util, os)
build.mjs         esbuild build script (`npm run build`)
package.json      dependencies: node-stream-zip (+ pako/readable-stream/events/path-browserify/buffer for the browser bundle); devDependency: esbuild
tests/            node test suite + python fixture generator; run: sh tests/run_all.sh
```

All modules are UMD: browser globals (`window.Sha256`, `window.Serialize`, `window.TagData`,
`window.Validate`, `window.Scan`, `window.Github`) and `module.exports` for the Node tests.

Security notes: the CSP (`default-src 'self'`; `connect-src` limited to `raw.githubusercontent.com`,
`api.github.com` and `www.quaddicted.com`) forbids inline scripts/styles; all data is rendered via
`textContent` only, never `innerHTML`; links are only created for `github.com`/`quaddicted.com` URLs
with `rel="noopener noreferrer"`.

## Tests

Requires node ≥ 18, python3 and npm:

```sh
sh tests/run_all.sh   # npm install + build + fixtures + all test files
```

Covers NIST SHA-256 vectors + `sha256sum` parity, serializer byte-parity vs `python3 json.dump` on
fixtures (unicode/astral/control chars, key-sort edge cases, numbers, tags), validator cases ported
from `Quaddicted/tools` tests plus package-level checks, ZIP/PAK scanning vs Python-built fixtures
(byte-for-byte), corrupt-input handling, the full new-from-file pipeline vs a Python-produced
expected package, the GitHub PR helpers, a DOM-shim UI smoke test, a test that boots the actual
esbuild bundle (js/bundle.js) and scans fixtures through the bundled node-stream-zip + shims
byte-for-byte, and an ids/scripts consistency check between `app.js` and `index.html`.
