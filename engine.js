/* engine.js — 行程時間計算（純函式，不碰 DOM）。所有時間一律以日本時間 JST(+09:00) 解讀。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const JST = '+09:00';
  const MARGIN = 5; // 趕搭固定班次時，要求至少比發車時間早到的分鐘數
  const KINDS = ['fixed', 'flex', 'move', 'wait'];
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  const pad = n => String(n).padStart(2, '0');
  const toDate = (date, hhmm) => new Date(date + 'T' + hhmm + ':00' + JST);
  const diff = (a, b) => Math.round((b.getTime() - a.getTime()) / 60000); // a → b 的分鐘數
  const addMin = (d, m) => new Date(d.getTime() + m * 60000);
  const jst = d => new Date(d.getTime() + 9 * 3600000);
  const fmtTime = d => { const j = jst(d); return pad(j.getUTCHours()) + ':' + pad(j.getUTCMinutes()); };
  const jstDate = d => { const j = jst(d); return j.getUTCFullYear() + '-' + pad(j.getUTCMonth() + 1) + '-' + pad(j.getUTCDate()); };

  function fmtDur(m) {
    m = Math.max(0, Math.round(m));
    const h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + ' 分';
    return h + ' 小時' + (r ? ' ' + r + ' 分' : '');
  }

  /* ---------- 資料整理 ---------- */

  function getPlan(day, planId) {
    return day.plans.find(p => p.id === planId) ||
      day.plans.find(p => p.id === day.defaultPlan) || day.plans[0];
  }

  // 把某一天（某個方案）的項目轉成帶 Date 的陣列
  function materialize(day, planId) {
    const plan = getPlan(day, planId);
    return plan.items.map(it => {
      const start = toDate(day.date, it.s), end = toDate(day.date, it.e);
      const dur = diff(start, end);
      return Object.assign({}, it, {
        kind: it.k, start, end, dur,
        cushion: Math.min(it.c || 0, dur),
        alts: (it.alts || []).map(a => Object.assign({}, a, { start: toDate(day.date, a.s), end: toDate(day.date, a.e) }))
      });
    }).sort((a, b) => a.start - b.start).map((it, i) => Object.assign(it, { idx: i }));
  }

  function locate(items, now) {
    if (!items.length) return { state: 'empty' };
    const t = now.getTime();
    if (t < items[0].start.getTime()) return { state: 'before', next: items[0], idx: -1 };
    for (let i = 0; i < items.length; i++) {
      const it = items[i], nx = items[i + 1];
      if (t >= it.start.getTime() && t < it.end.getTime()) return { state: 'in', cur: it, idx: i };
      if (t >= it.end.getTime() && (!nx || t < nx.start.getTime())) {
        return nx ? { state: 'gap', prev: it, next: nx, idx: i } : { state: 'after', last: it, idx: i };
      }
    }
    return { state: 'after', last: items[items.length - 1], idx: items.length - 1 };
  }

  function nextFixed(items, from) {
    for (let i = Math.max(0, from); i < items.length; i++) if (items[i].kind === 'fixed') return items[i];
    return null;
  }

  /* ---------- 核心：現在狀態與「多待一下」的後果 ----------
   * opts.ext      想多待幾分鐘（加在目前項目的預定結束時間上）
   * opts.leaveNow 現在就出發（不待到預定結束）
   * opts.holdId   使用者已延長的項目 id：即使預定時間已過，仍視為「還在這個項目」
   *
   * 兩個關鍵時間（對下一個固定事件 F）：
   *   建議離開 comfortLeave = F 開始 − 中間所有項目的預定時間（照原計畫走完）
   *   最晚離開 latestLeave  = F 開始 − 中間所有項目扣掉可壓縮緩衝（cushion）後的時間
   * 綠：離開時間 ≤ 建議離開；黃：介於兩者之間（會吃掉緩衝）；紅：晚於最晚離開（會錯過 F）
   */
  function analyze(items, day, now, opts) {
    opts = opts || {};
    const sunset = day.sunset ? toDate(day.date, day.sunset) : null;
    let loc = locate(items, now);

    if (opts.holdId && !opts.leaveNow && opts.ext > 0) {
      const hi = items.findIndex(x => x.id === opts.holdId);
      if (hi >= 0 && items[hi].kind !== 'fixed' &&
          now.getTime() >= items[hi].start.getTime() && now.getTime() < addMin(items[hi].end, opts.ext).getTime()) {
        loc = { state: 'in', cur: items[hi], idx: hi };
      }
    }

    const out = {
      state: loc.state, now, sunset,
      sunsetIn: sunset ? diff(now, sunset) : null,
      sunsetApprox: !!day.sunsetApprox
    };

    if (loc.state === 'empty') { out.mode = 'empty'; return out; }
    if (loc.state === 'after') { out.mode = 'done'; out.last = loc.last; return out; }
    if (loc.state === 'before') {
      out.mode = 'before'; out.next = loc.next; out.toNext = diff(now, loc.next.start);
      out.F = nextFixed(items, 0);
      return out;
    }

    if (loc.state === 'in' && loc.cur.kind === 'fixed') {
      out.mode = 'onboard'; out.cur = loc.cur;
      out.remaining = diff(now, loc.cur.end);
      out.after = items[loc.idx + 1] || null;
      out.F = nextFixed(items, loc.idx + 1);
      out.toFixed = out.F ? diff(now, out.F.start) : null;
      return out;
    }

    let cur, curEnd;
    if (loc.state === 'in') { cur = loc.cur; curEnd = cur.end; }
    else {
      cur = { id: 'gap-' + loc.idx, t: '空檔（自由時間）', kind: 'flex', virtual: true, start: loc.prev.end, end: loc.next.start };
      curEnd = loc.next.start;
    }
    const chainFrom = loc.idx + 1;
    const F = nextFixed(items, chainFrom);
    const newEnd = opts.leaveNow ? now : addMin(curEnd, opts.ext || 0);

    out.cur = cur; out.curEnd = curEnd; out.newEnd = newEnd;
    out.remaining = diff(now, curEnd);          // 依原計畫還剩幾分（延長後可能為負）
    out.remainingNew = diff(now, newEnd);       // 依你的選擇還剩幾分
    out.next = items[chainFrom] || null;
    out.sunsetWarn = !!(sunset && cur.out && !cur.dusk && newEnd.getTime() > sunset.getTime());

    if (!F) { out.mode = 'free'; out.F = null; out.status = 'green'; return out; }

    const chain = items.slice(chainFrom, items.indexOf(F));
    const planned = chain.reduce((s, i) => s + i.dur, 0);
    const needed = chain.reduce((s, i) => s + Math.max(0, i.dur - i.cushion), 0);
    const comfortLeave = addMin(F.start, -planned);
    const latestLeave = addMin(F.start, -needed);
    const slackComfort = diff(newEnd, comfortLeave);
    const slackLatest = diff(newEnd, latestLeave);
    const status = slackComfort >= 0 ? 'green' : (slackLatest >= 0 ? 'yellow' : 'red');

    Object.assign(out, {
      mode: 'adjust', F, chain, planned, needed, comfortLeave, latestLeave,
      slackComfort, slackLatest, status,
      toFixed: diff(now, F.start),
      stayComfort: diff(now, comfortLeave),
      stayLatest: diff(now, latestLeave)
    });

    if (status === 'red') {
      const arrive = addMin(newEnd, needed + MARGIN);
      const later = F.alts.filter(a => !a.earlier).sort((a, b) => a.start - b.start);
      const pick = later.find(a => a.start.getTime() >= arrive.getTime());
      out.alt = pick ? { alt: pick, delayArrive: diff(F.end, pick.end), delayDepart: diff(F.start, pick.start) } : null;
    }
    return out;
  }

  /* ---------- 其他工具 ---------- */


  /* ---------- 自訂異動（換景點、改時間、加刪一站）與整段重排 ----------
   * edits：以 "m|日期|方案|項目id"（修改）、"x|…"（刪除）、"a|日期|方案|新id"（新增）為鍵的物件，
   *        值含 ts；{reset:true} 代表已還原。固定班次（fixed）永遠不動、不可改。
   * 只重排「有被動到」的那一段（夾在兩個固定班次之間）；沒動到的段落時間原封不動。
   * 重排時：原本的空檔最先被壓縮，其次是可壓縮緩衝 c；仍放不下就保留重疊並回報 conflicts。 */
  const toMin = h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

  function applyEdits(day, planId, edits) {
    const plan = getPlan(day, planId);
    const info = { edited: 0, conflicts: [], slacks: {} };
    const mods = {}, dels = {}, adds = [], routes = {};
    Object.keys(edits || {}).forEach(k => {
      const v = edits[k], p = k.split('|');
      if (!v || v.reset || p.length !== 4 || p[1] !== day.date || p[2] !== plan.id) return;
      if (p[0] === 'm') mods[p[3]] = v;
      else if (p[0] === 'x') { if (v.v) dels[p[3]] = true; }
      else if (p[0] === 'a') { if (!v.del && v.t) adds.push(Object.assign({ id: p[3] }, v)); }
      else if (p[0] === 'r') { if (HHMM.test(v.s || '') && HHMM.test(v.e || '')) routes[p[3]] = v; }
    });
    if (!Object.keys(mods).length && !Object.keys(dels).length && !adds.length && !Object.keys(routes).length) return { day, info };

    // 1) 套用修改／刪除／新增
    let list = plan.items.slice().sort((a, b) => a.s.localeCompare(b.s)).map(it => {
      const o = Object.assign({}, it);
      o.os = toMin(it.s); o.oe = toMin(it.e); o.dur = o.oe - o.os;
      if (it.k === 'fixed') {
        const r = routes[it.id];
        if (r) { // 改搭備用班次：固定項目換成新的時間，後面的行程跟著重排
          o.origS = it.s; o.origE = it.e; o.s = r.s; o.e = r.e; o.os = toMin(r.s); o.oe = toMin(r.e); o.dur = o.oe - o.os;
          { const rest = it.t.indexOf('：') >= 0 ? '：' + it.t.split('：').slice(1).join('：') : '', head = it.t.split('：')[0];
            if (r.delay) { o.delay = r.delay; o.t = (r.label || head) + '（' + (r.label ? '改搭・' : '') + '誤點 ' + r.delay + ' 分）' + rest; }
            else if (r.label) o.t = r.label + '（改搭）' + rest; }
          o.alted = true; o.ed = true; info.edited++;
        }
        return o;
      }
      if (dels[it.id]) { o.dropped = true; info.edited++; return o; }
      const m = mods[it.id];
      if (m) {
        if (m.t) o.t = m.t;
        if (m.q) { o.q = m.q; if (!o.mode) o.mode = 'walking'; }
        if (m.n != null && m.n !== '') o.note = m.n;
        if (m.d) o.dur = m.d;
        if (m.tmp) o.live = true; else { o.ed = true; info.edited++; }
      }
      return o;
    });
    adds.sort((a, b) => a.ts - b.ts).forEach(a => {
      let at = list.findIndex(x => x.id === a.after);
      // 插在該項目之後；若後面緊跟著的也是同一個項目的新增，排在其後（以時間戳先後）
      while (at >= 0 && at + 1 < list.length && list[at + 1].added && list[at + 1].after === a.after) at++;
      const n = { id: a.id, t: a.t, k: 'flex', st: 'tentative', dur: a.d || 30, added: true, after: a.after, ed: true };
      if (a.q) { n.q = a.q; n.mode = 'walking'; }
      if (a.n) n.note = a.n;
      list.splice(at < 0 ? list.length : at + 1, 0, n);
      info.edited++;
    });

    // 2) 逐段重排（夾在固定班次之間的連續非固定項目）
    const out = [];
    let i = 0, prevMoved = false;
    while (i < list.length) {
      if (list[i].k === 'fixed') {
        const fx = list[i], last = out[out.length - 1];
        if (last && fx.os < last.oe && !info.conflicts.some(c => c.anchorId === fx.id) && (fx.alted || last.alted || last.shifted || last.live || last.ed))
          info.conflicts.push({ anchorId: fx.id, anchorT: fx.t, anchorS: fromMin(fx.os), over: last.oe - fx.os });
        prevMoved = !!fx.alted; out.push(fx); i++; continue;
      }
      let j = i; while (j < list.length && list[j].k !== 'fixed') j++;
      const run = list.slice(i, j), anchor = j < list.length ? list[j] : null;
      const isTouched = x => x.dropped || x.ed || x.live || x.dur !== x.oe - x.os;
      const f = prevMoved ? 0 : run.findIndex(isTouched);
      prevMoved = false;
      if (f < 0) { run.forEach(x => out.push(x)); i = j; continue; }
      run.slice(0, f).forEach(x => out.push(x));          // 動到之前的項目時間不變
      const tail = run.slice(f);
      const start = f > 0 ? run[f - 1].oe : (out.length ? out[out.length - 1].oe : tail[0].os);
      let prevOe = f > 0 ? run[f - 1].oe : (out.length ? out[out.length - 1].oe : null); const parts = [];
      let carry = 0; // 被刪掉的項目變成空檔，留給下一個項目前面，後面的時間不會被往前拉
      tail.forEach(x => {
        if (x.os != null) {
          const gap = prevOe == null ? 0 : Math.max(0, x.os - prevOe);
          prevOe = x.oe;
          if (x.dropped) carry += gap + (x.oe - x.os);
          else { parts.push({ it: x, gap: gap + carry }); carry = 0; }
        } else parts.push({ it: x, gap: 0 });
      });
      let total = parts.reduce((s2, p) => s2 + p.gap + p.it.dur, 0);
      const win = anchor ? anchor.os - start : Infinity;
      let over = total - win;
      if (over > 0) { // 先壓空檔，再壓可壓縮緩衝
        parts.forEach(p => { const t = Math.min(over, p.gap); p.gap -= t; over -= t; });
        parts.forEach(p => { const room = (p.it.live || p.it.ed) ? 0 : Math.min(p.it.c || 0, p.it.dur - 5); /* 使用者剛設定的停留時間不壓縮 */ const t = Math.max(0, Math.min(over, room)); p.it.dur -= t; over -= t; });
        if (over > 0 && anchor) info.conflicts.push({ anchorId: anchor.id, anchorT: anchor.t, anchorS: fromMin(anchor.os), over: over });
      }
      let cur = start;
      parts.forEach(p => {
        cur += p.gap;
        const x = p.it, s0 = cur; cur += x.dur;
        x.s = fromMin(Math.min(1438, s0)); x.e = fromMin(Math.min(1439, cur));
        if (x.os != null) { x.os0 = x.os; x.oe0 = x.oe; }
        x.oe = Math.min(1439, cur);
        if (x.os0 != null && x.s !== fromMin(x.os0)) x.shifted = true;
        out.push(x);
      });
      if (anchor) info.slacks[anchor.id] = anchor.os - cur;
      i = j;
    }
    out.forEach(x => {
      if (x.os != null && !x.dropped && !x.s) { x.s = fromMin(x.os); x.e = fromMin(x.oe); }
    });
    const items = out.filter(x => !x.dropped).map(x => {
      const o = Object.assign({}, x); delete o.os; delete o.oe; delete o.os0; delete o.oe0; delete o.dur; delete o.dropped; delete o.after; delete o.added;
      return o;
    });
    const nd = Object.assign({}, day, { plans: day.plans.map(p => p.id === plan.id ? Object.assign({}, p, { items: items }) : p) });
    return { day: nd, info };
  }

  function dayFor(data, now) { return data.days.find(d => d.date === jstDate(now)) || null; }

  function phase(data, now) {
    const d = jstDate(now);
    if (d < data.trip.start) return 'pre';
    if (d > data.trip.end) return 'post';
    return 'in';
  }

  function daysUntil(data, now) {
    return Math.round(diff(toDate(jstDate(now), '00:00'), toDate(data.trip.start, '00:00')) / 1440);
  }

  // 出發前核對提醒：later（還早）/ soon（距核對日 ≤21 天）/ due（已過核對日、尚未出發）/ in-trip
  function verifyInfo(data, now) {
    const t = data.trip || {};
    if (!t.verifyBy) return null;
    const vb = toDate(t.verifyBy, '00:00'), st = toDate(t.start, '00:00');
    const daysToVerify = Math.ceil(diff(now, vb) / 1440);
    const daysToStart = Math.ceil(diff(now, st) / 1440);
    let state = 'later';
    if (now.getTime() >= st.getTime()) state = 'in-trip';
    else if (now.getTime() >= vb.getTime()) state = 'due';
    else if (daysToVerify <= 21) state = 'soon';
    return { state, daysToVerify, daysToStart, verifyBy: t.verifyBy };
  }

  function distanceKm(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // 檢查（或匯入）的 JSON 是否合格；回傳錯誤訊息陣列，空陣列代表通過
  function validate(data) {
    const errs = [];
    if (!data || typeof data !== 'object' || !Array.isArray(data.days) || !data.days.length) return ['缺少 days 陣列'];
    if (!data.trip || !data.trip.start || !data.trip.end) errs.push('缺少 trip.start / trip.end');
    data.days.forEach(day => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date || '')) { errs.push('日期格式錯誤：' + day.date); return; }
      if (!Array.isArray(day.plans) || !day.plans.length) { errs.push(day.date + '：缺少 plans'); return; }
      day.plans.forEach(plan => {
        if (!Array.isArray(plan.items)) { errs.push(day.date + '/' + plan.id + '：缺少 items'); return; }
        const seen = new Set();
        let prevEnd = null, prevId = '';
        plan.items.forEach(it => {
          const tag = day.date + '/' + plan.id + '/' + it.id;
          if (!it.id || seen.has(it.id)) errs.push(tag + '：id 缺少或重複');
          seen.add(it.id);
          if (!it.t) errs.push(tag + '：缺少標題 t');
          if (KINDS.indexOf(it.k) < 0) errs.push(tag + '：k 必須是 ' + KINDS.join('／'));
          if (!HHMM.test(it.s || '') || !HHMM.test(it.e || '')) { errs.push(tag + '：時間格式需為 HH:MM'); return; }
          if (it.e <= it.s) errs.push(tag + '：結束時間必須晚於開始時間');
          if (prevEnd !== null && it.s < prevEnd) errs.push(tag + '：與 ' + prevId + ' 重疊或順序錯誤');
          prevEnd = it.e; prevId = it.id;
          (it.alts || []).forEach(a => {
            if (!HHMM.test(a.s || '') || !HHMM.test(a.e || '')) errs.push(tag + '：備用班次時間格式錯誤');
          });
        });
      });
    });
    return errs;
  }

  return {
    MARGIN, toDate, fmtTime, fmtDur, jstDate, addMin, diff,
    getPlan, materialize, applyEdits, locate, analyze, dayFor, phase, daysUntil, verifyInfo, distanceKm, validate
  };
});
