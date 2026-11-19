/* 離線快取：先給舊版（秒開），背景再更新；沒網路也能用。改版時把 VER 加 1。 */
const VER = 'hk-v32';
const CORE = ['./', 'engine.js', 'prep.js', 'station.js', 'ux.js', 'map.js', 'pixel.js', 'app.js', 'stations.json', 'otaru_map.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER && k !== 'hk-tiles').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // 地圖圖磚：先看手機裡存好的離線地圖；沒有就直接上網（不另外存，避免佔滿容量）
  if (req.method === 'GET' && url.hostname === 'cyberjapandata.gsi.go.jp') {
    e.respondWith(caches.open('hk-tiles').then(c => c.match(req, { ignoreVary: true })).then(hit => hit || fetch(req)));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res && res.ok && !res.redirected) { const copy = res.clone(); caches.open(VER).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
