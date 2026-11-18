import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../prep.js');
import assert from 'assert';
let st = P.emptyState();
st = P.toggle(st,'hotelA',100); assert(P.progress(JSON.parse(await (await import('fs/promises')).readFile(new URL('../private/v1114/prep.json', import.meta.url),'utf8')),st).done===1);
st = P.toggle(st,'hotelA',200); assert(!P.sectionItems({id:'book',items:[{id:'hotelA',t:'x'}]},st)[0].v);
let a=P.addCustom(P.emptyState(),'shop','暖暖包',1000,'aa'); let b=P.addCustom(P.emptyState(),'shop','藥',1001,'bb');
let m=P.merge(a,b); assert.equal(P.sectionItems({id:'shop',items:[]},m).length,2);
let id=Object.keys(a.u)[0]; let a2=P.removeCustom(a,id,2000); assert.equal(P.sectionItems({id:'shop',items:[]},P.merge(m,a2)).length,1);
// 較舊的刪除不會蓋掉較新的勾選
let t1=P.toggle(P.emptyState(),'x',5), t2=P.toggle(P.emptyState(),'x',9); assert(P.merge(t1,t2).c.x.ts===9);
assert.equal(P.dayDiff('2026-11-14','2027-01-16'),63);
assert.equal(P.checkCfg({pid:'my-trip-1a2b3',key:'A'.repeat(39),code:'x'.repeat(20)}),'');
assert(P.checkCfg({pid:'my-trip-1a2b3',key:'A'.repeat(39),code:'short'}));
// 模擬 Firestore
let store=null;const calls=[];
const fake=async(url,o)=>{calls.push((o&&o.method)||'GET');
  if(o&&o.method==='PATCH'){store=JSON.parse(o.body).fields.data.stringValue;return{ok:true,status:200}}
  if(!store)return{ok:false,status:404};
  return{ok:true,status:200,json:async()=>({fields:{data:{stringValue:store}}})}};
const cfg={pid:'my-trip-1a2b3',key:'A'.repeat(39),code:'x'.repeat(20)};
let r1=await P.syncOnce(cfg,a,fake); let r2=await P.syncOnce(cfg,b,fake);
assert.equal(P.sectionItems({id:'shop',items:[]},r2).length,2);
let n=calls.length; await P.syncOnce(cfg,r2,fake); assert.equal(calls.length,n+1,'無差異時只讀不寫');
console.log('prep unit ok', calls.join(','));
