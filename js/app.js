import * as db from './db.js';
import { PanoViewer } from './viewer.js';
import { WorldMap } from './map.js';
import { runSync, defaultSettings, schedulePending, findRound, ensureWorld } from './sync.js';
import { getProgress, rankFor, AWARDS, record, countryAt, awardPerfectDay } from './progress.js';
import { distanceKm, bearingDeg, score, formatKm, today } from './geo.js';
import { DEFAULT_TOKEN } from './config.js';
const tokenOf = () => settings.token || DEFAULT_TOKEN;

const $ = (id) => document.getElementById(id);
const MB = 1024 * 1024;

let settings = defaultSettings();
let world = null;
let viewer = null, map = null;
let syncCtl = null;

// ---------- Home ----------
async function refreshHome() {
  const rounds = await db.allRounds();
  const t = today();
  const ready = rounds.filter((r) => !r.played && r.unlockDate !== 'pending' && r.unlockDate <= t);
  const future = rounds.filter((r) => !r.played && r.unlockDate > t && r.unlockDate !== 'pending');
  $('readyCount').textContent = ready.length;
  $('readyLabel').textContent = ready.length === 1 ? 'round ready today' : 'rounds ready today';
  $('playBtn').disabled = !ready.length;
  if (!rounds.length) $('stockLine').textContent = 'No rounds yet. Open “Sync new rounds” below while you have internet.';
  else if (future.length) {
    const last = future[future.length - 1].unlockDate;
    const nextDate = future[0].unlockDate;
    const nextN = future.filter((r) => r.unlockDate === nextDate).length;
    $('stockLine').textContent = `${nextN} more unlock ${nextDate === nextDay(t) ? 'tomorrow' : 'on ' + nextDate}. Stocked through ${last}.`;
  } else $('stockLine').textContent = ready.length ? 'This is the last of your stored rounds. Sync again when you’re next online.' : 'All caught up. Sync again when you’re next online.';

  const played = rounds.filter((r) => r.played && r.result);
  const avg = played.length ? Math.round(played.reduce((s, r) => s + r.result.points, 0) / played.length) : 0;
  const best = played.length ? Math.min(...played.map((r) => r.result.km)) : null;
  const right = (await getProgress()).correct;
  $('stats').innerHTML = `
    <div><b>${played.length}</b><span>played · ${right} right</span></div>
    <div><b>${avg.toLocaleString()}</b><span>avg points</span></div>
    <div><b>${best === null ? '–' : formatKm(best)}</b><span>closest guess</span></div>`;

  const prog = await getProgress();
  const rk = rankFor(prog.correct);
  $('rankCard').innerHTML = `
    <div class="rank-icon">${rk.icon}</div>
    <div class="rank-body">
      <div class="muted small">Your rank</div>
      <div class="rank-name">${rk.name}</div>
      <div class="bar"><div style="width:${Math.round(rk.frac * 100)}%"></div></div>
      <div class="muted small">${rk.next ? `${rk.toNext} more right answer${rk.toNext === 1 ? '' : 's'} to ${rk.next.icon} ${rk.next.name}` : 'Top rank. The sea knows your name.'}
        ${prog.streak >= 2 ? ` · 🔥 ${prog.streak} in a row` : ''}</div>
    </div>`;
  const got = AWARDS.filter((a) => prog.awards[a.id]).length;
  $('awardCount').textContent = `${got} of ${AWARDS.length}`;
  const tiers = [['', 'Everyday'], ['hard', 'Hard'], ['legendary', 'Legendary · almost impossible']];
  $('awards').innerHTML = tiers.map(([t, label]) => {
    const list = AWARDS.filter((a) => (a.tier || '') === t);
    const n = list.filter((a) => prog.awards[a.id]).length;
    return `<div class="tier-head ${t}">${label} <span>${n}/${list.length}</span></div>` + list.map((a) => `
    <div class="award ${t} ${prog.awards[a.id] ? '' : 'locked'}">
      <div class="ai">${a.icon}</div><div class="an">${a.name}</div><div class="ad">${a.desc}</div>
    </div>`).join('');
  }).join('');
  $('onlineBtn').hidden = !(navigator.onLine && tokenOf());

  const ls = await db.getMeta('lastSync');
  $('lastSync').textContent = ls ? `last: ${new Date(ls).toLocaleDateString()}` : '';
  updateStorage();
}
const nextDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return today(new Date(y, m - 1, d + 1)); };

