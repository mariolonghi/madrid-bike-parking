/* Aparcabicis de Madrid — static map viewer
 * Data: Ayuntamiento de Madrid open data (resource 205099-2-aparca-bicis)
 * No build step, no backend. Runs entirely in the browser.
 *
 * POC additions:
 *  - Collapsible "Resultados" panel.
 *  - Swappable base map: OpenStreetMap (Leaflet) or Google Maps.
 *    Google Maps needs an API key — set CONFIG.GOOGLE_MAPS_API_KEY below.
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

// Google Maps needs a JS API key. It is injected at runtime (never committed),
// resolved in this order:
//   1. URL param   ?gmapsKey=...   (also saved to localStorage for next time)
//   2. localStorage  gmapsKey
//   3. window.GMAPS_KEY  (optionally set in config.js for a self-hosted build)
// With no key, switching to Google Maps shows a notice and stays on OpenStreetMap.
function getGoogleKey() {
  try {
    const fromUrl = new URLSearchParams(location.search).get('gmapsKey');
    if (fromUrl) { localStorage.setItem('gmapsKey', fromUrl); return fromUrl; }
    const fromStore = localStorage.getItem('gmapsKey');
    if (fromStore) return fromStore;
  } catch (_) { /* localStorage may be unavailable */ }
  return (typeof window !== 'undefined' && window.GMAPS_KEY) || '';
}

function saveGoogleKey(k) { try { localStorage.setItem('gmapsKey', k); } catch (_) {} }
function clearGoogleKey() { try { localStorage.removeItem('gmapsKey'); } catch (_) {} }

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

function rawAddr(r) {
  return [titleCase(r.TIPO_VIA), titleCase(r.NOM_VIA), (r.NUM_VIA || '').trim()]
    .filter(Boolean).join(' ').trim();
}

// Classify a raw record: return { point } to plot it, or { discard } with the
// reason it can't be placed on the map.
function classify(r) {
  const x = parseFloat(r.COORD_GIS_X), y = parseFloat(r.COORD_GIS_Y);
  if (!isFinite(x) || !isFinite(y)) {
    return { discard: { reason: 'missing', id: r.ID, addr: rawAddr(r), x: r.COORD_GIS_X, y: r.COORD_GIS_Y } };
  }
  const [lat, lon] = utmToLatLon(x, y);
  if (!(lat > 39.5 && lat < 41.5 && lon > -4.5 && lon < -3.0)) {
    return { discard: { reason: 'range', id: r.ID, addr: rawAddr(r), x, y, lat, lon } };
  }
  return {
    point: {
      id: r.ID,
      lat, lon,
      addr: rawAddr(r) || 'Aparcabicicletas',
      barrio: titleCase(r.BARRIO),
      distrito: titleCase(r.DISTRITO),
      modelo: r.MODELO || '—',
      fecha: r.FECHA_INSTALACION || '',
      estado: r.ESTADO || '',
      cp: r.COD_POSTAL || '',
    },
  };
}

function popupHtml(p) {
  const row = (label, val) => val ? `<dt>${label}</dt><dd>${val}</dd>` : '';
  return `<div class="map-popup"><span class="p-title">${p.addr}</span>
    <dl>
      ${row('Barrio', p.barrio)}
      ${row('Distrito', p.distrito)}
      ${row('C.P.', p.cp)}
      ${row('Modelo', p.modelo)}
      ${row('Instalado', p.fecha)}
      ${row('Estado', p.estado)}
    </dl>
    <span class="p-id">ID ${p.id} · ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</span></div>`;
}

/* ---------- Map engines ----------
 * Both engines share the #map container and expose the same interface:
 *   init() -> Promise, render(points), focus(point), resize(), destroy()
 */

