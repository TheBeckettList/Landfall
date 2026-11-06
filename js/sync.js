// Downloads a batch of rounds from Mapillary while online, within a data budget.
// Each round = a centre panorama plus up to `steps` panoramas forward and back
// along the same capture sequence, so she can "walk" a little offline.
import * as db from './db.js';
import { distanceKm, today, addDays } from './geo.js';

const API = 'https://graph.mapillary.com';
const NE = [
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/',
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/',
];
const FIELDS = 'id,computed_geometry,geometry,computed_compass_angle,compass_angle,is_pano,captured_at,creator,sequence,thumb_1024_url,thumb_2048_url';
const STEP_M = 12;     // minimum spacing between steps, metres
const MAX_GAP_M = 400; // a bigger jump than this ends the walkable path
const MIN_SPREAD_KM = 25;

// Used only if the Natural Earth city list can't be fetched.
const FALLBACK_SEEDS = [
  [40.4, -3.7], [48.86, 2.35], [52.52, 13.4], [41.9, 12.5], [59.33, 18.07], [60.17, 24.94], [50.08, 14.43],
  [47.5, 19.04], [44.43, 26.1], [38.72, -9.14], [53.35, -6.26], [55.95, -3.19], [64.13, -21.9], [41.01, 28.97],
  [-33.87, 151.2], [-37.81, 144.96], [-41.29, 174.78], [35.68, 139.69], [37.57, 126.98], [25.03, 121.56],
  [13.75, 100.5], [14.6, 120.98], [-6.2, 106.85], [3.14, 101.69], [28.61, 77.21], [6.93, 79.85], [-1.29, 36.82],
  [-33.92, 18.42], [5.6, -0.19], [-26.2, 28.05], [30.04, 31.24], [33.57, -7.59], [-23.55, -46.63], [-34.6, -58.38],
  [-33.45, -70.67], [4.71, -74.07], [-12.05, -77.04], [19.43, -99.13], [9.93, -84.08], [14.08, -87.21],
  [45.5, -73.57], [49.28, -123.12], [61.22, -149.9], [39.74, -104.99], [35.08, -106.65], [32.78, -96.8],
  [41.88, -87.63], [42.36, -71.06], [25.76, -80.19], [21.31, -157.86], [18.47, -66.1], [-17.83, 31.05],
];

export function defaultSettings() {
  return { token: '', count: 140, perDay: 20, steps: 3, quality: '2048' };
}

async function fetchJSON(url, signal) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { signal });
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1), signal); continue; }
    if (res.status === 401 || res.status === 403) throw new AuthError('Mapillary rejected the access token.');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error('Server busy, try again later');
}
class AuthError extends Error {}
const sleep = (ms, signal) => new Promise((r, j) => {
  const t = setTimeout(r, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('Aborted', 'AbortError')); });
});