async function updateStorage() {
  let line = '';
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    line = `Using ${(e.usage / MB).toFixed(0)} MB`;
    if (e.quota) line += ` of ~${(e.quota / MB / 1024).toFixed(1)} GB available to the app`;
    line += '.';
  }
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  if (!persisted) line += ' Tip: on iPhone/iPad, add Landfall to the Home Screen and sync from there so the photos are kept.';
  $('storageLine').textContent = line;
}

async function loadSettings() {
  settings = { ...defaultSettings(), ...(await db.getMeta('settings', {})) };
  $('token').value = settings.token;
  $('budget').value = settings.budgetMB;
  $('days').value = settings.days;
  $('steps').value = settings.steps;
  $('quality').value = settings.quality;
  renderSettings();
}

async function renderSettings() {
  settings.budgetMB = +$('budget').value;
  settings.days = +$('days').value;
  settings.steps = +$('steps').value;
  settings.quality = $('quality').value;
  settings.token = $('token').value.trim();
  $('budgetOut').textContent = settings.budgetMB >= 1000 ? `${(settings.budgetMB / 1000).toFixed(2).replace(/0$/, '')} GB` : `${settings.budgetMB} MB`;
  $('daysOut').textContent = `${settings.days} day${settings.days > 1 ? 's' : ''}`;
  $('stepsOut').textContent = settings.steps ? `${settings.steps} (walk up to ${settings.steps} photos along the road)` : 'none (one photo per spot)';
  const measured = await db.getMeta('avgFrameBytes_' + settings.quality);
  const perPhoto = measured || (settings.quality === '1024' ? 0.15 : 0.5) * MB;
  const framesPerRound = 1 + settings.steps * 2 * 0.85; // paths are sometimes shorter at the ends of a sequence
  const rounds = Math.max(1, Math.floor((settings.budgetMB * MB) / (perPhoto * framesPerRound)));
  const perDay = rounds / settings.days;
  $('estimate').innerHTML = `≈ <b>${rounds}</b> rounds, about <b>${perDay >= 10 ? Math.round(perDay) : perDay.toFixed(1)}</b> a day for ${settings.days} days.` +
    (measured ? '' : ' <span class="muted">(estimate gets more accurate after the first sync)</span>');
  db.setMeta('settings', settings);
}

async function startSync() {
  await renderSettings();
  if (!tokenOf()) { toast('Add a Mapillary token under Advanced first'); $('advanced').open = true; $('token').focus(); return; }
  if (!navigator.onLine) { toast('You look offline right now'); }
  navigator.storage?.persist?.();
  syncCtl = new AbortController();
  $('syncBtn').hidden = true; $('cancelBtn').hidden = false; $('progWrap').hidden = false; $('prog').style.width = '0';
  const log = (m) => { $('syncLog').textContent = m; };
  try {
    await cleanPlayed(true);
    const res = await runSync({ ...settings, token: tokenOf() }, {
      signal: syncCtl.signal,
      log,
      onProgress: ({ bytes, budget, made }) => {
        $('prog').style.width = `${Math.min(100, (bytes / budget) * 100)}%`;
        log(`${made} rounds saved · ${(bytes / MB).toFixed(0)} of ${settings.budgetMB} MB`);
      },
    });
    if (res.made) {
      const rounds = await db.allRounds();
      const recent = rounds.filter((r) => r.frames?.length && r.bytes);
      const frames = recent.reduce((s, r) => s + r.frames.length, 0);
      if (frames) await db.setMeta('avgFrameBytes_' + settings.quality, recent.reduce((s, r) => s + r.bytes, 0) / frames);
      await db.setMeta('lastSync', Date.now());
    }
    log(syncCtl.signal.aborted ? `Stopped. ${res.made} rounds saved.` : `Done! ${res.made} rounds saved (${(res.bytes / MB).toFixed(0)} MB).`);
  } catch (e) {
    log(e.name === 'AbortError' ? 'Stopped.' : `Sync problem: ${e.message}`);
  } finally {
    syncCtl = null;
    $('syncBtn').hidden = false; $('cancelBtn').hidden = true;
    world = await db.getMeta('world');
    if (map && world) map.setData(world.countries, world.places);
    renderSettings();
    refreshHome();
  }
}

async function cleanPlayed(silent) {
  const rounds = await db.allRounds();
  let n = 0;
  for (const r of rounds) {
    if (!r.played || !r.frames?.length) continue;
    for (const f of r.frames) await db.deleteImage(f.key);
    r.frames = []; r.bytes = 0;
    await db.putRound(r);
    n++;
  }
  if (!silent) toast(n ? `Freed photos from ${n} played rounds` : 'Nothing to clean');
  refreshHome();
}

