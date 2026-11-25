#!/bin/sh
set -e
cd "$(dirname "$0")/.."
if [ ! -d node_modules/esbuild ] || [ ! -d node_modules/node-stream-zip ]; then
  npm install --no-audit --no-fund
fi
echo "== build =="
node build.mjs
cd tests
echo "== generating fixtures =="
python3 make_fixtures.py
echo "== test_sha256_serialize =="
node test_sha256_serialize.js
echo "== test_validate =="
node test_validate.js
echo "== test_scan =="
node test_scan.js
echo "== test_bundle =="
node test_bundle.js
echo "== test_github =="
node test_github.js
echo "== test_pipeline =="
node test_pipeline.js
echo "== test_ui_smoke =="
node test_ui_smoke.js
echo "== test_ids =="
node test_ids.js
echo "ALL TESTS PASSED"