function createLeafletEngine() {
  let map, cluster;
  const markerById = new Map();
  return {
    name: 'osm',
    async init() {
      map = L.map('map', { center: CONFIG.MADRID_CENTER, zoom: CONFIG.MADRID_ZOOM });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
      map.addLayer(cluster);
    },
    render(points) {
      cluster.clearLayers();
      markerById.clear();
      const markers = points.map(p => {
        const m = L.marker([p.lat, p.lon], { alt: `Aparcabici en ${p.addr}, ${p.distrito}`, keyboard: true });
        m.bindPopup(() => popupHtml(p));
        markerById.set(p.id, m);
        return m;
      });
      cluster.addLayers(markers);
    },
    focus(p) {
      map.setView([p.lat, p.lon], 18);
      const m = markerById.get(p.id);
      if (m) cluster.zoomToShowLayer(m, () => m.openPopup());
    },
    resize() { if (map) map.invalidateSize(false); },
    destroy() { if (map) { map.remove(); map = null; } markerById.clear(); },
  };
}

// Lazily load the Google Maps JS API + marker clusterer (once).
let googleLoader;
function loadGoogle() {
  if (googleLoader) return googleLoader;
  const key = getGoogleKey();
  if (!key) {
    return Promise.reject(new Error(
      'Google Maps necesita una clave API. Pégala en el recuadro de abajo para usarla.'));
  }
  googleLoader = new Promise((resolve, reject) => {
    window.gm_authFailure = () => reject(new Error('Clave de Google Maps inválida o sin facturación activada.'));
    // The callback fires only once google.maps and its classes are fully ready.
    window.__gmapsReady = () => {
      const c = document.createElement('script');
      c.src = 'https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js';
      c.async = true;
      c.onload = () => resolve();
      c.onerror = () => reject(new Error('No se pudo cargar el agrupador de marcadores.'));
      document.head.appendChild(c);
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__gmapsReady&loading=async`;
    s.async = true;
    s.onerror = () => reject(new Error('No se pudo cargar Google Maps.'));
    document.head.appendChild(s);
  });
  // Allow a retry (e.g. with a corrected key) after a failed load.
  googleLoader.catch(() => { googleLoader = null; });
  return googleLoader;
}

function createGoogleEngine() {
  let map, clusterer, info;
  let markers = [];
  return {
    name: 'google',
    async init() {
      await loadGoogle(); // resolves via the callback, so google.maps.* is ready
      map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: CONFIG.MADRID_CENTER[0], lng: CONFIG.MADRID_CENTER[1] },
        zoom: CONFIG.MADRID_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
      });
      info = new google.maps.InfoWindow();
    },
    render(points) {
      if (clusterer) clusterer.clearMarkers();
      markers = points.map(p => {
        const m = new google.maps.Marker({
          position: { lat: p.lat, lng: p.lon },
          title: `${p.addr}, ${p.distrito}`,
        });
        m._pid = p.id;
        m.addListener('click', () => { info.setContent(popupHtml(p)); info.open(map, m); });
        return m;
      });
      clusterer = new markerClusterer.MarkerClusterer({ map, markers });
    },
    focus(p) {
      map.setZoom(18);
      map.panTo({ lat: p.lat, lng: p.lon });
      const m = markers.find(mm => mm._pid === p.id);
      if (m) { info.setContent(popupHtml(p)); info.open(map, m); }
    },
    resize() { if (map) google.maps.event.trigger(map, 'resize'); },
    destroy() {
      if (clusterer) clusterer.clearMarkers();
      markers = [];
      map = null;
      document.getElementById('map').innerHTML = '';
    },
  };
}

/* ---------- App state ---------- */

let engine = null;       // active map engine
let allPoints = [];      // every plotted point
let filtered = [];       // currently visible subset
let discardedRecords = []; // records that couldn't be placed (for the info popup)

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
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

  if (engine) engine.render(filtered);
  renderList();
  setStatus(`${filtered.length.toLocaleString('es-ES')} aparcabicicletas mostradas.`);
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
    btn.addEventListener('click', () => { if (engine) engine.focus(p); });
    li.appendChild(btn);
    frag.appendChild(li);
  }
  list.appendChild(frag);
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

/* ---------- Engine switching ---------- */

async function setEngine(name) {
  if (engine && engine.name === name) return;
  const prev = engine;
  const next = name === 'google' ? createGoogleEngine() : createLeafletEngine();
  setStatus(name === 'google' ? 'Cargando Google Maps…' : 'Cargando OpenStreetMap…');
  try {
    if (prev) prev.destroy();
    engine = null;
    await next.init();
    engine = next;
    engine.render(filtered);
    setTimeout(() => engine.resize(), 200);
    setStatus(`${filtered.length.toLocaleString('es-ES')} aparcabicicletas mostradas.`);
    try { localStorage.setItem('mapEngine', name); } catch (_) {}
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
    // Fall back to OpenStreetMap and re-check that radio.
    engine = createLeafletEngine();
    await engine.init();
    engine.render(filtered);
    const osm = document.querySelector('input[name="engine"][value="osm"]');
    if (osm) osm.checked = true;
    if (name === 'google') showKeyBox(true); // let the user fix the key
  }
}

/* ---------- Data source ---------- */

async function loadSource(source) {
  setStatus(source === 'api' ? 'Consultando la API en vivo…' : 'Cargando archivo del repositorio…');
  try {
    const raw = await loadRaw(source);
    const records = normalizeRecords(raw);
    allPoints = [];
    discardedRecords = [];
    for (const r of records) {
      const c = classify(r);
      if (c.point) allPoints.push(c.point);
      else discardedRecords.push(c.discard);
    }

    populateDistricts();
    applyFilters();
    renderSourceMeta(source);
  } catch (err) {
    console.error(err);
    setStatus(`Error al cargar los datos: ${err.message}`, true);
  }
}

/* ---------- Source metadata + discarded-records popup ---------- */

function renderSourceMeta(source) {
  const meta = document.getElementById('source-meta');
  const label = source === 'api' ? 'API en vivo' : 'archivo del repositorio';
  meta.textContent = `Origen: ${label}. ${allPoints.length.toLocaleString('es-ES')} puntos representados`;
  if (discardedRecords.length) {
    meta.append(' (');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'linklike';
    btn.textContent = `${discardedRecords.length.toLocaleString('es-ES')} descartados`;
    btn.addEventListener('click', openDiscardedDialog);
    meta.append(btn, ' — ver por qué).');
  } else {
    meta.append('.');
  }
}

function openDiscardedDialog() {
  const missing = discardedRecords.filter(d => d.reason === 'missing');
  const range = discardedRecords.filter(d => d.reason === 'range');
  const examples = [...missing, ...range].slice(0, 6);

  const li = d => {
    const why = d.reason === 'missing'
      ? 'sin coordenadas'
      : `fuera del área (${d.lat.toFixed(3)}, ${d.lon.toFixed(3)})`;
    return `<li><strong>${d.addr || 'Sin dirección'}</strong> — ${why}
      <span class="d-id">ID ${d.id}</span></li>`;
  };

  document.getElementById('discarded-body').innerHTML = `
    <p>Estos registros del conjunto de datos no se muestran en el mapa porque su
       posición no se puede situar: las coordenadas UTM (<code>COORD_GIS_X/Y</code>)
       están vacías, o al convertirlas caen fuera del área de Madrid.</p>
    <p><strong>${missing.length}</strong> sin coordenadas · <strong>${range.length}</strong> fuera de rango.</p>
    <p>Ejemplos:</p>
    <ul class="discard-list">${examples.map(li).join('')}</ul>`;
  document.getElementById('discarded-dialog').showModal();
}

/* ---------- Google Maps key box ---------- */

function refreshKeyBox() {
  const input = document.getElementById('gmaps-key-input');
  const clear = document.getElementById('gmaps-key-clear');
  const hasKey = !!getGoogleKey();
  clear.hidden = !hasKey;
  input.value = '';
  input.placeholder = hasKey ? 'Clave guardada ✓ — pega otra para cambiarla' : 'AIza… (pega tu clave)';
}

function showKeyBox(show) {
  const box = document.getElementById('gmaps-key-box');
  box.hidden = !show;
  if (show) refreshKeyBox();
}

// Pick a base map from the radios, prompting for a key if Google needs one.
function chooseEngine(name) {
  if (name === 'google') {
    if (!getGoogleKey()) {
      showKeyBox(true);
      setStatus('Pega tu clave de API de Google Maps para usar este mapa base.', true);
      const osm = document.querySelector('input[name="engine"][value="osm"]');
      if (osm) osm.checked = true; // stay on OSM until a key is provided
      document.getElementById('gmaps-key-input').focus();
      return;
    }
    showKeyBox(true); // visible so the key can be changed/cleared
    setEngine('google');
  } else {
    showKeyBox(false);
    setEngine('osm');
  }
}

function onSaveKey() {
  const input = document.getElementById('gmaps-key-input');
  const k = input.value.trim();
  if (!k) { input.focus(); return; }
  saveGoogleKey(k);
  // Google Maps JS can't re-authenticate with a new key on an already-loaded
  // page, so if it was loaded before, reload to apply the new key cleanly.
  if (window.google && window.google.maps) { location.reload(); return; }
  const g = document.querySelector('input[name="engine"][value="google"]');
  if (g) g.checked = true;
  refreshKeyBox();
  setEngine('google');
}

function onClearKey() {
  clearGoogleKey();
  refreshKeyBox();
  setStatus('Clave borrada de este navegador.');
  if (engine && engine.name === 'google') {
    const osm = document.querySelector('input[name="engine"][value="osm"]');
    if (osm) osm.checked = true;
    showKeyBox(false);
    setEngine('osm');
  }
}

/* ---------- List panel collapse ---------- */

function setListVisible(visible) {
  document.querySelector('.layout').classList.toggle('list-collapsed', !visible);
  const reopen = document.getElementById('list-reopen');
  const close = document.getElementById('list-close');
  reopen.hidden = visible;
  reopen.setAttribute('aria-expanded', String(visible));
  close.setAttribute('aria-expanded', String(visible));
  if (!visible) reopen.focus(); else close.focus();
  if (engine) setTimeout(() => engine.resize(), 200);
}

/* ---------- Wiring ---------- */

async function init() {
  document.querySelectorAll('input[name="source"]').forEach(radio => {
    radio.addEventListener('change', e => { if (e.target.checked) loadSource(e.target.value); });
  });
  document.querySelectorAll('input[name="engine"]').forEach(radio => {
    radio.addEventListener('change', e => { if (e.target.checked) chooseEngine(e.target.value); });
  });
  document.getElementById('gmaps-key-save').addEventListener('click', onSaveKey);
  document.getElementById('gmaps-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') onSaveKey(); });
  document.getElementById('gmaps-key-clear').addEventListener('click', onClearKey);
  document.getElementById('district').addEventListener('change', applyFilters);

  let searchTimer;
  document.getElementById('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 200);
  });

  document.getElementById('list-close').addEventListener('click', () => setListVisible(false));
  document.getElementById('list-reopen').addEventListener('click', () => setListVisible(true));

  window.addEventListener('load', () => setTimeout(() => { if (engine) engine.resize(); }, 200));

  // Restore the last base map (only start on Google if a key is available).
  let wantGoogle = false;
  try { wantGoogle = localStorage.getItem('mapEngine') === 'google'; } catch (_) {}
  const startName = (wantGoogle && getGoogleKey()) ? 'google' : 'osm';
  const startRadio = document.querySelector(`input[name="engine"][value="${startName}"]`);
  if (startRadio) startRadio.checked = true;
  if (startName === 'google') showKeyBox(true);
  await setEngine(startName); // build the initial map

  const checked = document.querySelector('input[name="source"]:checked');
  loadSource(checked ? checked.value : 'file');
}

init();
