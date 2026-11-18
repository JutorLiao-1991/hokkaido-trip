const E=require('../engine.js');const assert=require('assert');
const d=require('../private/v1114/itinerary.json');
const day=d.days[1];
// 無異動：原物件
let r=E.applyEdits(day,'main',{});assert.strictEqual(r.day,day);
// 全部 reset
r=E.applyEdits(day,'main',{'m|2027-01-17|main|b11':{ts:1,reset:true}});assert.strictEqual(r.day,day);
const show=(r)=>r.day.plans[0].items.map(i=>i.id+' '+i.s+'-'+i.e).join(' | ');
// 音樂盒堂 30 → 45 分：後面 flex 被擠壓，但 17:30 班次不變
r=E.applyEdits(day,'main',{'m|2027-01-17|main|b11':{ts:2,d:45,t:'改去北一硝子',q:'北一硝子'}});
console.log(show(r),JSON.stringify(r.info));
let f=r.day.plans[0].items.find(i=>i.id==='b17');assert.equal(f.s,'17:30');
assert.equal(r.day.plans[0].items.find(i=>i.id==='b11').t,'改去北一硝子');
assert.deepEqual(E.validate({trip:d.trip,days:[r.day]}),[]);
// 大幅加長 → 衝突
r=E.applyEdits(day,'main',{'m|2027-01-17|main|b11':{ts:3,d:240}});console.log(JSON.stringify(r.info.conflicts));assert(r.info.conflicts.length===1);
// 刪除一站
r=E.applyEdits(day,'main',{'x|2027-01-17|main|b12':{ts:4,v:true}});assert(!r.day.plans[0].items.some(i=>i.id==='b12'));console.log(show(r));
assert.deepEqual(E.validate({trip:d.trip,days:[r.day]}),[]);
// 新增一站在 b09 之後
r=E.applyEdits(day,'main',{'a|2027-01-17|main|u1':{ts:5,after:'b09',t:'六花亭',d:30,q:'六花亭 小樽'}});console.log(show(r),JSON.stringify(r.info));
assert(r.day.plans[0].items.some(i=>i.id==='u1'));
// 固定班次不可被修改
r=E.applyEdits(day,'main',{'m|2027-01-17|main|b17':{ts:6,t:'亂改',d:5},'x|2027-01-17|main|b17':{ts:6,v:true}});assert.deepEqual(r.day,day);
// 最後一段（無後續固定班次）
r=E.applyEdits(d.days[4],'main',{'m|2027-01-20|main|d11':{ts:7,d:120}});console.log(show(r).slice(-120));assert.deepEqual(E.validate({trip:d.trip,days:[r.day]}),[]);
console.log('engine ok');
// 改搭備用班次：固定項目換時間，後面那一段跟著往後排
{
  const d1 = d.days[0];
  const r1 = E.applyEdits(d1, 'main', { 'r|2027-01-16|main|a06': { ts: 9, s: '17:18', e: '17:57', label: '139 號' } });
  const its = r1.day.plans[0].items, a06 = its.find(x => x.id === 'a06'), a07 = its.find(x => x.id === 'a07');
  assert.equal(a06.s, '17:18'); assert(a06.t.startsWith('139 號（改搭）')); assert.equal(a07.s, '17:57');
  console.log('reroute:', its.filter(x => x.shifted || x.alted).map(x => x.id + ' ' + x.s).join(', '), JSON.stringify(r1.info.conflicts));
  // 臨時延長（tmp）不算自訂
  const r2 = E.applyEdits(d.days[1], 'main', { 'm|2027-01-17|main|b11': { ts: 1, d: 40, tmp: true } });
  assert.equal(r2.info.edited, 0); assert(r2.day.plans[0].items.find(x => x.id === 'b11').live);
  console.log('reroute ok');
}
