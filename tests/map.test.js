const M=require('../map.js');const assert=require('assert');
// 投影來回
const p={lat:43.0687,lng:141.3507};
for(const z of [8,10.5,14]){const x=M.lngX(p.lng,z),y=M.latY(p.lat,z);assert(Math.abs(M.xLng(x,z)-p.lng)<1e-9);assert(Math.abs(M.yLat(y,z)-p.lat)<1e-9);}
// 螢幕座標：中心點在畫面正中央，往右往下是東、南
let c={lat:43.05,lng:141.35},xy=M.toXY(c,12,400,600,43.05,141.35);assert.deepStrictEqual([xy.x,xy.y],[200,300]);
let e=M.toXY(c,12,400,600,43.05,141.36),s=M.toXY(c,12,400,600,43.04,141.35);assert(e.x>200&&s.y>300);
const ll=M.toLL(c,12,400,600,e.x,e.y);assert(Math.abs(ll.lng-141.36)<1e-9);
// 圖磚：中心正中的那張要涵蓋畫面中心，所有圖磚鋪滿畫面
for(const z of [8.6,11,13.4,15]){
  const t=M.tilesFor(c,z,390,600);assert(t.list.length>0&&t.list.length<40,'tiles '+t.list.length);
  const lefts=t.list.map(i=>i.left),tops=t.list.map(i=>i.top),sz=t.list[0].size;
  assert(Math.min(...lefts)<=0&&Math.max(...lefts)+sz>=390&&Math.min(...tops)<=0&&Math.max(...tops)+sz>=600,'覆蓋 z='+z);
  assert(t.list.every(i=>i.url.startsWith('https://cyberjapandata.gsi.go.jp/xyz/std/'+t.tz+'/')));
}
// 已知圖磚：札幌 z10 → 914/376（手算：x=(141.35+180)/360*1024=914.1，y=(1-ln(tan φ+sec φ)/π)/2*1024=376.1）
const tx=Math.floor(M.lngX(141.3507,10)/256),ty=Math.floor(M.latY(43.0687,10)/256);assert(tx===914&&ty===376,'z10 tile '+tx+'/'+ty);
// 取景：兩點都在畫面內
const f=M.fitView([{lat:43.0687,lng:141.3507},{lat:43.7683,lng:142.4808}],390,500);
for(const q of [{lat:43.0687,lng:141.3507},{lat:43.7683,lng:142.4808}]){const a=M.toXY({lat:f.lat,lng:f.lng},f.z,390,500,q.lat,q.lng);assert(a.x>=0&&a.x<=390&&a.y>=0&&a.y<=500,JSON.stringify(a));}
assert(M.fitView([{lat:43.05,lng:141.35}],390,500).z>=14);
assert(M.fitView([],390,500).z<10);
// 範圍與距離
assert(M.inBounds({lat:43.0,lng:141.3})&&!M.inBounds({lat:24.1,lng:120.6}));
assert(Math.abs(M.distKm({lat:43.0687,lng:141.3507},{lat:42.7876,lng:141.6804})-40)<5);
assert(M.fmtKm(0.4)==='400 公尺'&&M.fmtKm(2.34)==='2.3 公里'&&M.fmtKm(41.6)==='42 公里');
// 離線存圖數量合理（太多會吃手機容量）
const pts=[{lat:43.0578,lng:141.3503},{lat:42.7876,lng:141.6804},{lat:43.7683,lng:142.4808}];
const l=M.prefetchList(pts);assert(l.length>300&&l.length<1500,'prefetch '+l.length);
assert(new Set(l.map(t=>t.join('/'))).size===l.length);
console.log('map ok, prefetch',l.length);
