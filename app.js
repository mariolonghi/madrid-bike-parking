/* Aparcabicis de Madrid — static map viewer
 * Data: Ayuntamiento de Madrid open data (resource 205099-2-aparca-bicis)
 * No build step, no backend. Runs entirely in the browser.
 */
'use strict';

const CONFIG = {
  RESOURCE_ID: '205099-2-aparca-bicis',
  API_URL: 'https://datos.madrid.es/api/3/action/datastore_search',
  LOCAL_FILE: 'data/aparcabicis.json',
  MADRID_CENTER: [40.4248, -3.6924],
  MADRID_ZOOM: 11,
  LIST_CAP: 500, // max rows rendered in the accessible list at once
};

/* ---------- Coordinate conversion: ETRS89 UTM zone 30N -> WGS84 lat/lon ----------
 * The dataset stores position as UTM easting/northing (COORD_GIS_X / _Y); the
 * LATITUD/LONGITUD columns are almost always empty. GRS80 ellipsoid (ETRS89),
 * which is < 1 m from WGS84 for civil mapping. Standard inverse transverse Mercator.
 */
function utmToLatLon(x, y) {
  const a = 6378137.0, f = 1 / 298.257222101;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const k0 = 0.9996, E0 = 500000.0, N0 = 0.0;
  const lon0 = -3.0 * Math.PI / 180; // zone 30 central meridian

  const M = (y - N0) / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

  const sp = Math.sin(phi1), cp = Math.cos(phi1), tp = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sp * sp);
  const T1 = tp * tp;
  const C1 = ep2 * cp * cp;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sp * sp, 1.5);
  const D = (x - E0) / (N1 * k0);

  const lat = phi1 - (N1 * tp / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720
  );
  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120
  ) / cp;

  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}

/* ---------- Data loading ---------- */

// Normalize either the API response (records as objects) or the Madrid
// datastore dump file ({fields:[{id}], records:[[...]]}) into objects.
function normalizeRecords(json) {
  const result = json.result || json; // API wraps in .result; dump does not
  const records = result.records || [];
  if (records.length === 0) return [];
  if (Array.isArray(records[0])) {
    const keys = (result.fields || []).map(fld => fld.id);
    return records.map(row => Object.fromEntries(keys.map((k, i) => [k, row[i]])));
  }
  return records; // already objects
}

async function loadRaw(source) {
  if (source === 'api') {
    const url = `${CONFIG.API_URL}?resource_id=${encodeURIComponent(CONFIG.RESOURCE_ID)}&limit=100000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    return await res.json();
  }
  const res = await fetch(CONFIG.LOCAL_FILE, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo leer el archivo (${res.status})`);
  return await res.json();
}

function titleCase(s) {
  return (s || '').toLowerCase().replace(/\b[\p{L}]/gu, c => c.toUpperCase());
}

// Convert a raw record into a plotted point, or null if coords are unusable.
function toPoint(r) {
  const x = parseFloat(r.COORD_GIS_X), y = parseFloat(r.COORD_GIS_Y);
  if (!isFinite(x) || !isFinite(y)) return null;
  const [lat, lon] = utmToLatLon(x, y);
  if (!(lat > 39.5 && lat < 41.5 && lon > -4.5 && lon < -3.0)) return null;

  const addr = [titleCase(r.TIPO_VIA), titleCase(r.NOM_VIA), (r.NUM_VIA || '').trim()]
    .filter(Boolean).join(' ').trim();

  return {
    id: r.ID,
    lat, lon,
    addr: addr || 'Aparcabicicletas',
    barrio: titleCase(r.BARRIO),
    distrito: titleCase(r.DISTRITO),
    modelo: r.MODELO || '—',
    fecha: r.FECHA_INSTALACION || '',
    estado: r.ESTADO || '',
    cp: r.COD_POSTAL || '',
  };
}

/* ---------- Map ---------- */

const map = L.map('map', { center: CONFIG.MADRID_CENTER, zoom: CONFIG.MADRID_ZOOM });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
map.addLayer(cluster);

let allPoints = [];      // every plotted point
let filtered = [];       // currently visible subset
const markerById = new Map();