// ---------- Game ----------
const game = { mode: 'daily', queue: [], round: null, cur: 0, visited: null, guess: null, total: 0, n: 0, rightCount: 0, heading: 0, done: false, live: null };

async function startGame(mode = 'daily') {
  const t = today();
  game.mode = mode;
  if (mode === 'daily') {
    game.queue = (await db.allRounds()).filter((r) => !r.played && r.unlockDate !== 'pending' && r.unlockDate <= t && r.frames?.length);
    if (!game.queue.length) return;
  } else {
    await renderSettings();
    game.queue = [];
    game.live = { buffer: [], ctl: new AbortController(), filling: null, failed: null, taken: [] };
    const played = (await db.allRounds()).slice(-60);
    game.live.taken = played.map((r) => ({ lat: r.lat, lon: r.lon }));
  }
  game.total = 0; game.n = 0; game.rightCount = 0;
  show('game');
  if (!viewer) {
    try { viewer = new PanoViewer($('pano'), onView); }
    catch (e) { toast('This device can’t show 360° photos (WebGL missing).'); show('home'); return; }
  }
  if (!map) {
    map = new WorldMap($('map'), { onTap: placeGuess });
    if (world) map.setData(world.countries, world.places);
  }
  nextRound();
}

async function nextRound() {
  let r;
  if (game.mode === 'live') {
    r = await nextLiveRound();
    if (!r) return;
  } else {
    r = game.queue.shift();
    if (!r) {
      if (game.n >= 3 && game.rightCount === game.n) {
        const a = await awardPerfectDay();
        if (a) await celebrate(a.icon, a.name, a.desc);
      }
      toast(`Day done! ${game.total.toLocaleString()} points`); show('home'); refreshHome(); return;
    }
  }
  game.round = r; game.n++;
  game.cur = r.centreIdx; game.visited = new Set([r.centreIdx]);
  game.guess = null; game.done = false;
  $('roundPill').textContent = game.mode === 'live' ? `Round ${game.n} · 🌐` : `Round ${game.n} of ${game.n + game.queue.length}`;
  $('scorePill').textContent = `${game.total.toLocaleString()} pts`;
  $('guessFoot').hidden = false; $('resultFoot').hidden = true;
  $('guessBtn').disabled = true; $('guessBtn').textContent = 'Tap the map to place a pin';
  $('mapSheet').classList.remove('open', 'full');
  $('game').classList.remove('map-open');
  map.markers = []; map.lines = [];
  map.cx = 0.5; map.cy = 0.42; map.z = 1; map.draw();
  viewer.yaw = 0; viewer.pitch = 0; viewer.fov = 1.6;
  game.heading = r.frames[game.cur].compass;
  await showFrame(game.cur);
}

async function showFrame(i) {
  const f = game.round.frames[i];
  const blob = await db.getImage(f.key);
  if (!blob) { toast('Photo missing'); return; }
  // keep looking the same way in the world when stepping
  viewer.yaw = ((game.heading - f.compass) * Math.PI) / 180;
  game.cur = i;
  await viewer.setImage(blob);
  updateSteps();
}

function stepsLeft() { return game.round.stepsAllowed - (game.visited.size - 1); }

function canGo(i) {
  const fr = game.round.frames;
  return i >= 0 && i < fr.length && (game.visited.has(i) || stepsLeft() > 0);
}

function go(dir) {
  const i = game.cur + dir;
  if (!canGo(i)) { if (i >= 0 && i < game.round.frames.length) toast('No steps left — make your guess!'); return; }
  game.visited.add(i);
  showFrame(i);
}

function onView(v) {
  if (!game.round) return;
  const f = game.round.frames[game.cur];
  game.heading = (f.compass + (v.yaw * 180) / Math.PI + 360) % 360;
  $('compass').style.transform = `rotate(${-game.heading}deg)`;
  updateSteps();
}

function updateSteps() {
  if (!game.round) return;
  const fr = game.round.frames, i = game.cur;
  const setBtn = (btn, j) => {
    const ok = j >= 0 && j < fr.length;
    btn.hidden = !ok;
    if (!ok) return;
    btn.disabled = !canGo(j);
    const rel = bearingDeg(fr[i], fr[j]) - game.heading;
    btn.querySelector('.arrow').style.transform = `rotate(${rel}deg)`;
  };
  setBtn($('stepBack'), i - 1);
  setBtn($('stepFwd'), i + 1);
  const left = stepsLeft();
  $('stepsPill').textContent = game.round.stepsAllowed ? `${left} step${left === 1 ? '' : 's'} left` : 'No moving';
  $('stepsPill').hidden = fr.length < 2;
}

