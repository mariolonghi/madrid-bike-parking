#!/usr/bin/env bash
# Refresh the committed data snapshot from the Madrid open-data portal.
# Usage:  ./scripts/update-data.sh
# Then:   git add data/aparcabicis.json && git commit -m "data: refresh snapshot"
set -euo pipefail

# Resource 205099-3 is the dataset's JSON file (a flat array of records).
# NB: Madrid re-published this dataset on 2026-08-03, dropping the CKAN DataStore
# backing — the old /datastore/dump/205099-2?format=json endpoint now 404s. This
# stable resource-download URL serves the current file (no timestamped filename).
RESOURCE_ID="205099-3-aparca-bicis"
URL="https://datos.madrid.es/dataset/205099-0-aparca-bicis/resource/${RESOURCE_ID}/download"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${DIR}/data/aparcabicis.json"
TMP="$(mktemp)"

echo "Downloading ${URL}"
curl -fsSL "$URL" -o "$TMP"

# Compact the download into a display-only snapshot: keep ONLY the fields the app
# renders, stored column-wise ({fields, records:[[...]]}) so field names aren't
# repeated on every row. This keeps data/ small (~1/5 of the raw file) and git
# history lean. The raw download is discarded; normalizeRecords() reads this shape.
python3 - "$TMP" "$OUT" <<'PY'
import json, sys
src, out = sys.argv[1], sys.argv[2]
data = json.load(open(src))

# Normalise whatever Madrid serves into a list of dicts.
if isinstance(data, list):
    rows = data
elif data.get("records") and isinstance(data["records"][0], list):
    keys = [f["id"] for f in data.get("fields", [])]
    rows = [dict(zip(keys, rec)) for rec in data["records"]]
else:
    rows = data.get("records", [])

if len(rows) < 100:
    sys.exit(f"Refusing to overwrite: only {len(rows)} records (expected thousands).")

KEEP = ["ID", "COORD_GIS_X", "COORD_GIS_Y", "TIPO_VIA", "NOM_VIA", "NUM_VIA",
        "BARRIO", "DISTRITO", "MODELO", "FECHA_INSTALACION", "ESTADO", "COD_POSTAL"]
compact = {"fields": [{"id": f} for f in KEEP],
           "records": [[r.get(f) for f in KEEP] for r in rows]}
with open(out, "w", encoding="utf-8") as fh:
    json.dump(compact, fh, ensure_ascii=False, separators=(",", ":"))
print(f"Wrote {out} ({len(rows)} records, {len(KEEP)} fields).")
PY
rm -f "$TMP"
