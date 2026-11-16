/* prep.js — 行前準備：清單、勾選、自訂項目、（選用）雙人雲端同步。
   狀態只存在這支手機（localStorage）；填了同步設定才會連到你自己的 Firebase。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Prep = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const EKEY = /^[mxar]\|\d{4}-\d{2}-\d{2}\|[A-Za-z0-9_-]{1,40}\|[A-Za-z0-9_-]{1,40}$/;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 狀態（純函式，方便測試）---------- */
  function emptyState() { return { c: {}, u: {}, e: {} }; }
  function norm(s) {
    const o = emptyState();
    if (s && typeof s === 'object') {
      if (s.c && typeof s.c === 'object') Object.keys(s.c).forEach(k => { const x = s.c[k]; if (x && typeof x.ts === 'number') o.c[k] = { v: !!x.v, ts: x.ts }; });
      if (s.u && typeof s.u === 'object') Object.keys(s.u).forEach(k => {
        const x = s.u[k];
        if (x && typeof x.ts === 'number' && typeof x.t === 'string' && typeof x.sec === 'string') o.u[k] = { sec: x.sec, t: x.t.slice(0, 200), v: !!x.v, ts: x.ts, del: !!x.del };
      });
    }
    if (s && s.e && typeof s.e === 'object') Object.keys(s.e).forEach(k => {
      const x = s.e[k];
      if (!EKEY.test(k) || !x || typeof x.ts !== 'number') return;
      const v = { ts: x.ts };
      if (x.reset) v.reset = true;
      if (typeof x.t === 'string') v.t = x.t.slice(0, 100);
      if (typeof x.q === 'string') v.q = x.q.slice(0, 100);
      if (typeof x.n === 'string') v.n = x.n.slice(0, 300);
      if (typeof x.after === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.after)) v.after = x.after;
      if (typeof x.d === 'number' && x.d >= 5 && x.d <= 600) v.d = Math.round(x.d);
      if (typeof x.s === 'string' && /^\d\d:\d\d$/.test(x.s)) v.s = x.s;
      if (typeof x.e === 'string' && /^\d\d:\d\d$/.test(x.e)) v.e = x.e;
      if (typeof x.label === 'string') v.label = x.label.slice(0, 40);
      if (typeof x.delay === 'number' && x.delay > 0 && x.delay <= 300) v.delay = Math.round(x.delay);
      if (x.v === true) v.v = true;
      if (x.del === true) v.del = true;
      o.e[k] = v;
    });
    return o;
  }
  function isDone(st, id) {
    if (st.u[id]) return !!st.u[id].v;
    return !!(st.c[id] && st.c[id].v);
  }
  function toggle(st, id, ts) {
    const n = norm(st), cur = isDone(n, id);
    if (n.u[id]) { n.u[id].v = !cur; n.u[id].ts = ts; } else n.c[id] = { v: !cur, ts: ts };
    return n;
  }
  function addCustom(st, sec, text, ts, rnd) {
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return st;
    const n = norm(st);
    n.u['u' + ts.toString(36) + (rnd || Math.random().toString(36).slice(2, 6))] = { sec: sec, t: t, v: false, ts: ts, del: false };
    return n;
  }
  function removeCustom(st, id, ts) {
    const n = norm(st);
    if (n.u[id]) { n.u[id].del = true; n.u[id].ts = ts; }
    return n;
  }
  function setEdit(st, key, fields, ts) {
    const n = norm(st), t = norm({ e: { [key]: Object.assign({}, fields, { ts: ts }) } }).e[key];
    if (t) n.e[key] = t;
    return n;
  }
  /* 兩份狀態合併：每個項目取較新的一筆 */
  function merge(a, b) {
    const x = norm(a), y = norm(b), o = emptyState();
    ['c', 'u', 'e'].forEach(k => {
      const keys = new Set(Object.keys(x[k]).concat(Object.keys(y[k])));
      keys.forEach(id => {
        const p = x[k][id], q = y[k][id];
        o[k][id] = !p ? q : !q ? p : (q.ts > p.ts ? q : p);
      });
    });
    return o;
  }
  function same(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }

  function sectionItems(sec, st) {
    const base = (sec.items || []).map(it => ({ id: it.id, t: it.t, note: it.note || '', due: it.due || '', dueLabel: it.dueLabel || '', custom: false, v: isDone(st, it.id) }));
    const mine = Object.keys(st.u).filter(id => st.u[id].sec === sec.id && !st.u[id].del)
      .sort((p, q) => st.u[p].ts - st.u[q].ts)
      .map(id => ({ id: id, t: st.u[id].t, note: '', due: '', dueLabel: '', custom: true, v: !!st.u[id].v }));
    return base.concat(mine);
  }
  function progress(prep, st) {
    let done = 0, total = 0;
    (prep.sections || []).forEach(sec => sectionItems(sec, st).forEach(it => { total++; if (it.v) done++; }));
    return { done: done, total: total };
  }
  function dayDiff(from, to) { // 'YYYY-MM-DD' 兩者相差天數
    const f = s => { const p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
    return Math.round((f(to) - f(from)) / 86400000);
  }
  function dueText(it, today) {
    if (!it.due || it.v) return '';
    const n = dayDiff(today, it.due), md = Number(it.due.slice(5, 7)) + '/' + Number(it.due.slice(8, 10));
    const label = it.dueLabel || '期限';
    if (n < 0) return '<span class="pdue late">' + label + ' ' + md + '（已過 ' + (-n) + ' 天）</span>';
    if (n === 0) return '<span class="pdue soon">' + label + ' ' + md + '（就是今天）</span>';
    return '<span class="pdue' + (n <= 14 ? ' soon' : '') + '">' + label + ' ' + md + '（還有 ' + n + ' 天）</span>';
  }

  /* ---------- 畫面 ---------- */
  function html(prep, st, today, sync, tripStart) {
    const pr = progress(prep, st);
    const left = tripStart ? dayDiff(today, tripStart) : null;
    let h = '<div class="ptop"><div class="ptitle">🧳 行前準備</div><div class="psub">' +
      (left != null && left > 0 ? '距離出發還有 ' + left + ' 天　' : '') + '已完成 ' + pr.done + '／' + pr.total + '</div>' +
      '<div class="pbar"><i style="width:' + (pr.total ? Math.round(pr.done * 100 / pr.total) : 0) + '%"></i></div></div>';
    (prep.sections || []).forEach(sec => {
      const items = sectionItems(sec, st), d = items.filter(i => i.v).length;
      h += '<section class="psec"><h3>' + sec.icon + ' ' + esc(sec.title) + '<span>' + d + '／' + items.length + '</span></h3>' +
        (sec.hint ? '<p class="phint">' + esc(sec.hint) + '</p>' : '') + '<ul class="plist">';
      items.forEach(it => {
        h += '<li class="pit' + (it.v ? ' done' : '') + '"><button class="pck" data-p="toggle" data-id="' + esc(it.id) + '" aria-label="' + (it.v ? '取消完成' : '標為完成') + '">' + (it.v ? '✔' : '') + '</button>' +
          '<div class="ptxt"><div>' + esc(it.t) + '</div>' + (it.note ? '<div class="pnote">' + esc(it.note) + '</div>' : '') + dueText(it, today) + '</div>' +
          (it.custom ? '<button class="pdel" data-p="del" data-id="' + esc(it.id) + '" aria-label="刪除">✕</button>' : '') + '</li>';
      });
      h += '</ul><div class="padd"><input type="text" id="padd-' + esc(sec.id) + '" maxlength="200" placeholder="新增一項…" enterkeyhint="done">' +
        '<button class="big" data-p="add" data-sec="' + esc(sec.id) + '">加入</button></div></section>';
    });
    h += syncHTML(sync);
    return h;
  }
  function syncHTML(sync) {
    const s = sync || {};
    return '<section class="psec"><h3>☁ 備份與雙人同步<span></span></h3>' +
      '<p class="phint">資料預設只存在這支手機。想跟另一個人同步，需要自己的 Firebase（免費額度即可）；詳細步驟請看倉庫的 README。</p>' +
      '<div class="pform"><label>Firebase 專案 ID<input type="text" id="sy-pid" value="' + esc(s.pid || '') + '" autocapitalize="off" autocorrect="off"></label>' +
      '<label>Web API 金鑰<input type="text" id="sy-key" value="' + esc(s.key || '') + '" autocapitalize="off" autocorrect="off"></label>' +
      '<label>家庭代碼（兩人輸入一樣的，至少 20 個字元，像密碼一樣不要外流）<input type="text" id="sy-code" value="' + esc(s.code || '') + '" autocapitalize="off" autocorrect="off"></label></div>' +
      '<div class="row2"><button class="big" data-p="sync-save">儲存並同步</button><button class="big sub" data-p="sync-now">立即同步</button><button class="big sub" data-p="sync-off">停用同步</button></div>' +
      '<div id="sy-msg" class="pnote" style="margin-top:8px">' + esc(s.msg || '') + '</div>' +
      '<div class="row2" style="margin-top:12px"><button class="big sub" data-p="export">複製備份</button><button class="big sub" data-p="import">貼上備份並合併</button></div>' +
      '<textarea id="p-backup" placeholder="備份文字貼在這裡" style="margin-top:8px"></textarea></section>';
  }

  /* ---------- Firestore REST（選用同步）---------- */
  const CODE_RE = /^[A-Za-z0-9_-]{20,64}$/, PID_RE = /^[a-z][a-z0-9-]{4,29}$/;
  function checkCfg(c) {
    if (!c || !PID_RE.test(c.pid || '')) return '專案 ID 格式不對（小寫英文、數字、連字號）';
    if (!/^[A-Za-z0-9_-]{20,60}$/.test(c.key || '')) return 'API 金鑰格式不對';
    if (!CODE_RE.test(c.code || '')) return '家庭代碼需 20～64 個英數字元（可含 - 或 _）';
    return '';
  }
  function docUrl(c, mask) {
    return 'https://firestore.googleapis.com/v1/projects/' + c.pid + '/databases/(default)/documents/trips/' + c.code +
      '?' + (mask ? 'updateMask.fieldPaths=data&' : '') + 'key=' + encodeURIComponent(c.key);
  }
  async function pull(c, fetchFn) {
    const r = await fetchFn(docUrl(c, false));
    if (r.status === 404) return emptyState();
    if (!r.ok) throw new Error('讀取失敗（' + r.status + '）');
    const j = await r.json();
    const raw = j && j.fields && j.fields.data && j.fields.data.stringValue;
    return raw ? norm(JSON.parse(raw)) : emptyState();
  }
  async function push(c, st, fetchFn) {
    const r = await fetchFn(docUrl(c, true), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { data: { stringValue: JSON.stringify(norm(st)) } } })
    });
    if (!r.ok) throw new Error('寫入失敗（' + r.status + '）');
  }
  /* 讀遠端 → 合併 → 有差異才寫回。回傳合併後狀態。 */
  async function syncOnce(c, st, fetchFn) {
    const remote = await pull(c, fetchFn);
    const merged = merge(st, remote);
    if (!same(merged, remote)) await push(c, merged, fetchFn);
    return merged;
  }

  /* ---------- 與畫面接線 ---------- */
  function attach(opts) {
    // opts: {doc, el(): 容器, prep(): 資料, today(): 'YYYY-MM-DD', start(): 出發日, load(k,d), save(k,v), toast(m), fetch, now()}
    const doc = opts.doc;
    let st = norm(opts.load('hk.prep', null));
    let sync = opts.load('hk.sync', null) || {};
    let timer = null;
    const view = () => { const el = opts.el(); if (el) el.innerHTML = html(opts.prep(), st, opts.today(), Object.assign({}, (opts.prep() || {}).sync || {}, sync), opts.start()); };
    const persist = () => { opts.save('hk.prep', st); scheduleSync(); };
    function scheduleSync() {
      if (!sync.on || checkCfg(sync)) return;
      opts.clearTimeout(timer); timer = opts.setTimeout(() => runSync(true), 1500);
    }
    async function runSync(quiet) {
      const bad = checkCfg(sync);
      if (bad) { setMsg(bad); return; }
      try {
        const m = await syncOnce(sync, st, opts.fetch);
        if (!same(m, st)) { st = m; opts.save('hk.prep', st); view(); if (opts.onChange) opts.onChange(); }
        setMsg('已同步 ' + opts.now().toTimeString().slice(0, 5));
        if (!quiet) opts.toast('已同步');
      } catch (e) { setMsg('同步失敗：' + e.message + '（目前仍存在這支手機）'); }
    }
    function setMsg(m) { sync.msg = m; opts.save('hk.sync', sync); const e = doc.getElementById('sy-msg'); if (e) e.textContent = m; }
    function readCfg() {
      const g = id => (doc.getElementById(id).value || '').trim();
      return { pid: g('sy-pid'), key: g('sy-key'), code: g('sy-code') };
    }
    function onClick(ev) {
      const t = ev.target && ev.target.closest && ev.target.closest('[data-p]');
      if (!t) return;
      const a = t.getAttribute('data-p'), id = t.getAttribute('data-id');
      const ts = opts.now().getTime();
      if (a === 'toggle') {
        st = toggle(st, id, ts); persist(); view();
        if (opts.fx && opts.fx.toggled) {
          const pr = opts.prep(), sec = (pr.sections || []).find(s => sectionItems(s, st).some(x => x.id === id));
          const items = sec ? sectionItems(sec, st) : [], done = isDone(st, id), complete = done && items.length && items.every(x => x.v);
          const el = doc.querySelector('[data-p="toggle"][data-id="' + id + '"]');
          opts.fx.toggled(el, done, complete, el && el.closest('.psec'));
        }
      }
      else if (a === 'del') { if (opts.fx && opts.fx.confirm && !opts.fx.confirm(t, '再按一次刪除')) return; st = removeCustom(st, id, ts); persist(); view(); }
      else if (a === 'add') {
        const sec = t.getAttribute('data-sec'), inp = doc.getElementById('padd-' + sec);
        const n = addCustom(st, sec, inp && inp.value, ts); if (n === st) { opts.toast('請先輸入內容'); return; }
        st = n; persist(); view();
        const again = doc.getElementById('padd-' + sec); if (again && again.focus) again.focus();
      }
      else if (a === 'sync-save') {
        const c = readCfg(), bad = checkCfg(c);
        if (bad) { setMsg(bad); return; }
        sync = { pid: c.pid, key: c.key, code: c.code, on: true, msg: '同步中…' }; opts.save('hk.sync', sync); runSync(false);
      }
      else if (a === 'sync-now') { if (!sync.on) { setMsg('請先填好設定並按「儲存並同步」'); return; } runSync(false); }
      else if (a === 'sync-off') { sync = {}; opts.save('hk.sync', sync); view(); opts.toast('已停用同步，資料仍保留在這支手機'); }
      else if (a === 'export') {
        const txt = JSON.stringify(st), ta = doc.getElementById('p-backup');
        if (ta) ta.value = txt;
        if (opts.copy) opts.copy(txt).then(() => opts.toast('已複製備份'), () => opts.toast('請手動複製文字框內容'));
      }
      else if (a === 'import') {
        const ta = doc.getElementById('p-backup');
        try {
          const j = JSON.parse((ta && ta.value) || '');
          if (!j || typeof j !== 'object' || !j.c || !j.u) throw new Error('格式不符');
          st = merge(st, j); persist(); view(); opts.toast('已合併備份');
        } catch (e) { opts.toast('備份文字無法讀取：' + e.message); }
      }
    }
    doc.addEventListener('click', ev => { const el = opts.el(); if (el && el.contains(ev.target)) onClick(ev); });
    doc.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' || !ev.target || !ev.target.id || ev.target.id.indexOf('padd-') !== 0) return;
      const b = opts.el().querySelector('[data-p="add"][data-sec="' + ev.target.id.slice(5) + '"]'); if (b) b.click();
    });
    return {
      render(soft) {
        const el = opts.el(); if (!el) return;
        if (soft) { // 正在輸入時，不要因為定時刷新把字洗掉
          const act = doc.activeElement;
          if (act && el.contains(act) && (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA')) return;
          const vals = el.querySelectorAll('input[id^="padd-"],#p-backup');
          for (let i = 0; i < vals.length; i++) if (vals[i].value) return;
        }
        view();
      },
      summary() { return progress(opts.prep(), st); },
      getEdits() { return st.e; },
      edit(key, fields) { st = setEdit(st, key, fields, opts.now().getTime()); persist(); if (opts.onChange) opts.onChange(); },
      editMany(list) { const ts = opts.now().getTime(); list.forEach(x => { st = setEdit(st, x.key, x.fields, ts); }); persist(); if (opts.onChange) opts.onChange(); },
      autoSync() { if (sync.on) runSync(true); },
      getState() { return st; }
    };
  }

  return { emptyState, norm, setEdit, toggle, addCustom, removeCustom, merge, same, progress, sectionItems, dayDiff, dueText, html, checkCfg, pull, push, syncOnce, attach };
});
