# 🚲 Aparcabicis de Madrid — mapa interactivo

Interactive map of Madrid's **municipal on-street bike-parking racks** (*aparcabicicletas*),
built on the city's open-data feed. Pure static site — no backend, no build step — so it can
be served from any static host.

**Live demo:** <https://madrid-bike-parking.mariolonghi.workers.dev/>

![Map of Madrid's bike-parking racks with clustering, filters and a synced results list](docs/preview.png)

## Features

- Interactive Leaflet map with marker **clustering** (7 000+ points stay readable).
- **Two data sources, toggleable at runtime:**
  - **Repository file** — a snapshot committed to `data/`, refreshed manually.
  - **Live API** — queried directly from `datos.madrid.es` in the browser.
- Filter by **district** and free-text **search** (address / neighbourhood).
- Accessible companion **list** synced to the current filter, keyboard support, skip link,
  light/dark themes, responsive layout.
- Coordinates converted on the fly from **ETRS89 UTM zone 30N → WGS84** (the source data has
  no populated lat/lon), so both data sources render identically.

## Architecture

The simplest thing that works: three static files (`index.html`, `app.js`, `style.css`) plus a
data snapshot. Leaflet is loaded from a CDN. Everything runs client-side.

```
index.html            markup + CDN links
app.js                data loading, UTM→WGS84 conversion, map, filters
style.css             styling (light/dark, responsive, a11y)
data/aparcabicis.json committed snapshot (Madrid datastore dump, JSON)
scripts/update-data.sh reproducible data refresh
```

No server is required because the Madrid API sends `Access-Control-Allow-Origin: *`, so the
browser can fetch it cross-origin, and the whole dataset (~7 400 rows) comes back in a single
request.

## Updating the committed data

The repository ships a snapshot of the dataset at **`data/aparcabicis.json`**. The file must be
in **JSON** format — the app parses JSON natively and uses the same code path for the file and
the live API.

A scheduled GitHub Action (`.github/workflows/refresh-data.yml`) refreshes this snapshot
automatically every Monday (and can be run on demand from the **Actions** tab), committing only
when the data actually changed. You can also refresh it yourself:

**Option A — script (recommended):**

```bash
./scripts/update-data.sh                     # downloads + validates the latest JSON
git add data/aparcabicis.json
git commit -m "data: refresh snapshot"
git push                                     # Cloudflare Pages redeploys automatically
```

The script downloads the latest dump, checks it is valid JSON with a sane row count, and only
then overwrites `data/aparcabicis.json`.

**Option B — by hand:**

1. Open the dataset page: <https://datos.madrid.es/dataset/205099-0-aparca-bicis>
2. Under the *aparca-bicis* resource, choose the **export/download in `JSON`** format
   (not CSV or XML — the app expects JSON).
3. Save the downloaded file over **`data/aparcabicis.json`** in your local clone, keeping that
   exact path and filename.
4. Commit and push:
   ```bash
   git add data/aparcabicis.json
   git commit -m "data: refresh snapshot"
   git push
   ```

> Note: the file download and the live API return slightly different JSON *shapes* — the file
> dump uses `{fields, records: [[…]]}` (row arrays) while the API uses `{result: {records: [{…}]}}`
> (objects). `normalizeRecords()` in `app.js` accepts both, so either works.

## Run locally / use it yourself

The app is 100% static — there is nothing to build or install. To run your own copy:

1. **Get the code** — clone (or fork, then clone your fork):
   ```bash
   git clone https://github.com/mariolonghi/madrid-bike-parking.git
   cd madrid-bike-parking
   ```
2. **Serve it** — use any static file server. Opening `index.html` directly via `file://`
   won't work, because the browser blocks `fetch` of the data file from the filesystem.
   ```bash
   python3 -m http.server 8000      # or: npx serve
   ```
3. **Open** <http://localhost:8000> in your browser.

That's it. Both data sources work out of the box: the **live API** needs only an internet
connection, and the **repository file** is already included at `data/aparcabicis.json`. To point
the app at a different CKAN dataset or your own snapshot, edit the `CONFIG` block at the top of
`app.js` (`RESOURCE_ID`, `API_URL`, `LOCAL_FILE`).

You are free to reuse and adapt this (MIT — see `LICENSE`); please keep the data attribution to
the Ayuntamiento de Madrid and OpenStreetMap.

## Data & licensing

- Data: [Portal de Datos Abiertos del Ayuntamiento de Madrid](https://datos.madrid.es/dataset/205099-0-aparca-bicis)
  (resource `205099-2-aparca-bicis`). Only on-street municipal racks are included — not those
  inside sports centres, cultural venues, or historic/forest parks.
- Basemap: © OpenStreetMap contributors.
- Code: MIT (see `LICENSE`).
