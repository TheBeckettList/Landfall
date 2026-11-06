# Landfall

An offline geography game for people who are often offline (made for a sailor).
When you have internet, it downloads a batch of 360° street-level photos from
[Mapillary](https://www.mapillary.com). Then it unlocks a few rounds each day for
as long as you choose. Look around, walk a few steps along the road, drop a pin on
the world map, and see how close you got.

No build step, no dependencies, no server. It's just static files.

## Features
- **Works fully offline** once installed: the app shell is cached by a service worker, and the photos and map are kept in IndexedDB.
- **Data budget per sync** (default 500 MB) spread over a chosen number of days (default 7).
- **Steps:** each round caches up to *N* photos forward and back along the same road, and you get *N* moves per round.
- **Offline world map** (Natural Earth countries and ~1,250 towns), downloaded once on the first sync (~2 MB).
- **Photo quality:** "Sharp" uses 2048 px panoramas at ≈0.5 MB each. "Data saver" uses 1024 px at ≈0.15 MB each.
- **Space saving:** photos from rounds you've played are deleted automatically at the next sync, and your scores are kept.
- **Unlimited online play:** when there's internet, a "play unlimited rounds" button streams fresh rounds live (the next one preloads while she plays), and they don't use up her stored offline rounds.
- **Ranks and awards:** a guess counts as *right* if it's in the correct country or within 250 km. Right answers move her up the ranks: Deckhand → Able Seaman → Bosun → Navigator → First Mate → Captain → Commodore → Admiral → Sea Legend. There are also 34 awards in three tiers: Everyday (17), Hard (8) and Legendary (9), which are almost impossible, such as 50 right countries in a row, landing within 1 km without taking a step, or 100 days in a row.
- Works on phone and tablet with touch drag, pinch-zoom and a docked map on wide screens.

**Play it:** https://thebeckettlist.github.io/landfall/

## 1. Host it (free, one time)
A service worker needs HTTPS, so put the folder on any static host:

**GitHub Pages:** create a repo, upload these files, then go to Settings → Pages → Deploy from branch → `main` / root.
The app will be at `https://<you>.github.io/<repo>/`.

Netlify Drop, Cloudflare Pages and similar hosts work too.

## 2. Mapillary token (already built in)
A read-only client token is included in `js/config.js`, so players don't need one. If it ever stops working, make a new one as described below and either update `js/config.js` or paste it under Sync → Advanced.

1. Sign in at mapillary.com, then go to **Dashboard → Developers → Register application**.
2. Copy the **Client Token**. It starts with `MLY|`.

## 3. Install on the phone or tablet
- **iPhone / iPad:** open the URL in Safari, tap Share, then **Add to Home Screen**.
  **Do the sync from the home-screen app, not from Safari.** They use separate storage, and iOS keeps a home-screen app's data much more reliably.
- **Android:** open it in Chrome, open the menu, then tap **Install app**.

Each device keeps its own rounds, so sync on each device you want to play on.

## 4. Sync before a passage
Open Landfall, then open **Sync new rounds**. Paste the token, set the data budget, days and steps, and tap
**Download rounds**. Keep the app open on screen until the sync finishes. A partial sync still keeps every round it finished.

Rough sizes with "Sharp" quality and 3 steps (7 photos per round): **≈3.5 MB per round, so 500 MB ≈ 140 rounds**.
The estimate in the app corrects itself after the first sync.

## Try it without a token
Open `index.html?demo` to load 5 fake rounds for testing the viewer, steps and map.

## Files
| File | What it does |
|---|---|
| `js/sync.js` | Mapillary search, walks along the capture sequence for steps, downloads within budget, schedules unlock dates |
| `js/viewer.js` | WebGL 360° panorama viewer (drag, pinch) |
| `js/map.js` | Canvas world map (Web Mercator), pins, great-circle line |
| `js/app.js` | Screens, game flow, scoring (5000 × e^(−km/2000)) |
| `js/progress.js` | Ranks, awards, offline country lookup |
| `js/db.js` | IndexedDB storage |
| `sw.js` | Offline caching of the app itself (bump `VERSION` after editing files) |

## Credits and licence
Street-level imagery © Mapillary contributors, CC BY-SA 4.0. Each result screen credits the photographer and links to the photo.
Map data: Natural Earth (public domain). The app code is MIT-licensed (see `LICENSE`).
