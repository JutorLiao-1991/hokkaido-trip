const St = require('../station.js'), E = require('../engine.js'), assert = require('assert');
const ST = Object.assign({}, require('../stations.json'), require('../private/v1114/trip-extra.json')), d = require('../private/v1114/itinerary.json');
// 每個有導引的班次，起訖站都存在
Object.entries(ST.trips).forEach(([id, t]) => { if (!t.bus) { assert(ST.stations[t.from], id); assert(ST.stations[t.to], id); } });
// 行程中的軌道班次都有對應
const ids = new Set(d.days.flatMap(x => x.plans.flatMap(p => p.items.map(i => i.id))));
Object.keys(ST.trips).forEach(id => assert(ids.has(id), 'trip id 不在行程：' + id));
// 建議位置都產生得出步驟
Object.entries(ST.trips).forEach(([id, t]) => {
  if (t.bus) return;
  if (t.rec && !ST.stations[t.from].none) assert(St.steps(ST.stations[t.from], 'dep', t.rec, null), id + ' dep');
  if (t.arrRec && !ST.stations[t.to].none) assert(St.steps(ST.stations[t.to], 'arr', t.arrRec, null), id + ' arr');
});
// 看板：1/16 有預定＋備用班次，依時間排序
const day = d.days[0], rows = St.boardRows(E.materialize(day, day.defaultPlan), ST.trips, new Date('2027-01-16T16:40:00+09:00'));
assert(rows.some(r => r.planned && r.id === 'a06'));
assert(rows.every((r, i) => !i || rows[i - 1].start <= r.start));
assert(rows.find(r => r.time === '16:30').gone);
assert.equal(St.splitTitle('快速 Airport 64 號：札幌 → 新千歲空港').dest, '新千歲空港');
assert.equal(St.nearest(ST.stations, { lat: 43.0688, lng: 141.351 }).id, 'sapporo');
console.log('station ok');
