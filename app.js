/* app.js — 介面與互動。時間計算全部在 engine.js。 */
(function (root) {
  'use strict';
  const E = root.Engine;
  const doc = root.document;
  const $ = id => doc.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = d => { const p = d.split('-'); return Number(p[1]) + '/' + Number(p[2]); };

  const STATUS = {
    confirmed: ['已確定', 'st-ok'], tentative: ['暫定', 'st-tent'], candidate: ['候選', 'st-cand'],
    pending: ['待確認', 'st-pend'], backup: ['備案', 'st-back']
  };
  const KIND = { fixed: '固定', flex: '可調整', move: '移動', wait: '候車／緩衝' };
  const STATE_LABEL = { green: '進度正常', yellow: '有點緊', red: '再待就會錯過' };

  const S = {
    data: null, tab: null, choice: {}, ext: { id: null, ext: 0, leaveNow: false },
    prep: null, prepCtl: null, stations: null, stCtl: null, sim: null, pos: null, watch: null, expanded: {}, rt: {}, flip: {}, justFlip: null, lang: (load('hk.lang') || 'jp'), last: null, timer: null, bound: false,
    ux: null, userScrollAt: 0, autoScrolling: false, justOpened: null, slide: '', scrollNow: true, alerted: {}, lastCount: null
  };

  function load(k, d) { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式等情況略過 */ } }
  function drop(k) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function getNow() { return S.sim ? new Date(S.sim.base + (Date.now() - S.sim.real)) : new Date(); }
  function planFor(day) { return S.choice[day.date] || day.defaultPlan || day.plans[0].id; }
  function mapsUrl(it) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(it.q) + '&travelmode=' + (it.mode || 'transit');
  }
  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.className = 'show';
    root.clearTimeout(toast.t); toast.t = root.setTimeout(() => { t.className = ''; }, 2600);
  }

  /* ---------- 自訂異動：換景點、改時間、加刪一站 ---------- */
  function edits() { return S.prepCtl ? S.prepCtl.getEdits() : {}; }
  function eff(day) { return E.applyEdits(day, planFor(day), edits()); }
  const ekey = (kind, date, plan, id) => kind + '|' + date + '|' + plan + '|' + id;

  // 時間軸用：把「＋15／＋30／現在出發」暫時套進去，後面的行程即時重排（不存成自訂）
  function liveEff(day, a, now) {
    const plan = planFor(day);
    if (!a || !S.ext.id || !a.cur || a.cur.virtual || a.cur.id !== S.ext.id || E.jstDate(now) !== day.date) return eff(day);
    const k = ekey('m', day.date, plan, a.cur.id), base = edits()[k];
    const keep = base && !base.reset ? base : {};
    const d = S.ext.leaveNow ? Math.max(5, Math.round((now - a.cur.start) / 60000)) : a.cur.dur + S.ext.ext;
    const extra = {}; extra[k] = Object.assign({}, keep, { ts: Date.now(), d: d, tmp: true });
    return E.applyEdits(day, plan, Object.assign({}, edits(), extra));
  }
  function takeAlt(fixedId, alt, day) {
    day = day || curDay(); const plan = planFor(day);
    if (!S.prepCtl) { toast('需要先打開行程資料'); return; }
    S.prepCtl.edit(ekey('r', day.date, plan, fixedId), { s: alt.s, e: alt.e, label: alt.label || '' });
    if (S.ux) S.ux.play('done');
    toast('已改搭 ' + (alt.label || alt.s) + '，後面的行程已重排');
  }

  /* ---------- 分析 ---------- */
  function compute(now, today) {
    if (!today) return null;
    const items = E.materialize(eff(today).day, planFor(today));
    let a = E.analyze(items, today, now, {});
    if (S.ext.id) {
      const trial = E.analyze(items, today, now, { ext: S.ext.ext, leaveNow: S.ext.leaveNow, holdId: S.ext.id });
      if (trial.cur && trial.cur.id === S.ext.id && (trial.mode === 'adjust' || trial.mode === 'free')) a = trial;
      else { S.ext = { id: null, ext: 0, leaveNow: false }; save('hk.ext', S.ext); }
    }
    return { items, a, day: today };
  }

  /* ---------- 畫面片段 ---------- */
  function li(s) { return '<li>' + s + '</li>'; }

  function heroModel(ctx) {
    const { a, now, phase } = ctx;
    if (phase === 'pre') {
      const n = E.daysUntil(S.data, now);
      return { cls: 'h-gray', html:
        '<div class="hero-top">旅程倒數</div><div class="count">' + n + ' 天</div>' +
        '<div class="count-sub">' + esc(S.data.trip.name) + ' · ' + md(S.data.trip.start) + ' 出發</div>' +
        '<ul class="hero-lines">' + li('還沒出發。想預覽旅途中的樣子，點右上角 ⚙ 用「模擬時間」。') + '</ul>' };
    }
    if (phase === 'post' || !a) {
      return { cls: 'h-gray', html: '<div class="hero-top">旅程資料</div><div class="count">已結束</div><div class="count-sub">這份行程只涵蓋 ' + md(S.data.trip.start) + '–' + md(S.data.trip.end) + '</div>' };
    }
    const L = [];
    if (a.mode === 'empty' || a.mode === 'done') {
      return { cls: 'h-gray', html: '<div class="hero-top">今天</div><div class="count">行程已結束</div><div class="count-sub">好好休息</div>' };
    }
    if (a.mode === 'before') {
      L.push(li('今天第一件事：<b>' + E.fmtTime(a.next.start) + '</b> ' + esc(a.next.t)));
      return { cls: 'h-gray', html: '<div class="hero-top">今天還沒開始</div><div class="count">' + E.fmtDur(a.toNext) + '</div><div class="count-sub">後開始「' + esc(a.next.t) + '」</div><ul class="hero-lines">' + L.join('') + '</ul>' };
    }
    if (a.mode === 'onboard') {
      if (a.after) L.push(li('接著：<b>' + E.fmtTime(a.after.start) + '</b> ' + esc(a.after.t)));
      if (a.F) L.push(li('下一個固定行程：<b>' + E.fmtTime(a.F.start) + '</b> ' + esc(a.F.t)));
      return { cls: 'h-gray', html: '<div class="hero-top">進行中 · ' + esc(a.cur.t) + '</div><div class="count">' + E.fmtDur(a.remaining) + '</div><div class="count-sub">後結束（' + E.fmtTime(a.cur.end) + '）</div><ul class="hero-lines">' + L.join('') + '</ul>' };
    }
    const cur = a.cur;
    const top = '現在 · ' + esc(cur.t);
    if (a.mode === 'free') {
      L.push(li('今天沒有更多固定班次，不用趕時間。'));
      if (a.next) L.push(li('接著：<b>' + E.fmtTime(a.next.start) + '</b> ' + esc(a.next.t)));
      sun(a, L);
      return { cls: 'h-green', html: '<div class="hero-top">' + top + '</div><div class="count">' + E.fmtDur(Math.max(a.remainingNew, 0)) + '</div><div class="count-sub">後結束這一段（' + E.fmtTime(a.newEnd) + '）</div><ul class="hero-lines">' + L.join('') + '</ul>' };
    }
    const F = a.F;
    if (a.stayComfort >= 0) L.push(li('建議 <b>' + E.fmtTime(a.comfortLeave) + '</b> 前離開（還有 ' + E.fmtDur(a.stayComfort) + '）'));
    else L.push(li('已超過建議離開時間 ' + E.fmtDur(-a.stayComfort)));
    if (a.stayLatest >= 0) L.push(li('最晚 <b>' + E.fmtTime(a.latestLeave) + '</b> 離開（候車緩衝全用掉）'));
    else L.push(li('已超過最晚離開時間'));
    if (S.ext.leaveNow) {
      L.push(li('<b>現在出發</b>：' + (a.slackComfort >= 0 ? '比原計畫多出 ' + E.fmtDur(a.slackComfort) + ' 餘裕' : '仍比建議晚 ' + E.fmtDur(-a.slackComfort))));
    } else if (S.ext.ext > 0) {
      const res = a.status === 'green' ? '不影響後面行程' :
        a.status === 'yellow' ? '趕得上，但緩衝只剩 ' + E.fmtDur(a.slackLatest) : '會錯過「' + esc(F.t) + '」';
      L.push(li('多待 <b>' + S.ext.ext + ' 分</b> → ' + E.fmtTime(a.newEnd) + ' 離開：' + res));
    }
    if (a.status === 'red') {
      if (a.alt) L.push(li('<span class="warn">下一個選擇：' + esc(a.alt.alt.label) + ' ' + a.alt.alt.s + ' → ' + a.alt.alt.e + '（後面整體晚 ' + a.alt.delayArrive + ' 分）</span>') +
        '<button class="hero-btn" data-act="take-alt" data-v="' + esc(F.id) + '|' + esc(a.alt.alt.s) + '">改搭 ' + esc(a.alt.alt.label) + '，重排後面行程</button>');
      else {
        const later = (F.alts || []).filter(x => !x.earlier);
        L.push(li('<span class="warn">' + (later.length ? '列出的備用班次（最晚 ' + later[later.length - 1].s + '）也趕不上，請用 Google 地圖查下一班。' : '這一項沒有列較晚的備用班次，請用 Google 地圖查下一班。') + '</span>'));
      }
    }
    sun(a, L);
    return { cls: 'h-' + a.status, html:
      '<div class="hero-top">' + top + ' <span class="pill">' + STATE_LABEL[a.status] + '</span></div>' +
      '<div class="count">' + E.fmtDur(a.toFixed) + '</div>' +
      '<div class="count-sub">距「' + esc(F.t) + '」' + E.fmtTime(F.start) + '</div>' +
      '<ul class="hero-lines">' + L.join('') + '</ul>' +
      ((S.ext.ext > 0 || S.ext.leaveNow) ? '<button class="link" data-act="reset">重設調整</button>' : '') };
  }
  function sun(a, L) {
    if (a.sunsetIn == null) return;
    const near = a.sunsetIn <= 180 || (a.cur && a.cur.out);
    if (!near || a.sunsetIn < -60) return;
    L.push(li(a.sunsetIn > 0 ? '日落 ' + (a.sunsetApprox ? '約 ' : '') + E.fmtTime(a.sunset) + '（還有 ' + E.fmtDur(a.sunsetIn) + '）' : '已日落'));
    if (a.sunsetWarn) L.push(li('<span class="warn">⚠ 待到 ' + E.fmtTime(a.newEnd) + ' 已過日落，戶外又冷又暗</span>'));
  }

  function navItem(a) {
    if (!a) return null;
    return [a.F, a.next, a.after].find(x => x && x.q) || null;
  }

  function barHTML(a) {
    const can = a && (a.mode === 'adjust' || a.mode === 'free');
    const dis = can ? '' : ' disabled';
    const nav = navItem(a);
    return '<button data-act="ext" data-v="15"' + dis + '>＋15 分</button>' +
      '<button data-act="ext" data-v="30"' + dis + '>＋30 分</button>' +
      '<button data-act="leave"' + dis + (S.ext.leaveNow ? ' class="on"' : '') + '>現在出發</button>' +
      (nav ? '<a class="btn" href="' + mapsUrl(nav) + '" target="_blank" rel="noopener">導航</a>' : '<button disabled>導航</button>');
  }

  function detailHTML(it, day) {
    const p = [];
    if (it.w) p.push('<div class="d-line">📍 ' + esc(it.w) + '</div>');
    if (it.note) p.push('<div class="d-note">' + esc(it.note) + '</div>');
    if (it.alts && it.alts.length) {
      p.push('<div class="d-alts"><b>備用班次</b>' + it.alts.map(a =>
        '<div>' + (a.earlier ? '⏪ 較早' : '⏩ 較晚') + ' ' + esc(a.label) + '　' + a.s + ' → ' + a.e + '</div>').join('') + '</div>');
    }
    if (S.pos && it.lat != null) p.push('<div class="d-line">距你約 ' + E.distanceKm(S.pos, it).toFixed(1) + ' km（直線，座標為概略值）</div>');
    const jp = S.stCtl && S.stCtl.jpFor ? S.stCtl.jpFor(it.id) : null;
    if (jp && jp.rt) {
      p.push('<div class="d-acts"><button class="chip" data-act="rt" data-v="' + esc(it.id + '|' + jp.rt + '|' + (day ? day.date : '')) + '">📡 查即時運行</button>' +
        '<a class="chip" href="' + RT_PAGES[jp.rt] + '" target="_blank" rel="noopener">官方運行資訊 ↗</a></div>' + (S.rt[it.id] ? S.rt[it.id].html : ''));
    }
    if (jp && jp.name) p.push('<div class="d-sign"><div class="d-sign-h">🇯🇵 現場看板找這些字</div><div><small>車名</small><b>' + esc(jp.name) + '</b></div><div><small>上車</small><b>' + esc(jp.from) + '</b></div><div><small>下車</small><b>' + esc(jp.to) + '</b></div><div><small>方向</small><b>' + esc(jp.dir) + '</b></div>' + (jp.kind === 'jr' ? '<div class="d-sign-n">月台看板的「行先」可能寫更遠的終點站，認車名和號數最準。</div>' : '') + '</div>');
    const jpText = jp && jp.copy ? jp.copy : (it.q || '');
    if (jpText || it.q) {
      if (jpText) p.push('<div class="d-jp">🇯🇵 ' + esc(jpText) + '</div>');
      p.push('<div class="d-acts">' + (it.q ? '<a class="chip" href="' + mapsUrl(it) + '" target="_blank" rel="noopener">開 Google 地圖</a>' : '') +
        (jpText ? '<button class="chip" data-act="copy" data-v="' + esc('🇯🇵 ' + jpText) + '">複製地名（給司機看）</button>' : '') + '</div>');
    }
    if (S.prepCtl && it.kind !== 'fixed' && day) {
      p.push('<div class="d-acts edit-acts">' +
        '<button class="chip" data-act="edit-item" data-v="' + esc(it.id) + '">✎ 改這一站</button>' +
        '<button class="chip" data-act="add-after" data-v="' + esc(it.id) + '">＋ 後面加一站</button>' +
        '<button class="chip" data-act="del-item" data-v="' + esc(it.id) + '">🗑 刪除</button>' +
        (it.ed ? '<button class="chip" data-act="reset-item" data-v="' + esc(it.id) + '">↩ 還原這一站</button>' : '') + '</div>');
    }
    if (S.stCtl && S.stCtl.hasGuide(it.id)) p.push('<div class="d-acts"><button class="chip" data-act="guide" data-v="' + esc(it.id) + '">🚉 站內怎麼走</button><button class="chip" data-act="board" data-v="">班次看板</button></div>');
    if (it.kind === 'fixed' && S.prepCtl && ((it.alts && it.alts.length) || it.alted)) {
      p.push('<div class="d-acts">' + (it.alts || []).map(x => '<button class="chip" data-act="pick-alt" data-v="' + esc(it.id) + '|' + esc(x.s) + '">改搭 ' + esc(x.label) + ' ' + x.s + '</button>').join('') +
        (it.alted ? '<button class="chip" data-act="reset-alt" data-v="' + esc(it.id) + '">↩ 改回原班次 ' + esc(it.origS || '') + '</button>' : '') + '</div>');
    }
    if (it.kind === 'fixed' && S.prepCtl && !(it.alts && it.alts.length)) p.push('<div class="d-note">🔒 固定班次／預約不能在 App 裡改（避免誤動）。</div>');
    return p.join('') || '<div class="d-note">沒有更多資訊</div>';
  }

  function editBannerHTML(day) {
    const info = S.dayInfo; if (!S.prepCtl || !info) return '';
    let h = '';
    if (info.edited) h += '<div class="notice sim">✎ 這天有 ' + info.edited + ' 處自訂　<button class="link" data-act="reset-day">還原本日</button></div>';
    (info.conflicts || []).forEach(c => {
      h += '<div class="notice warn">⚠ 「' + esc(c.anchorT) + '」' + c.anchorS + ' 會來不及：前面的行程超出 ' + c.over + ' 分。請縮短停留或刪掉一站。</div>';
    });
    return h;
  }

  /* 搭車項目（JR／地鐵／公車）：點列車名稱在中文和日文看板寫法之間翻面 */
  function jpOf(it) { const j = S.stCtl && S.stCtl.jpFor ? S.stCtl.jpFor(it.id) : null; return j && j.name ? j : null; }
  function jpTitle(it) {
    const j = jpOf(it); if (!j) return null;
    return (j.kind === 'bus' ? '🚌 ' : j.kind === 'subway' ? 'Ⓜ️ ' : '🚆 ') + j.name + '：' + j.from + ' → ' + j.to + '（' + j.dir + '）';
  }
  function showJp(it, key) { return !!jpOf(it) && ((S.lang !== 'zh') !== !!S.flip[key]); }
  function ttlFor(it, key) { return showJp(it, key) ? jpTitle(it) : it.t; }
  function timelineHTML(ctx) {
    const { items, day, now, a } = ctx;
    const isToday = E.jstDate(now) === day.date;
    const curId = isToday && a && a.cur && !a.cur.virtual ? a.cur.id : null;
    const nowIdx = isToday ? (() => { const i = items.findIndex(x => x.start.getTime() > now.getTime()); return i < 0 ? items.length : i; })() : -1;
    const nowLine = '<li class="nowline" id="nowline" aria-hidden="true"><span>現在 ' + E.fmtTime(now) + '</span></li>';
    return items.map((it, i) => {
      const past = isToday && now.getTime() >= it.end.getTime() && it.id !== curId;
      const st = STATUS[it.st] || STATUS.tentative;
      const open = S.expanded[day.date + '/' + it.id];
      const html = '<li class="row k-' + it.kind + (past ? ' past' : '') + (it.id === curId ? ' now' : '') + '" data-row="' + esc(day.date + '/' + it.id) + '">' +
        '<div class="tm"><b>' + it.s + '</b><span>' + it.e + '</span></div><div class="dot"></div>' +
        '<div class="body"><div class="ttl' + (jpTitle(it) ? ' flippable' : '') + (S.justFlip === day.date + '/' + it.id ? ' flipin' : '') + '" data-flip="' + (jpTitle(it) ? '1' : '') + '">' + esc(ttlFor(it, day.date + '/' + it.id)) + '</div>' +
        '<div class="meta"><span class="badge ' + st[1] + '">' + st[0] + '</span><span>' + it.dur + ' 分</span><span>' + KIND[it.kind] + '</span>' +
          (it.alted ? '<span class="badge st-cand">🔁 已改班次</span>' : it.ed ? '<span class="badge st-cand">✎ 自訂</span>' : '') + (it.live ? '<span class="badge st-back">依你的調整</span>' : '') + (it.shifted ? '<span class="badge st-tent">時間已重排</span>' : '') + '</div>' +
        (S.prepCtl && it.kind !== 'fixed' ? '<div class="rowacts"><button class="rowbtn" data-act="edit-item" data-v="' + esc(it.id) + '">↔ 換地點</button><button class="rowbtn" data-act="add-after" data-v="' + esc(it.id) + '">＋ 後面加</button></div>' : '') +
        (open ? '<div class="detail' + (S.justOpened === day.date + '/' + it.id ? ' opening' : '') + '">' + detailHTML(it, day) + '</div>' : '') + '</div></li>';
      return (i === nowIdx ? nowLine : '') + html;
    }).join('') + (nowIdx === items.length && items.length ? nowLine : '') +
      (S.prepCtl && items.length ? '<li class="addrow"><button class="addstop" data-act="add-after" data-v="' + esc(items[items.length - 1].id) + '">＋ 在這天最後新增一個地點</button></li>' : '');
  }

  function plansHTML(day) {
    if (day.plans.length < 2) return '';
    const sel = planFor(day), decided = !!S.choice[day.date];
    return '<div class="plan-title">這天有 ' + day.plans.length + ' 套方案' + (decided ? '' : '（尚未決定，先顯示「' + esc(E.getPlan(day, sel).label) + '」）') + '</div>' +
      '<div class="plan-row">' + day.plans.map(p => {
        const st = STATUS[p.st] || STATUS.tentative;
        return '<button class="plan ' + (p.id === sel ? 'on' : 'off') + '" data-plan="' + esc(p.id) + '" data-date="' + day.date + '">' +
          esc(p.label) + '<small>' + st[0] + '</small></button>';
      }).join('') + '</div>';
  }

  function bannerHTML(now) {
    const out = [];
    if (S.sim) out.push('<div class="notice sim">🕒 模擬時間（日本時間）' + md(E.jstDate(getNow())) + ' ' + E.fmtTime(getNow()) + '　<button class="link" data-act="sim-stop">回到現實</button></div>');
    const v = E.verifyInfo(S.data, now);
    if (v && v.state === 'due') out.push('<div class="notice warn">⚠ 已進入出發前一週：請重新核對 JR／巴士時刻與各項預約。<button class="link" data-act="open-settings">核對清單</button></div>');
    else if (v && v.state === 'soon') out.push('<div class="notice">📋 ' + md(v.verifyBy) + ' 前請重新核對班次（還有 ' + v.daysToVerify + ' 天）。<button class="link" data-act="open-settings">核對清單</button></div>');
    return out.join('');
  }

  /* ---------- 主繪製 ---------- */
  function render() {
    if (!S.data) return;
    const now = getNow();
    const phase = E.phase(S.data, now);
    const today = E.dayFor(S.data, now);
    const ctx = compute(now, today) || {};
    const a = ctx.a || null;
    S.last = { a, today, now };

    const hasPrep = !!(S.prep && S.prepCtl);
    if (!S.tab || (!(S.tab === 'prep' && hasPrep) && !S.data.days.some(d => d.date === S.tab))) S.tab = today ? today.date : (phase === 'pre' && hasPrep ? 'prep' : S.data.days[0].date);
    const onPrep = S.tab === 'prep' && hasPrep;
    const day = S.data.days.find(d => d.date === S.tab) || S.data.days[0];
    const todayDate = E.jstDate(now);

    $('tabs').innerHTML = (hasPrep ? '<button class="tab' + (onPrep ? ' on' : '') + '" data-tab="prep">行前<small>準備</small></button>' : '') + S.data.days.map(d =>
      '<button class="tab' + (d.date === S.tab ? ' on' : '') + (d.date === todayDate ? ' today' : '') + '" data-tab="' + d.date + '">' + md(d.date) + '<small>' + esc(d.dow || '') + '</small></button>').join('');
    $('banner').innerHTML = bannerHTML(now);

    ['hero', 'plans', 'daybar', 'timeline'].forEach(id => { $(id).style.display = onPrep ? 'none' : ''; });
    $('bar').style.display = onPrep ? 'none' : '';
    $('prepview').style.display = onPrep ? 'block' : 'none';
    if (onPrep) {
      S.prepCtl.render(true);
      $('foot').innerHTML = esc(S.data.trip.disclaimer || '') + '<br>資料查核日 ' + esc(S.data.trip.checked || '');
      return;
    }

    const h = heroModel({ a, now, phase });
    $('hero').className = 'hero ' + h.cls;
    $('hero').innerHTML = h.html;

    const dayEff = liveEff(day, a, now);
    S.dayInfo = dayEff.info;
    $('plans').innerHTML = plansHTML(day);
    $('daybar').innerHTML = '<div class="daytitle">' + md(day.date) + '（' + esc(day.dow || '') + '）' + esc(day.title) + '</div>' +
      '<div class="lodging">🛏 ' + esc(day.lodging || '') + '</div>' + (day.note ? '<div class="daynote">' + esc(day.note) + '</div>' : '') + editBannerHTML(day);

    const dayItems = E.materialize(dayEff.day, planFor(day));
    const dayCtx = (S.last.today && S.last.today.date === day.date) ? { a } : { a: null };
    $('timeline').innerHTML = timelineHTML({ items: dayItems, day, now, a: dayCtx.a });
    $('bar').innerHTML = barHTML(a);
    $('foot').innerHTML = esc(S.data.trip.disclaimer || '') + '<br>資料查核日 ' + esc(S.data.trip.checked || '');
    const loc = $('btn-loc'); if (loc) loc.className = S.watch != null ? 'on' : '';
    afterRender(a, day, now);
  }

  /* ---------- 繪製後的動態效果 ---------- */
  function afterRender(a, day, now) {
    const UX = S.ux, main = doc.querySelector('main');
    if (main && S.slide) { main.classList.remove('enter-l', 'enter-r'); void main.offsetWidth; main.classList.add(S.slide); }
    S.slide = ''; S.justOpened = null;
    const hero = $('hero');
    // 倒數最後 10 分鐘：整張卡脈動，並提醒一次
    if (a && a.F && a.mode === 'adjust' && a.toFixed != null && a.toFixed <= 10 && a.toFixed > 0) {
      hero.classList.add('urgent');
      const key = E.jstDate(now) + '/' + a.F.id;
      if (!S.alerted[key]) { S.alerted[key] = true; if (UX) UX.play('alert'); toast('距「' + a.F.t + '」還有 ' + a.toFixed + ' 分鐘'); }
    }
    const c = hero.querySelector('.count');
    if (c) { if (S.lastCount != null && S.lastCount !== c.textContent) c.classList.add('tick'); S.lastCount = c.textContent; }
    // 時間軸對齊「現在」：切到當天時對齊；使用者 60 秒沒滑動時也會自動對回去
    if (S.scrollNow || Date.now() - S.userScrollAt > 60000) { const f = S.scrollNow; S.scrollNow = false; alignNow(f); }
    updateGoNow();
    if (UX) {
      const p = UX.prefs();
      doc.querySelectorAll('[data-ux]').forEach(b => b.classList.toggle('on', !!p[b.getAttribute('data-ux')]));
      const lb = $('btn-lang'); if (lb) lb.textContent = S.lang === 'zh' ? '中' : '日';
      const g = $('btn-glove'); if (g) g.className = p.glove ? 'on' : '';
    }
  }
  function alignNow(smooth) {
    const target = doc.querySelector('.row.now') || $('nowline');
    if (!target) return;
    const hb = doc.querySelector('header').getBoundingClientRect().bottom;
    const y = root.scrollY + target.getBoundingClientRect().top - hb - 56;
    S.autoScrolling = true;
    root.scrollTo({ top: Math.max(0, y), behavior: smooth && S.ux && !S.ux.reduce() ? 'smooth' : 'auto' });
    root.setTimeout(() => { S.autoScrolling = false; updateGoNow(); }, 600);
  }
  function updateGoNow() {
    const nl = $('nowline'), b = $('gonow'); if (!b) return;
    if (!nl) { b.className = ''; return; }
    const r = nl.getBoundingClientRect(), hb = doc.querySelector('header').getBoundingClientRect().bottom;
    const vis = r.top > hb && r.bottom < root.innerHeight - 90;
    b.className = vis ? '' : 'show ' + (r.top <= hb ? 'up' : 'down');
  }
  function onScroll() {
    const h = doc.querySelector('header'), y = root.scrollY;
    if (y > 90) h.classList.add('compact'); else if (y < 16) h.classList.remove('compact', 'peek');
    if (!S.autoScrolling) h.classList.remove('peek');
    updateGoNow();
  }
  function tabList() { return (S.prep && S.prepCtl ? ['prep'] : []).concat(S.data.days.map(d => d.date)); }
  function setTab(t) {
    const L = tabList(), from = L.indexOf(S.tab), to = L.indexOf(t);
    if (to < 0 || t === S.tab) return;
    S.slide = to > from ? 'enter-l' : 'enter-r';
    S.tab = t; S.scrollNow = true; render();
    const tb = doc.querySelector('[data-tab="' + t + '"]'); if (tb && tb.scrollIntoView) tb.scrollIntoView({ inline: 'center', block: 'nearest' });
  }


  /* ---------- 編輯視窗 ---------- */
  const EDIT = { ctx: null };
  function curDay() { return S.data.days.find(d => d.date === S.tab) || S.data.days[0]; }
  function baseItem(day, id) { return E.getPlan(day, planFor(day)).items.find(x => x.id === id) || null; }
  function dur(it) { const f = h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3)); return f(it.e) - f(it.s); }
  function openEditor(mode, id) {
    const day = curDay(), plan = planFor(day), ed = edits();
    const eitems = E.materialize(eff(day).day, plan);
    const it = eitems.find(x => x.id === id);
    if (!it) return;
    let f;
    if (mode === 'edit') {
      const base = baseItem(day, id), m = ed[ekey('m', day.date, plan, id)], ad = ed[ekey('a', day.date, plan, id)];
      const src = ad && !ad.del ? ad : (m && !m.reset ? m : {});
      f = {
        t: src.t || it.t, q: src.q || (it.q || ''), n: src.n != null ? src.n : (it.note || ''),
        d: src.d || (base ? dur(base) : it.dur)
      };
      EDIT.ctx = { mode: 'edit', day: day.date, plan: plan, id: id, added: !base };
    } else {
      f = { t: '', q: '', n: '', d: 30 };
      EDIT.ctx = { mode: 'add', day: day.date, plan: plan, after: id, id: 'u' + Date.now().toString(36) };
    }
    $('ed-title').textContent = mode === 'edit' ? '換成別的地方' : '在「' + it.t + '」後面加一站';
    $('ed-t').value = f.t; $('ed-q').value = f.q; $('ed-n').value = f.n; $('ed-d').value = f.d;
    $('editor').className = 'sheet open';
    editPreview();
  }
  function closeEditor() { $('editor').className = 'sheet'; EDIT.ctx = null; }
  function readFields() {
    const d = Math.round(Number($('ed-d').value));
    return { t: $('ed-t').value.trim(), q: $('ed-q').value.trim(), n: $('ed-n').value.trim(), d: d };
  }
  function candidate(fields) {
    const c = EDIT.ctx, day = S.data.days.find(x => x.date === c.day), e2 = Object.assign({}, edits());
    const ts = Date.now();
    if (c.mode === 'add') e2[ekey('a', c.day, c.plan, c.id)] = Object.assign({ ts: ts, after: c.after }, fields);
    else if (c.added) e2[ekey('a', c.day, c.plan, c.id)] = Object.assign({ ts: ts, after: (edits()[ekey('a', c.day, c.plan, c.id)] || {}).after }, fields);
    else {
      const base = baseItem(day, c.id), m = { ts: ts };
      if (fields.t && fields.t !== base.t) m.t = fields.t;
      if (fields.q && fields.q !== (base.q || '')) m.q = fields.q;
      if (fields.n !== (base.note || '')) m.n = fields.n === '' ? ' ' : fields.n;
      if (fields.d && fields.d !== dur(base)) m.d = fields.d;
      e2[ekey('m', c.day, c.plan, c.id)] = Object.keys(m).length > 1 ? m : { ts: ts, reset: true };
    }
    return { day: day, edits: e2 };
  }
  function editPreview() {
    const c = EDIT.ctx; if (!c) return;
    const f = readFields(), box = $('ed-prev');
    if (!f.t) { box.innerHTML = '<div class="d-note">請先輸入名稱。</div>'; return; }
    if (!(f.d >= 5 && f.d <= 600)) { box.innerHTML = '<div class="d-note">停留時間請填 5～600 分鐘。</div>'; return; }
    const cand = candidate(f), r = E.applyEdits(cand.day, c.plan, cand.edits);
    const before = E.materialize(eff(cand.day).day, c.plan), after = E.materialize(r.day, c.plan);
    const bmap = {}; before.forEach(x => { bmap[x.id] = x; });
    const moved = after.filter(x => x.id === c.id || (bmap[x.id] && (bmap[x.id].s !== x.s || bmap[x.id].e !== x.e)));
    let h = '';
    (r.info.conflicts || []).forEach(x => { h += '<div class="notice warn">⚠ 「' + esc(x.anchorT) + '」' + x.anchorS + ' 會來不及，超出 ' + x.over + ' 分。請縮短停留，或刪掉這段之後的一站。</div>'; });
    const anchors = Object.keys(r.info.slacks || {}).filter(id => after.some(x => x.id === id && x.start >= after.find(y => y.id === c.id).start));
    if (!(r.info.conflicts || []).length && anchors.length) {
      const id0 = anchors[0], an = after.find(x => x.id === id0);
      const sl = Math.max(0, r.info.slacks[id0]);
      h += sl < 10 ? '<div class="notice warn">⚠ 勉強排得下：離「' + esc(an.t) + '」' + an.s + ' 只剩 ' + sl + ' 分緩衝（後面的空檔與緩衝已被用掉），很容易來不及。</div>'
        : '<div class="notice">✔ 排得下：離「' + esc(an.t) + '」' + an.s + ' 還剩 ' + sl + ' 分緩衝。</div>';
    } else if (!anchors.length && !(r.info.conflicts || []).length) h += '<div class="notice">這之後沒有固定班次，時間比較自由。</div>';
    h += '<div class="d-note"><b>時間變化</b></div><ul style="margin:4px 0 0;padding-left:18px">' + moved.slice(0, 8).map(x => '<li>' + x.s + '–' + x.e + '　' + esc(x.t) + '</li>').join('') + '</ul>';
    box.innerHTML = h;
  }
  function saveEditor() {
    const c = EDIT.ctx; if (!c) return;
    const f = readFields();
    if (!f.t) { toast('請先輸入名稱'); return; }
    if (!(f.d >= 5 && f.d <= 600)) { toast('停留時間請填 5～600 分鐘'); return; }
    const cand = candidate(f), key = c.mode === 'add' || c.added ? ekey('a', c.day, c.plan, c.id) : ekey('m', c.day, c.plan, c.id);
    const v = cand.edits[key];
    const fields = Object.assign({}, v); delete fields.ts;
    S.prepCtl.edit(key, fields);
    closeEditor(); toast(c.mode === 'add' ? '已新增，後面的時間已重算' : '已更新，後面的時間已重算');
  }
  function delItem(id) {
    const day = curDay(), plan = planFor(day), base = baseItem(day, id);
    if (base) S.prepCtl.edit(ekey('x', day.date, plan, id), { v: true });
    else S.prepCtl.edit(ekey('a', day.date, plan, id), { del: true, t: '已刪除' });
    toast('已刪除（留下空檔）。可在「還原本日」找回');
  }
  function resetItem(id) {
    const day = curDay(), plan = planFor(day);
    if (!baseItem(day, id)) { delItem(id); return; }
    S.prepCtl.editMany(['m', 'x', 'r'].map(k => ({ key: ekey(k, day.date, plan, id), fields: { reset: true } })));
    toast('已還原這一站');
  }
  function resetDay() {
    const day = curDay(), plan = planFor(day), pre = day.date + '|' + plan + '|';
    const list = Object.keys(edits()).filter(k => k.slice(2, 2 + pre.length) === pre).map(k => ({ key: k, fields: { reset: true } }));
    if (list.length) S.prepCtl.editMany(list);
    toast('已還原本日');
  }


  /* ---------- 即時運行資料（經 Cloudflare Worker 轉送 JR 北海道官網 JSON） ---------- */
  const RT_PROXY = 'https://jr-proxy.sonicalexsonic.workers.dev'; // worker/jr-proxy.js
  const RT_PATH = '/webunkou/json/senku/senku_03.json';
  const RT_PAGES = { airport: 'https://www3.jrhokkaido.co.jp/webunkou/area_spo.html', express: 'https://www3.jrhokkaido.co.jp/webunkou/area_doo.html' };
  const RT_NAME = { airport: '快速 Airport', express: '特急' };
  async function rtLoad() {
    if (!RT_PROXY) throw new Error('轉送伺服器還沒設定');
    const ctl = root.AbortController ? new root.AbortController() : null;
    const timer = ctl ? root.setTimeout(() => ctl.abort(), 10000) : null;
    try {
      const r = await root.fetch(RT_PROXY + RT_PATH + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return JSON.parse((await r.text()).replace(/^﻿/, ''));
    } catch (e) { throw new Error(e && e.name === 'AbortError' ? '逾時' : (e && e.message) || '未知錯誤'); }
    finally { if (timer) root.clearTimeout(timer); }
  }
  function rtStrip(s) { return String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
  function rtText(x) { // 官方列表格式未公開：把每筆裡的文字欄位串起來顯示
    if (x == null) return '';
    if (typeof x !== 'object') return rtStrip(x);
    return Object.keys(x).map(k => rtText(x[k])).filter(Boolean).join(' ');
  }
  function rtHTML(j, key, travelDate) {
    const td = j.today || {}, ss = td.senkuStatus || {}, bad = !!ss[key];
    const isToday = travelDate === E.jstDate(getNow());
    const lines = [];
    (td.gaikyo || []).forEach(g => { const s = rtStrip([g.time, g.title, g.honbun].filter(Boolean).join(' ')); if (s) lines.push(s); });
    (td.senkuComments || []).concat(td.areaComments || []).forEach(c => { const s = rtText(c); if (s) lines.push(s); });
    const uk = (td.unkyuTrains || []).map(rtText).filter(Boolean), ck = (td.chienTrains || []).map(rtText).filter(Boolean);
    return '<div class="rt-box ' + (bad ? 'rt-bad' : 'rt-ok') + '">' +
      '<div class="rt-head">' + (bad ? '⚠ ' + RT_NAME[key] + '：有停駛或延誤' : '✔ ' + RT_NAME[key] + '：目前沒有停駛、延誤資訊') + '</div>' +
      '<div class="rt-time">官方資料時間：' + esc(j.time || '') + (isToday ? '' : '（這是今天的狀況，不是搭車當天）') + '</div>' +
      (lines.length ? '<ul>' + lines.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '') +
      (uk.length ? '<div class="rt-sub">停駛列車</div><ul>' + uk.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '') +
      (ck.length ? '<div class="rt-sub">延誤列車</div><ul>' + ck.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '') +
      '<div class="rt-note">官方只報停駛和較大的延誤，沒有月台資訊；換月台請看現場發車標。</div></div>';
  }
  async function rtCheck(id, key, date) {
    S.rt[id] = { html: '<div class="rt-box">📡 查詢中…</div>' }; render();
    try { const j = await rtLoad(); S.rt[id] = { html: rtHTML(j, key, date) }; }
    catch (e) { S.rt[id] = { html: '<div class="rt-box rt-bad"><div class="rt-head">✖ 讀不到即時資料（' + esc(e.message) + '）</div><div class="rt-note">請直接看官方運行資訊。</div></div>' }; }
    render();
  }
  function rtDemo() {
    const out = $('rt-out'); if (!out) return;
    const sample = { time: '2027年1月16日 16時20分現在', today: {
      gaikyo: [{ time: '16:00', title: '千歳線', honbun: '大雪の影響で、快速エアポートの一部列車に運休や<br>遅れが出ています。' }],
      senkuStatus: { airport: 1 }, senkuComments: [], areaComments: [],
      unkyuTrains: [{ name: '快速エアポート131号', sec: '新千歳空港 15:52 → 札幌' }],
      chienTrains: [{ name: '快速エアポート135号', sec: '新千歳空港 16:52 → 札幌', delay: '約40分遅れ' }] } };
    out.innerHTML = '<div class="notice warn">以下是範例畫面，資料是假的。真正的停駛、延誤清單格式官方沒有公開，遇到時可能長得不一樣。</div>' + rtHTML(sample, 'airport', E.jstDate(getNow()));
  }
  async function rtTest() {
    const out = $('rt-out'); if (!out) return;
    out.innerHTML = '<div class="notice">連線中…</div>';
    const t0 = Date.now();
    try {
      const j = await rtLoad();
      out.innerHTML = '<div class="notice">✔ 讀得到（' + (Date.now() - t0) + ' ms）<br>官方資料時間：' + esc(j.time || '') + '</div>' + rtHTML(j, 'airport', E.jstDate(getNow()));
    } catch (e) {
      out.innerHTML = '<div class="notice warn">✖ 讀不到（' + esc(e.message) + '）</div><a class="chip" href="' + RT_PAGES.airport + '" target="_blank" rel="noopener">開官方運行資訊 ↗</a>';
    }
  }
  /* ---------- 互動 ---------- */
  function act(el) {
    const a = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    const cur = S.last && S.last.a && S.last.a.cur;
    if (a === 'ext' || a === 'leave') {
      if (!cur || !(S.last.a.mode === 'adjust' || S.last.a.mode === 'free')) return;
      if (S.ext.id !== cur.id) S.ext = { id: cur.id, ext: 0, leaveNow: false };
      if (a === 'ext') { S.ext.ext += Number(v); S.ext.leaveNow = false; }
      else { S.ext.leaveNow = !S.ext.leaveNow; if (S.ext.leaveNow) S.ext.ext = 0; }
      save('hk.ext', S.ext); render();
    } else if (a === 'reset') {
      S.ext = { id: null, ext: 0, leaveNow: false }; save('hk.ext', S.ext); render();
    } else if (a === 'copy') {
      const done = () => toast('已複製：' + v);
      if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(v).then(done, () => toast('複製失敗，請手動選取'));
      else toast('此瀏覽器不支援複製');
    } else if (a === 'sim-stop') { S.sim = null; drop('hk.sim'); S.tab = null; render(); }
    else if (a === 'open-settings') openSettings();
    else if (a === 'rt-test') rtTest();
    else if (a === 'rt-demo') rtDemo();
    else if (a === 'rt') { const q = v.split('|'); rtCheck(q[0], q[1], q[2]); }
    else if (a === 'take-alt' || a === 'pick-alt') {
      const parts = v.split('|'), day = a === 'take-alt' && S.last.today ? S.last.today : curDay(), base = E.getPlan(day, planFor(day)).items.find(x => x.id === parts[0]);
      const alt = base && (base.alts || []).find(x => x.s === parts[1]);
      if (alt) takeAlt(parts[0], alt, day);
    }
    else if (a === 'reset-alt') { const day = curDay(); S.prepCtl.edit(ekey('r', day.date, planFor(day), v), { reset: true }); toast('已改回原班次'); }
    else if (a === 'guide') { if (S.stCtl) S.stCtl.openGuide(v); }
    else if (a === 'board') { if (S.stCtl) S.stCtl.openBoard(S.tab); }
    else if (a === 'edit-item') openEditor('edit', v);
    else if (a === 'add-after') openEditor('add', v);
    else if (a === 'del-item') { if (S.ux && !S.ux.confirmTap(el, '再按一次刪除')) return; delItem(v); }
    else if (a === 'reset-item') resetItem(v);
    else if (a === 'reset-day') { if (S.ux && !S.ux.confirmTap(el, '再按一次還原')) return; resetDay(); }
    else if (a === 'ed-save') saveEditor();
    else if (a === 'ed-cancel') closeEditor();
    else if (a === 'ed-dur') { const x = $('ed-d'); x.value = Math.max(5, Math.min(600, (Number(x.value) || 0) + Number(v))); editPreview(); }
  }

  function startSim(local) {
    const t = new Date(local + ':00+09:00');
    if (isNaN(t.getTime())) { toast('請輸入有效的日期時間'); return; }
    S.sim = { base: t.getTime(), real: Date.now() };
    save('hk.sim', S.sim);
    S.ext = { id: null, ext: 0, leaveNow: false }; save('hk.ext', S.ext);
    S.tab = null; closeSettings(); render();
  }

  function openSettings() {
    const now = getNow();
    $('sim-input').value = E.jstDate(now) + 'T' + E.fmtTime(now);
    $('sim-presets').innerHTML = S.data.days.filter(d => d.demo).map(d =>
      '<button class="chip" data-sim="' + d.date + 'T' + d.demo + '">' + md(d.date) + ' ' + d.demo + '</button>').join('');
    $('checklist').innerHTML = ((S.data.trip.checklist) || []).map(c => '<li>' + esc(c) + '</li>').join('');
    $('data-stamp').textContent = '行程資料版本 ' + (S.data.trip.version || '-') + (familyCode() ? '（雲端，已用家庭代碼上鎖）' : '（這支手機）');
    $('settings').className = 'sheet open';
  }
  function closeSettings() { $('settings').className = 'sheet'; }

  function startGeo() {
    if (S.watch != null) { root.navigator.geolocation.clearWatch(S.watch); S.watch = null; S.pos = null; toast('已關閉定位'); render(); return; }
    if (!root.navigator.geolocation) { toast('這個瀏覽器不支援定位'); return; }
    S.watch = root.navigator.geolocation.watchPosition(p => {
      S.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; render();
    }, err => { toast('定位失敗：' + err.message); S.watch = null; render(); }, { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 });
    toast('定位已開啟（只在 App 開著時有效）');
  }

  // 匯入：可以是完整的行程資料檔（含行前清單、站內導引對應、日文站名），也可以只有行程本身
  function importText(text) {
    const msg = $('import-msg');
    let d;
    try { d = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { msg.textContent = '不是有效的 JSON：' + e.message; return; }
    const full = d && d.itinerary ? d : { itinerary: d };
    const errs = E.validate(full.itinerary);
    if (errs.length) { msg.textContent = '格式有問題：' + errs.slice(0, 5).join('；'); return; }
    const p = mergePayload(full);
    S.data = usePayload(p); S.tab = null; S.choice = {}; save('hk.plan', S.choice);
    if (S.prep && S.prepCtl) S.prepCtl.autoSync();
    msg.textContent = '匯入成功' + (d.itinerary ? '（含行前清單與站內導引資料）' : '');
    $('import-text').value = ''; render(); toast('行程已更新');
    pushTrip(p).then(ok => { if (ok) toast('已同步到雲端，對方重新開啟就會更新'); }).catch(e => toast('雲端同步失敗：' + e.message));
  }
  function importData() { importText($('import-text').value); }
  function importFile(ev) {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const rd = new root.FileReader();
    rd.onload = () => { importText(rd.result); ev.target.value = ''; };
    rd.onerror = () => { $('import-msg').textContent = '讀不到這個檔案'; };
    rd.readAsText(f, 'utf-8');
  }

  function bind() {
    if (S.bound) return; S.bound = true;
    doc.addEventListener('click', ev => {
      const t = ev.target; if (!t || !t.closest) return;
      let el;
      if ((el = t.closest('[data-tab]'))) { setTab(el.getAttribute('data-tab')); return; }
      if ((el = t.closest('[data-ux]'))) { const k = el.getAttribute('data-ux'); S.ux.set(k, !S.ux.prefs()[k]); render(); return; }
      if ((el = t.closest('[data-ux-test]'))) { if (!S.ux.prefs().sound) { toast('請先打開音效'); return; } S.ux.play(el.getAttribute('data-ux-test')); return; }
      if ((el = t.closest('[data-plan]'))) {
        S.choice[el.getAttribute('data-date')] = el.getAttribute('data-plan'); save('hk.plan', S.choice);
        S.ext = { id: null, ext: 0, leaveNow: false }; save('hk.ext', S.ext); render(); return;
      }
      if ((el = t.closest('[data-sim]'))) { startSim(el.getAttribute('data-sim')); return; }
      if ((el = t.closest('[data-act]'))) { act(el); return; }
      if (t.closest('a')) return;
      if ((el = t.closest('.ttl[data-flip="1"]'))) {
        const row = el.closest('[data-row]'), k = row.getAttribute('data-row');
        el.classList.add('flipout');
        root.setTimeout(() => { S.flip[k] = !S.flip[k]; S.justFlip = k; render(); S.justFlip = null; if (S.ux) S.ux.play('tick'); }, 170);
        return;
      }
      if ((el = t.closest('[data-row]'))) { const k = el.getAttribute('data-row'); S.expanded[k] = !S.expanded[k]; if (S.expanded[k]) S.justOpened = k; render(); }
    });
    $('editor').addEventListener('input', editPreview);
    const mark = () => { S.userScrollAt = Date.now(); };
    root.addEventListener('touchmove', mark, { passive: true });
    root.addEventListener('wheel', mark, { passive: true });
    root.addEventListener('scroll', () => root.requestAnimationFrame(onScroll), { passive: true });
    $('gonow').addEventListener('click', () => { S.userScrollAt = 0; alignNow(true); });
    $('hero').addEventListener('click', ev => {
      if (ev.target.closest('[data-act]')) return;
      const h = doc.querySelector('header'); if (h.classList.contains('compact')) h.classList.toggle('peek');
    });
    $('btn-lang').addEventListener('click', () => { S.lang = S.lang === 'zh' ? 'jp' : 'zh'; save('hk.lang', S.lang); toast(S.lang === 'jp' ? '公車站名顯示日文' : '公車站名顯示中文'); render(); });
    $('btn-glove').addEventListener('click', () => { const on = S.ux.toggleGlove(); toast(on ? '🧤 手套模式：大按鈕、點擊吸附、左右滑換日' : '已關閉手套模式'); render(); });
    $('btn-board').addEventListener('click', () => { if (S.stCtl) S.stCtl.openBoard(S.tab); else toast('班次資料尚未載入'); });
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-loc').addEventListener('click', startGeo);
    $('set-close').addEventListener('click', closeSettings);
    $('sim-start').addEventListener('click', () => { const v = $('sim-input').value; if (v) startSim(v); else toast('請先選日期時間'); });
    $('sim-stop').addEventListener('click', () => { S.sim = null; drop('hk.sim'); S.tab = null; closeSettings(); render(); });
    $('import-btn').addEventListener('click', importData);
    $('import-file').addEventListener('change', importFile);
    $('import-reset').addEventListener('click', () => { if (!root.confirm('從這支手機移除行程與家庭代碼？之後要重新輸入代碼才看得到。')) return; drop('hk.trip'); drop('hk.data'); drop('hk.sync'); root.location.reload(); });
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) { render(); if (S.prepCtl) S.prepCtl.autoSync(); } });
  }

  function boot(data) {
    S.data = data;
    S.choice = load('hk.plan', {}); S.sim = load('hk.sim', null); S.ext = load('hk.ext', { id: null, ext: 0, leaveNow: false });
    if (S.prep && root.Prep && !S.prepCtl) {
      S.prepCtl = root.Prep.attach({
        doc: doc, el: () => $('prepview'), prep: () => S.prep,
        today: () => E.jstDate(getNow()), start: () => S.data.trip.start, now: () => new Date(),
        load: load, save: save, toast: toast, onChange: () => render(),
        fx: {
          toggled: (el, done, complete, secEl) => {
            if (!S.ux) return;
            S.ux.pop(el); S.ux.play(done ? (complete ? 'party' : 'done') : 'undo');
            if (complete && secEl) { secEl.classList.add('complete'); const r = el.getBoundingClientRect(); S.ux.confetti(r.left + r.width / 2, r.top + r.height / 2); }
          },
          confirm: (el, label) => !S.ux || S.ux.confirmTap(el, label)
        }, fetch: root.fetch.bind(root),
        setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root),
        copy: t => (root.navigator.clipboard && root.navigator.clipboard.writeText) ? root.navigator.clipboard.writeText(t) : Promise.reject(new Error('unsupported'))
      });
      S.prepCtl.autoSync();
    }
    if (root.UX && !S.ux) {
      S.ux = root.UX.init({ doc: doc, swipeArea: doc.querySelector('main'), onSwipe: dir => {
        const L = tabList(), i = L.indexOf(S.tab), n = L[i + dir];
        if (n) setTab(n); else if (S.ux) S.ux.play('undo');
      } });
    }
    if (S.stations && root.Station && !S.stCtl) {
      S.stCtl = root.Station.init({
        doc: doc, data: () => S.data, stations: S.stations, fx: n => { if (S.ux) S.ux.play(n); }, getNow: getNow, toast: toast, getPos: () => S.pos,
        tabDate: () => (S.data.days.some(d => d.date === S.tab) ? S.tab : E.jstDate(getNow())),
        items: date => { const d = S.data.days.find(x => x.date === date); return d ? E.materialize(eff(d).day, planFor(d)) : []; },
        lang: () => S.lang,
        openItem: (date, id) => { S.tab = date; S.expanded[date + '/' + id] = true; S.justOpened = date + '/' + id; render(); }
      });
    }
    bind(); render();
    if (!S.timer) S.timer = root.setInterval(render, 20000);
  }

  /* ---------- 雲端行程（用家庭代碼上鎖）----------
     行程、行前清單與站內導引對應存在 Firestore 的 trips/{家庭代碼}_trip；
     沒有代碼的人只看得到鎖定畫面。讀到後快取在這支手機（hk.trip），之後可離線使用。 */
  const CLOUD = { pid: 'hokkaido-trip-8507d', key: 'AIzaSyAP_WLEeJZzSd78OUYqHgXP9yKIUgqA-CA' };
  const CODE_RE = /^[A-Za-z0-9_-]{20,58}$/;
  function tripUrl(code, write) {
    return 'https://firestore.googleapis.com/v1/projects/' + CLOUD.pid + '/databases/(default)/documents/trips/' + code + '_trip?' +
      (write ? 'updateMask.fieldPaths=data&' : '') + 'key=' + encodeURIComponent(CLOUD.key);
  }
  async function cloudGet(code) {
    const r = await root.fetch(tripUrl(code, false));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('讀取失敗（' + r.status + '）');
    const j = await r.json(), raw = j && j.fields && j.fields.data && j.fields.data.stringValue;
    return raw ? JSON.parse(raw) : null;
  }
  async function cloudPut(code, payload) {
    const r = await root.fetch(tripUrl(code, true), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { data: { stringValue: JSON.stringify(payload) } } })
    });
    if (!r.ok) throw new Error('寫入失敗（' + r.status + '）');
  }
  function familyCode() { const s = load('hk.sync', null); return s && s.code && CODE_RE.test(s.code) ? s.code : null; }
  function validPayload(p) { return p && p.itinerary && E.validate(p.itinerary).length === 0; }
  async function bundled() { return null; } // 行程不再放在公開倉庫，只存在雲端與手機
  // 雲端與手機快取比對：較新的一方勝出；雲端沒有而手機有，就上傳（第一次上鎖）
  async function syncTrip(code, local) {
    const cloud = await cloudGet(code);
    if (cloud && validPayload(cloud) && (!local || (cloud.ts || 0) >= (local.ts || 0))) return { payload: cloud, uploaded: false };
    if (local && validPayload(local)) { const p = Object.assign({}, local, { ts: local.ts || Date.now() }); await cloudPut(code, p); return { payload: p, uploaded: true }; }
    return { payload: null, uploaded: false };
  }
  function usePayload(p) {
    save('hk.trip', p);
    S.prep = p.prep || null;
    if (S.prep) S.prep.sync = { pid: CLOUD.pid, key: CLOUD.key };
    if (S.stations) { S.stations.trips = p.trips || {}; S.stations.jp = p.jp || {}; }
    return p.itinerary;
  }
  function showLock(msg) {
    $('lock').className = 'lock open';
    $('lock-msg').textContent = msg || '';
    const s = load('hk.sync', null); if (s && s.code) $('lock-code').value = s.code;
  }
  async function unlock() {
    const code = ($('lock-code').value || '').trim();
    if (!CODE_RE.test(code)) { $('lock-msg').textContent = '家庭代碼是 20～58 個英數字元（可含 - 或 _）。'; return; }
    $('lock-msg').textContent = '讀取中…';
    try {
      const r = await syncTrip(code, await bundled());
      if (!r.payload) { $('lock-msg').textContent = '這組家庭代碼沒有行程資料，請確認有沒有打錯。'; return; }
      const sync = Object.assign({}, load('hk.sync', {}) || {}, { pid: CLOUD.pid, key: CLOUD.key, code: code, on: true });
      save('hk.sync', sync);
      $('lock').className = 'lock';
      boot(usePayload(r.payload));
      if (r.uploaded) toast('已把行程存到雲端，之後用家庭代碼才看得到');
    } catch (e) { $('lock-msg').textContent = '連不上雲端：' + e.message + '。請在有網路時再試。'; }
  }
  // 匯入新的行程 JSON 後，同步上傳（有家庭代碼時）
  function mergePayload(extra) {
    const cur = load('hk.trip', null) || {};
    return {
      itinerary: extra.itinerary || cur.itinerary || S.data,
      prep: extra.prep || cur.prep || S.prep,
      trips: extra.trips || cur.trips || (S.stations && S.stations.trips) || null,
      jp: extra.jp || cur.jp || (S.stations && S.stations.jp) || null,
      ts: Date.now()
    };
  }
  async function pushTrip(p) {
    const code = familyCode(); if (!code) return false;
    await cloudPut(code, p); return true;
  }

  async function start() {
    try { const r = await root.fetch('stations.json'); if (r.ok) S.stations = await r.json(); } catch (e) { S.stations = null; }
    $('lock-go').addEventListener('click', unlock);
    $('lock-code').addEventListener('keydown', ev => { if (ev.key === 'Enter') unlock(); });
    if ('serviceWorker' in root.navigator) root.navigator.serviceWorker.register('sw.js').catch(() => {});
    const code = familyCode();
    const cached = load('hk.trip', null);
    if (validPayload(cached)) {
      boot(usePayload(cached));
      if (code) syncTrip(code, cached).then(r => {
        if (r.payload && (r.payload.ts || 0) > (cached.ts || 0)) { S.data = usePayload(r.payload); render(); toast('行程已從雲端更新'); }
      }).catch(() => { /* 離線時沿用手機裡的版本 */ });
      return;
    }
    if (code) {
      try { const r = await syncTrip(code, await bundled()); if (r.payload) { boot(usePayload(r.payload)); if (r.uploaded) toast('已把行程存到雲端'); return; } }
      catch (e) { showLock('連不上雲端，請在有網路時開啟。'); return; }
    }
    showLock();
  }

  root.App = { boot, render, S, start };
  if (!root.__TEST__) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start(); }
})(typeof window !== 'undefined' ? window : globalThis);