function placeGuess(p) {
  if (game.done) return;
  game.guess = p;
  map.markers = [{ ...p, color: '#e07a3f' }];
  map.draw();
  $('guessBtn').disabled = false;
  $('guessBtn').textContent = 'Guess';
}

async function submitGuess() {
  if (!game.guess || game.done) return;
  game.done = true;
  const r = game.round;
  const truth = { lat: r.lat, lon: r.lon };
  const km = distanceKm(game.guess, truth);
  const pts = score(km);
  game.total += pts;
  r.played = true;
  const stepsUsed = game.visited.size - 1;
  r.result = { guess: game.guess, km, points: pts, stepsUsed, playedOn: today() };
  if (game.mode === 'live') {
    for (const f of r.frames) await db.deleteImage(f.key);
    r.frames = []; r.bytes = 0; r.unlockDate = today(); r.live = true;
  }
  await db.putRound(r);
  const truthCountry = countryAt(world, truth) || countryNear(truth);
  const guessCountry = countryAt(world, game.guess);
  const prog = await record({ km, points: pts, stepsUsed, truthCountry, guessCountry });
  if (prog.right) game.rightCount++;
  const v = $('resVerdict');
  v.className = 'verdict ' + (prog.right ? 'right' : 'wrong');
  v.textContent = prog.right
    ? (prog.sameCountry ? `✓ Right country!${prog.progress.streak >= 2 ? ` 🔥 ${prog.progress.streak} in a row` : ''}` : `✓ Close enough to count!${prog.progress.streak >= 2 ? ` 🔥 ${prog.progress.streak} in a row` : ''}`)
    : `✗ ${truthCountry?.name ? `It was ${truthCountry.name}` : 'Not this time'}`;
  setTimeout(async () => {
    if (prog.rankUp) await celebrate(prog.rankUp.icon, `Promoted to ${prog.rankUp.name}!`, `${prog.progress.correct} right answers and counting.`);
    for (const a of prog.earned) await celebrate(a.icon, a.tier === 'legendary' ? `LEGENDARY: ${a.name}` : a.tier === 'hard' ? `Hard award: ${a.name}` : a.name, a.desc, a.tier);
  }, 900);

  map.markers = [{ ...game.guess, color: '#e07a3f' }, { ...truth, color: '#1d7a46' }];
  map.lines = [[game.guess, truth]];
  map.fitTo([game.guess, truth]);
  $('guessFoot').hidden = true; $('resultFoot').hidden = false;
  $('resKm').textContent = `${formatKm(km)} away · ${pts.toLocaleString()} pts`;
  $('resPlace').textContent = nearestPlace(truth);
  $('resBar').style.width = '0';
  requestAnimationFrame(() => { $('resBar').style.width = `${(pts / 5000) * 100}%`; });
  const when = r.capturedAt ? ` · ${new Date(r.capturedAt).getFullYear()}` : '';
  $('resCredit').innerHTML = `Photo: ${escapeHtml(r.creator)} on <a href="https://www.mapillary.com/app/?pKey=${r.imageId}" target="_blank" rel="noopener">Mapillary</a>${when} · CC BY-SA`;
  $('scorePill').textContent = `${game.total.toLocaleString()} pts`;
  $('nextBtn').textContent = game.mode === 'live' || game.queue.length ? 'Next' : 'Finish';
}

function countryNear(p) {
  const fs = world?.places?.features;
  if (!fs?.length) return null;
  let best = null, bd = Infinity;
  for (const f of fs) {
    const [lon, lat] = f.geometry.coordinates;
    const d = distanceKm(p, { lat, lon });
    if (d < bd) { bd = d; best = { lat, lon }; }
  }
  return bd < 80 ? countryAt(world, best) : null;
}

function celebrate(icon, title, desc, tier = '') {
  return new Promise((resolve) => {
    $('celebrate').className = 'celebrate ' + tier;
    $('celIcon').textContent = icon; $('celTitle').textContent = title; $('celDesc').textContent = desc;
    $('celebrate').hidden = false;
    $('celOk').onclick = () => { $('celebrate').hidden = true; resolve(); };
  });
}