function popupHtml(p) {
  const row = (label, val) => val ? `<dt>${label}</dt><dd>${val}</dd>` : '';
  return `<span class="p-title">${p.addr}</span>
    <dl>
      ${row('Barrio', p.barrio)}
      ${row('Distrito', p.distrito)}
      ${row('C.P.', p.cp)}
      ${row('Modelo', p.modelo)}
      ${row('Instalado', p.fecha)}
      ${row('Estado', p.estado)}
    </dl>
    <span class="p-id">ID ${p.id} · ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</span>`;
}

function applyFilters() {
  const dist = document.getElementById('district').value;
  const q = document.getElementById('search').value.trim().toLowerCase();

  filtered = allPoints.filter(p => {
    if (dist && p.distrito !== dist) return false;
    if (q) {
      const hay = `${p.addr} ${p.barrio} ${p.distrito}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  renderMarkers();
  renderList();
  const n = filtered.length.toLocaleString('es-ES');
  setStatus(`${n} aparcabicicletas mostradas.`);
}

function renderMarkers() {
  cluster.clearLayers();
  markerById.clear();
  const markers = filtered.map(p => {
    const m = L.marker([p.lat, p.lon], {
      alt: `Aparcabici en ${p.addr}, ${p.distrito}`,
      keyboard: true,
    });
    m.bindPopup(() => popupHtml(p));
    markerById.set(p.id, m);
    return m;
  });
  cluster.addLayers(markers);
}

function renderList() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  const shown = filtered.slice(0, CONFIG.LIST_CAP);

  if (filtered.length > CONFIG.LIST_CAP) {
    const note = document.createElement('p');
    note.className = 'list-note';
    note.textContent = `Mostrando ${CONFIG.LIST_CAP} de ${filtered.length.toLocaleString('es-ES')}. Filtra por distrito o dirección para acotar.`;
    list.appendChild(note);
  }

  const frag = document.createDocumentFragment();
  for (const p of shown) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<span class="r-title">${p.addr}</span>
      <span class="r-sub">${[p.barrio, p.distrito].filter(Boolean).join(' · ')}</span>`;
    btn.addEventListener('click', () => focusPoint(p));
    li.appendChild(btn);
    frag.appendChild(li);
  }
  list.appendChild(frag);
}

function focusPoint(p) {
  map.setView([p.lat, p.lon], 18);
  const m = markerById.get(p.id);
  if (m) cluster.zoomToShowLayer(m, () => m.openPopup());
}

function populateDistricts() {
  const sel = document.getElementById('district');
  const current = sel.value;
  sel.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
  const names = [...new Set(allPoints.map(p => p.distrito).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  for (const name of names) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  }
  if (names.includes(current)) sel.value = current;
}

/* ---------- Status / wiring ---------- */

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

async function loadSource(source) {
  setStatus(source === 'api' ? 'Consultando la API en vivo…' : 'Cargando archivo del repositorio…');
  try {
    const raw = await loadRaw(source);
    const records = normalizeRecords(raw);
    const total = records.length;
    allPoints = records.map(toPoint).filter(Boolean);
    const dropped = total - allPoints.length;

    populateDistricts();
    applyFilters();

    const meta = document.getElementById('source-meta');
    meta.textContent = source === 'api'
      ? `Origen: API en vivo. ${allPoints.length.toLocaleString('es-ES')} puntos representados` +
        (dropped ? ` (${dropped} descartados por coordenadas ausentes o fuera de rango).` : '.')
      : `Origen: archivo del repositorio. ${allPoints.length.toLocaleString('es-ES')} puntos representados` +
        (dropped ? ` (${dropped} descartados por coordenadas ausentes o fuera de rango).` : '.');
  } catch (err) {
    console.error(err);
    setStatus(`Error al cargar los datos: ${err.message}`, true);
  }
}

function init() {
  document.querySelectorAll('input[name="source"]').forEach(radio => {
    radio.addEventListener('change', e => { if (e.target.checked) loadSource(e.target.value); });
  });
  document.getElementById('district').addEventListener('change', applyFilters);

  let searchTimer;
  document.getElementById('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 200);
  });

  window.addEventListener('load', () => setTimeout(() => map.invalidateSize(false), 200));

  const checked = document.querySelector('input[name="source"]:checked');
  loadSource(checked ? checked.value : 'file');
}

init();
