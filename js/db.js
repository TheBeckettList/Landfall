// Tiny IndexedDB wrapper. Stores: rounds, images (Blobs), meta (key/value).
const DB_NAME = 'landfall';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rounds')) {
        const s = db.createObjectStore('rounds', { keyPath: 'id' });
        s.createIndex('unlockDate', 'unlockDate');
      }
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function getMeta(key, fallback = null) {
  const v = await wrap((await store('meta')).get(key));
  return v === undefined ? fallback : v;
}
export async function setMeta(key, value) {
  return wrap((await store('meta', 'readwrite')).put(value, key));
}

export async function putImage(key, blob) {
  return wrap((await store('images', 'readwrite')).put(blob, key));
}
export async function getImage(key) {
  return wrap((await store('images')).get(key));
}
export async function deleteImage(key) {
  return wrap((await store('images', 'readwrite')).delete(key));
}

export async function putRound(r) {
  return wrap((await store('rounds', 'readwrite')).put(r));
}
export async function allRounds() {
  const rs = await wrap((await store('rounds')).getAll());
  rs.sort((a, b) => (a.unlockDate < b.unlockDate ? -1 : a.unlockDate > b.unlockDate ? 1 : a.order - b.order));
  return rs;
}
export async function deleteRound(id) {
  return wrap((await store('rounds', 'readwrite')).delete(id));
}

export async function clearAll() {
  const db = await open();
  for (const n of ['rounds', 'images']) {
    await wrap(db.transaction(n, 'readwrite').objectStore(n).clear());
  }
}

// Delete photos no saved round points to (e.g. an online round the app was closed during).
export async function removeOrphanImages() {
  const used = new Set();
  for (const r of await allRounds()) for (const f of r.frames || []) used.add(f.key);
  const keys = await wrap((await store('images')).getAllKeys());
  for (const k of keys) if (!used.has(k)) await deleteImage(k);
}
