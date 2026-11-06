// Offline world map on a canvas (Web Mercator). Countries + cities come from
// Natural Earth GeoJSON cached in IndexedDB during sync.
const TILE = 256;
const MAXLAT = 85.05;

function mx(lon) { return (lon + 180) / 360; }
function my(lat) {
  const s = Math.sin((Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
function unX(x) { return x * 360 - 180; }
function unY(y) { const n = Math.PI - 2 * Math.PI * y; return (180 / Math.PI) * Math.atan(Math.sinh(n)); }

export class WorldMap {
  constructor(canvas, { onTap } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTap = onTap || (() => {});
    this.cx = 0.5; this.cy = 0.42; this.z = 1;
    this.rings = []; // projected rings [Float32Array x,y,...]
    this.stateLines = [];
    this.labels = [];
    this.cities = [];
    this.markers = [];
    this.lines = [];
    this._bind();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(world) {
    const { countries, places, states } = world || {};
    this.worldV = world?.v;
    const proj = (ring) => {
      const a = new Float32Array(ring.length * 2);
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      ring.forEach(([lo, la], i) => {
        const x = mx(lo), y = my(la);
        a[i * 2] = x; a[i * 2 + 1] = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      });
      a.bb = [x0, y0, x1, y1];
      return a;
    };
    this.rings = [];
    this.labels = [];
    for (const f of countries?.features || []) {
      const g = f.geometry; if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) for (const ring of poly) this.rings.push(proj(ring));
      const p = f.properties || {};
      if (p.label && p.name) this.labels.push({ x: mx(p.label[0]), y: my(p.label[1]), name: p.name.toUpperCase(), rank: p.rank ?? 5 });
    }
    this.labels.sort((a, b) => a.rank - b.rank);
    this.stateLines = [];
    for (const f of states?.features || []) {
      const g = f.geometry; if (!g) continue;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of lines) this.stateLines.push(proj(l));
    }
    this.cities = [];
    for (const f of places?.features || []) {
      const [lo, la] = f.geometry.coordinates;
      const p = f.properties || {};
      this.cities.push({ x: mx(lo), y: my(la), name: p.name, rank: p.scalerank ?? 5 });
    }
    this.cities.sort((a, b) => a.rank - b.rank);
    this.draw();
  }

  // Add a projected path to the canvas, skipping offscreen shapes and sub-pixel detail.
  _path(ctx, r, s, ox, oy, W, H, close) {
    const bb = r.bb;
    if (bb[2] * s + ox < -2 || bb[0] * s + ox > W + 2 || bb[3] * s + oy < -2 || bb[1] * s + oy > H + 2) return;
    let lx = r[0] * s + ox, ly = r[1] * s + oy;
    ctx.moveTo(lx, ly);
    const n = r.length;
    for (let i = 2; i < n; i += 2) {
      const x = r[i] * s + ox, y = r[i + 1] * s + oy;
      if (i < n - 2 && Math.abs(x - lx) < 0.8 && Math.abs(y - ly) < 0.8) continue;
      ctx.lineTo(x, y); lx = x; ly = y;
    }
    if (close) ctx.closePath();
  }

  get scale() { return TILE * Math.pow(2, this.z); }

  toScreen(x, y) {
    const W = this.c.clientWidth, H = this.c.clientHeight, s = this.scale;
    return [(x - this.cx) * s + W / 2, (y - this.cy) * s + H / 2];
  }
  toWorld(px, py) {
    const W = this.c.clientWidth, H = this.c.clientHeight, s = this.scale;
    return [(px - W / 2) / s + this.cx, (py - H / 2) / s + this.cy];
  }

  fitTo(points) {
    if (!points.length) return;
    const xs = points.map((p) => mx(p.lon)), ys = points.map((p) => my(p.lat));
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 - x0 > 0.5) { // shorter way round the antimeridian
      const shifted = xs.map((x) => (x < 0.5 ? x + 1 : x));
      x0 = Math.min(...shifted); x1 = Math.max(...shifted);
    }
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
    const W = this.c.clientWidth || 300, H = this.c.clientHeight || 300;
    const span = Math.max((x1 - x0) / W, (y1 - y0) / H, 1e-6);
    this.z = Math.max(0.5, Math.min(14, Math.log2(0.7 / (span * TILE))));
    this.draw();
  }

  _clamp() {
    const H = this.c.clientHeight || 1;
    this.z = Math.max(Math.log2((H * 0.9) / TILE) - 0.2, Math.min(15, this.z));
    this.cx = ((this.cx % 1) + 1) % 1;
    const half = H / 2 / this.scale;
    this.cy = half > 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, this.cy));
  }

  draw() {
    const c = this.c, ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    this._clamp();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#9cc3d9';
    ctx.fillRect(0, 0, W, H);
    const s = this.scale;
    const offsets = [-1, 0, 1];

    // graticule
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const o of offsets) {
      for (let lo = -180; lo <= 180; lo += 30) { const [x] = this.toScreen(mx(lo) + o, 0); ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    }
    for (let la = -60; la <= 80; la += 20) { const [, y] = this.toScreen(0, my(la)); ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // land
    if (this.rings.length) {
      const copies = offsets.map((o) => [(o - this.cx) * s + W / 2, -this.cy * s + H / 2]).filter(([ox]) => ox < W && ox + s > 0);
      ctx.beginPath();
      for (const [ox, oy] of copies) for (const r of this.rings) this._path(ctx, r, s, ox, oy, W, H, true);
      ctx.fillStyle = '#f2efe6';
      ctx.fill('evenodd');
      // state / province lines once zoomed in a little
      if (this.stateLines.length && this.z >= 2.2) {
        ctx.beginPath();
        for (const [ox, oy] of copies) for (const l of this.stateLines) this._path(ctx, l, s, ox, oy, W, H, false);
        ctx.strokeStyle = `rgba(150, 130, 105, ${Math.min(0.75, (this.z - 2.2) * 0.5 + 0.25)})`;
        ctx.lineWidth = 0.6;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      for (const [ox, oy] of copies) for (const r of this.rings) this._path(ctx, r, s, ox, oy, W, H, true);
      ctx.strokeStyle = '#a8957a';
      ctx.lineWidth = this.z < 3 ? 0.7 : 1.1;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#35556a';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('World map downloads with your first sync', W / 2, H / 2);
    }

    const placed = [];
    // country names, biggest first, fading out once you're zoomed right in
    if (this.labels?.length && this.z < 7) {
      const maxRank = this.z < 1.5 ? 2 : this.z < 2.5 ? 3 : this.z < 3.5 ? 4 : this.z < 4.5 ? 5 : 10;
      ctx.font = `600 ${this.z < 3 ? 10 : 11}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(120, 100, 75, 0.85)';
      for (const lb of this.labels) {
        if (lb.rank > maxRank) continue;
        for (const o of offsets) {
          const [x, y] = this.toScreen(lb.x + o, lb.y);
          if (x < -80 || x > W + 80 || y < -10 || y > H + 10) continue;
          const w = ctx.measureText(lb.name).width;
          if (placed.some((p) => Math.abs(p[0] - x) < (w + p[2]) / 2 + 4 && Math.abs(p[1] - y) < 13)) continue;
          placed.push([x, y, w]);
          ctx.fillText(lb.name, x, y);
        }
      }
    }

    // cities: show more as you zoom in
    const maxCity = this.z < 2 ? 1 : this.z < 3 ? 2 : this.z < 4 ? 4 : this.z < 5 ? 6 : 10;
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    for (const ct of this.cities) {
      if (ct.rank > maxCity) continue;
      for (const o of offsets) {
        const [x, y] = this.toScreen(ct.x + o, ct.y);
        if (x < -50 || x > W + 50 || y < -20 || y > H + 20) continue;
        const w = ctx.measureText(ct.name).width;
        const cx = x + 4 + w / 2;
        if (placed.some((p) => Math.abs(p[0] - cx) < (w + p[2]) / 2 + 4 && Math.abs(p[1] - y) < 14)) continue;
        placed.push([cx, y, w]);
        ctx.fillStyle = '#5b4a3a';
        ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill();
        ctx.fillStyle = '#3e3328';
        ctx.fillText(ct.name, x + 4, y + 4);
      }
    }

    // lines (great-circle, sampled)
    for (const ln of this.lines) {
      ctx.strokeStyle = '#1d3557';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      const pts = greatCircle(ln[0], ln[1], 64);
      let prevX = null, off = 0;
      pts.forEach((p, i) => {
        let x = mx(p.lon);
        if (prevX !== null) { while (x - prevX > 0.5) x -= 1; while (x - prevX < -0.5) x += 1; }
        else off = nearestOffset(x, this.cx);
        prevX = x;
        const [sx, sy] = this.toScreen(x + off, my(p.lat));
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // markers
    for (const m of this.markers) {
      const x0 = mx(m.lon);
      const [x, y] = this.toScreen(x0 + nearestOffset(x0, this.cx), my(m.lat));
      ctx.fillStyle = m.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y - 16, 8, Math.PI * 0.8, Math.PI * 2.2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y - 16, 3, 0, 7); ctx.fill();
    }
  }

  _bind() {
    const c = this.c;
    const pts = new Map();
    let pinch = null, tap = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tap = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.z };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      if (tap && Math.hypot(cur.x - tap.x, cur.y - tap.y) > 8) tap = null;
      if (pts.size === 1) {
        this.cx -= (cur.x - prev.x) / this.scale;
        this.cy -= (cur.y - prev.y) / this.scale;
        this.draw();
      } else if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const r = c.getBoundingClientRect();
        const mid = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
        this._zoomAt(pinch.z + Math.log2(Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) - this.z, mid);
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (tap && pts.size === 0 && Date.now() - tap.t < 500) {
        const r = c.getBoundingClientRect();
        const [x, y] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        const lon = unX(((x % 1) + 1) % 1);
        this.onTap({ lat: unY(y), lon });
      }
      tap = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => { tap = null; up(e); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this._zoomAt(-e.deltaY * 0.002, [e.clientX - r.left, e.clientY - r.top]);
    }, { passive: false });
  }

  _zoomAt(dz, [px, py]) {
    const before = this.toWorld(px, py);
    this.z += dz;
    this._clamp();
    const after = this.toWorld(px, py);
    this.cx += before[0] - after[0];
    this.cy += before[1] - after[1];
    this.draw();
  }

  zoomBy(dz) { this._zoomAt(dz, [this.c.clientWidth / 2, this.c.clientHeight / 2]); }
}

function nearestOffset(x, cx) {
  let best = 0;
  for (const o of [-1, 1]) if (Math.abs(x + o - cx) < Math.abs(x + best - cx)) best = o;
  return best;
}

function greatCircle(a, b, n) {
  const r = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a.lat * r, a.lon * r, b.lat * r, b.lon * r];
  const v1 = [Math.cos(la1) * Math.cos(lo1), Math.cos(la1) * Math.sin(lo1), Math.sin(la1)];
  const v2 = [Math.cos(la2) * Math.cos(lo2), Math.cos(la2) * Math.sin(lo2), Math.sin(la2)];
  const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const om = Math.acos(dot);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v;
    if (om < 1e-6) v = v1;
    else {
      const s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om);
      v = [s1 * v1[0] + s2 * v2[0], s1 * v1[1] + s2 * v2[1], s1 * v1[2] + s2 * v2[2]];
    }
    out.push({ lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) / r, lon: Math.atan2(v[1], v[0]) / r });
  }
  return out;
}
