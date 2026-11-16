/* ux.js — 手感層：手套模式、滑動換日、點擊吸附、音效、彩帶、確認防誤觸。
   不碰行程資料；偏好存在 localStorage（hk.ux）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const root = typeof self !== 'undefined' ? self : globalThis;
  const ACTION = 'button,a,input,textarea,select,label,[data-row],[data-tab],[data-act],[data-sx],[data-p],[data-plan],[data-sim]';

  /* ---------- 純函式（可測試）---------- */
  // 依滑動位移判斷方向：1 = 往下一頁（向左滑），-1 = 上一頁，0 = 不算
  function swipeDir(dx, dy, glove) {
    const min = glove ? 45 : 70;
    if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.6) return 0;
    return dx < 0 ? 1 : -1;
  }
  // 點擊吸附：以點為中心，由近到遠的取樣點
  function ringPoints(x, y, radii) {
    const pts = [];
    (radii || [14, 26, 40]).forEach(r => {
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; pts.push([Math.round(x + r * Math.cos(a)), Math.round(y + r * Math.sin(a))]); }
    });
    return pts;
  }

  function init(opts) {
    // opts: {doc, onSwipe(dir), swipeArea: el}
    const doc = opts.doc, body = doc.body;
    const P = Object.assign({ glove: false, sound: false, keys: false }, load());
    const reduce = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function load() { try { return JSON.parse(root.localStorage.getItem('hk.ux')) || {}; } catch (e) { return {}; } }
    function persist() { try { root.localStorage.setItem('hk.ux', JSON.stringify(P)); } catch (e) { /* ignore */ } }
    function apply() { body.classList.toggle('glove', !!P.glove); if (opts.onChange) opts.onChange(P); }

    /* ---- 音效（WebAudio 即時合成，不用音檔）---- */
    let ctx = null;
    function audio() {
      if (!P.sound) return null;
      try {
        if (!ctx) { const A = root.AudioContext || root.webkitAudioContext; if (!A) return null; ctx = new A(); }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch (e) { return null; }
    }
    function tone(c, f, t0, dur, vol, type) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    const SOUNDS = {
      chime: [[880, 0, 0.5, 0.12], [698.5, 0.22, 0.5, 0.11], [523.3, 0.44, 0.8, 0.1]],
      done: [[660, 0, 0.12, 0.08], [990, 0.07, 0.18, 0.08]],
      party: [[523.3, 0, 0.18, 0.09], [659.3, 0.09, 0.18, 0.09], [784, 0.18, 0.18, 0.09], [1046.5, 0.27, 0.4, 0.1]],
      alert: [[1046.5, 0, 0.16, 0.12, 'triangle'], [1046.5, 0.24, 0.16, 0.12, 'triangle'], [1318.5, 0.48, 0.3, 0.12, 'triangle']],
      tick: [[1800, 0, 0.03, 0.025, 'square']],
      undo: [[520, 0, 0.1, 0.06], [390, 0.06, 0.14, 0.06]]
    };
    function play(name) {
      if (name === 'tick' && !P.keys) return;
      const c = audio(); if (!c) return;
      const t = c.currentTime + 0.01;
      (SOUNDS[name] || []).forEach(s => tone(c, s[0], t + s[1], s[2], s[3], s[4]));
    }

    /* ---- 彩帶 ---- */
    function confetti(x, y) {
      if (reduce()) return;
      const colors = ['#1b7f4a', '#f2b705', '#0f6f7c', '#c62828', '#4fb6c4'];
      for (let i = 0; i < 26; i++) {
        const d = doc.createElement('i');
        d.className = 'confetti';
        const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 90;
        d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.background = colors[i % colors.length];
        d.style.setProperty('--dx', Math.round(Math.cos(ang) * dist) + 'px');
        d.style.setProperty('--dy', Math.round(Math.sin(ang) * dist - 40) + 'px');
        d.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
        body.appendChild(d);
        root.setTimeout(() => d.remove(), 1100);
      }
    }
    function pop(el) {
      if (!el || reduce()) return;
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }

    /* ---- 手套模式：防誤觸二次確認 ---- */
    function confirmTap(el, label) {
      if (!P.glove) return true;
      if (el.getAttribute('data-armed') === '1') return true;
      const old = el.innerHTML;
      el.setAttribute('data-armed', '1'); el.classList.add('armed'); el.textContent = label || '再按一次確認';
      root.setTimeout(() => { if (el.isConnected) { el.removeAttribute('data-armed'); el.classList.remove('armed'); el.innerHTML = old; } }, 3000);
      play('tick');
      return false;
    }

    /* ---- 點擊吸附（手套模式）：點到空白處時，找附近最近的按鈕 ---- */
    doc.addEventListener('click', ev => {
      if (!P.glove || !ev.isTrusted) return;
      const t = ev.target;
      if (t && t.closest && t.closest(ACTION)) return;
      if (t && t.classList && t.classList.contains('gsheet')) return;
      const pts = ringPoints(ev.clientX, ev.clientY);
      for (let i = 0; i < pts.length; i++) {
        const e = doc.elementFromPoint(pts[i][0], pts[i][1]);
        const hit = e && e.closest && e.closest(ACTION);
        if (hit && !hit.disabled && !/^(INPUT|TEXTAREA|SELECT)$/.test(hit.tagName)) {
          ev.preventDefault(); ev.stopPropagation();
          hit.classList.add('snapped'); root.setTimeout(() => hit.classList.remove('snapped'), 260);
          hit.click();
          return;
        }
      }
    }, true);

    /* ---- 按鍵音 ---- */
    doc.addEventListener('pointerdown', ev => {
      audio(); // 第一次觸碰時解鎖 iPhone 的音訊
      const t = ev.target;
      if (t && t.closest && t.closest(ACTION)) play('tick');
    }, { passive: true, capture: true });

    /* ---- 左右滑動換日 ---- */
    let sx = null, sy = 0, st = 0;
    const area = opts.swipeArea;
    if (area) {
      area.addEventListener('touchstart', ev => {
        const t = ev.target;
        if (ev.touches.length !== 1 || (t.closest && t.closest('input,textarea,select,#tabs,.g-plat'))) { sx = null; return; }
        sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; st = Date.now();
      }, { passive: true });
      area.addEventListener('touchend', ev => {
        if (sx == null) return;
        const c = ev.changedTouches[0], dx = c.clientX - sx, dy = c.clientY - sy;
        sx = null;
        if (Date.now() - st > 800) return;
        const dir = swipeDir(dx, dy, P.glove);
        if (dir && opts.onSwipe) opts.onSwipe(dir);
      }, { passive: true });
    }

    apply();
    return {
      prefs: () => Object.assign({}, P),
      set(k, v) { P[k] = v; persist(); apply(); if (k === 'sound' && v) { audio(); play('done'); } },
      toggleGlove() { P.glove = !P.glove; persist(); apply(); play(P.glove ? 'done' : 'undo'); return P.glove; },
      play, confetti, pop, confirmTap, reduce
    };
  }

  return { swipeDir, ringPoints, init };
});
