// Ranks and awards. A guess is "right" if it lands in the correct country
// or within 250 km of the spot.
import * as db from './db.js';
import { today, addDays } from './geo.js';

export const RANKS = [
  { at: 0, name: 'Deckhand', icon: '🧽' },
  { at: 5, name: 'Able Seaman', icon: '🪢' },
  { at: 15, name: 'Bosun', icon: '📯' },
  { at: 30, name: 'Navigator', icon: '🧭' },
  { at: 50, name: 'First Mate', icon: '⚓' },
  { at: 80, name: 'Captain', icon: '🧑‍✈️' },
  { at: 120, name: 'Commodore', icon: '🎖️' },
  { at: 175, name: 'Admiral', icon: '⭐' },
  { at: 250, name: 'Sea Legend', icon: '🐋' },
];

export const AWARDS = [
  { id: 'first', icon: '🏝️', name: 'First Landfall', desc: 'Play your first round' },
  { id: 'flag', icon: '🚩', name: 'Flag Spotter', desc: 'Guess the right country' },
  { id: 'bullseye', icon: '🎯', name: 'Bullseye', desc: 'Land within 25 km' },
  { id: 'pinpoint', icon: '📍', name: 'Pinpoint', desc: 'Land within 1 km' },
  { id: 'perfect', icon: '💯', name: 'Full Marks', desc: 'Score 4,900+ in one round' },
  { id: 'eagle', icon: '🦅', name: 'Eagle Eye', desc: 'Right answer without taking a step' },
  { id: 'streak3', icon: '🌬️', name: 'Fair Winds', desc: '3 right answers in a row' },
  { id: 'streak5', icon: '⛵', name: 'Trade Winds', desc: '5 right answers in a row' },
  { id: 'streak10', icon: '🌪️', name: 'Gale Force', desc: '10 right answers in a row' },
  { id: 'countries10', icon: '🗺️', name: 'Globetrotter', desc: 'Right answers in 10 countries' },
  { id: 'countries25', icon: '🌍', name: 'Circumnavigator', desc: 'Right answers in 25 countries' },
  { id: 'continents', icon: '🌐', name: 'Six Continents', desc: 'Right answers on 6 continents' },
  { id: 'perfectDay', icon: '☀️', name: 'Clear Skies', desc: 'Get every round right in a day (3+)' },
  { id: 'watch3', icon: '🔭', name: 'On Watch', desc: 'Play 3 days in a row' },
  { id: 'watch7', icon: '🧜', name: 'Sea Legs', desc: 'Play 7 days in a row' },
  { id: 'century', icon: '📖', name: 'Logbook Full', desc: 'Play 100 rounds' },
  { id: 'lost', icon: '🍾', name: 'Message in a Bottle', desc: 'Miss by more than 15,000 km' },

  // Hard
  { id: 'holeInOne', tier: 'hard', icon: '⛳', name: 'Hole in One', desc: 'Land within 100 m' },
  { id: 'bull3', tier: 'hard', icon: '🏹', name: 'Robin Hood', desc: '3 bullseyes (25 km) in a row' },
  { id: 'country15', tier: 'hard', icon: '🧿', name: 'Sixth Sense', desc: 'Right country 15 times in a row' },
  { id: 'countries50', tier: 'hard', icon: '🏳️', name: 'Flag Collector', desc: 'Right answers in 50 countries' },
  { id: 'blind', tier: 'hard', icon: '🙈', name: 'Blindfolded', desc: 'Within 10 km without taking a step' },
  { id: 'watch30', tier: 'hard', icon: '🌕', name: 'Full Moon Watch', desc: 'Play 30 days in a row' },
  { id: 'bulls25', tier: 'hard', icon: '🦈', name: 'Shark Eyes', desc: '25 bullseyes in total' },
  { id: 'wrongSide', tier: 'hard', icon: '🙃', name: 'Wrong Side of the World', desc: 'Miss by more than 19,500 km' },

  // Legendary (good luck)
  { id: 'ghost', tier: 'legendary', icon: '👻', name: 'Ghost Ship', desc: 'Within 1 km without taking a step' },
  { id: 'bull5', tier: 'legendary', icon: '👑', name: 'Perfect Voyage', desc: '5 bullseyes in a row' },
  { id: 'perfect10', tier: 'legendary', icon: '💎', name: 'Diamond Hull', desc: '10 rounds of 4,900+ in a row' },
  { id: 'country50', tier: 'legendary', icon: '🐉', name: 'Here Be Dragons', desc: 'Right country 50 times in a row' },
  { id: 'countries100', tier: 'legendary', icon: '🌐', name: 'United Nations', desc: 'Right answers in 100 countries' },
  { id: 'polar', tier: 'legendary', icon: '🐧', name: 'Polar Explorer', desc: 'A right answer in Antarctica' },
  { id: 'bulls100', tier: 'legendary', icon: '🦑', name: 'The Kraken', desc: '100 bullseyes in total' },
  { id: 'watch100', tier: 'legendary', icon: '⚓', name: 'Iron Anchor', desc: 'Play 100 days in a row' },
  { id: 'thousand', tier: 'legendary', icon: '🔱', name: 'Poseidon', desc: '1,000 right answers' },
];

