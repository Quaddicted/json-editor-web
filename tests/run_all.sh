#!/bin/sh
# Runs the full test suite. Needs node >= 18 and python3.
set -e
cd "$(dirname "$0")/.."

echo "== regenerating fixtures =="
python3 tests/make_fixtures.py

for t in test_serialize test_validate test_scan test_github test_pipeline test_ui_smoke test_ids; do
  echo ""
  echo "== $t =="
  node "tests/$t.js"
done

echo ""
echo "All tests passed."
