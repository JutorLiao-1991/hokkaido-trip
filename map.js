/* map.js — 道央地圖側欄：我在哪、下一站去哪。
   地圖圖磚用國土地理院「地理院タイル」（免金鑰，日文標示和現場看板一致）。
   投影、圖磚、取景是純函式（tests/map.test.js 會測）；DOM 控制在 init。
   不依賴任何外部套件：單指拖曳、雙指縮放、雙擊放大、滾輪縮放都自己處理。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.HKMap = factory(root);
})(typeof self !== 'undefined' ? self : this, function (rootArg) {
  'use strict';
  const root = rootArg || (typeof self !== 'undefined' ? self : globalThis);

  const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
  const CACHE_NAME = 'hk-tiles';
  const BOUNDS = { s: 42.30, n: 44.00, w: 140.20, e: 142.95 };   // 道央（含小樽、新千歲、旭川）加一圈邊
  const REGION = { s: 42.62, n: 43.88, w: 140.85, e: 142.62 };   // 離線存圖的範圍
  const ZMIN = 7.5, ZMAX = 17.5;
  const LANDMARKS = [ // 連不上圖磚時，至少看得到大概方位
    ['札幌', 43.0687, 141.3507], ['小樽', 43.1977, 140.9937], ['新千歲空港', 42.7876, 141.6804],
    ['北廣島', 42.9857, 141.5635], ['旭川', 43.7627, 142.3577]
  ];

  /* ---------- 純函式 ---------- */
  const pw = z => 256 * Math.pow(2, z);
  const lngX = (lng, z) => (lng + 180) / 360 * pw(z);
  function latY(lat, z) { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * pw(z); }
  const xLng = (x, z) => x / pw(z) * 360 - 180;
  function yLat(y, z) { const n = Math.PI - 2 * Math.PI * y / pw(z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const inBounds = p => !!p && p.lat >= BOUNDS.s && p.lat <= BOUNDS.n && p.lng >= BOUNDS.w && p.lng <= BOUNDS.e;
  function distKm(a, b) {
    const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const tileUrl = (z, x, y) => TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const tzOf = z => clamp(Math.round(z), 5, 18);

  // 螢幕座標 <-> 經緯度（c = 畫面中心，z = 縮放，w/h = 畫面大小）
  function toXY(c, z, w, h, lat, lng) { return { x: w / 2 + lngX(lng, z) - lngX(c.lng, z), y: h / 2 + latY(lat, z) - latY(c.lat, z) }; }
  function toLL(c, z, w, h, x, y) { return { lat: yLat(latY(c.lat, z) + (y - h / 2), z), lng: xLng(lngX(c.lng, z) + (x - w / 2), z) }; }
  function clampCenter(c) { return { lat: clamp(c.lat, BOUNDS.s, BOUNDS.n), lng: clamp(c.lng, BOUNDS.w, BOUNDS.e) }; }

  // 目前畫面需要哪些圖磚（整數縮放層 tz，依小數縮放放大縮小）
  function tilesFor(c, z, w, h) {
    const tz = tzOf(z), scale = Math.pow(2, z - tz), size = 256 * scale;
    const cx = lngX(c.lng, tz), cy = latY(c.lat, tz), hw = w / 2 / scale, hh = h / 2 / scale;
    const n = Math.pow(2, tz), x0 = Math.floor((cx - hw) / 256), x1 = Math.floor((cx + hw) / 256), y0 = Math.floor((cy - hh) / 256), y1 = Math.floor((cy + hh) / 256);
    const list = [];
    for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(n - 1, x1); tx++) {
        list.push({ key: tz + '/' + tx + '/' + ty, z: tz, x: tx, y: ty, left: w / 2 + (tx * 256 - cx) * scale, top: h / 2 + (ty * 256 - cy) * scale, size: size, url: tileUrl(tz, tx, ty) });
      }
    }
    return { tz: tz, scale: scale, list: list };
  }

  // 把一組點都放進畫面：回傳中心與縮放
  function fitView(pts, w, h, pad) {
    pad = pad == null ? 44 : pad;
    if (!pts || !pts.length) return { lat: 43.1, lng: 141.5, z: 8.6 };
    let s = 90, n = -90, west = 181, e = -181;
    pts.forEach(p => { s = Math.min(s, p.lat); n = Math.max(n, p.lat); west = Math.min(west, p.lng); e = Math.max(e, p.lng); });
    const spanX = lngX(e, 0) - lngX(west, 0), spanY = latY(s, 0) - latY(n, 0);
    const availX = Math.max(60, w - 2 * pad), availY = Math.max(60, h - 2 * pad);
    let z = 15;
    if (spanX > 1e-9 || spanY > 1e-9) z = Math.min(spanX > 1e-9 ? Math.log2(availX / spanX) : 99, spanY > 1e-9 ? Math.log2(availY / spanY) : 99);
    z = clamp(z, ZMIN, 15.5);
    const midX = (lngX(west, 0) + lngX(e, 0)) / 2, midY = (latY(s, 0) + latY(n, 0)) / 2;
    return { lat: yLat(midY, 0), lng: xLng(midX, 0), z: z };
  }

  // 離線存圖：要抓哪些圖磚（區域低倍率＋各據點周邊高倍率）
  function tileRange(b, z) {
    const n = Math.pow(2, z), x0 = Math.floor(lngX(b.w, z) / 256), x1 = Math.floor(lngX(b.e, z) / 256), y0 = Math.floor(latY(b.n, z) / 256), y1 = Math.floor(latY(b.s, z) / 256);
    const out = [];
    for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) out.push([z, x, y]);
    return out;
  }
  function prefetchList(points) {
    const seen = {}, out = [];
    const add = t => { const k = t.join('/'); if (!seen[k]) { seen[k] = 1; out.push(t); } };
    for (let z = 8; z <= 12; z++) tileRange(REGION, z).forEach(add);
    (points || []).forEach(p => {
      for (let z = 13; z <= 15; z++) {
        const tx = Math.floor(lngX(p.lng, z) / 256), ty = Math.floor(latY(p.lat, z) / 256);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add([z, tx + dx, ty + dy]);
      }
    });
    return out;
  }
  const fmtKm = km => km < 1 ? Math.round(km * 10) * 100 + ' 公尺' : (km < 10 ? km.toFixed(1) : Math.round(km)) + ' 公里';

  /* ---------- DOM 控制 ---------- */
  // opts: { doc, getModel(), navUrl(pt), copy(text), toast(msg), wantGeo(), setDay(date) }
  function init(opts) {
    const doc = opts.doc, $ = id => doc.getElementById(id);
    const el = { mp: $('mp'), panel: $('mp-panel'), view: $('mp-view'), tiles: $('mp-tiles'), marks: $('mp-marks'), svg: $('mp-lines'), info: $('mp-info'), days: $('mp-days'), tab: $('mp-tab'), labs: $('mp-labs') };
    if (!el.mp || !el.view) return null;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const st = { open: false, c: { lat: 43.1, lng: 141.5 }, z: 8.6, w: 0, h: 0, tiles: new Map(), pins: new Map(), model: null, sel: null, wantMe: false, raf: 0, dl: null, lastDay: null };
    const reduce = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function size() { st.w = el.view.clientWidth; st.h = el.view.clientHeight; }
    function selPt() { const m = st.model; return m && m.pts.find(p => p.id === st.sel) || null; }
    function me() { const m = st.model; return m && m.pos && inBounds(m.pos) ? m.pos : null; }

    /* 取景 */
    function fitAll(extra) {
      size(); const m = st.model; if (!m) return;
      const pts = m.pts.map(p => ({ lat: p.lat, lng: p.lng })); if (me()) pts.push({ lat: m.pos.lat, lng: m.pos.lng });
      (extra || []).forEach(p => pts.push(p));
      const f = fitView(pts, st.w, st.h); st.c = { lat: f.lat, lng: f.lng }; st.z = f.z; schedule();
    }
    function fitNext() {
      size(); const m = st.model; if (!m) return;
      const nx = m.pts.find(p => p.id === m.nextId) || m.pts.find(p => p.id === m.curId) || m.pts[0];
      if (!nx) { fitAll(); return; }
      const pts = [{ lat: nx.lat, lng: nx.lng }]; if (me()) pts.push({ lat: m.pos.lat, lng: m.pos.lng });
      const f = fitView(pts, st.w, st.h, 70); st.c = { lat: f.lat, lng: f.lng }; st.z = Math.min(f.z, 15); schedule();
    }
    function centerOn(p, z) { size(); st.c = clampCenter({ lat: p.lat, lng: p.lng }); st.z = clamp(z || Math.max(st.z, 14), ZMIN, ZMAX); schedule(); }
    function zoomAt(nz, sx, sy) {
      nz = clamp(nz, ZMIN, ZMAX);
      const ll = toLL(st.c, st.z, st.w, st.h, sx, sy); st.z = nz;
      st.c = clampCenter({ lat: yLat(latY(ll.lat, nz) - (sy - st.h / 2), nz), lng: xLng(lngX(ll.lng, nz) - (sx - st.w / 2), nz) }); schedule();
    }

    /* 繪製 */
    function schedule() { if (!st.raf) st.raf = root.requestAnimationFrame(() => { st.raf = 0; draw(); }); }
    function drawTiles() {
      const t = tilesFor(st.c, st.z, st.w, st.h), need = {};
      if (t.list.length > 80) return;
      t.list.forEach(it => {
        need[it.key] = 1;
        let img = st.tiles.get(it.key);
        if (!img) {
          img = doc.createElement('img'); img.className = 'mp-t'; img.alt = ''; img.draggable = false; img.decoding = 'async';
          img.onload = () => { img.classList.add('ld'); hint(); };
          img.onerror = () => { img.style.display = 'none'; img.dataset.err = '1'; hint(); };
          img.src = it.url; el.tiles.appendChild(img); st.tiles.set(it.key, img);
        }
        const s = it.size + 0.6;
        img.style.width = s + 'px'; img.style.height = s + 'px'; img.style.transform = 'translate3d(' + it.left.toFixed(1) + 'px,' + it.top.toFixed(1) + 'px,0)';
      });
      st.tiles.forEach((img, k) => { if (!need[k]) { img.remove(); st.tiles.delete(k); } });
    }
    // 目前畫面上的圖磚幾乎都載不到（沒訊號、或放大到沒存的倍率）→ 出現提示，並畫出地標
    function hint() {
      let ok = 0, bad = 0; st.tiles.forEach(i => { if (i.dataset.err) bad++; else if (i.classList.contains('ld')) ok++; });
      const off = bad >= 3 && ok === 0; if (el.view.classList.contains('mp-off') !== off) { el.view.classList.toggle('mp-off', off); schedule(); }
    }
    function pinFor(p) {
      let d = st.pins.get(p.id);
      if (!d) { d = doc.createElement('button'); d.className = 'mp-pin'; d.setAttribute('data-pin', p.id); el.marks.appendChild(d); st.pins.set(p.id, d); }
      return d;
    }
    function draw() {
      if (!st.open) return; size(); if (!st.w) return;
      const m = st.model; drawTiles();
      const xy = (lat, lng) => toXY(st.c, st.z, st.w, st.h, lat, lng);
      let svg = '', labs = '', seen = {};
      // 地標（沒圖時才出現）
      if (el.view.classList.contains('mp-off')) LANDMARKS.forEach(l => { const q = xy(l[1], l[2]); labs += '<div class="mp-lm" style="left:' + q.x.toFixed(0) + 'px;top:' + q.y.toFixed(0) + 'px">' + l[0] + '</div>'; });
      if (m) {
        const path = m.pts.map(p => xy(p.lat, p.lng));
        if (path.length > 1) svg += '<polyline class="mp-path" points="' + path.map(q => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join(' ') + '"/>';
        const nx = m.pts.find(p => p.id === m.nextId), mine = me();
        if (mine && nx) { const a = xy(mine.lat, mine.lng), b = xy(nx.lat, nx.lng); svg += '<line class="mp-go" x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '"/>'; }
        // 相同地點的多個項目疊在一起：只畫一顆，優先顯示「下一站／現在／未完成」
        const rank = p => p.id === m.nextId ? 0 : p.id === m.curId ? 1 : p.done ? 3 : 2;
        const best = {};
        m.pts.forEach((p, i) => { p.n = i + 1; const k = p.lat.toFixed(4) + ',' + p.lng.toFixed(4); if (!best[k] || rank(p) < rank(best[k]) || (rank(p) === rank(best[k]) && p.id === st.sel)) best[k] = p; });
        Object.keys(best).forEach(k => {
          const p = best[k], q = xy(p.lat, p.lng), d = pinFor(p); seen[p.id] = 1;
          const cls = 'mp-pin' + (p.id === m.nextId ? ' next' : p.id === m.curId ? ' cur' : p.done ? ' done' : '') + (p.id === st.sel ? ' sel' : '');
          if (d.className !== cls) d.className = cls;
          const txt = p.icon || String(p.n); if (d.textContent !== txt) d.textContent = txt;
          d.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px) translate(-50%,-50%)';
          d.style.display = q.x < -60 || q.y < -60 || q.x > st.w + 60 || q.y > st.h + 60 ? 'none' : '';
          if (p.id === st.sel || p.id === m.nextId) {
            const lx = clamp(q.x, 108, Math.max(108, st.w - 108)), ly = q.y;
            labs += '<div class="mp-lab' + (p.id === m.nextId ? ' nx' : '') + '" style="left:' + lx.toFixed(0) + 'px;top:' + (ly - (p.id === m.nextId ? 30 : 22)).toFixed(0) + 'px">' + (p.id === m.nextId ? '下一站 · ' : '') + esc(p.short) + '</div>';
          }
        });
        if (mine) {
          const q = xy(mine.lat, mine.lng), r = mine.acc ? mine.acc / (40075016.7 * Math.cos(mine.lat * Math.PI / 180) / pw(st.z)) : 0;
          if (r > 14) svg += '<circle class="mp-acc" cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + Math.min(r, 400).toFixed(1) + '"/>';
          svg += '<g class="mp-me" transform="translate(' + q.x.toFixed(1) + ',' + q.y.toFixed(1) + ')"><circle r="16" class="mp-me-ring"/><circle r="8.5" class="mp-me-dot"/></g>';
        }
      }
      st.pins.forEach((d, id) => { if (!seen[id]) { d.remove(); st.pins.delete(id); } });
      el.svg.setAttribute('viewBox', '0 0 ' + st.w + ' ' + st.h); el.svg.innerHTML = svg;
      el.labs.innerHTML = labs;
    }

    /* 資訊列 */
    function infoHTML() {
      const m = st.model; if (!m) return '<div class="mp-i-t">還沒有行程資料</div>';
      if (st.dl) return '<div class="mp-i-t">📥 正在存地圖 ' + st.dl.done + ' / ' + st.dl.total + '</div><div class="mp-bar"><i style="width:' + Math.round(st.dl.done / st.dl.total * 100) + '%"></i></div><div class="mp-i-s"><button class="mp-b" data-mp="dl-stop">停止</button></div>';
      const p = selPt() || m.pts[0];
      if (!p) return '<div class="mp-i-t">這天沒有可以標在地圖上的地點</div><div class="mp-i-s">換天看看，或回行程頁的「改這一站」加上地點。</div>';
      const mine = me(), tag = p.id === m.nextId ? '下一站' : p.id === m.curId ? '現在' : p.done ? '已過' : '';
      let h = '<div class="mp-i-t">' + (tag ? '<span class="mp-tag t-' + (p.id === m.nextId ? 'n' : p.id === m.curId ? 'c' : 'd') + '">' + tag + '</span>' : '') + esc(p.time) + ' ' + esc(p.t) + '</div>';
      const meta = [];
      if (p.q) meta.push('🇯🇵 ' + esc(p.q));
      if (mine) meta.push('距你約 ' + fmtKm(distKm(mine, p)) + '（直線）');
      else if (m.pos) meta.push('你目前不在這張地圖範圍內');
      else meta.push('還沒開啟定位');
      h += '<div class="mp-i-s">' + meta.join('　') + '</div>';
      h += '<div class="mp-i-a">' + (p.q ? '<a class="mp-b pri" href="' + esc(opts.navUrl(p)) + '" target="_blank" rel="noopener">開 Google 導航</a>' : '') +
        (p.q ? '<button class="mp-b" data-mp="copy" data-v="' + esc(p.id) + '">複製地名</button>' : '') +
        (!m.pos ? '<button class="mp-b" data-mp="geo">📍 開啟定位</button>' : '') + '</div>';
      if (m.note) h += '<div class="mp-i-n">' + esc(m.note) + '</div>';
      return h;
    }
    function dayChips() {
      const m = st.model; if (!m) return '';
      return m.days.map(d => '<button class="mp-day' + (d.on ? ' on' : '') + (d.today ? ' td' : '') + '" data-mp="day" data-v="' + d.date + '">' + d.md + '</button>').join('');
    }
    function paint() { el.info.innerHTML = infoHTML(); el.days.innerHTML = dayChips(); }

    /* 對外：刷新資料（行程或定位變了） */
    function refresh() {
      if (!st.open) return;
      const prev = st.model; st.model = opts.getModel();
      const m = st.model; if (!m) { paint(); draw(); return; }
      if (!m.pts.some(p => p.id === st.sel)) st.sel = m.nextId || m.curId || (m.pts[0] && m.pts[0].id) || null;
      if (st.lastDay !== m.date) { st.lastDay = m.date; st.sel = m.nextId || m.curId || (m.pts[0] && m.pts[0].id) || null; fitAll(); }
      if (st.wantMe && me()) { st.wantMe = false; if (m.nextId) fitNext(); else centerOn(m.pos, 15); }
      paint(); schedule();
    }

    /* 開關 */
    function open() {
      if (st.open) return; if (opts.onOpen) opts.onOpen(); st.open = true; st.lastDay = null; st.sel = null;
      el.mp.classList.add('open'); el.mp.setAttribute('aria-hidden', 'false');
      size(); refresh();
      root.setTimeout(() => { size(); if (st.model) { st.lastDay = null; refresh(); } }, 330); // 動畫跑完再量一次尺寸
    }
    function close() {
      if (!st.open) return; st.open = false; el.mp.classList.remove('open'); el.mp.setAttribute('aria-hidden', 'true');
      if (st.dl) stopDl();
    }

    /* 離線存圖 */
    async function startDl() {
      if (!root.caches) { opts.toast('這個瀏覽器不能存離線地圖'); return; }
      const m = st.model, all = [];
      if (opts.allPoints) opts.allPoints().forEach(p => all.push(p));
      const list = prefetchList(all);
      const mb = Math.round(list.length * 18 / 1000);
      if (!root.confirm('要把道央地圖存進手機嗎？\n約 ' + list.length + ' 張圖（約 ' + mb + ' MB），建議連 Wi-Fi 再做。\n存好之後，沒訊號也看得到底圖。')) return;
      const cache = await root.caches.open(CACHE_NAME);
      const job = { done: 0, total: list.length, stop: false, fail: 0 };
      st.dl = job; paint();
      let i = 0;
      async function worker() {
        while (i < list.length && !job.stop) {
          const t = list[i++], url = tileUrl(t[0], t[1], t[2]);
          try {
            if (!(await cache.match(url, { ignoreVary: true }))) {
              const res = await root.fetch(url, { mode: 'cors' });
              if (!res.ok) throw new Error('http ' + res.status);
              await cache.put(url, res);
            }
          } catch (e) { job.fail++; job.err = String(e && e.message || e); if (job.fail > 25 || (job.done < 3 && job.fail >= 3)) job.stop = true; }
          job.done++; if (job.done % 10 === 0) paint();
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
      st.dl = null; paint();
      opts.toast(job.stop && job.fail ? '存圖失敗，已停止（' + job.err + '）；已存的部分仍可離線使用' : job.stop ? '已停止，存好的部分可離線使用' : job.fail ? '地圖大致存好，有 ' + job.fail + ' 張沒抓到' : '地圖已存好（' + job.done + ' 張），沒訊號也能看');
    }
    function stopDl() { if (st.dl) st.dl.stop = true; }

    /* 事件 */
    el.tab && el.tab.addEventListener('click', open);
    // 從右邊把「🗺」拉出來
    if (el.tab) {
      let sx = null;
      el.tab.addEventListener('pointerdown', e => { sx = e.clientX; });
      el.tab.addEventListener('pointerup', e => { if (sx != null && sx - e.clientX > 24) { sx = null; open(); e.preventDefault(); } });
    }
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    el.mp.addEventListener('click', e => {
      const pin = e.target.closest('[data-pin]'); if (pin) { st.sel = pin.getAttribute('data-pin'); paint(); schedule(); return; }
      const b = e.target.closest('[data-mp]'); if (!b) return;
      const a = b.getAttribute('data-mp'), v = b.getAttribute('data-v'), m = st.model;
      if (a === 'close') close();
      else if (a === 'day') { opts.setDay(v); }
      else if (a === 'me') {
        if (!m || !m.pos) { st.wantMe = true; opts.wantGeo(); opts.toast('正在取得你的位置…'); }
        else if (!me()) opts.toast('你的位置在這張地圖範圍外（不在道央）');
        else centerOn(m.pos, Math.max(st.z, 14));
      }
      else if (a === 'geo') { st.wantMe = true; opts.wantGeo(); opts.toast('正在取得你的位置…'); }
      else if (a === 'next') fitNext();
      else if (a === 'all') fitAll();
      else if (a === 'zin') zoomAt(st.z + 1, st.w / 2, st.h / 2);
      else if (a === 'zout') zoomAt(st.z - 1, st.w / 2, st.h / 2);
      else if (a === 'copy') { const p = m && m.pts.find(x => x.id === v); if (p) opts.copy(p.q); }
      else if (a === 'dl') { st.dl ? stopDl() : startDl(); }
      else if (a === 'dl-stop') stopDl();
    });
    // 標題列往右滑：收起
    (function () {
      const hd = $('mp-head'); if (!hd) return; let x0 = null;
      hd.addEventListener('pointerdown', e => { x0 = e.clientX; });
      hd.addEventListener('pointerup', e => { if (x0 != null && e.clientX - x0 > 60) close(); x0 = null; });
    })();

    // 地圖手勢：單指拖曳、雙指縮放、雙擊放大、滾輪
    const ptr = new Map(); let pinch = null, tapT = 0, tapXY = null, moved = 0;
    const rel = e => { const r = el.view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    el.view.addEventListener('pointerdown', e => {
      if (e.target.closest('.mp-pin,.mp-b,.mp-zoom,.mp-btns')) return;
      try { el.view.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      ptr.set(e.pointerId, rel(e)); moved = 0;
      if (ptr.size === 2) { const a = [...ptr.values()], mid = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, z: st.z, ll: toLL(st.c, st.z, st.w, st.h, mid.x, mid.y) }; }
    });
    el.view.addEventListener('pointermove', e => {
      if (!ptr.has(e.pointerId)) return;
      const p = rel(e), old = ptr.get(e.pointerId); ptr.set(e.pointerId, p);
      if (ptr.size === 2 && pinch) {
        const a = [...ptr.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, mid = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
        const nz = clamp(pinch.z + Math.log2(d / pinch.d), ZMIN, ZMAX); st.z = nz;
        st.c = clampCenter({ lat: yLat(latY(pinch.ll.lat, nz) - (mid.y - st.h / 2), nz), lng: xLng(lngX(pinch.ll.lng, nz) - (mid.x - st.w / 2), nz) }); moved += 99; schedule(); return;
      }
      if (ptr.size === 1) {
        const dx = p.x - old.x, dy = p.y - old.y; moved += Math.abs(dx) + Math.abs(dy);
        st.c = clampCenter({ lat: yLat(latY(st.c.lat, st.z) - dy, st.z), lng: xLng(lngX(st.c.lng, st.z) - dx, st.z) }); schedule();
      }
    });
    const up = e => {
      if (!ptr.has(e.pointerId)) return;
      const p = ptr.get(e.pointerId); ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null;
      if (moved < 8 && ptr.size === 0) { // 點一下；連點兩下＝放大
        const now = Date.now();
        if (now - tapT < 320 && tapXY && Math.hypot(p.x - tapXY.x, p.y - tapXY.y) < 30) { zoomAt(st.z + 1, p.x, p.y); tapT = 0; } else { tapT = now; tapXY = p; }
      }
    };
    el.view.addEventListener('pointerup', up); el.view.addEventListener('pointercancel', up);
    el.view.addEventListener('wheel', e => { e.preventDefault(); const p = rel(e); zoomAt(st.z - e.deltaY * 0.0025, p.x, p.y); }, { passive: false });
    root.addEventListener('resize', () => { if (st.open) { size(); schedule(); } });

    return {
      open: open, close: close, refresh: refresh, isOpen: () => st.open,
      _st: st, _draw: draw,   // 測試用
      requestMe: () => { st.wantMe = true; }
    };
  }

  return { init, lngX, latY, xLng, yLat, toXY, toLL, tilesFor, tileUrl, fitView, distKm, inBounds, tileRange, prefetchList, fmtKm, BOUNDS, REGION, ZMIN, ZMAX, CACHE_NAME, TILE_URL };
});
