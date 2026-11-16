/* JR 北海道運行資訊轉送（Cloudflare Worker）
   只轉送 JR 北海道官網「路線別運行資訊」的 JSON，且只回應北海道行程 App。
   部署：Cloudflare → Workers & Pages → Create → Worker → 把這整個檔案貼進去 → Deploy。 */
const ALLOW_ORIGINS = ['https://jutorliao-1991.github.io'];
const UPSTREAM = 'https://www3.jrhokkaido.co.jp';
const PATH_RE = /^\/webunkou\/json\/senku\/senku_\d{2}(_tc)?\.json$/;

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (origin && !ALLOW_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const path = new URL(req.url).pathname;
    if (path === '/' ) return new Response('ok', { headers: cors });
    if (!PATH_RE.test(path)) return new Response('Not found', { status: 404, headers: cors });

    let up;
    try {
      up = await fetch(UPSTREAM + path, { redirect: 'manual', cf: { cacheTtl: 60, cacheEverything: true } });
    } catch (e) {
      return json({ error: 'upstream-unreachable' }, 502, cors);
    }
    if (up.status !== 200) return json({ error: 'upstream', status: up.status }, 502, cors);
    const body = (await up.text()).replace(/^﻿/, '');
    return new Response(body, {
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' }, cors)
    });
  }
};
function json(o, status, cors) {
  return new Response(JSON.stringify(o), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
}