const fresh = () => ({ played: 0, correct: 0, streak: 0, bestStreak: 0, bullStreak: 0, bulls: 0, highStreak: 0, countryStreak: 0, countries: [], continents: [], days: [], dayStreak: 0, awards: {} });

export async function getProgress() { return { ...fresh(), ...(await db.getMeta('progress', {})) }; }

export function rankFor(correct) {
  let i = 0;
  while (i + 1 < RANKS.length && correct >= RANKS[i + 1].at) i++;
  const r = RANKS[i], next = RANKS[i + 1] || null;
  const frac = next ? (correct - r.at) / (next.at - r.at) : 1;
  return { ...r, index: i, next, frac, toNext: next ? next.at - correct : 0 };
}

// --- country lookup on the offline world map ---
let cache = null;
function prepared(world) {
  if (cache?.world === world) return cache.list;
  const list = [];
  for (const f of world?.countries?.features || []) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const xs = poly[0].map((p) => p[0]), ys = poly[0].map((p) => p[1]);
      list.push({ props: f.properties, poly, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  cache = { world, list };
  return list;
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function countryAt(world, p) {
  for (const c of prepared(world)) {
    const [x0, y0, x1, y1] = c.bb;
    if (p.lon < x0 || p.lon > x1 || p.lat < y0 || p.lat > y1) continue;
    if (inRing(p.lon, p.lat, c.poly[0]) && !c.poly.slice(1).some((h) => inRing(p.lon, p.lat, h))) return c.props;
  }
  return null;
}

// Record one result; returns what's new so the UI can celebrate.
export async function record({ km, points, stepsUsed, truthCountry, guessCountry }) {
  const p = await getProgress();
  const before = rankFor(p.correct);
  const sameCountry = !!truthCountry && !!guessCountry && truthCountry.name === guessCountry.name;
  const right = sameCountry || km <= 250;
  const earned = [];
  const give = (id) => { if (!p.awards[id]) { p.awards[id] = today(); earned.push(AWARDS.find((a) => a.id === id)); } };

  p.played++;
  give('first');
  const t = today();
  if (!p.days.includes(t)) {
    p.dayStreak = p.days.includes(addDays(t, -1)) ? p.dayStreak + 1 : 1;
    p.days = [...p.days.slice(-30), t];
  }
  if (p.dayStreak >= 3) give('watch3');
  if (p.dayStreak >= 7) give('watch7');
  if (p.played >= 100) give('century');
  if (km > 15000) give('lost');
  if (km > 19500) give('wrongSide');
  if (p.dayStreak >= 30) give('watch30');
  if (p.dayStreak >= 100) give('watch100');

  // streak counters that don't depend on the 250 km rule
  p.bullStreak = km <= 25 ? p.bullStreak + 1 : 0;
  if (km <= 25) p.bulls++;
  p.highStreak = points >= 4900 ? p.highStreak + 1 : 0;
  p.countryStreak = sameCountry ? p.countryStreak + 1 : 0;
  if (km <= 0.1) give('holeInOne');
  if (p.bullStreak >= 3) give('bull3');
  if (p.bullStreak >= 5) give('bull5');
  if (p.bulls >= 25) give('bulls25');
  if (p.bulls >= 100) give('bulls100');
  if (p.highStreak >= 10) give('perfect10');
  if (p.countryStreak >= 15) give('country15');
  if (p.countryStreak >= 50) give('country50');
  if (stepsUsed === 0 && km <= 10) give('blind');
  if (stepsUsed === 0 && km <= 1) give('ghost');

  if (right) {
    p.correct++;
    p.streak++;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    if (sameCountry) give('flag');
    if (truthCountry?.name && !p.countries.includes(truthCountry.name)) p.countries.push(truthCountry.name);
    if (truthCountry?.continent && truthCountry.continent !== 'Seven seas (open ocean)' && !p.continents.includes(truthCountry.continent)) p.continents.push(truthCountry.continent);
    if (km <= 25) give('bullseye');
    if (km <= 1) give('pinpoint');
    if (points >= 4900) give('perfect');
    if (stepsUsed === 0) give('eagle');
    if (p.streak >= 3) give('streak3');
    if (p.streak >= 5) give('streak5');
    if (p.streak >= 10) give('streak10');
    if (p.countries.length >= 10) give('countries10');
    if (p.countries.length >= 25) give('countries25');
    if (p.continents.length >= 6) give('continents');
    if (p.countries.length >= 50) give('countries50');
    if (p.countries.length >= 100) give('countries100');
    if (truthCountry?.continent === 'Antarctica') give('polar');
    if (p.correct >= 1000) give('thousand');
  } else p.streak = 0;

  await db.setMeta('progress', p);
  const after = rankFor(p.correct);
  return { right, sameCountry, earned, rankUp: after.index > before.index ? after : null, progress: p };
}

export async function awardPerfectDay() {
  const p = await getProgress();
  if (p.awards.perfectDay) return null;
  p.awards.perfectDay = today();
  await db.setMeta('progress', p);
  return AWARDS.find((a) => a.id === 'perfectDay');
}
