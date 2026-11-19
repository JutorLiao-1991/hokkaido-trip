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
// 附近店家：查詢語法、解析、排序
const q1=M.buildQuery('conv',43.0578,141.3503,500);assert(q1.includes('[out:json]')&&q1.includes('nwr["shop"="convenience"](around:500,43.05780,141.35030);')&&q1.endsWith('out center tags 200;'));
assert(M.buildQuery('drug',43,141,1000).split('nwr').length===3,'藥妝＝2 條件');
assert.throws(()=>M.buildQuery('zzz',1,1,1));
const ctr={lat:43.0578,lng:141.3503};
const js={elements:[
 {type:'node',id:1,lat:43.0600,lon:141.3503,tags:{name:'遠的店',shop:'convenience'}},
 {type:'node',id:2,lat:43.0580,lon:141.3503,tags:{'name:ja':'セイコーマート','name':'Seicomart'}},
 {type:'way',id:3,center:{lat:43.0585,lon:141.3510},tags:{brand:'ローソン'}},
 {type:'node',id:4,lat:43.0581,lon:141.3504,tags:{shop:'convenience'}},
 {type:'node',id:5,tags:{name:'沒座標'}},
 {type:'node',id:2,lat:43.0580,lon:141.3503,tags:{'name:ja':'セイコーマート'}}]};
const r1=M.parsePoi(js,ctr,'conv');
assert(r1.length===4&&r1.every((x,i)=>i===0||r1[i-1].d<=x.d),'依距離遞增、去重、略過沒座標');
assert(r1[0].t==='セイコーマート');
assert(M.parsePoi({elements:[{type:'node',id:9,lat:43.058,lon:141.35,tags:{amenity:'restaurant'}}]},ctr,'food').length===0,'餐廳沒店名不列');
const rf=M.parsePoi({elements:[{type:'node',id:9,lat:43.058,lon:141.35,tags:{name:'麵屋',amenity:'restaurant',cuisine:'ramen;sushi',highchair:'yes',opening_hours:'Mo-Su 11:00-22:00'}}]},ctr,'food')[0];
assert(rf.bits.join().includes('拉麵・壽司')&&rf.bits.join().includes('兒童椅')&&rf.oh.includes('11:00-22:00'));
assert(M.parsePoi({elements:[{type:'node',id:7,lat:43.058,lon:141.35,tags:{amenity:'toilets'}}]},ctr,'wc')[0].t==='公共廁所');
assert(M.parsePoi(null,ctr,'conv').length===0);
assert(M.fmtOh('24/7')==='24 小時營業'&&M.fmtOh('')==='');
assert(M.fmtOh('x'.repeat(100)).length<70);
// 反向查詢 → 日文地址
assert.deepStrictEqual(M.addrFrom({results:{muniCd:'01101',lv01Nm:'北一条西３丁目'}}),{text:'北海道札幌市中央区北一条西３丁目',muniKnown:true});
assert(M.addrFrom({results:{muniCd:'99999',lv01Nm:'ＸＸ'}}).muniKnown===false&&M.addrFrom({})===null&&M.addrFrom(null)===null);
console.log('near ok');
