// Demo data for trying the app without a Mapillary token: open index.html?demo
// Generates fake 360° scenes so the viewer, steps, map and scoring can be tested.
import * as db from './db.js';
import { today } from './geo.js';

const SPOTS = [
  { name: 'Tegucigalpa', lat: 14.08, lon: -87.21, sky: '#7fb8e6', ground: '#8c7a55' },
  { name: 'Reykjavik', lat: 64.13, lon: -21.9, sky: '#b9c9d6', ground: '#4f5d4a' },
  { name: 'Hobart', lat: -42.88, lon: 147.33, sky: '#9ec9ef', ground: '#5e7f4a' },
  { name: 'Marrakesh', lat: 31.63, lon: -8.0, sky: '#f0c27a', ground: '#b5643c' },
  { name: 'Kyoto', lat: 35.01, lon: 135.77, sky: '#c7d9ef', ground: '#6b6b5e' },
];

async function scene(spot, step) {
  const W = 1024, H = 512;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H / 2);
  sky.addColorStop(0, '#1d3d66'); sky.addColorStop(1, spot.sky);
  g.fillStyle = sky; g.fillRect(0, 0, W, H / 2);
  g.fillStyle = spot.ground; g.fillRect(0, H / 2, W, H / 2);
  // road toward the centre of the image (= camera heading)
  g.fillStyle = '#3b3b3b';
  g.beginPath(); g.moveTo(W / 2 - 20, H / 2); g.lineTo(W / 2 + 20, H / 2); g.lineTo(W / 2 + 260, H); g.lineTo(W / 2 - 260, H); g.fill();
  g.beginPath(); g.moveTo(-20, H / 2); g.lineTo(20, H / 2); g.lineTo(260, H); g.lineTo(-260, H); g.fill();
  g.beginPath(); g.moveTo(W - 20, H / 2); g.lineTo(W + 20, H / 2); g.lineTo(W + 260, H); g.lineTo(W - 260, H); g.fill();
  // hills
  g.fillStyle = 'rgba(40,60,40,.6)';
  for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse((i * 131 + step * 17) % W, H / 2, 80, 30 + (i % 3) * 14, 0, Math.PI, 0); g.fill(); }
  // sign
  g.fillStyle = '#f6f1e4'; g.fillRect(W * 0.62, H * 0.36, 150, 46);
  g.fillStyle = '#1b2a33'; g.font = 'bold 18px sans-serif';
  g.fillText(`DEMO · step ${step >= 0 ? '+' : ''}${step}`, W * 0.62 + 10, H * 0.36 + 29);
  g.fillStyle = '#fff'; g.font = '14px sans-serif';
  ['N', 'E', 'S', 'W'].forEach((d, k) => g.fillText(d, (W / 2 + (k * W) / 4) % W, H * 0.47));
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

export async function loadDemo() {
  if (await db.getMeta('demoLoaded')) return;
  const t = today();
  let order = 0;
  for (const s of SPOTS) {
    const id = `demo_${s.name}`;
    const frames = [];
    for (let k = -3; k <= 3; k++) {
      const key = `${id}_${k}`;
      await db.putImage(key, await scene(s, k));
      frames.push({ key, lat: s.lat + k * 0.0002, lon: s.lon, compass: 0, isCentre: k === 0 });
    }
    await db.putRound({ id, order: order++, unlockDate: t, lat: s.lat, lon: s.lon, frames, centreIdx: 3, stepsAllowed: 3,
      creator: 'demo', capturedAt: null, imageId: '', bytes: 0, played: false });
  }
  if (!(await db.getMeta('world'))) {
    const box = (name, w, s, e, n) => ({ type: 'Feature', properties: { name, continent: name },
      geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
    await db.setMeta('world', {
      v: 2,
      countries: { type: 'FeatureCollection', features: [
        box('Americas', -125, -55, -35, 60), box('Eurafrica', -18, -35, 50, 70), box('Asia', 50, 5, 145, 70), box('Oz', 113, -44, 154, -11), box('Iceland', -24, 63, -13, 66.5),
      ] },
      places: { type: 'FeatureCollection', features: SPOTS.map((s) => ({ type: 'Feature', properties: { name: s.name, country: 'Demo', scalerank: 1 },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) },
    });
  }
  await db.setMeta('demoLoaded', true);
}
