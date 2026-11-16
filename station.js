/* station.js — 車站班次看板（LED 風格）與站內導引。
   資料全部預先打包（stations.json），不需即時上網；定位只用在這支手機。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Station = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const root = typeof self !== 'undefined' ? self : globalThis;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const jstHM = d => { const j = new Date(d.getTime() + 9 * 3600000); return pad(j.getUTCHours()) + ':' + pad(j.getUTCMinutes()); };
  const jstHMS = d => { const j = new Date(d.getTime() + 9 * 3600000); return pad(j.getUTCHours()) + ':' + pad(j.getUTCMinutes()) + ':' + pad(j.getUTCSeconds()); };

  /* ---------- 純函式（可測試）---------- */
  function splitTitle(t) {
    const p = String(t).split('：');
    const name = p[0].replace(/號$/, '號');
    const route = p[1] || '';
    const dest = (route.split('→')[1] || route).replace(/（.*?）/g, '').trim();
    return { name: name, dest: dest };
  }
  function jpLabel(s, base) {
    s = String(s).replace(/（末班）/, '（最終）').replace(/（早一班）|（早班）/, '（早い便）').replace(/（早回版，編號 (\w+)）/, '（$1）').replace(/^(\d{1,2}):(\d\d) 班$/, '$1:$2発');
    if (/番/.test(base) || !/号$/.test(base)) return s.replace(/ ?號/, '番');
    const m = s.match(/^(?:[^\d]*?)(\d+) ?號(.*)$/);
    if (m) return base.replace(/\d+号$/, '') + m[1] + '号' + m[2];
    return s;
  }
  // 某天的看板列：預定班次＋備用班次
  function boardRows(items, trips, now, jp, lang) {
    jp = jp || {}; const useJp = lang !== 'zh';
    const rows = [];
    items.forEach(it => {
      const tr = trips[it.id]; if (!tr) return;
      const st = splitTitle(it.t), j = (useJp && jp[it.id] && jp[it.id].name) ? jp[it.id] : {};
      const nm = j.name || st.name, ds = j.dir ? j.dir.replace(/方面$/, '') : st.dest;
      rows.push({ id: it.id, time: it.s, start: it.start, name: nm, dest: ds, planned: true, bus: !!tr.bus });
      (it.alts || []).forEach(a => rows.push({ id: it.id, time: a.s, start: a.start, name: useJp && j.name ? jpLabel(a.label || nm, j.name) : (a.label || nm), dest: ds, planned: false, bus: !!tr.bus }));
    });
    rows.sort((a, b) => a.start - b.start || (b.planned - a.planned));
    rows.forEach(r => { r.gone = now && r.start.getTime() < now.getTime(); });
    return rows;
  }
  function nearest(stations, pos) {
    let best = null;
    Object.keys(stations).forEach(k => {
      const s = stations[k], d = dist(pos, s);
      if (!best || d < best.d) best = { id: k, d: d };
    });
    return best;
  }
  function dist(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---- 平面示意圖＋箭頭路線（純 SVG，資料在 stations.json 的 map） ---- */
  function svgEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function shapesSVG(list, oy) {
    return (list || []).map(o => {
      if (o.r) {
        const [x, y, w, h] = o.r;
        return '<rect class="m-' + o.c + '" x="' + x + '" y="' + (y + oy) + '" width="' + w + '" height="' + h + '" rx="5"/>' +
          (o.t ? '<text class="m-t" x="' + (x + w / 2) + '" y="' + (y + oy + h / 2 + 4) + '">' + svgEsc(o.t) + '</text>' : '');
      }
      return o.t ? '<text class="m-' + o.c + '" x="' + o.x + '" y="' + (o.y + oy) + '">' + svgEsc(o.t) + '</text>' : '';
    }).join('');
  }
  function pathSVG(pts, oy, first, last, seg) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + (p[1] + oy)).join(' ');
    let h = '<path class="m-route-bg" d="' + d + '"/><path class="m-route" d="' + d + '" marker-end="url(#m-arrow)" style="animation-delay:' + (seg * 0.35) + 's"/>';
    const a = pts[0], b = pts[pts.length - 1];
    if (first) h += '<circle class="m-start" cx="' + a[0] + '" cy="' + (a[1] + oy) + '" r="7"/><circle class="m-pulse" cx="' + a[0] + '" cy="' + (a[1] + oy) + '" r="7"/>' +
      (first.label ? '<text class="m-tag" style="text-anchor:' + (a[0] < 200 ? 'start' : 'end') + '" x="' + (a[0] + (a[0] < 200 ? 12 : -12)) + '" y="' + (a[1] + oy - 8) + '">你在這・' + svgEsc(first.label) + '</text>' : '');
    if (last) {
      const right = b[0] < 200;
      h += '<text class="m-flag" x="' + b[0] + '" y="' + (b[1] + oy + 5) + '">🏁</text>' +
        (last.label ? '<text class="m-tag" style="text-anchor:' + (right ? 'start' : 'end') + '" x="' + (b[0] + (right ? 12 : -12)) + '" y="' + (b[1] + oy + 4) + '">' + svgEsc(last.label) + '</text>' : '');
    }
    return h;
  }
  const MAP_CSS = '<style>' +
    'text{font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif}' +
    '.m-bld{fill:#fff;stroke:#9fb1b8}.m-pub{fill:#fff6dc;stroke:#e2c779}.m-paid{fill:#e3eef0;stroke:#7fb0b8}' +
    '.m-box{fill:#dbe7f6;stroke:#6a8db5}.m-shop{fill:#f6e1ea;stroke:#c98aa2}.m-ev{fill:#fff;stroke:#0f6f7c;stroke-width:1.6}' +
    '.m-gate{fill:#10222a}.m-plat{fill:#cfd8dc;stroke:#78909c}.m-sub{fill:#dff0e3;stroke:#3f8f55}.m-walk{fill:#c7d6dc}' +
    '.m-t{font-size:10.5px;fill:#10222a;text-anchor:middle}.m-lbl,.m-sm,.m-dim{font-size:10px;fill:#53656d;text-anchor:middle}' +
    '.m-exit{font-size:11px;fill:#0f6f7c;font-weight:700}.m-exitR{font-size:11px;fill:#0f6f7c;font-weight:700;text-anchor:end}' +
    '.m-exitC{font-size:11px;fill:#0f6f7c;font-weight:700;text-anchor:middle}.m-ex{font-size:11px;fill:#0f6f7c;font-weight:700;text-anchor:middle}' +
    '.m-gl{font-size:10px;fill:#10222a;font-weight:700;text-anchor:middle}' +
    '.m-ph{font-size:13px;font-weight:800;fill:#0f6f7c}.m-via{font-size:12.5px;font-weight:700;fill:#b4472b}' +
    '.m-route-bg{fill:none;stroke:#fff;stroke-width:9;stroke-linecap:round;stroke-linejoin:round}' +
    '.m-route{fill:none;stroke:#e5482a;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:10 8;animation:mflow .9s linear infinite}' +
    '@keyframes mflow{to{stroke-dashoffset:-18}}' +
    '.m-start{fill:#1e88e5;stroke:#fff;stroke-width:2}.m-pulse{fill:none;stroke:#1e88e5;stroke-width:2;animation:mpulse 1.6s ease-out infinite;transform-box:fill-box;transform-origin:center}' +
    '@keyframes mpulse{from{transform:scale(1);opacity:.9}to{transform:scale(2.6);opacity:0}}' +
    '.m-cap{font-size:12.5px;font-weight:700;fill:#10222a}.m-flag{font-size:16px;text-anchor:middle}.m-tag{font-size:10.5px;font-weight:700;fill:#10222a;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:3px}' +
    '.m-stair{fill:#fff;stroke:#53656d}.m-stair.on{fill:#ffb000;stroke:#b4472b;stroke-width:2}.m-sn{font-size:10px;text-anchor:middle;fill:#10222a;font-weight:700}' +
    '@media (prefers-reduced-motion:reduce){.m-route,.m-pulse{animation:none}}' +
    '</style><defs><marker id="m-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="#e5482a"/></marker></defs>';
  // 多層站（新千歲）：依路線用到的樓層由上往下排，中間用「⬇ 搭電梯」等說明串起來
  function multiFloorSVG(map, mode, pt) {
    const rt = map.routes && map.routes[mode] && map.routes[mode][pt];
    if (!rt) return null;
    let y = 4, body = '', seg = 0;
    const segs = rt.filter(x => x.p);
    rt.forEach(x => {
      if (x.via) { body += '<text class="m-via" x="170" y="' + (y + 16) + '" text-anchor="middle">' + svgEsc(x.via) + '</text>'; y += 26; return; }
      const P = map.panels[x.p];
      body += '<text class="m-ph" x="10" y="' + (y + 13) + '">' + svgEsc(P.label) + '</text>';
      y += 18;
      body += shapesSVG(P.s, y);
      const i = segs.indexOf(x);
      body += pathSVG(x.path, y, i === 0 ? { label: x.start } : null, i === segs.length - 1 ? { label: x.end } : null, seg++);
      y += P.h;
    });
    return '<svg class="g-svg" viewBox="0 0 340 ' + (y + 6) + '" xmlns="http://www.w3.org/2000/svg">' + MAP_CSS + body + '</svg>';
  }
  // 札幌：單層平面，路線依入口、東西側與月台號碼算出
  function sapporoSVG(st, mode, pt, plat) {
    const m = st.map, side = st.side[pt];
    if (!side || !m.pts[pt]) return null;
    const P = m.panel, oy = 22, sx = m.stairs[side];
    let body = '<text class="m-ph" x="10" y="15">' + svgEsc(P.label) + '</text>' + shapesSVG(P.s, oy);
    const rows = {};
    Object.keys(m.rows).forEach(n => { const yy = m.rows[n]; (rows[yy] = rows[yy] || []).push(n); });
    Object.keys(rows).forEach(yy => {
      const label = rows[yy].sort((a, b) => a - b).join('・'), on = plat && rows[yy].indexOf(String(plat)) >= 0;
      ['west', 'east'].forEach(sd => {
        const x = m.stairs[sd], hit = on && sd === side;
        body += '<rect class="m-stair' + (hit ? ' on' : '') + '" x="' + (x - 17) + '" y="' + (Number(yy) + oy - 9) + '" width="34" height="18" rx="4"/>' +
          '<text class="m-sn" x="' + x + '" y="' + (Number(yy) + oy + 4) + '">' + label + '</text>';
      });
    });
    let pts = [m.pts[pt]].concat(m.gates[side]);
    const gate = pts[pts.length - 1];
    let endLabel = '進改札後看發車標的番線';
    if (plat && m.rows[plat] != null) {
      const ry = m.rows[plat];
      const lx = (m.lanes || {})[side] || sx;
      pts.push([lx, gate[1]]); pts.push([lx, ry]); pts.push([sx + (side === 'west' ? -19 : 19), ry]);
      endLabel = plat + ' 號月台樓梯（上樓）';
    }
    const ptName = pt === 'under' ? '地下鐵入口' : (st.points[pt] || '').replace(/（.*$/, '');
    let cap1, cap2;
    if (mode === 'arr') {
      pts = pts.slice().reverse();
      cap1 = '🔵 起點：' + (plat ? plat + ' 號月台下樓的樓梯' : '月台下樓後'); cap2 = '🏁 終點：' + ptName + (pt === 'under' ? '（下到地下）' : '');
    } else { cap1 = '🔵 起點：' + ptName; cap2 = '🏁 終點：' + endLabel; }
    body += pathSVG(pts, oy, {}, {}, 0);
    const cy = P.h + oy + 6;
    body += '<text class="m-cap" x="10" y="' + (cy + 12) + '">' + svgEsc(cap1) + '</text><text class="m-cap" x="10" y="' + (cy + 30) + '">' + svgEsc(cap2) + '</text>';
    return '<svg class="g-svg" viewBox="0 0 340 ' + (cy + 38) + '" xmlns="http://www.w3.org/2000/svg">' + MAP_CSS + body + '</svg>';
  }
  function routeMap(st, mode, pt, plat) {
    if (!st || !st.map || !pt) return null;
    return st.platforms ? sapporoSVG(st, mode, pt, plat) : multiFloorSVG(st.map, mode, pt);
  }
  // 依站別、方向、所在位置（與月台）產生步驟：[[樓層標籤, 說明], ...]
  function steps(st, mode, pt, plat) {
    if (!st || st.none) return null;
    if (st.platforms) { // 札幌：依大廳東西側與月台號碼推導
      const side = st.side[pt], gate = side === 'east' ? '東改札口' : '西改札口';
      if (mode === 'dep') {
        return [
          ['1F 大廳', st.enter[pt]],
          ['改札', '從「' + gate + '」刷卡進站。'],
          [plat ? '→ ' + plat + ' 號月台' : '→ 月台', plat
            ? '月台號碼由南往北排：1・2 最靠南口，9・10 最靠北口。走到標「' + plat + '」的樓梯或手扶梯上樓。'
            : '先看發車標（電光掲示板）找這班的番線，再按上面的月台號碼。1・2 靠南口、9・10 靠北口。'],
          ['推車', st.warn]
        ];
      }
      return [
        ['月台 → 1F', '下樓到 1F 大廳。推車請找「エレベーター」指標。'],
        ['改札', '從「' + gate + '」出站（兩個改札都通，選靠出口那一側）。'],
        ['出口', pt === 'under'
          ? '往東大廳南側找「地下鉄」入口下到地下。往大通走チ・カ・ホ地下通道，冬天不用走雪地。'
          : '往「' + st.points[pt] + '」出去。']
      ];
    }
    const table = mode === 'dep' ? st.dep : st.arr;
    return (table && table[pt]) || null;
  }
  function pointsFor(st, mode) {
    if (!st || st.none) return {};
    if (st.platforms) return st.points;
    const table = mode === 'dep' ? st.dep : st.arr;
    const o = {}; Object.keys(table || {}).forEach(k => { o[k] = st.points[k] || k; });
    return o;
  }

  /* ---------- 畫面 ---------- */
  function init(opts) {
    // opts: {doc, data(), items(date), stations, getNow(), tabDate(), toast(m), getPos()}
    const doc = opts.doc, ST = opts.stations || { stations: {}, trips: {} };
    const $ = id => doc.getElementById(id);
    const B = { date: null, timer: null }, G = { trip: null, mode: 'dep', pt: null, plat: null, pos: null, gps: '' };

    const tripDays = () => opts.data().days.filter(d => opts.items(d.date).some(it => ST.trips[it.id]));

    function openBoard(date) {
      const days = tripDays();
      const want = date || opts.tabDate();
      B.date = days.some(d => d.date === want) ? want : (days.find(d => d.date >= want) || days[0] || {}).date;
      $('board').className = 'led open';
      if (opts.fx) opts.fx('chime');
      drawBoard(true);
      root.clearInterval(B.timer); B.timer = root.setInterval(() => drawBoard(false), 1000);
    }
    function closeBoard() { $('board').className = 'led'; root.clearInterval(B.timer); B.timer = null; }

    function drawBoard(full) {
      const now = opts.getNow();
      const clk = $('led-clock'); if (clk) clk.textContent = jstHMS(now);
      if (!full && !drawBoard.dirty(now)) return;
      const items = opts.items(B.date), rows = boardRows(items, ST.trips, now, ST.jp, opts.lang ? opts.lang() : 'jp');
      const next = rows.find(r => r.planned && !r.gone);
      const mins = next ? Math.ceil((next.start - now) / 60000) : null;
      const day = opts.data().days.find(d => d.date === B.date) || {};
      let h = '<div class="led-top"><div><div class="led-title">発車案内　DEPARTURES</div>' +
        '<div class="led-sub">' + esc(B.date ? Number(B.date.slice(5, 7)) + '/' + Number(B.date.slice(8)) + '（' + (day.dow || '') + '）' : '') + '　依時刻表・非即時</div></div>' +
        '<div class="led-clock" id="led-clock">' + jstHMS(now) + '</div></div>';
      h += '<div class="led-days">' + tripDays().map(d => '<button data-sx="day" data-v="' + d.date + '" class="' + (d.date === B.date ? 'on' : '') + '">' + Number(d.date.slice(5, 7)) + '/' + Number(d.date.slice(8)) + '</button>').join('') + '</div>';
      if (next && mins != null && mins <= 24 * 60) h += '<div class="led-next">▶ 次の予定　' + esc(next.time) + ' ' + esc(next.name) + '　あと <b class="' + (drawBoard.mins != null && drawBoard.mins !== mins ? 'flip' : '') + '">' + mins + '</b> 分</div>';
      h += '<div class="led-head"><span>時刻</span><span>列車</span><span>行先</span><span>備考</span></div>';
      if (!rows.length) h += '<div class="led-row"><span></span><span>本日の列車なし</span><span></span><span></span></div>';
      rows.forEach((r, i) => {
        h += '<button class="led-row' + (r.planned ? ' plan' : '') + (r.gone ? ' gone' : '') + '" style="animation-delay:' + (full ? i * 60 : 0) + 'ms" data-sx="row" data-v="' + esc(r.id) + '">' +
          '<span class="t">' + esc(r.time) + '</span><span class="n">' + (r.bus ? '🚌 ' : '') + esc(r.name) + '</span><span class="d">' + esc(r.dest) + '</span>' +
          '<span class="s">' + (r.gone ? '発車済' : r.planned ? '<i>●</i>予定' : '予備') + '</span></button>';
      });
      h += '<div class="led-foot">點一班車看站內怎麼走。誤點、停駛請看官方運行情報：<br>' +
        '<a href="https://www.jrhokkaido.co.jp/" target="_blank" rel="noopener">JR 北海道 運行情報 ↗</a></div>' +
        '<button class="led-close" data-sx="close">關閉</button>';
      $('board-in').innerHTML = h;
      drawBoard.key = jstHM(now) + B.date; drawBoard.mins = mins;
    }
    drawBoard.dirty = now => drawBoard.key !== jstHM(now) + B.date;

    /* ---- 站內導引 ---- */
    function openGuide(tripId) {
      const tr = ST.trips[tripId]; if (!tr || tr.bus) { opts.toast('這班是巴士，沒有站內導引'); return; }
      G.trip = tripId; G.mode = 'dep'; G.pt = tr.rec || null; G.plat = null; G.gps = '📍 定位中…';
      $('guide').className = 'gsheet open';
      if (opts.fx) opts.fx('done');
      drawGuide();
      locate();
    }
    function closeGuide() { $('guide').className = 'gsheet'; }
    function locate() {
      const done = pos => {
        G.pos = pos;
        const tr = ST.trips[G.trip], S = ST.stations, from = S[tr.from], to = S[tr.to];
        const df = dist(pos, from), dt = dist(pos, to);
        if (dt < 1.5 && dt < df) { G.mode = 'arr'; G.pt = tr.arrRec || null; G.gps = '📍 你在' + to.name + '站附近（約 ' + dt.toFixed(1) + ' km），先顯示下車後的走法。'; }
        else if (df < 1.5) G.gps = '📍 你在' + from.name + '站附近（約 ' + df.toFixed(1) + ' km）。';
        else { const n = nearest(S, pos); G.gps = '📍 你離' + from.name + '站約 ' + df.toFixed(1) + ' km' + (n && n.d < 1.5 ? '（最近的是' + S[n.id].name + '站）' : '，可能還沒到站') + '。'; }
        drawGuide();
      };
      const cur = opts.getPos && opts.getPos();
      if (cur) { done(cur); return; }
      const g = root.navigator && root.navigator.geolocation;
      if (!g) { G.gps = '這支手機無法定位，請直接選下面的位置。'; drawGuide(); return; }
      g.getCurrentPosition(p => done({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => { G.gps = '沒有取得定位（可能未允許），請直接選下面的位置。'; drawGuide(); },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    }
    function drawGuide() {
      const tr = ST.trips[G.trip], S = ST.stations, from = S[tr.from], to = S[tr.to];
      const it = opts.items(opts.data().days.find(d => opts.items(d.date).some(x => x.id === G.trip)).date).find(x => x.id === G.trip);
      const st = G.mode === 'dep' ? from : to;
      const pts = pointsFor(st, G.mode), rec = G.mode === 'dep' ? tr.rec : tr.arrRec;
      let h = '<div class="g-grab"></div><div class="g-head"><div><div class="g-train">' + esc(it.t.split('：')[0]) + '</div>' +
        '<div class="g-sub">' + esc(it.s) + ' 發車　' + esc(from.name) + ' → ' + esc(to.name) + '</div></div>' +
        '<button class="big sub" data-sx="gclose">關閉</button></div>';
      h += '<div class="g-gps">' + esc(G.gps) + '</div>';
      h += '<div class="g-mode"><button data-sx="mode" data-v="dep" class="' + (G.mode === 'dep' ? 'on' : '') + '">上車：' + esc(from.name) + '</button>' +
        '<button data-sx="mode" data-v="arr" class="' + (G.mode === 'arr' ? 'on' : '') + '">下車後：' + esc(to.name) + '</button></div>';
      h += '<div class="g-station">' + esc(st.sub) + '</div>';
      if (st.none) {
        h += '<div class="notice">這一站還沒有構內圖。到站先看發車標找番線，帶推車找「エレベーター」指標。把官方構內圖傳給我，就能補上這一站。</div>' +
          '<a class="chip" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(st.sub) + '">在 Google 地圖看這站 ↗</a>';
      } else {
        h += '<h3 class="g-h">' + (G.mode === 'dep' ? '你現在在哪裡？' : '你要往哪裡去？') + '</h3><div class="g-opts">' +
          Object.keys(pts).map(k => '<button data-sx="pt" data-v="' + k + '" class="' + (k === G.pt ? 'on' : '') + '">' + esc(pts[k]) + (k === rec ? '<small>行程建議</small>' : '') + '</button>').join('') + '</div>';
        if (st.platforms) {
          h += '<h3 class="g-h">' + (G.mode === 'dep' ? '要去幾號月台？<small>看發車標上的番線</small>' : '從幾號月台下車？<small>看月台上的番號</small>') + '</h3><div class="g-plat">' +
            st.platforms.map(n => '<button data-sx="plat" data-v="' + n + '" class="' + (String(n) === String(G.plat) ? 'on' : '') + '">' + n + '</button>').join('') + '</div>';
        }
        const svg = G.pt ? routeMap(st, G.mode, G.pt, G.plat) : null;
        if (svg) h += '<h3 class="g-h">路線圖<small>' + esc(st.map.src) + '</small></h3><div class="g-mapbox">' + svg + '</div>';
        const ss = G.pt ? steps(st, G.mode, G.pt, G.plat) : null;
        if (ss) {
          h += '<h3 class="g-h">怎麼走</h3><ol class="g-steps">' + ss.map((s, i) => '<li style="animation-delay:' + i * 90 + 'ms"><span class="g-floor">' + esc(s[0]) + '</span><span>' + esc(s[1]) + '</span></li>').join('') + '</ol>';
        } else if (G.pt) h += '<div class="notice">這個位置還沒有整理好的走法。</div>';
        if (st.img) h += '<img class="g-map" src="' + esc(st.img) + '" alt="' + esc(st.name) + '站示意圖">';
        if (st.warn) h += '<div class="notice warn">⚠ ' + esc(st.warn) + '</div>';
        h += '<div class="g-src">依「' + esc(st.src) + '」整理，現場以站內標示與站務員為準。<br><a href="' + esc(st.url) + '" target="_blank" rel="noopener">看官方構內圖 ↗</a></div>';
      }
      $('guide-in').innerHTML = h;
    }

    doc.addEventListener('click', ev => {
      const t = ev.target && ev.target.closest && ev.target.closest('[data-sx]');
      if (!t) return;
      const a = t.getAttribute('data-sx'), v = t.getAttribute('data-v');
      if (a === 'close') closeBoard();
      else if (a === 'day') { B.date = v; drawBoard(true); }
      else if (a === 'row') { const tr = ST.trips[v]; if (tr && tr.bus) { closeBoard(); if (opts.openItem) opts.openItem(B.date, v); } else openGuide(v); }
      else if (a === 'gclose') closeGuide();
      else if (a === 'mode') { G.mode = v; const tr = ST.trips[G.trip]; G.pt = (v === 'dep' ? tr.rec : tr.arrRec) || null; G.plat = null; drawGuide(); }
      else if (a === 'pt') { G.pt = v; drawGuide(); }
      else if (a === 'plat') { G.plat = v; drawGuide(); }
    });
    return { openBoard, closeBoard, openGuide, closeGuide, hasGuide: id => !!(ST.trips[id] && !ST.trips[id].bus), jpFor: id => (ST.jp || {})[id] || null };
  }

  return { splitTitle, boardRows, steps, pointsFor, nearest, dist, routeMap, init };
});