// ---- World data (map + seed points), fetched once ----
export async function ensureWorld(signal, log) {
  const have = await db.getMeta('world');
  if (have && have.v >= 2) return have;
  log('Downloading world map (one time, ~2 MB)…');
  const get = async (file) => {
    let err;
    for (const base of NE) {
      try { const r = await fetch(base + file, { signal }); if (r.ok) return r.json(); err = new Error(r.status); }
      catch (e) { if (e.name === 'AbortError') throw e; err = e; }
    }
    throw err;
  };
  const [countries, places] = await Promise.all([
    get('ne_110m_admin_0_countries.geojson'),
    get('ne_50m_populated_places_simple.geojson'),
  ]);
  const round = (c) => (Array.isArray(c[0]) ? c.map(round) : [Math.round(c[0] * 1e3) / 1e3, Math.round(c[1] * 1e3) / 1e3]);
  const world = {
    v: 2,
    countries: {
      type: 'FeatureCollection',
      features: countries.features.map((f) => ({
        type: 'Feature',
        properties: { name: f.properties.NAME || f.properties.ADMIN, continent: f.properties.CONTINENT },
        geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
      })),
    },
    places: {
      type: 'FeatureCollection',
      features: places.features.map((f) => ({
        type: 'Feature',
        properties: { name: f.properties.name, country: f.properties.adm0name, scalerank: f.properties.scalerank },
        geometry: { type: 'Point', coordinates: round(f.geometry.coordinates) },
      })),
    },
  };
  await db.setMeta('world', world);
  return world;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function randomSeed(world) {
  const places = world?.places?.features;
  if (Math.random() < 0.75 || !world?.countries) {
    let lat, lon;
    if (places?.length) { [lon, lat] = places[(Math.random() * places.length) | 0].geometry.coordinates; }
    else { [lat, lon] = FALLBACK_SEEDS[(Math.random() * FALLBACK_SEEDS.length) | 0]; }
    const j = 0.6;
    return { lat: lat + (Math.random() * 2 - 1) * j, lon: lon + (Math.random() * 2 - 1) * j };
  }
  // random point inside a random country
  const fs = world.countries.features;
  const f = fs[(Math.random() * fs.length) | 0];
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const poly = polys.reduce((a, b) => (b[0].length > a[0].length ? b : a));
  const xs = poly[0].map((p) => p[0]), ys = poly[0].map((p) => p[1]);
  for (let k = 0; k < 30; k++) {
    const lon = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
    const lat = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
    if (pointInRing(lon, lat, poly[0])) return { lat, lon };
  }
  return randomSeed({ places: world.places });
}

const pos = (img) => {
  const g = img.computed_geometry || img.geometry;
  return g ? { lon: g.coordinates[0], lat: g.coordinates[1] } : null;
};

// ---- One round ----
export async function findRound(s, world, taken, signal) {
  const seed = randomSeed(world);
  const h = 0.02;
  const bbox = [seed.lon - h, seed.lat - h, seed.lon + h, seed.lat + h].map((v) => v.toFixed(5)).join(',');
  const res = await fetchJSON(`${API}/images?access_token=${encodeURIComponent(s.token)}&fields=id,sequence,is_pano,computed_geometry,geometry&bbox=${bbox}&is_pano=true&limit=40`, signal);
  const hits = (res.data || []).filter((d) => d.is_pano !== false && d.sequence && pos(d));
  if (!hits.length) return null;
  const pick = hits[(Math.random() * hits.length) | 0];
  const p = pos(pick);
  if (taken.some((t) => distanceKm(t, p) < MIN_SPREAD_KM)) return null;

  // Ordered ids in the sequence
  const seq = await fetchJSON(`${API}/image_ids?access_token=${encodeURIComponent(s.token)}&sequence_id=${encodeURIComponent(pick.sequence)}`, signal);
  const ids = (seq.data || []).map((d) => d.id);
  let ci = ids.indexOf(pick.id);
  if (ci < 0) { ids.splice(0, ids.length, pick.id); ci = 0; }
  const lo = Math.max(0, ci - 40), hi = Math.min(ids.length, ci + 41);
  const windowIds = ids.slice(lo, hi);

  // Details for the window (batch, with per-image fallback)
  const details = new Map();
  try {
    const r = await fetchJSON(`${API}/images?access_token=${encodeURIComponent(s.token)}&image_ids=${windowIds.join(',')}&fields=${FIELDS}`, signal);
    for (const d of r.data || []) details.set(d.id, d);
  } catch (e) { if (e instanceof AuthError || e.name === 'AbortError') throw e; }
  const detail = async (id) => {
    if (!details.has(id)) {
      try { details.set(id, await fetchJSON(`${API}/${id}?access_token=${encodeURIComponent(s.token)}&fields=${FIELDS}`, signal)); }
      catch (e) { if (e instanceof AuthError || e.name === 'AbortError') throw e; details.set(id, null); }
    }
    return details.get(id);
  };

  const centre = await detail(pick.id);
  if (!centre || !pos(centre) || !(centre.thumb_2048_url || centre.thumb_1024_url)) return null;

  const walk = async (dir) => {
    const out = [];
    let last = centre;
    for (let k = ci - lo + dir; k >= 0 && k < windowIds.length && out.length < s.steps; k += dir) {
      const d = await detail(windowIds[k]);
      if (!d || !pos(d) || d.is_pano === false) continue;
      const m = distanceKm(pos(last), pos(d)) * 1000;
      if (m > MAX_GAP_M) break;
      if (m < STEP_M) continue;
      out.push(d);
      last = d;
    }
    return out;
  };
  const back = s.steps > 0 ? await walk(-1) : [];
  const fwd = s.steps > 0 ? await walk(1) : [];
  const path = [...back.reverse(), centre, ...fwd];

  // Download images
  const id = `r_${centre.id}`;
  let bytes = 0;
  const frames = [];
  for (const d of path) {
    const url = s.quality === '1024' ? d.thumb_1024_url || d.thumb_2048_url : d.thumb_2048_url || d.thumb_1024_url;
    if (!url) continue;
    const r = await fetch(url, { signal });
    if (!r.ok) continue;
    const blob = await r.blob();
    bytes += blob.size;
    const key = `${id}_${d.id}`;
    await db.putImage(key, blob);
    const pp = pos(d);
    frames.push({ key, lat: pp.lat, lon: pp.lon, compass: d.computed_compass_angle ?? d.compass_angle ?? 0, isCentre: d.id === centre.id });
  }
  const centreIdx = frames.findIndex((f) => f.isCentre);
  if (centreIdx < 0) { for (const f of frames) await db.deleteImage(f.key); return null; }

  return {
    id,
    order: Date.now() + Math.random(),
    unlockDate: 'pending',
    lat: p.lat, lon: p.lon,
    frames, centreIdx,
    stepsAllowed: s.steps,
    creator: centre.creator?.username || 'Mapillary contributor',
    capturedAt: centre.captured_at || null,
    imageId: centre.id,
    bytes,
    played: false,
  };
}

// Give every 'pending' round a date, continuing after anything already scheduled.
export async function schedulePending(perDay) {
  const rounds = await db.allRounds();
  const pending = rounds.filter((r) => r.unlockDate === 'pending');
  if (!pending.length) return 0;
  const t = today();
  const lastDate = rounds.filter((r) => /^\d/.test(r.unlockDate) && !r.played).reduce((m, r) => (r.unlockDate > m ? r.unlockDate : m), '');
  const start = lastDate && lastDate >= t ? addDays(lastDate, 1) : t;
  const per = Math.max(1, perDay | 0);
  pending.forEach((r, i) => { r.unlockDate = addDays(start, Math.floor(i / per)); });
  for (const r of pending) await db.putRound(r);
  return pending.length;
}

// Download `count` rounds and tag them ('pending' = scheduled trip rounds, 'bank' = always-playable reserve).
export async function fetchRounds(s, count, tag, { signal, onProgress = () => {}, log = () => {} }) {
  const world = await ensureWorld(signal, log).catch((e) => {
    if (e.name === 'AbortError') throw e;
    log('Could not download the world map; continuing without it.');
    return null;
  });
  const existing = await db.allRounds();
  const taken = existing.filter((r) => !r.played).map((r) => ({ lat: r.lat, lon: r.lon }));
  let bytes = 0, made = 0, tries = 0, misses = 0;
  log('Finding locations…');
  const worker = async () => {
    while (made < count && tries < 3000 * Math.max(1, count / 50) && !signal.aborted) {
      tries++;
      let r = null;
      try { r = await findRound(s, world, taken, signal); }
      catch (e) {
        if (e instanceof AuthError || e.name === 'AbortError') throw e;
        misses++;
        if (misses > 40 && made === 0) throw new Error(`Repeated errors (${e.message}). Check the connection.`);
        continue;
      }
      if (!r) continue;
      if (made >= count) { for (const f of r.frames) await db.deleteImage(f.key); break; }
      made++; bytes += r.bytes;
      r.unlockDate = tag;
      taken.push({ lat: r.lat, lon: r.lon });
      await db.putRound(r);
      onProgress({ bytes, made, count });
    }
  };
  const results = await Promise.allSettled([worker(), worker(), worker()]);
  const fail = results.find((r) => r.status === 'rejected');
  if (fail && !(fail.reason?.name === 'AbortError' && made > 0)) throw fail.reason;
  return { bytes, made };
}
