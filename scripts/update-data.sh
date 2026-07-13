#!/usr/bin/env bash
# Refresh the committed data snapshot from the Madrid open-data portal.
# Usage:  ./scripts/update-data.sh
# Then:   git add data/aparcabicis.json && git commit -m "data: refresh snapshot"
set -euo pipefail

RESOURCE_ID="205099-2-aparca-bicis"
URL="https://datos.madrid.es/datastore/dump/${RESOURCE_ID}?format=json"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${DIR}/data/aparcabicis.json"
TMP="$(mktemp)"

echo "Downloading ${URL}"
curl -fsSL "$URL" -o "$TMP"

# Sanity check: must be valid JSON with a non-empty records array.
COUNT=$(python3 -c "import json,sys; d=json.load(open('$TMP')); print(len(d['records']))")
if [ "$COUNT" -lt 100 ]; then
  echo "Refusing to overwrite: only ${COUNT} records downloaded (expected thousands)." >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$OUT"
echo "Wrote ${OUT} (${COUNT} records)."
