/* 原創像素小動物（北海道主題）：企鵝、雪狐、海豹。用 16×16 的字元格畫成 SVG，不需要圖檔。 */
(function (root) {
  'use strict';
  const PAL = {
    b: '#2c3e57', w: '#ffffff', k: '#1b1f24', o: '#f39a2b', c: '#f6a5b5',
    r: '#e07a2e', d: '#9a4a17', g: '#97aab6', l: '#dfe8ee', s: '#cfe8ff'
  };
  const SPRITES = {
    penguin: [
      '................',
      '.....bbbbbb.....',
      '....bbbbbbbb....',
      '...bbwwbbwwbb...',
      '...bwkwwwwkwb...',
      '...bwcwoowcwb...',
      '...bbwwoowwbb...',
      '..bbbwwwwwwbbb..',
      '.bbbwwwwwwwwbbb.',
      '.bb.bwwwwwwb.bb.',
      '....bwwwwwwb....',
      '....bwwwwwwb....',
      '.....bwwwwb.....',
      '......bbbb......',
      '.....oo..oo.....',
      '................'
    ],
    fox: [
      '................',
      '..k.........k...',
      '..rr.......rr...',
      '..rrr.....rrr...',
      '..rrrrrrrrrrr...',
      '.rrrkrrrrrkrrr..',
      '.rrwwrrrrrwwrr..',
      '..rwwwwkwwwwr...',
      '...wwwwwwwww....',
      '....rrrrrrr.....',
      '...rrwwwwwrr....',
      '...rrwwwwwrr..rr',
      '...rrwwwwwrr.rrw',
      '...rrrrrrrrrrrw.',
      '...dd.....dd....',
      '................'
    ],
    seal: [
      '................',
      '................',
      '................',
      '................',
      '..gggg..........',
      '.gggggg.........',
      '.gkkgkkgg.......',
      'gggggggggggg....',
      'ggcglllgggggg...',
      '.gglllllgggggg..',
      '.gglllllllgggg.g',
      '..gglllllggggggg',
      '...ggggggggggg.g',
      '................',
      '................',
      '................'
    ]
  };
  // 把同色、相鄰的格子合併成一條矩形，SVG 更小
  function svg(name, px) {
    const g = SPRITES[name]; if (!g) return '';
    px = px || 3;
    let r = '';
    g.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        if (ch === '.') { x++; continue; }
        let n = 1; while (x + n < row.length && row[x + n] === ch) n++;
        r += '<rect x="' + x + '" y="' + y + '" width="' + n + '" height="1" fill="' + (PAL[ch] || '#000') + '"/>';
        x += n;
      }
    });
    const size = 16 * px;
    return '<svg class="px-svg" width="' + size + '" height="' + size + '" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' + r + '</svg>';
  }
  // 依狀態挑角色：趕時間＝雪狐奔跑、悠閒＝企鵝搖擺、還沒開始或結束＝海豹睡覺
  function pick(cls) {
    if (/h-red|urgent/.test(cls)) return { name: 'fox', mood: 'run' };
    if (/h-gray/.test(cls)) return { name: 'seal', mood: 'sleep' };
    return { name: 'penguin', mood: 'waddle' };
  }
  function mascot(cls) {
    const p = pick(cls || '');
    return '<button class="px-pet px-' + p.mood + '" data-act="pet" aria-label="小動物">' + svg(p.name, 3) +
      (p.mood === 'sleep' ? '<span class="px-z">z<i>z</i></span>' : '') + '</button>';
  }
  const api = { svg, mascot, pick, SPRITES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pixel = api;
})(typeof window !== 'undefined' ? window : globalThis);
