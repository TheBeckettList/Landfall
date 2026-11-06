# Landfall

An offline geography game for people who are often offline (made for a sailor).
When you have internet, it downloads a batch of 360° street-level photos from
[Mapillary](https://www.mapillary.com). Then it unlocks a few rounds each day for
as long as you choose. Look around, walk a few steps along the road, drop a pin on
the world map, and see how close you got.

No build step, no dependencies, no server. It's just static files.

## Features
- **Works fully offline** once installed: the app shell is cached by a service worker, and the photos and map are kept in IndexedDB.
- **Always-full bank:** 10 rounds are always kept ready. Whenever there's internet the bank tops itself up after every round, so play is unlimited while online.
- **Trip downloads:** pick how many rounds to download and how many unlock per day. The app shows how many days that lasts and roughly how much data it needs.
- **Steps:** each round includes 5 photos forward and 5 back along the same road, at least ~36 m apart, so she can walk the whole stretch.
- **Offline world map:** Natural Earth 1:50m country borders and names, state and province lines for large countries (shown once you zoom in) and ~1,250 towns. It downloads once (~6 MB).
- **Always sharp:** 2048 px 360° photos (≈0.5 MB each, ≈4–5 MB per round with steps).
- **Space saving:** photos from rounds you've played are deleted automatically at the next sync, and your scores are kept.
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

## 4. Before a passage
Open **Download rounds for a trip**, set *Rounds to download* and *Rounds per day*, and tap **Download**. Keep the app open on screen until it finishes. An optional personal token is under *Advanced*. Rough guide: 100 rounds ≈ 480 MB.

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