// ---------- Online (unlimited) mode ----------
function fillLive() {
  const L = game.live;
  if (!L || L.filling) return L?.filling;
  L.filling = (async () => {
    try {
      if (!world || !world.v) { world = await ensureWorld(L.ctl.signal, () => {}); if (map) map.setData(world.countries, world.places); }
      while (L.buffer.length < 2 && !L.ctl.signal.aborted) {
        let r = null, tries = 0;
        while (!r && tries++ < 400 && !L.ctl.signal.aborted) {
          r = await findRound({ ...settings, token: tokenOf() }, world, L.taken, L.ctl.signal);
        }
        if (!r) throw new Error('Could not find a place, try again');
        L.taken.push({ lat: r.lat, lon: r.lon });
        L.buffer.push(r);
      }
    } catch (e) { if (e.name !== 'AbortError') L.failed = e; }
    finally { L.filling = null; }
  })();
  return L.filling;
}

async function nextLiveRound() {
  const L = game.live;
  if (!L.buffer.length) {
    $('loading').hidden = false;
    $('loadingText').textContent = game.n ? 'Finding a new place…' : 'Setting sail… finding your first place';
    L.failed = null;
    await fillLive();
    $('loading').hidden = true;
    if (!L.buffer.length) {
      if (game.live === L) { toast(L.failed ? `Couldn’t load a round: ${L.failed.message}` : 'Connection lost'); leaveGame(); }
      return null;
    }
  }
  const r = L.buffer.shift();
  fillLive(); // prefetch the next one in the background
  return r;
}

async function leaveGame() {
  if (game.mode === 'live' && game.round && !game.round.played) for (const f of game.round.frames) await db.deleteImage(f.key);
  game.round = null;
  if (game.live) {
    const L = game.live; game.live = null;
    L.ctl.abort();
    for (const r of L.buffer) for (const f of r.frames) await db.deleteImage(f.key);
  }
  $('loading').hidden = true;
  show('home'); refreshHome();
}

function nearestPlace(p) {
  const fs = world?.places?.features;
  if (!fs?.length) return `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
  let best = null, bd = Infinity;
  for (const f of fs) {
    const [lon, lat] = f.geometry.coordinates;
    const d = distanceKm(p, { lat, lon });
    if (d < bd) { bd = d; best = f.properties; }
  }
  const where = best.country && best.country !== best.name ? `${best.name}, ${best.country}` : best.name;
  return bd < 15 ? `In or near ${where}` : `${formatKm(bd)} from ${where}`;
}

// ---------- Utilities ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 'game') requestAnimationFrame(() => viewer?.draw());
}
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Wire up ----------
function bind() {
  ['budget', 'days', 'steps', 'quality'].forEach((id) => $(id).addEventListener('input', renderSettings));
  $('token').addEventListener('change', renderSettings);
  $('syncBtn').onclick = startSync;
  $('cancelBtn').onclick = () => syncCtl?.abort();
  $('cleanBtn').onclick = () => cleanPlayed(false);
  $('wipeBtn').onclick = async () => {
    if (!confirm('Delete all rounds, photos and scores on this device?')) return;
    await db.clearAll(); toast('Cleared'); refreshHome();
  };
  $('playBtn').onclick = () => startGame('daily');
  $('onlineBtn').onclick = () => startGame('live');
  $('homeBtn').onclick = leaveGame;
  window.addEventListener('online', refreshHome);
  window.addEventListener('offline', refreshHome);
  $('stepBack').onclick = () => go(-1);
  $('stepFwd').onclick = () => go(1);
  $('openMap').onclick = () => { $('mapSheet').classList.add('open'); $('game').classList.add('map-open'); requestAnimationFrame(() => map.draw()); };
  $('closeMap').onclick = () => { $('mapSheet').classList.remove('open', 'full'); $('game').classList.remove('map-open'); };
  $('zoomIn').onclick = () => map.zoomBy(1);
  $('zoomOut').onclick = () => map.zoomBy(-1);
  $('guessBtn').onclick = submitGuess;
  $('nextBtn').onclick = nextRound;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('home').classList.contains('active')) refreshHome(); });
}

async function init() {
  bind();
  await schedulePending(+(await db.getMeta('settings', {}))?.days || 7); // in case a sync was interrupted
  world = await db.getMeta('world');
  await db.removeOrphanImages().catch(() => {});
  await loadSettings();
  await refreshHome();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (new URLSearchParams(location.search).has('demo')) {
    const { loadDemo } = await import('./demo.js');
    await loadDemo();
    world = await db.getMeta('world');
    refreshHome();
  }
}
init();
